/**
 * Unified Storage Workflow: Arkiv + Ethereum Swarm
 *
 * Implements the decentralized data-storage pipeline:
 * 1. Arkiv: Source of truth for user identity, project metadata, report IDs,
 *    timestamps, and pointers to Swarm storage.
 * 2. Swarm: Content-addressed store for large context and report files
 *    (Markdown reports, JSON context, code bundles).
 * 3. Cryptographic Verification: Computes and validates SHA-256 integrity hash
 *    linking Arkiv metadata to the Swarm content.
 */

import { type WalletClient } from 'viem';
import {
  uploadContextFile,
  getContextFile,
  verifyContentIntegrity,
  calculateSHA256,
  type SwarmUploadResult,
  type SwarmGetResult,
} from './swarm/operations';
import {
  saveArkivContextRef,
  getArkivContextRefByReportId,
  getLatestArkivContextRef,
  getArkivContextRefsByProject,
  getAllArkivContextRefs,
  registerArkivUser,
  createArkivProject,
  getArkivUserByWallet,
  getArkivProjectsByUser,
} from './arkiv/operations';

export interface UploadContextWorkflowOptions {
  projectId: string;
  userId: string;
  reportId?: string;
  fileName?: string;
  contentType?: string;
  summary?: string;
}

export interface UploadContextWorkflowResult {
  reportId: string;
  projectId: string;
  userId: string;
  swarmReference: string;
  contentHash: string;
  fileSize: number;
  fileName: string;
  contentType: string;
  entityKey: string;
  txHash: string;
}

export interface RetrieveContextWorkflowResult {
  verified: boolean;
  content: string;
  rawBytes: Uint8Array;
  contentType: string;
  fileSize: number;
  expectedHash: string;
  actualHash: string;
  metadata: {
    reportId: string;
    projectId: string;
    userId: string;
    owner: string;
    storageProvider: string;
    swarmRef: string;
    contentHash: string;
    fileName: string;
    fileSize: number;
    createdAt: number;
    summary?: string;
    entityKey: string;
  };
}

/**
 * 1. Upload Context Workflow:
 *    - Uploads file payload to Ethereum Swarm
 *    - Obtains Swarm BZZ content reference and SHA-256 hash
 *    - Records metadata pointer and hashes on Arkiv Rabdi DB-Chain
 */
export async function uploadContextWorkflow(
  walletClient: WalletClient,
  content: string | Uint8Array,
  options: UploadContextWorkflowOptions
): Promise<UploadContextWorkflowResult> {
  const reportId = options.reportId || `rep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fileName = options.fileName || 'autonex-context-report.json';
  const contentType = options.contentType || 'application/json';

  // Step 1: Upload to Ethereum Swarm content-addressed storage
  const swarmResult: SwarmUploadResult = await uploadContextFile(
    content,
    fileName,
    contentType
  );

  // Step 2: Record metadata and Swarm reference on Arkiv
  const arkivResult = await saveArkivContextRef(walletClient, {
    reportId,
    projectId: options.projectId,
    userId: options.userId,
    storageProvider: 'swarm',
    swarmRef: swarmResult.swarmReference,
    contentHash: swarmResult.contentHash,
    fileName: swarmResult.fileName,
    contentType: swarmResult.contentType,
    fileSize: swarmResult.fileSize,
    summary: options.summary || `Autonex deliverable context for ${options.projectId}`,
  });

  return {
    reportId,
    projectId: options.projectId,
    userId: options.userId,
    swarmReference: swarmResult.swarmReference,
    contentHash: swarmResult.contentHash,
    fileSize: swarmResult.fileSize,
    fileName: swarmResult.fileName,
    contentType: swarmResult.contentType,
    entityKey: arkivResult.entityKey,
    txHash: arkivResult.txHash,
  };
}

/**
 * 2. Retrieve Context Workflow:
 *    - Queries Arkiv for metadata by reportId
 *    - Retrieves file payload from Ethereum Swarm by swarm_ref
 *    - Verifies cryptographic SHA-256 integrity against content_hash
 */
export async function retrieveContextWorkflow(
  reportId: string,
  entityKey?: string
): Promise<RetrieveContextWorkflowResult> {
  // Step 1: Query Arkiv for the authoritative context pointer
  const meta = await getArkivContextRefByReportId(reportId, entityKey as any);
  if (!meta) {
    throw new Error(`Arkiv metadata record not found for reportId: "${reportId}"`);
  }

  // Step 2: Retrieve file content from Ethereum Swarm
  const swarmData: SwarmGetResult = await getContextFile(meta.swarmRef);

  // Step 3: Verify cryptographic SHA-256 integrity
  const actualHash = await calculateSHA256(swarmData.rawBytes);
  const verified = actualHash.toLowerCase() === meta.contentHash.toLowerCase();

  if (!verified) {
    console.error(
      `[Security Alert] SHA-256 hash mismatch for report ${reportId}! Expected: ${meta.contentHash}, Actual: ${actualHash}`
    );
  }

  return {
    verified,
    content: swarmData.content,
    rawBytes: swarmData.rawBytes,
    contentType: swarmData.contentType,
    fileSize: swarmData.fileSize,
    expectedHash: meta.contentHash,
    actualHash,
    metadata: {
      reportId: meta.reportId,
      projectId: meta.projectId,
      userId: meta.userId,
      owner: meta.owner,
      storageProvider: meta.storageProvider,
      swarmRef: meta.swarmRef,
      contentHash: meta.contentHash,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      createdAt: meta.createdAt,
      summary: meta.summary,
      entityKey: meta.key,
    },
  };
}

/**
 * 3. Retrieve Latest Context Workflow for a Project:
 *    - Queries Arkiv for the most recent context ref for a given projectId
 *    - Fetches from Swarm and verifies SHA-256
 */
export async function retrieveLatestContextWorkflow(
  projectId: string
): Promise<RetrieveContextWorkflowResult | null> {
  const meta = await getLatestArkivContextRef(projectId);
  if (!meta) return null;

  return retrieveContextWorkflow(meta.reportId);
}

/**
 * 4. User and Project Onboarding Workflow:
 *    - Registers user identity on Arkiv
 *    - Initializes project workspace record on Arkiv
 */
export async function setupUserAndProjectWorkflow(
  walletClient: WalletClient,
  options: {
    userId: string;
    displayName: string;
    projectId: string;
    projectName: string;
    projectDescription?: string;
  }
) {
  const userResult = await registerArkivUser(walletClient, {
    userId: options.userId,
    displayName: options.displayName,
  });

  const projectResult = await createArkivProject(walletClient, {
    projectId: options.projectId,
    userId: options.userId,
    name: options.projectName,
    description: options.projectDescription,
  });

  return {
    userResult,
    projectResult,
  };
}

export {
  getArkivUserByWallet,
  getArkivProjectsByUser,
  getArkivContextRefsByProject,
  getAllArkivContextRefs,
};

