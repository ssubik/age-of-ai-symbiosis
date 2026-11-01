// Constantes de rede, simulação e balanceamento — fonte única da verdade
// para servidor (validação/simulação) e cliente (UI, custos, pré-validação).

import type { BuildingType, NodeType, RaidSessionState, Resources, ResourceType, UnitType } from './types';

// ---------- Rede ----------
export const GAME_PORT = 8080;

// ---------- Simulação ----------
export const TICK_RATE = 10; // ticks por segundo
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_TICKS = 2; // snapshot completo a cada N ticks (5/s)

// ---------- Mapa ----------
// Escala estilo Age of Empires 2 ("Pequeno" = 144x144). É só este número para
// redimensionar o mundo inteiro (servidor e cliente se ajustam).
export const MAP_SIZE = 144; // MAP_SIZE x MAP_SIZE tiles
export const TILE_GRASS = 0;
export const TILE_WATER = 1;
// Raso (vau): a travessia a pé do mapa Rio — passável por unidades E barcos.
export const TILE_SHALLOW = 2;

// ---------- Partida ----------
export const MAX_PLAYERS_PER_ROOM = 4;
// 1 permite treinar 100% sozinho (o host remove o bot automático da sala).
export const MIN_PLAYERS_TO_START = 1;
export const STARTING_RESOURCES: Resources = { energy: 250, alloys: 350, compute: 100 };
// Modo "Batalha/Rápido": começa cheio de recursos e numa era avançada, para ir
// direto ao combate (partida rápida — e ótimo pra gravar o gameplay).
export const BATTLE_STARTING_RESOURCES: Resources = { energy: 20000, alloys: 30000, compute: 20000 };
export const BATTLE_STARTING_AGE = 3; // Idade dos Castelos: quartel/arquearia/estábulo já liberados
export const START_VILLAGERS = 3;
export const POP_CAP_MAX = 75;

// ---------- Coleta ----------
export const CARRY_CAPACITY = 10; // quanto um aldeão carrega antes de depositar
export const GATHER_RATE = 1.0;   // recursos por segundo
export const FARM_FOOD = 250;     // comida total de uma fazenda concluída

// ---------- Unidades ----------
export interface UnitDef {
  hp: number;
  speed: number;          // tiles por segundo
  attack: number;         // dano por golpe
  range: number;          // alcance em tiles (1 = corpo a corpo)
  attackCooldown: number; // segundos entre golpes
  sight: number;          // raio de visão/aggro em tiles
  cost: Partial<Resources>;
  trainTime: number;      // segundos
  pop: number;
}

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  villager:  { hp: 30,  speed: 2.0, attack: 3,  range: 1,   attackCooldown: 1.5, sight: 5, cost: { energy: 50 },           trainTime: 8,  pop: 1 },
  designer:  { hp: 38, speed: 1.9, attack: 2, range: 1, attackCooldown: 1.6, sight: 6, cost: { energy: 100, compute: 80 }, trainTime: 20, pop: 1 },
  swordsman: { hp: 60,  speed: 1.8, attack: 9,  range: 1,   attackCooldown: 1.2, sight: 5, cost: { energy: 60, compute: 20 }, trainTime: 10, pop: 1 },
  archer:    { hp: 35,  speed: 1.9, attack: 6,  range: 4.5, attackCooldown: 1.5, sight: 6, cost: { alloys: 40, compute: 30 }, trainTime: 10, pop: 1 },
  knight:    { hp: 100, speed: 2.6, attack: 14, range: 1,   attackCooldown: 1.2, sight: 6, cost: { energy: 70, compute: 50 }, trainTime: 16, pop: 1 },
  // ---- Navais (só água; treinadas no Porto) ----
  fishing_boat: { hp: 60,  speed: 2.2, attack: 0,  range: 0,   attackCooldown: 1,   sight: 6, cost: { alloys: 60 },            trainTime: 10, pop: 1 },
  war_galley:   { hp: 130, speed: 2.4, attack: 8,  range: 5.5, attackCooldown: 1.6, sight: 7, cost: { alloys: 90, compute: 30 },  trainTime: 14, pop: 2 },
  transport:    { hp: 110, speed: 2.6, attack: 0,  range: 0,   attackCooldown: 1,   sight: 6, cost: { alloys: 80 },            trainTime: 12, pop: 1 },
  // ---- Symbiosis automation (Robotics Workshop) ----
  robot: { hp: 70, speed: 1.6, attack: 2, range: 1, attackCooldown: 1.6, sight: 5, cost: { alloys: 60, compute: 40 }, trainTime: 12, pop: 1 },
  drone: { hp: 28, speed: 3.2, attack: 0, range: 0, attackCooldown: 1,   sight: 8, cost: { alloys: 20, compute: 60 }, trainTime: 10, pop: 1 },
  attack_drone: { hp: 55, speed: 3.4, attack: 9, range: 4.5, attackCooldown: 1.25, sight: 9, cost: { alloys: 35, compute: 75 }, trainTime: 14, pop: 1 },
  fighter: { hp: 95, speed: 4.2, attack: 16, range: 5.5, attackCooldown: 1.8, sight: 10, cost: { alloys: 60, compute: 130 }, trainTime: 22, pop: 2 },
  rocket_launcher: { hp: 105, speed: 1.35, attack: 24, range: 7.5, attackCooldown: 3.2, sight: 9, cost: { alloys: 100, compute: 120 }, trainTime: 26, pop: 3 },
  siege_mech: { hp: 190, speed: 1.45, attack: 28, range: 3.5, attackCooldown: 2.1, sight: 8, cost: { alloys: 140, compute: 170 }, trainTime: 30, pop: 3 },
  stealth_bomber: { hp: 120, speed: 4.6, attack: 34, range: 6.5, attackCooldown: 3.4, sight: 11, cost: { alloys: 100, compute: 220 }, trainTime: 34, pop: 3 },
  plasma_tank: { hp: 260, speed: 1.25, attack: 40, range: 6, attackCooldown: 2.8, sight: 9, cost: { alloys: 180, compute: 240 }, trainTime: 38, pop: 4 },
  iron_guardian: { hp: 340, speed: 3.1, attack: 52, range: 5.5, attackCooldown: 1.7, sight: 12, cost: { alloys: 250, compute: 500 }, trainTime: 60, pop: 5 },
  aegis_valkyrie: { hp: 250, speed: 4.4, attack: 30, range: 5, attackCooldown: 1.4, sight: 11, cost: { alloys: 220, compute: 460 }, trainTime: 52, pop: 5 },
};

