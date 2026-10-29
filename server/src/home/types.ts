import type { DefenseReport, DefenseSnapshot, MapData, RaidArmy, RaidDeployEvent, RaidOutcome, RaidReport, RaidSessionState, Resources, UnitType } from '@age/shared';
import type { Building, GamePlayer, ResNode, Sheep, Unit } from '../game/state';

export interface StoredHomePlayer extends Omit<GamePlayer, 'techs'> {
  techs: string[];
}

/** One raid against a pinned defense snapshot. Lives inside the Home save so a
 * single atomic write covers units, rewards and the session state together. */
export interface RaidSessionRecord {
  id: string;
  state: RaidSessionState;
  rulesVersion: number;
  createdAt: number;
  snapshot: DefenseSnapshot;
  offer: { reward: Resources; trophiesWin: number; trophiesLoss: number; expiresAt: number };
  /** Home unit records held by the raid until deployed (consumed) or returned. */
  reserved: Unit[];
  reservedArmy: RaidArmy;
  /** Attacker research levels pinned at reservation (part of the replay). */
  research: Partial<Record<keyof RaidArmy, number>>;
  /** Present when the snapshot belongs to another player (defender report + shield). */
  defenderProfileId?: string;
  deploys: RaidDeployEvent[];
  /** Wall-clock end of the reservation/raid window. */
  deadline?: number;
  maxTicks?: number;
  surrenderAt?: number;
  outcome?: RaidOutcome;
}

export interface HomeRaidData {
  trophies: number;
  scoutCounter: number;
  active: RaidSessionRecord | null;
  /** Newest first, bounded by RAID_MAX_REPORTS. */
  reports: RaidReport[];
  /** Settlement keys already applied (bounded); retries become no-ops. */
  settled: string[];
  /** Defender notices not yet delivered (outbox): retried until acknowledged. */
  outbox: DefenseDelivery[];
}

/** One defender-side consequence of a settled raid against a player snapshot. */
export interface DefenseDelivery {
  defenderProfileId: string;
  report: DefenseReport;
  shieldUntil: number;
}

export interface HomeProgression {
  research: Partial<Record<UnitType, number>>;
  researching?: { unit: UnitType; level: number; progress: number };
  shieldUntil: number;
  /** Newest first, bounded. */
  defenseReports: DefenseReport[];
  /** defenseSignature() of the last published snapshot. */
  publishedSignature: string;
  publishedSnapshotId?: string;
}

/** Durable, engine-neutral-enough capture of one Home simulation. Live timers,
 * connection ids, interpolation state and pathfinding caches are not stored. */
export interface HomeSaveV1 {
  version: 1;
  profileId: string;
  revision: number;
  savedAt: number;
  tick: number;
  nextId: number;
  map: MapData;
  player: StoredHomePlayer;
  buildings: Building[];
  units: Unit[];
  nodes: ResNode[];
  sheep: Sheep[];
  lastPower: { supply: number; draw: number };
  productionCollectedAt: number;
  storageCaps: Resources;
}

/** V2 adds the raid ledger (Phase 3). */
export interface HomeSaveV2 extends Omit<HomeSaveV1, 'version'> {
  version: 2;
  raid: Omit<HomeRaidData, 'outbox'>;
}

/** V3 adds progression (levels live on buildings), research, shields and the defense outbox (Phase 4). */
export interface HomeSaveV3 extends Omit<HomeSaveV2, 'version' | 'raid'> {
  version: 3;
  raid: HomeRaidData;
  progression: HomeProgression;
}

export type HomeSave = HomeSaveV3;

export interface HomeLoadResult {
  save: HomeSave | null;
  recoveredFromBackup: boolean;
}
