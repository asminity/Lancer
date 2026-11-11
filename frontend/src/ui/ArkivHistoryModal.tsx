import { useState, useEffect } from 'react';
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi';
import { type Hex } from 'viem';
import { ensureRabdiWalletClient, rabdiChain, switchOrAddRabdiNetwork } from '@/config/chain';
import {
  queryPublicRuns,
  queryUserRuns,
  getEntityByKey,
  getDeliverableByRunId,
  getSwarmRoundByRunId,
  getAuditLogsByRunId,
  extendArkivEntity,
  deleteArkivEntity,
} from '@/services/arkiv/operations';
import {
  uploadContextWorkflow,
  retrieveContextWorkflow,
  getAllArkivContextRefs,
} from '@/services/storageWorkflow';
import { getSwarmConfig } from '@/services/swarm/client';
import { RABDI_EXPLORER_URL, formatArkivError } from '@/services/arkiv/balance';
import { downloadProjectZip, downloadSingleFile } from '@/services/projectBundle';
import { useStore } from '@/state/store';
import { Icon, I } from './Icons';

interface ArkivHistoryModalProps {
  open: boolean;
  onClose: () => void;
}

type TabType = 'public' | 'user' | 'swarm_context' | 'lookup';
type DetailSubTab = 'files' | 'consensus' | 'audit' | 'raw';

