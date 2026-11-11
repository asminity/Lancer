import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAccount, useWalletClient } from 'wagmi';
import { useStore } from '@/state/store';
import { Icon, I } from './Icons';
import {
  CheckpointService,
  type CheckpointRecord,
  type CheckpointDetails,
  type CheckpointVerificationResult,
} from '@/services/checkpoint';
import { getAllArkivCheckpoints, saveArkivCheckpoint, setArkivCheckpointActive } from '@/services/arkiv/operations';
import type { ArkivCheckpointRecord } from '@/services/arkiv/operations';
import { saveDeliverableCheckpoint } from '@/services/deliverableCheckpointWorkflow';
import { CodeEditor } from './CodeEditor';

const sharedCheckpointService = new CheckpointService();

interface CheckpointModalProps {
  open?: boolean;
  onClose?: () => void;
}

type ModalTab = 'timeline' | 'details' | 'diff' | 'context';
type DiffMode = 'split' | 'unified';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  sha256?: string;
  children?: Record<string, FileNode>;
}

const RESTORATION_STAGES = [
  'Creating safety checkpoint',
  'Retrieving snapshot from Swarm',
  'Downloading AI context',
  'Verifying integrity',
  'Decrypting archive',
  'Extracting project files',
  'Validating workspace',
  'Restoring project',
  'Restoring AI context',
  'Refreshing editor',
];

