/**
 * AUTONEX iAI Holder & Staking Contract Service
 * 
 * Target Network: 0G Mainnet (Aristotle) - Chain ID 16661
 * RPC: https://evmrpc.0g.ai
 * Official iAI Token: 0xc77FBd3824cc68e612b26114D176879aDdc29463
 * Official iAI Collateral/Staking Vault: 0x94a5d41dfae4f2ee7c61a80f33a5085c8c252c70
 * 
 * Official Allowance Rate: 1.271 daily compute credits per eligible staked iAI.
 * Refresh Schedule: Refreshed daily at 00:00 UTC.
 */

import { createPublicClient, http, formatEther, parseAbi } from 'viem';

export const ZERO_G_MAINNET = {
  id: 16661,
  name: '0G Mainnet',
  nativeCurrency: { name: '0G Token', symbol: '0G', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://evmrpc.0g.ai'] },
    public: { http: ['https://evmrpc.0g.ai'] }
  },
  blockExplorers: {
    default: { name: 'ChainScan', url: 'https://chainscan.0g.ai' }
  }
} as const;

export const IAI_CONTRACTS = {
  token: '0xc77FBd3824cc68e612b26114D176879aDdc29463' as const,
  vault: '0x94a5d41dfae4f2ee7c61a80f33a5085c8c252c70' as const,
  officialCreditRate: 1.271, // 1.271 credits per staked iAI per day
  refreshSchedule: 'Daily at 00:00 UTC'
};

const tokenAbi = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)'
]);

const vaultAbi = parseAbi([
  'function positionOf(address account) view returns (uint256 collateral, uint256 debt, uint256 epoch)'
]);

export interface IAIOnChainData {
  walletAddress: string;
  heldInWallet: string;           // Formatted iAI held directly in wallet
  actuallyStaked: string;         // Formatted iAI locked in staking position
  stakedCollateralA0G: string;    // Formatted a0G locked collateral
  eligibleStakedAmount: number;   // Numeric staked iAI eligible for daily allowance
  isStakingVerified: boolean;     // True only if actuallyStaked > 0
  indicativeDailyCredits: number; // calculated: eligibleStakedAmount * 1.271
  lastCreditRefresh: string;      // Daily at 00:00 UTC
  rawBalances: {
    tokenBalanceWei: string;
    stakedPositionWei: string;
    collateralWei: string;
  };
}

let publicClientInstance: ReturnType<typeof createPublicClient> | null = null;

export function getZeroGClient() {
  if (!publicClientInstance) {
    publicClientInstance = createPublicClient({
      chain: ZERO_G_MAINNET,
      transport: http('https://evmrpc.0g.ai', {
        timeout: 10_000,
        retryCount: 2
      })
    });
  }
  return publicClientInstance;
}

/**
 * Live on-chain verification of iAI holdings and staked position on 0G Mainnet.
 * Strictly distinguishes between wallet token balance and actual staked position.
 */
export async function queryOnChainIAIStatus(address: string): Promise<IAIOnChainData> {
  const client = getZeroGClient();
  const validAddress = address.trim() as `0x${string}`;

  try {
    const [balanceWei, positionData] = await Promise.all([
      client.readContract({
        address: IAI_CONTRACTS.token,
        abi: tokenAbi,
        functionName: 'balanceOf',
        args: [validAddress]
      }),
      client.readContract({
        address: IAI_CONTRACTS.vault,
        abi: vaultAbi,
        functionName: 'positionOf',
        args: [validAddress]
      })
    ]);

    const collateralWei = positionData[0];
    const stakedDebtWei = positionData[1]; // Minted/staked iAI position

    const heldInWalletFormatted = formatEther(balanceWei);
    const actuallyStakedFormatted = formatEther(stakedDebtWei);
    const collateralFormatted = formatEther(collateralWei);

    const eligibleStaked = parseFloat(actuallyStakedFormatted);
    const isStakingVerified = eligibleStaked > 0;
    const indicativeDailyCredits = parseFloat((eligibleStaked * IAI_CONTRACTS.officialCreditRate).toFixed(4));

    return {
      walletAddress: validAddress,
      heldInWallet: heldInWalletFormatted,
      actuallyStaked: actuallyStakedFormatted,
      stakedCollateralA0G: collateralFormatted,
      eligibleStakedAmount: eligibleStaked,
      isStakingVerified,
      indicativeDailyCredits,
      lastCreditRefresh: IAI_CONTRACTS.refreshSchedule,
      rawBalances: {
        tokenBalanceWei: balanceWei.toString(),
        stakedPositionWei: stakedDebtWei.toString(),
        collateralWei: collateralWei.toString()
      }
    };
  } catch (err: any) {
    console.warn(`[0G iAI Verification] Error querying on-chain data for ${address}:`, err?.message || err);
    // Return zero state on network error, preserving integrity without throwing
    return {
      walletAddress: validAddress,
      heldInWallet: '0',
      actuallyStaked: '0',
      stakedCollateralA0G: '0',
      eligibleStakedAmount: 0,
      isStakingVerified: false,
      indicativeDailyCredits: 0,
      lastCreditRefresh: IAI_CONTRACTS.refreshSchedule,
      rawBalances: {
        tokenBalanceWei: '0',
        stakedPositionWei: '0',
        collateralWei: '0'
      }
    };
  }
}

