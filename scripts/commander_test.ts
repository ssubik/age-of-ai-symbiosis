import assert from 'node:assert/strict';
import { CommanderBrain } from '../server/src/game/commander';
import { Game } from '../server/src/game/room';

const base = {
  tick: 100,
  core: { id: 1, x: 10, y: 10 },
  enemyCore: { id: 2, x: 90, y: 90 },
  armyReadiness: 1,
  armyHealth: 1,
  idleWorkers: 0,
  lowestResource: 'wood' as const,
};

const vanguard = new CommanderBrain();
vanguard.configure('vanguard', 'autonomous');
assert.equal(vanguard.evaluate(base, true)?.objective?.kind, 'attack_target', 'Vanguard attacks with a ready army');

const sentinel = new CommanderBrain();
sentinel.configure('sentinel', 'autonomous');
assert.equal(sentinel.evaluate({ ...base, recentAttack: { x: 12, y: 13 } }, true)?.objective?.kind, 'defend_area', 'Sentinel responds to base damage');

const architect = new CommanderBrain();
architect.configure('architect', 'autonomous');
assert.equal(architect.evaluate({ ...base, armyReadiness: 0.1, idleWorkers: 4 }, true)?.objective?.kind, 'prioritize_resource', 'Architect redirects idle economy');

const assisted = new CommanderBrain();
assisted.configure('vanguard', 'assisted');
const suggestion = assisted.evaluate(base, true);
assert.equal(suggestion?.decision.outcome, 'suggested');
assert.equal(suggestion?.objective, undefined, 'Assisted initiative is advisory only');
assisted.issue({ kind: 'retreat_regroup' });
const override = assisted.evaluate({ ...base, tick: 101 }, true);
assert.equal(override?.decision.outcome, 'issued');
assert.equal(override?.objective?.kind, 'retreat_regroup', 'Player order executes at Assisted autonomy');

const manual = new CommanderBrain();
manual.configure('architect', 'manual');
assert.equal(manual.evaluate(base, true), null, 'Manual mode never invents an objective');
manual.issue({ kind: 'capture_zone', x: 22, y: 31 });
assert.equal(manual.evaluate(base, true)?.objective?.kind, 'capture_zone', 'Manual mode executes explicit orders');

const deterministicA = new CommanderBrain();
const deterministicB = new CommanderBrain();
deterministicA.configure('sentinel', 'autonomous');
deterministicB.configure('sentinel', 'autonomous');
assert.deepEqual(deterministicA.evaluate(base, true), deterministicB.evaluate(base, true), 'same facts produce the same decision');

const messages: unknown[] = [];
const game = new Game(
  [{ id: 11, name: 'Human', color: '#4ad' }, { id: 12, name: 'Enemy', color: '#d54' }],
  (id, message) => { if (id === 11) messages.push(message); },
  () => undefined,
  'batalha',
  'classic',
  'symbiosis',
  'commander-integration',
);
game.enqueueCommand(11, { kind: 'setCommander', persona: 'sentinel', autonomy: 'manual' });
game.enqueueCommand(11, { kind: 'commanderOrder', objective: { kind: 'defend_area', x: 12, y: 12 } });
const step = (game as unknown as { step(): void }).step.bind(game);
for (let i = 0; i < 5; i++) step();
const snapshot = messages.find((message): message is { type: 'snapshot'; players: { id: number; commander?: { persona: string; autonomy: string; decisions: unknown[] } }[] } => (message as { type?: string }).type === 'snapshot');
const commander = snapshot?.players.find((player) => player.id === 11)?.commander;
assert.equal(commander?.persona, 'sentinel');
assert.equal(commander?.autonomy, 'manual');
assert.ok((commander?.decisions.length ?? 0) > 0, 'server snapshot exposes explainable decisions');

console.log('commander: ok');