export function CheckpointModal({ open: propsOpen, onClose: propsOnClose }: CheckpointModalProps) {
  const storeOpen = useStore((s) => s.checkpointModalOpen);
  const selectedCheckpointId = useStore((s) => s.selectedCheckpointId);
  const setStoreOpen = useStore((s) => s.setCheckpointModalOpen);
  const goal = useStore((s) => s.goal) || 'AUTONEX Project';
  const report = useStore((s) => s.report);
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();

  const isOpen = propsOpen !== undefined ? propsOpen : storeOpen;
  const handleClose = () => {
    if (propsOnClose) propsOnClose();
    else setStoreOpen(false, null);
  };

  const service = useMemo(() => sharedCheckpointService, []);
  const userId = address || '0xAUTONEX-ACTIVE-USER';
  const projectId = goal.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 32) || 'autonex-project';
  const inferredWorkspaceDir = useMemo(() => {
    const configured = (import.meta as any).env?.VITE_AUTONEX_WORKSPACE_DIR as string | undefined;
    if (configured?.trim()) return configured.trim();
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('autonex_workspace_dir');
      if (saved?.trim()) return saved.trim();
    }
    const outputMatch = report?.report_markdown?.match(/\*\*Output Directory:\*\*\s*`([^`]+)`/);
    if (outputMatch?.[1]) return outputMatch[1].trim();
    const sourceUrl = report?.sources?.[0]?.url;
    if (sourceUrl?.startsWith('file://')) {
      return sourceUrl.replace(/^file:\/\/\/?/, '').replace(/[/\\][^/\\]+$/, '');
    }
    return '';
  }, [report]);
  const [workspaceDir, setWorkspaceDir] = useState('');
  const [workspaceHandle, setWorkspaceHandle] = useState<any>(null);

  useEffect(() => {
    if (inferredWorkspaceDir && !workspaceDir) {
      setWorkspaceDir(inferredWorkspaceDir);
    }
  }, [inferredWorkspaceDir, workspaceDir]);

  // Checkpoint list & filtering
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [arkivCheckpoints, setArkivCheckpoints] = useState<ArkivCheckpointRecord[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'mine'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<'all' | 'active' | 'suppressed'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [groupByProject, setGroupByProject] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    if (!address && ownerFilter === 'mine') {
      setOwnerFilter('all');
    }
  }, [address, ownerFilter]);

  // Selected Checkpoint
  const [selectedId, setSelectedId] = useState<string | null>(selectedCheckpointId);
  const [details, setDetails] = useState<CheckpointDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<ModalTab>('details');

  // File tree & preview
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isBinaryFile, setIsBinaryFile] = useState(false);
  const [fileMeta, setFileMeta] = useState<{ size: number; sha256: string } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [snapshotFiles, setSnapshotFiles] = useState<Record<string, string>>({});
  const [editedFiles, setEditedFiles] = useState<Record<string, string>>({});
  const [sourceChanged, setSourceChanged] = useState(false);
  const [savingSource, setSavingSource] = useState(false);
  const [sourceLoadError, setSourceLoadError] = useState<string | null>(null);

  // Diff viewer
  const [diffMode, setDiffMode] = useState<DiffMode>('split');
  const [diffData, setDiffData] = useState<any | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [selectedDiffFile, setSelectedDiffFile] = useState<string | null>(null);

  // Verification
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<CheckpointVerificationResult | null>(null);

  // Restoration flow
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [restoreDiffLoading, setRestoreDiffLoading] = useState(false);
  const [restoreDiff, setRestoreDiff] = useState<any | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreStage, setRestoreStage] = useState<number>(0);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<any | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Sync selectedId with activeCheckpointId from store
  useEffect(() => {
    if (selectedCheckpointId) {
      setSelectedId(selectedCheckpointId);
      setActiveTab('details');
    }
  }, [selectedCheckpointId]);

  // Load checkpoint list
  const loadCheckpoints = async () => {
    setLoadingList(true);
    try {
      const arkivRecords = await getAllArkivCheckpoints(100);
      setArkivCheckpoints(arkivRecords);
      service.importArkivCheckpoints(arkivRecords);
      // Arkiv is the authoritative shared history. Do not hide checkpoints
      // merely because they were created under another project label.
      const res = service.listAllCheckpoints({
        page,
        limit: 15,
      });
      setCheckpoints(res.checkpoints || []);
      setTotalPages(res.totalPages || 1);
      const selectedStillExists = selectedId
        ? res.checkpoints.some((checkpoint) => checkpoint.checkpointId === selectedId)
        : false;
      if ((!selectedStillExists || !selectedId) && res.checkpoints.length > 0) {
        setSelectedId(res.checkpoints[0].checkpointId);
      }
    } catch (err: any) {
      const local = service.listAllCheckpoints({ page, limit: 15 });
      setCheckpoints(local.checkpoints || []);
      setTotalPages(local.totalPages || 1);
      useStore.setState({ toast: `Checkpoint history unavailable: ${err?.message || 'Arkiv query failed'}` });
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadCheckpoints();
    }
  }, [isOpen, projectId, page]);

  // Load details when selectedId changes
  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }
    setLoadingDetails(true);
    setSelectedFilePath(null);
    setFileContent(null);
    setDiffData(null);
    setVerificationResult(null);
    setSnapshotFiles({});
    setEditedFiles({});
    setSourceChanged(false);
    setSourceLoadError(null);

    const loadDetails = async () => {
      let checkpointDetails: CheckpointDetails;
      try {
        checkpointDetails = service.getCheckpointDetails(selectedId);
        setDetails(checkpointDetails);
      } catch (error: any) {
        setDetails(null);
        setSourceLoadError(error?.message || 'Unable to load checkpoint metadata.');
        setLoadingDetails(false);
        return;
      }

      try {
        const files = await service.getCheckpointFiles(selectedId);
        const textFiles = Object.fromEntries(
          files.filter((file) => !file.isBinary && file.content !== undefined)
            .map((file) => [file.path, file.content || ''])
        );
        setSnapshotFiles(textFiles);
        setEditedFiles(textFiles);
        const firstFile = checkpointDetails.manifest?.files.find((f) => f.type === 'file' && textFiles[f.path] !== undefined);
        if (firstFile) {
          await loadFilePreview(selectedId, firstFile.path, textFiles);
        } else if (checkpointDetails.manifest) {
          const first = checkpointDetails.manifest.files.find((f) => f.type === 'file');
          if (first) await loadFilePreview(selectedId, first.path);
        }
      } catch (error: any) {
        setSourceLoadError(error?.message || 'Unable to retrieve checkpoint source from Swarm.');
      } finally {
        setLoadingDetails(false);
      }
    };
    void loadDetails();
  }, [selectedId]);

  // Load file preview
  const loadFilePreview = async (checkpointId: string, filePath: string, localFiles?: Record<string, string>) => {
    setSelectedFilePath(filePath);
    setLoadingFile(true);
    setFileContent(null);
    setIsBinaryFile(false);
    try {
      const res = await service.getCheckpointFileContent(checkpointId, filePath);
      setIsBinaryFile(res.isBinary);
      setFileContent(localFiles?.[filePath] ?? res.content);
      setFileMeta({ size: res.size, sha256: res.sha256 });
    } catch (err: any) {
      setFileContent(`// Error loading file: ${err.message}`);
    } finally {
      setLoadingFile(false);
    }
  };

  const saveEditedCheckpoint = async () => {
    if (!selectedChk || !walletClient || !sourceChanged) return;
    setSavingSource(true);
    try {
      const allFiles = { ...editedFiles };
      const result = await saveDeliverableCheckpoint({
        walletClient,
        userId: userId,
        projectId: selectedChk.projectId,
        projectName: selectedChk.projectId,
        goal,
        files: allFiles,
        parentCheckpointId: selectedChk.checkpointId,
        aiContext: { store: useStore.getState() },
        reportMarkdown: `Edited from checkpoint ${selectedChk.checkpointId}`,
      });
      setSnapshotFiles(allFiles);
      setSourceChanged(false);
      const refreshedRecords = await getAllArkivCheckpoints(100);
      service.importArkivCheckpoints(refreshedRecords);
      await loadCheckpoints();
      setSelectedId(result.checkpointId);
      useStore.setState({ toast: `New checkpoint ${result.checkpointId} saved from edited source.` });
    } catch (error: any) {
      useStore.setState({ toast: error?.message || 'Could not save edited checkpoint.' });
    } finally {
      setSavingSource(false);
    }
  };

  // Load Diff
  const loadDiff = async () => {
    if (!details) return;
    setLoadingDiff(true);
    try {
      const parentId = details.checkpoint.parentCheckpointId;
      if (!parentId) {
        setDiffData({ noParent: true });
        return;
      }
      const diff = await service.getCheckpointDetailedDiff(parentId, details.checkpoint.checkpointId);
      setDiffData(diff);
      const firstChanged = diff.filesModified[0]?.path || diff.filesAdded[0]?.path || diff.filesRemoved[0]?.path;
      if (firstChanged) {
        setSelectedDiffFile(firstChanged);
      }
    } catch (err: any) {
      setDiffData({ error: err.message });
    } finally {
      setLoadingDiff(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'diff' && !diffData && details) {
      loadDiff();
    }
  }, [activeTab, details]);

  // Verify Checkpoint Integrity
  const handleVerify = async () => {
    if (!selectedId) return;
    setVerifying(true);
    setVerificationResult(null);
    try {
      const res = await service.verifyCheckpoint(selectedId);
      setVerificationResult(res);
    } catch (err: any) {
      setVerificationResult({
        checkpointId: selectedId,
        verified: false,
        archiveMatch: false,
        contextMatch: false,
        archiveHash: '',
        contextHash: '',
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setVerifying(false);
    }
  };

  const openRestoreConfirmation = async () => {
    if (!details) return;
    setRestoreDiffLoading(true);
    setRestoreDiff(null);
    try {
      const parentId = details.checkpoint.parentCheckpointId;
      if (parentId) {
        setRestoreDiff(await service.getCheckpointDetailedDiff(parentId, details.checkpoint.checkpointId));
      } else {
        setRestoreDiff({ noParent: true });
      }
      setConfirmDialogOpen(true);
    } catch (error: any) {
      setRestoreDiff({ error: error?.message || 'Unable to calculate checkpoint changes.' });
      setConfirmDialogOpen(true);
    } finally {
      setRestoreDiffLoading(false);
    }
  };

  // Execute Restoration Workflow
  const handleExecuteRestore = async () => {
    if (!details) return;
    setConfirmDialogOpen(false);
    setRestoring(true);
    setRestoreStage(0);
    setRestoreError(null);
    setRestoreSuccess(null);

    try {
      setRestoreStage(0);

      const res = !workspaceHandle
        ? await service.restoreCheckpointToBrowserState(
            details.checkpoint.checkpointId,
            userId
          )
        : workspaceHandle
        ? await service.restoreCheckpointInBrowser({
            checkpointId: details.checkpoint.checkpointId,
            requestingUserId: userId,
            workspaceHandle,
          })
        : null;

      setRestoreStage(9); // Refreshing editor

      if (!walletClient) {
        throw new Error('Checkpoint restored locally, but Arkiv active status could not be updated because no wallet is connected.');
      }
      const selectedArkiv = arkivCheckpoints.find(
        (record) => record.checkpointId === details.checkpoint.checkpointId
      );
      if (!selectedArkiv?.key) {
        throw new Error('Checkpoint restored locally, but its Arkiv entity key was not found for active-status update.');
      }
      const projectRecords = arkivCheckpoints.filter(
        (record) => record.projectId === details.checkpoint.projectId
      );
      const superseded = projectRecords.filter(
        (record) =>
          record.checkpointId !== details.checkpoint.checkpointId &&
          record.createdAt > details.checkpoint.createdAt &&
          record.isActive !== false
      );
      await Promise.all([
        setArkivCheckpointActive(walletClient, selectedArkiv.key, true),
        ...superseded.map((record) => setArkivCheckpointActive(walletClient, record.key, false)),
      ]);

      setRestoreSuccess(res);
      useStore.setState({
        toast: `✓ Checkpoint ${details.checkpoint.checkpointId} restored successfully!`,
      });
    } catch (err: any) {
      setRestoreError(err.message || 'Restoration failed due to an unexpected error.');
    } finally {
      setRestoring(false);
    }
  };

  const continueEditing = (mode: 'office' | 'swarm') => {
    if (!selectedChk || Object.keys(snapshotFiles).length === 0) {
      useStore.setState({ toast: 'Source files are still loading. Please wait before opening the editor.' });
      return;
    }
    useStore.setState({
      restoredWorkspaceFiles: { ...snapshotFiles },
      restoredCheckpointId: selectedChk.checkpointId,
    });
    useStore.getState().openProjectEditor(mode);
    handleClose();
  };

  const handleSaveCheckpoint = async () => {
    const configuredWorkspace = workspaceDir.trim();
    if (!configuredWorkspace) {
      setUploadError('Enter the absolute path of the active AUTONEX project directory below before uploading.');
      return;
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('autonex_workspace_dir', configuredWorkspace);
    }
    if (!walletClient) {
      setUploadError('Connect a wallet on Arkiv Rabdi DB-Chain before uploading a checkpoint.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const current = service.listCheckpoints(projectId, userId, { page: 1, limit: 1 }).checkpoints[0];
      const record = await service.createCheckpoint({
        projectId,
        ownerUserId: userId,
        workspaceDir: configuredWorkspace,
        goal,
        parentCheckpointId: current?.checkpointId ?? null,
        description: `Manual checkpoint for ${goal}`,
        stateSnapshot: useStore.getState(),
      });
      const encryption = record.encryptionMetadataJson ? JSON.parse(record.encryptionMetadataJson) : {};
      await saveArkivCheckpoint(walletClient, {
        checkpointId: record.checkpointId,
        projectId: record.projectId,
        parentCheckpointId: record.parentCheckpointId,
        agentTaskId: record.agentTaskId,
        status: record.executionStatus,
        lifecycleStatus: record.lifecycleStatus,
        createdAt: record.createdAt,
        archiveSwarmRef: record.archiveSwarmRef!,
        archiveSha256: record.archiveChecksum!,
        archiveBytesSize: record.archiveSize,
        contextSwarmRef: record.contextSwarmRef!,
        contextSha256: record.contextChecksum!,
        contextBytesSize: 0,
        encryptionIv: encryption.archiveIV,
        cipherAuthTag: encryption.archiveAuthTag,
        contextEncryptionIv: encryption.contextIV,
        contextAuthTag: encryption.contextAuthTag,
        fileCount: record.fileCount,
        description: record.description,
        manifestJson: record.manifestJson || undefined,
      });
      await loadCheckpoints();
      useStore.setState({ toast: `Checkpoint ${record.checkpointId} uploaded to Arkiv and Swarm.` });
    } catch (err: any) {
      setUploadError(err?.message || 'Checkpoint upload failed. Existing checkpoints were preserved.');
    } finally {
      setUploading(false);
    }
  };

  // Build File Tree Hierarchy
  const fileTree = useMemo(() => {
    if (!details?.manifest?.files) return null;
    const root: Record<string, FileNode> = {};

    for (const f of details.manifest.files) {
      const parts = f.path.split(/[\\/]/).filter(Boolean);
      let curr = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLast = i === parts.length - 1;
        const currentPath = parts.slice(0, i + 1).join('/');

        if (isLast) {
          curr[part] = {
            name: part,
            path: f.path,
            type: f.type === 'directory' ? 'dir' : 'file',
            size: f.size,
            sha256: f.sha256,
          };
        } else {
          if (!curr[part]) {
            curr[part] = {
              name: part,
              path: currentPath,
              type: 'dir',
              children: {},
            };
          }
          curr = curr[part].children!;
        }
      }
    }
    return root;
  }, [details]);

  // Filtered checkpoints
  const filteredCheckpoints = useMemo(() => {
    const arkivById = new Map(arkivCheckpoints.map((record) => [record.checkpointId, record]));
    const connectedOwner = address?.trim().toLowerCase();
    return checkpoints.filter((c) => {
      const arkivRecord = arkivById.get(c.checkpointId);
      const matchOwner =
        ownerFilter === 'all' ||
        Boolean(connectedOwner && arkivRecord?.owner?.trim().toLowerCase() === connectedOwner);
      const matchStatus =
        statusFilter === 'all' ||
        c.executionStatus.toLowerCase() === statusFilter.toLowerCase() ||
        c.lifecycleStatus.toLowerCase() === statusFilter.toLowerCase();
      const matchProject = projectFilter === 'all' || c.projectId === projectFilter;
      const isSuppressed = arkivRecord?.isActive === false;
      const matchBranch =
        branchFilter === 'all' ||
        (branchFilter === 'active' && !isSuppressed) ||
        (branchFilter === 'suppressed' && isSuppressed);

      return matchOwner && matchStatus && matchProject && matchBranch;
    }).sort((a, b) => sortOrder === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);
  }, [address, checkpoints, arkivCheckpoints, ownerFilter, statusFilter, projectFilter, branchFilter, sortOrder]);

  const projectOptions = useMemo(() => {
    return Array.from(new Set(checkpoints.map((checkpoint) => checkpoint.projectId).filter(Boolean))).sort();
  }, [checkpoints]);

  const groupedCheckpoints = useMemo(() => {
    if (!groupByProject) return [['All projects', filteredCheckpoints] as const];
    const groups = new Map<string, CheckpointRecord[]>();
    for (const checkpoint of filteredCheckpoints) {
      const group = groups.get(checkpoint.projectId) || [];
      group.push(checkpoint);
      groups.set(checkpoint.projectId, group);
    }
    return Array.from(groups.entries());
  }, [filteredCheckpoints, groupByProject]);

  if (!isOpen) return null;

  const selectedChk = details?.checkpoint;
  const activeCheckpointId =
    (selectedChk && service.getActiveCheckpoint(selectedChk.projectId)) ||
    checkpoints
      .map((checkpoint) => service.getActiveCheckpoint(checkpoint.projectId))
      .find((checkpointId): checkpointId is string => Boolean(checkpointId)) ||
    service.getActiveCheckpoint(projectId);
  const latestCheckpointId = activeCheckpointId
    || service.listAllCheckpoints({ page: 1, limit: 100 }).checkpoints[0]?.checkpointId
    || null;
  const canRestoreSelected = Boolean(selectedChk && selectedChk.checkpointId !== latestCheckpointId);
  const arkivStatusById = new Map(
    arkivCheckpoints.map((record) => [record.checkpointId, record.isActive])
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <motion.div
        initial={{ y: 24, scale: 0.98, opacity: 0 }}
        animate={{ y: 0, scale: 1, opacity: 1 }}
        exit={{ y: 16, opacity: 0 }}
        className="w-[1100px] max-w-full h-[88vh] bg-paper rounded-2xl shadow-2xl border border-ink/10 flex flex-col overflow-hidden isolate relative z-0"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-ink/10 bg-white/70">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-ink/5 border border-ink/10 text-ink">
              <Icon d={I.layers} size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-heading font-bold text-base text-ink">AUTONEX Checkpoint Engine</h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/20">
                  Swarm + Zstd
                </span>
              </div>
              <p className="text-xs text-ink/50 font-body">
                Cryptographically verified workspace snapshots & AI context states
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadCheckpoints}
              disabled={loadingList}
              className="p-1.5 rounded-lg border border-ink/15 text-ink/60 hover:text-ink hover:bg-white transition-colors"
              title="Refresh Checkpoint List"
            >
              <Icon d={I.sun} size={14} className={loadingList ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={handleSaveCheckpoint}
              disabled={uploading}
              className="px-2.5 py-1.5 rounded-lg bg-ink text-white text-[11px] font-semibold disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Save / Upload'}
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
            >
              <Icon d={I.x} size={18} />
            </button>
          </div>
          {uploadError && (
            <div className="mx-6 mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700">
              {uploadError}
            </div>
          )}
        </div>

        {/* Modal Body: Left Sidebar (Timeline) + Right Main (Inspector/Diff/Preview) */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Panel: Checkpoint Timeline */}
          <div className="w-80 sm:w-96 shrink-0 border-r border-ink/10 bg-[#FAF7F2]/80 flex flex-col min-h-0 relative">
            {/* Search & Filter Bar */}
            <div className="p-3 border-b border-ink/10 space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  value={ownerFilter}
                  onChange={(event) => setOwnerFilter(event.target.value as typeof ownerFilter)}
                  className="min-w-0 rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-[10px] text-ink outline-none"
                  aria-label="Filter by checkpoint owner"
                >
                  <option value="all">All checkpoints</option>
                  <option value="mine" disabled={!address}>My checkpoints{address ? '' : ' (connect wallet)'}</option>
                </select>
                <select
                  value={projectFilter}
                  onChange={(event) => setProjectFilter(event.target.value)}
                  className="min-w-0 rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-[10px] text-ink outline-none"
                  aria-label="Filter by project"
                >
                  <option value="all">All projects</option>
                  {projectOptions.map((project) => <option key={project} value={project}>{project}</option>)}
                </select>
                <select
                  value={branchFilter}
                  onChange={(event) => setBranchFilter(event.target.value as typeof branchFilter)}
                  className="min-w-0 rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-[10px] text-ink outline-none"
                  aria-label="Filter by branch status"
                >
                  <option value="all">All branch states</option>
                  <option value="active">Active only</option>
                  <option value="suppressed">Suppressed only</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}
                  className="flex-1 rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-[10px] text-ink outline-none"
                  aria-label="Sort checkpoints"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
                <button
                  onClick={() => setGroupByProject((value) => !value)}
                  className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                    groupByProject ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-ink/15 bg-white text-ink/60'
                  }`}
                  title="Group checkpoints by project ID"
                >
                  {groupByProject ? 'Grouped' : 'Flat'}
                </button>
                {(ownerFilter !== 'all' || projectFilter !== 'all' || branchFilter !== 'all' || statusFilter !== 'all' || sortOrder !== 'newest') && (
                  <button
                    onClick={() => {
                      setOwnerFilter('all');
                      setProjectFilter('all');
                      setBranchFilter('all');
                      setStatusFilter('all');
                      setSortOrder('newest');
                    }}
                    className="rounded-lg px-2 py-1.5 text-[10px] font-semibold text-ink/55 hover:bg-ink/5 hover:text-ink"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex gap-1 text-[11px] font-heading">
                {['all', 'completed', 'failed', 'interrupted'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`flex-1 py-1 rounded text-center capitalize transition-colors ${
                      statusFilter === st
                        ? 'bg-ink text-white font-semibold'
                        : 'bg-white/70 text-ink/60 hover:text-ink'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1 text-[10px] font-mono text-ink/45">
                <span>{filteredCheckpoints.length} matching checkpoint{filteredCheckpoints.length === 1 ? '' : 's'}</span>
                <span>{projectOptions.length} project{projectOptions.length === 1 ? '' : 's'} indexed</span>
              </div>
            </div>

            {/* Timeline List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2 relative">
              {loadingList && checkpoints.length === 0 ? (
                <div className="py-12 text-center text-xs text-ink/50 font-body">
                  Loading verified checkpoints...
                </div>
              ) : filteredCheckpoints.length === 0 ? (
                <div className="py-12 text-center text-xs text-ink/50 font-body space-y-1">
                  <p className="font-semibold text-ink/70">No checkpoints found</p>
                  <p className="text-[11px]">Checkpoints are automatically created around agent execution.</p>
                </div>
              ) : (
                groupedCheckpoints.map(([groupName, group]) => (
                  <div key={groupName} className="space-y-2">
                    {groupByProject && (
                      <div className="sticky top-0 z-10 flex items-center justify-between rounded-lg bg-[#FAF7F2] px-2.5 py-1 text-[10px] font-mono text-ink/70 border border-ink/10 shadow-xs backdrop-blur-sm">
                        <span className="truncate font-semibold">{groupName}</span>
                        <span className="px-1.5 py-0.5 rounded bg-ink/5 text-ink/60 font-bold">{group.length}</span>
                      </div>
                    )}
                    {group.map((chk) => {
                  const isSelected = chk.checkpointId === selectedId;
                  const isVerified = Boolean(chk.archiveSwarmRef && chk.lifecycleStatus === 'COMPLETED');
                  const isActive = chk.checkpointId === latestCheckpointId;
                  const isSuperseded = arkivStatusById.get(chk.checkpointId) === false;
                  const dateStr = new Date(chk.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                  return (
                    <div
                      key={chk.checkpointId}
                      onClick={() => !isSuperseded && setSelectedId(chk.checkpointId)}
                      aria-disabled={isSuperseded}
                      title={isSuperseded ? 'Superseded by the restored checkpoint; preserved in Arkiv history.' : undefined}
                      className={`p-3 rounded-xl border transition-all space-y-2 ${
                        isSuperseded
                          ? 'bg-ink/10 border-ink/10 text-ink/40 cursor-not-allowed grayscale opacity-60'
                          : 'cursor-pointer'
                      } ${
                        isSelected
                          ? 'bg-white border-[var(--accent)] shadow-sm'
                          : !isSuperseded && 'bg-white/60 border-ink/10 hover:border-ink/25 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-mono text-[11px] font-bold ${isSuperseded ? 'text-ink/45' : 'text-ink'}`}>
                          {chk.checkpointId.slice(0, 16)}...
                        </span>
                        <span className="text-[10px] font-mono text-ink/40">{dateStr}</span>
                      </div>

                      <p className={`text-xs font-body line-clamp-2 leading-relaxed ${isSuperseded ? 'text-ink/45' : 'text-ink/80'}`}>
                        {chk.description || 'Automated project checkpoint'}
                      </p>

                      <div className="flex items-center justify-between text-[10px] font-mono pt-1 border-t border-ink/5">
                        <div className="flex items-center gap-1.5">
                          {chk.agentTaskId && (
                            <span className="px-1.5 py-0.5 rounded bg-ink/5 font-semibold text-ink/70">
                              {chk.agentTaskId}
                            </span>
                          )}
                          <span className={`px-1.5 py-0.5 rounded font-medium ${
                            chk.executionStatus === 'Completed'
                              ? 'bg-emerald-500/15 text-emerald-700'
                              : chk.executionStatus === 'Failed'
                              ? 'bg-rose-500/15 text-rose-700'
                              : 'bg-amber-500/15 text-amber-700'
                          }`}>
                            {chk.executionStatus}
                          </span>
                          {isActive && (
                            <span className="px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] font-semibold">
                              Active
                            </span>
                          )}
                          {isSuperseded && (
                            <span className="px-1.5 py-0.5 rounded bg-ink/10 text-ink/50 font-semibold">
                              Superseded
                            </span>
                          )}
                        </div>

                        <span className={`flex items-center gap-1 ${
                          isVerified ? 'text-emerald-700 font-semibold' : 'text-amber-700'
                        }`}>
                          {isVerified ? '✓ Swarm' : 'Unverified'}
                        </span>
                      </div>
                    </div>
                  );
                })}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Panel: Checkpoint Details & Inspector */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {loadingDetails ? (
              <div className="flex-1 flex items-center justify-center text-xs text-ink/50">
                Retrieving checkpoint snapshot metadata...
              </div>
            ) : !selectedChk ? (
              <div className="flex-1 flex items-center justify-center text-xs text-ink/40">
                Select a checkpoint from the timeline to inspect its snapshot and source code.
              </div>
            ) : (
              <>
                {sourceLoadError && (
                  <div className="mx-4 mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
                    Source snapshot could not be loaded: {sourceLoadError}
                  </div>
                )}
                {/* Checkpoint Header Info */}
                <div className="p-4 border-b border-ink/10 bg-[#FAF7F2]/50 flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-heading font-bold text-base text-ink truncate">
                        {selectedChk.description || selectedChk.checkpointId}
                      </h3>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-ink/5 text-ink/70">
                        {selectedChk.checkpointId}
                      </span>
                      {selectedChk.checkpointId === latestCheckpointId && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700">
                          Active latest
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs font-mono text-ink/60 flex-wrap">
                      <span>Created: {new Date(selectedChk.createdAt).toLocaleString()}</span>
                      <span>•</span>
                      <span>Files: {selectedChk.fileCount}</span>
                      <span>•</span>
                      <span>Size: {(selectedChk.archiveSize / 1024).toFixed(1)} KB</span>
                      {selectedChk.parentCheckpointId && (
                        <>
                          <span>•</span>
                          <button
                            onClick={() => setSelectedId(selectedChk.parentCheckpointId!)}
                            className="text-blue-600 hover:underline"
                          >
                            Parent: {selectedChk.parentCheckpointId.slice(0, 12)}...
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Actions: Verify & Restore */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center rounded-xl border border-ink/15 bg-white/70 p-0.5">
                      <button
                        onClick={() => continueEditing('office')}
                        disabled={!selectedChk || !Object.keys(snapshotFiles).length}
                        className="px-2.5 py-1 text-[11px] font-heading font-semibold rounded-lg text-ink/75 hover:bg-ink/5 disabled:opacity-40"
                        title="Continue editing with the 3D desktop workspace"
                      >
                        Desktop Editor
                      </button>
                      <button
                        onClick={() => continueEditing('swarm')}
                        disabled={!selectedChk || !Object.keys(snapshotFiles).length}
                        className="px-2.5 py-1 text-[11px] font-heading font-semibold rounded-lg text-ink/75 hover:bg-ink/5 disabled:opacity-40"
                        title="Continue editing with the swarm workspace"
                      >
                        Swarm Editor
                      </button>
                    </div>
                    <button
                      onClick={handleVerify}
                      disabled={verifying}
                      className="px-3 py-1.5 rounded-xl border border-ink/15 text-xs font-heading font-medium hover:bg-white transition-colors"
                      title="Verify SHA-256 integrity against Swarm"
                    >
                      {verifying ? 'Verifying...' : '✓ Verify Integrity'}
                    </button>

                    {canRestoreSelected && (
                      <button
                        onClick={openRestoreConfirmation}
                        disabled={restoreDiffLoading}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-heading font-bold text-white shadow-xs transition-opacity hover:opacity-95 disabled:opacity-50"
                        style={{ background: 'var(--accent)' }}
                      >
                        {restoreDiffLoading ? 'Calculating changes…' : 'Restore Checkpoint ↺'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Sub-tab Navigation */}
                <div className="flex items-center gap-4 px-6 border-b border-ink/10 text-xs font-heading">
                  {(['details', 'diff', 'context'] as ModalTab[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`py-2.5 border-b-2 capitalize transition-colors ${
                        activeTab === tab
                          ? 'border-[var(--accent)] text-ink font-bold'
                          : 'border-transparent text-ink/50 hover:text-ink'
                      }`}
                    >
                      {tab === 'details' ? 'Source Explorer' : tab === 'diff' ? 'File Diff' : 'AI Context'}
                    </button>
                  ))}
                </div>

                {/* Tab 1: Source Explorer (File Tree + Preview) */}
                {activeTab === 'details' && (
                  <div className="flex-1 flex min-h-0 overflow-hidden">
                    {/* File Tree Hierarchy */}
                    <div className="w-64 border-r border-ink/10 bg-[#FAF7F2]/40 overflow-y-auto p-2 text-xs font-mono">
                      <div className="px-2 py-1 text-[10px] uppercase font-bold text-ink/40 tracking-wider">
                        Snapshot File Tree
                      </div>
                      {fileTree && Object.keys(fileTree).length > 0 ? (
                        <div className="space-y-0.5">
                          {Object.values(fileTree).map((node) => (
                            <TreeNode
                              key={node.path}
                              node={node}
                              selectedPath={selectedFilePath}
                              onSelect={(p) => loadFilePreview(selectedChk.checkpointId, p)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="p-3 text-ink/40">Empty workspace</div>
                      )}
                    </div>

                    {/* Source Code Preview */}
                    <div className="flex-1 flex flex-col min-w-0 bg-white">
                      {selectedFilePath ? (
                        <>
                            <div className="px-4 py-2 border-b border-ink/10 bg-white/80 flex items-center justify-between text-xs font-mono gap-2">
                            <span className="font-semibold text-ink truncate">{selectedFilePath}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                {sourceChanged && <span className="text-[10px] text-amber-700 font-semibold">Unsaved changes</span>}
                                <button
                                  onClick={saveEditedCheckpoint}
                                  disabled={!sourceChanged || savingSource}
                                  className="px-2.5 py-1 rounded-lg bg-[var(--accent)] text-white text-[10px] font-semibold disabled:opacity-40"
                                >
                                  {savingSource ? 'Saving…' : 'Create Checkpoint'}
                                </button>
                                {fileMeta && (
                                  <span className="text-[10px] text-ink/50">
                                    {fileMeta.size} bytes · {fileMeta.sha256.slice(0, 16)}...
                                  </span>
                                )}
                              </div>
                          </div>

                          <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed">
                            {loadingFile ? (
                              <div className="text-ink/40">Retrieving file from snapshot...</div>
                            ) : isBinaryFile ? (
                              <div className="p-8 text-center space-y-2 text-ink/60 font-body">
                                <div className="text-sm font-semibold">Binary Asset</div>
                                <p className="text-xs text-ink/40">
                                  Binary file cannot be previewed as text. Verified SHA-256 hash is preserved in snapshot.
                                </p>
                              </div>
                            ) : (
                              <CodeEditor
                                value={editedFiles[selectedFilePath] ?? fileContent ?? ''}
                                filePath={selectedFilePath}
                                onChange={(content) => {
                                  const next = {
                                    ...editedFiles,
                                    [selectedFilePath]: content,
                                  };
                                  setEditedFiles(next);
                                  setFileContent(content);
                                  setSourceChanged(
                                    Object.keys(next).some((path) => next[path] !== snapshotFiles[path])
                                  );
                                }}
                                className="h-full min-h-[360px]"
                                onSave={saveEditedCheckpoint}
                              />
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex items-center justify-center text-xs text-ink/40">
                          Select a file from the tree to preview its verified source code.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Tab 2: File Diff */}
                {activeTab === 'diff' && (
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {loadingDiff ? (
                      <div className="flex-1 flex items-center justify-center text-xs text-ink/50">
                        Calculating file diff against parent checkpoint...
                      </div>
                    ) : diffData?.noParent ? (
                      <div className="flex-1 flex items-center justify-center text-xs text-ink/50 p-6 text-center">
                        This is the initial checkpoint (CP-001). There is no parent checkpoint to compare against.
                      </div>
                    ) : diffData?.error ? (
                      <div className="flex-1 flex items-center justify-center text-xs text-rose-600 p-6">
                        Diff calculation error: {diffData.error}
                      </div>
                    ) : (
                      <div className="flex-1 flex min-h-0">
                        {/* Diff File List */}
                        <div className="w-72 border-r border-ink/10 bg-[#FAF7F2]/40 overflow-y-auto p-2 text-xs font-mono space-y-1">
                          <div className="px-2 py-1 flex items-center justify-between">
                            <span className="text-[10px] uppercase font-bold text-ink/40">Changed Files</span>
                            <div className="flex gap-1 text-[10px]">
                              <button
                                onClick={() => setDiffMode('split')}
                                className={`px-1.5 py-0.5 rounded ${diffMode === 'split' ? 'bg-ink text-white' : 'text-ink/60'}`}
                              >
                                Split
                              </button>
                              <button
                                onClick={() => setDiffMode('unified')}
                                className={`px-1.5 py-0.5 rounded ${diffMode === 'unified' ? 'bg-ink text-white' : 'text-ink/60'}`}
                              >
                                Inline
                              </button>
                            </div>
                          </div>

                          {diffData?.filesModified?.map((f: any) => (
                            <button
                              key={f.path}
                              onClick={() => setSelectedDiffFile(f.path)}
                              className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs ${
                                selectedDiffFile === f.path ? 'bg-white shadow-xs font-semibold' : 'hover:bg-white/60'
                              }`}
                            >
                              <span className="truncate">{f.path}</span>
                              <span className="text-[10px] text-amber-700 font-bold">~MOD</span>
                            </button>
                          ))}

                          {diffData?.filesAdded?.map((f: any) => (
                            <button
                              key={f.path}
                              onClick={() => setSelectedDiffFile(f.path)}
                              className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs ${
                                selectedDiffFile === f.path ? 'bg-white shadow-xs font-semibold' : 'hover:bg-white/60'
                              }`}
                            >
                              <span className="truncate">{f.path}</span>
                              <span className="text-[10px] text-emerald-700 font-bold">+ADD</span>
                            </button>
                          ))}

                          {diffData?.filesRemoved?.map((f: any) => (
                            <button
                              key={f.path}
                              onClick={() => setSelectedDiffFile(f.path)}
                              className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs ${
                                selectedDiffFile === f.path ? 'bg-white shadow-xs font-semibold' : 'hover:bg-white/60'
                              }`}
                            >
                              <span className="truncate">{f.path}</span>
                              <span className="text-[10px] text-rose-700 font-bold">-DEL</span>
                            </button>
                          ))}
                        </div>

                        {/* Diff Viewer Pane */}
                        <div className="flex-1 overflow-auto p-4 font-mono text-xs">
                          {selectedDiffFile ? (
                            <DiffViewDetail
                              filePath={selectedDiffFile}
                              diffData={diffData}
                              mode={diffMode}
                            />
                          ) : (
                            <div className="h-full flex items-center justify-center text-ink/40">
                              Select a changed file to view the line diff.
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Tab 3: AI Context */}
                {activeTab === 'context' && (
                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    <div className="p-4 rounded-xl bg-ink/3 border border-ink/10 space-y-3 text-xs font-mono">
                      <div className="flex justify-between border-b border-ink/10 pb-2">
                        <span className="text-ink/40">Storage Provider:</span>
                        <span className="font-bold text-ink">Ethereum Swarm (Bee)</span>
                      </div>
                      <div className="flex justify-between border-b border-ink/10 pb-2">
                        <span className="text-ink/40">Archive Swarm Ref:</span>
                        <span className="font-bold text-ink select-all">{selectedChk.archiveSwarmRef || 'None'}</span>
                      </div>
                      <div className="flex justify-between border-b border-ink/10 pb-2">
                        <span className="text-ink/40">Context Swarm Ref:</span>
                        <span className="font-bold text-ink select-all">{selectedChk.contextSwarmRef || 'None'}</span>
                      </div>
                      <div className="flex justify-between border-b border-ink/10 pb-2">
                        <span className="text-ink/40">Archive SHA-256:</span>
                        <span className="font-bold text-emerald-800 select-all">{selectedChk.archiveChecksum || 'None'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-ink/40">Context SHA-256:</span>
                        <span className="font-bold text-emerald-800 select-all">{selectedChk.contextChecksum || 'None'}</span>
                      </div>
                    </div>

                    {verificationResult && (
                      <div className={`p-4 rounded-xl border text-xs font-mono space-y-1 ${
                        verificationResult.verified
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}>
                        <div className="font-bold">
                          {verificationResult.verified ? '✓ Integrity Verified Bit-For-Bit' : '⚠ Verification Failed'}
                        </div>
                        <p className="text-[11px] opacity-80">
                          {verificationResult.verified
                            ? 'The binary archive and AI context snapshot downloaded from Ethereum Swarm match their canonical cryptographic SHA-256 hashes perfectly.'
                            : 'Cryptographic hash mismatch detected between expected metadata and downloaded Swarm bytes.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* Confirmation Dialog (Section D) */}
      <AnimatePresence>
        {confirmDialogOpen && selectedChk && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-60 bg-ink/70 backdrop-blur-xs flex items-center justify-center p-4"
            style={{ zIndex: 60 }}
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-paper rounded-2xl shadow-2xl border border-ink/15 p-6 space-y-4"
            >
              <div className="flex items-center gap-3 text-amber-700">
                <Icon d={I.alert} size={24} />
                <h3 className="font-heading font-bold text-lg text-ink">Restore this checkpoint?</h3>
              </div>

              <p className="text-xs text-ink/75 font-body leading-relaxed">
                AUTONEX will restore the selected checkpoint directly into the browser mini-IDE. Your Arkiv history remains immutable.
              </p>

              <div className="space-y-1.5">
                <label htmlFor="checkpoint-workspace-dir" className="text-[10px] uppercase tracking-wider font-bold text-ink/50">
                  Optional local export directory
                </label>
                <input
                  id="checkpoint-workspace-dir"
                  value={workspaceDir}
                  onChange={(event) => setWorkspaceDir(event.target.value)}
                  placeholder="/absolute/path/to/your/project"
                  className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-xs font-mono text-ink outline-none focus:border-[var(--accent)]"
                  spellCheck={false}
                />
                <p className="text-[10px] text-ink/45">
                  Not required for database/editor restoration. Select a folder only if you also want to write restored files to disk.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    const picker = (window as any).showDirectoryPicker;
                    if (!picker) {
                      setRestoreError('This browser does not support folder access. Use a Chromium-based browser or run restore through the AUTONEX bridge.');
                      return;
                    }
                    try {
                      const handle = await picker({ mode: 'readwrite' });
                      setWorkspaceHandle(handle);
                      setWorkspaceDir(handle.name || workspaceDir);
                    } catch (error: any) {
                      if (error?.name !== 'AbortError') {
                        setRestoreError(`Could not access the workspace folder: ${error?.message || 'permission denied'}`);
                      }
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg border border-ink/15 text-[11px] font-semibold hover:bg-white"
                >
                  {workspaceHandle ? `Export folder selected: ${workspaceHandle.name}` : 'Optionally select local export folder'}
                </button>
              </div>

              <div className="p-3 rounded-xl bg-ink/3 border border-ink/10 space-y-2 text-xs font-mono text-ink/80">
                <div className="flex justify-between">
                  <span className="text-ink/40">Selected Checkpoint:</span>
                  <span className="font-bold text-ink">{selectedChk.checkpointId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink/40">Description:</span>
                  <span className="font-semibold truncate max-w-[240px]">{selectedChk.description}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink/40">Created:</span>
                  <span>{new Date(selectedChk.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink/40">Files in Snapshot:</span>
                  <span className="font-bold text-emerald-700">{selectedChk.fileCount} files</span>
                </div>
              </div>

              <div className="rounded-xl border border-ink/10 overflow-hidden">
                <div className="px-3 py-2 bg-ink/5 text-[10px] uppercase tracking-wider font-bold text-ink/50">
                  Changes in this checkpoint
                </div>
                {restoreDiffLoading ? (
                  <div className="p-3 text-xs text-ink/50">Calculating file changes…</div>
                ) : restoreDiff?.error ? (
                  <div className="p-3 text-xs text-rose-700">{restoreDiff.error}</div>
                ) : restoreDiff?.noParent ? (
                  <div className="p-3 text-xs text-ink/50">Initial checkpoint; all files are additions.</div>
                ) : (
                  <div className="max-h-40 overflow-y-auto divide-y divide-ink/5 text-xs font-mono">
                    {[
                      ...(restoreDiff?.filesModified || []).map((file: any) => ({ ...file, marker: '~', label: 'modified', color: 'text-amber-700' })),
                      ...(restoreDiff?.filesAdded || []).map((file: any) => ({ ...file, marker: '+', label: 'added', color: 'text-emerald-700' })),
                      ...(restoreDiff?.filesRemoved || []).map((file: any) => ({ ...file, marker: '-', label: 'removed', color: 'text-rose-700' })),
                    ].map((file: any) => (
                      <div key={`${file.label}:${file.path}`} className="px-3 py-1.5 flex items-center gap-2">
                        <span className={`font-bold ${file.color}`}>{file.marker}</span>
                        <span className="truncate">{file.path}</span>
                        <span className={`ml-auto text-[10px] ${file.color}`}>{file.label}</span>
                      </div>
                    ))}
                    {!restoreDiff?.filesModified?.length && !restoreDiff?.filesAdded?.length && !restoreDiff?.filesRemoved?.length && (
                      <div className="p-3 text-xs text-ink/50">No file changes detected.</div>
                    )}
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-900 text-xs font-body space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <span>⚠ Recovery Notice:</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Changes made after this checkpoint may disappear from the active workspace. AUTONEX will create a safety checkpoint before restoration so you can undo at any time.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDialogOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-heading bg-ink/5 hover:bg-ink/10 text-ink/80"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecuteRestore}
                  className="px-4 py-2 rounded-xl text-xs font-heading font-bold text-white shadow-md hover:opacity-95"
                  style={{ background: 'var(--accent)' }}
                >
                  Restore into Mini-IDE
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Restoration Progress / Success Overlay (Section E & F) */}
      <AnimatePresence>
        {(restoring || restoreSuccess || restoreError) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-70 bg-ink/80 backdrop-blur-md flex items-center justify-center p-4"
            style={{ zIndex: 70 }}
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-paper rounded-2xl shadow-2xl border border-ink/15 p-6 space-y-5"
            >
              {restoring ? (
                <>
                  <div className="text-center space-y-1">
                    <h3 className="font-heading font-bold text-base text-ink">
                      Restoring Project Checkpoint
                    </h3>
                    <p className="text-xs text-ink/60 font-body">
                      Executing isolated staging extraction and atomic swap
                    </p>
                  </div>

                  {/* 10-Stage Progress List */}
                  <div className="space-y-1.5 py-2">
                    {RESTORATION_STAGES.map((st, idx) => {
                      const isDone = idx < restoreStage;
                      const isCurrent = idx === restoreStage;

                      return (
                        <div
                          key={st}
                          className={`flex items-center gap-2.5 text-xs font-mono py-1 px-2 rounded-lg transition-colors ${
                            isCurrent
                              ? 'bg-[var(--accent)]/10 text-ink font-bold'
                              : isDone
                              ? 'text-emerald-700'
                              : 'text-ink/30'
                          }`}
                        >
                          <span className="w-4 h-4 flex items-center justify-center text-[10px]">
                            {isDone ? '✓' : isCurrent ? '▶' : '·'}
                          </span>
                          <span>{st}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : restoreSuccess ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 space-y-2 text-center">
                    <div className="w-10 h-10 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto text-lg">
                      ✓
                    </div>
                    <h3 className="font-heading font-bold text-base">Workspace Restored Successfully</h3>
                    <p className="text-xs text-emerald-700 font-body">
                      Target workspace has been atomically replaced and editor buffers have been refreshed.
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-ink/3 border border-ink/10 space-y-1.5 text-xs font-mono text-ink/80">
                    <div className="flex justify-between">
                      <span className="text-ink/40">Restored Checkpoint:</span>
                      <span className="font-bold">{restoreSuccess.checkpointId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/40">Files Restored:</span>
                      <span className="font-bold text-emerald-700">{restoreSuccess.restoredFilesCount} files</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-ink/40">Restore Operation ID:</span>
                      <span className="font-mono text-[10px]">{restoreSuccess.restoreId}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setRestoreSuccess(null);
                      handleClose();
                    }}
                    className="w-full py-2.5 rounded-xl text-xs font-heading font-bold text-white shadow-md hover:opacity-95"
                    style={{ background: 'var(--accent)' }}
                  >
                    Open Restored Files in Editor
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 space-y-2">
                    <div className="font-bold flex items-center gap-2">
                      <Icon d={I.alert} size={18} />
                      <span>Restoration Aborted</span>
                    </div>
                    <p className="text-xs font-body leading-relaxed">{restoreError}</p>
                    <p className="text-[11px] text-rose-600 font-body">
                      Active workspace was preserved untouched. No destructive alterations took place.
                    </p>
                  </div>

                  <button
                    onClick={() => setRestoreError(null)}
                    className="w-full py-2 rounded-xl text-xs font-heading bg-ink/5 hover:bg-ink/10 text-ink/80"
                  >
                    Close
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// Subcomponents: File Tree Node
function TreeNode({
  node,
  selectedPath,
  onSelect,
}: {
  node: FileNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === 'dir') {
    return (
      <div className="space-y-0.5">
        <div
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-ink/5 cursor-pointer text-ink/70 font-semibold select-none"
        >
          <span className="text-[10px] opacity-50">{expanded ? '▼' : '▶'}</span>
          <span>📁 {node.name}</span>
        </div>
        {expanded && node.children && (
          <div className="pl-3.5 space-y-0.5 border-l border-ink/10 ml-2">
            {Object.values(node.children).map((c) => (
              <TreeNode key={c.path} node={c} selectedPath={selectedPath} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;
  return (
    <div
      onClick={() => onSelect(node.path)}
      className={`flex items-center justify-between py-1 px-2 rounded cursor-pointer transition-colors ${
        isSelected ? 'bg-ink text-white font-bold' : 'hover:bg-ink/5 text-ink/80'
      }`}
    >
      <span className="truncate">📄 {node.name}</span>
      {node.size !== undefined && (
        <span className={`text-[9px] ${isSelected ? 'text-white/60' : 'text-ink/40'}`}>
          {node.size}B
        </span>
      )}
    </div>
  );
}

// Subcomponent: Diff Detail View
function DiffViewDetail({
  filePath,
  diffData,
  mode,
}: {
  filePath: string;
  diffData: any;
  mode: DiffMode;
}) {
  const mod = diffData.filesModified?.find((f: any) => f.path === filePath);
  const add = diffData.filesAdded?.find((f: any) => f.path === filePath);
  const rem = diffData.filesRemoved?.find((f: any) => f.path === filePath);

  if (add) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-bold text-emerald-700 pb-2 border-b border-emerald-200">
          + Newly Added File: {filePath} ({add.size} bytes)
        </div>
        <pre className="text-emerald-800 bg-emerald-50/50 p-3 rounded-lg leading-relaxed whitespace-pre font-mono">
          {add.content || '// Content added'}
        </pre>
      </div>
    );
  }

  if (rem) {
    return (
      <div className="space-y-2">
        <div className="text-xs font-bold text-rose-700 pb-2 border-b border-rose-200">
          - Deleted File: {filePath}
        </div>
        <pre className="text-rose-800 bg-rose-50/50 p-3 rounded-lg leading-relaxed whitespace-pre font-mono">
          {rem.content || '// Content deleted'}
        </pre>
      </div>
    );
  }

  if (mod) {
    const oldLines = (mod.oldContent || '').split('\n');
    const newLines = (mod.newContent || '').split('\n');

    if (mode === 'split') {
      return (
        <div className="space-y-2">
          <div className="text-xs font-bold text-amber-700 pb-2 border-b border-amber-200">
            ~ Modified: {filePath}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-rose-50/40 p-3 rounded-lg border border-rose-100">
              <div className="text-[10px] font-bold text-rose-800 mb-2 uppercase">Parent Checkpoint</div>
              <pre className="whitespace-pre text-rose-900 leading-relaxed">
                {oldLines.map((l: string, i: number) => (
                  <div key={i} className="hover:bg-rose-100/50">
                    <span className="inline-block w-6 text-rose-300 select-none">{i + 1}</span> {l}
                  </div>
                ))}
              </pre>
            </div>
            <div className="bg-emerald-50/40 p-3 rounded-lg border border-emerald-100">
              <div className="text-[10px] font-bold text-emerald-800 mb-2 uppercase">Selected Checkpoint</div>
              <pre className="whitespace-pre text-emerald-900 leading-relaxed">
                {newLines.map((l: string, i: number) => (
                  <div key={i} className="hover:bg-emerald-100/50">
                    <span className="inline-block w-6 text-emerald-300 select-none">{i + 1}</span> {l}
                  </div>
                ))}
              </pre>
            </div>
          </div>
        </div>
      );
    }

    // Unified / Inline Mode
    return (
      <div className="space-y-2">
        <div className="text-xs font-bold text-amber-700 pb-2 border-b border-amber-200">
          ~ Inline Diff: {filePath}
        </div>
        <div className="bg-ink/3 p-3 rounded-lg border border-ink/10 space-y-0.5">
          {oldLines.map((l: string, i: number) => (
            <div key={`old-${i}`} className="bg-rose-500/10 text-rose-900 px-2 py-0.5 rounded">
              - {l}
            </div>
          ))}
          {newLines.map((l: string, i: number) => (
            <div key={`new-${i}`} className="bg-emerald-500/10 text-emerald-900 px-2 py-0.5 rounded">
              + {l}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return <div className="text-ink/40">File unchanged between checkpoints.</div>;
}