// ---------- Prédios ----------
export interface BuildingDef {
  hp: number;
  size: number; // ocupa size x size tiles
  cost: Partial<Resources>;
  buildTime: number; // segundos com 1 construtor
  popProvided: number;
  trains: UnitType[];
  isDropOff: boolean; // aceita depósito de recursos
  ageReq: number;     // era mínima para poder construir (1 = desde o início)
  accepts?: ResourceType[]; // se depósito: recursos que aceita (ausente = TODOS, ex.: Centro da Cidade)
  /** Pré-requisito de prédio (árvore do AoE2): precisa ter um CONCLUÍDO deste
   *  tipo pra construir. Ex.: Fazenda/Mercado ← Moinho; Arquearia/Estábulo/
   *  Ferraria ← Quartel. Sem o pré-requisito o botão nem aparece no menu. */
  requires?: BuildingType;
  /** Power generation capacity (Symbiosis grid). */
  power?: number;
  /** Only buildable in Symbiosis matches. */
  symbiosis?: boolean;
  /** CoC-style passive ELON economy and army storage. */
  elonPerMinute?: number;
  elonCapacity?: number;
  armyCapacity?: number;
}

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  town_center:   { hp: 1000, size: 3, cost: { alloys: 375 }, buildTime: 60, popProvided: 5, trains: ['villager'],   isDropOff: true,  ageReq: 1 },
  house:         { hp: 250,  size: 2, cost: { alloys: 50 },              buildTime: 12, popProvided: 5, trains: [],              isDropOff: false, ageReq: 1 },
  barracks:      { hp: 700,  size: 3, cost: { alloys: 150 },             buildTime: 25, popProvided: 0, trains: ['swordsman'],   isDropOff: false, ageReq: 1 },
  farm:          { hp: 120,  size: 2, cost: { alloys: 60 },              buildTime: 10, popProvided: 0, trains: [],              isDropOff: false, ageReq: 1, requires: 'mill' },
  archery_range: { hp: 700,  size: 3, cost: { alloys: 175 },             buildTime: 25, popProvided: 0, trains: ['archer'],      isDropOff: false, ageReq: 2, requires: 'barracks' },
  stable:        { hp: 700,  size: 3, cost: { alloys: 175 },             buildTime: 25, popProvided: 0, trains: ['knight'],      isDropOff: false, ageReq: 3, requires: 'barracks' },
  blacksmith:    { hp: 700,  size: 2, cost: { alloys: 150 },             buildTime: 25, popProvided: 0, trains: [],              isDropOff: false, ageReq: 2, requires: 'barracks' },
  market:        { hp: 600,  size: 2, cost: { alloys: 150 },             buildTime: 25, popProvided: 0, trains: [],              isDropOff: false, ageReq: 2, requires: 'mill', elonPerMinute: 4 },
  wall:          { hp: 550,  size: 1, cost: { alloys: 10 },             buildTime: 6,  popProvided: 0, trains: [],              isDropOff: false, ageReq: 1 },
  watch_tower:   { hp: 480,  size: 1, cost: { alloys: 120 },   buildTime: 22, popProvided: 0, trains: [],              isDropOff: false, ageReq: 2 },
  mill:          { hp: 250,  size: 2, cost: { alloys: 100 },             buildTime: 15, popProvided: 0, trains: [],              isDropOff: true,  ageReq: 1, accepts: ['energy'] },
  lumber_camp:   { hp: 250,  size: 2, cost: { alloys: 100 },             buildTime: 15, popProvided: 0, trains: [],              isDropOff: true,  ageReq: 1, accepts: ['alloys'] },
  mining_camp:   { hp: 250,  size: 2, cost: { alloys: 100 },             buildTime: 15, popProvided: 0, trains: [],              isDropOff: true,  ageReq: 1, accepts: ['compute', 'alloys'] },
  // Porto: construído NA ÁGUA encostado na costa; deposita o peixe e treina barcos.
  dock:          { hp: 600,  size: 2, cost: { alloys: 150 },             buildTime: 20, popProvided: 0, trains: ['fishing_boat', 'war_galley', 'transport'], isDropOff: true, ageReq: 1, accepts: ['energy'] },
  // ---- Symbiosis energy grid + automation ----
  solar_array:       { hp: 220, size: 2, cost: { alloys: 80 },             buildTime: 14, popProvided: 0, trains: [],                isDropOff: false, ageReq: 1, power: 4, elonPerMinute: 3, symbiosis: true },
  wind_turbine:      { hp: 260, size: 1, cost: { alloys: 100 },  buildTime: 16, popProvided: 0, trains: [],                isDropOff: false, ageReq: 2, power: 6, elonPerMinute: 4, symbiosis: true },
  robotics_workshop: { hp: 650, size: 3, cost: { alloys: 150, compute: 50 }, buildTime: 30, popProvided: 0, trains: ['robot', 'drone'], isDropOff: false, ageReq: 1, elonPerMinute: 5, symbiosis: true },
  design_studio: { hp: 560, size: 2, cost: { alloys: 140, compute: 100 }, buildTime: 28, popProvided: 0, trains: ['designer'], isDropOff: false, ageReq: 1, requires: 'data_center', symbiosis: true },
  data_center: { hp: 520, size: 2, cost: { alloys: 120, compute: 80 }, buildTime: 24, popProvided: 0, trains: [], isDropOff: false, ageReq: 1, elonPerMinute: 6, symbiosis: true },
  elon_vault: { hp: 700, size: 2, cost: { alloys: 260 }, buildTime: 28, popProvided: 0, trains: [], isDropOff: false, ageReq: 1, elonCapacity: 500, symbiosis: true },
  army_camp: { hp: 600, size: 3, cost: { alloys: 260 }, buildTime: 26, popProvided: 0, trains: [], isDropOff: false, ageReq: 1, armyCapacity: 10, symbiosis: true },
  drone_factory: { hp: 720, size: 3, cost: { alloys: 180, compute: 120 }, buildTime: 34, popProvided: 0, trains: ['attack_drone'], isDropOff: false, ageReq: 2, requires: 'robotics_workshop', symbiosis: true },
  mech_forge: { hp: 950, size: 3, cost: { alloys: 300, compute: 260 }, buildTime: 46, popProvided: 0, trains: ['siege_mech'], isDropOff: false, ageReq: 3, requires: 'robotics_workshop', symbiosis: true },
  aerospace_hangar: { hp: 850, size: 3, cost: { alloys: 260, compute: 220 }, buildTime: 42, popProvided: 0, trains: ['fighter', 'stealth_bomber'], isDropOff: false, ageReq: 4, requires: 'drone_factory', symbiosis: true },
  missile_foundry: { hp: 900, size: 3, cost: { alloys: 280, compute: 240 }, buildTime: 44, popProvided: 0, trains: ['rocket_launcher', 'plasma_tank'], isDropOff: false, ageReq: 4, requires: 'robotics_workshop', symbiosis: true },
  point_turret: { hp: 760, size: 1, cost: { alloys: 180 }, buildTime: 30, popProvided: 0, trains: [], isDropOff: false, ageReq: 3, symbiosis: true },
  anti_air: { hp: 820, size: 2, cost: { alloys: 90, compute: 110 }, buildTime: 34, popProvided: 0, trains: [], isDropOff: false, ageReq: 3, symbiosis: true },
  exosuit_lab: { hp: 1100, size: 3, cost: { alloys: 450, compute: 600 }, buildTime: 70, popProvided: 0, trains: ['iron_guardian'], isDropOff: false, ageReq: 5, requires: 'mech_forge', symbiosis: true },
  sensor_tower: { hp: 420, size: 1, cost: { alloys: 80, compute: 90 }, buildTime: 26, popProvided: 0, trains: [], isDropOff: false, ageReq: 3, symbiosis: true },
};

