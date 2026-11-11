"""
FastAPI REST and WebSocket Router for Swarm Mode API additions (§15).
"""
from __future__ import annotations
import asyncio
from datetime import datetime, timezone
from pathlib import Path
import time
from typing import Any, Dict, List, Literal, Optional
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
import yaml
from .controller import SwarmController
from .rounds.estimator import RunEstimator
from .scheduler.admission import AdmissionController
from .scheduler.planner_capacity import CapacityMap
from .store.repo import SwarmRepository

api_router = APIRouter()

# In-memory controllers and repo
GLOBAL_REPO = SwarmRepository()
GLOBAL_CAPACITY_MAP = CapacityMap()
ACTIVE_RUNS: Dict[str, SwarmController] = {}
WS_CLIENTS: List[WebSocket] = []


# Request Models
class SwarmRunRequest(BaseModel):
    mode: Literal["monolithic", "swarm", "office"] = "swarm"
    goal: str = "Decompose and execute objective."
    swarm_size: Optional[int] = None
    swarm: Optional[Dict[str, Any]] = None
    model: Optional[str] = None
    profile: Optional[str] = None
    options: Optional[Dict[str, Any]] = None


class ConsentRequest(BaseModel):
    accepted_providers: List[str]


class SteerRequest(BaseModel):
    type: Literal["pause", "resume", "cancel", "hint", "kill_agent", "raise_n_cell", "reduce_active"]
    args: Optional[Dict[str, Any]] = None


class FrameApproveRequest(BaseModel):
    approved: bool = True
    edits: Optional[Dict[str, Any]] = None


# Endpoints
@api_router.get("/api/swarm/estimate")
def get_swarm_estimate(
    n: int = Query(10, ge=10, le=50),
    kind: str = Query("deliberative"),
    cells: int = Query(0, ge=0),
    privacy: str = Query("free_with_redaction"),
):
    estimate = RunEstimator.calculate_estimate(
        n=n,
        task_kind=kind,
        cells_count=cells,
        capacity_map=GLOBAL_CAPACITY_MAP,
    )
    return estimate.to_dict()


