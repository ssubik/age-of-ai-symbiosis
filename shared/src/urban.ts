// Urban plan of a persistent Home (and of the base inside a raid view): a road
// grid anchored on the Civic Hub, shared by the server (placement rules) and
// the client (rendering, minimap, placement ghost) so they can never disagree.
//
// Every BLOCK tiles there is a ROAD_WIDTH road on both axes; the 7×7 interior
// between roads is a building plot. Nothing may be built on a road tile, so a
// footprint always sits inside exactly one plot and the city stays orderly.

import { BUILDING_DEFS } from './constants';

export const URBAN_BLOCK = 9;
export const URBAN_ROAD_WIDTH = 2;
/** Usable plot side between two roads. */
export const URBAN_PLOT = URBAN_BLOCK - URBAN_ROAD_WIDTH;

export interface UrbanPlan {
  /** First road column/row (mod URBAN_BLOCK) — derived from the Hub. */
  originX: number;
  originY: number;
}

/** Plan anchored on a Hub footprint. Matches the layout the renderer has
 *  always drawn (roads start 5 tiles before the Hub centre). */
export function urbanPlanForHub(hubTileX: number, hubTileY: number): UrbanPlan {
  const half = BUILDING_DEFS.town_center.size / 2;
  return { originX: Math.floor(hubTileX + half) - 5, originY: Math.floor(hubTileY + half) - 5 };
}

const lane = (v: number, origin: number): number => (((v - origin) % URBAN_BLOCK) + URBAN_BLOCK) % URBAN_BLOCK;

export function isRoadTile(plan: UrbanPlan, x: number, y: number): boolean {
  return lane(x, plan.originX) < URBAN_ROAD_WIDTH || lane(y, plan.originY) < URBAN_ROAD_WIDTH;
}

/** True when any tile of the footprint is road. */
export function footprintOnRoad(plan: UrbanPlan, tileX: number, tileY: number, size: number): boolean {
  for (let y = tileY; y < tileY + size; y++) {
    for (let x = tileX; x < tileX + size; x++) if (isRoadTile(plan, x, y)) return true;
  }
  return false;
}

/** Top-left tile of every plot interior that lies fully inside a map. */
export function urbanPlots(plan: UrbanPlan, mapSize: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const startX = ((plan.originX % URBAN_BLOCK) + URBAN_BLOCK) % URBAN_BLOCK + URBAN_ROAD_WIDTH;
  const startY = ((plan.originY % URBAN_BLOCK) + URBAN_BLOCK) % URBAN_BLOCK + URBAN_ROAD_WIDTH;
  for (let y = startY - URBAN_BLOCK; y + URBAN_PLOT <= mapSize; y += URBAN_BLOCK) {
    for (let x = startX - URBAN_BLOCK; x + URBAN_PLOT <= mapSize; x += URBAN_BLOCK) {
      if (x >= 0 && y >= 0) out.push({ x, y });
    }
  }
  return out;
}
