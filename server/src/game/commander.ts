import type {
  CommanderAutonomy,
  CommanderDecision,
  CommanderPersona,
  CommanderView,
  ResourceType,
  StrategicObjective,
} from '@age/shared';

export interface CommanderFacts {
  tick: number;
  core?: { id: number; x: number; y: number };
  enemyCore?: { id: number; x: number; y: number };
  recentAttack?: { x: number; y: number };
  armyReadiness: number;
  armyHealth: number;
  idleWorkers: number;
  lowestResource: ResourceType;
}
export interface CommanderEvaluation {
  decision: CommanderDecision;
  objective?: StrategicObjective;
}

interface Candidate {
  objective: StrategicObjective;
  score: number;
  observation: string;
  action: string;
  reason: string;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Deterministic, allocation-light strategic utility layer. It emits ordinary
 * objectives; Game remains responsible for validating and executing commands. */
export class CommanderBrain {
  private persona: CommanderPersona = 'vanguard';
  private autonomy: CommanderAutonomy = 'assisted';
  private order?: StrategicObjective;
  private decisions: CommanderDecision[] = [];
  private nextDecisionId = 1;
  private lastDecisionTick = -Infinity;
  private lastObjective?: StrategicObjective['kind'];

  configure(persona: CommanderPersona, autonomy: CommanderAutonomy): void {
    this.persona = persona;
    this.autonomy = autonomy;
  }

  issue(objective: StrategicObjective): void { this.order = structuredClone(objective); }
  cancel(): void { this.order = undefined; }

  view(): CommanderView {
    return {
      persona: this.persona,
      autonomy: this.autonomy,
      ...(this.order ? { objective: structuredClone(this.order) } : {}),
      decisions: this.decisions.map((decision) => ({ ...decision })),
    };
  }

  evaluate(facts: CommanderFacts, force = false): CommanderEvaluation | null {
    const isPlayerOrder = !!this.order;
    if (!isPlayerOrder && this.autonomy === 'manual') return null;
    if (!force && facts.tick - this.lastDecisionTick < 50) return null;

    const candidate = this.order
      ? this.forOrder(this.order, facts)
      : this.selectAutonomous(facts);
    if (!candidate) return null;
    this.lastDecisionTick = facts.tick;
    this.lastObjective = candidate.objective.kind;
    const executes = isPlayerOrder || this.autonomy === 'autonomous';
    const decision: CommanderDecision = {
      id: this.nextDecisionId++,
      tick: facts.tick,
      commander: this.persona,
      objective: candidate.objective.kind,
      observation: candidate.observation,
      action: candidate.action,
      reason: candidate.reason,
      outcome: executes ? 'issued' : 'suggested',
    };
    this.decisions.push(decision);
    if (this.decisions.length > 8) this.decisions.splice(0, this.decisions.length - 8);
    return { decision, ...(executes ? { objective: candidate.objective } : {}) };
  }

  private forOrder(objective: StrategicObjective, facts: CommanderFacts): Candidate {
    const labels: Record<StrategicObjective['kind'], string> = {
      defend_area: 'Secure the designated defense area',
      attack_target: 'Concentrate force on the selected target',
      capture_zone: 'Move to and hold the selected resource zone',
      prioritize_resource: 'Redirect idle economy to the selected resource',
      prepare_offensive: 'Regroup the army near the Command Core',
      retreat_regroup: 'Break contact and regroup at the Command Core',
    };
    return {
      objective,
      score: 2,
      observation: `Player strategic order received; army readiness ${Math.round(clamp01(facts.armyReadiness) * 100)}%.`,
      action: labels[objective.kind],
      reason: 'Player orders override commander initiative at every autonomy level.',
    };
  }

  private selectAutonomous(facts: CommanderFacts): Candidate | null {
    const readiness = clamp01(facts.armyReadiness);
    const health = clamp01(facts.armyHealth);
    const hysteresis = (kind: StrategicObjective['kind']): number => this.lastObjective === kind ? 0.08 : 0;
    const weights = this.persona === 'vanguard'
      ? { attack: 0.95, defend: 0.36, economy: 0.28, prepare: 0.72 }
      : this.persona === 'sentinel'
        ? { attack: 0.34, defend: 0.98, economy: 0.42, prepare: 0.58 }
        : { attack: 0.28, defend: 0.52, economy: 1.0, prepare: 0.48 };
    const candidates: Candidate[] = [];
    if (facts.core && health < 0.34) candidates.push({
      objective: { kind: 'retreat_regroup' }, score: 1.2 + (1 - health),
      observation: `Army integrity is ${Math.round(health * 100)}%.`,
      action: 'Retreat surviving combat units to the Command Core',
      reason: 'Preserving the army has higher utility than continuing a failing engagement.',
    });
    if (facts.recentAttack) candidates.push({
      objective: { kind: 'defend_area', x: facts.recentAttack.x, y: facts.recentAttack.y },
      score: weights.defend + 0.75 + hysteresis('defend_area'),
      observation: 'Hostile damage was detected inside the base perimeter.',
      action: 'Dispatch available combat units to the threatened area',
      reason: `${this.persona} policy raises defense utility during an active incursion.`,
    });
    if (facts.enemyCore) candidates.push({
      objective: { kind: 'attack_target', targetId: facts.enemyCore.id },
      score: weights.attack * readiness + hysteresis('attack_target'),
      observation: `Army readiness is ${Math.round(readiness * 100)}%; enemy Command Core is known.`,
      action: 'Pressure the enemy Command Core',
      reason: `${this.persona} policy values offensive pressure at the current force strength.`,
    });
    if (facts.core) candidates.push({
      objective: { kind: 'prepare_offensive' },
      score: weights.prepare * (1 - readiness * 0.55) + hysteresis('prepare_offensive'),
      observation: `Army readiness is ${Math.round(readiness * 100)}%.`,
      action: 'Regroup combat units near the Command Core',
      reason: 'Concentrating the force improves the next engagement.',
    });
    candidates.push({
      objective: { kind: 'prioritize_resource', resource: facts.lowestResource },
      score: weights.economy * Math.min(1, facts.idleWorkers / 3) + hysteresis('prioritize_resource'),
      observation: `${facts.idleWorkers} worker(s) are idle; ${facts.lowestResource} is the weakest stockpile.`,
      action: `Redirect idle workers to ${facts.lowestResource}`,
      reason: `${this.persona} policy uses spare labor to relieve the largest economy constraint.`,
    });
    candidates.sort((a, b) => b.score - a.score || a.objective.kind.localeCompare(b.objective.kind));
    return candidates[0]?.score > 0.05 ? candidates[0] : null;
  }
}
