import type { MatchCommitment } from '@age/shared';

export interface ProofAdapter {
  submit(matchId: string, archiveHash: string, archivePath?: string): Promise<MatchCommitment>;
}

export class DisabledProofAdapter implements ProofAdapter {
  async submit(matchId: string, archiveHash: string, archivePath?: string): Promise<MatchCommitment> {
    return { matchId, archiveHash, archivePath, status: 'disabled' };
  }
}

/** Local development adapter. It never claims chain confirmation. */
export class LocalProofAdapter implements ProofAdapter {
  async submit(matchId: string, archiveHash: string, archivePath?: string): Promise<MatchCommitment> {
    return { matchId, archiveHash, archivePath, status: 'local' };
  }
}

export function proofAdapterFromEnv(env = process.env): ProofAdapter {
  return env.BLOCKCHAIN_ENABLED === 'true' ? new LocalProofAdapter() : new DisabledProofAdapter();
}

export async function safelySubmitProof(adapter: ProofAdapter, matchId: string, hash: string, archivePath?: string): Promise<MatchCommitment> {
  try {
    return await adapter.submit(matchId, hash, archivePath);
  } catch (error) {
    return { matchId, archiveHash: hash, archivePath, status: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}
