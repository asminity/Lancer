/**
 * AUTONEX Checkpoint Engine: Checkpoint Metadata Database (Phase 5)
 *
 * Implements persistent, transactional metadata storage for:
 * 1. Checkpoint lifecycle and content-addressed references (Swarm archive & context)
 * 2. Parent-child lineage and project ownership
 * 3. Restoration operation tracking and safety snapshots
 *
 * Supports native node:sqlite DatabaseSync when running in Node.js backend/bridge,
 * and seamlessly provides high-performance in-memory indexing when running in browser.
 */

import path from 'node:path';
import fs from 'node:fs';

export function persistBrowserActiveCheckpoint(projectId: string, checkpointId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `autonex:checkpoint-active:${projectId}`,
      JSON.stringify({ checkpointId, updatedAt: Date.now() })
    );
  } catch (error) {
    console.warn('Unable to persist the active checkpoint in browser storage.', error);
  }
}

export type CheckpointLifecycleStatus = 'PENDING' | 'UPLOADING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED';
export type CheckpointExecutionStatus = 'In Progress' | 'Interrupted' | 'Completed' | 'Failed';
export type RestoreStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface CheckpointRecord {
  checkpointId: string;
  projectId: string;
  parentCheckpointId: string | null;
  agentTaskId: string | null;
  ownerUserId: string;
  description: string;
  createdAt: number; // Unix timestamp in ms
  executionStatus: CheckpointExecutionStatus;
  lifecycleStatus: CheckpointLifecycleStatus;
  archiveSwarmRef: string | null;
  contextSwarmRef: string | null;
  archiveChecksum: string | null;
  contextChecksum: string | null;
  archiveSize: number;
  fileCount: number;
  manifestJson: string | null;
  storageProvider: string;
  schemaVersion: string;
  encryptionMetadataJson?: string | null;
  failureReason?: string | null;
}

export interface RestoreOperationRecord {
  restoreId: string;
  checkpointId: string;
  safetyCheckpointId: string | null;
  initiatingUser: string;
  status: RestoreStatus;
  startedAt: number;
  completedAt: number | null;
  failureDetails: string | null;
  restoredFilesCount: number;
}

export interface ListCheckpointsOptions {
  page?: number;
  limit?: number;
  lifecycleStatus?: CheckpointLifecycleStatus;
}

export interface PaginatedCheckpoints {
  checkpoints: CheckpointRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function getNodeSqlite(): any {
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      if (typeof (process as any).getBuiltinModule === 'function') {
        const mod = (process as any).getBuiltinModule('node:sqlite');
        if (mod) return mod;
      }
      const nodeMod = (process as any).getBuiltinModule?.('node:module');
      if (nodeMod?.createRequire) {
        return nodeMod.createRequire(import.meta.url)('node:sqlite');
      }
    } catch {}
  }
  return null;
}

export class CheckpointDatabase {
  private db: any = null;
  private dbPath: string;

  // In-memory fallback maps
  private memCheckpoints = new Map<string, CheckpointRecord>();
  private memRestoreOps = new Map<string, RestoreOperationRecord>();
  private activeCheckpoints = new Map<string, { checkpointId: string; updatedAt: number }>();

