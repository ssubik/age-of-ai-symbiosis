export type ProofStatus = 'disabled' | 'local' | 'simulated' | 'submitted' | 'confirmed' | 'failed';

export interface MatchCommitment {
  matchId: string;
  archiveHash: string;
  archivePath?: string;
  status: ProofStatus;
  transactionHash?: string;
  ledgerHead?: string;
  ledgerHeight?: number;
  blockNumber?: number;
  chainId?: number;
  contract?: string;
  error?: string;
}
