/**
 * AUTONEX iAI Credit Manager
 * Calculates daily allowances, tracks expiry countdown to 00:00 UTC,
 * enforces safety buffers, and handles distinction between estimated vs provider-confirmed credits.
 */

import { IAI_CONTRACTS, queryOnChainIAIStatus, type IAIOnChainData } from '../iaiContract';
import type { IAICreditAccount, CreditUtilizationStatus } from './types';

export function calculateSecondsUntilNextUTC00(): number {
  const now = new Date();
  const nextUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return Math.max(0, Math.floor((nextUTC.getTime() - now.getTime()) / 1000));
}

export function formatTimeUntilExpiry(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export function getNextUTCRefreshISO(): string {
  const now = new Date();
  const nextUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return nextUTC.toISOString();
}

export function evaluateUtilizationStatus(
  available: number,
  consumed: number,
  secondsUntilExpiry: number
): CreditUtilizationStatus {
  if (available <= 0 && consumed <= 0) return 'unconnected';
  const total = available + consumed;
  if (total <= 0) return 'depleted';
  const utilizationRate = consumed / total;

  if (secondsUntilExpiry <= 7200 && utilizationRate < 0.6) {
    // Under 2 hours remaining and over 40% unspent credits
    return 'critical_expiry';
  }
  if (secondsUntilExpiry <= 21600 && utilizationRate < 0.4) {
    // Under 6 hours remaining and over 60% unspent credits
    return 'underutilized';
  }
  if (available <= 0.05 * total) {
    return 'optimal';
  }
  return 'optimal';
}

/**
 * Builds realistic, isolated demo fixture for stage 1 demonstration
 */
export function getDemoCreditAccount(): IAICreditAccount {
  const secondsLeft = calculateSecondsUntilNextUTC00();
  const staked = 5000;
  const entitlement = parseFloat((staked * IAI_CONTRACTS.officialCreditRate).toFixed(2)); // 6,355.00
  const consumed = 1420.50;
  const reserved = 850.00;
  const remaining = parseFloat((entitlement - consumed - reserved).toFixed(2)); // 4,084.50

  return {
    walletAddress: '0x46aa5cdf0067ffc0361db174cd5b7618df9c1edd',
    heldIAI: '12500.0',
    stakedIAI: '5000.0',
    stakedCollateralA0G: '10000.0',
    eligibleStakedAmount: staked,
    isStakingVerified: true,
    indicativeDailyCredits: entitlement,
    availableCredits: entitlement,
    reservedCredits: reserved,
    consumedCredits: consumed,
    remainingCredits: remaining,
    nextExpiryUTC: getNextUTCRefreshISO(),
    secondsUntilExpiry: secondsLeft,
    utilizationStatus: evaluateUtilizationStatus(remaining, consumed, secondsLeft),
    isDemoMode: true,
    providerConfirmed: true,
    notes: [
      'Demo Mode Fixture: Simulating 5,000 staked iAI position on 0G Mainnet',
      'Daily entitlement: 5,000 × 1.271 = 6,355.00 credits/day',
      'Unused credits strictly expire daily at 00:00 UTC',
      'AUTONEX ensures complete credit utilization before deadline'
    ]
  };
}

/**
 * Fetches authoritative on-chain iAI status for production mode
 */
export async function getProductionCreditAccount(walletAddress: string | null): Promise<IAICreditAccount> {
  const secondsLeft = calculateSecondsUntilNextUTC00();
  const nextExpiry = getNextUTCRefreshISO();

  if (!walletAddress) {
    return {
      walletAddress: null,
      heldIAI: '0',
      stakedIAI: '0',
      stakedCollateralA0G: '0',
      eligibleStakedAmount: 0,
      isStakingVerified: false,
      indicativeDailyCredits: 0,
      availableCredits: 0,
      reservedCredits: 0,
      consumedCredits: 0,
      remainingCredits: 0,
      nextExpiryUTC: nextExpiry,
      secondsUntilExpiry: secondsLeft,
      utilizationStatus: 'unconnected',
      isDemoMode: false,
      providerConfirmed: false,
      notes: ['No wallet connected. Connect 0G Mainnet wallet (Chain ID 16661) to load on-chain staking data.']
    };
  }

  try {
    const onChain: IAIOnChainData = await queryOnChainIAIStatus(walletAddress);
    const entitlement = onChain.indicativeDailyCredits;
    const isVerified = onChain.isStakingVerified;

    // Distinguish estimated entitlement from provider-confirmed available balance
    // 0G sk- key scope limitations mean raw credit balance cannot be introspected via management API
    return {
      walletAddress: onChain.walletAddress,
      heldIAI: onChain.heldInWallet,
      stakedIAI: onChain.actuallyStaked,
      stakedCollateralA0G: onChain.stakedCollateralA0G,
      eligibleStakedAmount: onChain.eligibleStakedAmount,
      isStakingVerified: isVerified,
      indicativeDailyCredits: entitlement,
      availableCredits: entitlement, // Estimated from on-chain staking formula
      reservedCredits: 0,
      consumedCredits: 0,
      remainingCredits: entitlement,
      nextExpiryUTC: nextExpiry,
      secondsUntilExpiry: secondsLeft,
      utilizationStatus: isVerified ? evaluateUtilizationStatus(entitlement, 0, secondsLeft) : 'underutilized',
      isDemoMode: false,
      providerConfirmed: false, // Honestly marked unverified for raw provider introspection
      notes: [
        `Live on-chain query from 0G Mainnet (Chain ID 16661)`,
        isVerified
          ? `Verified active Vault debt position: ${onChain.actuallyStaked} iAI`
          : 'Zero staked iAI detected in Vault (0x94a5...2c70)',
        'Unused daily allowances expire at 00:00 UTC',
        '0G sk- API keys are scoped for execution billing; account balance introspection requires mk- key'
      ]
    };
  } catch (err: any) {
    return {
      walletAddress,
      heldIAI: '0',
      stakedIAI: '0',
      stakedCollateralA0G: '0',
      eligibleStakedAmount: 0,
      isStakingVerified: false,
      indicativeDailyCredits: 0,
      availableCredits: 0,
      reservedCredits: 0,
      consumedCredits: 0,
      remainingCredits: 0,
      nextExpiryUTC: nextExpiry,
      secondsUntilExpiry: secondsLeft,
      utilizationStatus: 'depleted',
      isDemoMode: false,
      providerConfirmed: false,
      notes: [`On-chain query failed: ${err?.message || 'RPC unreachable'}`]
    };
  }
}

