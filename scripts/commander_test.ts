import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeChronicle } from '../server/src/archive/chronicle';
import type { MatchReport, ServerMessage } from '../shared/src';
import { CommanderBrain, planProduction, type CommanderFacts, type ProductionFacts } from '../server/src/game/commander';
import { Game } from '../server/src/game/room';
import { createUnit, type Unit } from '../server/src/game/state';

const base: CommanderFacts = {
  tick: 100,
  core: { id: 1, x: 10, y: 10 },
  coreHealth: 1,
  enemyCore: { id: 2, x: 90, y: 90 },
  armySize: 8,
  armyHealth: 1,
  strengthRatio: 2,
  assaultRatio: 2,
  armySpread: 3,
  hostilesNearBase: 0,
  idleWorkers: 0,
  lowestResource: 'alloys',
};
const brain = (persona: 'vanguard' | 'sentinel' | 'architect', autonomy: 'manual' | 'assisted' | 'autonomous'): CommanderBrain => {
  const b = new CommanderBrain();
  b.configure(persona, autonomy);
  return b;
};

// ---- personalities choose differently from identical observations
assert.equal(brain('vanguard', 'autonomous').step(base)?.start?.objective.kind, 'attack_target', 'Vanguard attacks with a superior army');
assert.equal(brain('sentinel', 'autonomous').step({ ...base, recentAttack: { x: 12, y: 13 }, hostilesNearBase: 2 })?.start?.objective.kind, 'defend_area', 'Sentinel responds to base damage');
assert.equal(brain('architect', 'autonomous').step({ ...base, strengthRatio: 0.8, assaultRatio: 0.8, armySize: 1, idleWorkers: 4 })?.economy?.objective.kind, 'prioritize_resource', 'Architect redirects idle economy');
const parallel = brain('vanguard', 'autonomous').step({ ...base, idleWorkers: 4 });
assert.ok(parallel?.start?.objective.kind === 'attack_target' && parallel.economy, 'worker priorities run alongside army objectives');
const contested = { ...base, strengthRatio: 1.1, assaultRatio: 1.1 };
assert.equal(brain('vanguard', 'autonomous').step(contested)?.start?.objective.kind, 'attack_target', 'Vanguard accepts an even fight');
assert.notEqual(brain('sentinel', 'autonomous').step(contested)?.start?.objective.kind, 'attack_target', 'Sentinel declines an even fight');

// ---- risk tolerance moves the attack threshold
const cautious = brain('vanguard', 'autonomous');
cautious.setPolicy({ risk: 0, aggression: 0.8, spendLimit: 0.5 });
const bold = brain('vanguard', 'autonomous');
bold.setPolicy({ risk: 1, aggression: 0.8, spendLimit: 0.5 });
const even = { ...base, strengthRatio: 0.9, assaultRatio: 0.9, armySpread: 12 };
assert.notEqual(cautious.step(even)?.start?.objective.kind, 'attack_target', 'low risk tolerance waits for an advantage');
assert.equal(bold.step(even)?.start?.objective.kind, 'attack_target', 'high risk tolerance commits');
assert.notEqual(brain('vanguard', 'autonomous').step({ ...base, strengthRatio: 3, assaultRatio: 0.4 })?.start?.objective.kind, 'attack_target', 'core defenses deter an assault an open-field count would allow');

// ---- autonomy levels
const assisted = brain('vanguard', 'assisted');
const suggestion = assisted.step(base);
assert.equal(suggestion, null, 'Assisted does not launch attacks on its own');
assert.equal(assisted.view().decisions.at(-1)?.outcome, 'suggested', 'it recommends them instead');
const lowRisk = brain('vanguard', 'assisted').step({ ...base, tick: 400, recentAttack: { x: 11, y: 11 }, hostilesNearBase: 3 });
assert.equal(lowRisk?.start?.objective.kind, 'defend_area', 'Assisted performs low-risk defense itself');
const manual = brain('architect', 'manual');
assert.equal(manual.step({ ...base, idleWorkers: 5 }), null, 'Manual mode never acts on initiative');
manual.issue({ kind: 'capture_zone', x: 22, y: 31 });
const order = manual.step(base);
assert.equal(order?.start?.objective.kind, 'capture_zone', 'Manual mode executes explicit orders');
assert.equal(order?.start?.source, 'player');

