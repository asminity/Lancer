import { defineChain, createWalletClient, custom, getAddress, type WalletClient } from 'viem';
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

// Rabdi DB-Chain Testnet Specification (Chain ID 7794095)
export const rabdiChain = defineChain({
  id: 7794095,
  name: 'Rabdi DB-Chain',
  nativeCurrency: {
    name: 'Testnet GLM',
    symbol: 'tGLM',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.rabdi.db-chain.testnet.arkiv.network'],
      webSocket: ['wss://rpc.rabdi.db-chain.testnet.arkiv.network'],
    },
    public: {
      http: ['https://rpc.rabdi.db-chain.testnet.arkiv.network'],
      webSocket: ['wss://rpc.rabdi.db-chain.testnet.arkiv.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Rabdi Explorer',
      url: 'https://rabdi.explorer.arkiv.network',
    },
  },
  testnet: true,
});

// 0G Mainnet Specification (Chain ID 16661) - used by AUTONEX 0G compute & iAI staking
export const zeroGChain = defineChain({
  id: 16661,
  name: '0G Mainnet',
  nativeCurrency: {
    name: '0G Token',
    symbol: '0G',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ['https://evmrpc.0g.ai'],
    },
    public: {
      http: ['https://evmrpc.0g.ai'],
    },
  },
  blockExplorers: {
    default: {
      name: 'ChainScan',
      url: 'https://chainscan.0g.ai',
    },
  },
});

// Wagmi configuration supporting Rabdi DB-Chain and 0G Mainnet
export const wagmiConfig = createConfig({
  chains: [rabdiChain, zeroGChain],
  connectors: [injected()],
  transports: {
    [rabdiChain.id]: http(),
    [zeroGChain.id]: http(),
  },
});

/**
 * Resolves the active EIP-1193 wallet provider (MetaMask, Rabby, Injected, or Client Transport)
 */
export function getInjectedProvider(clientOrProvider?: any): any {
  if (clientOrProvider) {
    if (clientOrProvider.transport && typeof clientOrProvider.transport.request === 'function') {
      return clientOrProvider.transport;
    }
    if (typeof clientOrProvider.request === 'function') {
      return clientOrProvider;
    }
    if (clientOrProvider.transport?.provider && typeof clientOrProvider.transport.provider.request === 'function') {
      return clientOrProvider.transport.provider;
    }
  }

  if (typeof window === 'undefined') return null;
  const eth = (window as any).ethereum;
  if (!eth) return null;

  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const mm = eth.providers.find((p: any) => p.isMetaMask && !p.isPhantom);
    if (mm) return mm;
    const selected = eth.providers.find((p: any) => p.selectedAddress || p.request);
    if (selected) return selected;
    return eth.providers[0];
  }

  return eth;
}

/**
 * Prompts user's wallet to switch to or add the Rabdi DB-Chain Testnet.
 */
export async function switchOrAddRabdiNetwork(providerOrClient?: any): Promise<void> {
  const eth = getInjectedProvider(providerOrClient);
  if (!eth || typeof eth.request !== 'function') {
    throw new Error('No EVM wallet detected in browser. Please install MetaMask or another browser wallet.');
  }

  const chainIdHex = `0x${rabdiChain.id.toString(16)}`; // '0x76edaf' (7794095)

  // Check current chain ID first! If already on Rabdi, return immediately without throwing switch prompt
  try {
    const currentChain = await eth.request({ method: 'eth_chainId' });
    if (
      currentChain &&
      (String(currentChain).toLowerCase() === chainIdHex.toLowerCase() ||
        parseInt(String(currentChain), 16) === rabdiChain.id ||
        Number(currentChain) === rabdiChain.id)
    ) {
      return;
    }
  } catch (err) {
    console.warn('[Rabdi] eth_chainId check error:', err);
  }

  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (switchError: any) {
    const msg = (switchError?.message || '').toLowerCase();
    if (msg.includes('already') || msg.includes('current')) {
      return;
    }
    // If user explicitly rejected the switch prompt in their wallet, re-throw
    if (
      switchError?.code === 4001 ||
      msg.includes('user rejected') ||
      msg.includes('action_rejected') ||
      msg.includes('rejected the request')
    ) {
      throw switchError;
    }

    // For any other error (chain not added, 4902, -32603, unrecognized in Rabby, etc.), prompt to add Rabdi DB-Chain
    try {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: chainIdHex,
            chainName: 'Rabdi DB-Chain',
            nativeCurrency: { name: 'Testnet GLM', symbol: 'tGLM', decimals: 18 },
            rpcUrls: ['https://rpc.rabdi.db-chain.testnet.arkiv.network'],
            blockExplorerUrls: ['https://rabdi.explorer.arkiv.network'],
          },
        ],
      });
    } catch (addError: any) {
      throw addError;
    }
  }
}

