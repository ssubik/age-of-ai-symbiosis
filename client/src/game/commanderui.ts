// Presentation vocabulary for the player-facing AI commander (panel, launcher, report).

import type { CommanderAutonomy, CommanderDecisionKind, CommanderDecisionOutcome, CommanderPersona, CommanderPolicy } from '@age/shared';
import { TICK_RATE } from '@age/shared';

export const COMMANDER_INFO: Record<CommanderPersona, { name: string; style: string; blurb: string }> = {
  vanguard: { name: 'Vanguard', style: 'AGGRESSIVE', blurb: 'Lean economy, early pressure, accepts calculated risks to strike the enemy core.' },
  sentinel: { name: 'Sentinel', style: 'DEFENSIVE', blurb: 'Fortifies with towers, answers every incursion, attacks only with a clear advantage.' },
  architect: { name: 'Architect', style: 'ECONOMIC', blurb: 'Builds drop sites and farms, advances technology first, wins with a stronger economy.' },
};

export const AUTONOMY_INFO: Record<CommanderAutonomy, string> = {
  manual: 'Acts only on your strategic orders.',
  assisted: 'Handles low-risk tasks and recommends the rest for you to authorize.',
  autonomous: 'Chooses objectives and production within your limits.',
};

export const OBJECTIVE_LABEL: Record<CommanderDecisionKind, string> = {
  defend_area: 'Defend sector',
  protect_core: 'Protect Command Core',
  attack_target: 'Attack',
  capture_zone: 'Capture zone',
  prioritize_resource: 'Worker priority',
  prepare_offensive: 'Prepare assault',
  retreat_regroup: 'Retreat and regroup',
  production: 'Production',
};

export const OUTCOME_LABEL: Record<CommanderDecisionOutcome, string> = {
  issued: 'ISSUED',
  active: 'IN PROGRESS',
  suggested: 'RECOMMENDED',
  completed: 'COMPLETED',
  superseded: 'SUPERSEDED',
  failed: 'FAILED',
};

export function clock(tick: number): string {
  const s = Math.max(0, Math.floor(tick / TICK_RATE));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** DOM handles of the commander panel (built once per match). */
export interface CommanderPanel {
  identity: HTMLElement;
  blurb: HTMLElement;
  personaBtns: Map<CommanderPersona, HTMLButtonElement>;
  autonomyBtns: Map<CommanderAutonomy, HTMLButtonElement>;
  sliders: Record<keyof CommanderPolicy, HTMLInputElement>;
  attack: HTMLButtonElement;
  active: HTMLElement;
  cancel: HTMLButtonElement;
  log: HTMLElement;
  record: HTMLElement;
  logSig: string;
}
