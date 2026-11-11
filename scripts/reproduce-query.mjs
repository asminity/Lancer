#!/usr/bin/env node

/**
 * AUTONEX - Reproducible Arkiv DB-Chain Query Script
 * ETHGlobal Arkiv Track Verification
 *
 * Network: Rabdi DB-Chain Testnet
 * Chain ID: 7794095
 * RPC: https://rpc.rabdi.db-chain.testnet.arkiv.network
 *
 * Usage:
 *   node scripts/reproduce-query.mjs
 */

const RPC_URL = process.env.VITE_ARKIV_RPC_URL || 'https://rpc.rabdi.db-chain.testnet.arkiv.network';

async function rpcCall(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC Error (${data.error.code}): ${data.error.message}`);
  return data.result;
}

async function main() {
  console.log('================================================================');
  console.log('       AUTONEX - Arkiv Rabdi DB-Chain Query Reproducer           ');
  console.log('================================================================');
  console.log(`[1] Connecting to Rabdi RPC: ${RPC_URL}`);

  // 1. Verify Chain ID
  const chainIdHex = await rpcCall('eth_chainId');
  const chainId = parseInt(chainIdHex, 16);
  console.log(`[2] Chain ID Verified: ${chainId} (Hex: ${chainIdHex})`);
  if (chainId !== 7794095) {
    throw new Error(`Unexpected Chain ID: ${chainId}, expected 7794095 (Rabdi Testnet)`);
  }

  // 2. Fetch Latest Block
  const blockNumberHex = await rpcCall('eth_blockNumber');
  const blockNumber = parseInt(blockNumberHex, 16);
  console.log(`[3] Current Rabdi Block Height: ${blockNumber.toLocaleString()}`);

  // 3. Query Public Entities via Arkiv JSON-RPC
  console.log(`[4] Executing Arkiv Query: params: ["arkiv.schema = str('autonex.run')", { limit: 5 }]`);
  const queryResult = await rpcCall('arkiv_query', [
    "arkiv.schema = str('autonex.run')",
    { limit: 5 },
  ]);

  const entities = queryResult?.data || queryResult?.entities || [];
  console.log(`[5] Query Successful! Returned ${entities.length} entities (Block: ${queryResult.blockNumber || 'latest'})`);

  if (entities.length > 0) {
    console.log('\n--- Sample Live Entity from Rabdi DB-Chain ---');
    const e = entities[0];
    console.log(`- Entity Key:     ${e.$key || e.key}`);
    console.log(`- Owner Address:  ${e.owner || e.$owner}`);
    console.log(`- Run ID:         ${e.run_id}`);
    console.log(`- Task Class:     ${e.task_class}`);
    console.log(`- Mode:           ${e.mode}`);
    console.log(`- Status:         ${e.status}`);
    console.log(`- Goal Summary:   ${e.goal_summary}`);
    console.log(`- Explorer URL:   https://rabdi.explorer.arkiv.network/entity/${e.$key || e.key}`);
  } else {
    console.log('\n[Status] Query returned cleanly with 0 entities on this node.');
    console.log('To write a new on-chain record:');
    console.log('  1. Run `npm run dev` and open http://localhost:5173');
    console.log('  2. Connect your wallet (MetaMask on Rabdi Testnet)');
    console.log('  3. Run a simulation task, open Final Report, and click "Publish to Arkiv DB-Chain"');
    console.log('  4. Re-run `node scripts/reproduce-query.mjs` to observe your entity on-chain!');
  }

  console.log('\n================================================================');
  console.log('     Arkiv Read Verification Completed Successfully (Exit 0)   ');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('\n[Error] Verification failed:', err.message);
  process.exit(1);
});