// ---------- Symbiosis: automated builders + power grid ----------
/** Construction speed per builder (villager = 1). */
export const BUILD_RATE: Partial<Record<UnitType, number>> = { villager: 1, designer: 1, robot: 1.8, drone: 1.25 };
/** Grid power each automated unit draws while it exists. */
export const POWER_DRAW: Partial<Record<UnitType, number>> = { robot: 1, drone: 1, attack_drone: 2, fighter: 3, rocket_launcher: 2, siege_mech: 3, stealth_bomber: 4, plasma_tank: 4, iron_guardian: 6, aegis_valkyrie: 5 };
/** Base grid capacity of a completed Town Center in Symbiosis matches. */
export const TOWN_CENTER_POWER = 2;
/** Floor for automation efficiency when demand exceeds supply. */
export const POWER_MIN_EFFICIENCY = 0.3;

// ---------- Persistent Home Phase 1 ----------
export const HOME_OFFLINE_CAP_SECONDS = 8 * 60 * 60;
export const HOME_LEVEL_POINTS: readonly number[] = [0, 0, 280, 620, 1100, 1800];
export const HOME_DEVELOPMENT: Partial<Record<BuildingType, number>> = {
  town_center: 100, house: 30, farm: 25, mill: 50, lumber_camp: 50,
  mining_camp: 50, solar_array: 50, wind_turbine: 50,
  robotics_workshop: 100, data_center: 70, army_camp: 80,
  drone_factory: 80, watch_tower: 35, wall: 2, point_turret: 35, anti_air: 35,
  sensor_tower: 45, mech_forge: 90, missile_foundry: 90, aerospace_hangar: 100, exosuit_lab: 120,
};
/** Passive Home production per completed facility, per wall-clock hour. */
export const HOME_PRODUCTION_PER_HOUR: Partial<Record<BuildingType, Partial<Resources>>> = {
  farm: { energy: 120 }, mill: { energy: 80 }, lumber_camp: { alloys: 100 },
  mining_camp: { alloys: 55, compute: 55 }, solar_array: {},
};
export const HOME_BASE_STORAGE: Resources = { energy: 2000, alloys: 3500, compute: 1500 };
export const HOME_STORAGE_PER_DEPOT: Partial<Record<BuildingType, Partial<Resources>>> = {
  mill: { energy: 1000 }, lumber_camp: { alloys: 1000 },
  mining_camp: { alloys: 750, compute: 750 },
};
// ---------- Persistent Home Phase 2: manufacturing and camps ----------
/** Army Camp space per manufactured unit (master spec §5); separate from stats. */
export const HOME_CAMP_SPACE: Partial<Record<UnitType, number>> = {
  attack_drone: 1, siege_mech: 4, rocket_launcher: 3, fighter: 3,
  stealth_bomber: 5, plasma_tank: 5, iron_guardian: 8, aegis_valkyrie: 7,
};
/** Refund share when a job that already started is cancelled; unstarted jobs refund fully. */
export const HOME_STARTED_JOB_REFUND = 0.5;
// ---------- Persistent Home Phase 3: asynchronous raids ----------
export const RAID_RULES_VERSION = 1;
export const RAID_DURATION_SECONDS = 180;
export const RAID_SCOUT_TTL_SECONDS = 60;
/** First scout is free; each "Next" costs this much Gold. */
export const RAID_NEXT_SCOUT_GOLD = 30;
export const RAID_MAX_REPORTS = 20;
export const RAID_MAX_SETTLED_KEYS = 100;
/** Pinned, system-funded reward ceiling by defender City Level (index = level). */
export const RAID_REWARD_BY_LEVEL: readonly Resources[] = [
  { energy: 0, alloys: 0, compute: 0 },
  { energy: 260, alloys: 380, compute: 160 },
  { energy: 420, alloys: 620, compute: 280 },
  { energy: 640, alloys: 960, compute: 420 },
  { energy: 900, alloys: 1360, compute: 620 },
  { energy: 1200, alloys: 1840, compute: 850 },
];
/** A raid with zero stars still pays this share of the destruction-scaled offer. */
export const RAID_LOSS_REWARD_SHARE = 0.5;
export const RAID_TROPHIES = { win: 24, loss: 12 } as const;
/** Every legal session move; anything else is a stale or duplicate transition. */
export const RAID_TRANSITIONS: Readonly<Record<RaidSessionState, readonly RaidSessionState[]>> = {
  SCOUTING: ['SCOUTING', 'ARMY_RESERVED', 'SCOUT_EXPIRED', 'CANCELLED_BEFORE_DEPLOY'],
  ARMY_RESERVED: ['IN_PROGRESS', 'CANCELLED_BEFORE_DEPLOY'],
  IN_PROGRESS: ['SETTLING', 'EXPIRED_DURING_RAID', 'RECOVERY_REQUIRED'],
  EXPIRED_DURING_RAID: ['SETTLING'],
  RECOVERY_REQUIRED: ['SETTLING'],
  SETTLING: ['SETTLED'],
  SETTLED: [],
  SCOUT_EXPIRED: [],
  CANCELLED_BEFORE_DEPLOY: [],
};
export function canRaidTransition(from: RaidSessionState, to: RaidSessionState): boolean {
  return RAID_TRANSITIONS[from].includes(to);
}

