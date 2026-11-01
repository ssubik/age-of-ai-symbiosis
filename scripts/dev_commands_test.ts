// Developer chat commands: allowlisted browser only, private replies, and the
// match is flagged so its record is never treated as real.
// Run: npx tsx scripts/dev_commands_test.ts
import assert from 'node:assert/strict';
import { MAX_AGE } from '../shared/src/index.ts';
import { Game } from '../server/src/game/room.ts';

process.env.DEV_PLAYERS = 'dev-browser';

async function main(): Promise<void> {
  // --- Game-level commands ---
  const game = new Game([{ id: 1, name: 'Dev', color: '#fff' }], () => {}, () => {}, 'normal', 'classic', 'symbiosis');
  const p = game.players.get(1)!;
  assert.equal(game.devMatch, false, 'a fresh match is not a dev match');
  assert.match(game.devCommand(1, '/help'), /\/age/);
  assert.equal(game.devMatch, false, 'help does not flag the match');

  assert.equal(game.devCommand(1, '/age'), 'Age set to 2.', '/age with no number goes one age up');
  assert.equal(p.age, 2);
  assert.equal(game.devCommand(1, `/age ${MAX_AGE}`), `Age set to ${MAX_AGE}.`);
  assert.equal(p.age, MAX_AGE);
  assert.match(game.devCommand(1, '/age 2'), /Already at age/, 'cannot go back an age');
  assert.match(game.devCommand(1, '/age 9'), /Age must be/);
  assert.equal(game.devMatch, true, 'using a command flags the match');

  const wood = p.resources.alloys;
  game.devCommand(1, '/res 1234');
  assert.equal(p.resources.alloys, wood + 1234);
  assert.match(game.devCommand(1, '/res abc'), /Not a number/);

  const first = [...game.buildings.values()][0];
  game.buildings.set(777, { ...first, id: 777, type: 'house', progress: 0.1, hp: 10, owner: 1, queue: [] });
  assert.match(game.devCommand(1, '/build'), /1 construction site/);
  assert.equal(game.buildings.get(777)!.progress, 1);

  (game as any).step();
  const before = game.powerOf(1).supply;
  game.devCommand(1, '/power 40');
  (game as any).step();
  assert.equal(game.powerOf(1).supply, before + 40, '/power adds grid supply');
  game.devCommand(1, '/power 0');
  (game as any).step();
  assert.equal(game.powerOf(1).supply, before, '/power 0 removes it');
  assert.equal(game.contributionSummary().dev, true, 'archive summary carries the dev flag');
  const perfect = game.devCommand(1, '/perfectbase');
  assert.match(perfect, /Perfect base ready/);
  assert.equal(p.age, 5);
  assert.equal(p.cityPath, 'command');
  assert.ok([...game.buildings.values()].some((b) => b.owner === 1 && b.type === 'exosuit_lab'));
  assert.ok([...game.units.values()].some((u) => u.owner === 1 && u.type === 'iron_guardian'));
  assert.equal(p.elonBalance, (game as any).elonCapacityOf(1));

  // --- Lobby gate: only the allowlisted browser, replies stay private ---
  const { Lobby } = await import('../server/src/lobby.ts');
  const lobby: any = new Lobby();
  const outDev: any[] = [];
  const outGuest: any[] = [];
  const dev = lobby.connect((m: unknown) => outDev.push(m));
  const guest = lobby.connect((m: unknown) => outGuest.push(m));
  lobby.handleMessage(dev.id, { type: 'setName', name: 'subik', clientId: 'dev-browser' });
  lobby.handleMessage(guest.id, { type: 'setName', name: 'guest', clientId: 'someone-else' });
  lobby.handleMessage(dev.id, { type: 'createRoom' });
  lobby.handleMessage(guest.id, { type: 'joinRoom', roomId: dev.roomId });
  lobby.handleMessage(guest.id, { type: 'setReady', ready: true });
  lobby.handleMessage(dev.id, { type: 'startGame' });
  const room = lobby.rooms.get(dev.roomId);
  assert.ok(room?.inGame && room.game, 'match started');
  const g2: Game = room.game;

  outDev.length = 0;
  outGuest.length = 0;
  lobby.handleMessage(dev.id, { type: 'chat', text: '/age 3' });
  assert.equal(g2.players.get(dev.id)!.age, 3, 'allowlisted browser can level up');
  assert.ok(outDev.some((m) => m.type === 'chat' && m.from === 'DEV' && /Age set to 3/.test(m.text)), 'dev gets a private reply');
  assert.ok(!outGuest.some((m) => m.type === 'chat'), 'other players never see dev commands');

  const guestFood = g2.players.get(guest.id)!.resources.energy;
  outGuest.length = 0;
  lobby.handleMessage(guest.id, { type: 'chat', text: '/res 99999' });
  assert.equal(g2.players.get(guest.id)!.resources.energy, guestFood, 'other browsers cannot use dev commands');
  assert.ok(outGuest.some((m) => m.type === 'chat' && m.from === 'guest'), 'their slash text is ordinary chat');

  outGuest.length = 0;
  lobby.handleMessage(guest.id, { type: 'chat', text: '/whoami' });
  assert.ok(outGuest.some((m) => m.from === 'DEV' && m.text.includes('someone-else')), '/whoami reveals only your own ID');
  assert.ok(!outDev.some((m) => m.text?.includes('someone-else')), '/whoami is private');

  g2.stop();
  console.log('Developer commands, allowlist gate, private replies, and dev-match flag: PASS');
  process.exit(0);
}

void main().catch((e) => { console.error(e); process.exit(1); });
