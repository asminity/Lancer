import { createPublicClient, createWalletClient } from '@arkiv-network/sdk';
import { rabdi } from '@arkiv-network/sdk/chains';
import { custom, http, type WalletClient } from 'viem';

// Separate access key (for Arkiv rate limits) from user wallet credentials
const getAccessKey = (): string => {
  return ((import.meta as any).env?.VITE_ARKIV_ACCESS_KEY as string) || '';
};

/**
 * 1. Public Arkiv Client
 * For unauthenticated, zero-gas read queries over standard JSON-RPC.
 * Does not require wallet connection.
 */
export const arkivPublicClient = createPublicClient({
  chain: rabdi({ accessKey: getAccessKey() }),
  transport: http(),
});

/**
 * 2. Wallet-Authorized Arkiv Client
 * Constructs an authenticated Arkiv client from the user's connected wallet.
 * Every write operation (createEntity, patchEntity, extendEntity, deleteEntity)
 * is signed by the user's wallet and paid in tGLM on Rabdi testnet.
 */
export function getArkivWalletClient(walletClient: WalletClient) {
  if (!walletClient.account) {
    throw new Error('WalletClient must have an active account attached.');
  }

  const transport = walletClient.transport as any;
  const provider =
    (transport?.provider && typeof transport.provider.request === 'function' ? transport.provider : null) ||
    (typeof transport?.request === 'function' ? { request: transport.request } : null) ||
    (typeof window !== 'undefined' ? (window as any).ethereum : null);

  return createWalletClient({
    account: walletClient.account,
    chain: rabdi({ accessKey: getAccessKey() }),
    transport: custom(provider),
  });
}