// ---------- Persistent Home Phase 4: progression breadth ----------
// Versioned balance (master spec §4, §5). Initial targets, not final balance.
export const HOME_BALANCE_VERSION = 4;

/** Highest level each Home building can reach. Absent = not upgradable. */
export const HOME_MAX_LEVEL: Partial<Record<BuildingType, number>> = {
  town_center: 5, army_camp: 4, drone_factory: 4, mech_forge: 3, missile_foundry: 3,
  aerospace_hangar: 3, exosuit_lab: 2, robotics_workshop: 3,
  farm: 3, mill: 3, lumber_camp: 3, mining_camp: 3, solar_array: 3, wind_turbine: 3,
  watch_tower: 3, point_turret: 3, anti_air: 3, sensor_tower: 2,
};

/** City Level needed to place a building at Home (overrides Arena ageReq). */
export const HOME_BUILDING_CITY_LEVEL: Partial<Record<BuildingType, number>> = {
  // Anything a City Level requires must be placeable one level earlier
  // (sensor_tower gates L3, anti_air gates L4), or progression deadlocks.
  drone_factory: 2, wind_turbine: 2, watch_tower: 2, point_turret: 2, sensor_tower: 2,
  mech_forge: 3, missile_foundry: 3, anti_air: 3,
  aerospace_hangar: 4, exosuit_lab: 5,
};

/** Which factory (and factory level) manufactures each unit at Home, and from which City Level. */
export const HOME_UNIT_UNLOCK: Partial<Record<UnitType, { factory: BuildingType; factoryLevel: number; cityLevel: number }>> = {
  attack_drone: { factory: 'drone_factory', factoryLevel: 1, cityLevel: 2 },
  siege_mech: { factory: 'mech_forge', factoryLevel: 1, cityLevel: 3 },
  rocket_launcher: { factory: 'missile_foundry', factoryLevel: 1, cityLevel: 3 },
  fighter: { factory: 'aerospace_hangar', factoryLevel: 1, cityLevel: 4 },
  stealth_bomber: { factory: 'aerospace_hangar', factoryLevel: 2, cityLevel: 4 },
  plasma_tank: { factory: 'missile_foundry', factoryLevel: 2, cityLevel: 4 },
  iron_guardian: { factory: 'exosuit_lab', factoryLevel: 1, cityLevel: 5 },
  aegis_valkyrie: { factory: 'exosuit_lab', factoryLevel: 2, cityLevel: 5 },
};

export interface CityLevelRequirement {
  cost: Partial<Resources>;
  /** Each entry: a completed building of one of `types` at `level` or higher. */
  buildings: { types: BuildingType[]; level: number }[];
  /** Grid supply must reach this and cover draw. */
  minSupply: number;
  /** Technology milestone: a unit research level. */
  research?: { unit: UnitType; level: number };
}

/** Hub upgrade to each City Level (spec §4 table). */
export const HOME_CITY_LEVELS: Readonly<Record<number, CityLevelRequirement>> = {
  2: { cost: { energy: 400 }, buildings: [{ types: ['robotics_workshop'], level: 1 }, { types: ['solar_array', 'wind_turbine'], level: 1 }], minSupply: 0 },
  3: {
    cost: { energy: 800, alloys: 600, compute: 500 },
    buildings: [{ types: ['lumber_camp'], level: 2 }, { types: ['mill'], level: 2 }, { types: ['army_camp'], level: 2 }, { types: ['sensor_tower'], level: 1 }],
    minSupply: 12, research: { unit: 'attack_drone', level: 1 },
  },
  4: {
    cost: { energy: 1200, alloys: 1400, compute: 900 },
    buildings: [{ types: ['solar_array', 'wind_turbine'], level: 2 }, { types: ['mining_camp'], level: 2 }, { types: ['point_turret'], level: 2 }, { types: ['anti_air'], level: 1 }],
    minSupply: 30,
  },
  5: {
    cost: { energy: 1800, alloys: 2400, compute: 1500 },
    buildings: [{ types: ['drone_factory'], level: 4 }, { types: ['army_camp'], level: 4 }, { types: ['robotics_workshop'], level: 3 }],
    minSupply: 45,
  },
};

/** Hub upgrade construction time (seconds of one 1.0x builder) per target level. */
export const HOME_HUB_UPGRADE_TIME: readonly number[] = [0, 0, 60, 120, 180, 260];