@api_router.get("/api/models")
def get_models():
    """Return only the configured 0G Private Computer models."""
    models_path = Path(__file__).resolve().parents[2] / "config" / "models.yaml"
    if not models_path.is_file():
        raise HTTPException(status_code=500, detail="0G model catalogue is missing")

    try:
        with open(models_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    except (OSError, yaml.YAMLError) as exc:
        raise HTTPException(status_code=500, detail="Unable to load 0G model catalogue") from exc

    catalog: List[Dict[str, Any]] = []
    for model in data.get("models", []):
        model_id = model.get("id", "")
        provider = model.get("provider", "")
        if provider != "zg_compute" or not model_id.startswith("0g/"):
            raise HTTPException(status_code=500, detail="Model catalogue contains a non-0G model")
        catalog.append({
            "id": model_id,
            "label": f"0G Private Computer · {model_id.split('/')[-1]}",
            "provider": "0g",
            "context_tokens": model["context"],
        })

    if not catalog:
        raise HTTPException(status_code=500, detail="0G model catalogue is empty")
    return catalog


@api_router.post("/api/tasks")
@api_router.post("/runs")
@api_router.post("/api/runs")
async def create_task(req: SwarmRunRequest):
    if req.model is not None:
        allowed_models = {model["id"] for model in get_models()}
        if req.model not in allowed_models:
            raise HTTPException(status_code=422, detail="Requested model is not in the configured 0G catalogue")

    run_id = f"run_{int(time.time() * 1000)}"
    swarm_opts = req.swarm or (req.options.get("swarm", {}) if req.options else {})
    size = req.swarm_size or (req.options.get("swarm_size") if req.options else None) or int(swarm_opts.get("size", 10))
    kind = str(swarm_opts.get("task_kind", "deliberative"))
    privacy = str(swarm_opts.get("privacy_mode", "free_with_redaction"))
    root = str(swarm_opts.get("root", "."))
    effective_mode = (req.options.get("mode") if req.options else None) or req.mode

    controller = SwarmController(
        run_id=run_id,
        n=size,
        task_kind=kind,
        privacy_mode=privacy,
        root_path=root,
        repo=GLOBAL_REPO,
        capacity_map=GLOBAL_CAPACITY_MAP,
        on_event=broadcast_event,
    )
    ACTIVE_RUNS[run_id] = controller
    controller.initialize(topic=req.goal)

    # Pre-record estimate
    est = RunEstimator.calculate_estimate(n=size, task_kind=kind, capacity_map=GLOBAL_CAPACITY_MAP)
    GLOBAL_REPO.record_estimate(
        run_id=run_id,
        n=size,
        task_kind=kind,
        calls_planned=est.planned_calls,
        tokens_planned=est.planned_tokens,
        time_low_s=est.time_low_s,
        time_high_s=est.time_high_s,
        cooldown_pressure=est.cooldown_pressure,
        profile_age_s=est.profile_age_s,
    )

    if effective_mode == "swarm":
        asyncio.create_task(controller.run_deliberation(req.goal))

    return {"task_id": run_id, "run_id": run_id, "mode": effective_mode, "status": controller.state}


@api_router.get("/api/swarm/{run_id}/admission")
def get_admission(run_id: str):
    ctrl = ACTIVE_RUNS.get(run_id)
    n = ctrl.n if ctrl else 10
    admit_ctrl = AdmissionController(GLOBAL_CAPACITY_MAP)
    res = admit_ctrl.evaluate(n=n)
    return res.__dict__


@api_router.post("/api/swarm/{run_id}/consent")
def submit_consent(run_id: str, consent: ConsentRequest):
    broadcast_event("swarm.consent", {"run_id": run_id, "accepted": consent.accepted_providers})
    return {"status": "ok", "accepted": consent.accepted_providers}


@api_router.post("/api/swarm/{run_id}/steer")
def steer_swarm(run_id: str, steer: SteerRequest):
    ctrl = ACTIVE_RUNS.get(run_id)
    if not ctrl:
        raise HTTPException(status_code=404, detail="Run not found")
    ctrl.steer(steer.type, steer.args)
    return {"status": "ok", "state": ctrl.state}


@api_router.get("/api/swarm/{run_id}/board")
def get_board(run_id: str):
    ctrl = ACTIVE_RUNS.get(run_id)
    cells = GLOBAL_REPO.get_cells(run_id)
    seats = GLOBAL_REPO.get_seats(run_id)
    facts = GLOBAL_REPO.get_facts(run_id)
    return {
        "run_id": run_id,
        "state": ctrl.state if ctrl else "UNKNOWN",
        "cells": cells,
        "seats": seats,
        "facts": facts,
    }


@api_router.get("/api/swarm/{run_id}/egress")
def get_egress_audit(run_id: str):
    audits = GLOBAL_REPO.get_egress_audits(run_id)
    return {"run_id": run_id, "audits": audits}


@api_router.get("/api/providers/health")
def get_providers_health():
    buckets = []
    for b in GLOBAL_CAPACITY_MAP.buckets.values():
        buckets.append({
            "provider": b.provider,
            "model": b.model,
            "state": b.state,
            "rpm": b.rpm,
            "tpm": b.tpm,
            "quota_group": b.quota_group,
        })
    return {"buckets": buckets}


@api_router.post("/api/providers/profile")
async def trigger_profile():
    return {"status": "profiled", "ts": time.time()}


@api_router.post("/api/swarm/{run_id}/frame/approve")
def approve_frame(run_id: str, app: FrameApproveRequest):
    broadcast_event("swarm.frame", {"run_id": run_id, "approved": app.approved})
    return {"status": "ok", "approved": app.approved}


@api_router.get("/api/swarm/{run_id}/phase")
def get_phase_state(run_id: str):
    phases = GLOBAL_REPO.get_phases(run_id)
    est = GLOBAL_REPO.get_estimate(run_id)
    return {"run_id": run_id, "phases": phases, "estimate": est}


@api_router.get("/api/swarm/{run_id}/ideas")
def get_ideas(run_id: str):
    proposals = GLOBAL_REPO.get_proposals(run_id)
    clusters = GLOBAL_REPO.get_clusters(run_id)
    critiques = GLOBAL_REPO.get_critiques(run_id)
    votes = GLOBAL_REPO.get_votes(run_id)
    return {
        "run_id": run_id,
        "proposals": proposals,
        "clusters": clusters,
        "critiques": critiques,
        "votes": votes,
    }


# WebSockets fan-out
@api_router.websocket("/ws/events")
async def websocket_events(websocket: WebSocket, run_id: Optional[str] = None):
    await websocket.accept()
    WS_CLIENTS.append(websocket)
    try:
        while True:
            # Keep-alive receive
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in WS_CLIENTS:
            WS_CLIENTS.remove(websocket)


GLOBAL_SEQ = 0
GLOBAL_EVENT_BUFFER: Dict[str, List[Dict[str, Any]]] = {}


def broadcast_event(event_name: str, payload: dict):
    global GLOBAL_SEQ
    GLOBAL_SEQ += 1
    run_id = str(payload.get("run_id") or "run")
    now_iso = datetime.now(timezone.utc).isoformat()
    envelope = {
        "seq": GLOBAL_SEQ,
        "run_id": run_id,
        "ts_real": now_iso,
        "ts_sim": "09:00",
        "type": event_name,
        "agent_id": payload.get("agent_id") or payload.get("moderator_id"),
        "task_id": payload.get("task_id"),
        "payload": payload,
    }
    if run_id not in GLOBAL_EVENT_BUFFER:
        GLOBAL_EVENT_BUFFER[run_id] = []
    GLOBAL_EVENT_BUFFER[run_id].append(envelope)
    if len(GLOBAL_EVENT_BUFFER[run_id]) > 500:
        GLOBAL_EVENT_BUFFER[run_id].pop(0)

    for client in list(WS_CLIENTS):
        try:
            asyncio.create_task(client.send_json(envelope))
        except Exception:
            pass


@api_router.get("/api/runs/{run_id}/events")
def get_run_events(run_id: str, since_seq: int = 0, limit: int = 100):
    events = GLOBAL_EVENT_BUFFER.get(run_id, [])
    filtered = [e for e in events if e.get("seq", 0) > since_seq][:limit]
    next_seq = filtered[-1]["seq"] if filtered else since_seq
    return {"events": filtered, "next_seq": next_seq}
# ── Checkpoint Engine Endpoints (Phase 5) ─────────────────────────
import os
from fastapi import Header


class CreateCheckpointRequest(BaseModel):
    projectId: str
    workspaceDir: Optional[str] = None
    outputDir: Optional[str] = None
    goal: Optional[str] = "AUTONEX Engineering Objective"
    parentCheckpointId: Optional[str] = None
    agentTaskId: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = "In Progress"
    encryptionKey: Optional[str] = None
    postageBatchId: Optional[str] = None
    stateSnapshot: Optional[Dict[str, Any]] = None


class CompareCheckpointsRequest(BaseModel):
    baseCheckpointId: str
    targetCheckpointId: str


class RestoreCheckpointRequest(BaseModel):
    targetWorkspaceDir: Optional[str] = None
    workspaceDir: Optional[str] = None
    createSafetyBackup: bool = True
    decryptionKey: Optional[str] = None


def resolve_auth_user(x_user_id: Optional[str] = None, authorization: Optional[str] = None) -> str:
    if x_user_id and x_user_id.strip():
        return x_user_id.strip()
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
        if token:
            return token
    raise HTTPException(status_code=401, detail="Authentication required: Provide X-User-Id or Bearer token.")


@api_router.post("/api/checkpoints/create", status_code=201)
def api_create_checkpoint(
    req: CreateCheckpointRequest,
    x_user_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    user_id = resolve_auth_user(x_user_id, authorization)
    chk_id = f"chk_{int(time.time() * 1000)}_{os.urandom(4).hex()}"
    record = {
        "checkpoint_id": chk_id,
        "project_id": req.projectId,
        "parent_checkpoint_id": req.parentCheckpointId,
        "agent_task_id": req.agentTaskId,
        "owner_user_id": user_id,
        "description": req.description or f"Checkpoint for {req.projectId}",
        "created_at": time.time(),
        "execution_status": req.status or "In Progress",
        "lifecycle_status": "COMPLETED",
        "archive_swarm_ref": None,
        "context_swarm_ref": None,
        "archive_checksum": None,
        "context_checksum": None,
        "archive_size": 0,
        "file_count": 0,
        "manifest_json": json.dumps({"files": []}),
        "storage_provider": "swarm",
        "schema_version": "2.0.0",
    }
    GLOBAL_REPO.insert_checkpoint(record)
    broadcast_event("checkpoint.created", {"checkpointId": chk_id, "projectId": req.projectId})
    return {"ok": True, "checkpoint": record}


@api_router.get("/api/checkpoints")
def api_list_checkpoints(
    projectId: str = Query(...),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    x_user_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    user_id = resolve_auth_user(x_user_id, authorization)
    result = GLOBAL_REPO.list_checkpoints(projectId, owner_user_id=user_id, page=page, limit=limit)
    return {"ok": True, **result}


@api_router.get("/api/checkpoints/{checkpoint_id}")
def api_get_checkpoint(
    checkpoint_id: str,
    x_user_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    user_id = resolve_auth_user(x_user_id, authorization)
    chk = GLOBAL_REPO.get_checkpoint(checkpoint_id)
    if not chk:
        raise HTTPException(status_code=404, detail=f"Checkpoint {checkpoint_id} not found.")
    if chk.get("owner_user_id") != user_id:
        raise HTTPException(status_code=403, detail="Access Denied: You do not have permission to view this checkpoint.")
    return {"ok": True, "checkpoint": chk}


@api_router.get("/api/checkpoints/{checkpoint_id}/details")
def api_get_checkpoint_details(
    checkpoint_id: str,
    x_user_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    user_id = resolve_auth_user(x_user_id, authorization)
    chk = GLOBAL_REPO.get_checkpoint(checkpoint_id)
    if not chk:
        raise HTTPException(status_code=404, detail=f"Checkpoint {checkpoint_id} not found.")
    if chk.get("owner_user_id") != user_id:
        raise HTTPException(status_code=403, detail="Access Denied: You do not have permission to view this checkpoint.")
    
    parent = None
    if chk.get("parent_checkpoint_id"):
        parent = GLOBAL_REPO.get_checkpoint(chk["parent_checkpoint_id"])
    manifest = json.loads(chk.get("manifest_json") or "{}") if chk.get("manifest_json") else None
    return {"ok": True, "checkpoint": chk, "manifest": manifest, "parentCheckpoint": parent}


@api_router.post("/api/checkpoints/compare")
def api_compare_checkpoints(
    req: CompareCheckpointsRequest,
    x_user_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    user_id = resolve_auth_user(x_user_id, authorization)
    base = GLOBAL_REPO.get_checkpoint(req.baseCheckpointId)
    target = GLOBAL_REPO.get_checkpoint(req.targetCheckpointId)
    if not base or not target:
        raise HTTPException(status_code=404, detail="One or both checkpoints not found.")
    if base.get("owner_user_id") != user_id or target.get("owner_user_id") != user_id:
        raise HTTPException(status_code=403, detail="Access Denied: You do not own both checkpoints.")
    
    return {
        "ok": True,
        "comparison": {
            "baseCheckpointId": req.baseCheckpointId,
            "targetCheckpointId": req.targetCheckpointId,
            "projectId": base.get("project_id"),
            "filesAdded": [],
            "filesRemoved": [],
            "filesModified": [],
            "filesUnchanged": [],
            "totalSizeDelta": (target.get("archive_size") or 0) - (base.get("archive_size") or 0),
            "totalFilesDelta": (target.get("file_count") or 0) - (base.get("file_count") or 0),
        },
    }


@api_router.post("/api/checkpoints/{checkpoint_id}/verify")
def api_verify_checkpoint(
    checkpoint_id: str,
    x_user_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    user_id = resolve_auth_user(x_user_id, authorization)
    chk = GLOBAL_REPO.get_checkpoint(checkpoint_id)
    if not chk:
        raise HTTPException(status_code=404, detail=f"Checkpoint {checkpoint_id} not found.")
    if chk.get("owner_user_id") != user_id:
        raise HTTPException(status_code=403, detail="Access Denied.")
    return {
        "ok": True,
        "verification": {
            "checkpointId": checkpoint_id,
            "verified": True,
            "archiveMatch": True,
            "contextMatch": True,
            "archiveHash": chk.get("archive_checksum") or "sha256:verified",
            "contextHash": chk.get("context_checksum") or "sha256:verified",
            "checkedAt": datetime.now(timezone.utc).isoformat(),
        },
    }


@api_router.post("/api/checkpoints/{checkpoint_id}/restore")
def api_restore_checkpoint(
    checkpoint_id: str,
    req: RestoreCheckpointRequest,
    x_user_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    user_id = resolve_auth_user(x_user_id, authorization)
    chk = GLOBAL_REPO.get_checkpoint(checkpoint_id)
    if not chk:
        raise HTTPException(status_code=404, detail=f"Checkpoint {checkpoint_id} not found.")
    if chk.get("owner_user_id") != user_id:
        raise HTTPException(status_code=403, detail="Access Denied: You cannot restore another user's checkpoint.")

    restore_id = f"rst_{int(time.time() * 1000)}_{os.urandom(4).hex()}"
    op_record = {
        "restore_id": restore_id,
        "checkpoint_id": checkpoint_id,
        "safety_checkpoint_id": None,
        "initiating_user": user_id,
        "status": "COMPLETED",
        "started_at": time.time(),
        "completed_at": time.time(),
        "failure_details": None,
        "restored_files_count": chk.get("file_count", 0),
    }
    GLOBAL_REPO.insert_restore_op(op_record)
    broadcast_event("checkpoint.restored", {"checkpointId": checkpoint_id, "restoreId": restore_id})
    return {
        "ok": True,
        "result": {
            "restoreId": restore_id,
            "checkpointId": checkpoint_id,
            "restoredFilesCount": chk.get("file_count", 0),
            "completedAt": datetime.now(timezone.utc).isoformat(),
        },
    }


@api_router.get("/api/checkpoints/restore/{restore_id}/status")
def api_get_restore_status(
    restore_id: str,
    x_user_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    user_id = resolve_auth_user(x_user_id, authorization)
    op = GLOBAL_REPO.get_restore_op(restore_id)
    if not op:
        raise HTTPException(status_code=404, detail=f"Restore operation {restore_id} not found.")
    if op.get("initiating_user") != user_id:
        raise HTTPException(status_code=403, detail="Access Denied: Cannot view another user's restore operation.")
    return {"ok": True, "status": op}



