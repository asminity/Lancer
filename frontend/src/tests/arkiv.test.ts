import { describe, it, expect, vi } from 'vitest';
import {
  RunSchema,
  SwarmRoundSchema,
  DeliverableSchema,
  AuditLogSchema,
  UserSchema,
  ProjectSchema,
  ContextRefSchema,
} from '../services/arkiv/schemas';
import { ensureRabdiWalletClient, rabdiChain, wagmiConfig, zeroGChain } from '../config/chain';
import { arkivPublicClient } from '../services/arkiv/client';
import { formatArkivError, assertSufficientTglm, RABDI_EXPLORER_URL } from '../services/arkiv/balance';
import { MAX_ENTITY_BYTES, addr, dec, u64 } from '@arkiv-network/sdk';
import { createWalletClient, custom } from 'viem';
import { and, eq } from '@arkiv-network/sdk/query';
import { getArkivWalletClient } from '../services/arkiv/client';

describe('Arkiv Schemas & Constraints', () => {
  it('RunSchema has correct column types and indexing', () => {
    expect(RunSchema.name).toBe('autonex.run');
    expect(RunSchema.columns.run_id.type).toBe('str');
    expect(RunSchema.columns.run_id.isIndexed).toBe(true);
    expect(RunSchema.columns.owner.type).toBe('addr');
    expect(RunSchema.columns.owner.isIndexed).toBe(true);
    expect(RunSchema.columns.created_at.type).toBe('u64');
    expect(RunSchema.columns.created_at.isIndexed).toBe(true);
    expect(RunSchema.columns.dag_json.type).toBe('bytes');
    expect(RunSchema.columns.dag_json.isIndexed).toBe(false);
  });

  it('SwarmRoundSchema validates consensus proof columns', () => {
    expect(SwarmRoundSchema.name).toBe('autonex.swarm_round');
    expect(SwarmRoundSchema.columns.round.type).toBe('u64');
    expect(SwarmRoundSchema.columns.round.isIndexed).toBe(true);
    expect(SwarmRoundSchema.columns.agreement.type).toBe('dec');
    expect(SwarmRoundSchema.columns.agreement.isIndexed).toBe(true);
    expect(SwarmRoundSchema.columns.consensus_json.type).toBe('bytes');
  });

  it('DeliverableSchema protects code artifacts and test results', () => {
    expect(DeliverableSchema.name).toBe('autonex.deliverable');
    expect(DeliverableSchema.columns.project_slug.type).toBe('str');
    expect(DeliverableSchema.columns.l2_tests_pass.type).toBe('bool');
    expect(DeliverableSchema.columns.l2_tests_pass.isIndexed).toBe(true);
    expect(DeliverableSchema.columns.l3_score.type).toBe('dec');
    expect(DeliverableSchema.columns.bundle_bytes.type).toBe('bytes');
  });

  it('AuditLogSchema captures human security approvals', () => {
    expect(AuditLogSchema.name).toBe('autonex.audit_log');
    expect(AuditLogSchema.columns.action.type).toBe('str');
    expect(AuditLogSchema.columns.action.isIndexed).toBe(true);
    expect(AuditLogSchema.columns.decision.type).toBe('str');
    expect(AuditLogSchema.columns.operator.type).toBe('addr');
  });

  it('UserSchema indexes user_id and wallet address', () => {
    expect(UserSchema.name).toBe('autonex.user');
    expect(UserSchema.columns.user_id.type).toBe('str');
    expect(UserSchema.columns.user_id.isIndexed).toBe(true);
    expect(UserSchema.columns.wallet.type).toBe('addr');
    expect(UserSchema.columns.wallet.isIndexed).toBe(true);
    expect(UserSchema.columns.created_at.type).toBe('u64');
  });

  it('ProjectSchema indexes project_id, user_id, and owner', () => {
    expect(ProjectSchema.name).toBe('autonex.project');
    expect(ProjectSchema.columns.project_id.type).toBe('str');
    expect(ProjectSchema.columns.project_id.isIndexed).toBe(true);
    expect(ProjectSchema.columns.user_id.type).toBe('str');
    expect(ProjectSchema.columns.user_id.isIndexed).toBe(true);
    expect(ProjectSchema.columns.owner.type).toBe('addr');
    expect(ProjectSchema.columns.owner.isIndexed).toBe(true);
  });

  it('ContextRefSchema indexes report_id, project_id, swarm_ref, and content_hash', () => {
    expect(ContextRefSchema.name).toBe('autonex.context_ref');
    expect(ContextRefSchema.columns.report_id.type).toBe('str');
    expect(ContextRefSchema.columns.report_id.isIndexed).toBe(true);
    expect(ContextRefSchema.columns.project_id.type).toBe('str');
    expect(ContextRefSchema.columns.project_id.isIndexed).toBe(true);
    expect(ContextRefSchema.columns.swarm_ref.type).toBe('str');
    expect(ContextRefSchema.columns.swarm_ref.isIndexed).toBe(true);
    expect(ContextRefSchema.columns.content_hash.type).toBe('str');
    expect(ContextRefSchema.columns.content_hash.isIndexed).toBe(true);
  });
});