/** Multiplier for a level-scaled stat: +`perLevel` per level above 1. */
export function levelScale(level: number | undefined, perLevel: number): number {
  return 1 + Math.max(0, (level ?? 1) - 1) * perLevel;
}

/** Upgrade cost: the building's own cost scaled by the target level. */
export function homeUpgradeCost(type: BuildingType, toLevel: number): Partial<Resources> {
  if (type === 'town_center') return { ...(HOME_CITY_LEVELS[toLevel]?.cost ?? {}) };
  const out: Partial<Resources> = {};
  for (const [k, v] of Object.entries(BUILDING_DEFS[type].cost) as [ResourceType, number][]) {
    out[k] = Math.round((v * 0.75 * toLevel) / 5) * 5;
  }
  return out;
}

export function homeUpgradeTime(type: BuildingType, toLevel: number): number {
  if (type === 'town_center') return HOME_HUB_UPGRADE_TIME[toLevel] ?? 300;
  return Math.round(BUILDING_DEFS[type].buildTime * (0.5 + 0.5 * toLevel));
}

/** Building HP at a level (Home and raid snapshots). */
export function buildingMaxHp(type: BuildingType, level?: number): number {
  return Math.round(BUILDING_DEFS[type].hp * levelScale(level, 0.25));
}

export interface UnitResearchDef {
  /** Short description of the single attribute it improves. */
  effect: string;
  /** Fractional gain per level (0.05 = +5%). */
  perLevel: number;
  cost: Partial<Resources>;
  /** Seconds per level, multiplied by the target level. */
  time: number;
}

/** Five research levels per unit, one primary attribute each (spec §5). */
export const HOME_RESEARCH_MAX = 5;
export const HOME_UNIT_RESEARCH: Partial<Record<UnitType, UnitResearchDef>> = {
  attack_drone: { effect: 'damage', perLevel: 0.05, cost: { alloys: 60, compute: 120 }, time: 40 },
  siege_mech: { effect: 'hit points', perLevel: 0.06, cost: { alloys: 120, compute: 160 }, time: 50 },
  rocket_launcher: { effect: 'range', perLevel: 0.04, cost: { alloys: 100, compute: 160 }, time: 50 },
  fighter: { effect: 'damage vs defenses', perLevel: 0.04, cost: { alloys: 100, compute: 200 }, time: 60 },
  stealth_bomber: { effect: 'blast radius', perLevel: 0.05, cost: { alloys: 120, compute: 240 }, time: 70 },
  plasma_tank: { effect: 'hit points', perLevel: 0.05, cost: { alloys: 160, compute: 240 }, time: 70 },
  iron_guardian: { effect: 'field radius and duration', perLevel: 0.05, cost: { alloys: 200, compute: 320 }, time: 90 },
  aegis_valkyrie: { effect: 'arc damage; extra arc at L3 and L5', perLevel: 0.05, cost: { alloys: 200, compute: 320 }, time: 90 },
};

export function homeResearchCost(unit: UnitType, toLevel: number): Partial<Resources> {
  const def = HOME_UNIT_RESEARCH[unit];
  const out: Partial<Resources> = {};
  for (const [k, v] of Object.entries(def?.cost ?? {}) as [ResourceType, number][]) out[k] = v * toLevel;
  return out;
}

/** Shield granted to a defender per stars lost (index = stars). */
export const HOME_SHIELD_HOURS: readonly number[] = [0, 4, 8, 12];
/** Matchmaking widens trophy tolerance through these steps (spec §6.1). */
export const RAID_TROPHY_TOLERANCES: readonly number[] = [100, 300, Number.POSITIVE_INFINITY];
/** Grid shortage weakens defenses but never below this (spec §6.6). */
export const DEFENSE_POWER_FLOOR = 0.5;

export const SYMBIOSIS_UNITS: ReadonlySet<UnitType> = new Set(['robot', 'drone']);
export const SYMBIOSIS_COMBAT_UNITS: ReadonlySet<UnitType> = new Set(['attack_drone', 'fighter', 'rocket_launcher', 'siege_mech', 'stealth_bomber', 'plasma_tank', 'iron_guardian', 'aegis_valkyrie']);
export const ELON_UNIT_COST: Partial<Record<UnitType, number>> = {
  attack_drone: 50, fighter: 180, rocket_launcher: 110, siege_mech: 140,
  stealth_bomber: 260, plasma_tank: 220, iron_guardian: 600, aegis_valkyrie: 520,
};
export const FLYING_UNITS: ReadonlySet<UnitType> = new Set(['drone', 'attack_drone', 'fighter', 'stealth_bomber', 'iron_guardian', 'aegis_valkyrie']);
export const isFlyingUnit = (t: UnitType): boolean => FLYING_UNITS.has(t);
export const isBuilderUnit = (t: UnitType): boolean => (BUILD_RATE[t] ?? 0) > 0;
export const isSymbiosisBuilding = (t: BuildingType): boolean => !!BUILDING_DEFS[t].symbiosis;
/** Automation runs at full speed while supply covers draw, then degrades
 *  proportionally (a congested grid, as in WATT Arena). */
export function powerEfficiency(supply: number, draw: number): number {
  if (draw <= 0 || supply >= draw) return 1;
  return Math.max(POWER_MIN_EFFICIENCY, supply / draw);
}

// ---------- Symbiosis: match ledger ----------
/** A ledger block is sealed every N ticks (5 s at 10 ticks/s). */
export const CHAIN_BLOCK_TICKS = 50;

// ---------- Naval ----------
/** Unidades que andam SÓ na água (água funda ou raso). */
export const NAVAL_UNITS: ReadonlySet<UnitType> = new Set(['fishing_boat', 'war_galley', 'transport']);
export const isNavalUnit = (t: UnitType): boolean => NAVAL_UNITS.has(t);
/** Capacidade do barco de transporte (unidades terrestres embarcadas). */
export const TRANSPORT_CAP = 5;
/** Quanto o barco de pesca carrega antes de entregar no Porto. */
export const FISH_BOAT_CARRY = 15;
/** Raio mínimo entre barcos (empurra-afasta suave — não ficam colados). */
export const BOAT_SEPARATION = 0.9;

