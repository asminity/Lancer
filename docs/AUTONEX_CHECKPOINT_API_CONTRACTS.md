# AUTONEX Checkpoint Engine: API Contracts & Interface Specification

**Document Version:** 1.0.0  
**Status:** Approved Specification Draft (Phase 1)  
**Author:** AUTONEX Core Architecture Group  
**Target Feature:** `AUTONEX_CHECKPOINT_ENGINE`  
**Compliance:** Global Development Rules 1–10  

---

## 1. Overview & Protocol Architecture

All Checkpoint Engine operations communicate via two channels following existing AUTONEX conventions:
1. **HTTP REST API:** Synchronous management, diff generation, and transaction coordination hosted on the Bridge server (default port: `8000`).
2. **WebSocket Event Stream (`/ws/events`):** Asynchronous telemetry and progress updates broadcast to all connected frontend clients.
3. **Arkiv Rabdi DB-Chain RPC:** Direct EIP-1193 / Viem JSON-RPC calls for on-chain proof anchoring and zero-gas queries.

---

## 2. HTTP REST Endpoints

### 2.1 Create Checkpoint
Creates a complete workspace binary archive (TAR + Zstandard) and AI context snapshot, uploads both to Ethereum Swarm, and returns the metadata ready for on-chain anchoring.

- **Route:** `POST /api/checkpoints/create`
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "projectId": "biryani-app-spa",
    "goal": "create spa and summary of biryani app",
    "outputDir": "D:\\AUTONEX\\output\\BiryaniAppSPA",
    "status": "completed",
    "incidentInfo": {
      "error": "Optional 0G exception text if triggered by failover",
      "requestId": "47fe2489886d5d85",
      "failedAgent": "W_backend_0",
      "recoveryAgent": "W_qa_0"
    },
    "encryptionKey": "optional-client-derived-hex-key"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "ok": true,
    "checkpoint": {
      "checkpointId": "chk_mw5k9a1b_8f2",
      "projectId": "biryani-app-spa",
      "timestamp": "2026-11-06T20:45:00.000Z",
      "status": "completed",
      "archive": {
        "swarmReference": "4c84a72d40029bf0766b28f2931dccf05183ba49a882a86a63447781bca6f2a1",
        "contentHash": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "byteSize": 18450,
        "compressionRatio": 0.38,
        "fileCount": 3
      },
      "context": {
        "swarmReference": "25d386560d049a7f7255fb8390afbffa4072b32ec69f1092a4cf8a483a99bb84",
        "contentHash": "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
        "byteSize": 8420
      },
      "manifest": [
        { "path": "backend/app.py", "size": 3410, "sha256": "sha256:9a..." },
        { "path": "frontend/index.html", "size": 1890, "sha256": "sha256:1b..." },
        { "path": "README.md", "size": 940, "sha256": "sha256:3c..." }
      ],
      "exclusions": [
        { "path": ".env", "rule": "secrets_exclusion", "size": 140 },
        { "path": "node_modules", "rule": "dependencies_exclusion", "size": 45000000 }
      ],
      "encryption": {
        "enabled": true,
        "algorithm": "AES-256-GCM",
        "archiveIV": "a1b2c3d4e5f6...",
        "contextIV": "f6e5d4c3b2a1...",
        "authTag": "d1e2f3..."
      }
    }
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: `{ "error": "Invalid output directory or project not found", "code": "INVALID_WORKSPACE" }`
  - `502 Bad Gateway`: `{ "error": "Swarm Bee node upload failed: Postage batch expired", "code": "SWARM_UPLOAD_ERROR" }`

---

### 2.2 List Project Checkpoints
Returns all local and on-chain indexed checkpoints for a given project.

- **Route:** `GET /api/checkpoints?projectId=biryani-app-spa`
- **Response (200 OK):**
  ```json
  {
    "projectId": "biryani-app-spa",
    "checkpoints": [
      {
        "checkpointId": "chk_mw5k9a1b_8f2",
        "timestamp": "2026-11-06T20:45:00.000Z",
        "status": "completed",
        "fileCount": 3,
        "archiveSize": 18450,
        "swarmArchiveRef": "4c84a72d...",
        "swarmContextRef": "25d38656...",
        "arkivTxHash": "0x5acfb8fced3f2d...",
        "arkivEntityKey": "0xb0e3b393539bf2..."
      }
    ]
  }
  ```

---

### 2.3 Inspect Checkpoint Diff
Calculates the file-level and text-level delta between the current workspace on disk and the specified checkpoint without modifying workspace files.

