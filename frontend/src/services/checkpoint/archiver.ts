/**
 * AUTONEX Checkpoint Engine: Workspace Binary Snapshot Archiver
 *
 * Traverses workspace directories, applies exclusion policies, packs POSIX TAR streams,
 * applies native Zstandard compression, and generates tamper-proof manifests.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import tar from './tar';
import {
  type SnapshotOptions,
  type SnapshotResult,
  type CheckpointManifest,
  type ManifestFileEntry,
  type ManifestExclusionEntry,
} from './types';
import { normalizeRelativePath, evaluateExclusion } from './policy';
import { calculateSHA256, encryptPayload } from './crypto';

interface TraversalItem {
  fullPath: string;
  relativePath: string;
  isDirectory: boolean;
  stat: fs.Stats;
}

/**
 * Creates a genuine, compressed TAR + Zstandard binary snapshot of the workspace.
 */
export async function createWorkspaceSnapshot(options: SnapshotOptions): Promise<SnapshotResult> {
  const { workspaceDir, projectId } = options;
  const checkpointId = options.checkpointId || `chk_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
  const compressionLevel = Math.max(1, Math.min(19, options.compressionLevel ?? 3));

  if (!workspaceDir || !fs.existsSync(workspaceDir)) {
    throw new Error(`Workspace directory does not exist: "${workspaceDir}"`);
  }

  const rootStat = fs.statSync(workspaceDir);
  if (!rootStat.isDirectory()) {
    throw new Error(`Workspace path is not a directory: "${workspaceDir}"`);
  }

  // 1. Recursive Directory Traversal & Exclusion Filtering
  const capturedEntries: TraversalItem[] = [];
  const exclusions: ManifestExclusionEntry[] = [];

  function scan(currentDir: string) {
    const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true });

    // Track if directory is empty
    let hasNonExcludedChild = false;

    for (const dirent of dirEntries) {
      const fullPath = path.join(currentDir, dirent.name);
      const rawRelPath = path.relative(workspaceDir, fullPath);
      const relPath = normalizeRelativePath(rawRelPath);
      const isDir = dirent.isDirectory();

      // Check exclusion policy
      const check = evaluateExclusion(relPath, isDir, options.customExclusions);
      if (check.excluded) {
        let size = 0;
        try {
          if (!isDir) size = fs.statSync(fullPath).size;
        } catch {}
        exclusions.push({
          path: relPath,
          rule: check.rule || 'custom_exclusion',
          reason: check.reason || 'Excluded by policy',
          size,
        });
        continue;
      }

      hasNonExcludedChild = true;

      try {
        const stat = fs.statSync(fullPath);
        if (isDir) {
          capturedEntries.push({ fullPath, relativePath: relPath, isDirectory: true, stat });
          scan(fullPath);
        } else if (dirent.isFile()) {
          capturedEntries.push({ fullPath, relativePath: relPath, isDirectory: false, stat });
        }
      } catch (err: any) {
        console.warn(`[Archiver] Skipping unreadable file "${fullPath}":`, err?.message);
      }
    }
  }

  scan(workspaceDir);

  // 2. Stream into POSIX TAR Archive
  const pack = tar.pack();
  const manifestFiles: ManifestFileEntry[] = [];
  let totalCapturedBytes = 0;
  let totalCapturedFiles = 0;
  let totalCapturedDirectories = 0;

  // Collect packed TAR chunks
  const tarChunks: Buffer[] = [];
  pack.on('data', (chunk: any) => tarChunks.push(Buffer.from(chunk)));

  const tarPackPromise = new Promise<Buffer>((resolve, reject) => {
    pack.on('end', () => resolve(Buffer.concat(tarChunks)));
    pack.on('error', (err) => reject(err));
  });

  for (const item of capturedEntries) {
    if (item.isDirectory) {
      // Directory entry in TAR
      pack.entry({
        name: item.relativePath + '/',
        type: 'directory',
        mode: 0o755,
        mtime: item.stat.mtime,
      });
      totalCapturedDirectories++;
      manifestFiles.push({
        path: item.relativePath,
        size: 0,
        sha256: 'sha256:directory',
        mode: 0o755,
        mtime: item.stat.mtime.toISOString(),
        type: 'directory',
      });
    } else {
      // Binary-safe file reading
      const content = fs.readFileSync(item.fullPath);
      const fileSha256 = calculateSHA256(content);
      const mode = (item.stat.mode & 0o777) || 0o644;

      pack.entry(
        {
          name: item.relativePath,
          size: content.length,
          type: 'file',
          mode,
          mtime: item.stat.mtime,
        },
        content
      );

      totalCapturedBytes += content.length;
      totalCapturedFiles++;
      manifestFiles.push({
        path: item.relativePath,
        size: content.length,
        sha256: fileSha256,
        mode,
        mtime: item.stat.mtime.toISOString(),
        type: 'file',
      });
    }
  }

  // Finalize TAR archive
  pack.finalize();
  const rawTarBuffer = await tarPackPromise;
  const rawTarSize = rawTarBuffer.length;

  // 3. Genuine Zstandard Compression (Node.js Native zlib)
  const zstdOpts: zlib.ZstdOptions = {
    params: {
      [zlib.constants.ZSTD_c_compressionLevel]: compressionLevel,
    },
  };
  const compressedBuffer = zlib.zstdCompressSync(rawTarBuffer, zstdOpts);
  const compressedSize = compressedBuffer.length;

  // 4. Authenticated AES-256-GCM Encryption (if key provided)
  let finalArchivePayload: Uint8Array;
  let encryptionMetadata: CheckpointManifest['encryption'];

  if (options.encryptionKey) {
    const enc = encryptPayload(compressedBuffer, options.encryptionKey);
    finalArchivePayload = enc.ciphertext;
    encryptionMetadata = {
      enabled: true,
      algorithm: 'AES-256-GCM',
      iv: enc.iv,
      authTag: enc.authTag,
      keyHint: 'client_managed',
    };
  } else {
    finalArchivePayload = new Uint8Array(compressedBuffer);
    encryptionMetadata = {
      enabled: false,
      algorithm: 'none',
    };
  }

  const archiveSha256 = calculateSHA256(finalArchivePayload);
  const encryptedSize = finalArchivePayload.byteLength;
  const compressionRatio = rawTarSize > 0 ? Number((compressedSize / rawTarSize).toFixed(3)) : 1;

  // 5. Versioned Checkpoint Manifest
  const manifest: CheckpointManifest = {
    version: '2.0.0',
    checkpointId,
    projectId,
    createdAt: new Date().toISOString(),
    archiveFormat: 'tar',
    compressionFormat: 'zstd',
    compressionLevel,
    encryption: encryptionMetadata,
    files: manifestFiles,
    exclusions,
    totalCapturedFiles,
    totalCapturedDirectories,
    totalCapturedBytes,
    archiveSha256,
    compressedSize,
    rawTarSize,
    metadata: options.metadata,
  };

  const manifestJson = JSON.stringify(manifest, null, 2);

  return {
    checkpointId,
    projectId,
    manifest,
    manifestJson,
    archiveBytes: finalArchivePayload,
    archiveSha256,
    rawTarSize,
    compressedSize,
    encryptedSize,
    compressionRatio,
  };
}
