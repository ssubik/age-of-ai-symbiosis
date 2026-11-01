// Tipos de dados compartilhados entre servidor e cliente.
// Convenções:
//  - Posições de unidades são floats em unidades de tile (centro da unidade).
//  - Prédios são ancorados no tile superior-esquerdo e ocupam size x size tiles.
//  - Ids de unidades, prédios e nós de recurso vêm de um contador único
//    (um id nunca se repete entre categorias — comandos usam targetId genérico).

import type { CommanderView } from './commander';

export type ResourceType = 'energy' | 'alloys' | 'compute';
export type CityPath = 'command' | 'space';
export type UnitType =
  | 'villager' | 'designer' | 'swordsman' | 'archer' | 'knight'
  // Navais (andam SÓ na água; treinadas no Porto):
  | 'fishing_boat' // pesca bancos de peixe e entrega no Porto
  | 'war_galley'   // barco de guerra (ataque à distância)
  | 'transport'    // leva unidades terrestres pelo rio (embarcar/desembarcar)
  // Symbiosis-only automated builders (Robotics Workshop):
  | 'robot'        // ground builder: fast construction, cannot gather
  | 'drone'        // flying builder: crosses water and terrain
  // Symbiosis aerial/strategic attack wing:
  | 'attack_drone' | 'fighter' | 'rocket_launcher'
  | 'siege_mech' | 'stealth_bomber' | 'plasma_tank' | 'iron_guardian'
  // Exosuit Lab L2 elite (Home Phase 4):
  | 'aegis_valkyrie';
export type BuildingType =
  | 'town_center'
  | 'house'
  | 'barracks'
  | 'farm'
  | 'archery_range'
  | 'stable'
  | 'blacksmith'
  | 'market'
  | 'wall'
  | 'watch_tower'
  | 'mill'          // depósito de comida
  | 'lumber_camp'   // depósito de madeira
  | 'mining_camp'   // depósito de ouro e pedra
  | 'dock'          // Porto: NA água (costa); deposita peixe e treina barcos
  // Symbiosis-only energy grid and automation:
  | 'solar_array'
  | 'wind_turbine'
  | 'robotics_workshop'
  | 'design_studio'
  | 'data_center'
  | 'elon_vault'
  | 'army_camp'
  | 'drone_factory'
  | 'aerospace_hangar'
  | 'missile_foundry'
  | 'mech_forge'
  | 'exosuit_lab'
  // Home raid defenses (Phase 3): ground-only turret and air-only launcher.
  | 'point_turret'
  | 'anti_air'
  // Phase 4: tall scanning mast; extends nearby defense range in raids.
  | 'sensor_tower';
export type NodeType = 'tree' | 'berry_bush' | 'gold_mine' | 'stone_mine' | 'fish';

export type Resources = Record<ResourceType, number>;

export type UnitState =
  | 'idle'
  | 'moving'
  | 'movingToGather'
  | 'gathering'
  | 'returning'      // levando recursos ao depósito
  | 'movingToBuild'
  | 'building'
  | 'movingToGarrison' // indo entrar numa torre/Centro (guarnição)
  | 'movingToAttack'
  | 'attacking';

export interface UnitSnap {
  id: number;
  owner: number; // playerId
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  state: UnitState;
  carryType?: ResourceType;
  carryAmount?: number;
  targetId?: number;
  /** Barco de transporte: quantas unidades estão embarcadas. */
  garrison?: number;
}

// progress 0..1 — apenas o primeiro item da fila avança
export interface TrainQueueItem {
  unit: UnitType;
  progress: number;
  /** Home: resources actually deducted for this job, so refunds are exact. */
  paid?: Partial<Resources>;
}

/** Home: why a finished unit is waiting inside its factory instead of docking. */
export type TrainBlockReason = 'no_camp' | 'camp_full';