// ---------- Visão (névoa de guerra, só apresentação no cliente) ----------
// Raios em tiles, medidos do CENTRO da fonte. Unidades usam o `sight` delas.
export const BUILDING_VISION_DEFAULT = 6;
export const BUILDING_VISION: Partial<Record<BuildingType, number>> = {
  town_center: 9,
  watch_tower: 9,
  dock: 7,
};
export const SHEEP_VISION = 3;

// ---------- Mercado: compra/venda de recursos por ouro ----------
// Preços em ouro por LOTE de 100 unidades, compartilhados pela sala (estilo
// AoE2): comprar encarece o recurso, vender barateia — para todo mundo.
export const TRADE_LOT = 100;
export const MARKET_START_PRICE = 100;
export const MARKET_PRICE_STEP = 5;   // variação do preço a cada transação
export const MARKET_PRICE_MIN = 25;
export const MARKET_PRICE_MAX = 250;
export const MARKET_FEE = 0.15;       // taxa do mercador (spread compra/venda)
/** Quanto CUSTA comprar 1 lote ao preço atual (com taxa). */
export function tradeBuyCost(price: number): number {
  return Math.ceil(price * (1 + MARKET_FEE));
}
/** Quanto RENDE vender 1 lote ao preço atual (com taxa). */
export function tradeSellGain(price: number): number {
  return Math.floor(price * (1 - MARKET_FEE));
}

// ---------- Prédios de defesa (torre de vigia + Centro da Cidade atiram flechas) ----------
export interface DefenseDef {
  range: number;    // alcance base em tiles (na era mínima do prédio)
  cooldown: number; // segundos entre flechas
  attack: number;   // dano base por flecha
  /** Restricts what the defense can hit; omitted = ground and air. */
  targets?: 'ground' | 'air';
}
/** Prédios que atiram flechas nos inimigos próximos. Alcance e dano crescem com
 *  a era do dono e com as pesquisas de defesa — ver buildingRange/buildingAttack. */
export const DEFENSE_DEFS: Partial<Record<BuildingType, DefenseDef>> = {
  watch_tower: { range: 6.5, cooldown: 1.5, attack: 5 },
  town_center: { range: 6,   cooldown: 2.0, attack: 4 },
  point_turret: { range: 7,   cooldown: 1.0, attack: 16, targets: 'ground' },
  anti_air:     { range: 8.5, cooldown: 0.9, attack: 24, targets: 'air' },
};
/** Ganho por era acima da 1ª: a cada avanço, a flecha vai mais longe e bate mais. */
export const DEFENSE_RANGE_PER_AGE = 0.5;
export const DEFENSE_ATTACK_PER_AGE = 1.5;

/** Capacidade de GUARNIÇÃO (quantas unidades cabem dentro pra se proteger). Cada
 *  unidade guarnecida faz o prédio atirar uma flecha a mais (até a capacidade). */
export const GARRISON_CAP: Partial<Record<BuildingType, number>> = {
  town_center: 10,
  watch_tower: 5,
};

export const TRAIN_QUEUE_MAX = 5;

// ---------- Eras (estilo AoE2) ----------
// Pesquisadas no Centro da Cidade; liberam unidades e mudam o visual dos prédios.
export const MAX_AGE = 5;
// The five layers of the AI industry, one per age: energy powers compute,
// compute runs AI factories, factories produce what models direct, and models
// become useful as applications (the Level-5 specialization).
export const AGE_NAMES: string[] = ['', 'Energy Grid', 'Compute Layer', 'AI Factories', 'Model Layer', 'Applications'];
/** Advancing out of age N needs a completed building of layer N. */
export const LAYER_GATE: Record<number, BuildingType[]> = {
  1: ['solar_array', 'wind_turbine'],
  2: ['data_center'],
  3: ['robotics_workshop', 'drone_factory', 'mech_forge'],
  4: ['design_studio'],
};
export function layerGateMet(age: number, completed: Iterable<BuildingType>): boolean {
  const gate = LAYER_GATE[age];
  if (!gate) return true;
  for (const type of completed) if (gate.includes(type)) return true;
  return false;
}
/** Arena: what layer buildings produce per minute. Compute output is scaled by
 *  grid efficiency, so losing generators starves compute. */
export const LAYER_OUTPUT: Partial<Record<BuildingType, Partial<Resources>>> = {
  solar_array: { energy: 18 },
  wind_turbine: { energy: 28 },
  data_center: { compute: 20 },
};
/** Arena: grid power drawn by completed buildings (compute consumes energy). */
export const BUILDING_POWER_DRAW: Partial<Record<BuildingType, number>> = { data_center: 2 };
export const AGE_NUMERALS: string[] = ['', 'I', 'II', 'III', 'IV', 'V'];
/** Custo para pesquisar a era N (índice = era destino) — valores do Age of
 *  Mythology (Clássica 400c; Heroica 800c+500o; Mítica 1000c+1000o): o último
 *  salto é BEM caro, compensando pedir poucos prédios. */
export const AGE_COSTS: Partial<Resources>[] = [
  {}, {},
  { energy: 400 },              // -> Feudal
  { energy: 800, compute: 500 },   // -> Castelos
  { energy: 1000, compute: 1000 }, // -> Imperial
  { energy: 1400, compute: 1400 }, // -> Command Metropolis / Space Gateway
];
/** Tempo de pesquisa (s) da era N (índice = era destino). */
export const AGE_RESEARCH_TIME: number[] = [0, 0, 25, 40, 55, 70];
/** REGRA DO AoE2 pra avançar de era: além dos recursos, é preciso ter construído
 *  2 prédios DIFERENTES da era atual — e Casa, Fazenda e Muralha NÃO contam
 *  (nem o Centro da Cidade). Ex.: nas Trevas valem Quartel/Moinho/Madeireira/
 *  Campo de Mineração. Duas cópias do mesmo prédio contam como UM. */
