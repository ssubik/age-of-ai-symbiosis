import type { ChainBlock, ChainTx, Standing } from '@age/shared';
import { fetchJson } from '../net';

export interface ProofRecord {
  matchId: string;
  archiveHash: string;
  status: 'disabled' | 'local' | 'simulated' | 'submitted' | 'confirmed' | 'failed';
  transactionHash?: string;
  ledgerHead?: string;
  ledgerHeight?: number;
  blockNumber?: number;
  chainId?: number;
  contract?: string;
  error?: string;
}

export interface CampaignSummary {
  matchId: string;
  finishedTick: number;
  winnerName: string;
  savedAt: string;
  players: number;
  standings?: Standing[];
  ledger: { head: string; height: number; verified: boolean; txs: number } | null;
  proof: ProofRecord | null;
}

export interface CampaignDetail {
  matchId: string;
  finishedTick: number;
  winnerName: string;
  players: { id: number; name: string }[];
  standings?: Standing[];
  ledger?: { head: string; height: number; verified: boolean; blocks: ChainBlock[]; txs: ChainTx[] };
  proof: ProofRecord | null;
}

export interface ChainStatus {
  enabled: boolean;
  mode: 'disabled' | 'local' | 'rpc';
  online: boolean;
  block: number | null;
  chainId: number | null;
  contract: string | null;
  rpcUrl: string | null;
  archives: number;
  commitments: number;
  latest: CampaignSummary | null;
}

let chain: ChainStatus | null = null;
let chainError = false;
const listeners = new Set<() => void>();

export function chainState(): { status: ChainStatus | null; unreachable: boolean } {
  return { status: chain, unreachable: chainError };
}

export function onChain(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function refreshChain(): Promise<void> {
  try {
    chain = await fetchJson<ChainStatus>('/api/chain');
    chainError = false;
  } catch {
    chainError = true;
  }
  for (const fn of listeners) fn();
}

export function campaigns(): Promise<CampaignSummary[]> {
  return fetchJson<CampaignSummary[]>('/api/campaigns');
}

export function campaign(id: string): Promise<CampaignDetail> {
  return fetchJson<CampaignDetail>(`/api/campaigns/${encodeURIComponent(id.replace(/[^a-zA-Z0-9_-]/g, '_'))}`);
}

/** Player colours follow join order, as in the match (PLAYER_COLORS). */
export const SEAT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];
