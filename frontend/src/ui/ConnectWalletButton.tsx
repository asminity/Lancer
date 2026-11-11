import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useBalance, useSwitchChain } from 'wagmi';
import { formatEther } from 'viem';
import { rabdiChain, switchOrAddRabdiNetwork } from '@/config/chain';
import { RABDI_EXPLORER_URL, RABDI_FAUCET_URL } from '@/services/arkiv/balance';

export function ConnectWalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: balanceData } = useBalance({
    address,
    chainId: rabdiChain.id,
  });

  // Only flag wrong network when chainId is known (not undefined) AND differs from Rabdi DB-Chain.
  // chainId is undefined while wagmi is resolving the active chain — guard against false positives.
  const isWrongNetwork = isConnected && chainId !== undefined && chainId !== rabdiChain.id;

  const shortAddr = address
    ? `${address.slice(0, 5)}...${address.slice(-4)}`
    : '';

  const formattedBalance = balanceData
    ? `${parseFloat(formatEther(balanceData.value)).toFixed(3)} tGLM`
    : '0.000 tGLM';

  const copyAddress = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 1. Disconnected State
  if (!isConnected) {
    return (
      <button
        onClick={() => {
          const injectedConnector = connectors.find((c) => c.id === 'injected') || connectors[0];
          if (injectedConnector) connect({ connector: injectedConnector });
        }}
        disabled={isConnecting}
        className="rounded-lg px-2.5 py-1 text-[11px] font-heading font-medium text-white shadow-xs transition-opacity hover:opacity-90 flex items-center gap-1.5 cursor-pointer shrink-0"
        style={{ background: 'var(--accent)' }}
        title="Connect browser wallet (MetaMask / Rabby / Injected)"
      >
        <span className="w-2 h-2 rounded-full bg-white/70" />
        <span>{isConnecting ? 'Connecting...' : 'Connect Wallet'}</span>
      </button>
    );
  }

  // 2. Wrong Network Warning State
  if (isWrongNetwork) {
    return (
      <button
        onClick={async () => {
          try {
            if (switchChain) {
              switchChain({ chainId: rabdiChain.id });
            } else {
              await switchOrAddRabdiNetwork();
            }
          } catch {
            await switchOrAddRabdiNetwork();
          }
        }}
        disabled={isSwitching}
        className="rounded-lg border border-red-400 bg-red-50 px-2 py-1 text-[10.5px] font-mono text-red-700 hover:bg-red-100 transition-colors flex items-center gap-1 shrink-0 cursor-pointer shadow-xs"
        title="Switch to Rabdi DB-Chain Testnet (Chain ID 7794095)"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
        <span>{isSwitching ? 'Switching...' : 'Switch to Rabdi'}</span>
      </button>
    );
  }

  // 3. Connected on Rabdi DB-Chain
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="rounded-lg border border-ink/15 bg-white/90 px-2 py-1 text-[10.5px] font-mono flex items-center gap-2 hover:border-ink/40 transition-all shadow-xs cursor-pointer"
        title="Wallet connected on Rabdi DB-Chain"
      >
        {/* Network status */}
        <span className="flex items-center gap-1 text-emerald-700 font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="hidden sm:inline">Rabdi</span>
        </span>

        <span className="text-ink/20">|</span>

        {/* Live tGLM balance */}
        <span className="text-ink/80 font-medium hidden md:inline">
          {formattedBalance}
        </span>

        <span className="text-ink/20 hidden md:inline">|</span>

        {/* Address badge */}
        <span className="text-ink/90 font-bold bg-ink/5 px-1.5 py-0.5 rounded text-[10px]">
          {shortAddr}
        </span>
      </button>

      {/* Account Popover Menu */}
      {dropdownOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setDropdownOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-ink/15 bg-white p-3 shadow-xl z-50 text-[11px] font-body space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-ink/10">
              <span className="text-ink/60 font-mono text-[10px] uppercase">Account</span>
              <span className="text-emerald-700 font-mono text-[10px] flex items-center gap-1 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Rabdi (7794095)
              </span>
            </div>

            <div className="flex items-center justify-between bg-ink/5 rounded-lg p-2 font-mono text-[10.5px]">
              <span className="truncate mr-2">{address}</span>
              <button
                onClick={copyAddress}
                className="text-[10px] text-ink/70 hover:text-ink font-heading font-medium shrink-0 cursor-pointer"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            <div className="flex items-center justify-between px-1 text-ink/75 font-mono">
              <span>Balance:</span>
              <span className="font-bold text-ink">{formattedBalance}</span>
            </div>

            <div className="pt-2 border-t border-ink/10 flex flex-col gap-1.5">
              <a
                href={`${RABDI_EXPLORER_URL}/address/${address}`}
                target="_blank"
                rel="noreferrer"
                className="text-ink/70 hover:text-ink flex items-center justify-between py-1 px-1.5 rounded hover:bg-ink/5 transition-colors"
              >
                <span>View on Explorer</span>
                <span className="text-ink/40">↗</span>
              </a>

              <a
                href={RABDI_FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="text-ink/70 hover:text-ink flex items-center justify-between py-1 px-1.5 rounded hover:bg-ink/5 transition-colors"
              >
                <span>Get tGLM Faucet Tokens</span>
                <span className="text-ink/40">↗</span>
              </a>

              <button
                onClick={() => {
                  disconnect();
                  setDropdownOpen(false);
                }}
                className="w-full mt-1 py-1 px-2 rounded bg-red-50 text-red-600 hover:bg-red-100 text-center font-heading font-medium transition-colors cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
