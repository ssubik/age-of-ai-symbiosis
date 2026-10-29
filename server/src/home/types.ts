import type { MapData, Resources } from '@age/shared';
import type { Building, GamePlayer, ResNode, Sheep, Unit } from '../game/state';

export interface StoredHomePlayer extends Omit<GamePlayer, 'techs'> {
  techs: string[];
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

export interface HomeLoadResult {
  save: HomeSaveV1 | null;
  recoveredFromBackup: boolean;
}

