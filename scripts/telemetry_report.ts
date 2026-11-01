// Economy telemetry: hours from founding to each milestone across every saved
// city. Usage: npx tsx scripts/telemetry_report.ts [profileDir]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? process.env.HOME_DATA_DIR ?? path.resolve('server/profiles');
const KEYS = ['level2', 'level3', 'level4', 'level5', 'firstUnit', 'firstRaid', 'firstSettlement'] as const;
const hours: Record<string, number[]> = Object.fromEntries(KEYS.map((k) => [k, []]));
let cities = 0;
const levels = new Map<number, number>();
for (const file of readdirSync(dir).filter((f) => /^[0-9a-f]{64}\.json$/.test(f))) {
  const save = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  cities++;
  levels.set(save.player?.age ?? 1, (levels.get(save.player?.age ?? 1) ?? 0) + 1);
  const founded = save.progression?.foundedAt;
  const m = save.progression?.milestones ?? {};
  if (!founded) continue;
  for (const k of KEYS) if (m[k]) hours[k].push((m[k] - founded) / 3_600_000);
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
console.log(`cities: ${cities}  by City Level: ${[...levels].sort().map(([l, n]) => `L${l}=${n}`).join(' ')}`);
console.log('milestone        reached   p25 h    median h   p75 h');
for (const k of KEYS) {
  const xs = hours[k];
  const f = (v: number) => (Number.isNaN(v) ? '   —   ' : v.toFixed(1).padStart(7));
  console.log(`${k.padEnd(16)} ${String(xs.length).padStart(7)}   ${f(pct(xs, 0.25))}  ${f(pct(xs, 0.5))}   ${f(pct(xs, 0.75))}`);
}
