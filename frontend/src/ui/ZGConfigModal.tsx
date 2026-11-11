import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, ZGStatus } from '@/state/store';
import { Icon, I } from './Icons';
import {
  isWalletProviderAvailable,
  connectBrowserWallet,
  switchOrAddZeroGNetwork,
  fetchAuthNonce,
  buildAuthMessage,
  signAuthChallenge,
  verifySignatureWithBackend
} from '@/services/walletAuth';

export function ZGConfigModal() {
  const open = useStore((s) => s.zgModalOpen);
  const conn = useStore((s) => s.zgConnection);
  const iai = useStore((s) => s.iai);
  const setOpen = useStore((s) => s.setZGModalOpen);
  const verifyKey = useStore((s) => s.verifyZGKey);
  const disconnectZG = useStore((s) => s.disconnectZG);
  const checkStatus = useStore((s) => s.checkZGStatus);
  const connectWallet = useStore((s) => s.connectWallet);
  const disconnectWallet = useStore((s) => s.disconnectWallet);
  const refreshIAIStatus = useStore((s) => s.refreshIAIStatus);
  const refreshIAIUsage = useStore((s) => s.refreshIAIUsage);
  const runTestInference = useStore((s) => s.runTestInference);

  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState('');
  const [isSigning, setIsSigning] = useState(false);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);
  const [isTestingInference, setIsTestingInference] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'wallet' | 'apikey' | 'inference'>('overview');

  useEffect(() => {
    if (open) {
      checkStatus();
      refreshIAIUsage();
      setLocalError(null);
    }
  }, [open, checkStatus, refreshIAIUsage]);

  if (!open) return null;

  const handleVerifyKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputKey.trim()) {
      setLocalError('Please enter your 0G API Key');
      return;
    }
    setLocalError(null);
    const result = await verifyKey(inputKey.trim());
    if (result.valid) {
      setInputKey('');
      refreshIAIUsage();
    } else {
      setLocalError(result.message);
    }
  };

  const handleDisconnectKey = async () => {
    await disconnectZG();
    setInputKey('');
    setLocalError(null);
  };

  const handleConnectBrowserWallet = async () => {
    setIsConnectingWallet(true);
    setLocalError(null);
    try {
      if (!isWalletProviderAvailable()) {
        throw new Error('No EVM wallet found in browser. Please install MetaMask or use manual address query.');
      }
      const { address, chainId } = await connectBrowserWallet();
      await switchOrAddZeroGNetwork().catch(() => {});
      await connectWallet(address, chainId);
    } catch (err: any) {
      setLocalError(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnectingWallet(false);
    }
  };

  const handleManualAddressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualAddress.trim().startsWith('0x') || manualAddress.trim().length !== 42) {
      setLocalError('Please enter a valid 0x Ethereum/0G wallet address.');
      return;
    }
    setLocalError(null);
    await connectWallet(manualAddress.trim(), 16661);
  };

  const handleSignNonce = async () => {
    if (!iai.walletAddress) return;
    setIsSigning(true);
    setLocalError(null);
    try {
      const { nonce, issuedAt } = await fetchAuthNonce(iai.walletAddress);
      const challengeMsg = buildAuthMessage(iai.walletAddress, nonce, issuedAt);
      const signature = await signAuthChallenge(iai.walletAddress, challengeMsg);
      const authRes = await verifySignatureWithBackend(iai.walletAddress, challengeMsg, signature, nonce);

      if (authRes.verified) {
        useStore.setState((s) => ({
          iai: {
            ...s.iai,
            isOwnerVerified: true,
            authToken: authRes.token
          }
        }));
      } else {
        setLocalError(authRes.message || 'Signature verification failed');
      }
    } catch (err: any) {
      setLocalError(err.message || 'Signing was cancelled or failed');
    } finally {
      setIsSigning(false);
    }
  };

  const handleRunInferenceTest = async () => {
    setIsTestingInference(true);
    setLocalError(null);
    setTestResult(null);
    try {
      const res = await runTestInference('State test confirmation: AUTONEX + 0G + iAI active.');
      if (res.ok) {
        setTestResult(res.result);
      } else {
        setLocalError(res.error || '0G inference failed');
      }
    } catch (err: any) {
      setLocalError(err.message || 'Inference call error');
    } finally {
      setIsTestingInference(false);
    }
  };

  // Explicit States Mapping
  const walletBadge = iai.walletConnected ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-800 text-[11px] font-mono border border-emerald-500/20 font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Wallet connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-ink/5 text-ink/60 text-[11px] font-mono border border-ink/15">
      <span className="w-1.5 h-1.5 rounded-full bg-ink/30" />
      Wallet not connected
    </span>
  );

  const stakingBadge = iai.stakingStatus === 'verified' ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-800 text-[11px] font-mono border border-emerald-500/20 font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      iAI staking verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 text-amber-800 text-[11px] font-mono border border-amber-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
      iAI staking not detected
    </span>
  );

  const apiKeyBadge = conn.isVerified ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-800 text-[11px] font-mono border border-emerald-500/20 font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      API connection verified
    </span>
  ) : conn.status === 'invalid_key' ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-800 text-[11px] font-mono border border-rose-500/20 font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
      API key invalid
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-ink/5 text-ink/60 text-[11px] font-mono border border-ink/15">
      <span className="w-1.5 h-1.5 rounded-full bg-ink/30" />
      API key missing
    </span>
  );

  const balanceBadge = (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-500/10 text-slate-800 text-[11px] font-mono border border-slate-500/20" title="0G sk- inference keys are scoped for billing execution only. Balance introspection requires mk- management keys.">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
      Compute balance unavailable
    </span>
  );

  const inferenceBadge = iai.lastInferenceStatus === 'successful' ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-800 text-[11px] font-mono border border-emerald-500/20 font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Inference successful
    </span>
  ) : iai.lastInferenceStatus === 'failed' ? (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-800 text-[11px] font-mono border border-rose-500/20 font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
      Inference failed
    </span>
  ) : null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
        onClick={(e) => e.target === e.currentTarget && setOpen(false)}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-2xl rounded-2xl bg-[#FAF7F2] border border-ink/15 shadow-2xl overflow-hidden my-6"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-ink/10 flex items-center justify-between bg-white/70">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center shadow-xs"
                style={{ background: 'var(--accent)' }}
              >
                <span className="font-heading font-black text-white text-xs tracking-wider">0G</span>
              </div>
              <div>
                <h2 className="font-heading font-bold text-base text-ink flex items-center gap-2">
                  0G Private Computer & iAI Hub
                  <span className="text-[10px] font-mono uppercase bg-accent/10 text-accent font-semibold px-2 py-0.5 rounded border border-accent/20">
                    ETHGlobal Mumbai
                  </span>
                </h2>
                <p className="text-[11px] font-mono text-ink/50">
                  Decentralized TEE AI Inference & Verified iAI Staking Allowance
                </p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
            >
              <Icon d={I.x} size={16} />
            </button>
          </div>

          {/* Navigation Sub-Tabs */}
          <div className="flex border-b border-ink/10 bg-white/40 px-6 pt-2 text-xs font-heading font-semibold text-ink/60 gap-4">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-2.5 transition-colors border-b-2 ${activeTab === 'overview' ? 'border-accent text-ink font-bold' : 'border-transparent hover:text-ink'}`}
            >
              Status Overview
            </button>
            <button
              onClick={() => setActiveTab('wallet')}
              className={`pb-2.5 transition-colors border-b-2 ${activeTab === 'wallet' ? 'border-accent text-ink font-bold' : 'border-transparent hover:text-ink'}`}
            >
              Wallet & iAI Staking
            </button>
            <button
              onClick={() => setActiveTab('apikey')}
              className={`pb-2.5 transition-colors border-b-2 ${activeTab === 'apikey' ? 'border-accent text-ink font-bold' : 'border-transparent hover:text-ink'}`}
            >
              0G Router API Key
            </button>
            <button
              onClick={() => setActiveTab('inference')}
              className={`pb-2.5 transition-colors border-b-2 ${activeTab === 'inference' ? 'border-accent text-ink font-bold' : 'border-transparent hover:text-ink'}`}
            >
              Inference & Credit Consumption
            </button>
          </div>

          {/* Body Content */}
          <div className="p-6 space-y-5">
            {/* Error Notification */}
            {(localError || conn.error) && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-800 text-xs font-body flex items-start gap-2"
              >
                <span className="font-bold shrink-0 mt-0.5">⚠️</span>
                <span>{localError || conn.error}</span>
              </motion.div>
            )}

            {/* TAB 1: OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-4">
                {/* 10 Explicit State Badges Bar */}
                <div className="p-4 rounded-xl bg-white border border-ink/10 shadow-xs space-y-3">
                  <div className="flex items-center justify-between border-b border-ink/5 pb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-ink/50 font-bold">
                      Current Integration States
                    </span>
                    <span className="text-[10px] font-mono text-ink/40">Chain: 16661 (0G Mainnet)</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {walletBadge}
                    {stakingBadge}
                    {apiKeyBadge}
                    {balanceBadge}
                    {inferenceBadge}
                  </div>
                </div>

                {/* Status Summary Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Staking Summary Card */}
                  <div className="p-4 rounded-xl bg-white border border-ink/10 space-y-2">
                    <span className="text-[10px] font-mono uppercase text-ink/40 font-bold block">
                      iAI Staking & Daily Credits
                    </span>
                    <div className="flex justify-between items-baseline">
                      <span className="text-xl font-mono font-bold text-ink">
                        {(iai.eligibleStakedAmount ?? 0).toFixed(4)} <span className="text-xs text-ink/50 font-normal">iAI</span>
                      </span>
                      <span className="text-xs font-mono text-emerald-700 bg-emerald-500/10 px-2 py-0.5 rounded font-bold">
                        {(iai.indicativeDailyCredits ?? 0).toFixed(4)} credits/day
                      </span>
                    </div>
                    <p className="text-[11px] text-ink/60 font-body">
                      Calculated at official 1.271 credits/day per eligible staked iAI. Refreshes at 00:00 UTC.
                    </p>
                  </div>

                  {/* 0G Router Key Summary Card */}
                  <div className="p-4 rounded-xl bg-white border border-ink/10 space-y-2">
                    <span className="text-[10px] font-mono uppercase text-ink/40 font-bold block">
                      0G Private Computer Router
                    </span>
                    <div className="flex justify-between items-baseline">
                      <span className="text-sm font-mono font-bold text-ink">
                        {conn.isVerified ? conn.maskedKey : 'Not Connected'}
                      </span>
                      <span className={`text-xs font-mono px-2 py-0.5 rounded font-bold ${conn.isVerified ? 'text-emerald-700 bg-emerald-500/10' : 'text-ink/40 bg-ink/5'}`}>
                        {conn.isVerified ? 'Live Verified' : 'Key Required'}
                      </span>
                    </div>
                    <p className="text-[11px] text-ink/60 font-body">
                      Official Router: <code className="text-[10px] bg-ink/5 px-1 py-0.5 rounded">https://router-api.0g.ai/v1</code>
                    </p>
                  </div>
                </div>

                {/* Model Inference & Real Consumption Snapshot */}
                <div className="p-4 rounded-xl bg-white border border-ink/10 space-y-2.5 text-xs font-body">
                  <div className="flex justify-between items-center text-ink/70">
                    <span className="text-ink/50">Total Inference Requests:</span>
                    <span className="font-mono font-bold text-ink">{iai.totalInferenceRequests}</span>
                  </div>
                  <div className="flex justify-between items-center text-ink/70">
                    <span className="text-ink/50">Total Tokens Processed:</span>
                    <span className="font-mono font-bold text-ink">{iai.totalTokensUsed.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center text-ink/70">
                    <span className="text-ink/50">Cumulative 0G Billing (Micro-USD):</span>
                    <span className="font-mono font-bold text-emerald-700">${(iai.totalCostMicroUsd / 1_000_000).toFixed(6)}</span>
                  </div>
                  {iai.lastRequestId && (
                    <div className="flex justify-between items-center text-ink/70">
                      <span className="text-ink/50">Last Verified Request ID:</span>
                      <span className="font-mono text-[10px] text-ink/70 bg-ink/5 px-2 py-0.5 rounded truncate max-w-[280px]">
                        {iai.lastRequestId}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: WALLET & IAI STAKING */}
            {activeTab === 'wallet' && (
              <div className="space-y-4">
                {/* Connected Wallet Box */}
                {iai.walletConnected ? (
                  <div className="p-4 rounded-xl bg-white border border-ink/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase text-ink/40 font-bold">Connected Account</span>
                      <button
                        onClick={disconnectWallet}
                        className="text-[11px] text-rose-600 hover:text-rose-800 underline font-body"
                      >
                        Disconnect Wallet
                      </button>
                    </div>

                    <div className="p-2.5 rounded-lg bg-ink/5 font-mono text-xs text-ink font-bold break-all flex items-center justify-between">
                      <span>{iai.walletAddress}</span>
                      <a
                        href={`https://chainscan.0g.ai/address/${iai.walletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-accent hover:underline ml-2 shrink-0 font-normal"
                      >
                        ChainScan ↗
                      </a>
                    </div>

                    {/* Nonce Signature Challenge */}
                    <div className="p-3 rounded-lg border border-ink/10 bg-[#FAF7F2] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-heading font-semibold text-ink">
                          Cryptographic Nonce Proof (SIWE)
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${iai.isOwnerVerified ? 'bg-emerald-500/10 text-emerald-800' : 'bg-amber-500/10 text-amber-800'}`}>
                          {iai.isOwnerVerified ? 'Ownership Proven' : 'Signature Required'}
                        </span>
                      </div>
                      <p className="text-[11px] text-ink/60 font-body">
                        Sign an off-chain message using your wallet's private key to prove identity without revealing credentials or paying gas.
                      </p>
                      {!iai.isOwnerVerified && (
                        <button
                          type="button"
                          onClick={handleSignNonce}
                          disabled={isSigning}
                          className="px-3 py-1.5 rounded-lg text-white font-heading text-xs font-semibold transition-transform hover:scale-102"
                          style={{ background: 'var(--accent)' }}
                        >
                          {isSigning ? 'Requesting Signature...' : 'Sign Nonce Challenge'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Connect Wallet Actions */
                  <div className="p-5 rounded-xl bg-white border border-ink/10 space-y-4">
                    <div className="space-y-1">
                      <h3 className="font-heading font-bold text-sm text-ink">Connect Your 0G Web3 Wallet</h3>
                      <p className="text-xs text-ink/60 font-body">
                        Connect MetaMask, Rabby, or enter any 0G Mainnet wallet address to verify your staked iAI compute allowance.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        type="button"
                        onClick={handleConnectBrowserWallet}
                        disabled={isConnectingWallet}
                        className="flex-1 px-4 py-2.5 rounded-xl text-white font-heading text-xs font-semibold shadow-xs flex items-center justify-center gap-2 transition-transform hover:scale-102"
                        style={{ background: 'var(--accent)' }}
                      >
                        <span>🦊</span>
                        <span>{isConnectingWallet ? 'Connecting...' : 'Connect Browser Wallet'}</span>
                      </button>
                    </div>

                    <div className="relative flex py-1 items-center">
                      <div className="flex-grow border-t border-ink/10"></div>
                      <span className="flex-shrink mx-3 text-[10px] font-mono text-ink/40 uppercase">or check any address</span>
                      <div className="flex-grow border-t border-ink/10"></div>
                    </div>

                    <form onSubmit={handleManualAddressSubmit} className="flex gap-2">
                      <input
                        type="text"
                        value={manualAddress}
                        onChange={(e) => setManualAddress(e.target.value)}
                        placeholder="0x... (0G wallet address)"
                        className="flex-1 rounded-xl border border-ink/20 bg-white px-3 py-2 font-mono text-xs text-ink outline-none focus:border-ink/50"
                      />
                      <button
                        type="submit"
                        className="px-4 py-2 rounded-xl bg-ink/10 text-ink font-heading text-xs font-semibold hover:bg-ink/15 transition-colors"
                      >
                        Inspect
                      </button>
                    </form>
                  </div>
                )}

                {/* Staking Eligibility Details Card */}
                <div className="p-4 rounded-xl bg-white border border-ink/10 space-y-3">
                  <div className="flex items-center justify-between border-b border-ink/5 pb-2">
                    <span className="text-xs font-heading font-bold text-ink">Verified On-Chain Staking Breakdown</span>
                    <button
                      onClick={() => refreshIAIStatus()}
                      className="text-[11px] text-accent hover:underline font-body"
                    >
                      Refresh On-Chain Status ⟳
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div className="p-2.5 rounded-lg bg-ink/5 space-y-0.5">
                      <span className="text-[10px] text-ink/40 uppercase block">iAI Held in Wallet</span>
                      <span className="font-bold text-ink">{(parseFloat(iai.heldIAI || '0') || 0).toFixed(6)} iAI</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-ink/5 space-y-0.5">
                      <span className="text-[10px] text-ink/40 uppercase block">iAI Actually Staked</span>
                      <span className="font-bold text-emerald-700">{(parseFloat(iai.stakedIAI || '0') || 0).toFixed(6)} iAI</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-ink/5 space-y-0.5">
                      <span className="text-[10px] text-ink/40 uppercase block">Locked Collateral (a0G)</span>
                      <span className="font-bold text-ink">{(parseFloat(iai.stakedCollateralA0G || '0') || 0).toFixed(4)} a0G</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-0.5">
                      <span className="text-[10px] text-emerald-800 uppercase block font-semibold">Daily Indicative Allowance</span>
                      <span className="font-bold text-emerald-900">{(iai.indicativeDailyCredits ?? 0).toFixed(4)} credits/day</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15 text-[11px] text-amber-900/80 space-y-1 font-body">
                    <p className="font-semibold text-amber-950">Rules of Eligibility:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                      <li>Token ownership alone does not grant compute credits; tokens must be staked in the official vault.</li>
                      <li>Credits refresh daily at 00:00 UTC and expire if unspent.</li>
                      <li>Official formula: <strong>1.271 compute credits per eligible staked iAI</strong>.</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: 0G ROUTER API KEY */}
            {activeTab === 'apikey' && (
              <div className="space-y-4">
                {conn.isVerified ? (
                  <div className="p-5 rounded-xl bg-white border border-ink/10 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-heading font-bold text-ink">Active 0G Private Computer Key</span>
                      <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        {conn.maskedKey}
                      </span>
                    </div>

                    <div className="p-3 rounded-lg bg-ink/5 font-mono text-[11px] text-ink/70 space-y-1.5">
                      <div className="flex justify-between">
                        <span>Router Endpoint:</span>
                        <span className="text-ink font-medium">https://router-api.0g.ai/v1</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Associated Wallet:</span>
                        <span className="text-ink font-medium">{iai.walletAddress || 'Unlinked'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Verified At:</span>
                        <span className="text-ink font-medium">{conn.lastVerifiedAt ? new Date(conn.lastVerifiedAt).toLocaleTimeString() : 'Active'}</span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center pt-2">
                      <button
                        type="button"
                        onClick={handleDisconnectKey}
                        className="px-4 py-2 rounded-xl border border-rose-500/30 text-rose-700 font-heading text-xs font-semibold hover:bg-rose-500/10 transition-colors"
                      >
                        Disconnect & Replace Key
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleVerifyKey} className="p-5 rounded-xl bg-white border border-ink/10 space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="font-heading text-xs font-semibold text-ink">
                        0G Private Computer API Key
                      </label>
                      <a
                        href="https://pc.0g.ai"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-accent hover:underline font-body"
                      >
                        Generate API key at pc.0g.ai ↗
                      </a>
                    </div>

                    <div className="relative">
                      <input
                        type={showKey ? 'text' : 'password'}
                        value={inputKey}
                        onChange={(e) => setInputKey(e.target.value)}
                        placeholder="Paste your 0G Private Computer API key (sk-...)"
                        disabled={conn.status === 'validating'}
                        className="w-full rounded-xl border border-ink/20 bg-white px-3.5 py-2.5 pr-10 font-mono text-xs text-ink outline-none focus:border-ink/50 focus:ring-1 focus:ring-ink/20 shadow-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-[10px] font-mono font-bold text-ink/50 hover:text-ink transition-colors bg-ink/5"
                      >
                        {showKey ? 'HIDE' : 'SHOW'}
                      </button>
                    </div>

                    <p className="text-[11px] text-ink/50 font-body">
                      Your key is securely stored in backend session memory and associated with your authenticated wallet. It is never exposed in client logs or bundles.
                    </p>

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={conn.status === 'validating'}
                        className="w-full py-2.5 rounded-xl text-white font-heading text-xs font-semibold shadow-xs transition-transform hover:scale-101"
                        style={{ background: 'var(--accent)' }}
                      >
                        {conn.status === 'validating' ? 'Verifying with 0G Router...' : 'Connect & Verify 0G Key'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* TAB 4: INFERENCE & CREDIT CONSUMPTION */}
            {activeTab === 'inference' && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-white border border-ink/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-heading font-bold text-ink">
                      Real 0G Inference & Credit Metering
                    </span>
                    <button
                      type="button"
                      onClick={handleRunInferenceTest}
                      disabled={isTestingInference || !conn.isVerified}
                      className="px-3 py-1.5 rounded-lg text-white font-heading text-xs font-semibold transition-transform hover:scale-102 disabled:opacity-50"
                      style={{ background: 'var(--accent)' }}
                    >
                      {isTestingInference ? 'Running on 0G...' : 'Execute Test Inference on 0G'}
                    </button>
                  </div>

                  <p className="text-xs text-ink/60 font-body">
                    When AUTONEX autonomous agents execute code refactoring, planning, or QA rounds, inference is routed through your 0G Private Computer account, consuming your daily credits.
                  </p>

                  {/* Metering Metrics */}
                  <div className="grid grid-cols-3 gap-2.5 pt-1 text-center font-mono">
                    <div className="p-2.5 rounded-lg bg-ink/5">
                      <span className="text-[10px] text-ink/40 uppercase block">Total Requests</span>
                      <span className="font-bold text-base text-ink">{iai.totalInferenceRequests || 0}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-ink/5">
                      <span className="text-[10px] text-ink/40 uppercase block">Total Tokens</span>
                      <span className="font-bold text-base text-ink">{iai.totalTokensUsed || 0}</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-emerald-500/10">
                      <span className="text-[10px] text-emerald-800 uppercase block font-semibold">Cost (Micro-USD)</span>
                      <span className="font-bold text-base text-emerald-900">${((iai.totalCostMicroUsd || 0) / 1_000_000).toFixed(6)}</span>
                    </div>
                  </div>

                  {/* Test Inference Live Output */}
                  {testResult && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs font-mono space-y-1.5"
                    >
                      <div className="flex justify-between items-center text-emerald-800 font-bold">
                        <span>✓ 0G Private Computer Live Response</span>
                        <span className="text-[10px]">{testResult.latencyMs}ms</span>
                      </div>
                      <div className="p-2 bg-white rounded border border-emerald-500/20 text-ink/80 text-[11px]">
                        "{testResult.content}"
                      </div>
                      <div className="text-[10px] text-ink/50 flex justify-between">
                        <span>Request ID: {testResult.requestId}</span>
                        <span>Model: {testResult.model}</span>
                      </div>
                      {testResult.billing && (
                        <div className="text-[10px] text-emerald-700 bg-emerald-500/10 p-1.5 rounded flex justify-between">
                          <span>0G Billing Trace: {testResult.billing.totalCostUsdMicro} micro-USD</span>
                          <span>Provider: {testResult.providerAddress ? testResult.providerAddress.slice(0, 10) + '...' : 'Verified TEE'}</span>
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 border-t border-ink/10 flex items-center justify-between bg-white/70">
            <span className="text-[10px] font-mono text-ink/40">
              AUTONEX · 0G Private Computer & iAI Verification Engine
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-5 py-2 rounded-xl text-white font-heading text-xs font-semibold shadow-xs transition-transform hover:scale-102"
              style={{ background: 'var(--accent)' }}
            >
              Done
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
