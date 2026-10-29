// Published player defenses for matchmaking. One immutable snapshot per profile
// (the latest); raids pin their own copy, so republishing never alters a scouted
// or in-progress raid. Local JSON with atomic replace; a database would slot in
// behind the same interface.
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DefenseSnapshot } from '@age/shared';

export interface PublishedDefense {
  profileId: string;
  snapshot: DefenseSnapshot;
  cityLevel: number;
  trophies: number;
  shieldUntil: number;
  publishedAt: number;
}

export interface SnapshotRegistry {
  publish(entry: PublishedDefense): Promise<void>;
  /** Trophies/shield change without a new snapshot. */
  updateMeta(profileId: string, meta: { trophies?: number; shieldUntil?: number }): Promise<void>;
  entries(): PublishedDefense[];
}

export class MemorySnapshotRegistry implements SnapshotRegistry {
  protected readonly byProfile = new Map<string, PublishedDefense>();

  async publish(entry: PublishedDefense): Promise<void> {
    this.byProfile.set(entry.profileId, structuredClone(entry));
    await this.flush();
  }

  async updateMeta(profileId: string, meta: { trophies?: number; shieldUntil?: number }): Promise<void> {
    const entry = this.byProfile.get(profileId);
    if (!entry) return;
    const next = {
      ...entry,
      ...(meta.trophies !== undefined ? { trophies: meta.trophies } : {}),
      ...(meta.shieldUntil !== undefined ? { shieldUntil: meta.shieldUntil } : {}),
    };
    if (next.trophies === entry.trophies && next.shieldUntil === entry.shieldUntil) return;
    this.byProfile.set(profileId, next);
    await this.flush();
  }

  entries(): PublishedDefense[] {
    return [...this.byProfile.values()].map((e) => structuredClone(e));
  }

  protected async flush(): Promise<void> {}
}

export class JsonSnapshotRegistry extends MemorySnapshotRegistry {
  private readonly file: string;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly directory: string) {
    super();
    this.file = path.join(directory, 'registry.json');
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { entries?: PublishedDefense[] };
      for (const e of raw.entries ?? []) if (e?.profileId && e.snapshot) this.byProfile.set(e.profileId, e);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[raid] snapshot registry unreadable; starting empty', error);
    }
  }

  protected override async flush(): Promise<void> {
    const body = `${JSON.stringify({ version: 1, entries: [...this.byProfile.values()] })}\n`;
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await mkdir(this.directory, { recursive: true });
      const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, body, { encoding: 'utf8', mode: 0o600 });
      await rename(temp, this.file);
    });
    await this.writing;
  }
}
