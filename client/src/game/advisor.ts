export interface AdvisorObservation {
  food: number;
  wood: number;
  gold: number;
  stone: number;
  population: number;
  populationCap: number;
  villagers: number;
  age: number;
  idleVillagers: number;
  /** Symbiosis grid (optional: absent in Classic). */
  powerSupply?: number;
  powerDraw?: number;
  hasWorkshop?: boolean;
}

export type AdviceId = 'housing' | 'grid' | 'workers' | 'food' | 'wood' | 'idle' | 'advance' | 'automate' | 'steady';

export interface Advice {
  id: AdviceId;
  priority: number;
}

/** Local deterministic advisor. It observes only data already visible to the
 * player and never issues a command. First matching rule wins. */
export function recommend(obs: AdvisorObservation): Advice {
  if (obs.populationCap - obs.population <= 2) return { id: 'housing', priority: 100 };
  if ((obs.powerDraw ?? 0) > (obs.powerSupply ?? 0)) return { id: 'grid', priority: 95 };
  if (obs.villagers < 6 && obs.food >= 50) return { id: 'workers', priority: 90 };
  if (obs.food < 100) return { id: 'food', priority: 80 };
  if (obs.wood < 100) return { id: 'wood', priority: 70 };
  if (obs.idleVillagers > 0) return { id: 'idle', priority: 60 };
  if (obs.age < 4 && obs.food >= 500 && obs.gold >= 200) return { id: 'advance', priority: 50 };
  if (obs.hasWorkshop === false && obs.villagers >= 8 && obs.wood >= 150 && obs.gold >= 50) return { id: 'automate', priority: 45 };
  return { id: 'steady', priority: 10 };
}
