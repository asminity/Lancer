import JSZip from 'jszip';
import type { WalletClient } from 'viem';
import { getActiveStorageProvider } from './swarm/operations';
import { calculateSHA256 } from './checkpoint/crypto';
import { persistBrowserActiveCheckpoint } from './checkpoint/checkpointDb';
import {
  getArkivProjectsByUser,
  getArkivUserByWallet,
  saveArkivCheckpointBundle,
} from './arkiv/operations';

export interface DeliverableCheckpointInput {
  walletClient: WalletClient;
  userId: string;
  projectId: string;
  projectName: string;
  goal: string;
  files: Record<string, string>;
  aiContext: Record<string, unknown>;
  reportMarkdown?: string;
  parentCheckpointId?: string | null;
}

export interface DeliverableCheckpointResult {
  checkpointId: string;
  archiveReference: string;
  archiveHash: string;
  contextReference: string;
  contextHash: string;
  archiveBytes: number;
  contextBytes: number;
  userEntityCreated: boolean;
  projectEntityCreated: boolean;
  checkpointEntityKey: string;
  checkpointTxHash: string;
  contextReportId: string;
  contextEntityKey: string;
}

async function ensureArkivIdentity(input: DeliverableCheckpointInput) {
  let userEntityCreated = false;
  let projectEntityCreated = false;
  let userInput: { userId: string; displayName: string } | undefined;
  let projectInput: { projectId: string; userId: string; name: string; description?: string } | undefined;
  const existingUser = await getArkivUserByWallet(input.userId);
  if (!existingUser) {
    userInput = {
      userId: input.userId,
      displayName: input.userId,
    };
    userEntityCreated = true;
  }

  const projects = await getArkivProjectsByUser(input.userId);
  if (!projects.some((project) => project.projectId === input.projectId)) {
    projectInput = {
      projectId: input.projectId,
      userId: input.userId,
      name: input.projectName,
      description: input.goal.slice(0, 120),
    };
    projectEntityCreated = true;
  }
  return { userEntityCreated, projectEntityCreated, userInput, projectInput };
}

/**
 * Stores the actual generated deliverable and AI state as immutable Swarm
 * objects, then anchors only metadata and content references on Arkiv.
 */
export async function saveDeliverableCheckpoint(
  input: DeliverableCheckpointInput
): Promise<DeliverableCheckpointResult> {
  if (!input.walletClient.account) throw new Error('Connect a wallet before saving a checkpoint.');
  if (!Object.keys(input.files).length) throw new Error('Cannot save an empty deliverable.');

  const identity = await ensureArkivIdentity(input);
  const checkpointId = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const zip = new JSZip();
  for (const [filePath, content] of Object.entries(input.files)) {
    const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('../')) {
      throw new Error(`Invalid deliverable path: "${filePath}"`);
    }
    zip.file(normalized, content);
  }
  const archiveBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const contextBytes = new TextEncoder().encode(JSON.stringify({
    type: 'autonex_ai_context_snapshot',
    schemaVersion: '1.0.0',
    checkpointId,
    projectId: input.projectId,
    goal: input.goal,
    capturedAt: new Date().toISOString(),
    context: input.aiContext,
    reportMarkdown: input.reportMarkdown || '',
    filePaths: Object.keys(input.files),
  }));
  const provider = getActiveStorageProvider();
  const archive = await provider.uploadBinary(archiveBytes, { contentType: 'application/zip' });
  const context = await provider.uploadBinary(contextBytes, { contentType: 'application/json' });
  const archiveHash = calculateSHA256(archiveBytes);
  const contextHash = calculateSHA256(contextBytes);
  const manifestJson = JSON.stringify({
    version: '2.0.0',
    checkpointId,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
    archiveFormat: 'zip',
    compressionFormat: 'deflate',
    encryption: { enabled: false, algorithm: 'none' },
    files: Object.entries(input.files).map(([filePath, content]) => ({
      path: filePath.replace(/\\/g, '/').replace(/^\/+/, ''),
      size: new TextEncoder().encode(content).byteLength,
      sha256: calculateSHA256(content),
      mode: 0o644,
      mtime: new Date().toISOString(),
      type: 'file',
    })),
    exclusions: [],
    totalCapturedFiles: Object.keys(input.files).length,
    totalCapturedDirectories: 0,
    totalCapturedBytes: Object.values(input.files).reduce((total, content) => total + new TextEncoder().encode(content).byteLength, 0),
    archiveSha256: archiveHash,
    compressedSize: archiveBytes.byteLength,
    rawTarSize: archiveBytes.byteLength,
    metadata: { contextFormat: 'plain-json' },
  });

  const archiveContextInput = {
    reportId: `${checkpointId}:code`,
    projectId: input.projectId,
    userId: input.userId,
    storageProvider: 'swarm',
    swarmRef: archive.reference,
    contentHash: archiveHash,
    fileName: `${input.projectName}-source.zip`,
    contentType: 'application/zip',
    fileSize: archiveBytes.byteLength,
    summary: `Binary source deliverable for checkpoint ${checkpointId}`,
  };
  const contextInput = {
    reportId: `${checkpointId}:context`,
    projectId: input.projectId,
    userId: input.userId,
    storageProvider: 'swarm',
    swarmRef: context.reference,
    contentHash: contextHash,
    fileName: `${input.projectName}-ai-context.json`,
    contentType: 'application/json',
    fileSize: contextBytes.byteLength,
    summary: `AI context snapshot for checkpoint ${checkpointId}`,
  };
  const arkivCheckpoint = await saveArkivCheckpointBundle(
    input.walletClient,
    [archiveContextInput, contextInput],
    {
      checkpointId,
      projectId: input.projectId,
      parentCheckpointId: input.parentCheckpointId,
      runId: input.projectId,
      status: 'Completed',
      lifecycleStatus: 'COMPLETED',
      createdAt: Date.now(),
      archiveSwarmRef: archive.reference,
      archiveSha256: archiveHash,
      archiveBytesSize: archiveBytes.byteLength,
      contextSwarmRef: context.reference,
      contextSha256: contextHash,
      contextBytesSize: contextBytes.byteLength,
      fileCount: Object.keys(input.files).length,
      storageProvider: 'swarm',
      schemaVersion: '1.0.0',
      description: `Generated deliverable checkpoint for ${input.projectName}`,
      manifestJson,
      isActive: true,
    },
    {
      user: identity.userInput,
      project: identity.projectInput,
    }
  );
  // A newly created child checkpoint becomes the active branch head. Arkiv
  // history remains immutable; this pointer controls the local working branch.
  persistBrowserActiveCheckpoint(input.projectId, checkpointId);

  return {
    checkpointId,
    archiveReference: archive.reference,
    archiveHash,
    contextReference: context.reference,
    contextHash,
    archiveBytes: archiveBytes.byteLength,
    contextBytes: contextBytes.byteLength,
    ...identity,
    checkpointEntityKey: arkivCheckpoint.checkpointEntityKey,
    checkpointTxHash: arkivCheckpoint.txHash,
    contextReportId: `${checkpointId}:context`,
    contextEntityKey: arkivCheckpoint.contextEntityKey,
  };
}
