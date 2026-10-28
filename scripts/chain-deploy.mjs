// Deploys MatchCommitmentRegistry to a local dev chain (Anvil) using its
// unlocked dev account, then writes contracts/deployment.json for the server.
// Usage: npm run chain:node  (terminal 1)   then   npm run chain:deploy
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rpcUrl = process.env.CHAIN_RPC_URL ?? 'http://127.0.0.1:8545';
const artifact = JSON.parse(readFileSync(path.join(root, 'contracts/out/MatchCommitmentRegistry.sol/MatchCommitmentRegistry.json'), 'utf8'));

async function rpc(method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const [from] = await rpc('eth_accounts', []);
const chainId = Number.parseInt(await rpc('eth_chainId', []), 16);
if (chainId !== 31337) throw new Error(`refusing to deploy with an unlocked dev account to chain ${chainId}`);
const hash = await rpc('eth_sendTransaction', [{ from, data: artifact.bytecode.object }]);
let receipt = null;
for (let i = 0; i < 40 && !receipt; i++) {
  receipt = await rpc('eth_getTransactionReceipt', [hash]);
  if (!receipt) await new Promise((r) => setTimeout(r, 250));
}
if (!receipt?.contractAddress) throw new Error('deployment not mined');
const out = { address: receipt.contractAddress, rpcUrl, chainId };
writeFileSync(path.join(root, 'contracts/deployment.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`MatchCommitmentRegistry deployed at ${out.address} (chain ${chainId})`);
