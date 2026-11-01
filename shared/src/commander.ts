import type { ResourceType, UnitType, BuildingType } from './types';

export type CommanderPersona = 'vanguard' | 'sentinel' | 'architect';
export type CommanderAutonomy = 'manual' | 'assisted' | 'autonomous';

export type StrategicObjective =
  | { kind: 'defend_area'; x: number; y: number }
  | { kind: 'protect_core' }
  | { kind: 'attack_target'; targetId: number }
  | { kind: 'capture_zone'; x: number; y: number }
  /** `from`: take spare workers only from this (surplus) resource. */
  | { kind: 'prioritize_resource'; resource: ResourceType; from?: ResourceType }
  | { kind: 'prepare_offensive' }
  | { kind: 'retreat_regroup' };

/** Decisions are about an objective, or about spending (production). */
export type CommanderDecisionKind = StrategicObjective['kind'] | 'production';

export type CommanderDecisionOutcome = 'issued' | 'active' | 'suggested' | 'completed' | 'superseded' | 'failed';

export interface CommanderDecision {
  id: number;
  tick: number;
  commander: CommanderPersona;
  objective: CommanderDecisionKind;
  /** Who originated it: an explicit player order or commander initiative. */
  source: 'player' | 'commander';
  observation: string;
  action: string;
  reason: string;
  /** What the commander expects to happen. */
  expected: string;
  outcome: CommanderDecisionOutcome;
  /** What actually happened, once resolved. */
  result?: string;
  resolvedTick?: number;
  /** Suggestions carry the exact objective so the player can authorize it. */
  proposal?: StrategicObjective;
}

/** Player-set bounds on commander authority. All values are 0..1. */
export interface CommanderPolicy {
  /** 0 = only engage with a clear advantage; 1 = accept even fights. */
  risk: number;
  /** 0 = defensive posture; 1 = offensive posture. */
  aggression: number;
  /** Share of the current stockpile the commander may spend per production cycle. */
  spendLimit: number;
}

export const DEFAULT_POLICY: Record<CommanderPersona, CommanderPolicy> = {
  vanguard: { risk: 0.7, aggression: 0.8, spendLimit: 0.5 },
  sentinel: { risk: 0.3, aggression: 0.2, spendLimit: 0.4 },
  architect: { risk: 0.45, aggression: 0.4, spendLimit: 0.35 },
};

export interface CommanderRecord {
  decisions: number;
  playerOrders: number;
  completed: number;
  failed: number;
  superseded: number;
  suggestions: number;
  unitsQueued: number;
  structuresQueued: number;
}

export interface CommanderView {
  persona: CommanderPersona;
  autonomy: CommanderAutonomy;
  policy: CommanderPolicy;
  /** Explicit player order awaiting or under execution. */
  objective?: StrategicObjective;
  /** Objective currently being executed (player or commander sourced). */
  active?: { objective: StrategicObjective; source: 'player' | 'commander'; sinceTick: number; decisionId: number };
  decisions: CommanderDecision[];
  record: CommanderRecord;
}

// ---------------------------------------------------------------- battle report

export type MatchEventKind =
  | 'match_start' | 'first_contact' | 'unit_milestone' | 'structure_destroyed' | 'core_threatened'
  | 'age_up' | 'commander' | 'military_lead' | 'major_engagement' | 'defeat' | 'victory';

export interface MatchEvent {
  tick: number;
  kind: MatchEventKind;
  /** Player the event is about (-1 = neutral). */
  playerId: number;
  text: string;
}

export interface PlayerMatchStats {
  playerId: number;
  name: string;
  color: string;
  isBot: boolean;
  won: boolean;
  gathered: Record<ResourceType, number>;
  spent: Record<ResourceType, number>;
  unitsProduced: number;
  unitsLost: number;
  enemyUnitsKilled: number;
  structuresBuilt: number;
  structuresLost: number;
  enemyStructuresDestroyed: number;
  /** Resource zones (node clusters) under this player's structural control at the end. */
  zonesControlled: number;
  peakArmy: number;
  producedByType: Partial<Record<UnitType, number>>;
  lostByType: Partial<Record<UnitType, number>>;
  destroyedByType: Partial<Record<BuildingType, number>>;
  commander?: { persona: CommanderPersona; autonomy: CommanderAutonomy; record: CommanderRecord; decisions: CommanderDecision[] };
}

export interface MatchReport {
  durationTicks: number;
  ticksPerSecond: number;
  winnerId: number;
  players: PlayerMatchStats[];
  timeline: MatchEvent[];
  /** Army-strength samples for each player (every 10 s). */
  strength: { tick: number; values: Record<number, number> }[];
  /** Plain-language explanations of what decided the match. */
  insights: string[];
}