export interface BuildingSnap {
  id: number;
  owner: number;
  type: BuildingType;
  tileX: number; // canto superior-esquerdo
  tileY: number;
  hp: number;
  progress: number; // 0..1 de construção; 1 = concluído
  queue: TrainQueueItem[];
  rallyX?: number;
  rallyY?: number;
  foodLeft?: number; // apenas fazendas concluídas
  /** Pesquisa de tecnologia em andamento neste prédio (id + progresso 0..1). */
  research?: { id: string; progress: number };
  /** Alvo atual (torres de vigia atirando — o cliente desenha a flecha). */
  targetId?: number;
  /** Quantas unidades estão GUARNECIDAS dentro (torre/Centro) — o cliente mostra
   *  a contagem e desenha flechas extras. */
  garrison?: number;
  /** Symbiosis: ledger transaction hash attesting this facility's completion. */
  proof?: string;
  /** Home: Civic Hub level being physically constructed. */
  upgradeTargetLevel?: number;
  /** Home: the finished head of the queue cannot dock; the factory is blocked. */
  trainBlocked?: TrainBlockReason;
  /** Home: building level (absent = 1). */
  level?: number;
  /** Home: level being physically built while the building keeps working. */
  upgradeProgress?: number;
}

export interface NodeSnap {
  id: number;
  type: NodeType;
  tileX: number;
  tileY: number;
  amount: number; // recurso restante
}

/** Ovelha (estilo AoE): comida do início de jogo, branca quando selvagem
 *  (owner = -1), tingida da cor do dono quando um jogador a converte
 *  chegando perto. Posição em coordenadas de tile (centro), como as unidades. */
export interface SheepSnap {
  id: number;
  owner: number; // -1 = selvagem (branca)
  x: number;
  y: number;
  food: number; // comida restante
}

export interface PlayerSnap {
  id: number;
  /** AUSENTE pra quem está só ASSISTINDO: o espectador vê a ação, não a
   *  economia. Não é enfeite de tela — o dado não sai do servidor, então nem
   *  um cliente modificado consegue ler o ouro de quem está jogando. */
  resources?: Resources;
  pop: number;
  popCap: number;
  defeated: boolean;
  /** Era atual (1..MAX_AGE). */
  age: number;
  /** Progresso 0..1 da pesquisa da próxima era (ausente se não pesquisando,
   *  e sempre ausente pro espectador). */
  ageProgress?: number;
  /** Level-5 specialization; absent through Symbiotic City (level 4). */
  cityPath?: CityPath;
  /** Path being established while the level-5 research timer runs. */
  pathResearch?: CityPath;
  /** Ids das tecnologias já pesquisadas. Ausente pro espectador. */
  techs?: string[];
  /** Optional non-transferable contribution standing (Symbiosis presentation). */
  elon?: number;
  /** Spendable manufacturing currency, distinct from lifetime contribution standing. */
  elonBalance?: number;
  elonCapacity?: number;
  elonPerMinute?: number;
  armyUsed?: number;
  armyCapacity?: number;
  /** Recent explainable server-authoritative contribution events. */
  elonEvents?: ElonEvent[];
  /** Symbiosis power grid: generation capacity vs. automated-builder draw. */
  power?: PowerSnap;
  /** Live stewardship score (Symbiosis). */
  score?: { stewardship: number; reliabilityPpm: number; bonus: number; score: number };
  /** Player-facing strategic AI commander; absent for spectators and legacy servers. */
  commander?: CommanderView;
}

/** Persistent Home-only status. The world still uses ordinary PlayerSnap,
 * buildings and units; this is progression/context for the edge HUD. */
export interface HomeStatusSnap {
  revision: number;
  developmentPoints: number;
  nextLevelPoints: number;
  offlineAppliedSeconds: number;
  session: 'home';
  trophies: number;
  lastReport?: RaidReport;
  /** Unit research levels (0-5) and the one in progress. */
  research: Partial<Record<UnitType, number>>;
  researching?: { unit: UnitType; level: number; progress: number };
  /** Seconds of shield left; matchmaking skips shielded cities. */
  shieldSeconds: number;
  /** Raids against this city's published snapshot, newest first. */
  defenseReports: DefenseReport[];
  /** ELON settled through the city ledger so far. */
  elonSettled: number;
}

/** What a defender sees: attackers were paid by the system, nothing was taken. */
export interface DefenseReport {
  raidId: string;
  attacker: string;
  stars: number;
  destruction: number;
  /** System-funded reward the attacker received (not a loss for the defender). */
  attackerReward: Resources;
  shieldSeconds: number;
  at: number;
}

