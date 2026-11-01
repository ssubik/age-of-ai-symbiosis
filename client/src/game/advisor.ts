export interface AdvisorObservation {
  energy: number;
  alloys: number;
  compute: number;
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

export type AdviceId = 'housing' | 'grid' | 'workers' | 'energy' | 'alloys' | 'idle' | 'advance' | 'automate' | 'steady';

export interface Advice {
  id: AdviceId;
  priority: number;
}

/** Local deterministic advisor. It observes only data already visible to the
 * player and never issues a command. First matching rule wins. */
export function recommend(obs: AdvisorObservation): Advice {
  if (obs.populationCap - obs.population <= 2) return { id: 'housing', priority: 100 };
  if ((obs.powerDraw ?? 0) > (obs.powerSupply ?? 0)) return { id: 'grid', priority: 95 };
  if (obs.villagers < 6 && obs.energy >= 50) return { id: 'workers', priority: 90 };
  if (obs.energy < 100) return { id: 'energy', priority: 80 };
  if (obs.alloys < 100) return { id: 'alloys', priority: 70 };
  if (obs.idleVillagers > 0) return { id: 'idle', priority: 60 };
  if (obs.age < 4 && obs.energy >= 500 && obs.compute >= 200) return { id: 'advance', priority: 50 };
  if (obs.hasWorkshop === false && obs.villagers >= 8 && obs.alloys >= 150 && obs.compute >= 50) return { id: 'automate', priority: 45 };
  return { id: 'steady', priority: 10 };
}
