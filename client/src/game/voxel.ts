// Tech-diorama art kit: original modular voxel geometry for buildings, units,
// trees and props, drawn in the existing isometric Canvas projection (spec §8.4:
// keep the Canvas renderer; consistent camera, light direction and scale).
//
// Visual language (spec §8.1/§8.3): dark slate pavement, chunky blue-grey
// machine blocks with light top panels, cyan emissive strips for friendly
// energy, coral for hostile structures, bright grass plots and voxel trees.
// Light comes from the upper left: tops brightest, left faces mid, right faces
// darkest. Everything here is drawn from code; no external imagery.

import type { BuildingType, UnitType } from '@age/shared';

export interface Proj {
  px: (x: number, y: number) => number;
  py: (x: number, y: number) => number;
  /** Half tile height in screen pixels (zoom-scaled). */
  hh: number;
}

export const PAL = {
  deck: '#2b3442',
  slate: '#3d4a5c',
  steel: '#66778f',
  steelLight: '#8c9bb0',
  panel: '#b9c6d4',
  deep: '#141b25',
  glass: '#22384f',
  cyan: '#54dbe9',
  threat: '#f47975',
  amber: '#ffbe68',
  green: '#72cfa4',
  grass: '#79b84a',
  grassDark: '#4d7f32',
  leaf: ['#3f8a3a', '#4f9e43', '#62b24d', '#77c457'],
  trunk: '#6b5038',
  hazard: '#e8913a',
} as const;

/** Height of one vertical unit, in half-tile heights (roughly a cube per tile). */
const UH = 1.65;

type Pt = { x: number; y: number };

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const out = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function poly(ctx: CanvasRenderingContext2D, pts: Pt[], fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fill();
}

function corner(P: Proj, x: number, y: number, z: number): Pt {
  return { x: P.px(x, y), y: P.py(x, y) - z * P.hh * UH };
}

export interface PrismStyle {
  /** Seams every half tile on the visible faces. */
  seams?: boolean;
  /** Emissive bands at these heights above the prism base (vertical units). */
  strips?: number[];
  /** Row of lit windows at this height. */
  windows?: number;
  top?: 'plain' | 'maze' | 'grid' | 'vents' | 'solar' | 'pad' | 'grass' | 'crops';
  glass?: boolean;
  emit?: string;
  /** Wireframe only (construction framework stage). */
  wire?: string;
  alpha?: number;
}