export type RaidPhase = 'idle' | 'scouting' | 'deploying' | 'battle' | 'result' | 'replay';

export interface RaidArmy {
  attack_drone: number;
  fighter: number;
  rocket_launcher: number;
  siege_mech: number;
  stealth_bomber: number;
  plasma_tank: number;
  iron_guardian: number;
  aegis_valkyrie: number;
}

export interface RaidEvent {
  at: number;
  kind: 'start' | 'deploy' | 'destroy' | 'star' | 'finish';
  label: string;
  x?: number;
  y?: number;
}

// ---------- Home asynchronous raids (master spec §6) ----------

/** Raid session lifecycle. Legal moves live in RAID_TRANSITIONS (constants). */
export type RaidSessionState =
  | 'SCOUTING'
  | 'ARMY_RESERVED'
  | 'IN_PROGRESS'
  | 'SETTLING'
  | 'SETTLED'
  | 'SCOUT_EXPIRED'
  | 'CANCELLED_BEFORE_DEPLOY'
  | 'EXPIRED_DURING_RAID'
  | 'RECOVERY_REQUIRED';

/** Immutable published defense. A scouted/raided base is pinned to one of these. */
export interface DefenseSnapshot {
  id: string;
  version: number;
  kind: 'bot' | 'player';
  label: string;
  cityLevel: number;
  seed: number;
  buildings: { id: number; type: BuildingType; tileX: number; tileY: number; level?: number }[];
  /** Grid efficiency of the defender when published; scales defense damage (floor 0.5). */
  defensePower?: number;
  trees: { id: number; tileX: number; tileY: number }[];
  /** sha256 of every other field, canonical JSON. */
  checksum: string;
}

/** Legal deployment band: inside the outer box and outside the inner box. */
export interface RaidDeployZone {
  x0: number; y0: number; x1: number; y1: number;
  ix0: number; iy0: number; ix1: number; iy1: number;
}

export interface RaidDeployEvent {
  /** Raid simulation tick at which the unit was placed (applied before the next step). */
  tick: number;
  unit: keyof RaidArmy;
  x: number;
  y: number;
  /** The Home unit consumed by this deployment. */
  homeUnitId: number;
}

export type RaidEndReason = 'timer' | 'destroyed' | 'eliminated' | 'surrender';

export interface RaidOutcome {
  endTick: number;
  reason: RaidEndReason;
  destruction: number;
  stars: number;
  hubDestroyed: boolean;
  /** sha256 over the final simulation state; replays must reproduce it. */
  checksum: string;
}

/** Everything needed to re-simulate a raid exactly. */
export interface RaidReplay {
  rulesVersion: number;
  snapshotId: string;
  snapshotChecksum: string;
  maxTicks: number;
  /** Whole reservation: undeployed units decide whether the force is eliminated. */
  reserved: RaidArmy;
  /** Attacker unit research levels at reservation; they change combat numbers. */
  research: Partial<Record<keyof RaidArmy, number>>;
  deploys: RaidDeployEvent[];
  surrenderAt?: number;
}

export interface RaidReport {
  raidId: string;
  label: string;
  cityLevel: number;
  stars: number;
  destruction: number;
  reason: RaidEndReason;
  /** System-funded reward actually credited (the defender loses nothing). */
  reward: Resources;
  /** What the raid earned before the storage cap; reward < earned means storage was full. */
  earned: Resources;
  trophiesDelta: number;
  deployed: number;
  returned: number;
  settledAt: number;
  outcomeChecksum: string;
  replay: RaidReplay;
}

/** Home-raid context the attacker's HUD needs; rides on RaidSnap.home. */
export interface HomeRaidView {
  state: RaidSessionState;
  /** Whose base this is: a deterministic bot or another player's published defense. */
  opponent: 'bot' | 'player';
  label: string;
  cityLevel: number;
  /** Seconds until the scout offer lapses (SCOUTING only). */
  expiresIn?: number;
  nextScoutGold: number;
  /** Manufactured units at Home that could still be reserved. */
  available: RaidArmy;
  /** Pinned reward ceiling for this offer. */
  reward: Resources;
  trophies: { win: number; loss: number };
  zone: RaidDeployZone;
  report?: RaidReport;
}