export const AGE_UP_EXCLUDED: ReadonlySet<BuildingType> = new Set<BuildingType>(['town_center', 'house', 'farm', 'wall', 'solar_array', 'wind_turbine']);

/** Este tipo conta pro avanço a partir da era `fromAge`? */
export function countsForAgeUp(type: BuildingType, fromAge: number): boolean {
  return !AGE_UP_EXCLUDED.has(type) && BUILDING_DEFS[type].ageReq === fromAge;
}

/** Nº de prédios (tipos distintos) exigidos pra sair de cada era — estilo Age
 *  of Mythology (pede POUCOS prédios e recursos cada vez mais caros): sair da
 *  era 1 = 1 prédio, era 2 = 2 prédios, era 3 = 1 prédio. (índice = era atual) */
const AGE_UP_WANTED = [0, 1, 2, 1];

export function buildingsToAdvance(fromAge: number): number {
  let types = 0;
  for (const t of Object.keys(BUILDING_DEFS) as BuildingType[]) {
    if (countsForAgeUp(t, fromAge)) types++;
  }
  return Math.min(AGE_UP_WANTED[fromAge] ?? 1, types);
}
/** Era mínima para treinar cada unidade. */
export const UNIT_AGE_REQ: Record<UnitType, number> = {
  villager: 1,
  designer: 1,
  swordsman: 1,
  archer: 2,
  knight: 3,
  fishing_boat: 1,
  war_galley: 2, // barco de guerra a partir da Idade Feudal (estilo AoE)
  transport: 1,  // travessia cedo: o rio não pode trancar o mapa na Idade das Trevas
  robot: 1,
  drone: 2,
  attack_drone: 2,
  siege_mech: 3,
  fighter: 4,
  rocket_launcher: 4,
  stealth_bomber: 4,
  plasma_tank: 4,
  iron_guardian: 5,
  aegis_valkyrie: 5,
};

// ---------- Tecnologias / upgrades (pesquisados nos prédios) ----------
export interface TechDef {
  id: string;
  name: string;
  icon: string;
  building: BuildingType; // onde é pesquisada
  ageReq: number;
  cost: Partial<Resources>;
  time: number;           // segundos de pesquisa
  prereq?: string;        // tecnologia obrigatória antes
  units: UnitType[];      // unidades afetadas pelo bônus (vazio = tech econômica)
  addAttack?: number;
  addHp?: number;
  addArmor?: number;      // reduz o dano recebido
  addRange?: number;      // alcance (arqueiro)
  /** Bônus econômico: fração a mais na velocidade de coleta por recurso (0.2 = +20%). */
  gather?: Partial<Record<ResourceType, number>>;
  /** Bônus econômico: capacidade extra de carga do aldeão. */
  carry?: number;
  /** Bônus de DEFESA de prédio (torre de vigia + Centro da Cidade): dano e/ou
   *  alcance das flechas. Techs de defesa têm `units: []`. */
  defense?: { attack?: number; range?: number };
}

const MELEE: UnitType[] = ['swordsman', 'knight'];
const ARCHER: UnitType[] = ['archer'];

export const TECH_DEFS: TechDef[] = [
  // --- Ferraria: ataque e blindagem para todo o exército ---
  { id: 'forging',      name: 'Forja',              icon: '🔨', building: 'blacksmith', ageReq: 2, cost: { energy: 150 },            time: 25, units: MELEE,  addAttack: 1 },
  { id: 'iron_casting', name: 'Fundição de Ferro',  icon: '🔥', building: 'blacksmith', ageReq: 3, cost: { energy: 220, compute: 120 }, time: 30, prereq: 'forging', units: MELEE, addAttack: 1 },
  { id: 'fletching',    name: 'Retesamento',        icon: '🪶', building: 'blacksmith', ageReq: 2, cost: { energy: 100, compute: 50 },  time: 20, units: ARCHER, addAttack: 1, addRange: 0.5 },
  { id: 'bodkin',       name: 'Ponta Bodkin',       icon: '➶',  building: 'blacksmith', ageReq: 3, cost: { energy: 200, compute: 100 }, time: 25, prereq: 'fletching', units: ARCHER, addAttack: 1, addRange: 0.5 },
  { id: 'scale_mail',   name: 'Cota de Escamas',    icon: '🛡️', building: 'blacksmith', ageReq: 2, cost: { energy: 100 },            time: 25, units: MELEE,  addArmor: 1 },
  { id: 'padded_armor', name: 'Armadura Acolchoada', icon: '🧥', building: 'blacksmith', ageReq: 2, cost: { energy: 100 },           time: 25, units: ARCHER, addArmor: 1 },

  // --- Quartel: linha da infantaria ---
  { id: 'man_at_arms',   name: 'Homem de Armas', icon: '⚔️', building: 'barracks', ageReq: 2, cost: { energy: 100, compute: 40 },  time: 30, units: ['swordsman'], addAttack: 2, addHp: 15 },
  { id: 'long_swordsman', name: 'Espada Longa',  icon: '🗡️', building: 'barracks', ageReq: 3, cost: { energy: 200, compute: 65 },  time: 35, prereq: 'man_at_arms', units: ['swordsman'], addAttack: 2, addHp: 15 },

  // --- Arquearia: linha dos arqueiros ---
  { id: 'crossbow', name: 'Besteiro', icon: '🎯', building: 'archery_range', ageReq: 3, cost: { energy: 125, compute: 75 }, time: 30, units: ['archer'], addAttack: 1, addHp: 5, addRange: 0.5 },

  // --- Estábulo: linha da cavalaria ---
  { id: 'cavalier', name: 'Cavaleiro Pesado', icon: '🐴', building: 'stable', ageReq: 3, cost: { energy: 300, compute: 300 }, time: 40, units: ['knight'], addAttack: 2, addHp: 20 },
  { id: 'paladin',  name: 'Paladino',         icon: '🏇', building: 'stable', ageReq: 4, cost: { energy: 500, compute: 350 }, time: 50, prereq: 'cavalier', units: ['knight'], addAttack: 4, addHp: 40 },

  // --- Mercado: melhorias econômicas (coleta mais rápida, mais carga) ---
  { id: 'sharp_sickles', name: 'Foices Afiadas',    icon: '🌾', building: 'market', ageReq: 2, cost: { alloys: 100 },            time: 25, units: [], gather: { energy: 0.2 } },
  { id: 'steel_axes',    name: 'Machados de Aço',   icon: '🪓', building: 'market', ageReq: 2, cost: { energy: 100 },            time: 25, units: [], gather: { alloys: 0.2 } },
  { id: 'iron_picks',    name: 'Picaretas de Ferro', icon: '⛏️', building: 'market', ageReq: 2, cost: { energy: 100, alloys: 50 }, time: 25, units: [], gather: { alloys: 0.2, compute: 0.2 } },
  { id: 'wheelbarrow',   name: 'Carrinho de Mão',   icon: '🛒', building: 'market', ageReq: 3, cost: { energy: 150, alloys: 75 },  time: 30, units: [], carry: 5 },

  // --- Centro da Cidade: defesa (torres e CC atiram mais longe / mais forte) ---
  { id: 'ballistics', name: 'Balística', icon: '📐', building: 'town_center', ageReq: 2, cost: { alloys: 150, compute: 75 },  time: 30, units: [], defense: { range: 1 } },
  { id: 'arrowslits', name: 'Frestas',   icon: '🗼', building: 'town_center', ageReq: 3, cost: { energy: 150, alloys: 100 }, time: 35, prereq: 'ballistics', units: [], defense: { attack: 3 } },
];

