// Read-only JSON API behind the WATT-style Proof Layer, Stewardship, Commons
// Ledger and Campaigns views. Public match records only: no player economy is
// exposed beyond what the archived chronicle already contains.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type http from 'node:http';
import { archiveDir, safeMatchId, type MatchChronicle } from './archive/chronicle';
import { readDeployment } from './proofs';

const RECENT_LIMIT = 50;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function rpc<T>(url: string, method: string): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
    signal: AbortSignal.timeout(1500),
  });
  const body = (await r.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(body.error.message);
  return body.result as T;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

interface CampaignSummary {
  matchId: string;
  finishedTick: number;
  winnerName: string;
  savedAt: string;
  players: number;
  standings: MatchChronicle['standings'];
  ledger: { head: string; height: number; verified: boolean; txs: number } | null;
  proof: Record<string, unknown> | null;
  dev: boolean;
}

async function campaigns(): Promise<CampaignSummary[]> {
  const dir = archiveDir();
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.endsWith('.proof.json'));
  } catch {
    return [];
  }
  const rows = await Promise.all(files.map(async (f) => {
    const full = path.join(dir, f);
    const c = await readJson<MatchChronicle>(full);
    if (!c || c.schema !== 'age-of-symbiosis/chronicle-v1') return null;
    const info = await stat(full);
    return {
      matchId: c.matchId,
      finishedTick: c.finishedTick,
      winnerName: c.winnerName,
      savedAt: info.mtime.toISOString(),
      players: c.players.length,
      standings: c.standings,
      ledger: c.ledger ? { head: c.ledger.head, height: c.ledger.height, verified: c.ledger.verified, txs: c.ledger.txs.length } : null,
      proof: await readJson<Record<string, unknown>>(path.join(dir, `${safeMatchId(c.matchId)}.proof.json`)),
      dev: c.dev === true,
    } satisfies CampaignSummary;
  }));
  return rows.filter((r): r is CampaignSummary => r !== null)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, RECENT_LIMIT);
}

async function chainStatus(): Promise<Record<string, unknown>> {
  const enabled = process.env.BLOCKCHAIN_ENABLED === 'true';
  const deployment = readDeployment();
  const contract = process.env.REGISTRY_ADDRESS ?? deployment?.address ?? null;
  const rpcUrl = process.env.CHAIN_RPC_URL ?? deployment?.rpcUrl ?? 'http://127.0.0.1:8545';
  const mode = !enabled ? 'disabled' : contract ? 'rpc' : 'local';
  let online = false;
  let block: number | null = null;
  let chainId: number | null = deployment?.chainId ?? null;
  if (mode === 'rpc') {
    try {
      block = Number.parseInt(await rpc<string>(rpcUrl, 'eth_blockNumber'), 16);
      chainId = Number.parseInt(await rpc<string>(rpcUrl, 'eth_chainId'), 16);
      online = true;
    } catch {
      online = false;
    }
  }
  const list = await campaigns();
  return {
    enabled,
    mode,
    online,
    block,
    chainId,
    contract,
    rpcUrl: mode === 'rpc' ? rpcUrl : null,
    archives: list.length,
    commitments: list.filter((c) => c.proof?.status === 'confirmed').length,
    latest: list[0] ?? null,
  };
}

/** Handles /api/* routes. Returns false when the URL is not an API route. */
export function handleApi(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = (req.url ?? '/').split('?')[0];
  if (!url.startsWith('/api/')) return false;
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'read-only' });
    return true;
  }
  void (async () => {
    try {
      if (url === '/api/chain') return sendJson(res, 200, await chainStatus());
      if (url === '/api/campaigns') return sendJson(res, 200, await campaigns());
      const m = /^\/api\/campaigns\/([A-Za-z0-9_-]{1,80})$/.exec(url);
      if (m) {
        const dir = archiveDir();
        const c = await readJson<MatchChronicle>(path.join(dir, `${m[1]}.json`));
        if (!c) return sendJson(res, 404, { error: 'not found' });
        const proof = await readJson(path.join(dir, `${m[1]}.proof.json`));
        return sendJson(res, 200, { ...c, proof });
      }
      sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'error' });
    }
  })();
  return true;
}
