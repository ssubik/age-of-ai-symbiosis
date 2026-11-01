import type { ResourceType } from './types';

export type CommanderPersona = 'vanguard' | 'sentinel' | 'architect';
export type CommanderAutonomy = 'manual' | 'assisted' | 'autonomous';

export type StrategicObjective =
  | { kind: 'defend_area'; x: number; y: number }
  | { kind: 'attack_target'; targetId: number }
  | { kind: 'capture_zone'; x: number; y: number }
  | { kind: 'prioritize_resource'; resource: ResourceType }
  | { kind: 'prepare_offensive' }
  | { kind: 'retreat_regroup' };

export type CommanderDecisionOutcome = 'issued' | 'suggested' | 'completed' | 'superseded' | 'failed';

export interface CommanderDecision {
  id: number;
  tick: number;
  commander: CommanderPersona;
  objective: StrategicObjective['kind'];
  observation: string;
  action: string;
  reason: string;
  outcome: CommanderDecisionOutcome;
}
export interface CommanderView {
  persona: CommanderPersona;
  autonomy: CommanderAutonomy;
  objective?: StrategicObjective;
  decisions: CommanderDecision[];
}