/** Server-authoritative Clash-style assault state, visible only to its attacker. */
export interface RaidSnap {
  id: number;
  phase: RaidPhase;
  attacker: number;
  defender: number;
  army: RaidArmy;
  remaining: RaidArmy;
  deployed: number;
  duration: number;
  secondsLeft: number;
  destruction: number;
  stars: number;
  loot: Resources;
  events: RaidEvent[];
  /** Present for persistent-Home raids against a pinned defense snapshot. */
  home?: HomeRaidView;
}

/** WATT-style stewardship result for one player. */
export interface Standing {
  rank: number;
  playerId: number;
  name: string;
  /** ELON contribution standing (earned by serving needs, labor, ages). */
  standing: number;
  facilities: number;
  /** Completed, still-standing facilities, counted once. */
  stewardship: number;
  /** Share of declared need served, in parts per million. */
  reliabilityPpm: number;
  declaredNeed: number;
  servedNeed: number;
  bonus: number;
  score: number;
}

export interface PowerSnap {
  supply: number;
  draw: number;
}

export type ChainTxKind = 'facility' | 'labor' | 'obligation' | 'energy' | 'need' | 'genesis';

export interface ChainTx {
  hash: string;
  tick: number;
  kind: ChainTxKind;
  playerId: number;
  label: string;
  amount: number;
  block?: number;
}

export interface ChainBlock {
  height: number;
  tick: number;
  hash: string;
  prevHash: string;
  txRoot: string;
  txCount: number;
}

/** Public match ledger summary: a deterministic hash chain sealed by the
 *  authoritative server. Its head is committed on-chain when the match ends. */
export interface ChainSnap {
  height: number;
  head: string;
  pending: number;
  blocks: ChainBlock[];
  txs: ChainTx[];
}

export interface ElonEvent {
  tick: number;
  playerId: number;
  category: 'energy' | 'labor' | 'obligation' | 'need';
  amount: number;
  reason: string;
  sourceId?: number;
}

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
  team?: number; // 0/ausente = sozinho; 1/2 = time (aliados)
}

export interface MapData {
  size: number;
  // row-major: tiles[y * size + x]; valores TILE_GRASS | TILE_WATER (constants.ts)
  tiles: number[];
}

// ---------- Home city ledger and ELON settlement ----------

export type HomeLedgerKind = 'genesis' | 'build' | 'upgrade' | 'manufacture' | 'research' | 'raid' | 'defense' | 'elon' | 'settlement';

/** One logged city event. `hash` commits to every field and the ledger's salt. */
export interface HomeLedgerTx {
  hash: string;
  seq: number;
  at: number;
  kind: HomeLedgerKind;
  label: string;
  /** ELON for elon/settlement entries; resources total for raids; 0 otherwise. */
  amount: number;
  block?: number;
}

export interface HomeLedgerBlock {
  height: number;
  at: number;
  hash: string;
  prevHash: string;
  /** Merkle root of the block's transactions. */
  txRoot: string;
  txCount: number;
}

/** ELON committed out of the playable balance and anchored by ledger head. */
export interface ElonSettlement {
  id: string;
  amount: number;
  at: number;
  ledgerHead: string;
  ledgerHeight: number;
  /** disabled = chain off (hash-chain only), local = dev adapter, rpc states as reported. */
  status: 'pending' | 'disabled' | 'local' | 'simulated' | 'submitted' | 'confirmed' | 'failed' | 'skipped';
  transactionHash?: string;
  chainId?: number;
  blockNumber?: number;
  contract?: string;
  error?: string;
}

export interface HomeLedgerView {
  city: string;
  height: number;
  head: string;
  /** Every retained link and Merkle root recomputed on the server just now. */
  verified: boolean;
  pending: number;
  elon: { balance: number; capacity: number; perMinute: number; settledTotal: number };
  settlements: ElonSettlement[];
  blocks: HomeLedgerBlock[];
  txs: HomeLedgerTx[];
  chain: { mode: 'disabled' | 'local' | 'rpc'; contract?: string };
}