- **Route:** `GET /api/checkpoints/:checkpointId/diff`
- **Response (200 OK):**
  ```json
  {
    "checkpointId": "chk_mw5k9a1b_8f2",
    "currentWorkspace": "D:\\AUTONEX\\output\\BiryaniAppSPA",
    "summary": {
      "filesChanged": 2,
      "filesAdded": 0,
      "filesDeleted": 1,
      "linesAdded": 15,
      "linesDeleted": 8
    },
    "diffs": [
      {
        "path": "backend/app.py",
        "status": "modified",
        "unifiedDiff": "--- current/backend/app.py\n+++ checkpoint/backend/app.py\n@@ -12,4 +12,6 @@\n-def order_biryani():\n+def order_biryani(spiciness: int):\n+    validate_spiciness(spiciness)"
      },
      {
        "path": "temp_notes.txt",
        "status": "deleted",
        "unifiedDiff": "--- current/temp_notes.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-scratchpad notes"
      }
    ]
  }
  ```

---

### 2.4 Restore Checkpoint
Executes atomic restoration: creates a safety backup, downloads and verifies the archive from Swarm, unpacks into isolated staging, swaps into the project directory, and broadcasts state restoration.

- **Route:** `POST /api/checkpoints/:checkpointId/restore`
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "confirm": true,
    "createSafetyBackup": true,
    "decryptionKey": "optional-client-derived-hex-key"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "ok": true,
    "message": "Checkpoint restored successfully",
    "checkpointId": "chk_mw5k9a1b_8f2",
    "restoredFilesCount": 3,
    "workspacePath": "D:\\AUTONEX\\output\\BiryaniAppSPA",
    "safetyBackupPath": "D:\\AUTONEX\\output\\.autonex_backup_20261106_205012",
    "context": {
      "runId": "run_mw4xekry",
      "tasksRestored": 3,
      "simClock": "09:47",
      "notesRestored": 14
    }
  }
  ```

---

### 2.5 Swarm Node Health & Postage Batch Status
Inspects the configured Ethereum Swarm Bee node connectivity and postage stamp capacity.

- **Route:** `GET /api/swarm/status`
- **Response (200 OK):**
  ```json
  {
    "connected": true,
    "gatewayUrl": "http://127.0.0.1:1633",
    "version": "2.4.0",
    "postageBatch": {
      "id": "7b58c7e923...",
      "valid": true,
      "utilization": 0.42,
      "depth": 17,
      "bucketDepth": 16,
      "immutable": false,
      "remainingSeconds": 864000
    }
  }
  ```

---

## 3. WebSocket Event Stream Contracts

All checkpoint actions emit real-time events over `ws://localhost:8000/ws/events`.

### 3.1 Event: `checkpoint.created`
Broadcast when a checkpoint is successfully compressed, uploaded to Swarm, and ready for on-chain anchoring.
```json
{
  "seq": 142,
  "run_id": "run_mw4xekry",
  "ts_real": "2026-11-06T20:45:00.000Z",
  "ts_sim": "09:48",
  "type": "checkpoint.created",
  "payload": {
    "checkpointId": "chk_mw5k9a1b_8f2",
    "projectId": "biryani-app-spa",
    "swarmArchiveRef": "4c84a72d40029bf0...",
    "swarmContextRef": "25d386560d049a7f...",
    "fileCount": 3,
    "archiveSize": 18450
  }
}
```

### 3.2 Event: `checkpoint.restoring`
Broadcast when an atomic restore process begins and workspace write locks are engaged.
```json
{
  "seq": 143,
  "run_id": "run_mw4xekry",
  "ts_real": "2026-11-06T20:50:01.000Z",
  "ts_sim": "09:48",
  "type": "checkpoint.restoring",
  "payload": {
    "checkpointId": "chk_mw5k9a1b_8f2",
    "phase": "downloading_and_verifying"
  }
}
```

### 3.3 Event: `checkpoint.restored`
Broadcast when archive extraction succeeds, files are atomically swapped, and the store is hydrated with the checkpoint context.
```json
{
  "seq": 144,
  "run_id": "run_mw4xekry",
  "ts_real": "2026-11-06T20:50:05.000Z",
  "ts_sim": "09:48",
  "type": "checkpoint.restored",
  "payload": {
    "checkpointId": "chk_mw5k9a1b_8f2",
    "restoredFilesCount": 3,
    "files": ["backend/app.py", "frontend/index.html", "README.md"],
    "contextSnapshot": { ... }
  }
}
```

---

## 4. Arkiv Rabdi DB-Chain Schema Definition

```typescript
import { defineSchema, str, addr, u64, bytes } from '@arkiv-network/sdk';

export const CheckpointV2Schema = defineSchema('autonex.checkpoint_v2', {
  checkpoint_id: str().indexed(),
  project_id: str().indexed(),
  owner: addr().indexed(),
  run_id: str().indexed(),
  status: str().indexed(),
  created_at: u64().indexed(),
  swarm_archive_ref: str().indexed(),
  archive_sha256: str().indexed(),
  archive_bytes_size: u64(),
  swarm_context_ref: str().indexed(),
  context_sha256: str().indexed(),
  context_bytes_size: u64(),
  encryption_iv: str(),
  cipher_auth_tag: str(),
  file_count: u64(),
  summary_text: str(),
  manifest_json: bytes(),
});
```