const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECH_DEFS.map((t) => [t.id, t]));

/** Bônus acumulado (ataque/blindagem/vida/alcance) das techs para uma unidade. */
export function techBonus(
  techs: Iterable<string>,
  type: UnitType,
): { attack: number; armor: number; hp: number; range: number } {
  let attack = 0;
  let armor = 0;
  let hp = 0;
  let range = 0;
  for (const id of techs) {
    const t = TECH_BY_ID[id];
    if (!t || !t.units.includes(type)) continue;
    attack += t.addAttack ?? 0;
    armor += t.addArmor ?? 0;
    hp += t.addHp ?? 0;
    range += t.addRange ?? 0;
  }
  return { attack, armor, hp, range };
}

/** Bônus de defesa de prédio (alcance/dano de flecha) das techs pesquisadas. */
export function defenseBonus(techs?: Iterable<string>): { attack: number; range: number } {
  let attack = 0;
  let range = 0;
  if (techs) {
    for (const id of techs) {
      const d = TECH_BY_ID[id]?.defense;
      if (d) {
        attack += d.attack ?? 0;
        range += d.range ?? 0;
      }
    }
  }
  return { attack, range };
}

/** Alcance de tiro de um prédio de defesa: base + cresce por era + pesquisas. */
export function buildingRange(type: BuildingType, age: number, techs?: Iterable<string>): number {
  const def = DEFENSE_DEFS[type];
  if (!def) return 0;
  return def.range + Math.max(0, age - 1) * DEFENSE_RANGE_PER_AGE + defenseBonus(techs).range;
}

/** Dano por flecha de um prédio de defesa: base + cresce por era + pesquisas. */
export function buildingAttack(type: BuildingType, age: number, techs?: Iterable<string>): number {
  const def = DEFENSE_DEFS[type];
  if (!def) return 0;
  return def.attack + Math.max(0, age - 1) * DEFENSE_ATTACK_PER_AGE + defenseBonus(techs).attack;
}

/** Multiplicador de coleta de um recurso com as techs econômicas (1 = normal). */
export function gatherMultiplier(techs: Iterable<string>, resource: ResourceType): number {
  let mul = 1;
  for (const id of techs) {
    const t = TECH_BY_ID[id];
    if (t?.gather?.[resource]) mul += t.gather[resource]!;
  }
  return mul;
}

/** Capacidade de carga do aldeão com as techs econômicas. */
export function carryCapacity(techs: Iterable<string>): number {
  let cap = CARRY_CAPACITY;
  for (const id of techs) {
    const t = TECH_BY_ID[id];
    if (t?.carry) cap += t.carry;
  }
  return cap;
}

// ---------- Nós de recurso ----------
export interface NodeDef {
  resource: ResourceType;
  amount: number;
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  tree:       { resource: 'alloys',  amount: 130 },
  berry_bush: { resource: 'energy',  amount: 200 },
  gold_mine:  { resource: 'compute',  amount: 650 },
  stone_mine: { resource: 'alloys', amount: 550 },
  // Banco de peixes (só no mapa Rio): MUITA comida — pesca longa, estilo AoE.
  fish:       { resource: 'energy',  amount: 450 },
};

// ---------- Ovelhas (comida do início, estilo AoE) ----------
export const SHEEP_WILD_OWNER = -1;   // dono sentinela = selvagem (branca)
export const SHEEP_FOOD = 100;        // comida por ovelha (também: fronteira "saudável ≥100 / carcaça <100")
export const SHEEP_FOOD_MAX = 150;    // teto: ovelha saudável e PARADA engorda até aqui
export const SHEEP_FATTEN_PER_S = 0.5; // comida/s ganha ao engordar parada (devagar; decay é 2/s)
export const SHEEP_CONVERT_RANGE = 3.0; // tiles: unidade mais perta que isto "rouba" a ovelha
export const SHEEP_CONVERT_EVERY_TICKS = 5; // varre conversão 2x/s (TICK_RATE=10)
export const SHEEP_SPEED = 0.7;       // tiles/s quando pastoreada (Fase 2)
export const SHEEP_DECAY_PER_S = 2;   // carcaça abandonada apodrece (comida/s) até sumir (AoE)
export const SHEEP_HERD_MIN = 2;      // rebanho perto do CV
export const SHEEP_HERD_MAX = 4;
export const SHEEP_SCATTER_CLUSTERS = 3; // grupinhos espalhados pelo mapa
export const SHEEP_SCATTER_PER_CLUSTER = 2;

// ---------- Jogadores ----------
export const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#eab308'];
