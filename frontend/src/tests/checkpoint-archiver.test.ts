import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createWorkspaceSnapshot,
  extractWorkspaceSnapshot,
  generateEncryptionKey,
  calculateSHA256,
  decryptPayload,
} from '../services/checkpoint';

describe('AUTONEX Checkpoint Engine: Phase 2 Binary Snapshot Engine', () => {
  let tempBaseDir: string;
  let testWorkspaceDir: string;
  let restoreTargetDir: string;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonex_checkpoint_test_'));
    testWorkspaceDir = path.join(tempBaseDir, 'sample_workspace');
    restoreTargetDir = path.join(tempBaseDir, 'restored_workspace');
    fs.mkdirSync(testWorkspaceDir, { recursive: true });
    fs.mkdirSync(restoreTargetDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  it('1. Traversal & Relative Paths: preserves nested directory hierarchy and relative paths', async () => {
    // Setup nested files and empty directory
    fs.mkdirSync(path.join(testWorkspaceDir, 'src', 'components'), { recursive: true });
    fs.mkdirSync(path.join(testWorkspaceDir, 'empty_dir'), { recursive: true });
    fs.writeFileSync(path.join(testWorkspaceDir, 'package.json'), JSON.stringify({ name: 'test-app' }, null, 2));
    fs.writeFileSync(path.join(testWorkspaceDir, 'src', 'index.ts'), 'console.log("hello index");');
    fs.writeFileSync(path.join(testWorkspaceDir, 'src', 'components', 'App.tsx'), 'export const App = () => <div>App</div>;');

    const snapshot = await createWorkspaceSnapshot({
      workspaceDir: testWorkspaceDir,
      projectId: 'test-app-proj',
    });

    expect(snapshot.checkpointId).toBeDefined();
    expect(snapshot.manifest.archiveFormat).toBe('tar');
    expect(snapshot.manifest.compressionFormat).toBe('zstd');
    expect(snapshot.manifest.totalCapturedFiles).toBe(3);
    expect(snapshot.manifest.totalCapturedDirectories).toBeGreaterThanOrEqual(2);

    const relativePaths = snapshot.manifest.files.map((f) => f.path);
    expect(relativePaths).toContain('package.json');
    expect(relativePaths).toContain('src/index.ts');
    expect(relativePaths).toContain('src/components/App.tsx');
    expect(relativePaths).toContain('empty_dir');
  });

  it('2. Binary Assets & Unicode: captures binary assets and unicode filenames without corruption', async () => {
    // Binary asset: 4KB of random bytes
    const binaryData = Buffer.alloc(4096);
    for (let i = 0; i < 4096; i++) binaryData[i] = i % 256;
    fs.writeFileSync(path.join(testWorkspaceDir, 'asset.bin'), binaryData);

    // Unicode filenames
    const unicodeText = '# 日本語ドキュメント\n☕ Café test content';
    fs.writeFileSync(path.join(testWorkspaceDir, 'ドキュメント_Café_☕.md'), unicodeText, 'utf-8');

    const key = generateEncryptionKey();
    const snapshot = await createWorkspaceSnapshot({
      workspaceDir: testWorkspaceDir,
      projectId: 'unicode-binary-proj',
      encryptionKey: key,
    });

    expect(snapshot.manifest.encryption.enabled).toBe(true);
    expect(snapshot.manifest.encryption.algorithm).toBe('AES-256-GCM');

    // Restore into target dir
    const extraction = await extractWorkspaceSnapshot({
      archiveBytes: snapshot.archiveBytes,
      targetDir: restoreTargetDir,
      manifest: snapshot.manifest,
      decryptionKey: key,
    });

    expect(extraction.verifiedFileHashes).toBe(true);
    expect(extraction.restoredFilesCount).toBe(2);

    // Verify binary exactness
    const restoredBinary = fs.readFileSync(path.join(restoreTargetDir, 'asset.bin'));
    expect(Buffer.compare(restoredBinary, binaryData)).toBe(0);

    // Verify unicode exactness
    const restoredUnicode = fs.readFileSync(path.join(restoreTargetDir, 'ドキュメント_Café_☕.md'), 'utf-8');
    expect(restoredUnicode).toBe(unicodeText);
  });

  it('3. Large Files & Zstandard Compression Ratio: compresses large code files efficiently', async () => {
    // Generate a 1 MB repetitive TypeScript code bundle
    const codeSnippet = 'export function calculateMetrics(a: number, b: number) { return a * b + 42; }\n';
    const largeContent = codeSnippet.repeat(15000); // ~1.1 MB
    fs.writeFileSync(path.join(testWorkspaceDir, 'large_bundle.ts'), largeContent, 'utf-8');

    const snapshot = await createWorkspaceSnapshot({
      workspaceDir: testWorkspaceDir,
      projectId: 'large-file-proj',
      compressionLevel: 3,
    });

    expect(snapshot.rawTarSize).toBeGreaterThan(1000000);
    // Zstandard on repetitive source code achieves over 80% reduction
    expect(snapshot.compressedSize).toBeLessThan(snapshot.rawTarSize * 0.25);
    expect(snapshot.compressionRatio).toBeLessThan(0.25);

    // Restore and verify
    await extractWorkspaceSnapshot({
      archiveBytes: snapshot.archiveBytes,
      targetDir: restoreTargetDir,
      manifest: snapshot.manifest,
    });

    const restoredLarge = fs.readFileSync(path.join(restoreTargetDir, 'large_bundle.ts'), 'utf-8');
    expect(restoredLarge.length).toBe(largeContent.length);
    expect(calculateSHA256(restoredLarge)).toBe(calculateSHA256(largeContent));
  });

  it('4. Exclusion Policy: excludes .env, node_modules, build outputs, and records them in manifest', async () => {
    // Valid project files
    fs.writeFileSync(path.join(testWorkspaceDir, 'index.js'), 'console.log("prod");');

    // Excluded files
    fs.writeFileSync(path.join(testWorkspaceDir, '.env'), 'SECRET_API_KEY=0g_secret_9999');
    fs.writeFileSync(path.join(testWorkspaceDir, '.env.production'), 'JWT_SECRET=super_secret');
    fs.writeFileSync(path.join(testWorkspaceDir, 'private_key.pem'), '-----BEGIN PRIVATE KEY-----');

    // Excluded directories
    fs.mkdirSync(path.join(testWorkspaceDir, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(testWorkspaceDir, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;');

    fs.mkdirSync(path.join(testWorkspaceDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(testWorkspaceDir, 'dist', 'bundle.min.js'), 'minified');

    fs.mkdirSync(path.join(testWorkspaceDir, '.git', 'objects'), { recursive: true });
    fs.writeFileSync(path.join(testWorkspaceDir, '.git', 'HEAD'), 'ref: refs/heads/main');

    const snapshot = await createWorkspaceSnapshot({
      workspaceDir: testWorkspaceDir,
      projectId: 'excluded-secrets-proj',
    });

    // Valid files captured
    expect(snapshot.manifest.totalCapturedFiles).toBe(1);
    expect(snapshot.manifest.files[0].path).toBe('index.js');

    // Excluded files cataloged
    const excludedPaths = snapshot.manifest.exclusions.map((e) => e.path);
    expect(excludedPaths).toContain('.env');
    expect(excludedPaths).toContain('.env.production');
    expect(excludedPaths).toContain('private_key.pem');
    expect(excludedPaths.some((p) => p.includes('node_modules'))).toBe(true);
    expect(excludedPaths.some((p) => p.includes('dist'))).toBe(true);
    expect(excludedPaths.some((p) => p.includes('.git'))).toBe(true);

    // Verify extraction does NOT restore secrets or node_modules
    await extractWorkspaceSnapshot({
      archiveBytes: snapshot.archiveBytes,
      targetDir: restoreTargetDir,
      manifest: snapshot.manifest,
    });

    expect(fs.existsSync(path.join(restoreTargetDir, 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(restoreTargetDir, '.env'))).toBe(false);
    expect(fs.existsSync(path.join(restoreTargetDir, 'private_key.pem'))).toBe(false);
    expect(fs.existsSync(path.join(restoreTargetDir, 'node_modules'))).toBe(false);
  });

  it('5. Encryption & Tamper Defense: AES-256-GCM authenticated encryption rejects invalid keys or modified payloads', async () => {
    fs.writeFileSync(path.join(testWorkspaceDir, 'secret_logic.ts'), 'export const key = 42;');

    const key = generateEncryptionKey();
    const wrongKey = generateEncryptionKey();

    const snapshot = await createWorkspaceSnapshot({
      workspaceDir: testWorkspaceDir,
      projectId: 'crypto-defense-proj',
      encryptionKey: key,
    });

    // Attempting extraction with wrong key must fail with explicit error
    await expect(
      extractWorkspaceSnapshot({
        archiveBytes: snapshot.archiveBytes,
        targetDir: restoreTargetDir,
        manifest: snapshot.manifest,
        decryptionKey: wrongKey,
      })
    ).rejects.toThrow(/Decryption failed: Integrity authentication check failed/);

    // Tampering with 1 byte of the ciphertext must trigger authentication tag failure
    const tamperedPayload = Buffer.from(snapshot.archiveBytes);
    tamperedPayload[tamperedPayload.length - 20] ^= 0xff; // Flip bits in ciphertext

    await expect(
      extractWorkspaceSnapshot({
        archiveBytes: tamperedPayload,
        targetDir: restoreTargetDir,
        manifest: { ...snapshot.manifest, archiveSha256: calculateSHA256(tamperedPayload) },
        decryptionKey: key,
      })
    ).rejects.toThrow(/Decryption failed: Integrity authentication check failed/);
  });

  it('6. Path Traversal Defense: rejects malicious TAR archives attempting to escape target directory', async () => {
    // Create valid manifest
    const manifest = {
      version: '2.0.0' as const,
      checkpointId: 'chk_attack_test',
      projectId: 'attack-test',
      createdAt: new Date().toISOString(),
      archiveFormat: 'tar' as const,
      compressionFormat: 'zstd' as const,
      compressionLevel: 3,
      encryption: { enabled: false, algorithm: 'none' as const },
      files: [{ path: '../../escape.txt', size: 12, sha256: 'sha256:any', mode: 0o644, mtime: new Date().toISOString(), type: 'file' as const }],
      exclusions: [],
      totalCapturedFiles: 1,
      totalCapturedDirectories: 0,
      totalCapturedBytes: 12,
      archiveSha256: '',
      compressedSize: 0,
      rawTarSize: 0,
    };

    // Construct raw TAR with relative path traversal
    const tar = await import('../services/checkpoint/tar');
    const pack = tar.pack();
    pack.entry({ name: '../../escape.txt' }, 'evil content');
    pack.finalize();

    const chunks: Buffer[] = [];
    pack.on('data', (c: any) => chunks.push(Buffer.from(c)));
    const tarBuffer = await new Promise<Buffer>((resolve) => pack.on('end', () => resolve(Buffer.concat(chunks))));

    const zlib = await import('node:zlib');
    const compressed = zlib.zstdCompressSync(tarBuffer);
    manifest.archiveSha256 = calculateSHA256(compressed);

    await expect(
      extractWorkspaceSnapshot({
        archiveBytes: new Uint8Array(compressed),
        targetDir: restoreTargetDir,
        manifest,
      })
    ).rejects.toThrow(/Security Alert: Blocked path traversal attempt/);
  });

  it('7. End-to-End Hash Consistency: all restored file hashes match original file hashes bit-for-bit', async () => {
    // Generate complex workspace with multi-tier directory structure
    const filesToCreate = [
      ['src/api/client.ts', 'export class Client { id = 1; }'],
      ['src/api/types.ts', 'export interface Task { id: string; }'],
      ['src/ui/Header.tsx', 'export const Header = () => <header>AUTONEX</header>;'],
      ['README.md', '# Project Review SPA\nComplete multi-agent deliverables.'],
      ['config/settings.json', JSON.stringify({ theme: 'dark', concurrency: 4 }, null, 2)],
    ];

    for (const [relPath, content] of filesToCreate) {
      const full = path.join(testWorkspaceDir, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf-8');
    }

    const key = generateEncryptionKey();
    const snapshot = await createWorkspaceSnapshot({
      workspaceDir: testWorkspaceDir,
      projectId: 'hash-consistency-proj',
      encryptionKey: key,
    });

    const extraction = await extractWorkspaceSnapshot({
      archiveBytes: snapshot.archiveBytes,
      targetDir: restoreTargetDir,
      manifest: snapshot.manifest,
      decryptionKey: key,
    });

    expect(extraction.verifiedFileHashes).toBe(true);
    expect(extraction.restoredFilesCount).toBe(filesToCreate.length);

    // Verify bit-for-bit hash equality for every file
    for (const [relPath] of filesToCreate) {
      const originalPath = path.join(testWorkspaceDir, relPath);
      const restoredPath = path.join(restoreTargetDir, relPath);

      const originalBytes = fs.readFileSync(originalPath);
      const restoredBytes = fs.readFileSync(restoredPath);

      const originalHash = calculateSHA256(originalBytes);
      const restoredHash = calculateSHA256(restoredBytes);

      expect(restoredHash).toBe(originalHash);
    }
  });
});