  constructor(dbPath: string = ':memory:') {
    const configuredPath =
      dbPath === ':memory:' && typeof process !== 'undefined'
        ? (process.env?.AUTONEX_CHECKPOINT_DB_PATH || ':memory:')
        : dbPath;
    this.dbPath = configuredPath;
    const nodeSqlite = getNodeSqlite();

    if (nodeSqlite && nodeSqlite.DatabaseSync) {
      if (configuredPath !== ':memory:') {
        const dir = path.dirname(configuredPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new nodeSqlite.DatabaseSync(this.dbPath);
      this.initSchema();
    }
  }

  private browserActiveKey(projectId: string): string {
    return `autonex:checkpoint-active:${projectId}`;
  }

  private initSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        agent_task_id TEXT,
        owner_user_id TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        execution_status TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL,
        archive_swarm_ref TEXT,
        context_swarm_ref TEXT,
        archive_checksum TEXT,
        context_checksum TEXT,
        archive_size INTEGER DEFAULT 0,
        file_count INTEGER DEFAULT 0,
        manifest_json TEXT,
        storage_provider TEXT DEFAULT 'swarm',
        schema_version TEXT DEFAULT '2.0.0',
        encryption_metadata_json TEXT,
        failure_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_chk_proj_created 
        ON checkpoints(project_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_chk_owner 
        ON checkpoints(owner_user_id);

      CREATE INDEX IF NOT EXISTS idx_chk_parent 
        ON checkpoints(parent_checkpoint_id);

      CREATE TABLE IF NOT EXISTS restore_operations (
        restore_id TEXT PRIMARY KEY,
        checkpoint_id TEXT NOT NULL,
        safety_checkpoint_id TEXT,
        initiating_user TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        failure_details TEXT,
        restored_files_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_restore_chk 
        ON restore_operations(checkpoint_id);

      CREATE TABLE IF NOT EXISTS active_checkpoints (
        project_id TEXT PRIMARY KEY,
        checkpoint_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  public setActiveCheckpoint(projectId: string, checkpointId: string): void {
    const updatedAt = Date.now();
    if (this.db) {
      this.db.prepare(`
        INSERT INTO active_checkpoints (project_id, checkpoint_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET checkpoint_id = excluded.checkpoint_id, updated_at = excluded.updated_at
      `).run(projectId, checkpointId, updatedAt);
      return;
    }
    this.activeCheckpoints.set(projectId, { checkpointId, updatedAt });
    persistBrowserActiveCheckpoint(projectId, checkpointId);
  }

  public getActiveCheckpoint(projectId: string): string | null {
    if (this.db) {
      const row = this.db.prepare(
        'SELECT checkpoint_id FROM active_checkpoints WHERE project_id = ?'
      ).get(projectId) as { checkpoint_id?: string } | undefined;
      return row?.checkpoint_id || null;
    }
    const memoryValue = this.activeCheckpoints.get(projectId)?.checkpointId;
    if (memoryValue) return memoryValue;
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(this.browserActiveKey(projectId));
        if (raw) {
          const parsed = JSON.parse(raw) as { checkpointId?: string; updatedAt?: number };
          if (parsed.checkpointId) {
            this.activeCheckpoints.set(projectId, {
              checkpointId: parsed.checkpointId,
              updatedAt: parsed.updatedAt || Date.now(),
            });
            return parsed.checkpointId;
          }
        }
      } catch (error) {
        console.warn('Unable to read the persisted active checkpoint from browser storage.', error);
      }
    }
    return null;
  }

  /**
   * Inserts a new checkpoint record.
   */
  public insertCheckpoint(record: CheckpointRecord): void {
    if (this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO checkpoints (
          checkpoint_id, project_id, parent_checkpoint_id, agent_task_id,
          owner_user_id, description, created_at, execution_status,
          lifecycle_status, archive_swarm_ref, context_swarm_ref,
          archive_checksum, context_checksum, archive_size, file_count,
          manifest_json, storage_provider, schema_version,
          encryption_metadata_json, failure_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        record.checkpointId,
        record.projectId,
        record.parentCheckpointId,
        record.agentTaskId,
        record.ownerUserId,
        record.description,
        record.createdAt,
        record.executionStatus,
        record.lifecycleStatus,
        record.archiveSwarmRef,
        record.contextSwarmRef,
        record.archiveChecksum,
        record.contextChecksum,
        record.archiveSize,
        record.fileCount,
        record.manifestJson,
        record.storageProvider,
        record.schemaVersion,
        record.encryptionMetadataJson || null,
        record.failureReason || null
      );
    }
    this.memCheckpoints.set(record.checkpointId, { ...record });
  }

  /**
   * Updates checkpoint lifecycle status and associated fields.
   */
  public updateCheckpointLifecycle(
    checkpointId: string,
    status: CheckpointLifecycleStatus,
    updates?: Partial<CheckpointRecord>
  ): void {
    if (this.db) {
      const fields: string[] = ['lifecycle_status = ?'];
      const values: any[] = [status];

      if (updates) {
        if (updates.archiveSwarmRef !== undefined) {
          fields.push('archive_swarm_ref = ?');
          values.push(updates.archiveSwarmRef);
        }
        if (updates.contextSwarmRef !== undefined) {
          fields.push('context_swarm_ref = ?');
          values.push(updates.contextSwarmRef);
        }
        if (updates.archiveChecksum !== undefined) {
          fields.push('archive_checksum = ?');
          values.push(updates.archiveChecksum);
        }
        if (updates.contextChecksum !== undefined) {
          fields.push('context_checksum = ?');
          values.push(updates.contextChecksum);
        }
        if (updates.archiveSize !== undefined) {
          fields.push('archive_size = ?');
          values.push(updates.archiveSize);
        }
        if (updates.fileCount !== undefined) {
          fields.push('file_count = ?');
          values.push(updates.fileCount);
        }
        if (updates.manifestJson !== undefined) {
          fields.push('manifest_json = ?');
          values.push(updates.manifestJson);
        }
        if (updates.failureReason !== undefined) {
          fields.push('failure_reason = ?');
          values.push(updates.failureReason);
        }
        if (updates.encryptionMetadataJson !== undefined) {
          fields.push('encryption_metadata_json = ?');
          values.push(updates.encryptionMetadataJson);
        }
        if (updates.executionStatus !== undefined) {
          fields.push('execution_status = ?');
          values.push(updates.executionStatus);
        }
      }

      values.push(checkpointId);
      const sql = `UPDATE checkpoints SET ${fields.join(', ')} WHERE checkpoint_id = ?`;
      this.db.prepare(sql).run(...values);
    }

    const existing = this.memCheckpoints.get(checkpointId);
    if (existing) {
      this.memCheckpoints.set(checkpointId, {
        ...existing,
        ...updates,
        lifecycleStatus: status,
      });
    }
  }

  /**
   * Retrieves a checkpoint record by its ID.
   */
  public getCheckpointById(checkpointId: string): CheckpointRecord | null {
    if (this.db) {
      const stmt = this.db.prepare('SELECT * FROM checkpoints WHERE checkpoint_id = ?');
      const row = stmt.get(checkpointId) as any;
      if (row) return this.mapRowToCheckpoint(row);
    }

    return this.memCheckpoints.get(checkpointId) || null;
  }

  /** Imports an Arkiv record without replacing an existing local historical version. */
  public importCheckpoint(record: CheckpointRecord): void {
    if (this.getCheckpointById(record.checkpointId)) return;
    this.insertCheckpoint(record);
  }

  /**
   * Retrieves all checkpoints that were left in an incomplete state (PENDING, UPLOADING)
   */
  public getIncompleteCheckpoints(projectId?: string): CheckpointRecord[] {
    if (this.db) {
      let sql = `SELECT * FROM checkpoints WHERE lifecycle_status IN ('PENDING', 'UPLOADING')`;
      const params: any[] = [];
      if (projectId) {
        sql += ` AND project_id = ?`;
        params.push(projectId);
      }
      const rows = this.db.prepare(sql).all(...params);
      return rows.map((r: any) => this.mapRowToCheckpoint(r));
    }
    return Array.from(this.memCheckpoints.values()).filter(
      (c) => (c.lifecycleStatus === 'PENDING' || c.lifecycleStatus === 'UPLOADING') && (!projectId || c.projectId === projectId)
    );
  }

  /**
   * Lists paginated checkpoints for a project.
   */
  public listCheckpointsByProject(
    projectId: string,
    options?: ListCheckpointsOptions
  ): PaginatedCheckpoints {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const offset = (page - 1) * limit;

    if (this.db) {
      let countSql = 'SELECT COUNT(*) as total FROM checkpoints WHERE project_id = ?';
      let querySql = 'SELECT * FROM checkpoints WHERE project_id = ?';
      const params: any[] = [projectId];

      if (options?.lifecycleStatus) {
        countSql += ' AND lifecycle_status = ?';
        querySql += ' AND lifecycle_status = ?';
        params.push(options.lifecycleStatus);
      }

      querySql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

      const countRes = this.db.prepare(countSql).get(...params) as any;
      const total = countRes ? Number(countRes.total) : 0;
      const rows = this.db.prepare(querySql).all(...params, limit, offset) as any[];
      const checkpoints = rows.map((r) => this.mapRowToCheckpoint(r));

      return {
        checkpoints,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

    // In-memory fallback
    const all = Array.from(this.memCheckpoints.values())
      .filter((c) => c.projectId === projectId && (!options?.lifecycleStatus || c.lifecycleStatus === options.lifecycleStatus))
      .sort((a, b) => b.createdAt - a.createdAt);

    const total = all.length;
    const checkpoints = all.slice(offset, offset + limit);

    return {
      checkpoints,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  public listAllCheckpoints(options?: ListCheckpointsOptions): PaginatedCheckpoints {
    const page = Math.max(1, options?.page || 1);
    const limit = Math.min(100, Math.max(1, options?.limit || 20));
    const offset = (page - 1) * limit;
    const where = options?.lifecycleStatus ? ' WHERE lifecycle_status = ?' : '';
    const params = options?.lifecycleStatus ? [options.lifecycleStatus] : [];

    if (this.db) {
      const totalRow = this.db.prepare(`SELECT COUNT(*) AS total FROM checkpoints${where}`).get(...params) as any;
      const rows = this.db.prepare(`SELECT * FROM checkpoints${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];
      const total = Number(totalRow?.total || 0);
      return { checkpoints: rows.map((row) => this.mapRowToCheckpoint(row)), total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
    }

    const all = Array.from(this.memCheckpoints.values())
      .filter((c) => !options?.lifecycleStatus || c.lifecycleStatus === options.lifecycleStatus)
      .sort((a, b) => b.createdAt - a.createdAt);
    return { checkpoints: all.slice(offset, offset + limit), total: all.length, page, limit, totalPages: Math.ceil(all.length / limit) || 1 };
  }

  /**
   * Inserts a restoration operation record.
   */
  public insertRestoreOp(record: RestoreOperationRecord): void {
    if (this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO restore_operations (
          restore_id, checkpoint_id, safety_checkpoint_id,
          initiating_user, status, started_at, completed_at,
          failure_details, restored_files_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        record.restoreId,
        record.checkpointId,
        record.safetyCheckpointId,
        record.initiatingUser,
        record.status,
        record.startedAt,
        record.completedAt,
        record.failureDetails,
        record.restoredFilesCount
      );
    }
    this.memRestoreOps.set(record.restoreId, { ...record });
  }

  /**
   * Updates a restoration operation status.
   */
  public updateRestoreOp(
    restoreId: string,
    status: RestoreStatus,
    updates?: Partial<RestoreOperationRecord>
  ): void {
    if (this.db) {
      const fields: string[] = ['status = ?'];
      const values: any[] = [status];

      if (updates) {
        if (updates.completedAt !== undefined) {
          fields.push('completed_at = ?');
          values.push(updates.completedAt);
        }
        if (updates.failureDetails !== undefined) {
          fields.push('failure_details = ?');
          values.push(updates.failureDetails);
        }
        if (updates.restoredFilesCount !== undefined) {
          fields.push('restored_files_count = ?');
          values.push(updates.restoredFilesCount);
        }
      }

      values.push(restoreId);
      const sql = `UPDATE restore_operations SET ${fields.join(', ')} WHERE restore_id = ?`;
      this.db.prepare(sql).run(...values);
    }

    const existing = this.memRestoreOps.get(restoreId);
    if (existing) {
      this.memRestoreOps.set(restoreId, {
        ...existing,
        ...updates,
        status,
      });
    }
  }

  /**
   * Retrieves a restoration operation by ID.
   */
  public getRestoreOpById(restoreId: string): RestoreOperationRecord | null {
    if (this.db) {
      const stmt = this.db.prepare('SELECT * FROM restore_operations WHERE restore_id = ?');
      const row = stmt.get(restoreId) as any;
      if (row) {
        return {
          restoreId: row.restore_id,
          checkpointId: row.checkpoint_id,
          safetyCheckpointId: row.safety_checkpoint_id,
          initiatingUser: row.initiating_user,
          status: row.status as RestoreStatus,
          startedAt: Number(row.started_at),
          completedAt: row.completed_at ? Number(row.completed_at) : null,
          failureDetails: row.failure_details,
          restoredFilesCount: Number(row.restored_files_count || 0),
        };
      }
    }
    return this.memRestoreOps.get(restoreId) || null;
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private mapRowToCheckpoint(row: any): CheckpointRecord {
    return {
      checkpointId: row.checkpoint_id,
      projectId: row.project_id,
      parentCheckpointId: row.parent_checkpoint_id,
      agentTaskId: row.agent_task_id,
      ownerUserId: row.owner_user_id,
      description: row.description || '',
      createdAt: Number(row.created_at),
      executionStatus: row.execution_status as CheckpointExecutionStatus,
      lifecycleStatus: row.lifecycle_status as CheckpointLifecycleStatus,
      archiveSwarmRef: row.archive_swarm_ref,
      contextSwarmRef: row.context_swarm_ref,
      archiveChecksum: row.archive_checksum,
      contextChecksum: row.context_checksum,
      archiveSize: Number(row.archive_size || 0),
      fileCount: Number(row.file_count || 0),
      manifestJson: row.manifest_json,
      storageProvider: row.storage_provider || 'swarm',
      schemaVersion: row.schema_version || '2.0.0',
      encryptionMetadataJson: row.encryption_metadata_json,
      failureReason: row.failure_reason,
    };
  }
}