// ---- lifecycle: active → completed, with expected and actual outcomes recorded
const life = brain('vanguard', 'autonomous');
const first = life.step(base);
assert.equal(first?.start?.objective.kind, 'attack_target');
const running = life.step({ ...base, tick: 160, active: { state: 'running', detail: 'Engaging.' } });
assert.equal(running?.start, undefined, 'a running objective is not restarted');
assert.equal(running?.reinforce?.kind, 'attack_target', 'it is reinforced instead');
life.step({ ...base, tick: 200, enemyCore: undefined, active: { state: 'completed', detail: 'Target destroyed.' } });
const done = life.history().find((d) => d.id === first?.start?.decisionId)!;
assert.equal(done.outcome, 'completed');
assert.equal(done.result, 'Target destroyed.');
assert.ok(done.expected.length > 0 && done.observation.length > 0 && done.reason.length > 0, 'decision is fully explained');
assert.equal(life.stats().completed, 1);

// ---- player orders supersede commander initiative; timeouts fail
const sup = brain('vanguard', 'autonomous');
const auto = sup.step(base)!.start!;
sup.issue({ kind: 'retreat_regroup' });
const override = sup.step({ ...base, tick: 101 });
assert.equal(override?.start?.objective.kind, 'retreat_regroup');
assert.equal(sup.history().find((d) => d.id === auto.decisionId)?.outcome, 'superseded');
sup.step({ ...base, tick: 101 + 1501, active: { state: 'running', detail: '' } });
assert.equal(sup.history().find((d) => d.id === override?.start?.decisionId)?.outcome, 'failed', 'objectives time out');
assert.equal(sup.view().objective, undefined, 'a resolved player order is cleared');

// ---- determinism
assert.deepEqual(brain('sentinel', 'autonomous').step(base), brain('sentinel', 'autonomous').step(base), 'same facts produce the same decision');

// ---- production doctrine
const econ: ProductionFacts = {
  age: 2, villagers: 18, military: 4, towers: 0, popRoom: 10, popCapped: false, houseInProgress: false,
  structuresInProgress: 0, underAttack: false, townCenterId: 1, townCenterQueue: 0, has: { barracks: 1 },
  producers: [{ id: 5, type: 'barracks', queue: 0 }, { id: 7, type: 'barracks', queue: 0 }, { id: 6, type: 'archery_range', queue: 0 }], canAdvance: false, ageReady: false, foodSources: 10,
};
const plan = (persona: 'vanguard' | 'sentinel' | 'architect') => planProduction(persona, econ);
assert.ok(plan('sentinel').some((i) => i.kind === 'build' && i.building === 'watch_tower'), 'Sentinel builds towers');
assert.ok(!plan('vanguard').some((i) => i.kind === 'build' && i.building === 'watch_tower'), 'Vanguard does not');
assert.ok(plan('architect').some((i) => i.kind === 'train' && i.unit === 'villager'), 'Architect keeps growing the economy');
assert.ok(!plan('vanguard').some((i) => i.kind === 'train' && i.unit === 'villager'), 'Vanguard stops at a lean economy');
const trains = (persona: 'vanguard' | 'sentinel' | 'architect') => plan(persona).filter((i) => i.kind === 'train' && i.unit !== 'villager').length;
assert.ok(trains('vanguard') > trains('architect'), 'Vanguard out-produces Architect militarily');
assert.equal(planProduction('architect', { ...econ, villagers: 10, canAdvance: true })[0]?.kind, 'advance_age', 'Architect prioritizes technology');
assert.ok(!planProduction('vanguard', { ...econ, villagers: 10, canAdvance: true }).some((i) => i.kind === 'advance_age'), 'Vanguard delays it');
const savingFacts = { ...econ, age: 1, villagers: 20, military: 8, ageReady: true, canAdvance: false };
assert.ok(!planProduction('sentinel', savingFacts).some((i) => i.kind === 'train' && i.unit !== 'villager'), 'Sentinel saves for the next age once its army stands');
assert.ok(planProduction('sentinel', { ...savingFacts, underAttack: true }).some((i) => i.kind === 'train' && i.unit !== 'villager'), 'but never while under attack');

