/**
 * AUTONEX Checkpoint Engine: Full Production Restoration & Recovery Tests (Phase 6)
 *
 * Implements the 16-step production test scenario:
 * 1. Create CP-001
 * 2. Modify 5 source files
 * 3. Create CP-002
 * 4. Modify 10 additional source files
 * 5. Create CP-003
 * 6. Modify files again
 * 7. Restart the backend (instantiate fresh CheckpointService with DB)
 * 8. Select CP-002
 * 9. Retrieve actual Swarm archive
 * 10. Restore CP-002
 * 11. Compare restored files against CP-002's manifest
 * 12. Verify exact file hashes
 * 13. Verify restored AI context
 * 14. Verify files are actual editable source code
 * 15. Confirm newer checkpoints (CP-003) still exist
 * 16. Restore safety checkpoint to verify rollback recovery
 *
 * Plus: Corrupted archive detection and lock conflict prevention.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CheckpointDatabase,
  CheckpointService,
} from '../services/checkpoint';
import { SwarmStorageProvider } from '../services/swarm/beeProvider';
import { calculateSHA256 } from '../services/checkpoint/crypto';
import { useStore } from '../state/store';
import type { CheckpointManifest } from '../services/checkpoint/types';

describe('AUTONEX Checkpoint Engine: Restoration and Recovery Engine (Phase 6)', () => {
  let tempRoot: string;
  let workspaceDir: string;
  let dbFile: string;
  let db: CheckpointDatabase;
  let swarmProvider: SwarmStorageProvider;
  let service: CheckpointService;

  const USER_ID = '0x1234567890123456789012345678901234567890';
  const PROJECT_ID = 'proj-dex-orderbook';
  const TEST_KEY = 'autonex-production-symm-key-32b!';

  // In-memory swarm storage simulator mirroring real Bee node storage
  const swarmNetwork = new Map<string, Uint8Array>();
  let uploadCounter = 0;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autonex-restore-test-'));
    workspaceDir = path.join(tempRoot, 'active-workspace');
    dbFile = path.join(tempRoot, 'checkpoint_meta.db');

    fs.mkdirSync(workspaceDir, { recursive: true });

    db = new CheckpointDatabase(dbFile);
    swarmProvider = new SwarmStorageProvider();

    // Mirror real Bee SDK operations:
    // Raw binary byte storage returning deterministic 64-hex references
    const mockBee = (swarmProvider as any).bee;
    vi.spyOn(mockBee.data, 'upload').mockImplementation((async (_batchId: any, data: Uint8Array) => {
      uploadCounter++;
      const reference = calculateSHA256(data).replace('sha256:', '');
      swarmNetwork.set(reference, new Uint8Array(data));
      return { reference } as any;
    }) as any);

    vi.spyOn(mockBee.data, 'download').mockImplementation((async (reference: any) => {
      const cleanRef = String(reference).trim();
      const chunk = swarmNetwork.get(cleanRef);
      if (!chunk) {
        throw new Error(`Swarm reference "${cleanRef}" not found on network.`);
      }
      return {
        toUint8Array: () => chunk,
      } as any;
    }) as any);

    service = new CheckpointService(db, swarmProvider);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('Executes the 16-Step Production Restoration & Recovery Scenario', async () => {
    // ── STEP 1: Create CP-001 with 3 initial base files ──
    fs.writeFileSync(path.join(workspaceDir, 'app.py'), 'print("Base App v1")\n');
    fs.writeFileSync(path.join(workspaceDir, 'models.py'), 'class Order: pass\n');
    fs.writeFileSync(path.join(workspaceDir, 'utils.py'), 'def calculate_spread(): return 0.01\n');

    useStore.setState({
      goal: 'Milestone 1: Scaffold Orderbook DEX Base',
      tasks: {
        T1: {
          id: 'T1',
          parent_id: null,
          description: 'Scaffold data models',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'done',
          priority: 1,
          depends_on: [],
          attempts: 1,
          progress_pct: 100,
          est_effort_s: 60,
        },
      },
    });

    const cp001 = await service.createCheckpoint({
      projectId: PROJECT_ID,
      ownerUserId: USER_ID,
      workspaceDir,
      goal: 'Milestone 1: Scaffold Orderbook DEX Base',
      description: 'CP-001: Initial Models',
      encryptionKey: TEST_KEY,
      stateSnapshot: useStore.getState(),
    });

    expect(cp001.lifecycleStatus).toBe('COMPLETED');
    expect(cp001.fileCount).toBe(3);

    // ── STEP 2: Modify 5 source files ──
    fs.writeFileSync(path.join(workspaceDir, 'routes.py'), 'def handle_order(): pass\n');
    fs.writeFileSync(path.join(workspaceDir, 'service.py'), 'class MatchingService: pass\n');
    fs.writeFileSync(path.join(workspaceDir, 'db.py'), 'def get_connection(): pass\n');
    fs.writeFileSync(path.join(workspaceDir, 'config.py'), 'PORT = 8080\n');
    fs.writeFileSync(path.join(workspaceDir, 'auth.py'), 'def verify_signature(): pass\n');

    // ── STEP 3: Create CP-002 ──
    useStore.setState({
      goal: 'Milestone 2: Orderbook Matching API',
      tasks: {
        T1: {
          id: 'T1',
          parent_id: null,
          description: 'Scaffold data models',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'done',
          priority: 1,
          depends_on: [],
          attempts: 1,
          progress_pct: 100,
          est_effort_s: 60,
        },
        T2: {
          id: 'T2',
          parent_id: null,
          description: 'Implement matching routes and service',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'running',
          priority: 2,
          depends_on: ['T1'],
          attempts: 1,
          progress_pct: 50,
          est_effort_s: 120,
        },
      },
    });

    const cp002 = await service.createCheckpoint({
      projectId: PROJECT_ID,
      ownerUserId: USER_ID,
      workspaceDir,
      goal: 'Milestone 2: Orderbook Matching API',
      description: 'CP-002: Matching API Core',
      parentCheckpointId: cp001.checkpointId,
      encryptionKey: TEST_KEY,
      stateSnapshot: useStore.getState(),
    });

    expect(cp002.lifecycleStatus).toBe('COMPLETED');
    expect(cp002.fileCount).toBe(8); // 3 base + 5 modified

    // ── STEP 4: Modify 10 additional source files ──
    const tenFiles = [
      'stress.py', 'benchmark.py', 'feed.py', 'pool.py', 'amm.py',
      'oracle.py', 'vault.py', 'token.py', 'governance.py', 'analytics.py',
    ];
    for (const f of tenFiles) {
      fs.writeFileSync(path.join(workspaceDir, f), `# ${f} implementation for CP-003\n`);
    }

    // ── STEP 5: Create CP-003 ──
    useStore.setState({
      goal: 'Milestone 3: Full DeFi DEX Suite with Analytics',
      tasks: {
        T1: {
          id: 'T1',
          parent_id: null,
          description: 'Scaffold data models',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'done',
          priority: 1,
          depends_on: [],
          attempts: 1,
          progress_pct: 100,
          est_effort_s: 60,
        },
        T2: {
          id: 'T2',
          parent_id: null,
          description: 'Implement matching routes and service',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'done',
          priority: 2,
          depends_on: ['T1'],
          attempts: 1,
          progress_pct: 100,
          est_effort_s: 120,
        },
        T3: {
          id: 'T3',
          parent_id: null,
          description: 'DeFi Liquidity Pools & Governance',
          owner_role: 'engineering',
          assigned_agent: 'W_backend_0',
          status: 'running',
          priority: 3,
          depends_on: ['T2'],
          attempts: 1,
          progress_pct: 75,
          est_effort_s: 180,
        },
      },
    });

    const cp003 = await service.createCheckpoint({
      projectId: PROJECT_ID,
      ownerUserId: USER_ID,
      workspaceDir,
      goal: 'Milestone 3: Full DeFi DEX Suite with Analytics',
      description: 'CP-003: Full Suite',
      parentCheckpointId: cp002.checkpointId,
      encryptionKey: TEST_KEY,
      stateSnapshot: useStore.getState(),
    });

    expect(cp003.lifecycleStatus).toBe('COMPLETED');
    expect(cp003.fileCount).toBe(18); // 8 + 10

    // ── STEP 6: Modify files again (make active workspace dirty) ──
    fs.writeFileSync(path.join(workspaceDir, 'uncommitted_wip.txt'), 'Uncommitted live work\n');

    // ── STEP 7: Restart the backend (create fresh CheckpointService instance with DB) ──
    const freshDb = new CheckpointDatabase(dbFile);
    const restartedService = new CheckpointService(freshDb, swarmProvider);

    // ── STEP 8: Select CP-002 ──
    const selectedCP002 = restartedService.getCheckpoint(cp002.checkpointId, USER_ID);
    expect(selectedCP002.checkpointId).toBe(cp002.checkpointId);

    // ── STEP 9: Retrieve actual Swarm archive & verify presence on network ──
    expect(swarmNetwork.has(selectedCP002.archiveSwarmRef!)).toBe(true);
    expect(swarmNetwork.has(selectedCP002.contextSwarmRef!)).toBe(true);

    // ── STEP 10: Restore CP-002 ──
    const restoreResult = await restartedService.restoreCheckpoint({
      checkpointId: cp002.checkpointId,
      requestingUserId: USER_ID,
      targetWorkspaceDir: workspaceDir,
      createSafetyBackup: true,
      decryptionKey: TEST_KEY,
    });

    expect(restoreResult.restoredFilesCount).toBe(8);
    expect(restoreResult.safetyCheckpointId).toBeDefined();

    // ── STEP 11: Compare restored files against CP-002's manifest ──
    const manifestCP002: CheckpointManifest = JSON.parse(selectedCP002.manifestJson!);
    const restoredFilesOnDisk = fs.readdirSync(workspaceDir);

    expect(restoredFilesOnDisk.length).toBe(8);

    // All CP-002 files exist
    expect(fs.existsSync(path.join(workspaceDir, 'app.py'))).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir, 'routes.py'))).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir, 'service.py'))).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir, 'auth.py'))).toBe(true);

    // The 10 files from CP-003 and uncommitted files MUST NOT exist in CP-002 workspace
    for (const f of tenFiles) {
      expect(fs.existsSync(path.join(workspaceDir, f))).toBe(false);
    }
    expect(fs.existsSync(path.join(workspaceDir, 'uncommitted_wip.txt'))).toBe(false);

    // ── STEP 12: Verify exact file hashes match CP-002's manifest ──
    for (const fileEntry of manifestCP002.files) {
      if (fileEntry.type === 'file') {
        const filePath = path.join(workspaceDir, fileEntry.path);
        const actualBytes = fs.readFileSync(filePath);
        const actualSha = calculateSHA256(actualBytes);
        expect(actualSha).toBe(fileEntry.sha256);
      }
    }

    // ── STEP 13: Verify restored AI context in useStore ──
    const storeState = useStore.getState();
    expect(storeState.goal).toBe('Milestone 2: Orderbook Matching API');
    expect(storeState.tasks['T2'].status).toBe('running');
    expect(storeState.tasks['T3']).toBeUndefined(); // CP-003 task is gone

    // ── STEP 14: Confirm restored files are actual editable source code ──
    const appPyContent = fs.readFileSync(path.join(workspaceDir, 'app.py'), 'utf-8');
    expect(appPyContent).toBe('print("Base App v1")\n');

    // Modify the restored file
    fs.appendFileSync(path.join(workspaceDir, 'app.py'), '# modified after CP-002 restoration\n');
    expect(fs.readFileSync(path.join(workspaceDir, 'app.py'), 'utf-8')).toContain('# modified after CP-002');

    // ── STEP 15: Confirm newer checkpoints (CP-003) still exist in database ──
    const allCheckpoints = restartedService.listCheckpoints(PROJECT_ID, USER_ID);
    const cp003Record = restartedService.getCheckpoint(cp003.checkpointId, USER_ID);

    expect(cp003Record).toBeDefined();
    expect(cp003Record.lifecycleStatus).toBe('COMPLETED');
    expect(allCheckpoints.checkpoints.some((c) => c.checkpointId === cp003.checkpointId)).toBe(true);

    // ── STEP 16: Restore safety checkpoint to verify rollback recovery ──
    const safetyRestore = await restartedService.restoreCheckpoint({
      checkpointId: restoreResult.safetyCheckpointId!,
      requestingUserId: USER_ID,
      targetWorkspaceDir: workspaceDir,
      createSafetyBackup: false,
      decryptionKey: TEST_KEY,
    });

    expect(safetyRestore.restoredFilesCount).toBe(19); // 18 + uncommitted_wip.txt
    expect(fs.existsSync(path.join(workspaceDir, 'uncommitted_wip.txt'))).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir, 'stress.py'))).toBe(true);

    freshDb.close();
  });

  it('Corrupted Archive Detection: aborts restoration cleanly without corrupting original workspace', async () => {
    // 1. Create a valid checkpoint
    fs.writeFileSync(path.join(workspaceDir, 'original.py'), 'original code\n');
    const validCP = await service.createCheckpoint({
      projectId: PROJECT_ID,
      ownerUserId: USER_ID,
      workspaceDir,
      goal: 'Original Objective',
      encryptionKey: TEST_KEY,
    });

    // 2. Corrupt the archive bytes in the Swarm network simulator
    const archiveBytes = swarmNetwork.get(validCP.archiveSwarmRef!)!;
    const corruptedBytes = new Uint8Array(archiveBytes);
    corruptedBytes[0] ^= 0xff; // Flip bit
    swarmNetwork.set(validCP.archiveSwarmRef!, corruptedBytes);

    // 3. Attempt restoration -> MUST FAIL integrity check
    await expect(
      service.restoreCheckpoint({
        checkpointId: validCP.checkpointId,
        requestingUserId: USER_ID,
        targetWorkspaceDir: workspaceDir,
        decryptionKey: TEST_KEY,
      })
    ).rejects.toThrow(/Cryptographic Integrity Mismatch|verification failed/i);

    // 4. Verify original workspace is completely preserved and untouched
    expect(fs.existsSync(path.join(workspaceDir, 'original.py'))).toBe(true);
    expect(fs.readFileSync(path.join(workspaceDir, 'original.py'), 'utf-8')).toBe('original code\n');
  });

  it('Lock Conflict: rejects simultaneous restoration operations on the same project', async () => {
    fs.writeFileSync(path.join(workspaceDir, 'file.py'), 'code\n');
    const cp = await service.createCheckpoint({
      projectId: PROJECT_ID,
      ownerUserId: USER_ID,
      workspaceDir,
      goal: 'Lock test',
      encryptionKey: TEST_KEY,
    });

    // Manually engage active restore lock
    (service as any).activeRestoreLocks.add(PROJECT_ID);

    await expect(
      service.restoreCheckpoint({
        checkpointId: cp.checkpointId,
        requestingUserId: USER_ID,
        targetWorkspaceDir: workspaceDir,
        decryptionKey: TEST_KEY,
      })
    ).rejects.toThrow(/Restore lock conflict/i);

    // Release lock
    (service as any).activeRestoreLocks.delete(PROJECT_ID);
  });
});

