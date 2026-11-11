/**
 * AUTONEX Checkpoint Engine: Checkpoint Management Service (Phase 5)
 *
 * Coordinates:
 * 1. Binary snapshot engine (TAR + Zstandard)
 * 2. Real Ethereum Swarm decentralized storage (Bee SDK)
 * 3. AI context capture, encryption, and restoration
 * 4. Transactional database persistence with ownership authorization
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  CheckpointDatabase,
  type CheckpointRecord,
  type RestoreOperationRecord,
  type ListCheckpointsOptions,
  type PaginatedCheckpoints,
  type CheckpointLifecycleStatus,
  type CheckpointExecutionStatus,
} from './checkpointDb';
import { createWorkspaceSnapshot } from './archiver';
import { extractWorkspaceSnapshot, readArchiveFiles } from './extractor';
import { captureAIContext, serializeAndEncryptContext } from './contextCapture';
import { decryptAndValidateContext, applyRestoredContextToStore } from './contextRestore';
import { SwarmStorageProvider } from '../swarm/beeProvider';
import { calculateSHA256 } from './crypto';
import type { CheckpointManifest } from './types';
import type { ArkivCheckpointRecord } from '../arkiv/operations';
import JSZip from 'jszip';
import { useStore } from '@/state/store';

export interface CreateCheckpointParams {
  projectId: string;
  ownerUserId: string;
  workspaceDir: string;
  goal: string;
  parentCheckpointId?: string | null;
  agentTaskId?: string | null;
  description?: string;
  executionStatus?: CheckpointExecutionStatus;
  targetLifecycleStatus?: CheckpointLifecycleStatus;
  encryptionKey?: Buffer | Uint8Array | string;
  postageBatchId?: string;
  stateSnapshot?: any;
}

export interface RestoreCheckpointParams {
  checkpointId: string;
  requestingUserId: string;
  targetWorkspaceDir: string;
  createSafetyBackup?: boolean;
  decryptionKey?: Buffer | Uint8Array | string;
}

export interface BrowserRestoreCheckpointParams {
  checkpointId: string;
  requestingUserId: string;
  workspaceHandle: any;
  decryptionKey?: Buffer | Uint8Array | string;
}

export interface BrowserStateRestoreResult {
  checkpointId: string;
  projectId: string;
  files: Record<string, string>;
  restoredFilesCount: number;
  activeObjective: string;
  completedAt: string;
}

export interface CheckpointComparisonResult {
  baseCheckpointId: string;
  targetCheckpointId: string;
  projectId: string;
  filesAdded: string[];
  filesRemoved: string[];
  filesModified: string[];
  filesUnchanged: string[];
  totalSizeDelta: number;
  totalFilesDelta: number;
}

export interface CheckpointVerificationResult {
  checkpointId: string;
  verified: boolean;
  archiveMatch: boolean;
  contextMatch: boolean;
  archiveHash: string;
  contextHash: string;
  checkedAt: string;
}

export interface RestoreCheckpointResult {
  restoreId: string;
  checkpointId: string;
  safetyCheckpointId: string | null;
  restoredFilesCount: number;
  workspacePath: string;
  activeObjective: string;
  activeTaskId: string | null;
  completedAt: string;
}

export interface CheckpointDetails {
  checkpoint: CheckpointRecord;
  manifest: CheckpointManifest | null;
  parentCheckpoint: CheckpointRecord | null;
}

export class CheckpointService {
  private db: CheckpointDatabase;
  private swarmProvider: SwarmStorageProvider;
  private inFlightCreations = new Map<string, Promise<CheckpointRecord>>();
  private activeRestoreLocks = new Set<string>();

  constructor(db?: CheckpointDatabase, swarmProvider?: SwarmStorageProvider) {
    this.db = db || new CheckpointDatabase();
    this.swarmProvider = swarmProvider || new SwarmStorageProvider();
  }

  public getDatabase(): CheckpointDatabase {
    return this.db;
  }

  public getSwarmProvider(): SwarmStorageProvider {
    return this.swarmProvider;
  }

  public setActiveCheckpoint(projectId: string, checkpointId: string): void {
    const checkpoint = this.getCheckpoint(checkpointId);
    if (checkpoint.projectId !== projectId) {
      throw new Error('Cannot activate a checkpoint from another project.');
    }
    this.db.setActiveCheckpoint(projectId, checkpointId);
  }

  public getActiveCheckpoint(projectId: string): string | null {
    return this.db.getActiveCheckpoint(projectId);
  }

  public async restoreCheckpointToBrowserState(
    checkpointId: string,
    requestingUserId: string
  ): Promise<BrowserStateRestoreResult> {
    const checkpoint = this.getCheckpoint(checkpointId, requestingUserId);
    if (checkpoint.lifecycleStatus !== 'COMPLETED') {
      throw new Error(`Cannot restore checkpoint in status "${checkpoint.lifecycleStatus}". Must be "COMPLETED".`);
    }
    if (!checkpoint.archiveSwarmRef || !checkpoint.contextSwarmRef) {
      throw new Error('Checkpoint is missing Swarm references required for restoration.');
    }
    const manifest: CheckpointManifest = checkpoint.manifestJson
      ? JSON.parse(checkpoint.manifestJson)
      : ({} as CheckpointManifest);
    if (manifest.archiveFormat !== 'zip') {
      throw new Error('This checkpoint uses the legacy TAR/Zstandard format. Browser state restore supports ZIP deliverable checkpoints.');
    }

    const files = await this.getCheckpointFiles(checkpointId, requestingUserId);
    const textFiles = Object.fromEntries(
      files.filter((file) => !file.isBinary && file.content !== undefined)
        .map((file) => [file.path, file.content || ''])
    );
    const contextDownload = await this.swarmProvider.downloadBinary(checkpoint.contextSwarmRef);
    let activeObjective = 'Restored Codebase';
    if (manifest.metadata?.contextFormat === 'plain-json') {
      const document = JSON.parse(new TextDecoder().decode(contextDownload.data));
      if (document.context && typeof document.context === 'object') {
        useStore.setState({
          ...document.context,
          restoredWorkspaceFiles: textFiles,
          restoredCheckpointId: checkpointId,
          toast: `Restored checkpoint context: ${checkpointId}`,
        });
        activeObjective = String(document.goal || activeObjective);
      }
    }
    this.db.setActiveCheckpoint(checkpoint.projectId, checkpointId);
    useStore.setState({
      restoredWorkspaceFiles: textFiles,
      restoredCheckpointId: checkpointId,
    });
    return {
      checkpointId,
      projectId: checkpoint.projectId,
      files: textFiles,
      restoredFilesCount: files.length,
      activeObjective,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Hydrates the local SQLite index from immutable Arkiv metadata. Existing local
   * records are never replaced, so a failed network read cannot erase history.
   */
  public importArkivCheckpoints(records: ArkivCheckpointRecord[]): number {
    let imported = 0;
    for (const record of records) {
      if (!record.checkpointId || !record.archiveSwarmRef || !record.contextSwarmRef) continue;
      if (this.db.getCheckpointById(record.checkpointId)) continue;
      let encryptionMetadataJson: string | null = null;
      if (record.encryptionIv || record.cipherAuthTag) {
        encryptionMetadataJson = JSON.stringify({
          archiveIV: record.encryptionIv,
          contextIV: record.contextEncryptionIv || record.encryptionIv,
          archiveAuthTag: record.cipherAuthTag,
          contextAuthTag: record.contextAuthTag || record.cipherAuthTag,
        });
      }
      this.db.importCheckpoint({
        checkpointId: record.checkpointId,
        projectId: record.projectId,
        parentCheckpointId: record.parentCheckpointId ?? null,
        agentTaskId: record.agentTaskId ?? null,
        ownerUserId: record.owner,
        description: record.description || `Arkiv checkpoint ${record.checkpointId}`,
        createdAt: record.createdAt,
        executionStatus: (record.status as CheckpointExecutionStatus) || 'Completed',
        lifecycleStatus: (record.lifecycleStatus as CheckpointLifecycleStatus) || 'COMPLETED',
        archiveSwarmRef: record.archiveSwarmRef,
        contextSwarmRef: record.contextSwarmRef,
        archiveChecksum: record.archiveSha256,
        contextChecksum: record.contextSha256,
        archiveSize: record.archiveBytesSize,
        fileCount: record.fileCount,
        manifestJson: record.manifestJson || null,
        storageProvider: record.storageProvider || 'swarm',
        schemaVersion: record.schemaVersion || '2.0.0',
        encryptionMetadataJson,
      });
      imported++;
    }
    return imported;
  }

  /**
   * 1. Create Checkpoint
   * Transactional guarantees:
   * - Never marks COMPLETED until archive + context are uploaded to Swarm,
   *   re-downloaded, verified for SHA-256 integrity, and references are persisted.
   */
  public async createCheckpoint(params: CreateCheckpointParams): Promise<CheckpointRecord> {
    const {
      projectId,
      ownerUserId,
      workspaceDir,
      goal,
      parentCheckpointId = null,
      agentTaskId = null,
      description = `Checkpoint for ${projectId}`,
      executionStatus = 'In Progress',
      encryptionKey = 'autonex-symmetric-key-default',
      postageBatchId,
      stateSnapshot = {},
    } = params;

    if (!projectId || !ownerUserId) {
      throw new Error('Project ID and Owner User ID are required to create a checkpoint.');
    }
    if (!fs.existsSync(workspaceDir)) {
      throw new Error(`Workspace directory does not exist: "${workspaceDir}"`);
    }

    // Deduplication key: prevent duplicate concurrent requests on identical project state
    const dedupeKey = `${projectId}:${ownerUserId}:${workspaceDir}:${executionStatus}`;
    if (this.inFlightCreations.has(dedupeKey)) {
      return this.inFlightCreations.get(dedupeKey)!;
    }

    const creationPromise = (async () => {
      const checkpointId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const createdAt = Date.now();

      // Check parent checkpoint if specified
      if (parentCheckpointId) {
        const parent = this.db.getCheckpointById(parentCheckpointId);
        if (!parent) {
          throw new Error(`Parent checkpoint "${parentCheckpointId}" was not found.`);
        }
        if (parent.ownerUserId !== ownerUserId) {
          throw new Error('Cannot link to parent checkpoint belonging to another user.');
        }
      }

      // 1. Initial Database record with PENDING lifecycle status
      const initialRecord: CheckpointRecord = {
        checkpointId,
        projectId,
        parentCheckpointId,
        agentTaskId,
        ownerUserId,
        description,
        createdAt,
        executionStatus,
        lifecycleStatus: 'PENDING',
        archiveSwarmRef: null,
        contextSwarmRef: null,
        archiveChecksum: null,
        contextChecksum: null,
        archiveSize: 0,
        fileCount: 0,
        manifestJson: null,
        storageProvider: 'swarm',
        schemaVersion: '2.0.0',
      };
      this.db.insertCheckpoint(initialRecord);

      try {
        // 2. Build Workspace Binary Snapshot (TAR + Zstandard)
        const snapshot = await createWorkspaceSnapshot({
          workspaceDir,
          projectId,
          checkpointId,
          encryptionKey,
        });

        // 3. Capture & Encrypt AI Context Snapshot
        const contextObj = captureAIContext(stateSnapshot, {
          checkpointId,
          projectId,
          parentCheckpointId,
          currentTaskId: agentTaskId,
        });
        const encryptedContext = serializeAndEncryptContext(contextObj, encryptionKey);

        // Update database: UPLOADING
        this.db.updateCheckpointLifecycle(checkpointId, 'UPLOADING', {
          archiveChecksum: snapshot.archiveSha256,
          contextChecksum: encryptedContext.contextChecksum,
          archiveSize: snapshot.archiveBytes.byteLength,
          fileCount: snapshot.manifest.totalCapturedFiles,
          manifestJson: snapshot.manifestJson,
          encryptionMetadataJson: JSON.stringify({
            archiveIV: snapshot.manifest.encryption.iv,
            contextIV: encryptedContext.ivHex,
            archiveAuthTag: snapshot.manifest.encryption.authTag,
            contextAuthTag: encryptedContext.authTagHex,
          }),
        });

        // 4. Upload Both Artifacts to Ethereum Swarm via real Bee Provider
        const uploadResult = await this.swarmProvider.uploadCheckpointArtifacts(
          snapshot.archiveBytes,
          encryptedContext.ciphertext,
          { checkpointId, projectId, postageBatchId }
        );

        if (!uploadResult.verified) {
          throw new Error('Swarm post-upload retrieval verification failed for checkpoint artifacts.');
        }

        // 5. Transactional Completion: Mark target status (default COMPLETED) only after both verified
        const finalLifecycle = params.targetLifecycleStatus || 'COMPLETED';
        this.db.updateCheckpointLifecycle(checkpointId, finalLifecycle, {
          archiveSwarmRef: uploadResult.archiveReference,
          contextSwarmRef: uploadResult.contextReference,
          archiveChecksum: uploadResult.archiveContentHash,
          contextChecksum: encryptedContext.contextChecksum,
          executionStatus: executionStatus,
          encryptionMetadataJson: JSON.stringify({
            archiveIV: snapshot.manifest.encryption.iv,
            contextIV: encryptedContext.ivHex,
            archiveAuthTag: snapshot.manifest.encryption.authTag,
            contextAuthTag: encryptedContext.authTagHex,
            contextCiphertextHash: uploadResult.contextContentHash,
          }),
        });

        const completedRecord = this.db.getCheckpointById(checkpointId)!;
        return completedRecord;
      } catch (err: any) {
        // Mark FAILED without losing partial upload data
        this.db.updateCheckpointLifecycle(checkpointId, 'FAILED', {
          failureReason: err?.message || 'Unknown error during checkpoint creation',
        });
        throw new Error(`Failed to create checkpoint: ${err?.message}`);
      } finally {
        this.inFlightCreations.delete(dedupeKey);
      }
    })();

    this.inFlightCreations.set(dedupeKey, creationPromise);
    return creationPromise;
  }

  /**
   * 2. Get Checkpoint by ID with Authorization Enforcement
   */
  public getCheckpoint(checkpointId: string, requestingUserId?: string): CheckpointRecord {
    const record = this.db.getCheckpointById(checkpointId);
    if (!record) {
      throw new Error(`Checkpoint "${checkpointId}" was not found.`);
    }

    if (requestingUserId && record.ownerUserId !== requestingUserId) {
      throw new Error(`Access Denied: You do not have permission to view checkpoint "${checkpointId}".`);
    }

    return record;
  }

  /**
   * 3. List Project Checkpoints with Pagination & Authorization
   */
  public listCheckpoints(
    projectId: string,
    requestingUserIdOrOptions?: string | ListCheckpointsOptions,
    options?: ListCheckpointsOptions
  ): PaginatedCheckpoints {
    if (!projectId) {
      throw new Error('Project ID is required.');
    }

    let requestingUserId: string | undefined;
    let opts: ListCheckpointsOptions | undefined;

    if (typeof requestingUserIdOrOptions === 'string') {
      requestingUserId = requestingUserIdOrOptions;
      opts = options;
    } else {
      opts = requestingUserIdOrOptions;
    }

    const paginated = this.db.listCheckpointsByProject(projectId, opts);
    const authorized = requestingUserId
      ? paginated.checkpoints.filter((c) => c.ownerUserId === requestingUserId)
      : paginated.checkpoints;

    return {
      ...paginated,
      checkpoints: authorized,
      total: authorized.length,
    };
  }

  public listAllCheckpoints(options?: ListCheckpointsOptions): PaginatedCheckpoints {
    return this.db.listAllCheckpoints(options);
  }

  /**
   * 4. Get Detailed Checkpoint View (including parsed Manifest & Lineage)
   */
  public getCheckpointDetails(
    checkpointId: string,
    requestingUserId?: string
  ): CheckpointDetails {
    const checkpoint = this.getCheckpoint(checkpointId, requestingUserId);
    let manifest: CheckpointManifest | null = null;
    if (checkpoint.manifestJson) {
      try {
        manifest = JSON.parse(checkpoint.manifestJson);
      } catch {}
    }

    let parentCheckpoint: CheckpointRecord | null = null;
    if (checkpoint.parentCheckpointId) {
      parentCheckpoint = this.db.getCheckpointById(checkpoint.parentCheckpointId);
    }

    return {
      checkpoint,
      manifest,
      parentCheckpoint,
    };
  }

  /**
   * 5. Compare Two Checkpoints (Metadata & Manifest Delta)
   */
  public compareCheckpoints(
    baseCheckpointId: string,
    targetCheckpointId: string,
    requestingUserId: string
  ): CheckpointComparisonResult {
    const base = this.getCheckpoint(baseCheckpointId, requestingUserId);
    const target = this.getCheckpoint(targetCheckpointId, requestingUserId);

    if (base.projectId !== target.projectId) {
      throw new Error('Cannot compare checkpoints across different projects.');
    }

    const baseManifest: CheckpointManifest = base.manifestJson ? JSON.parse(base.manifestJson) : { files: [] };
    const targetManifest: CheckpointManifest = target.manifestJson ? JSON.parse(target.manifestJson) : { files: [] };

    const baseMap = new Map(baseManifest.files.map((f) => [f.path, f]));
    const targetMap = new Map(targetManifest.files.map((f) => [f.path, f]));

    const filesAdded: string[] = [];
    const filesRemoved: string[] = [];
    const filesModified: string[] = [];
    const filesUnchanged: string[] = [];

    for (const [path, targetFile] of targetMap.entries()) {
      if (!baseMap.has(path)) {
        filesAdded.push(path);
      } else {
        const baseFile = baseMap.get(path)!;
        if (baseFile.sha256 !== targetFile.sha256 || baseFile.size !== targetFile.size) {
          filesModified.push(path);
        } else {
          filesUnchanged.push(path);
        }
      }
    }

    for (const path of baseMap.keys()) {
      if (!targetMap.has(path)) {
        filesRemoved.push(path);
      }
    }

    return {
      baseCheckpointId,
      targetCheckpointId,
      projectId: base.projectId,
      filesAdded,
      filesRemoved,
      filesModified,
      filesUnchanged,
      totalSizeDelta: target.archiveSize - base.archiveSize,
      totalFilesDelta: target.fileCount - base.fileCount,
    };
  }

  /**
   * 6. Verify Checkpoint Integrity on Ethereum Swarm
   */
  public async verifyCheckpoint(
    checkpointId: string,
    requestingUserId?: string
  ): Promise<CheckpointVerificationResult> {
    const checkpoint = this.getCheckpoint(checkpointId, requestingUserId);

    if (!checkpoint.archiveSwarmRef || !checkpoint.contextSwarmRef) {
      throw new Error('Checkpoint is missing Swarm storage references.');
    }

    let encMeta: any = {};
    if (checkpoint.encryptionMetadataJson) {
      try {
        encMeta = JSON.parse(checkpoint.encryptionMetadataJson);
      } catch {}
    }

    // Download archive and verify hash
    const archiveDownload = await this.swarmProvider.downloadBinary(
      checkpoint.archiveSwarmRef,
      checkpoint.archiveChecksum || undefined
    );

    // Download context and verify hash against ciphertext hash
    const contextDownload = await this.swarmProvider.downloadBinary(
      checkpoint.contextSwarmRef,
      encMeta.contextCiphertextHash || undefined
    );

    const archiveMatch = archiveDownload.verified;
    const contextMatch = contextDownload.verified;

    return {
      checkpointId,
      verified: archiveMatch && contextMatch,
      archiveMatch,
      contextMatch,
      archiveHash: archiveDownload.contentHash,
      contextHash: contextDownload.contentHash,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * 7. Restore Checkpoint with Strict Authorization, Staging Sandboxing & Safety Rollback
   */
  public async restoreCheckpoint(params: RestoreCheckpointParams): Promise<RestoreCheckpointResult> {
    const {
      checkpointId,
      requestingUserId,
      targetWorkspaceDir,
      createSafetyBackup = true,
      decryptionKey = 'autonex-symmetric-key-default',
    } = params;

    // 1. Validate request & ownership
    const checkpoint = this.getCheckpoint(checkpointId, requestingUserId);

    if (checkpoint.lifecycleStatus !== 'COMPLETED') {
      throw new Error(`Cannot restore checkpoint in status "${checkpoint.lifecycleStatus}". Must be "COMPLETED".`);
    }

    if (!checkpoint.archiveSwarmRef || !checkpoint.contextSwarmRef) {
      throw new Error('Checkpoint is missing Swarm references required for restoration.');
    }

    // Project-level restore locking
    if (this.activeRestoreLocks.has(checkpoint.projectId)) {
      throw new Error(
        `Restore lock conflict: A restoration operation is already in progress for project "${checkpoint.projectId}".`
      );
    }
    this.activeRestoreLocks.add(checkpoint.projectId);

    const restoreId = `rst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    let safetyCheckpointId: string | null = null;
    const stagingDir = `${targetWorkspaceDir}.staging_${restoreId}`;
    const backupDir = `${targetWorkspaceDir}.backup_${restoreId}`;

    // 1. Create Restore Operation record (IN_PROGRESS)
    const opRecord: RestoreOperationRecord = {
      restoreId,
      checkpointId,
      safetyCheckpointId: null,
      initiatingUser: requestingUserId,
      status: 'IN_PROGRESS',
      startedAt,
      completedAt: null,
      failureDetails: null,
      restoredFilesCount: 0,
    };
    this.db.insertRestoreOp(opRecord);

    try {
      // 2. Step 2: Create safety checkpoint before modifying active workspace
      if (
        createSafetyBackup &&
        fs.existsSync(targetWorkspaceDir) &&
        fs.readdirSync(targetWorkspaceDir).length > 0
      ) {
        try {
          const safety = await this.createCheckpoint({
            projectId: checkpoint.projectId,
            ownerUserId: requestingUserId,
            workspaceDir: targetWorkspaceDir,
            goal: `Safety Backup before restoring ${checkpointId}`,
            description: `Auto-generated safety checkpoint before restoring ${checkpointId}`,
            parentCheckpointId: checkpointId,
            encryptionKey: decryptionKey,
          });
          safetyCheckpointId = safety.checkpointId;
          this.db.updateRestoreOp(restoreId, 'IN_PROGRESS', { safetyCheckpointId });
        } catch (err: any) {
          throw new Error(`Restoration aborted: Failed to capture safety checkpoint: ${err?.message}`);
        }
      }

      let encMeta: any = {};
      if (checkpoint.encryptionMetadataJson) {
        try {
          encMeta = JSON.parse(checkpoint.encryptionMetadataJson);
        } catch {}
      }

      // 3. Step 3: Retrieve selected checkpoint artifacts from Swarm
      const archiveDownload = await this.swarmProvider.downloadBinary(
        checkpoint.archiveSwarmRef,
        checkpoint.archiveChecksum || undefined
      );

      const contextDownload = await this.swarmProvider.downloadBinary(
        checkpoint.contextSwarmRef,
        encMeta.contextCiphertextHash || undefined
      );

      // 4. Step 4 & 5: Safe extraction into isolated staging directory
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
      fs.mkdirSync(stagingDir, { recursive: true });

      const manifest: CheckpointManifest = checkpoint.manifestJson
        ? JSON.parse(checkpoint.manifestJson)
        : { version: '2.0.0', checkpointId, files: [] };

      const extractResult = manifest.archiveFormat === 'zip'
        ? await this.extractZipSnapshot(archiveDownload.data, stagingDir, manifest)
        : await extractWorkspaceSnapshot({
            archiveBytes: archiveDownload.data,
            targetDir: stagingDir,
            manifest,
            decryptionKey,
            allowOverwrite: true,
          });

      // 5. Step 6: Workspace Replacement with Atomic Fallback & Rollback
      try {
        if (fs.existsSync(targetWorkspaceDir)) {
          fs.renameSync(targetWorkspaceDir, backupDir);
        }
        fs.renameSync(stagingDir, targetWorkspaceDir);

        // Clean up backup after verified successful replacement
        if (fs.existsSync(backupDir)) {
          fs.rmSync(backupDir, { recursive: true, force: true });
        }
      } catch (swapErr: any) {
        // Rollback from backup if directory move encountered error
        if (fs.existsSync(backupDir) && !fs.existsSync(targetWorkspaceDir)) {
          fs.renameSync(backupDir, targetWorkspaceDir);
        }
        if (fs.existsSync(stagingDir)) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        }
        throw new Error(`Atomic workspace replacement failed, rolled back to original workspace: ${swapErr?.message}`);
      }

      // 6. Step 7: AI Context Restoration & Agent Rehydration
      const encryptedContextPayload = {
        checkpointId,
        projectId: checkpoint.projectId,
        ciphertext: contextDownload.data,
        ivHex: encMeta.contextIV || '00'.repeat(12),
        authTagHex: encMeta.contextAuthTag || '00'.repeat(16),
        contextChecksum: checkpoint.contextChecksum || calculateSHA256(contextDownload.data),
        rawByteSize: contextDownload.byteSize,
        encryptedByteSize: contextDownload.byteSize,
        schemaVersion: '2.0.0' as const,
        createdAt: new Date().toISOString(),
      };

      let rehydration: any = { activeObjective: 'Restored Codebase', activeTaskId: null };
      try {
        if (manifest.metadata?.contextFormat === 'plain-json') {
          const document = JSON.parse(new TextDecoder().decode(contextDownload.data));
          if (!document.context || typeof document.context !== 'object') {
            throw new Error('Context snapshot is missing its state payload.');
          }
          useStore.setState({
            ...document.context,
            toast: `Restored checkpoint context: ${checkpointId}`,
          });
          rehydration = {
            activeObjective: String(document.goal || 'Restored Codebase'),
            activeTaskId: null,
          };
        } else {
          const restoredContext = decryptAndValidateContext(encryptedContextPayload, decryptionKey);
          rehydration = applyRestoredContextToStore(restoredContext);
        }
      } catch (contextErr: any) {
        console.error(`[CheckpointService] Codebase restored, but context restoration failed: ${contextErr?.message}`);
      }

      // 7. Step 8 & 9: Mark COMPLETED in DB & Complete restore operation
      const completedAt = Date.now();
      this.db.setActiveCheckpoint(checkpoint.projectId, checkpointId);
      this.db.updateRestoreOp(restoreId, 'COMPLETED', {
        completedAt,
        restoredFilesCount: extractResult.restoredFilesCount,
      });

      return {
        restoreId,
        checkpointId,
        safetyCheckpointId,
        restoredFilesCount: extractResult.restoredFilesCount,
        workspacePath: targetWorkspaceDir,
        activeObjective: rehydration.activeObjective,
        activeTaskId: rehydration.activeTaskId,
        completedAt: new Date(completedAt).toISOString(),
      };
    } catch (err: any) {
      this.db.updateRestoreOp(restoreId, 'FAILED', {
        completedAt: Date.now(),
        failureDetails: err?.message || 'Restore execution failed',
      });
      throw new Error(`Restoration failed: ${err?.message}`);
    } finally {
      this.activeRestoreLocks.delete(checkpoint.projectId);
    }
  }

  /**
   * Restores ZIP deliverable checkpoints through the browser File System Access
   * API. Browser code cannot use the Node filesystem implementation above.
   */
  public async restoreCheckpointInBrowser(
    params: BrowserRestoreCheckpointParams
  ): Promise<RestoreCheckpointResult> {
    const checkpoint = this.getCheckpoint(params.checkpointId, params.requestingUserId);
    if (checkpoint.lifecycleStatus !== 'COMPLETED') {
      throw new Error(`Cannot restore checkpoint in status "${checkpoint.lifecycleStatus}". Must be "COMPLETED".`);
    }
    if (!checkpoint.archiveSwarmRef || !checkpoint.contextSwarmRef) {
      throw new Error('Checkpoint is missing Swarm references required for restoration.');
    }
    if (!params.workspaceHandle?.values || !params.workspaceHandle.getFileHandle) {
      throw new Error('Select an active workspace folder before restoring.');
    }

    const manifest: CheckpointManifest = checkpoint.manifestJson
      ? JSON.parse(checkpoint.manifestJson)
      : { version: '2.0.0', checkpointId: params.checkpointId, files: [] } as unknown as CheckpointManifest;
    if (manifest.archiveFormat !== 'zip') {
      throw new Error('This checkpoint uses the legacy TAR/Zstandard format and requires the AUTONEX bridge for browser restore.');
    }

    const archiveDownload = await this.swarmProvider.downloadBinary(
      checkpoint.archiveSwarmRef,
      checkpoint.archiveChecksum || undefined
    );
    const contextDownload = await this.swarmProvider.downloadBinary(checkpoint.contextSwarmRef);
    const files = await this.readZipFiles(archiveDownload.data);
    const restoreId = `rst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const backupHandle = await params.workspaceHandle.getDirectoryHandle(
      `.autonex-restore-backup-${restoreId}`,
      { create: true }
    );

    const copyDirectory = async (source: any, destination: any): Promise<void> => {
      for await (const entry of source.values()) {
        if (entry.name.startsWith('.autonex-restore-backup-')) continue;
        if (entry.kind === 'directory') {
          await copyDirectory(entry, await destination.getDirectoryHandle(entry.name, { create: true }));
        } else {
          const sourceFile = await entry.getFile();
          const writer = await (await destination.getFileHandle(entry.name, { create: true })).createWritable();
          await writer.write(await sourceFile.arrayBuffer());
          await writer.close();
        }
      }
    };
    await copyDirectory(params.workspaceHandle, backupHandle);

    let restoredFilesCount = 0;
    for (const file of manifest.files) {
      if (file.type === 'directory') continue;
      const relative = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
      const content = files.get(relative);
      if (!content) throw new Error(`Archive is missing expected file "${relative}".`);
      if (calculateSHA256(content) !== file.sha256) {
        throw new Error(`File hash mismatch for "${relative}".`);
      }
      const parts = relative.split('/');
      const fileName = parts.pop()!;
      let directory = params.workspaceHandle;
      for (const part of parts) {
        directory = await directory.getDirectoryHandle(part, { create: true });
      }
      const writable = await (await directory.getFileHandle(fileName, { create: true })).createWritable();
      await writable.write(content);
      await writable.close();
      restoredFilesCount++;
    }

    if (manifest.metadata?.contextFormat === 'plain-json') {
      const document = JSON.parse(new TextDecoder().decode(contextDownload.data));
      if (document.context && typeof document.context === 'object') {
        useStore.setState({
          ...document.context,
          toast: `Restored checkpoint context: ${params.checkpointId}`,
        });
      }
    }

    this.db.setActiveCheckpoint(checkpoint.projectId, params.checkpointId);

    return {
      restoreId,
      checkpointId: params.checkpointId,
      safetyCheckpointId: null,
      restoredFilesCount,
      workspacePath: params.workspaceHandle.name || 'Selected workspace',
      activeObjective: 'Restored Codebase',
      activeTaskId: null,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * 8. Get Restoration Operation Status
   */
  public getRestoreStatus(restoreId: string, requestingUserId: string): RestoreOperationRecord {
    const op = this.db.getRestoreOpById(restoreId);
    if (!op) {
      throw new Error(`Restore operation "${restoreId}" was not found.`);
    }

    if (op.initiatingUser !== requestingUserId) {
      throw new Error('Access Denied: You cannot view another user\'s restore operation.');
    }

    return op;
  }

  /**
   * 9. Inspect Files and Contents from a Checkpoint Snapshot
   */
  public async getCheckpointFiles(
    checkpointId: string,
    requestingUserId?: string,
    decryptionKey: Buffer | Uint8Array | string = 'autonex-symmetric-key-default'
  ): Promise<Array<{ path: string; size: number; sha256: string; content?: string; isBinary: boolean }>> {
    const record = this.getCheckpoint(checkpointId, requestingUserId);
    if (!record.archiveSwarmRef) {
      throw new Error(`Checkpoint "${checkpointId}" does not have an archive reference.`);
    }

    const manifest: CheckpointManifest = record.manifestJson ? JSON.parse(record.manifestJson) : { files: [] };
    const swarmRes = await this.swarmProvider.downloadBinary(record.archiveSwarmRef, record.archiveChecksum || undefined);
    const filesMap = manifest.archiveFormat === 'zip'
      ? await this.readZipFiles(swarmRes.data)
      : await readArchiveFiles({ archiveBytes: swarmRes.data, manifest, decryptionKey });

    const isBinaryBuffer = (buf: Uint8Array) => {
      const len = Math.min(buf.length, 1024);
      for (let i = 0; i < len; i++) {
        if (buf[i] === 0) return true;
      }
      return false;
    };

    const result = [];
    for (const file of manifest.files) {
      if (file.type === 'directory') continue;
      const buf = filesMap.get(file.path) || new Uint8Array();
      const isBinary = isBinaryBuffer(buf);
      result.push({
        path: file.path,
        size: file.size,
        sha256: file.sha256,
        isBinary,
        content: isBinary ? undefined : new TextDecoder().decode(buf),
      });
    }
    return result;
  }

  private async readZipFiles(archiveBytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    const zip = await JSZip.loadAsync(archiveBytes);
    const files = new Map<string, Uint8Array>();
    for (const [filePath, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const bytes = await entry.async('uint8array');
      files.set(filePath.replace(/\\/g, '/'), bytes);
    }
    return files;
  }

  private async extractZipSnapshot(
    archiveBytes: Uint8Array,
    targetDir: string,
    manifest: CheckpointManifest
  ) {
    const files = await this.readZipFiles(archiveBytes);
    const root = path.resolve(targetDir);
    let restoredFilesCount = 0;
    let totalBytesExtracted = 0;
    const restoredPaths: string[] = [];
    for (const file of manifest.files) {
      if (file.type === 'directory') continue;
      const relative = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
      const destination = path.resolve(root, relative);
      if (!destination.startsWith(root + path.sep)) {
        throw new Error(`Security Alert: Blocked path traversal attempt in "${file.path}".`);
      }
      const content = files.get(relative);
      if (!content) throw new Error(`Archive is missing expected file "${relative}".`);
      const actualHash = calculateSHA256(content);
      if (actualHash !== file.sha256) {
        throw new Error(`File hash mismatch for "${relative}": expected ${file.sha256}, got ${actualHash}.`);
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
      restoredFilesCount++;
      totalBytesExtracted += content.byteLength;
      restoredPaths.push(relative);
    }
    return {
      restoredFilesCount,
      restoredDirectoriesCount: 0,
      totalBytesExtracted,
      verifiedFileHashes: true,
      restoredPaths,
    };
  }

  /**
   * 10. Get Content of a Single File from a Checkpoint
   */
  public async getCheckpointFileContent(
    checkpointId: string,
    filePath: string,
    requestingUserId?: string,
    decryptionKey: Buffer | Uint8Array | string = 'autonex-symmetric-key-default'
  ): Promise<{ path: string; content: string; isBinary: boolean; size: number; sha256: string }> {
    const files = await this.getCheckpointFiles(checkpointId, requestingUserId, decryptionKey);
    const normalizedTarget = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const found = files.find(
      (f) => f.path.replace(/\\/g, '/').replace(/^\/+/, '') === normalizedTarget
    );
    if (!found) {
      throw new Error(`File "${filePath}" not found in checkpoint "${checkpointId}".`);
    }
    return {
      path: found.path,
      content: found.content || '',
      isBinary: found.isBinary,
      size: found.size,
      sha256: found.sha256,
    };
  }

  /**
   * 11. Detailed File Diff Comparing Base and Target Checkpoints
   */
  public async getCheckpointDetailedDiff(
    baseCheckpointId: string,
    targetCheckpointId: string,
    requestingUserId?: string,
    decryptionKey: Buffer | Uint8Array | string = 'autonex-symmetric-key-default'
  ) {
    const baseFiles = await this.getCheckpointFiles(baseCheckpointId, requestingUserId, decryptionKey);
    const targetFiles = await this.getCheckpointFiles(targetCheckpointId, requestingUserId, decryptionKey);

    const baseMap = new Map(baseFiles.map((f) => [f.path, f]));
    const targetMap = new Map(targetFiles.map((f) => [f.path, f]));

    const added: typeof targetFiles = [];
    const removed: typeof baseFiles = [];
    const modified: Array<{
      path: string;
      oldContent: string;
      newContent: string;
      oldSize: number;
      newSize: number;
      isBinary: boolean;
    }> = [];
    const unchanged: typeof targetFiles = [];

    for (const [p, tFile] of targetMap.entries()) {
      if (!baseMap.has(p)) {
        added.push(tFile);
      } else {
        const bFile = baseMap.get(p)!;
        if (bFile.sha256 !== tFile.sha256) {
          modified.push({
            path: p,
            oldContent: bFile.content || '',
            newContent: tFile.content || '',
            oldSize: bFile.size,
            newSize: tFile.size,
            isBinary: bFile.isBinary || tFile.isBinary,
          });
        } else {
          unchanged.push(tFile);
        }
      }
    }

    for (const [p, bFile] of baseMap.entries()) {
      if (!targetMap.has(p)) {
        removed.push(bFile);
      }
    }

    return {
      baseCheckpointId,
      targetCheckpointId,
      filesAdded: added,
      filesRemoved: removed,
      filesModified: modified,
      filesUnchanged: unchanged,
    };
  }
}