describe('Arkiv Rabdi Testnet Configuration', () => {
  it('Configures Rabdi DB-Chain with Chain ID 7794095 and tGLM', () => {
    expect(rabdiChain.id).toBe(7794095);
    expect(rabdiChain.name).toBe('Rabdi DB-Chain');
    expect(rabdiChain.nativeCurrency.symbol).toBe('tGLM');
    expect(rabdiChain.rpcUrls.default.http[0]).toBe('https://rpc.rabdi.db-chain.testnet.arkiv.network');
    expect(RABDI_EXPLORER_URL).toBe('https://rabdi.explorer.arkiv.network');
  });

  it('Wagmi config registers Rabdi chain and injected connector', () => {
    expect(wagmiConfig.chains.length).toBeGreaterThanOrEqual(1);
    expect(wagmiConfig.chains[0].id).toBe(7794095);
    expect(wagmiConfig.connectors.length).toBeGreaterThanOrEqual(1);
  });

  it('PublicClient is initialized targeting Rabdi DB-Chain', () => {
    expect(arkivPublicClient.chain?.id).toBe(7794095);
    expect(typeof arkivPublicClient.query).toBe('function');
    expect(typeof arkivPublicClient.getEntity).toBe('function');
  });

  it('Arkiv writes use the selected wallet transport, not another injected wallet', async () => {
    const selectedRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'arkiv_query') return { data: [], blockNumber: '0x0' };
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const otherInjectedRequest = vi.fn(async () => {
      throw new Error('Unauthorized injected wallet');
    });
    vi.stubGlobal('window', { ethereum: { request: otherInjectedRequest } });

    try {
      const connectedClient = createWalletClient({
        account: '0x1234567890123456789012345678901234567890',
        chain: rabdiChain,
        transport: custom({ request: selectedRequest }),
      });
      const arkivWallet = getArkivWalletClient(connectedClient);

      await expect(
        arkivWallet.request({ method: 'arkiv_query', params: ['{}'] })
      ).resolves.toEqual({ data: [], blockNumber: '0x0' });
      expect(selectedRequest).toHaveBeenCalledWith({ method: 'arkiv_query', params: ['{}'] }, undefined);
      expect(otherInjectedRequest).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('switches the selected wallet to Rabdi without requesting accounts from another provider', async () => {
    const selectedRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x4165';
      if (method === 'wallet_switchEthereumChain') return null;
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const otherInjectedRequest = vi.fn(async () => {
      throw new Error('Unauthorized injected wallet');
    });
    vi.stubGlobal('window', { ethereum: { request: otherInjectedRequest } });

    try {
      const connectedClient = createWalletClient({
        account: '0x1234567890123456789012345678901234567890',
        chain: zeroGChain,
        transport: custom({ request: selectedRequest }),
      });
      const rabdiWallet = await ensureRabdiWalletClient(connectedClient);

      expect(rabdiWallet.chain?.id).toBe(rabdiChain.id);
      expect(selectedRequest).toHaveBeenNthCalledWith(
        2,
        { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x76edaf' }] }
      );
      expect(otherInjectedRequest).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Balance & Error Handling', () => {
  it('assertSufficientTglm rejects zero balance accounts', async () => {
    // 0x0 address will have 0 balance on testnet
    await expect(
      assertSufficientTglm('0x0000000000000000000000000000000000000000')
    ).rejects.toThrow(/Insufficient tGLM balance/);
  });

  it('formatArkivError maps user rejection to friendly text', () => {
    const err = new Error('User rejected the transaction');
    expect(formatArkivError(err)).toBe('Transaction cancelled by user in wallet.');
  });

  it('formatArkivError maps network mismatch error', () => {
    const err = new Error('ChainMismatchError: Expected chain 7794095');
    expect(formatArkivError(err)).toContain('Rabdi DB-Chain Testnet');
  });

  it('formatArkivError safely unwraps plain objects without returning [object Object]', () => {
    expect(formatArkivError({ code: 4001, message: 'User denied transaction signature.' })).toBe(
      'Transaction cancelled by user in wallet.'
    );
    expect(formatArkivError({ code: 4902, message: 'Unrecognized chain ID 0x76edaf' })).toContain(
      'Rabdi DB-Chain Testnet'
    );
    expect(formatArkivError({ shortMessage: 'User rejected the request' })).toBe(
      'Transaction cancelled by user in wallet.'
    );
    expect(formatArkivError({})).not.toBe('[object Object]');
    expect(formatArkivError({ foo: 'bar' })).not.toBe('[object Object]');
    expect(formatArkivError('[object Object]')).not.toBe('[object Object]');
  });

  it('validates Rabdi chain hex ID calculation matches 7794095 (0x76edaf)', () => {
    expect(`0x${rabdiChain.id.toString(16)}`).toBe('0x76edaf');
  });

  it('formatArkivError formats MetaMask RPC Error 4100 (Unauthorized) with clear guidance', () => {
    const error4100 = {
      code: 4100,
      message: 'The requested account and/or method has not been authorized by the user.',
    };
    expect(formatArkivError(error4100)).toContain('MetaMask account unauthorized');
    expect(formatArkivError(error4100)).toContain('eth_requestAccounts');
  });

  it('formatArkivError transforms generic "Execution error without revert data" into meaningful diagnosis', () => {
    const revertErr = new Error('ContractFunctionExecutionError: Execution error without revert data');
    const formatted = formatArkivError(revertErr);
    expect(formatted).not.toBe('Execution error without revert data');
    expect(formatted).toContain('Arkiv Rabdi DB-Chain transaction reverted');
    expect(formatted).toContain('7794095');
    expect(formatted).toContain('tGLM');
  });
});

describe('MetaMask Authorization & Checkpoint Storage Flow', () => {
  it('ensureRabdiWalletClient requests accounts via eth_requestAccounts before accessing signer', async () => {
    const mockRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x76edaf';
      if (method === 'eth_requestAccounts') return ['0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E'];
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    vi.stubGlobal('window', { ethereum: { request: mockRequest } });

    try {
      const client = await ensureRabdiWalletClient(null);
      expect(mockRequest).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
      expect(client.account?.address.toLowerCase()).toBe('0x999999cf1046e68e36e1aa2e0e07105eddd1f08e');
      expect(client.chain?.id).toBe(7794095);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ensureRabdiWalletClient throws error on expected address mismatch', async () => {
    const mockRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x76edaf';
      if (method === 'eth_requestAccounts') return ['0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E'];
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    vi.stubGlobal('window', { ethereum: { request: mockRequest } });

    try {
      await expect(
        ensureRabdiWalletClient(null, '0x1111111111111111111111111111111111111111')
      ).rejects.toThrow(/Wallet authorization mismatch/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ensureRabdiWalletClient handles user rejection of eth_requestAccounts gracefully', async () => {
    const mockRequest = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x76edaf';
      if (method === 'eth_requestAccounts') {
        const err: any = new Error('User rejected the request.');
        err.code = 4001;
        throw err;
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    vi.stubGlobal('window', { ethereum: { request: mockRequest } });

    try {
      await expect(ensureRabdiWalletClient(null)).rejects.toThrow(
        /Wallet connection cancelled by user in wallet/
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Payload Encodings & Constraints', () => {
  it('Encodes multi-file bundle within Arkiv 128 KiB limit', () => {
    const files: Record<string, string> = {
      'src/main.py': 'def hello():\n    return "hello world"',
      'src/test.py': 'def test_hello():\n    assert hello() == "hello world"',
      'README.md': '# My Autonomous Project\nGenerated by AUTONEX.',
    };
    const encoder = new TextEncoder();
    const encoded = encoder.encode(JSON.stringify(files));
    expect(encoded.length).toBeLessThan(MAX_ENTITY_BYTES);

    const decoder = new TextDecoder();
    const parsed = JSON.parse(decoder.decode(encoded));
    expect(parsed['src/main.py']).toBe(files['src/main.py']);
  });

  it('Builds valid boolean query expressions', () => {
    const testAddr = '0x71C6793F1E602757A0A23b27732890539129E924';
    const queryExpr = and(
      eq('arkiv.schema', 'autonex.run'),
      eq('owner', addr(testAddr)),
      eq('status', 'SUCCESS')
    );
    expect(queryExpr).toBeDefined();
    expect((queryExpr as any).kind).toBe('and');
  });

  it('Verifies ZIP bundle generation and decompression from on-chain payload', async () => {
    const JSZip = (await import('jszip')).default;
    const testFiles: Record<string, string> = {
      'src/index.ts': 'export const answer = 42;',
      'package.json': '{"name": "test-pkg"}',
    };
    const zip = new JSZip();
    for (const [path, content] of Object.entries(testFiles)) {
      zip.file(path, content);
    }
    const blob = await zip.generateAsync({ type: 'uint8array' });
    expect(blob.length).toBeGreaterThan(0);

    const loadedZip = await JSZip.loadAsync(blob);
    const indexContent = await loadedZip.file('src/index.ts')?.async('string');
    expect(indexContent).toBe('export const answer = 42;');
  });
});

describe('Failure Mode & Security Validations', () => {
  it('createArkivRun throws descriptive error if walletClient has no active account', async () => {
    const { createArkivRun } = await import('../services/arkiv/operations');
    const mockWalletClient: any = { account: undefined };
    await expect(
      createArkivRun(mockWalletClient, {
        runId: 'test-run-1',
        taskClass: 'test',
        mode: 'office',
        goalSummary: 'test goal',
      })
    ).rejects.toThrow('Wallet not connected.');
  });

  it('extendArkivEntity throws descriptive error if walletClient is disconnected', async () => {
    const { extendArkivEntity } = await import('../services/arkiv/operations');
    const mockWalletClient: any = { account: undefined };
    await expect(
      extendArkivEntity(mockWalletClient, '0x1234567890123456789012345678901234567890123456789012345678901234')
    ).rejects.toThrow('Wallet not connected.');
  });

  it('deleteArkivEntity throws descriptive error if walletClient is disconnected', async () => {
    const { deleteArkivEntity } = await import('../services/arkiv/operations');
    const mockWalletClient: any = { account: undefined };
    await expect(
      deleteArkivEntity(mockWalletClient, '0x1234567890123456789012345678901234567890123456789012345678901234')
    ).rejects.toThrow('Wallet not connected.');
  });

  it('queryPublicRuns returns safe empty array on RPC failure rather than unhandled crash', async () => {
    const { queryPublicRuns } = await import('../services/arkiv/operations');
    const result = await queryPublicRuns(5);
    expect(Array.isArray(result)).toBe(true);
  });

  it('EIP-55 address checksum validation enforces valid formatting', async () => {
    const { getAddress } = await import('viem');
    const validChecksum = getAddress('0x71c6793f1e602757a0a23b27732890539129e924');
    expect(validChecksum).toBe('0x71C6793F1E602757A0A23b27732890539129E924');
  });

  it('Cost optimization: heavy payloads are strictly non-indexed bytes', () => {
    expect(RunSchema.columns.dag_json.isIndexed).toBe(false);
    expect(DeliverableSchema.columns.bundle_bytes.isIndexed).toBe(false);
    expect(DeliverableSchema.columns.report_md.isIndexed).toBe(false);
    expect(SwarmRoundSchema.columns.consensus_json.isIndexed).toBe(false);
    expect(AuditLogSchema.columns.diff_preview.isIndexed).toBe(false);
  });
});