// ---------------------------------------------------------------- integration

type GameInternals = { step(): void; units: Map<number, Unit>; nextId: number; markDefeated(id: number): void };
function makeGame(salt: string, sink: ServerMessage[] = []): Game & GameInternals {
  return new Game(
    [{ id: 11, name: 'Human', color: '#4ad' }, { id: 12, name: 'Bot', color: '#d54', isBot: true, difficulty: 'easy' }],
    (id, message) => { if (id === 11) sink.push(message as ServerMessage); },
    () => undefined,
    'normal',
    'classic',
    'symbiosis',
    salt,
    { skirmish: true, mapSeed: 20261101 },
  ) as Game & GameInternals;
}
function spawnArmy(game: Game & GameInternals, owner: number, n: number): Unit[] {
  const core = [...game.buildings.values()].find((b) => b.owner === owner && b.type === 'town_center')!;
  const out: Unit[] = [];
  for (let i = 0; i < n; i++) {
    const unit = createUnit(game.nextId++, owner, 'swordsman', core.tileX + 4 + (i % 3), core.tileY + 4 + Math.floor(i / 3));
    game.units.set(unit.id, unit);
    out.push(unit);
  }
  return out;
}

// Snapshot exposes commander state.
{
  const messages: ServerMessage[] = [];
  const game = makeGame('commander-integration', messages);
  game.enqueueCommand(11, { kind: 'setCommander', persona: 'sentinel', autonomy: 'manual' });
  game.enqueueCommand(11, { kind: 'commanderOrder', objective: { kind: 'protect_core' } });
  for (let i = 0; i < 5; i++) game.step();
  const snapshot = messages.filter((m): m is Extract<ServerMessage, { type: 'snapshot' }> => m.type === 'snapshot').at(-1);
  const commander = snapshot?.players.find((player) => player.id === 11)?.commander;
  assert.equal(commander?.persona, 'sentinel');
  assert.equal(commander?.autonomy, 'manual');
  assert.ok((commander?.decisions.length ?? 0) > 0, 'server snapshot exposes explainable decisions');
  assert.ok(commander?.policy && commander.record, 'snapshot carries policy and record');
}

// The commander leaves units the player just ordered alone.
{
  const game = makeGame('commander-micro');
  const army = spawnArmy(game, 11, 6);
  const scout = army[0];
  game.enqueueCommand(11, { kind: 'move', unitIds: [scout.id], x: scout.x + 6, y: scout.y });
  game.step();
  const target = { x: scout.pathTargetX, y: scout.pathTargetY };
  game.enqueueCommand(11, { kind: 'setCommander', persona: 'vanguard', autonomy: 'autonomous' });
  for (let i = 0; i < 60; i++) game.step();
  assert.ok(army.slice(1).some((u) => u.state === 'movingToAttack' || u.state === 'attacking' || u.state === 'moving'), 'the rest of the army was dispatched');
  assert.equal(scout.pathTargetX, target.x, 'a unit under direct player control keeps its order');
  assert.equal(scout.pathTargetY, target.y);
}

// Outmatched defense: workers shelter in the Command Core, then go back to work.
{
  const game = makeGame('commander-shelter');
  const core = [...game.buildings.values()].find((b) => b.owner === 11 && b.type === 'town_center')!;
  game.enqueueCommand(11, { kind: 'setCommander', persona: 'sentinel', autonomy: 'assisted' });
  const raiders: Unit[] = [];
  for (let i = 0; i < 5; i++) {
    const unit = createUnit(game.nextId++, 12, 'swordsman', core.tileX + 5 + i * 0.3, core.tileY + 5);
    game.units.set(unit.id, unit);
    raiders.push(unit);
  }
  const worker = [...game.units.values()].find((u) => u.owner === 11 && u.type === 'villager')!;
  game.enqueueCommand(12, { kind: 'attack', unitIds: raiders.map((r) => r.id), targetId: worker.id });
  for (let i = 0; i < 200; i++) game.step();
  assert.ok((core.garrison?.length ?? 0) > 0, 'workers take shelter when the defense is outmatched');
  for (const r of raiders) game.units.delete(r.id);
  for (let i = 0; i < 200; i++) game.step();
  assert.equal(core.garrison?.length ?? 0, 0, 'shelter is released once the sector is secure');
  const brain = (game as unknown as { commanders: Map<number, CommanderBrain> }).commanders.get(11)!;
  assert.ok(brain.history().some((d) => d.objective === 'defend_area' && d.outcome === 'completed' && /released/.test(d.result ?? '')), 'the decision log reports the release');
}