/** One axis-aligned voxel block in world tiles. Returns the top's highest screen y. */
export function prism(
  ctx: CanvasRenderingContext2D, P: Proj,
  x: number, y: number, w: number, d: number, z: number, h: number,
  color: string, s: PrismStyle = {},
): number {
  const t = [corner(P, x, y, z + h), corner(P, x + w, y, z + h), corner(P, x + w, y + d, z + h), corner(P, x, y + d, z + h)];
  const bR = corner(P, x + w, y, z);
  const bB = corner(P, x + w, y + d, z);
  const bL = corner(P, x, y + d, z);
  const lw = Math.max(0.6, P.hh * 0.05);
  if (s.wire) {
    ctx.save();
    ctx.strokeStyle = s.wire;
    ctx.lineWidth = Math.max(1, P.hh * 0.07);
    ctx.beginPath();
    for (const [a, b] of [[bL, t[3]], [bB, t[2]], [bR, t[1]]] as [Pt, Pt][]) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.moveTo(t[0].x, t[0].y);
    for (const p of [t[1], t[2], t[3], t[0]]) ctx.lineTo(p.x, p.y);
    // Diagonal bracing reads as a modular framework, not a ghost box.
    ctx.moveTo(bL.x, bL.y); ctx.lineTo(t[2].x, t[2].y);
    ctx.moveTo(bB.x, bB.y); ctx.lineTo(t[1].x, t[1].y);
    ctx.stroke();
    ctx.restore();
    return t[0].y;
  }
  const prevAlpha = ctx.globalAlpha;
  if (s.alpha !== undefined) ctx.globalAlpha = prevAlpha * s.alpha;
  const base = s.glass ? PAL.glass : color;
  poly(ctx, [bL, bB, t[2], t[3]], shade(base, -0.06));
  poly(ctx, [bB, bR, t[1], t[2]], shade(base, -0.34));
  const topColor = s.top === 'grass' ? PAL.grass : s.top === 'solar' ? '#1f3d66' : shade(color, 0.2);
  poly(ctx, t, topColor);

  const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  const faceBand = (zz: number, th: number, col: string, inset = 0.06) => {
    const a0 = corner(P, x + inset, y + d, z + zz); const a1 = corner(P, x + w - inset, y + d, z + zz);
    const a2 = corner(P, x + w - inset, y + d, z + zz + th); const a3 = corner(P, x + inset, y + d, z + zz + th);
    poly(ctx, [a0, a1, a2, a3], col);
    const b0 = corner(P, x + w, y + d - inset, z + zz); const b1 = corner(P, x + w, y + inset, z + zz);
    const b2 = corner(P, x + w, y + inset, z + zz + th); const b3 = corner(P, x + w, y + d - inset, z + zz + th);
    poly(ctx, [b0, b1, b2, b3], shade(col, -0.18));
  };
  if (s.glass) {
    ctx.strokeStyle = 'rgba(160,220,255,.25)';
    ctx.lineWidth = lw;
    for (let k = 0.2; k < 1; k += 0.3) {
      const a = lerp(bL, bB, k); const b = lerp(t[3], t[2], k - 0.08);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  if (s.seams) {
    ctx.strokeStyle = 'rgba(20,27,37,.35)';
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let k = 0.5; k < w - 0.01; k += 0.5) { const a = corner(P, x + k, y + d, z); const b = corner(P, x + k, y + d, z + h); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    for (let k = 0.5; k < d - 0.01; k += 0.5) { const a = corner(P, x + w, y + k, z); const b = corner(P, x + w, y + k, z + h); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
  }
  if (s.windows !== undefined) {
    const col = s.emit ?? PAL.cyan;
    for (let k = 0.15; k < w - 0.2; k += 0.35) {
      const a0 = corner(P, x + k, y + d, z + s.windows); const a1 = corner(P, x + k + 0.18, y + d, z + s.windows);
      const a2 = corner(P, x + k + 0.18, y + d, z + s.windows + 0.14); const a3 = corner(P, x + k, y + d, z + s.windows + 0.14);
      poly(ctx, [a0, a1, a2, a3], shade(col, -0.15));
    }
    for (let k = 0.15; k < d - 0.2; k += 0.35) {
      const a0 = corner(P, x + w, y + k, z + s.windows); const a1 = corner(P, x + w, y + k + 0.18, z + s.windows);
      const a2 = corner(P, x + w, y + k + 0.18, z + s.windows + 0.14); const a3 = corner(P, x + w, y + k, z + s.windows + 0.14);
      poly(ctx, [a0, a1, a2, a3], shade(col, -0.4));
    }
  }
  if (s.strips) {
    const col = s.emit ?? PAL.cyan;
    for (const zz of s.strips) {
      ctx.globalAlpha = prevAlpha * (s.alpha ?? 1) * 0.35;
      faceBand(zz - 0.04, 0.16, col);
      ctx.globalAlpha = prevAlpha * (s.alpha ?? 1);
      faceBand(zz, 0.07, shade(col, 0.25));
    }
  }
  // Roof treatments.
  const inset = (k: number): Pt[] => [
    corner(P, x + k, y + k, z + h), corner(P, x + w - k, y + k, z + h),
    corner(P, x + w - k, y + d - k, z + h), corner(P, x + k, y + d - k, z + h),
  ];
  const outline = (pts: Pt[], col: string, width: number) => {
    ctx.strokeStyle = col; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath(); ctx.stroke();
  };
  const m = Math.min(w, d);
  if (s.top === 'maze') {
    for (const k of [0.1, 0.24, 0.38]) if (k * 2 < m) outline(inset(k * m), 'rgba(20,27,37,.45)', lw * 1.4);
    if (0.38 * 2 < m) outline(inset(0.31 * m), shade(s.emit ?? PAL.cyan, -0.1), lw);
  } else if (s.top === 'vents') {
    // Rooftop greebles: AC blocks and vent caps (chunky, readable at zoom).
    outline(inset(0.1), 'rgba(20,27,37,.35)', lw);
    const cells: [number, number, number, number][] = [[0.15, 0.15, 0.22, 0.22], [0.55, 0.2, 0.25, 0.18], [0.25, 0.6, 0.2, 0.2]];
    for (const [fx, fy, fw, fd] of cells) {
      if (fw * w < 0.12 || fd * d < 0.12) continue;
      prism(ctx, P, x + fx * w, y + fy * d, fw * w, fd * d, z + h, 0.14, shade(color, -0.12));
    }
  } else if (s.top === 'grid') {
    if (m > 0.4) outline(inset(0.12), 'rgba(20,27,37,.4)', lw);
  } else if (s.top === 'solar') {
    ctx.strokeStyle = 'rgba(140,190,255,.35)'; ctx.lineWidth = lw;
    ctx.beginPath();
    for (let k = 0.25; k < w; k += 0.25) { const a = corner(P, x + k, y, z + h); const b = corner(P, x + k, y + d, z + h); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
  } else if (s.top === 'pad') {
    const c = corner(P, x + w / 2, y + d / 2, z + h);
    ctx.strokeStyle = PAL.amber; ctx.lineWidth = lw * 1.6;
    ctx.beginPath(); ctx.ellipse(c.x, c.y, P.hh * w * 0.62, P.hh * d * 0.31, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (s.top === 'crops') {
    ctx.fillStyle = shade(PAL.grass, -0.25);
    for (let i = 0.2; i < w - 0.1; i += 0.3) {
      const a = corner(P, x + i, y + 0.1, z + h); const b = corner(P, x + i, y + d - 0.1, z + h);
      ctx.strokeStyle = shade(PAL.grass, -0.3); ctx.lineWidth = Math.max(1, P.hh * 0.12);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgba(14,19,27,.5)';
  ctx.lineWidth = lw;
  outline(t, 'rgba(14,19,27,.5)', lw);
  ctx.beginPath(); ctx.moveTo(bL.x, bL.y); ctx.lineTo(bB.x, bB.y); ctx.lineTo(bR.x, bR.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bB.x, bB.y); ctx.lineTo(t[2].x, t[2].y); ctx.stroke();
  ctx.globalAlpha = prevAlpha;
  return t[0].y;
}

// ---------------------------------------------------------------- buildings

interface Op {
  key: number;
  /** The deck plate: the only thing drawn during the foundation stage. */
  deck?: boolean;
  draw: (stage: Stage) => number | void;
}

/** Construction stages (spec §3.4), from authoritative normalized progress. */
export type Stage = 'foundation' | 'frame' | 'walls' | 'powerup' | 'complete';
export function constructionStage(progress: number): Stage {
  if (!Number.isFinite(progress) || progress >= 1) return 'complete';
  if (progress < 0.15) return 'foundation';
  if (progress < 0.55) return 'frame';
  if (progress < 0.9) return 'walls';
  return 'powerup';
}

export interface BuildingArt {
  type: BuildingType;
  size: number;
  /** World tile of the footprint's back corner. */
  tileX: number;
  tileY: number;
  progress: number;
  /** Friendly = cyan energy; hostile = coral. */
  emit: string;
  team: string;
  now: number;
  /** Rotating beacon / animated parts on targets. */
  targetLocked?: boolean;
  /** Building level (the Hub grows tiers with City Level). */
  level?: number;
}

/** Draws a building from modular voxel parts. Returns the top screen y. */
export function drawBuildingArt(ctx: CanvasRenderingContext2D, P: Proj, a: BuildingArt): number {
  const s = a.size;
  const ox = a.tileX;
  const oy = a.tileY;
  const stage = constructionStage(a.progress);
  const wallsK = stage === 'walls' ? Math.max(0.15, (a.progress - 0.55) / 0.35) : 1;
  // Chunky proportions: bigger footprints stand taller.
  const hs = s >= 3 ? 1.5 : s === 2 ? 1.25 : 1.05;
  const level = Math.max(1, a.level ?? 1);
  const ops: Op[] = [];
  let top = P.py(ox, oy);
  const emit = a.emit;

  /** Block in footprint fractions (x,y,w,d of s) with absolute heights. */
  const B = (fx: number, fy: number, fw: number, fd: number, z: number, h: number, color: string, style: PrismStyle = {}, deck = false) => {
    const x = ox + fx * s; const y = oy + fy * s; const w = fw * s; const d = fd * s;
    ops.push({
      deck,
      key: deck ? -Infinity : x + w / 2 + y + d / 2 + z * 0.05,
      draw: (st) => {
        const zz = z * hs;
        let hh2 = h * hs;
        if (st === 'frame') return prism(ctx, P, x, y, w, d, zz, hh2, color, { wire: 'rgba(255,190,104,.85)' });
        if (st === 'walls') {
          const solid = Math.max(0.05, hh2 * wallsK);
          const t = prism(ctx, P, x, y, w, d, zz, solid, color, { ...style, strips: undefined, windows: undefined, top: style.top === 'grass' ? 'grass' : 'plain' });
          if (solid < hh2) prism(ctx, P, x, y, w, d, zz + solid, hh2 - solid, color, { wire: 'rgba(255,190,104,.7)' });
          return t;
        }
        const lit = st === 'powerup' ? { ...style, emit: PAL.amber } : style;
        hh2 = Math.max(0.02, hh2);
        return prism(ctx, P, x, y, w, d, zz, hh2, color, { ...lit, emit: lit.emit ?? emit });
      },
    });
  };
  /** Free-form detail drawn after blocks (antennas, blades, arms...). */
  const F = (fx: number, fy: number, fn: (st: Stage) => number | void) => {
    ops.push({ key: ox + fx * s + oy + fy * s + 99, draw: (st) => (st === 'complete' || st === 'powerup' ? fn(st) : undefined) });
  };
  const at = (fx: number, fy: number, z: number): Pt => corner(P, ox + fx * s, oy + fy * s, z * hs);
  const line = (p: Pt, q: Pt, col: string, w: number) => {
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, P.hh * w); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.lineCap = 'butt';
  };
  const dot = (p: Pt, r: number, col: string) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(p.x, p.y, P.hh * r, P.hh * r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
  };
  const pulse = 0.55 + 0.45 * Math.sin(a.now / 380 + ox * 1.7 + oy);

  // Every structure sits on a deck plate (foundation stage shows only this).
  B(0.03, 0.03, 0.94, 0.94, 0, 0.12, PAL.deck, {}, true);

  switch (a.type) {
    case 'town_center': {
      // Tiered command block with maze-patterned roofs and a luminous core.
      // City Level adds visible mass: taller corner towers (L2), an extra tier
      // (L3), side pylons (L4) and a crown beacon (L5).
      const towerH = 1.2 + (level >= 2 ? 0.45 : 0);
      for (const [fx, fy] of [[0.06, 0.06], [0.72, 0.06], [0.06, 0.72], [0.72, 0.72]]) B(fx, fy, 0.22, 0.22, 0.12, towerH, PAL.slate, { seams: true, strips: [0.95, ...(level >= 2 ? [1.4] : [])] });
      B(0.12, 0.12, 0.76, 0.76, 0.12, 0.85, PAL.steel, { seams: true, strips: [0.45], top: 'maze' });
      B(0.26, 0.26, 0.48, 0.48, 0.97, 0.55, PAL.steelLight, { seams: true, windows: 0.18, top: 'maze' });
      let coreZ = 1.52;
      if (level >= 3) { B(0.32, 0.32, 0.36, 0.36, 1.52, 0.4, PAL.steel, { seams: true, strips: [0.2], top: 'maze' }); coreZ = 1.92; }
      B(0.4, 0.4, 0.2, 0.2, coreZ, 0.45, PAL.glass, { glass: true, strips: [0.3] });
      if (level >= 4) for (const [fx, fy] of [[0.46, 0.0], [0.0, 0.46], [0.92, 0.46], [0.46, 0.92]]) B(fx, fy, 0.08, 0.08, 0.12, 1.9, PAL.panel, { strips: [1.6] });
      const crownZ = coreZ + 0.45;
      F(0.5, 0.5, () => {
        const base = at(0.5, 0.5, crownZ);
        const tip = { x: base.x, y: base.y - P.hh * 2.2 };
        line(base, tip, PAL.panel, 0.12);
        const beam = Math.sin(a.now / 600);
        dot(tip, 0.22, emit);
        ctx.globalAlpha = 0.35 * pulse;
        dot(tip, level >= 5 ? 0.95 : 0.55, emit);
        ctx.globalAlpha = 1;
        line(tip, { x: tip.x + beam * P.hh * 1.6, y: tip.y + Math.abs(beam) * P.hh * 0.5 }, `rgba(84,219,233,${0.4 * pulse})`, 0.08);
        return tip.y - P.hh * 0.3;
      });
      break;
    }
    case 'house':
      B(0.12, 0.15, 0.74, 0.7, 0.12, 0.7, PAL.steelLight, { seams: true, windows: 0.3, top: 'grid' });
      B(0.3, 0.32, 0.4, 0.36, 0.82, 0.22, PAL.steel, { top: 'vents' });
      F(0.75, 0.25, () => { dot(at(0.75, 0.25, 0.86), 0.08, emit); });
      break;
    case 'farm':
      // Vertical cultivation beds on a green plot.
      B(0.06, 0.06, 0.88, 0.88, 0.12, 0.06, PAL.grassDark, { top: 'grass' });
      for (let i = 0; i < 3; i++) B(0.14 + i * 0.27, 0.14, 0.18, 0.72, 0.18, 0.28, '#4f9e43', { top: 'crops' });
      F(0.92, 0.5, () => { line(at(0.92, 0.1, 0.2), at(0.92, 0.9, 0.2), PAL.cyan, 0.06); });
      break;
    case 'mill':
      // Food technology: twin greenhouse pods beside a cultivation bank.
      B(0.08, 0.1, 0.4, 0.8, 0.12, 0.75, '#5d9a74', { glass: true, strips: [0.55], top: 'grid' });
      B(0.55, 0.12, 0.36, 0.36, 0.12, 0.5, PAL.panel, { top: 'grid' });
      B(0.55, 0.55, 0.36, 0.36, 0.12, 0.5, PAL.panel, { top: 'grid' });
      F(0.73, 0.3, () => { const c = at(0.73, 0.3, 0.62); ctx.globalAlpha = 0.5 + 0.3 * pulse; dot(c, 0.28, '#9be37a'); ctx.globalAlpha = 1; });
      F(0.73, 0.73, () => { const c = at(0.73, 0.73, 0.62); ctx.globalAlpha = 0.5 + 0.3 * pulse; dot(c, 0.28, '#9be37a'); ctx.globalAlpha = 1; });
      break;
    case 'lumber_camp': {
      // Materials depot: low loading dock with stacked crate modules.
      B(0.08, 0.08, 0.84, 0.5, 0.12, 0.42, PAL.slate, { seams: true, strips: [0.3], emit: PAL.amber });
      const crates = ['#8a6a46', '#5b7790', '#8a6a46', '#a67c48'];
      for (let i = 0; i < 4; i++) B(0.12 + (i % 2) * 0.4, 0.64 + Math.floor(i / 2) * 0.0, 0.32, 0.28, 0.12 + Math.floor(i / 2) * 0.3, 0.3, crates[i], { seams: true });
      break;
    }
    case 'mining_camp':
      // Storage: silos with fill-level lights and a conveyor.
      for (let i = 0; i < 3; i++) B(0.08 + i * 0.3, 0.12, 0.24, 0.24, 0.12, 1.15, PAL.panel, { strips: [0.35, 0.7], emit: PAL.amber, top: 'grid' });
      B(0.08, 0.58, 0.84, 0.3, 0.12, 0.35, PAL.steel, { seams: true });
      break;
    case 'solar_array':
      for (let i = 0; i < 2; i++) B(0.08 + i * 0.46, 0.1, 0.4, 0.8, 0.12, 0.18 + i * 0.06, PAL.slate, { top: 'solar' });
      break;
    case 'wind_turbine':
      B(0.38, 0.38, 0.24, 0.24, 0.12, 2.6, PAL.panel);
      F(0.5, 0.5, () => {
        const hub = at(0.5, 0.5, 2.75);
        const spin = a.now / 260;
        for (let k = 0; k < 3; k++) {
          const ang = spin + (k * Math.PI * 2) / 3;
          line(hub, { x: hub.x + Math.cos(ang) * P.hh * 2.1, y: hub.y + Math.sin(ang) * P.hh * 2.1 }, PAL.panel, 0.14);
        }
        dot(hub, 0.18, emit);
        return hub.y - P.hh * 2.1;
      });
      break;
    case 'robotics_workshop':
      // Low workshop with an oversized articulated arm.
      B(0.06, 0.2, 0.88, 0.7, 0.12, 0.75, PAL.steel, { seams: true, strips: [0.5], emit: PAL.hazard, top: 'vents' });
      B(0.06, 0.06, 0.4, 0.16, 0.12, 0.45, PAL.slate, {});
      F(0.3, 0.45, () => {
        const sw = Math.sin(a.now / 700) * 0.12;
        const p0 = at(0.3, 0.45, 0.87); const p1 = at(0.3 + sw, 0.3, 1.9); const p2 = at(0.55 + sw, 0.15, 1.5);
        line(p0, p1, PAL.amber, 0.28); line(p1, p2, PAL.amber, 0.22);
        dot(p1, 0.18, PAL.slate); dot(p2, 0.14, emit);
        if (Math.sin(a.now / 90) > 0.4) dot(p2, 0.3, 'rgba(255,236,180,.7)');
        return p1.y - P.hh * 0.3;
      });
      break;
    case 'design_studio':
      B(0.15, 0.15, 0.7, 0.7, 0.12, 1.5, PAL.glass, { glass: true, strips: [0.4, 1.0], top: 'grid' });
      break;
    case 'data_center':
      for (let i = 0; i < 2; i++) B(0.08 + i * 0.44, 0.1, 0.38, 0.8, 0.12, 0.9, PAL.slate, { seams: true, windows: 0.25, top: 'vents' });
      break;
    case 'elon_vault':
      B(0.1, 0.1, 0.8, 0.8, 0.12, 0.9, '#55606f', { seams: true, strips: [0.15, 0.7], top: 'maze' });
      F(0.5, 0.9, () => { const c = at(0.55, 0.92, 0.5); ctx.strokeStyle = emit; ctx.lineWidth = Math.max(1.5, P.hh * 0.12); ctx.beginPath(); ctx.ellipse(c.x, c.y, P.hh * 0.6, P.hh * 0.55, 0, 0, Math.PI * 2); ctx.stroke(); });
      break;
    case 'army_camp':
      // Grid of docking pads with charging pylons.
      for (const [fx, fy] of [[0.08, 0.08], [0.52, 0.08], [0.08, 0.52], [0.52, 0.52]]) B(fx, fy, 0.4, 0.4, 0.12, 0.08, PAL.slate, { top: 'pad' });
      for (const [fx, fy] of [[0.47, 0.03], [0.03, 0.47], [0.91, 0.47], [0.47, 0.91]]) B(fx, fy, 0.06, 0.06, 0.12, 0.9, PAL.panel, { strips: [0.75] });
      break;
    case 'drone_factory':
      // Twin assembly lanes, big doors, rooftop vents.
      for (let i = 0; i < 2; i++) B(0.06 + i * 0.47, 0.06, 0.41, 0.88, 0.12, 0.95, PAL.steel, { seams: true, strips: [0.75], top: 'vents' });
      F(0.3, 0.94, () => {
        for (const fx of [0.15, 0.62]) {
          const p0 = at(fx, 0.94, 0.15); const p1 = at(fx + 0.24, 0.94, 0.15); const p2 = at(fx + 0.24, 0.94, 0.75); const p3 = at(fx, 0.94, 0.75);
          poly(ctx, [p0, p1, p2, p3], PAL.deep);
          ctx.strokeStyle = emit; ctx.lineWidth = Math.max(1, P.hh * 0.06);
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
      });
      break;
    case 'mech_forge':
      // Broad heavy hangar under a gantry, forge heat at the door.
      B(0.06, 0.18, 0.88, 0.76, 0.12, 1.0, '#4d5868', { seams: true, strips: [0.25], emit: PAL.hazard, top: 'grid' });
      F(0.5, 0.5, () => {
        const c0 = at(0.1, 0.1, 0.12); const c1 = at(0.1, 0.1, 1.7); const c2 = at(0.9, 0.1, 0.12); const c3 = at(0.9, 0.1, 1.7);
        line(c0, c1, PAL.amber, 0.22); line(c2, c3, PAL.amber, 0.22); line(c1, c3, PAL.amber, 0.26);
        const k = (Math.sin(a.now / 1500) + 1) / 2;
        const hook = at(0.1 + 0.8 * k, 0.1, 1.7);
        line(hook, { x: hook.x, y: hook.y + P.hh * 1.2 }, PAL.panel, 0.06);
        poly(ctx, [{ x: hook.x - P.hh * 0.3, y: hook.y + P.hh * 1.2 }, { x: hook.x + P.hh * 0.3, y: hook.y + P.hh * 1.2 }, { x: hook.x + P.hh * 0.3, y: hook.y + P.hh * 1.6 }, { x: hook.x - P.hh * 0.3, y: hook.y + P.hh * 1.6 }], PAL.steelLight);
        return c1.y;
      });
      break;
    case 'aerospace_hangar':
      // Wide wing-shaped roof over the bay, runway pad in front.
      B(0.04, 0.1, 0.92, 0.65, 0.12, 0.55, PAL.steel, { seams: true, strips: [0.4] });
      B(0.0, 0.18, 1.0, 0.5, 0.67, 0.18, PAL.panel, { top: 'grid' });
      B(0.06, 0.78, 0.88, 0.18, 0.12, 0.03, PAL.deep, {});
      F(0.5, 0.87, () => { line(at(0.1, 0.87, 0.16), at(0.9, 0.87, 0.16), 'rgba(255,255,255,.75)', 0.05); });
      break;
    case 'missile_foundry':
      B(0.06, 0.3, 0.88, 0.62, 0.12, 0.8, PAL.steel, { seams: true, strips: [0.55], top: 'vents' });
      for (let i = 0; i < 3; i++) {
        B(0.12 + i * 0.28, 0.08, 0.12, 0.12, 0.12, 1.4, PAL.panel, {});
        F(0.18 + i * 0.28, 0.14, () => { const tip = at(0.18 + i * 0.28, 0.14, 1.52); dot(tip, 0.14, PAL.threat); return tip.y; });
      }
      break;
    case 'exosuit_lab':
      B(0.06, 0.06, 0.88, 0.88, 0.12, 0.6, PAL.steel, { seams: true, strips: [0.4] });
      B(0.3, 0.3, 0.4, 0.4, 0.72, 1.6, PAL.glass, { glass: true, strips: [0.5, 1.2], top: 'maze' });
      F(0.5, 0.5, () => { const c = at(0.5, 0.5, 1.6); ctx.strokeStyle = emit; ctx.lineWidth = Math.max(1, P.hh * 0.1); ctx.beginPath(); ctx.ellipse(c.x, c.y, P.hh * 1.5, P.hh * 0.75, 0, 0, Math.PI * 2); ctx.stroke(); });
      break;
    case 'watch_tower':
      B(0.28, 0.28, 0.44, 0.44, 0.12, 2.0, PAL.steel, { seams: true, strips: [1.4] });
      B(0.1, 0.1, 0.8, 0.8, 2.12, 0.28, PAL.steelLight, { top: 'grid' });
      F(0.5, 0.5, () => { const c = at(0.5, 0.5, 2.45); dot(c, 0.15, a.targetLocked ? PAL.threat : emit); return c.y; });
      break;
    case 'wall':
      B(0.05, 0.25, 0.9, 0.5, 0.12, 0.65, PAL.slate, { seams: true, strips: [0.45] });
      B(0.1, 0.32, 0.8, 0.36, 0.77, 0.12, PAL.steel, {});
      break;
    case 'barracks':
      B(0.06, 0.08, 0.6, 0.84, 0.12, 0.8, PAL.steel, { seams: true, windows: 0.4, top: 'vents' });
      B(0.7, 0.08, 0.24, 0.84, 0.12, 0.05, PAL.deck, { top: 'pad' });
      break;
    case 'archery_range':
      B(0.06, 0.06, 0.88, 0.3, 0.12, 0.6, PAL.steel, { seams: true, strips: [0.4] });
      for (let i = 0; i < 3; i++) B(0.12 + i * 0.28, 0.5, 0.16, 0.38, 0.12, 0.04, PAL.deep, {});
      break;
    case 'stable':
      B(0.06, 0.1, 0.88, 0.6, 0.12, 0.6, PAL.steel, { seams: true, strips: [0.3], top: 'grid' });
      B(0.1, 0.74, 0.8, 0.2, 0.12, 0.04, PAL.deep, { top: 'pad' });
      break;
    case 'blacksmith':
      B(0.08, 0.1, 0.84, 0.8, 0.12, 0.7, '#4d5868', { seams: true, strips: [0.3], emit: PAL.hazard });
      B(0.62, 0.15, 0.2, 0.2, 0.82, 0.7, PAL.slate, {});
      break;
    case 'market':
      for (let i = 0; i < 2; i++) B(0.08 + i * 0.46, 0.2, 0.38, 0.6, 0.12, 0.45, PAL.panel, { windows: 0.15 });
      B(0.05, 0.15, 0.9, 0.7, 0.57, 0.08, PAL.amber, {});
      break;
    case 'point_turret':
    case 'anti_air':
    case 'sensor_tower':
    case 'dock':
      // Drawn by their dedicated procedural painters (already in this style).
      break;
  }

  ops.sort((p, q) => p.key - q.key);
  for (const op of ops) {
    // Foundation stage: only the deck plate (first op is always the deck).
    if (stage === 'foundation' && !op.deck) continue;
    const y = op.draw(stage);
    if (typeof y === 'number') top = Math.min(top, y);
  }
  if (stage === 'foundation') {
    // Excavation corner lights.
    for (const [fx, fy] of [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]]) {
      const c = at(fx, fy, 0.14);
      ctx.fillStyle = `rgba(255,190,104,${0.5 + 0.5 * pulse})`;
      ctx.beginPath(); ctx.ellipse(c.x, c.y, P.hh * 0.12, P.hh * 0.09, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  return top;
}

/** Types whose art comes from this kit (the rest keep their own painters). */
export function hasVoxelArt(type: BuildingType): boolean {
  return !['point_turret', 'anti_air', 'sensor_tower', 'dock'].includes(type);
}

// ---------------------------------------------------------------- props

/** Voxel tree: slim trunk with stacked leaf cubes, varied by tile hash. */
export function drawVoxelTree(ctx: CanvasRenderingContext2D, P: Proj, tx: number, ty: number, hash: number): number {
  const cx = tx + 0.5; const cy = ty + 0.5;
  prism(ctx, P, cx - 0.06, cy - 0.06, 0.12, 0.12, 0, 0.55, PAL.trunk);
  const tall = 0.7 + hash * 0.6;
  const shades = PAL.leaf;
  const c0 = shades[Math.floor(hash * 4) % 4];
  let top = prism(ctx, P, cx - 0.36, cy - 0.36, 0.72, 0.72, 0.45, tall, c0, {});
  top = Math.min(top, prism(ctx, P, cx - 0.24, cy - 0.24, 0.48, 0.48, 0.45 + tall, 0.45, shades[(Math.floor(hash * 4) + 1) % 4]));
  if (hash > 0.55) top = Math.min(top, prism(ctx, P, cx - 0.12, cy - 0.12, 0.24, 0.24, 0.9 + tall, 0.3, shades[3]));
  return top;
}

export function drawVoxelMine(ctx: CanvasRenderingContext2D, P: Proj, tx: number, ty: number, kind: 'gold' | 'stone', hash: number): void {
  const base = kind === 'gold' ? '#e2b33c' : '#8f9aa6';
  const rock = '#5a6370';
  prism(ctx, P, tx + 0.08, ty + 0.1, 0.5, 0.45, 0, 0.35, rock, {});
  prism(ctx, P, tx + 0.45, ty + 0.4, 0.42, 0.4, 0, 0.28 + hash * 0.2, base, {});
  prism(ctx, P, tx + 0.18, ty + 0.55, 0.3, 0.3, 0, 0.22, shade(base, -0.15), {});
}

export function drawVoxelBush(ctx: CanvasRenderingContext2D, P: Proj, tx: number, ty: number): void {
  prism(ctx, P, tx + 0.18, ty + 0.18, 0.64, 0.64, 0, 0.42, PAL.leaf[1]);
  for (const [dx, dy] of [[0.3, 0.75], [0.6, 0.78], [0.8, 0.5]]) {
    const c = corner(P, tx + dx, ty + dy, 0.3);
    ctx.fillStyle = '#e14b52'; ctx.fillRect(c.x - P.hh * 0.08, c.y - P.hh * 0.08, P.hh * 0.16, P.hh * 0.16);
  }
}

// ---------------------------------------------------------------- units

/** Screen-space voxel block for small figures: `a` along the iso x axis, `b`
 *  along the iso y axis, `h` up, all in pixels; (cx, cy) is the base centre. */
function sbox(ctx: CanvasRenderingContext2D, cx: number, cy: number, a: number, b: number, h: number, color: string, lift = 0): number {
  const ax = a / 2; const ay = a / 4; const bx = -b / 2; const by = b / 4;
  const base = (sa: number, sb: number, z: number): Pt => ({ x: cx + sa * ax + sb * bx, y: cy + sa * ay + sb * by - z });
  const L0 = base(-1, 1, lift); const B0 = base(1, 1, lift); const R0 = base(1, -1, lift);
  const T = base(-1, -1, lift + h); const R = base(1, -1, lift + h); const Bt = base(1, 1, lift + h); const Lt = base(-1, 1, lift + h);
  poly(ctx, [L0, B0, Bt, Lt], shade(color, -0.06));
  poly(ctx, [B0, R0, R, Bt], shade(color, -0.34));
  poly(ctx, [T, R, Bt, Lt], shade(color, 0.22));
  ctx.strokeStyle = 'rgba(14,19,27,.45)'; ctx.lineWidth = 0.75;
  ctx.beginPath(); ctx.moveTo(T.x, T.y); ctx.lineTo(R.x, R.y); ctx.lineTo(Bt.x, Bt.y); ctx.lineTo(Lt.x, Lt.y); ctx.closePath(); ctx.stroke();
  return T.y;
}

export interface UnitArt {
  type: UnitType;
  sx: number;
  sy: number;
  /** Unit scale in pixels (about one figure height / 2). */
  U: number;
  team: string;
  /** +1 faces screen-right, -1 screen-left. */
  face: 1 | -1;
  now: number;
  id: number;
  moving: boolean;
  attacking: boolean;
}

/** Voxel figures for every land/air unit. Returns false for types it does not draw. */
export function drawUnitArt(ctx: CanvasRenderingContext2D, u: UnitArt): boolean {
  const { sx, sy, U, team, now, id } = u;
  const walk = u.moving ? Math.sin(now / 90 + id) : 0;
  const hover = Math.sin(now / 260 + id) * U * 0.12;
  const flip = (fn: () => void) => {
    ctx.save();
    if (u.face === -1) { ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.translate(-sx, 0); }
    fn();
    ctx.restore();
  };
  const light = (x: number, y: number, r: number, col: string) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
  };
  switch (u.type) {
    case 'villager':
    case 'designer':
    case 'swordsman':
    case 'archer': {
      // Small operator / infantry: legs, torso in team colour, helmeted head.
      const legs = U * 0.55;
      sbox(ctx, sx - U * 0.12, sy, U * 0.18, U * 0.18, legs + walk * U * 0.06, '#3a4452');
      sbox(ctx, sx + U * 0.12, sy, U * 0.18, U * 0.18, legs - walk * U * 0.06, '#3a4452');
      const body = u.type === 'designer' ? '#d9e3ea' : team;
      sbox(ctx, sx, sy, U * 0.5, U * 0.32, U * 0.55, body, legs);
      if (u.type === 'designer') sbox(ctx, sx - U * 0.05, sy - U * 0.2, U * 0.36, U * 0.2, U * 0.4, PAL.amber, legs + U * 0.08);
      sbox(ctx, sx, sy, U * 0.34, U * 0.34, U * 0.32, PAL.panel, legs + U * 0.55);
      light(sx + U * 0.1, sy - legs - U * 0.73, U * 0.06, u.type === 'designer' ? PAL.cyan : '#222');
      if (u.type === 'swordsman') flip(() => { ctx.strokeStyle = PAL.cyan; ctx.lineWidth = Math.max(1.5, U * 0.1); ctx.beginPath(); ctx.moveTo(sx + U * 0.3, sy - legs - U * 0.3); ctx.lineTo(sx + U * 0.75, sy - legs - U * 0.9); ctx.stroke(); });
      if (u.type === 'archer') flip(() => sbox(ctx, sx + U * 0.4, sy - U * 0.1, U * 0.6, U * 0.1, U * 0.1, '#2b3442', legs + U * 0.3));
      return true;
    }
    case 'knight':
      // Hover-bike rider.
      sbox(ctx, sx, sy - hover, U * 1.2, U * 0.5, U * 0.35, PAL.steel, U * 0.3);
      sbox(ctx, sx, sy - hover, U * 0.4, U * 0.3, U * 0.5, team, U * 0.65);
      sbox(ctx, sx, sy - hover, U * 0.3, U * 0.3, U * 0.28, PAL.panel, U * 1.15);
      light(sx - U * 0.55, sy - U * 0.4 - hover, U * 0.12, PAL.cyan);
      return true;
    case 'robot': {
      // Builder Robot: wide shoulders, big manipulator arms, heavy feet.
      const step = u.moving ? Math.abs(walk) * U * 0.08 : 0;
      sbox(ctx, sx - U * 0.22, sy, U * 0.3, U * 0.34, U * 0.4 + step, '#3a4452');
      sbox(ctx, sx + U * 0.22, sy, U * 0.3, U * 0.34, U * 0.4 + U * 0.08 - step, '#3a4452');
      sbox(ctx, sx, sy, U * 0.9, U * 0.55, U * 0.65, PAL.amber, U * 0.4);
      sbox(ctx, sx, sy, U * 0.42, U * 0.4, U * 0.3, PAL.panel, U * 1.05);
      light(sx + U * 0.12, sy - U * 1.22, U * 0.07, PAL.cyan);
      sbox(ctx, sx - U * 0.6, sy, U * 0.22, U * 0.26, U * 0.65, PAL.steel, U * 0.35);
      sbox(ctx, sx + U * 0.6, sy, U * 0.22, U * 0.26, U * 0.65, PAL.steel, U * 0.35);
      light(sx + U * 0.25, sy - U * 0.72, U * 0.1, team);
      return true;
    }
    case 'drone': {
      // Construction Drone: compact hull on four rotor rings.
      const y = sy - U * 1.1 - hover;
      for (const [dx, dy] of [[-0.55, -0.15], [0.55, -0.15], [-0.35, 0.18], [0.35, 0.18]]) {
        ctx.strokeStyle = 'rgba(201,212,223,.8)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(sx + dx * U, y + dy * U, U * 0.28, U * 0.11, 0, 0, Math.PI * 2); ctx.stroke();
      }
      sbox(ctx, sx, y + U * 0.15, U * 0.55, U * 0.45, U * 0.25, PAL.panel);
      light(sx, y - U * 0.12, U * 0.09, team);
      return true;
    }
    case 'attack_drone': {
      // Small angular X body with two strong light nodes.
      const y = sy - U * 1.3 - hover;
      ctx.strokeStyle = '#2b3442'; ctx.lineWidth = Math.max(2, U * 0.16); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx - U * 0.55, y - U * 0.18); ctx.lineTo(sx + U * 0.55, y + U * 0.18);
      ctx.moveTo(sx - U * 0.55, y + U * 0.18); ctx.lineTo(sx + U * 0.55, y - U * 0.18); ctx.stroke(); ctx.lineCap = 'butt';
      sbox(ctx, sx, y + U * 0.12, U * 0.38, U * 0.38, U * 0.22, PAL.panel);
      light(sx - U * 0.55, y - U * 0.18, U * 0.1, team); light(sx + U * 0.55, y + U * 0.18, U * 0.1, PAL.cyan);
      return true;
    }
    case 'fighter':
      // Delta wing, sharp nose, engine glow — points along its heading.
      flip(() => {
        const y = sy - U * 1.6 - hover;
        poly(ctx, [{ x: sx + U * 1.1, y }, { x: sx - U * 0.7, y: y - U * 0.55 }, { x: sx - U * 0.45, y }, { x: sx - U * 0.7, y: y + U * 0.55 }], PAL.panel);
        poly(ctx, [{ x: sx + U * 1.1, y }, { x: sx - U * 0.45, y }, { x: sx - U * 0.7, y: y + U * 0.55 }], shade(PAL.panel, -0.3));
        poly(ctx, [{ x: sx + U * 0.55, y: y - U * 0.04 }, { x: sx + U * 0.15, y: y - U * 0.12 }, { x: sx + U * 0.15, y: y + U * 0.04 }], PAL.glass);
        light(sx - U * 0.55, y, U * 0.12, PAL.cyan);
        poly(ctx, [{ x: sx - U * 0.2, y: y - U * 0.3 }, { x: sx - U * 0.45, y: y - U * 0.3 }, { x: sx - U * 0.4, y: y - U * 0.15 }], team);
      });
      return true;
    case 'stealth_bomber':
      // Broad dark flying wing; slow, heavy.
      flip(() => {
        const y = sy - U * 1.8 - hover * 0.5;
        poly(ctx, [{ x: sx + U * 0.9, y }, { x: sx - U * 0.6, y: y - U * 1.0 }, { x: sx - U * 0.3, y: y }, { x: sx - U * 0.6, y: y + U * 1.0 }], '#2a313d');
        poly(ctx, [{ x: sx + U * 0.9, y }, { x: sx - U * 0.3, y }, { x: sx - U * 0.6, y: y + U * 1.0 }], '#1c222b');
        light(sx - U * 0.42, y - U * 0.45, U * 0.08, PAL.threat); light(sx - U * 0.42, y + U * 0.45, U * 0.08, team);
      });
      return true;
    case 'rocket_launcher':
      // Narrow tracked platform with a raised missile rack.
      flip(() => {
        sbox(ctx, sx, sy, U * 1.2, U * 0.6, U * 0.3, '#2b3442');
        sbox(ctx, sx, sy, U * 1.0, U * 0.5, U * 0.25, PAL.steel, U * 0.3);
        sbox(ctx, sx - U * 0.2, sy, U * 0.6, U * 0.45, U * 0.45, team, U * 0.55);
        for (let i = 0; i < 3; i++) light(sx + U * 0.05 + i * U * 0.12, sy - U * 1.05 - i * U * 0.04, U * 0.07, PAL.threat);
      });
      return true;
    case 'siege_mech': {
      // Chunky walker with an oversized breaching arm.
      const step = u.moving ? walk * U * 0.12 : 0;
      flip(() => {
        sbox(ctx, sx - U * 0.3, sy, U * 0.3, U * 0.35, U * 0.6 + step, '#2b3442');
        sbox(ctx, sx + U * 0.3, sy, U * 0.3, U * 0.35, U * 0.6 - step, '#2b3442');
        sbox(ctx, sx, sy, U * 1.0, U * 0.7, U * 0.7, PAL.steel, U * 0.6);
        sbox(ctx, sx, sy, U * 0.5, U * 0.4, U * 0.3, team, U * 1.3);
        const punch = u.attacking ? Math.max(0, Math.sin(now / 160 + id)) * U * 0.3 : 0;
        sbox(ctx, sx + U * 0.75 + punch, sy, U * 0.6, U * 0.45, U * 0.45, PAL.amber, U * 0.75);
        light(sx + U * 0.2, sy - U * 1.45, U * 0.08, PAL.cyan);
      });
      return true;
    }
    case 'plasma_tank':
      // Wide tracked hull, one oversized energy barrel.
      flip(() => {
        sbox(ctx, sx, sy, U * 1.5, U * 0.9, U * 0.32, '#2b3442');
        sbox(ctx, sx, sy, U * 1.3, U * 0.8, U * 0.3, PAL.steel, U * 0.32);
        sbox(ctx, sx - U * 0.1, sy, U * 0.6, U * 0.55, U * 0.32, team, U * 0.62);
        ctx.strokeStyle = PAL.steelLight; ctx.lineWidth = Math.max(2.5, U * 0.2);
        ctx.beginPath(); ctx.moveTo(sx + U * 0.1, sy - U * 0.82); ctx.lineTo(sx + U * 1.15, sy - U * 0.7); ctx.stroke();
        light(sx + U * 1.18, sy - U * 0.7, U * 0.13, `rgba(142,242,255,${0.6 + 0.4 * Math.sin(now / 200 + id)})`);
      });
      return true;
    case 'iron_guardian': {
      // Large armored aerial protector: broad shoulder frame, jet glow below.
      const y = sy - U * 0.9 - hover;
      sbox(ctx, sx, y, U * 0.5, U * 0.4, U * 0.7, PAL.steel, 0);
      sbox(ctx, sx, y, U * 1.3, U * 0.5, U * 0.35, PAL.slate, U * 0.6);
      sbox(ctx, sx, y, U * 0.4, U * 0.36, U * 0.35, PAL.panel, U * 0.95);
      light(sx + U * 0.1, y - U * 1.12, U * 0.07, PAL.cyan);
      light(sx + U * 0.45, y - U * 0.8, U * 0.12, team);
      ctx.fillStyle = `rgba(84,219,233,${0.4 + 0.3 * Math.sin(now / 120 + id)})`;
      ctx.beginPath(); ctx.ellipse(sx, y + U * 0.15, U * 0.3, U * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      return true;
    }
    default:
      return false;
  }
}