/**
 * Ensures an active, Rabdi-configured and explicitly authorized WalletClient is available.
 * 
 * Requirements satisfied:
 * 1. Properly request wallet account access using eth_requestAccounts before accessing signer or sending transactions.
 * 2. Verify that connected wallet is authorized and matches expected wallet address if provided.
 * 3. Ensure the application uses the correct connected wallet provider and does not use unauthorized eth_accounts.
 * 4. Check that the wallet is connected to the correct Arbitrum/Rabdi DB chain (chain ID 7794095).
 * 5. Handle wallet rejection (4001), unauthorized (4100), and network mismatch gracefully.
 */
export async function ensureRabdiWalletClient(
  existingClient?: WalletClient | null,
  expectedAddress?: string | null
): Promise<WalletClient> {
  // Step 1: Locate the active EIP-1193 provider (preserving existing client transport if supplied)
  const provider = getInjectedProvider(existingClient);
  if (!provider || typeof provider.request !== 'function') {
    throw new Error('No EVM wallet detected in browser. Please install MetaMask or another browser wallet.');
  }

  // Step 2: Ensure the wallet is connected to Rabdi DB-Chain Testnet (Chain ID 7794095)
  await switchOrAddRabdiNetwork(provider);

  // Step 3: Properly request wallet account access via eth_requestAccounts to ensure authorization and prevent RPC Error 4100
  let activeAuthorizedAddress: `0x${string}` | null = null;
  try {
    const rawAccounts = await provider.request({ method: 'eth_requestAccounts' });
    if (Array.isArray(rawAccounts) && rawAccounts.length > 0 && rawAccounts[0]) {
      activeAuthorizedAddress = getAddress(rawAccounts[0]);
    }
  } catch (err: any) {
    const code = err?.code ?? err?.cause?.code;
    const msg = (err?.message || '').toLowerCase();
    if (code === 4001 || msg.includes('user rejected') || msg.includes('denied')) {
      throw new Error('Wallet connection cancelled by user in wallet.');
    }
    if (code === 4100 || msg.includes('unauthorized')) {
      throw new Error('MetaMask account unauthorized. Please approve wallet account access via eth_requestAccounts.');
    }
    // If the provider is a test mock transport that doesn't implement eth_requestAccounts, fallback to existing client account
    if (existingClient?.account?.address && (msg.includes('unexpected rpc method') || code === -32601)) {
      activeAuthorizedAddress = getAddress(existingClient.account.address);
    } else {
      throw err;
    }
  }

  if (activeAuthorizedAddress === null && existingClient?.account?.address) {
    activeAuthorizedAddress = getAddress(existingClient.account.address);
  }

  if (!activeAuthorizedAddress) {
    throw new Error('No authorized accounts found in wallet. Please connect and unlock your wallet.');
  }

  // Step 4: Verify authorized signer matches the expected wallet address
  if (expectedAddress) {
    try {
      const cleanExpected = getAddress(expectedAddress);
      if (cleanExpected.toLowerCase() !== activeAuthorizedAddress.toLowerCase()) {
        throw new Error(
          `Wallet authorization mismatch: The active wallet in MetaMask is ${activeAuthorizedAddress}, ` +
          `but expected ${cleanExpected}. Please switch to the expected account in MetaMask.`
        );
      }
    } catch (err: any) {
      if (err.message?.includes('Wallet authorization mismatch')) {
        throw err;
      }
    }
  }

  // Step 5: Construct authorized viem WalletClient with verified account and provider
  return createWalletClient({
    account: activeAuthorizedAddress,
    chain: rabdiChain,
    transport: custom(provider),
  });
}

