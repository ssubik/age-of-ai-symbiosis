import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { MatchCommitment } from '@age/shared';

export interface LedgerAnchor {
  head: string;
  height: number;
}

export interface ProofAdapter {
  submit(matchId: string, archiveHash: string, archivePath?: string, ledger?: LedgerAnchor): Promise<MatchCommitment>;
}

export class DisabledProofAdapter implements ProofAdapter {
  async submit(matchId: string, archiveHash: string, archivePath?: string, ledger?: LedgerAnchor): Promise<MatchCommitment> {
    return { matchId, archiveHash, archivePath, status: 'disabled', ledgerHead: ledger?.head, ledgerHeight: ledger?.height };
  }
}

/** Local development adapter. It never claims chain confirmation. */
export class LocalProofAdapter implements ProofAdapter {
  async submit(matchId: string, archiveHash: string, archivePath?: string, ledger?: LedgerAnchor): Promise<MatchCommitment> {
    return { matchId, archiveHash, archivePath, status: 'local', ledgerHead: ledger?.head, ledgerHeight: ledger?.height };
  }
}

// cast sig "commitWithLedger(bytes32,bytes32,bytes32,uint64)"
const COMMIT_WITH_LEDGER = '0x97ae7cb4';

function word(hex: string): string {
  const clean = hex.replace(/^0x/, '').replace(/^sha256:/, '');
  if (!/^[0-9a-f]{1,64}$/i.test(clean)) throw new Error(`not a 32-byte hex value: ${hex}`);
  return clean.padStart(64, '0');
}

export function matchIdBytes32(matchId: string): string {
  return `0x${createHash('sha256').update(matchId).digest('hex')}`;
}

export function encodeCommitWithLedger(matchId: string, archiveHash: string, ledger: LedgerAnchor): string {
  return COMMIT_WITH_LEDGER
    + word(matchIdBytes32(matchId))
    + word(archiveHash.replace(/^sha256:/, ''))
    + word(ledger.head)
    + ledger.height.toString(16).padStart(64, '0');
}

/** Commits through JSON-RPC to an EVM dev chain (Anvil). Uses the node's
 *  unlocked dev account, so it is for local development only. */
export class RpcProofAdapter implements ProofAdapter {
  constructor(
    private readonly rpcUrl: string,
    private readonly contract: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly pollMs = 250,
  ) {}

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await this.fetchFn(this.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result as T;
  }

  async submit(matchId: string, archiveHash: string, archivePath?: string, ledger?: LedgerAnchor): Promise<MatchCommitment> {
    if (!ledger) throw new Error('ledger anchor required for on-chain commitment');
    const base = { matchId, archiveHash, archivePath, ledgerHead: ledger.head, ledgerHeight: ledger.height, contract: this.contract };
    const [from] = await this.rpc<string[]>('eth_accounts', []);
    if (!from) throw new Error('RPC node exposes no unlocked account');
    const chainId = Number.parseInt(await this.rpc<string>('eth_chainId', []), 16);
    const data = encodeCommitWithLedger(matchId, archiveHash, ledger);
    const transactionHash = await this.rpc<string>('eth_sendTransaction', [{ from, to: this.contract, data }]);
    for (let i = 0; i < 40; i++) {
      const receipt = await this.rpc<{ status: string; blockNumber: string } | null>('eth_getTransactionReceipt', [transactionHash]);
      if (receipt) {
        if (receipt.status !== '0x1') return { ...base, status: 'failed', transactionHash, chainId, error: 'transaction reverted' };
        return { ...base, status: 'confirmed', transactionHash, chainId, blockNumber: Number.parseInt(receipt.blockNumber, 16) };
      }
      await new Promise((r) => setTimeout(r, this.pollMs));
    }
    return { ...base, status: 'submitted', transactionHash, chainId };
  }
}

export interface Deployment {
  address: string;
  rpcUrl: string;
  chainId: number;
}

export function readDeployment(file = path.resolve(process.env.CHAIN_DEPLOYMENT ?? 'contracts/deployment.json')): Deployment | null {
  const candidates = [file, path.resolve('..', 'contracts/deployment.json')];
  for (const f of candidates) {
    if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as Deployment;
  }
  return null;
}

export function proofAdapterFromEnv(env = process.env): ProofAdapter {
  if (env.BLOCKCHAIN_ENABLED !== 'true') return new DisabledProofAdapter();
  const deployment = readDeployment();
  const address = env.REGISTRY_ADDRESS ?? deployment?.address;
  if (!address) return new LocalProofAdapter();
  return new RpcProofAdapter(env.CHAIN_RPC_URL ?? deployment?.rpcUrl ?? 'http://127.0.0.1:8545', address);
}

export async function safelySubmitProof(adapter: ProofAdapter, matchId: string, hash: string, archivePath?: string, ledger?: LedgerAnchor): Promise<MatchCommitment> {
  try {
    return await adapter.submit(matchId, hash, archivePath, ledger);
  } catch (error) {
    return { matchId, archiveHash: hash, archivePath, status: 'failed', ledgerHead: ledger?.head, ledgerHeight: ledger?.height, error: error instanceof Error ? error.message : String(error) };
  }
}
