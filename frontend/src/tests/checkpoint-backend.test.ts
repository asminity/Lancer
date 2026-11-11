/**
 * AUTONEX Checkpoint Engine: Metadata, Database & Backend APIs Tests (Phase 5)
 *
 * Verifies:
 * 1. Multiple projects and multiple users isolation
 * 2. Strict checkpoint ownership and restoration authorization (User A cannot touch User B's checkpoints)
 * 3. Parent-child lineage tracking
 * 4. Duplicate request handling and concurrency protection
 * 5. Transactional lifecycle: never marks COMPLETED on partial/failed storage operations
 * 6. Authenticated REST API contracts and HTTP status codes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CheckpointDatabase,
  CheckpointService,
  CheckpointApiHandler,
} from '../services/checkpoint';
import { SwarmStorageProvider } from '../services/swarm/beeProvider';

describe('AUTONEX Checkpoint Engine: Metadata, Database & Backend APIs (Phase 5)', () => {
  let tempRoot: string;
  let workspaceDirA: string;
  let workspaceDirB: string;
  let restoreDir: string;
  let db: CheckpointDatabase;
  let swarmProvider: SwarmStorageProvider;
  let service: CheckpointService;
  let apiHandler: CheckpointApiHandler;

  const USER_ALICE = '0x1111111111111111111111111111111111111111';
  const USER_BOB = '0x2222222222222222222222222222222222222222';

  beforeEach(() => {
    vi.restoreAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autonex-phase5-'));
    workspaceDirA = path.join(tempRoot, 'workspace-alpha');
    workspaceDirB = path.join(tempRoot, 'workspace-beta');
    restoreDir = path.join(tempRoot, 'workspace-restore');

    fs.mkdirSync(workspaceDirA, { recursive: true });
    fs.mkdirSync(workspaceDirB, { recursive: true });
    fs.mkdirSync(restoreDir, { recursive: true });

    // Seed test files in workspace A
    fs.writeFileSync(path.join(workspaceDirA, 'app.py'), 'print("Alpha Project")\n');
    fs.writeFileSync(path.join(workspaceDirA, 'README.md'), '# Project Alpha\n');

    // Seed test files in workspace B
    fs.writeFileSync(path.join(workspaceDirB, 'index.ts'), 'console.log("Beta Project");\n');

    db = new CheckpointDatabase(':memory:');
    swarmProvider = new SwarmStorageProvider();

    // Mock real Bee raw uploads/downloads returning 64-char references with exact bytes stored
    const mockBee = (swarmProvider as any).bee;
    const swarmStorage = new Map<string, Uint8Array>();
    let uploadCount = 0;

    vi.spyOn(mockBee.data, 'upload').mockImplementation((async (batchId: any, data: any) => {
      uploadCount++;
      const reference = `${uploadCount}`.repeat(64).slice(0, 64);
      swarmStorage.set(reference, new Uint8Array(data));
      return { reference } as any;
    }) as any);

    vi.spyOn(mockBee.data, 'download').mockImplementation((async (reference: any) => {
      const data = swarmStorage.get(String(reference));
      if (!data) {
        throw new Error(`Reference "${reference}" not found on Swarm network`);
      }
      return {
        toUint8Array: () => data,
      } as any;
    }) as any);

    service = new CheckpointService(db, swarmProvider);
    apiHandler = new CheckpointApiHandler(service);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('1. Multiple Projects & Multiple Users Isolation: enforces project ownership boundaries', async () => {
    // Alice creates checkpoint on Project Alpha
    const chkAlice = await service.createCheckpoint({
      projectId: 'proj-alpha',
      ownerUserId: USER_ALICE,
      workspaceDir: workspaceDirA,
      goal: 'Build Alpha API',
      description: 'Alpha initial checkpoint',
      executionStatus: 'In Progress',
    });

    // Bob creates checkpoint on Project Beta
    const chkBob = await service.createCheckpoint({
      projectId: 'proj-beta',
      ownerUserId: USER_BOB,
      workspaceDir: workspaceDirB,
      goal: 'Build Beta Frontend',
      description: 'Beta initial checkpoint',
      executionStatus: 'In Progress',
    });

    expect(chkAlice.checkpointId).toBeDefined();
    expect(chkBob.checkpointId).toBeDefined();

    // Alice lists checkpoints for Alpha -> sees her checkpoint
    const aliceList = service.listCheckpoints('proj-alpha', USER_ALICE);
    expect(aliceList.total).toBe(1);
    expect(aliceList.checkpoints[0].checkpointId).toBe(chkAlice.checkpointId);

    // Bob lists checkpoints for Alpha -> sees 0 checkpoints (unauthorized)
    const bobListAlpha = service.listCheckpoints('proj-alpha', USER_BOB);
    expect(bobListAlpha.total).toBe(0);

    // Bob attempts to get Alice's checkpoint details -> fails with Access Denied
    expect(() => service.getCheckpoint(chkAlice.checkpointId, USER_BOB)).toThrow(
      /Access Denied/i
    );
  });

  it('2. Strict Restoration Authorization: User B cannot restore User A\'s checkpoint', async () => {
    const chkAlice = await service.createCheckpoint({
      projectId: 'proj-alpha',
      ownerUserId: USER_ALICE,
      workspaceDir: workspaceDirA,
      goal: 'Build Alpha API',
      executionStatus: 'Completed',
    });

    // Bob attempts to restore Alice's checkpoint -> MUST FAIL
    await expect(
      service.restoreCheckpoint({
        checkpointId: chkAlice.checkpointId,
        requestingUserId: USER_BOB,
        targetWorkspaceDir: restoreDir,
      })
    ).rejects.toThrow(/Access Denied/i);
  });

  it('3. Parent-Child Lineage: tracks lineage and rejects cross-user parent linking', async () => {
    // 1. Parent checkpoint by Alice
    const parent = await service.createCheckpoint({
      projectId: 'proj-alpha',
      ownerUserId: USER_ALICE,
      workspaceDir: workspaceDirA,
      goal: 'Milestone 1',
      description: 'Initial structure',
    });

    // 2. Child checkpoint by Alice linking to Parent
    const child = await service.createCheckpoint({
      projectId: 'proj-alpha',
      ownerUserId: USER_ALICE,
      workspaceDir: workspaceDirA,
      goal: 'Milestone 2',
      parentCheckpointId: parent.checkpointId,
      description: 'Added routing',
    });

    expect(child.parentCheckpointId).toBe(parent.checkpointId);

    const details = service.getCheckpointDetails(child.checkpointId, USER_ALICE);
    expect(details.parentCheckpoint).toBeDefined();
    expect(details.parentCheckpoint?.checkpointId).toBe(parent.checkpointId);

    // 3. Bob attempts to create a child checkpoint linking to Alice's parent -> MUST FAIL
    await expect(
      service.createCheckpoint({
        projectId: 'proj-beta',
        ownerUserId: USER_BOB,
        workspaceDir: workspaceDirB,
        goal: 'Attempted Hijack',
        parentCheckpointId: parent.checkpointId,
      })
    ).rejects.toThrow(/Cannot link to parent checkpoint belonging to another user/i);
  });

  it('4. Duplicate Request Deduplication: coalesces concurrent requests into single execution', async () => {
    const p1 = service.createCheckpoint({
      projectId: 'proj-alpha',
      ownerUserId: USER_ALICE,
      workspaceDir: workspaceDirA,
      goal: 'Build Alpha',
    });

    const p2 = service.createCheckpoint({
      projectId: 'proj-alpha',
      ownerUserId: USER_ALICE,
      workspaceDir: workspaceDirA,
      goal: 'Build Alpha',
    });

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.checkpointId).toBe(res2.checkpointId);
  });

  it('5. Transactional Integrity on Upload Failure: never marks COMPLETED if storage upload fails', async () => {
    const mockBee = (swarmProvider as any).bee;
    vi.spyOn(mockBee.data, 'upload').mockRejectedValueOnce(
      new Error('Bee node HTTP 500: Postage stamp batch out of funds')
    );

    await expect(
      service.createCheckpoint({
        projectId: 'proj-alpha',
        ownerUserId: USER_ALICE,
        workspaceDir: workspaceDirA,
        goal: 'Failure test',
      })
    ).rejects.toThrow(/Postage stamp batch out of funds/);

    const list = db.listCheckpointsByProject('proj-alpha');
    expect(list.total).toBe(1);
    expect(list.checkpoints[0].lifecycleStatus).toBe('FAILED');
    expect(list.checkpoints[0].failureReason).toContain('Postage stamp batch out of funds');
  });

  it('6. Checkpoint Comparison: calculates accurate file delta between checkpoints', async () => {
    const cp1 = await service.createCheckpoint({
      projectId: 'proj-alpha',
      ownerUserId: USER_ALICE,
      workspaceDir: workspaceDirA,
      goal: 'V1',
    });

    // Modify file and add new file
    fs.appendFileSync(path.join(workspaceDirA, 'app.py'), '# extra line\n');
    fs.writeFileSync(path.join(workspaceDirA, 'extra.txt'), 'extra file content');

    const cp2 = await service.createCheckpoint({
      projectId: 'proj-alpha',
      ownerUserId: USER_ALICE,
      workspaceDir: workspaceDirA,
      goal: 'V2',
    });

    const diff = service.compareCheckpoints(cp1.checkpointId, cp2.checkpointId, USER_ALICE);

    expect(diff.filesAdded).toContain('extra.txt');
    expect(diff.filesModified).toContain('app.py');
    expect(diff.filesUnchanged).toContain('README.md');
    expect(diff.totalFilesDelta).toBe(1);
  });

  it('7. HTTP API Contracts: enforces authentication, ownership, and proper response structures', async () => {
    // 1. Unauthenticated request -> returns 401
    const unauthRes = await apiHandler.handleRequest({
      method: 'POST',
      path: '/api/checkpoints/create',
      body: { projectId: 'proj-alpha', workspaceDir: workspaceDirA },
    });
    expect(unauthRes.status).toBe(401);
    expect(unauthRes.data.ok).toBe(false);

    // 2. Authenticated POST /api/checkpoints/create -> returns 201
    const createRes = await apiHandler.handleRequest({
      method: 'POST',
      path: '/api/checkpoints/create',
      headers: { 'X-User-Id': USER_ALICE },
      body: {
        projectId: 'proj-alpha',
        workspaceDir: workspaceDirA,
        goal: 'API Test Checkpoint',
      },
    });
    expect(createRes.status).toBe(201);
    expect(createRes.data.ok).toBe(true);
    const checkpointId = createRes.data.checkpoint.checkpointId;

    // 3. GET /api/checkpoints?projectId=proj-alpha -> returns 200
    const listRes = await apiHandler.handleRequest({
      method: 'GET',
      path: '/api/checkpoints',
      headers: { 'X-User-Id': USER_ALICE },
      query: { projectId: 'proj-alpha' },
    });
    expect(listRes.status).toBe(200);
    expect(listRes.data.checkpoints.length).toBeGreaterThan(0);

    // 4. GET /api/checkpoints/:checkpointId -> returns 200 for Alice, 403 for Bob
    const getAliceRes = await apiHandler.handleRequest({
      method: 'GET',
      path: `/api/checkpoints/${checkpointId}`,
      headers: { 'X-User-Id': USER_ALICE },
    });
    expect(getAliceRes.status).toBe(200);

    const getBobRes = await apiHandler.handleRequest({
      method: 'GET',
      path: `/api/checkpoints/${checkpointId}`,
      headers: { 'X-User-Id': USER_BOB },
    });
    expect(getBobRes.status).toBe(403);
  });
});