// Personalities produce measurably different matches.
{
  const outcome: Record<string, { villagers: number; military: number; towers: number; age: number; decisions: number }> = {};
  for (const persona of ['vanguard', 'sentinel', 'architect'] as const) {
    const game = makeGame('commander-divergence');
    game.enqueueCommand(11, { kind: 'setCommander', persona, autonomy: 'autonomous' });
    for (let i = 0; i < 4800; i++) game.step();
    const mine = [...game.units.values()].filter((u) => u.owner === 11);
    outcome[persona] = {
      villagers: mine.filter((u) => u.type === 'villager').length,
      military: mine.filter((u) => u.type !== 'villager').length,
      towers: [...game.buildings.values()].filter((b) => b.owner === 11 && b.type === 'watch_tower').length,
      age: game.players.get(11)!.age,
      decisions: (game as unknown as { commanders: Map<number, CommanderBrain> }).commanders.get(11)!.stats().decisions,
    };
  }
  console.log('8-minute autonomous divergence:', JSON.stringify(outcome));
  assert.ok(outcome.architect.villagers > outcome.vanguard.villagers, 'Architect grows a larger workforce than Vanguard');
  assert.ok(outcome.vanguard.military > outcome.architect.military, 'Vanguard fields a larger army than Architect');
  assert.ok(outcome.sentinel.towers > outcome.vanguard.towers, 'Sentinel fortifies; Vanguard does not');
  for (const persona of Object.keys(outcome)) assert.ok(outcome[persona].decisions > 3, `${persona} made decisions`);
}

// Post-battle report, archived with the match.
async function reportTest(): Promise<void> {
  const messages: ServerMessage[] = [];
  const game = makeGame('commander-report', messages);
  game.enqueueCommand(11, { kind: 'setCommander', persona: 'architect', autonomy: 'autonomous' });
  for (let i = 0; i < 1200; i++) game.step();
  game.markDefeated(12);
  const over = messages.find((m): m is Extract<ServerMessage, { type: 'gameOver' }> => m.type === 'gameOver');
  const report = over?.report as MatchReport | undefined;
  assert.ok(report, 'gameOver carries a report');
  assert.equal(report!.winnerId, 11);
  assert.equal(report!.durationTicks, 1200);
  const me = report!.players.find((p) => p.playerId === 11)!;
  assert.ok(me.won && me.commander?.persona === 'architect', 'winner and commander recorded');
  assert.ok(me.gathered.energy + me.gathered.alloys + me.gathered.compute > 0, 'gathering recorded');
  assert.ok(me.unitsProduced > 0, 'production recorded');
  assert.ok(report!.timeline.some((e) => e.kind === 'victory') && report!.timeline.some((e) => e.kind === 'defeat'), 'timeline has the conclusion');
  assert.ok(report!.insights.length > 0, 'report explains the result');
  assert.ok(report!.strength.length >= 10, 'army strength is sampled');
  assert.deepEqual(game.matchReport(), report, 'the finished game keeps its report for archiving');
  const dir = mkdtempSync(path.join(tmpdir(), 'age-report-'));
  try {
    const archive = await writeChronicle({
      schema: 'age-of-symbiosis/chronicle-v1', matchId: 'report-test', finishedTick: report!.durationTicks, winnerName: 'Human',
      players: [], elonEvents: [], activity: { buildingsConstructed: [], unitsTrained: [], agesReached: [], battles: [], councilRecommendations: [] },
      report: report!,
    }, dir);
    assert.equal(JSON.parse(readFileSync(archive.jsonPath, 'utf8')).report.winnerId, 11, 'the archive stores the report');
    assert.match(readFileSync(archive.summaryPath, 'utf8'), /What decided it/, 'the human summary explains the result');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

reportTest().then(() => console.log('commander: ok'), (error) => { console.error(error); process.exit(1); });
