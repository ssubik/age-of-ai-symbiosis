/** Pure, deterministic presentation plan for an active construction site.
 * No simulation state is created: the renderer derives this from the existing
 * building id and progress in every frame. */
export interface ConstructionFxPlan {
  active: boolean;
  human: boolean;
  robot: boolean;
  drone: boolean;
  crane: boolean;
  welding: boolean;
  phase: number;
}

export function constructionFxPlan(buildingId: number, progress: number): ConstructionFxPlan {
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 1;
  const active = p < 1;
  return {
    active,
    human: active && p >= 0.02,
    robot: active && p >= 0.12,
    drone: active && p >= 0.22,
    crane: active && p >= 0.35,
    welding: active && p >= 0.5,
    phase: ((buildingId * 0.61803398875) % 1 + 1) % 1,
  };
}