export function ArkivHistoryModal({ open, onClose }: ArkivHistoryModalProps) {
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();

  // True when wallet is connected but NOT on Rabdi DB-Chain (7794095)
  const isWrongNetwork = isConnected && chainId !== undefined && chainId !== null && chainId !== rabdiChain.id;

  /**
   * Attempts to switch to Rabdi DB-Chain via wagmi first (smooth UX),
   * then falls back to raw EIP-3326 / EIP-3085 request if wagmi fails.
   */
  const handleSwitchToRabdi = async () => {
    try {
      if (switchChain) {
        switchChain({ chainId: rabdiChain.id });
      } else {
        await switchOrAddRabdiNetwork();
      }
    } catch {
      await switchOrAddRabdiNetwork().catch(() => {});
    }
  };

  const storeTab = useStore((s) => s.arkivActiveTab);

  // Tab navigation
  const [activeTab, setActiveTab] = useState<TabType>(storeTab || 'public');
  const [detailTab, setDetailTab] = useState<DetailSubTab>('files');

  useEffect(() => {
    if (open && storeTab) {
      setActiveTab(storeTab);
    }
  }, [open, storeTab]);

  // Lists & Selected
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRun, setSelectedRun] = useState<any | null>(null);

  // Direct lookup
  const [lookupKey, setLookupKey] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Details retrieved from Arkiv
  const [deliverable, setDeliverable] = useState<any | null>(null);
  const [consensus, setConsensus] = useState<any | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string>('');

  // Swarm Context & Large Reports State
  const [contextRefs, setContextRefs] = useState<any[]>([]);
  const [selectedContextRef, setSelectedContextRef] = useState<any | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [fetchingSwarm, setFetchingSwarm] = useState(false);
  const [swarmPayload, setSwarmPayload] = useState<string | null>(null);
  const [swarmVerified, setSwarmVerified] = useState<boolean | null>(null);
  const [swarmError, setSwarmError] = useState<string | null>(null);

  // Manual Context Upload State
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [newProjectId, setNewProjectId] = useState('project-crypto-tracker');
  const [newFileName, setNewFileName] = useState('context-manifest.json');
  const [newPayloadText, setNewPayloadText] = useState(
    JSON.stringify(
      {
        project: 'CRYPTracker Engine',
        description: 'Multi-agent real-time cryptocurrency tracking workspace context',
        agents: ['Diya (Manager)', 'Liam (Architecture)', 'Sophia (Backend)'],
        milestones: ['Arkiv Schema Design', 'Swarm BZZ Storage', 'Cryptographic Verification'],
        features: ['Real-time Binance WebSockets', 'Rabdi DB-Chain State', 'Swarm Content Addresses'],
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );
  const [uploadingContext, setUploadingContext] = useState(false);

  // Actions
  const [extending, setExtending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedFile, setCopiedFile] = useState(false);

  // Load runs or swarm context depending on tab
  useEffect(() => {
    if (!open) return;
    setStatusMsg(null);

    if (activeTab === 'public') {
      setLoading(true);
      queryPublicRuns(30)
        .then((data) => {
          setRuns(data);
          if (data.length > 0 && !selectedRun) {
            setSelectedRun(data[0]);
          }
        })
        .finally(() => setLoading(false));
    } else if (activeTab === 'user') {
      if (!address) {
        setRuns([]);
        return;
      }
      setLoading(true);
      queryUserRuns(address, 30)
        .then((data) => {
          setRuns(data);
          if (data.length > 0) {
            setSelectedRun(data[0]);
          } else {
            setSelectedRun(null);
          }
        })
        .finally(() => setLoading(false));
    } else if (activeTab === 'swarm_context') {
      setContextLoading(true);
      getAllArkivContextRefs(50)
        .then((refs) => {
          setContextRefs(refs);
          if (refs.length > 0) {
            setSelectedContextRef(refs[0]);
          } else {
            setSelectedContextRef(null);
          }
        })
        .finally(() => setContextLoading(false));
    }
  }, [open, activeTab, address]);

  // Load deliverable, swarm round, and audit logs when selected run changes
  useEffect(() => {
    if (!selectedRun) {
      setDeliverable(null);
      setConsensus(null);
      setAuditLogs([]);
      return;
    }

    setDetailsLoading(true);
    setDeliverable(null);
    setConsensus(null);
    setAuditLogs([]);
    setSelectedFile('');

    Promise.all([
      getDeliverableByRunId(selectedRun.runId),
      getSwarmRoundByRunId(selectedRun.runId),
      getAuditLogsByRunId(selectedRun.runId),
    ])
      .then(([deliv, swarm, audits]) => {
        setDeliverable(deliv);
        setConsensus(swarm);
        setAuditLogs(audits);
        if (deliv?.files && Object.keys(deliv.files).length > 0) {
          setSelectedFile(Object.keys(deliv.files)[0]);
        }
      })
      .finally(() => setDetailsLoading(false));
  }, [selectedRun]);

  // Handle direct key lookup
  const handleDirectLookup = async () => {
    const key = lookupKey.trim();
    if (!key.startsWith('0x') || key.length < 10) {
      setLookupError('Please enter a valid hex entity key (e.g., 0x...)');
      return;
    }
    setLookupLoading(true);
    setLookupError(null);
    try {
      const entity = await getEntityByKey(key as Hex);
      if (!entity) {
        setLookupError('Entity not found on Rabdi DB-Chain with key ' + key);
        return;
      }
      const raw: any = entity;
      // Adapt entity into selectedRun shape
      const adaptedRun = {
        key: (raw.$key || key) as Hex,
        owner: (raw.owner ?? raw.$owner ?? '') as string,
        runId: String(raw.run_id ?? key.slice(0, 16)),
        taskClass: String(raw.task_class ?? 'On-Chain Entity'),
        mode: String(raw.mode ?? 'office'),
        status: String(raw.status ?? 'COMMITTED'),
        createdAt: Number(raw.created_at ?? raw.$createdAt ?? 0) * 1000 || Date.now(),
        goalSummary: String(raw.goal_summary ?? `Entity ${key.slice(0, 12)}...`),
        durationS: Number(raw.duration_s ?? 0),
        totalTokens: Number(raw.total_tokens ?? 0),
        rawEntity: entity,
      };
      setSelectedRun(adaptedRun);
    } catch (err) {
      setLookupError(formatArkivError(err));
    } finally {
      setLookupLoading(false);
    }
  };

  // Extend storage expiration
  const handleExtend = async () => {
    if (!selectedRun?.key) return;
    setExtending(true);
    setStatusMsg(null);
    try {
      const client = await ensureRabdiWalletClient(walletClient, address);
      const res = await extendArkivEntity(client, selectedRun.key, 90);
      setStatusMsg({
        type: 'success',
        text: `Preserved entity on Arkiv for +90 days! Tx: ${res.txHash.slice(0, 14)}...`,
      });
    } catch (err) {
      setStatusMsg({ type: 'error', text: formatArkivError(err) });
    } finally {
      setExtending(false);
    }
  };

  // Delete entity
  const handleDelete = async () => {
    if (!selectedRun?.key) return;
    if (!confirm('Are you sure you want to permanently prune this entity from Arkiv DB-Chain?')) return;
    setDeleting(true);
    setStatusMsg(null);
    try {
      const client = await ensureRabdiWalletClient(walletClient, address);
      const res = await deleteArkivEntity(client, selectedRun.key);
      setStatusMsg({
        type: 'success',
        text: `Entity deleted from Arkiv DB-Chain. Tx: ${res.txHash.slice(0, 14)}...`,
      });
      // Remove from list
      setRuns((prev) => prev.filter((r) => r.key !== selectedRun.key));
      setSelectedRun(null);
    } catch (err) {
      setStatusMsg({ type: 'error', text: formatArkivError(err) });
    } finally {
      setDeleting(false);
    }
  };

  // Download project as ZIP
  const handleDownloadZip = async () => {
    if (!deliverable?.files || !selectedRun) return;
    setZipping(true);
    try {
      await downloadProjectZip(selectedRun.goalSummary || selectedRun.runId, deliverable.files);
    } finally {
      setZipping(false);
    }
  };

  // Load project into active workspace
  const handleLoadIntoWorkspace = () => {
    if (!selectedRun) return;
    useStore.setState({
      phase: 'workspace',
      goal: selectedRun.goalSummary,
      reportOpen: true,
      report: {
        report_markdown:
          deliverable?.reportMd ||
          `# ${selectedRun.goalSummary}\n\n**Run ID:** \`${selectedRun.runId}\`\n**Mode:** \`${selectedRun.mode}\`\n**Status:** \`${selectedRun.status}\`\n\n*Retrieved directly from Arkiv Rabdi DB-Chain.*`,
        sources: [
          {
            title: `Arkiv Entity: ${selectedRun.key?.slice(0, 16)}...`,
            url: `${RABDI_EXPLORER_URL}/entity/${selectedRun.key}`,
            verified: true,
          },
        ],
        effort_logical_s: selectedRun.durationS || 45,
        effort_real_s: selectedRun.durationS || 45,
      },
    });
    onClose();
  };

  // Copy code snippet
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedFile(true);
    setTimeout(() => setCopiedFile(false), 2000);
  };

  // Swarm fetch & verify handler
  const handleFetchAndVerifySwarm = async (ref: any) => {
    if (!ref?.reportId) return;
    setFetchingSwarm(true);
    setSwarmError(null);
    setSwarmPayload(null);
    setSwarmVerified(null);
    try {
      const res = await retrieveContextWorkflow(ref.reportId);
      setSwarmPayload(res.content);
      setSwarmVerified(res.verified);
    } catch (err: any) {
      setSwarmError(err.message || 'Failed to retrieve file from Swarm');
    } finally {
      setFetchingSwarm(false);
    }
  };

  // Swarm upload & Arkiv record handler
  const handleUploadContext = async () => {
    setUploadingContext(true);
    setStatusMsg(null);
    try {
      const client = await ensureRabdiWalletClient(walletClient, address);
      const res = await uploadContextWorkflow(client, newPayloadText, {
        projectId: newProjectId,
        userId: address || client.account?.address || 'user-1',
        fileName: newFileName,
        contentType: newFileName.endsWith('.md') ? 'text/markdown' : 'application/json',
        summary: `Context deliverable for ${newProjectId}`,
      });
      setStatusMsg({
        type: 'success',
        text: `Uploaded to Swarm & pinned on Arkiv! Tx: ${res.txHash.slice(0, 14)}...`,
      });
      setShowUploadForm(false);
      // Reload context refs list
      const updated = await getAllArkivContextRefs(50);
      setContextRefs(updated);
      if (updated.length > 0) {
        setSelectedContextRef(updated[0]);
        handleFetchAndVerifySwarm(updated[0]);
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: formatArkivError(err) });
    } finally {
      setUploadingContext(false);
    }
  };

  const isOwner =
    isConnected &&
    address &&
    selectedRun?.owner &&
    address.toLowerCase() === selectedRun.owner.toLowerCase();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50 backdrop-blur-xs">
      <div className="relative w-full max-w-5xl h-[88vh] bg-[#FAF7F2] rounded-2xl border border-ink/20 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-ink/10 bg-white/80">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-xs"
              style={{ background: 'var(--accent)' }}
            >
              A
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-heading font-bold text-base text-ink">
                  Arkiv Verifiable Project Ledger
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold border border-emerald-300">
                  Rabdi Testnet (Chain ID 7794095)
                </span>
              </div>
              <p className="text-[11px] font-mono text-ink/60">
                Decentralized on-chain database • Zero-gas public reads • Cryptographic consensus proofs
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
            title="Close"
          >
            <Icon d={I.close} size={18} />
          </button>
        </div>

        {/* Tab Selector Bar */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-ink/10 bg-paper">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('public')}
              className={`px-3 py-1.5 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer ${
                activeTab === 'public'
                  ? 'bg-ink text-white shadow-xs'
                  : 'text-ink/70 hover:bg-ink/5'
              }`}
            >
              🌐 Public Network Runs
            </button>
            <button
              onClick={() => setActiveTab('user')}
              className={`px-3 py-1.5 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer ${
                activeTab === 'user'
                  ? 'bg-ink text-white shadow-xs'
                  : 'text-ink/70 hover:bg-ink/5'
              }`}
            >
              💼 My Wallet Runs {address ? `(${address.slice(0, 6)}...)` : ''}
            </button>
            <button
              onClick={() => setActiveTab('lookup')}
              className={`px-3 py-1.5 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer ${
                activeTab === 'lookup'
                  ? 'bg-ink text-white shadow-xs'
                  : 'text-ink/70 hover:bg-ink/5'
              }`}
            >
              🔍 Direct Entity Lookup
            </button>
            <button
              onClick={() => setActiveTab('swarm_context')}
              className={`px-3 py-1.5 rounded-lg text-xs font-heading font-medium transition-all cursor-pointer ${
                activeTab === 'swarm_context'
                  ? 'bg-ink text-white shadow-xs'
                  : 'text-ink/70 hover:bg-ink/5'
              }`}
            >
              📦 Swarm Context Files {contextRefs.length > 0 ? `(${contextRefs.length})` : ''}
            </button>
          </div>

          <div className="text-[11px] font-mono text-ink/50 flex items-center gap-2">
            <span>Explorer:</span>
            <a
              href={RABDI_EXPLORER_URL}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-700 hover:underline"
            >
              rabdi.explorer.arkiv.network ↗
            </a>
          </div>
        </div>

        {/* ── Wrong Network Banner ─────────────────────────────────────── */}
        {isWrongNetwork && (
          <div className="flex items-center justify-between gap-3 px-5 py-2.5 bg-red-50 border-b border-red-200 text-red-800 text-xs font-body">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-ping shrink-0" />
              <span className="font-medium">
                Wrong network detected. Please switch your wallet to the{' '}
                <strong>Rabdi DB-Chain Testnet (Chain ID 7794095)</strong> to perform write
                operations on Arkiv.
              </span>
            </div>
            <button
              onClick={handleSwitchToRabdi}
              disabled={isSwitchingChain}
              className="shrink-0 rounded-lg border border-red-400 bg-white px-3 py-1 text-[11px] font-heading font-semibold text-red-700 hover:bg-red-100 transition-colors disabled:opacity-60 disabled:pointer-events-none cursor-pointer"
            >
              {isSwitchingChain ? 'Switching…' : 'Switch to Rabdi'}
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          
          {/* Left Column: Explorer List or Lookup Form */}
          <div className="w-80 border-r border-ink/10 flex flex-col bg-white/40 overflow-hidden">
            {activeTab === 'swarm_context' ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-ink/10 flex items-center justify-between bg-white/60">
                  <span className="text-xs font-heading font-semibold text-ink">Swarm Files</span>
                  <button
                    onClick={() => setShowUploadForm(!showUploadForm)}
                    className="px-2 py-1 rounded text-[11px] font-mono bg-emerald-600 text-white hover:bg-emerald-700 transition-colors flex items-center gap-1 shadow-xs cursor-pointer"
                  >
                    <span>{showUploadForm ? 'View List' : '+ Store File'}</span>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {contextLoading ? (
                    <div className="text-center p-8 text-xs text-ink/50 font-mono animate-pulse">
                      Querying Arkiv context references...
                    </div>
                  ) : contextRefs.length === 0 ? (
                    <div className="text-center p-6 space-y-2 text-xs text-ink/60 font-body">
                      <div>No context files found on Arkiv yet.</div>
                      <button
                        onClick={() => setShowUploadForm(true)}
                        className="mt-2 px-3 py-1.5 rounded-lg bg-ink text-white text-xs font-heading"
                      >
                        + Store First File
                      </button>
                    </div>
                  ) : (
                    contextRefs.map((ref) => {
                      const isSel = selectedContextRef?.reportId === ref.reportId;
                      return (
                        <div
                          key={ref.key || ref.reportId}
                          onClick={() => {
                            setSelectedContextRef(ref);
                            setShowUploadForm(false);
                            handleFetchAndVerifySwarm(ref);
                          }}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            isSel && !showUploadForm
                              ? 'border-ink bg-white shadow-sm ring-1 ring-ink/10'
                              : 'border-ink/10 bg-white/70 hover:bg-white hover:border-ink/20'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono text-xs font-bold text-ink truncate max-w-[160px]">
                              {ref.fileName}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold border border-amber-200">
                              SWARM
                            </span>
                          </div>
                          <div className="text-[11px] font-body text-ink/70 truncate mb-1.5">
                            {ref.projectId}
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-mono text-ink/45">
                            <span>{(ref.fileSize / 1024).toFixed(1)} KB</span>
                            <span>{new Date(ref.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : activeTab === 'lookup' ? (
              <div className="p-4 space-y-3 overflow-y-auto">
                <div className="text-xs font-heading font-semibold text-ink">
                  Lookup Entity on Rabdi DB-Chain
                </div>
                <p className="text-[11px] font-body text-ink/65 leading-relaxed">
                  Query any on-chain entity directly by its 32-byte hex entity key without needing a wallet.
                </p>
                <input
                  type="text"
                  placeholder="0x..."
                  value={lookupKey}
                  onChange={(e) => setLookupKey(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-ink/20 bg-white focus:outline-none focus:border-ink/50"
                />
                <button
                  onClick={handleDirectLookup}
                  disabled={lookupLoading || !lookupKey}
                  className="w-full py-2 px-3 rounded-lg text-xs font-heading font-semibold bg-ink text-white hover:opacity-90 disabled:opacity-40 transition-opacity cursor-pointer"
                >
                  {lookupLoading ? 'Querying Rabdi...' : 'Fetch Entity From Arkiv'}
                </button>

                {lookupError && (
                  <div className="p-2.5 rounded-lg text-[11px] font-mono bg-rose-50 text-rose-800 border border-rose-200">
                    {lookupError}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {activeTab === 'user' && !isConnected ? (
                  <div className="text-center p-6 space-y-3">
                    <div className="text-xs text-ink/70 font-body">
                      Connect your wallet in the top navbar to view and manage your own on-chain projects.
                    </div>
                  </div>
                ) : loading ? (
                  <div className="text-center p-8 text-xs text-ink/50 font-mono animate-pulse">
                    Querying Rabdi DB-Chain...
                  </div>
                ) : runs.length === 0 ? (
                  <div className="text-center p-8 space-y-2 text-xs text-ink/60 font-body">
                    <div>No entities found on Arkiv yet.</div>
                    <div className="text-[11px] text-ink/40">
                      Complete a run and click &quot;Publish to Arkiv&quot; in the Final Report to write the first record!
                    </div>
                  </div>
                ) : (
                  runs.map((r) => {
                    const isSel = selectedRun?.runId === r.runId || selectedRun?.key === r.key;
                    return (
                      <div
                        key={r.key || r.runId}
                        onClick={() => setSelectedRun(r)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSel
                            ? 'border-ink bg-white shadow-sm ring-1 ring-ink/10'
                            : 'border-ink/10 bg-white/60 hover:bg-white hover:border-ink/30'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono text-ink/50 mb-1">
                          <span className="uppercase font-semibold tracking-wider text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded">
                            {r.mode}
                          </span>
                          <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                        </div>
                        <div className="font-heading font-semibold text-xs text-ink line-clamp-2 mb-1.5">
                          {r.goalSummary || r.runId}
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono text-ink/50">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                              r.status === 'SUCCESS'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {r.status}
                          </span>
                          <span className="truncate max-w-[110px]" title={r.owner}>
                            {r.owner ? `${r.owner.slice(0, 6)}...${r.owner.slice(-4)}` : r.taskClass}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Right Column: Selected Entity Ledger View */}
          <div className="flex-1 flex flex-col overflow-hidden bg-paper">
            {activeTab === 'swarm_context' ? (
              showUploadForm ? (
                <div className="flex-1 overflow-y-auto p-6 space-y-4 max-w-2xl">
                  <div className="flex items-center justify-between pb-3 border-b border-ink/10">
                    <div>
                      <h3 className="font-heading font-bold text-base text-ink">
                        Store New Context File (Swarm + Arkiv)
                      </h3>
                      <p className="text-xs text-ink/60 font-body">
                        Uploads raw payload to Ethereum Swarm and anchors metadata & SHA-256 integrity hash on Arkiv Rabdi DB-Chain.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowUploadForm(false)}
                      className="text-xs text-ink/50 hover:text-ink font-mono cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-heading font-semibold text-ink mb-1">
                        Project ID / Slug
                      </label>
                      <input
                        type="text"
                        value={newProjectId}
                        onChange={(e) => setNewProjectId(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-ink/20 bg-white focus:outline-none focus:border-ink/50"
                        placeholder="e.g. project-crypto-tracker"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-heading font-semibold text-ink mb-1">
                        File Name
                      </label>
                      <input
                        type="text"
                        value={newFileName}
                        onChange={(e) => setNewFileName(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-ink/20 bg-white focus:outline-none focus:border-ink/50"
                        placeholder="e.g. context-manifest.json or report.md"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-heading font-semibold text-ink">
                          File Content Payload
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setNewFileName('context-report.md');
                              setNewPayloadText(
                                `# Autonomous Engineering Report\n\n## Project: CRYPTracker\n- **Target:** Real-time crypto tracker\n- **Consensus Quorum:** 20 Agents / 100% Agreement\n- **Storage:** Ethereum Swarm + Arkiv Rabdi DB-Chain\n\n### Executed Steps:\n1. Model deliberation on 0G Private Compute\n2. Smart contract verification\n3. Deliverable synthesis and tests passed.`
                              );
                            }}
                            className="text-[10px] font-mono text-emerald-700 hover:underline cursor-pointer"
                          >
                            Use Markdown Sample
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNewFileName('context-manifest.json');
                              setNewPayloadText(
                                JSON.stringify(
                                  {
                                    project: 'CRYPTracker Engine',
                                    description: 'Multi-agent real-time cryptocurrency tracking workspace context',
                                    agents: ['Diya (Manager)', 'Liam (Architecture)', 'Sophia (Backend)'],
                                    milestones: ['Arkiv Schema Design', 'Swarm BZZ Storage', 'Cryptographic Verification'],
                                    timestamp: new Date().toISOString(),
                                  },
                                  null,
                                  2
                                )
                              );
                            }}
                            className="text-[10px] font-mono text-emerald-700 hover:underline cursor-pointer"
                          >
                            Use JSON Sample
                          </button>
                        </div>
                      </div>
                      <textarea
                        rows={10}
                        value={newPayloadText}
                        onChange={(e) => setNewPayloadText(e.target.value)}
                        className="w-full p-3 font-mono text-xs rounded-lg border border-ink/20 bg-white focus:outline-none focus:border-ink/50"
                      />
                    </div>

                    <button
                      onClick={handleUploadContext}
                      disabled={uploadingContext || !newPayloadText.trim()}
                      className="w-full py-2.5 px-4 rounded-xl text-xs font-heading font-bold text-white shadow-md transition-all hover:opacity-95 disabled:opacity-40 cursor-pointer"
                      style={{ background: 'var(--accent)' }}
                    >
                      {uploadingContext ? 'Uploading to Swarm & Signing Arkiv Tx...' : '🚀 Upload to Swarm & Anchor to Arkiv'}
                    </button>
                  </div>
                </div>
              ) : !selectedContextRef ? (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center text-ink/50 space-y-2">
                  <Icon d={I.database} size={32} className="opacity-30" />
                  <div className="font-heading text-sm text-ink/70">No Swarm Context File Selected</div>
                  <div className="text-xs font-body max-w-sm">
                    Select a context file from the left list to view on-chain metadata, verify cryptographic SHA-256 hashes, and inspect Swarm content.
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  {/* Swarm File Header Card */}
                  <div className="p-5 border-b border-ink/10 bg-white shadow-2xs space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200">
                            SWARM BZZ
                          </span>
                          <h3 className="font-heading font-bold text-base text-ink">
                            {selectedContextRef.fileName}
                          </h3>
                        </div>
                        <p className="text-xs font-body text-ink/70">
                          {selectedContextRef.summary || `Project: ${selectedContextRef.projectId}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleFetchAndVerifySwarm(selectedContextRef)}
                          disabled={fetchingSwarm}
                          className="px-3 py-1.5 rounded-lg text-xs font-heading font-semibold text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
                          style={{ background: 'var(--accent)' }}
                        >
                          {fetchingSwarm ? 'Fetching from Swarm...' : '✓ Fetch & Verify Hash'}
                        </button>
                        {swarmPayload && (
                          <button
                            onClick={() => downloadSingleFile(selectedContextRef.fileName, swarmPayload)}
                            className="px-3 py-1.5 rounded-lg text-xs font-heading bg-ink/5 hover:bg-ink/10 text-ink/80 transition-colors cursor-pointer"
                          >
                            Download
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 text-[11px] font-mono">
                      <div className="p-2 rounded-lg bg-ink/3 border border-ink/8">
                        <div className="text-ink/40 text-[9.5px]">SWARM REFERENCE</div>
                        <div className="font-semibold text-ink truncate" title={selectedContextRef.swarmRef}>
                          {selectedContextRef.swarmRef.slice(0, 16)}...
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-ink/3 border border-ink/8">
                        <div className="text-ink/40 text-[9.5px]">SHA-256 HASH</div>
                        <div className="font-semibold text-ink truncate" title={selectedContextRef.contentHash}>
                          {selectedContextRef.contentHash.replace('sha256:', '').slice(0, 14)}...
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-ink/3 border border-ink/8">
                        <div className="text-ink/40 text-[9.5px]">ARKIV ENTITY KEY</div>
                        <a
                          href={`${RABDI_EXPLORER_URL}/entity/${selectedContextRef.key}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-emerald-700 hover:underline truncate block"
                          title={selectedContextRef.key}
                        >
                          {selectedContextRef.key.slice(0, 12)}... ↗
                        </a>
                      </div>
                      <div className="p-2 rounded-lg bg-ink/3 border border-ink/8">
                        <div className="text-ink/40 text-[9.5px]">FILE SIZE & DATE</div>
                        <div className="font-semibold text-ink">
                          {(selectedContextRef.fileSize / 1024).toFixed(1)} KB · {new Date(selectedContextRef.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Verification Banner */}
                  {swarmVerified === true && (
                    <div className="px-5 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20 text-xs text-emerald-800 font-mono flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="font-semibold">✓ Cryptographic SHA-256 Verified!</span>
                        <span className="text-ink/60">Swarm content matches Arkiv on-chain pointer bit-for-bit.</span>
                      </div>
                      <span className="text-[10px] bg-emerald-100 text-emerald-900 px-2 py-0.5 rounded border border-emerald-300">
                        MATCH 100%
                      </span>
                    </div>
                  )}

                  {swarmVerified === false && (
                    <div className="px-5 py-2.5 bg-rose-500/10 border-b border-rose-500/20 text-xs text-rose-800 font-mono flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      <span className="font-semibold">⚠ Integrity Warning:</span>
                      <span>Content hash from Swarm does not match expected Arkiv record.</span>
                    </div>
                  )}

                  {swarmError && (
                    <div className="p-4 bg-rose-50 border-b border-rose-200 text-xs font-mono text-rose-800">
                      {swarmError}
                    </div>
                  )}

                  {/* Content Preview */}
                  <div className="flex-1 min-h-0 flex flex-col p-5 overflow-hidden">
                    <div className="flex items-center justify-between pb-2 border-b border-ink/10 text-xs font-heading text-ink/70">
                      <span>Content Payload Preview ({selectedContextRef.fileName})</span>
                      {swarmPayload && (
                        <button
                          onClick={() => handleCopyCode(swarmPayload)}
                          className="text-[11px] font-mono text-ink/60 hover:text-ink cursor-pointer"
                        >
                          {copiedFile ? 'Copied!' : 'Copy Payload'}
                        </button>
                      )}
                    </div>
                    <div className="flex-1 overflow-auto bg-white rounded-xl border border-ink/10 p-4 mt-2 font-mono text-xs leading-relaxed">
                      {fetchingSwarm ? (
                        <div className="text-center py-12 text-ink/40 animate-pulse">
                          Retrieving file payload from Ethereum Swarm content address...
                        </div>
                      ) : swarmPayload ? (
                        <pre className="whitespace-pre-wrap">{swarmPayload}</pre>
                      ) : (
                        <div className="text-center py-12 text-ink/40">
                          Click &quot;✓ Fetch & Verify Hash&quot; above to retrieve file content from Ethereum Swarm.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            ) : !selectedRun ? (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center text-ink/50 space-y-2">
                <Icon d={I.database} size={32} className="opacity-30" />
                <div className="font-heading text-sm text-ink/70">No Entity Selected</div>
                <div className="text-xs font-body max-w-sm">
                  Select a run from the left ledger or use Direct Lookup to inspect deliverables, consensus proofs, and audit logs.
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                
                {/* Entity Summary Header Card */}
                <div className="p-5 border-b border-ink/10 bg-white shadow-2xs space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                            selectedRun.status === 'SUCCESS'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {selectedRun.status}
                        </span>
                        <span className="text-xs font-mono text-ink/50">
                          Run: <span className="text-ink font-semibold">{selectedRun.runId}</span>
                        </span>
                        <span className="text-ink/20">•</span>
                        <span className="text-xs font-mono text-ink/50 capitalize">
                          {selectedRun.taskClass}
                        </span>
                      </div>
                      <h3 className="font-heading font-bold text-lg text-ink leading-snug">
                        {selectedRun.goalSummary}
                      </h3>
                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleLoadIntoWorkspace}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-ink text-white hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                        title="Load this project and report into active workspace"
                      >
                        <span>Load into Workspace</span>
                        <span>→</span>
                      </button>

                      {deliverable?.files && (
                        <button
                          onClick={handleDownloadZip}
                          disabled={zipping}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border border-ink/20 bg-white hover:bg-ink/5 text-ink transition-colors cursor-pointer"
                          title="Download project ZIP from on-chain bundle_bytes"
                        >
                          <Icon d={I.download} size={14} />
                          <span>{zipping ? 'Zipping...' : 'Download .ZIP'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Metadata Chips */}
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 border-t border-ink/10 text-xs font-mono text-ink/70">
                    {selectedRun.key && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-ink/40">Entity Key:</span>
                        <a
                          href={`${RABDI_EXPLORER_URL}/entity/${selectedRun.key}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-700 hover:underline font-semibold flex items-center gap-0.5"
                        >
                          <span>{selectedRun.key.slice(0, 10)}...{selectedRun.key.slice(-6)}</span>
                          <span>↗</span>
                        </a>
                      </div>
                    )}

                    {selectedRun.owner && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-ink/40">Owner:</span>
                        <a
                          href={`${RABDI_EXPLORER_URL}/address/${selectedRun.owner}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-700 hover:underline flex items-center gap-0.5"
                        >
                          <span>{selectedRun.owner.slice(0, 8)}...{selectedRun.owner.slice(-6)}</span>
                          <span>↗</span>
                        </a>
                      </div>
                    )}

                    <div>
                      <span className="text-ink/40">Created:</span>{' '}
                      <span className="text-ink">{new Date(selectedRun.createdAt).toLocaleString()}</span>
                    </div>

                    {isOwner && (
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          onClick={handleExtend}
                          disabled={extending}
                          className="px-2 py-0.5 text-[11px] font-mono rounded bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer"
                        >
                          {extending ? 'Extending...' : '+90d Preserve'}
                        </button>
                        <button
                          onClick={handleDelete}
                          disabled={deleting}
                          className="px-2 py-0.5 text-[11px] font-mono rounded bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 transition-colors cursor-pointer"
                        >
                          {deleting ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Subtab Navigation */}
                <div className="flex items-center justify-between px-6 border-b border-ink/10 bg-white/50">
                  <div className="flex items-center gap-4 text-xs font-heading font-medium">
                    <button
                      onClick={() => setDetailTab('files')}
                      className={`py-2.5 border-b-2 transition-all cursor-pointer ${
                        detailTab === 'files'
                          ? 'border-ink text-ink font-bold'
                          : 'border-transparent text-ink/60 hover:text-ink'
                      }`}
                    >
                      📁 On-Chain Deliverable Codebase ({deliverable?.fileCount ?? 0} files)
                    </button>
                    {consensus && (
                      <button
                        onClick={() => setDetailTab('consensus')}
                        className={`py-2.5 border-b-2 transition-all cursor-pointer ${
                          detailTab === 'consensus'
                            ? 'border-ink text-ink font-bold'
                            : 'border-transparent text-ink/60 hover:text-ink'
                        }`}
                      >
                        ⚖️ Swarm Consensus Proof ({consensus.agreement}%)
                      </button>
                    )}
                    {auditLogs.length > 0 && (
                      <button
                        onClick={() => setDetailTab('audit')}
                        className={`py-2.5 border-b-2 transition-all cursor-pointer ${
                          detailTab === 'audit'
                            ? 'border-ink text-ink font-bold'
                            : 'border-transparent text-ink/60 hover:text-ink'
                        }`}
                      >
                        🛡️ Human Permission Audits ({auditLogs.length})
                      </button>
                    )}
                  </div>

                  {statusMsg && (
                    <div
                      className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                        statusMsg.type === 'success'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {statusMsg.text}
                    </div>
                  )}
                </div>

                {/* Subtab Content */}
                <div className="flex-1 min-h-0 overflow-hidden p-5">
                  {detailsLoading ? (
                    <div className="h-full flex items-center justify-center text-xs font-mono text-ink/50 animate-pulse">
                      Decoding on-chain bundle_bytes & verification proofs from Rabdi DB-Chain...
                    </div>
                  ) : detailTab === 'files' ? (
                    deliverable ? (
                      <div className="h-full flex flex-col gap-3">
                        {/* Quality Assurance Strip */}
                        <div className="flex items-center justify-between p-3 rounded-xl bg-white border border-ink/10 shadow-2xs">
                          <div className="flex items-center gap-3">
                            <span
                              className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${
                                deliverable.l2TestsPass
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {deliverable.l2TestsPass ? '✓ L2 Automated Tests Passed' : 'L2 Pending'}
                            </span>
                            <span className="text-xs font-mono text-ink/70">
                              L3 Quality Score: <b className="text-ink">{deliverable.l3Score} / 100</b>
                            </span>
                            <span className="text-ink/30">•</span>
                            <span className="text-xs font-mono text-ink/70">
                              Total Code Lines: <b className="text-ink">{deliverable.totalLines}</b>
                            </span>
                          </div>

                          <div className="text-[11px] font-mono text-ink/40">
                            Storage Payload: decoded from Arkiv <code>bundle_bytes</code>
                          </div>
                        </div>

                        {/* Interactive File Browser */}
                        <div className="flex-1 flex min-h-0 border border-ink/10 rounded-xl bg-white overflow-hidden shadow-2xs">
                          {/* File list */}
                          <div className="w-56 border-r border-ink/10 overflow-y-auto p-2 space-y-1 bg-ink/2">
                            {Object.keys(deliverable.files || {}).map((path) => (
                              <button
                                key={path}
                                onClick={() => setSelectedFile(path)}
                                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono transition-colors cursor-pointer flex items-center justify-between ${
                                  selectedFile === path
                                    ? 'bg-ink text-white font-medium'
                                    : 'text-ink/80 hover:bg-white'
                                }`}
                              >
                                <span className="truncate">{path}</span>
                                <span className="text-[10px] opacity-60 ml-1">
                                  {deliverable.files[path]?.split('\n').length}L
                                </span>
                              </button>
                            ))}
                          </div>

                          {/* File code view */}
                          <div className="flex-1 flex flex-col min-w-0 bg-[#1E1E1E] text-[#D4D4D4]">
                            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#252526] text-xs font-mono">
                              <span className="text-white/80">{selectedFile || 'Select a file'}</span>
                              {selectedFile && deliverable.files[selectedFile] && (
                                <button
                                  onClick={() => handleCopyCode(deliverable.files[selectedFile])}
                                  className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] text-white/90 transition-colors cursor-pointer"
                                >
                                  {copiedFile ? '✓ Copied' : 'Copy File'}
                                </button>
                              )}
                            </div>
                            <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed selection:bg-emerald-900">
                              {selectedFile && deliverable.files[selectedFile] ? (
                                <pre className="whitespace-pre">
                                  {deliverable.files[selectedFile]}
                                </pre>
                              ) : (
                                <div className="text-white/40">No file content</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center p-8 text-center text-ink/50 space-y-2 border border-dashed border-ink/20 rounded-xl bg-white/50">
                        <Icon d={I.code} size={28} className="opacity-30" />
                        <div className="font-heading text-sm text-ink/70">No Deliverable Bundle Found</div>
                        <div className="text-xs font-body max-w-sm">
                          This run has not committed its codebase bundle to the <code>autonex.deliverable</code> schema yet.
                        </div>
                      </div>
                    )
                  ) : detailTab === 'consensus' ? (
                    consensus ? (
                      <div className="h-full flex flex-col gap-4 overflow-y-auto">
                        <div className="grid grid-cols-4 gap-3">
                          <div className="p-3 rounded-xl bg-white border border-ink/10 shadow-2xs">
                            <div className="text-[10px] font-mono text-ink/50 uppercase">Quorum Consensus</div>
                            <div className="text-2xl font-heading font-bold text-emerald-700">
                              {consensus.agreement}%
                            </div>
                          </div>
                          <div className="p-3 rounded-xl bg-white border border-ink/10 shadow-2xs">
                            <div className="text-[10px] font-mono text-ink/50 uppercase">Deliberating Swarm</div>
                            <div className="text-2xl font-heading font-bold text-ink">
                              {consensus.swarmSize} Agents
                            </div>
                          </div>
                          <div className="p-3 rounded-xl bg-white border border-ink/10 shadow-2xs">
                            <div className="text-[10px] font-mono text-ink/50 uppercase">Semantic Clusters</div>
                            <div className="text-2xl font-heading font-bold text-ink">
                              {consensus.clustersCount}
                            </div>
                          </div>
                          <div className="p-3 rounded-xl bg-white border border-ink/10 shadow-2xs">
                            <div className="text-[10px] font-mono text-ink/50 uppercase">Veto Exercised</div>
                            <div className="text-2xl font-heading font-bold text-ink">
                              {consensus.vetoTriggered ? 'Yes' : 'No'}
                            </div>
                          </div>
                        </div>

                        <div className="p-4 rounded-xl bg-white border border-ink/10 space-y-2">
                          <div className="text-xs font-heading font-bold text-ink">
                            Cryptographic Quorum Summary
                          </div>
                          <p className="text-xs font-body text-ink/70 leading-relaxed">
                            Deliberated under moderator <b>{consensus.moderator}</b> with {consensus.ballotsCount} Borda ballots recorded.
                            Consensus data payload stored directly on Rabdi DB-Chain under entity key <code>{consensus.key}</code>.
                          </p>
                          {consensus.consensusData && (
                            <div className="mt-3 p-3 rounded-lg bg-ink/5 font-mono text-xs overflow-x-auto max-h-56">
                              <pre>{JSON.stringify(consensus.consensusData, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null
                  ) : detailTab === 'audit' ? (
                    <div className="h-full flex flex-col gap-3 overflow-y-auto">
                      <div className="p-4 rounded-xl bg-white border border-ink/10 space-y-3">
                        <div className="text-xs font-heading font-bold text-ink">
                          Immutable Human Permission Log (autonex.audit_log)
                        </div>
                        <div className="space-y-2">
                          {auditLogs.map((log, idx) => (
                            <div
                              key={log.key || idx}
                              className="p-3 rounded-lg bg-ink/2 border border-ink/10 flex items-start justify-between text-xs font-mono"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-ink">{log.action}</span>
                                  <span className="text-ink/40">•</span>
                                  <span className="text-emerald-700 font-semibold">{log.decision}</span>
                                  <span className="text-ink/40">•</span>
                                  <span>Agent: {log.agentId}</span>
                                </div>
                                <div className="text-ink/60 truncate max-w-lg">{log.resource}</div>
                              </div>
                              <span className="text-ink/40 text-[10px]">
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-ink/10 bg-white/80 text-xs font-mono text-ink/60">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Connected to Rabdi DB-Chain Testnet (Arkiv Network)</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-ink text-white font-heading font-semibold hover:opacity-90 transition-opacity cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
