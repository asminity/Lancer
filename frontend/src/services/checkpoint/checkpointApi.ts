/**
 * AUTONEX Checkpoint Engine: HTTP API Handlers & Client Layer (Phase 5)
 *
 * Implements authenticated endpoints following AUTONEX API contracts:
 * 1. POST /api/checkpoints/create
 * 2. GET  /api/checkpoints?projectId=...
 * 3. GET  /api/checkpoints/:checkpointId
 * 4. GET  /api/checkpoints/:checkpointId/details
 * 5. POST /api/checkpoints/compare
 * 6. POST /api/checkpoints/:checkpointId/verify
 * 7. POST /api/checkpoints/:checkpointId/restore
 * 8. GET  /api/checkpoints/restore/:restoreId/status
 *
 * Enforces ownership authorization: User A cannot list, view, or restore User B's checkpoint.
 */

import { CheckpointService } from './checkpointService';

export interface ApiRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
}

export interface ApiResponse {
  status: number;
  data: any;
}

export class CheckpointApiHandler {
  private service: CheckpointService;

  constructor(service: CheckpointService) {
    this.service = service;
  }

  /**
   * Extracts authenticated user ID from request headers.
   */
  private getAuthenticatedUserId(req: ApiRequest): string {
    const headers = req.headers || {};
    const userId = headers['x-user-id'] || headers['X-User-Id'];
    if (userId) return userId.trim();

    const authHeader = headers['authorization'] || headers['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }

    throw new Error('Unauthorized: Authentication required. Please provide X-User-Id or Bearer token.');
  }

  /**
   * Dispatches an incoming HTTP request to the appropriate controller method.
   */
  public async handleRequest(req: ApiRequest): Promise<ApiResponse> {
    try {
      const { method, path: reqPath } = req;
      const cleanPath = reqPath.split('?')[0];

      // 1. POST /api/checkpoints/create
      if (method === 'POST' && cleanPath === '/api/checkpoints/create') {
        const userId = this.getAuthenticatedUserId(req);
        const body = req.body || {};
        const checkpoint = await this.service.createCheckpoint({
          projectId: body.projectId,
          ownerUserId: userId,
          workspaceDir: body.workspaceDir || body.outputDir,
          goal: body.goal || 'AUTONEX Objective',
          parentCheckpointId: body.parentCheckpointId,
          agentTaskId: body.agentTaskId,
          description: body.description,
          executionStatus: body.status || 'In Progress',
          encryptionKey: body.encryptionKey,
          postageBatchId: body.postageBatchId,
          stateSnapshot: body.stateSnapshot,
        });
        return { status: 201, data: { ok: true, checkpoint } };
      }

      // 2. GET /api/checkpoints
      if (method === 'GET' && cleanPath === '/api/checkpoints') {
        const userId = this.getAuthenticatedUserId(req);
        const projectId = req.query?.projectId || '';
        const page = req.query?.page ? Number(req.query.page) : 1;
        const limit = req.query?.limit ? Number(req.query.limit) : 20;

        const paginated = this.service.listCheckpoints(projectId, userId, { page, limit });
        return { status: 200, data: { ok: true, ...paginated } };
      }

      // 3. POST /api/checkpoints/compare
      if (method === 'POST' && cleanPath === '/api/checkpoints/compare') {
        const userId = this.getAuthenticatedUserId(req);
        const { baseCheckpointId, targetCheckpointId } = req.body || {};
        const comparison = this.service.compareCheckpoints(baseCheckpointId, targetCheckpointId, userId);
        return { status: 200, data: { ok: true, comparison } };
      }

      // 4. GET /api/checkpoints/restore/:restoreId/status
      const restoreStatusMatch = cleanPath.match(/^\/api\/checkpoints\/restore\/([^/]+)\/status$/);
      if (method === 'GET' && restoreStatusMatch) {
        const userId = this.getAuthenticatedUserId(req);
        const restoreId = restoreStatusMatch[1];
        const status = this.service.getRestoreStatus(restoreId, userId);
        return { status: 200, data: { ok: true, status } };
      }

      // 5. GET /api/checkpoints/:checkpointId/details
      const detailsMatch = cleanPath.match(/^\/api\/checkpoints\/([^/]+)\/details$/);
      if (method === 'GET' && detailsMatch) {
        const userId = this.getAuthenticatedUserId(req);
        const checkpointId = detailsMatch[1];
        const details = this.service.getCheckpointDetails(checkpointId, userId);
        return { status: 200, data: { ok: true, details } };
      }

      // 6. POST /api/checkpoints/:checkpointId/verify
      const verifyMatch = cleanPath.match(/^\/api\/checkpoints\/([^/]+)\/verify$/);
      if (method === 'POST' && verifyMatch) {
        const userId = this.getAuthenticatedUserId(req);
        const checkpointId = verifyMatch[1];
        const verification = await this.service.verifyCheckpoint(checkpointId, userId);
        return { status: 200, data: { ok: true, verification } };
      }

      // 7. POST /api/checkpoints/:checkpointId/restore
      const restoreMatch = cleanPath.match(/^\/api\/checkpoints\/([^/]+)\/restore$/);
      if (method === 'POST' && restoreMatch) {
        const userId = this.getAuthenticatedUserId(req);
        const checkpointId = restoreMatch[1];
        const body = req.body || {};
        const result = await this.service.restoreCheckpoint({
          checkpointId,
          requestingUserId: userId,
          targetWorkspaceDir: body.targetWorkspaceDir || body.workspaceDir,
          createSafetyBackup: body.createSafetyBackup ?? true,
          decryptionKey: body.decryptionKey,
        });
        return { status: 200, data: { ok: true, result } };
      }

      // 8. GET /api/checkpoints/:checkpointId
      const singleMatch = cleanPath.match(/^\/api\/checkpoints\/([^/]+)$/);
      if (method === 'GET' && singleMatch) {
        const userId = this.getAuthenticatedUserId(req);
        const checkpointId = singleMatch[1];
        const checkpoint = this.service.getCheckpoint(checkpointId, userId);
        return { status: 200, data: { ok: true, checkpoint } };
      }

      return { status: 404, data: { error: `Endpoint not found: ${method} ${cleanPath}` } };
    } catch (err: any) {
      const msg = err?.message || 'Internal server error';
      const status = msg.includes('Unauthorized') ? 401 : (msg.includes('Access Denied') ? 403 : (msg.includes('not found') ? 404 : 400));
      return { status, data: { ok: false, error: msg } };
    }
  }
}

