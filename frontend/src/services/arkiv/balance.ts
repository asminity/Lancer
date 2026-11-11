import { formatEther, type Address } from 'viem';
import { arkivPublicClient } from './client';

export const RABDI_FAUCET_URL = 'https://hub.arkiv.network/';
export const RABDI_EXPLORER_URL = 'https://rabdi.explorer.arkiv.network';

/**
 * Retrieve the actual native tGLM balance for a wallet address on Rabdi DB-Chain
 */
export async function fetchTglmBalance(address: Address): Promise<{ value: bigint; formatted: string }> {
  try {
    const value = await arkivPublicClient.getBalance({ address });
    const fullEther = formatEther(value);
    const num = parseFloat(fullEther);
    const formatted = num >= 1 ? num.toFixed(3) : num.toFixed(4);
    return { value, formatted };
  } catch (err) {
    console.warn('[Arkiv] Failed to fetch balance:', err);
    return { value: 0n, formatted: '0.000' };
  }
}

/**
 * Validates whether the account has enough tGLM to execute a write transaction.
 * Defaults to minimum reserve of 0.0001 tGLM for storage gas.
 */
export async function assertSufficientTglm(
  address: Address,
  minimumWei = 100_000_000_000_000n
): Promise<void> {
  const { value } = await fetchTglmBalance(address);
  if (value < minimumWei) {
    throw new Error(
      `Insufficient tGLM balance (${formatEther(value)} tGLM). ` +
      `Writing to Arkiv DB-Chain requires testnet tGLM for storage and gas fees. ` +
      `Claim free tokens from the faucet at ${RABDI_FAUCET_URL}`
    );
  }
}

/**
 * Safely extracts a meaningful error message from any error, object, or RPC response.
 * Guarantees never returning '[object Object]'.
 */
function extractErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') {
    const trimmed = error.trim();
    return trimmed === '[object Object]' ? '' : trimmed;
  }
  if (typeof error === 'object') {
    const err = error as Record<string, any>;

    const candidates = [
      err.shortMessage,
      err.message,
      err.details,
      err.reason,
      err.data?.message,
      err.data?.originalError?.message,
      err.error?.message,
    ];

    for (const cand of candidates) {
      if (typeof cand === 'string' && cand.trim() && cand.trim() !== '[object Object]') {
        return cand.trim();
      }
    }

    if (err.cause) {
      const causeMsg = extractErrorMessage(err.cause);
      if (causeMsg && causeMsg !== '[object Object]') return causeMsg;
    }

    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}' && json !== '[]') {
        return json;
      }
    } catch {
      // Ignore cyclic structure
    }

    if (typeof err.toString === 'function') {
      try {
        const s = err.toString();
        if (s && s !== '[object Object]') return s;
      } catch {
        // Ignore
      }
    }
  }

  const fallback = String(error);
  return fallback === '[object Object]' ? '' : fallback;
}

/**
 * User-friendly parser for Web3 and Arkiv RPC transaction errors
 */
export function formatArkivError(error: unknown): string {
  if (!error) return 'An unexpected error occurred.';

  let msg = '';
  if (typeof error === 'string') {
    msg = error;
  } else if (typeof error === 'object') {
    const err = error as any;
    msg =
      err.shortMessage ||
      err.details ||
      err.reason ||
      err.message ||
      err.data?.message ||
      err.error?.message ||
      err.cause?.shortMessage ||
      err.cause?.message ||
      '';

    if (!msg || msg === '[object Object]') {
      if (typeof err.toString === 'function') {
        const s = err.toString();
        if (s && s !== '[object Object]') {
          msg = s;
        }
      }
    }

    if (!msg || msg === '[object Object]') {
      try {
        msg = JSON.stringify(error);
      } catch {
        msg = 'An error occurred during wallet operation';
      }
    }
  } else {
    msg = String(error);
  }

  const lower = msg.toLowerCase();

  if (
    lower.includes('user rejected') ||
    lower.includes('action_rejected') ||
    lower.includes('denied transaction') ||
    lower.includes('rejected the request') ||
    lower.includes('cancelled') ||
    lower.includes('canceled') ||
    (typeof error === 'object' && (error as any)?.code === 4001)
  ) {
    return 'Transaction cancelled by user in wallet.';
  }
  if (lower.includes('insufficient funds') || lower.includes('insufficient tglm')) {
    return 'Insufficient tGLM balance for storage fee. Claim tokens from hub.arkiv.network.';
  }

  if (
    lower.includes('chainmismatcherror') ||
    lower.includes('wrong chain') ||
    lower.includes('wrong network') ||
    lower.includes('switch to the rabdi') ||
    lower.includes('wallet switch required') ||
    lower.includes('unrecognized chain') ||
    lower.includes('chain not found') ||
    lower.includes('0x76edaf') ||
    lower.includes('0x76ee8f') ||
    lower.includes('7794095')
  ) {
    return 'Please switch your wallet to the Rabdi DB-Chain Testnet (Chain ID 7794095).';
  }
  if (lower.includes('missingaccesskeyerror') || lower.includes('rate limit')) {
    return 'Arkiv RPC rate limit reached. Configure VITE_ARKIV_ACCESS_KEY in .env.local.';
  }
  if (lower.includes('entitytoolargeerror') || lower.includes('max_entity_bytes')) {
    return 'Payload exceeds Arkiv limit of 128 KiB per entity.';
  }

  if (msg.includes('[object Object]')) {
    return 'Wallet operation failed. Please check your wallet connection and try again.';
  }

  return msg.slice(0, 180);
}


