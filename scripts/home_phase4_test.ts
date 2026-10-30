// Phase 4 for the persistent Home (master spec §4, §5, §6, §10): City Levels 3-5,
// physical building upgrades, unit families and factory levels, research,
// level-aware raids and unit abilities, player snapshot matchmaking, defender
// reports, shields and the exactly-once defense outbox.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BuildingType, RaidAction, RaidArmy, ServerMessage, UnitType } from '../shared/src';
import {
  BUILDING_DEFS, buildingMaxHp, HOME_BUILDING_CITY_LEVEL, HOME_CITY_LEVELS, HOME_MAX_LEVEL,
  HOME_UNIT_UNLOCK, homeUpgradeCost, TRAIN_QUEUE_MAX,
} from '../shared/src/constants';
import { Game } from '../server/src/game/room';
import { createUnit, type Building } from '../server/src/game/state';
import { HomeManager } from '../server/src/home/manager';
import { JsonHomeRepository } from '../server/src/home/repository';
import type { HomeSave } from '../server/src/home/types';
import { pickOpponent } from '../server/src/raid/orchestrator';
import { MemorySnapshotRegistry, type PublishedDefense } from '../server/src/raid/registry';
import { createRaidGame, simulateRaid } from '../server/src/raid/sim';
import { botSnapshot, deployZone, snapshotChecksum } from '../server/src/raid/snapshot';

let clock = 2_200_000_000_000;
const now = () => clock;
const member = { id: 9, name: 'Phase Four', color: '#39c6e8' };
const profileId = 'e'.repeat(64);

type Internals = {
  step(): void;
  nextId: number;
  validFootprint(x: number, y: number, size: number): boolean;
  blockFootprint(x: number, y: number, size: number): void;
  developmentPointsOf(id: number): number;
  armyCapacityOf(id: number): number;
  queueSlotsOf(b: Building): number;
  storageCapsOf(id: number): { wood: number };
  raidDefenseDamage(b: Building, base: number, target: unknown): number;
  raidDefenseRange(b: Building, base: number): number;
  tick: number;
};
const io = (g: Game) => g as unknown as Internals;

function army(partial: Partial<RaidArmy>): RaidArmy {
  return { attack_drone: 0, fighter: 0, rocket_launcher: 0, siege_mech: 0, stealth_bomber: 0, plasma_tank: 0, iron_guardian: 0, aegis_valkyrie: 0, ...partial };
}

function newHome(homeState?: HomeSave): Game {
  return new Game([member], () => undefined, () => undefined, 'normal', 'classic', 'symbiosis', profileId, { session: 'home', homeState, now });
}

function hubOf(g: Game, owner = member.id): Building {
  return [...g.buildings.values()].find((b) => b.owner === owner && b.type === 'town_center')!;
}

/** Setup helper: a completed building at a level next to the Hub. */
function place(g: Game, type: BuildingType, level = 1, owner = member.id): Building {
  const hub = hubOf(g, owner);
  const size = BUILDING_DEFS[type].size;
  for (let r = 4; r < 40; r++) {
    for (let y = hub.tileY - r; y <= hub.tileY + r; y++) {
      for (let x = hub.tileX - r; x <= hub.tileX + r; x++) {
        if (Math.max(Math.abs(x - hub.tileX), Math.abs(y - hub.tileY)) !== r) continue;
        if (!io(g).validFootprint(x - 1, y - 1, size + 2)) continue;
        const b: Building = { id: io(g).nextId++, owner, type, tileX: x, tileY: y, hp: buildingMaxHp(type, level), progress: 1, queue: [], ...(level > 1 ? { level } : {}) };
        g.buildings.set(b.id, b);
        io(g).blockFootprint(x, y, size);
        return b;
      }
    }
  }
  throw new Error(`no room for ${type}`);
}

function stepUntil(g: Game, done: () => boolean, max = 20_000): void {
  for (let i = 0; i < max && !done(); i++) io(g).step();
  assert.ok(done(), 'condition not reached in time');
}

const levelOf = (b: Building) => b.level ?? 1;

/** Static: every City Level is reachable from the one before it. */
function requirementTableIsReachable(): void {
  for (const [lvl, req] of Object.entries(HOME_CITY_LEVELS)) {
    const target = Number(lvl);
    for (const need of req.buildings) {
      assert.ok(need.types.some((t) => (HOME_BUILDING_CITY_LEVEL[t] ?? BUILDING_DEFS[t].ageReq) <= target - 1),
        `L${target}: ${need.types.join('/')} must be placeable at L${target - 1}`);
      assert.ok(need.level <= target - 1 || need.level === 1, `L${target}: ${need.types} L${need.level} exceeds city L${target - 1}`);
      assert.ok(need.types.some((t) => (HOME_MAX_LEVEL[t] ?? 1) >= need.level), `L${target}: ${need.types} cannot reach L${need.level}`);
    }
    if (req.research) assert.ok((HOME_UNIT_UNLOCK[req.research.unit]?.cityLevel ?? 99) <= target - 1, `L${target}: research unit unlocked too late`);
  }
  for (const [unit, unlock] of Object.entries(HOME_UNIT_UNLOCK)) {
    assert.ok((HOME_BUILDING_CITY_LEVEL[unlock!.factory] ?? 1) <= unlock!.cityLevel, `${unit}: factory placeable by its city level`);
    assert.ok((HOME_MAX_LEVEL[unlock!.factory] ?? 1) >= unlock!.factoryLevel, `${unit}: factory reaches L${unlock!.factoryLevel}`);
    assert.ok(unlock!.factoryLevel <= unlock!.cityLevel, `${unit}: factory level within city level`);
  }
}

async function progression(): Promise<void> {
  const g = newHome();
  const p = g.players.get(member.id)!;
  p.age = 2;
  p.resources = { food: 9_000, wood: 9_000, gold: 9_000, stone: 9_000 };
  place(g, 'robotics_workshop');
  for (let i = 0; i < 5; i++) place(g, 'solar_array');
  const camp = place(g, 'army_camp');
  const lumber = [...g.buildings.values()].find((b) => b.type === 'lumber_camp')!;

  // L3 is gated with readable reasons.
  const blockers = g.cityLevelBlockers(member.id, 3);
  assert.ok(blockers.some((b) => b.includes('lumber_camp L2')) && blockers.some((b) => b.includes('attack_drone research')), `L3 blockers: ${blockers}`);
  g.enqueueCommand(member.id, { kind: 'advanceAge' });
  io(g).step();
  assert.equal(hubOf(g).upgradeTargetLevel, undefined, 'Hub refuses L3 with unmet requirements');

  // Diminishing development for duplicates: 5 arrays are worth less than 5×.
  // Stock above capacity is kept; production simply stops (spec §3.1).
  for (let i = 0; i < 5; i++) io(g).step();
  assert.equal(p.resources.gold, 9_000, 'stock above capacity is never destroyed');
  const devBefore = io(g).developmentPointsOf(member.id);
  place(g, 'solar_array');
  const sixth = io(g).developmentPointsOf(member.id) - devBefore;
  assert.ok(sixth > 0 && sixth < 50 * 0.4, `6th solar array adds a diminished ${sixth}`);

  // Physical upgrade: paid once, building keeps working, level only on completion.
  const woodBefore = p.resources.wood;
  const capBefore = io(g).storageCapsOf(member.id).wood;
  g.enqueueCommand(member.id, { kind: 'upgradeBuilding', buildingId: lumber.id });
  io(g).step();
  assert.equal(lumber.upgradeTargetLevel, 2);
  assert.equal(lumber.progress, 1, 'upgrading building stays complete and working');
  assert.ok(Math.abs(woodBefore - p.resources.wood - (homeUpgradeCost('lumber_camp', 2).wood ?? 0)) < 2, 'upgrade cost paid once');
  g.enqueueCommand(member.id, { kind: 'upgradeBuilding', buildingId: lumber.id });
  io(g).step();
  assert.ok(Math.abs(woodBefore - p.resources.wood - (homeUpgradeCost('lumber_camp', 2).wood ?? 0)) < 2, 'duplicate upgrade rejected');
  assert.equal(io(g).storageCapsOf(member.id).wood, capBefore, 'no level effect before completion');
  const builder = [...g.units.values()].find((u) => u.type === 'robot')!;
  stepUntil(g, () => builder.state === 'building' || levelOf(lumber) === 2);
  stepUntil(g, () => levelOf(lumber) === 2);
  assert.ok(io(g).storageCapsOf(member.id).wood > capBefore, 'L2 depot stores more');

  // Buildings cannot outgrow their city; camps grow capacity per level.
  const capacityL1 = io(g).armyCapacityOf(member.id);
  g.enqueueCommand(member.id, { kind: 'upgradeBuilding', buildingId: camp.id });
  io(g).step();
  stepUntil(g, () => levelOf(camp) === 2);
  assert.equal(io(g).armyCapacityOf(member.id), Math.round(capacityL1 * 1.5), 'camp L2 = +50% capacity');
  g.enqueueCommand(member.id, { kind: 'upgradeBuilding', buildingId: camp.id });
  io(g).step();
  assert.equal(camp.upgradeTargetLevel, undefined, 'camp L3 needs City Level 3');

  // Research: workshop job, paid once, finishes over time.
  g.enqueueCommand(member.id, { kind: 'unitResearch', unit: 'siege_mech' });
  io(g).step();
  assert.equal(g.progression.researching, undefined, 'Siege Mech research locked until City Level 3');
  g.enqueueCommand(member.id, { kind: 'unitResearch', unit: 'attack_drone' });
  io(g).step();
  assert.equal(g.progression.researching?.unit, 'attack_drone');
  g.enqueueCommand(member.id, { kind: 'unitResearch', unit: 'attack_drone' });
  io(g).step();
  stepUntil(g, () => (g.progression.research.attack_drone ?? 0) === 1);

  // Remaining L3 requirements, then the physical Hub upgrade.
  const mill = [...g.buildings.values()].find((b) => b.type === 'mill')!;
  mill.level = 2;
  place(g, 'sensor_tower');
  assert.deepEqual(g.cityLevelBlockers(member.id, 3), [], 'all L3 requirements met');
  g.enqueueCommand(member.id, { kind: 'advanceAge' });
  io(g).step();
  assert.equal(hubOf(g).upgradeTargetLevel, 3);
  assert.equal(p.age, 2, 'level changes only when the Hub upgrade is built');
  stepUntil(g, () => p.age === 3);

  // Offline research completes within the cap on the frozen grid factor.
  g.enqueueCommand(member.id, { kind: 'unitResearch', unit: 'siege_mech' });
  io(g).step();
  const save = g.captureHomeState(profileId);
  clock += 60 * 60 * 1000;
  const later = newHome(save);
  assert.equal(later.progression.research.siege_mech, 1, 'offline research completed');
  assert.equal(later.progression.researching, undefined);
  clock += 60_000;

  // L4 and L5 (requirements injected; the Hub upgrades are physical).
  for (const b of g.buildings.values()) if (b.type === 'solar_array') b.level = 2;
  for (let i = 0; i < 4; i++) place(g, 'solar_array', 3);
  place(g, 'mining_camp', 2);
  place(g, 'point_turret', 2);
  place(g, 'anti_air');
  io(g).step(); // grid supply is recomputed each tick
  assert.deepEqual(g.cityLevelBlockers(member.id, 4), [], `L4 met: ${g.cityLevelBlockers(member.id, 4)}`);
  g.enqueueCommand(member.id, { kind: 'advanceAge' });
  io(g).step();
  stepUntil(g, () => p.age === 4);
  place(g, 'drone_factory', 4);
  camp.level = 4;
  for (const b of g.buildings.values()) if (b.type === 'robotics_workshop') b.level = 3;
  for (let i = 0; i < 4; i++) place(g, 'solar_array', 3);
  // A real L5 candidate has engaged with L3/L4 military content too.
  place(g, 'mech_forge');
  place(g, 'missile_foundry');
  io(g).step(); // grid supply is recomputed each tick
  assert.deepEqual(g.cityLevelBlockers(member.id, 5), [], `L5 met: ${g.cityLevelBlockers(member.id, 5)}`);
  g.enqueueCommand(member.id, { kind: 'advanceAge' });
  io(g).step();
  stepUntil(g, () => p.age === 5, 40_000);
  assert.equal(p.cityPath, 'command', 'Specialized City takes the command path');
  g.enqueueCommand(member.id, { kind: 'advanceAge' });
  io(g).step();
  assert.equal(hubOf(g).upgradeTargetLevel, undefined, 'L5 is the cap');

  // Unit families: factory level gates the second unit; slots grow with level.
  const hangar = place(g, 'aerospace_hangar');
  const train = (b: Building, unit: UnitType) => { g.enqueueCommand(member.id, { kind: 'train', buildingId: b.id, unit }); io(g).step(); };
  train(hangar, 'fighter');
  train(hangar, 'stealth_bomber');
  assert.deepEqual(hangar.queue.map((q) => q.unit), ['fighter'], 'bomber needs Hangar L2');
  hangar.level = 2;
  train(hangar, 'stealth_bomber');
  assert.deepEqual(hangar.queue.map((q) => q.unit), ['fighter', 'stealth_bomber']);
  assert.equal(io(g).queueSlotsOf(hangar), TRAIN_QUEUE_MAX + 2);
  const lab = place(g, 'exosuit_lab', 2);
  train(lab, 'aegis_valkyrie');
  assert.equal(lab.queue[0]?.unit, 'aegis_valkyrie', 'Exosuit Lab L2 builds the Aegis Valkyrie');
  train(hangar, 'attack_drone');
  assert.equal(hangar.queue.length, 2, 'factories only build their own family');
}

function raidMechanics(): void {
  // Levels raise defense HP; the grid factor floors at 50%.
  const base = botSnapshot(7, 4);
  const leveled = base.buildings.find((b) => (b.level ?? 1) > 1);
  assert.ok(leveled, 'L4 bots carry building levels');
  const weak = { ...base, defensePower: 0.1 };
  const weakSnap = { ...weak, checksum: snapshotChecksum(weak) };
  const raid = createRaidGame(weakSnap, { id: 3, name: 'A', color: '#fff' }, () => undefined);
  assert.equal(raid.buildings.get(leveled!.id)!.hp, buildingMaxHp(leveled!.type, leveled!.level));
  const turret = [...raid.buildings.values()].find((b) => b.type === 'point_turret')!;
  raid.setRaidReserve(army({ attack_drone: 2, iron_guardian: 1 }), 600);
  const zone = deployZone(weakSnap);
  assert.equal(raid.raidDeploy('attack_drone', zone.x0 + 1, zone.y0 + 1), null);
  const drone = [...raid.units.values()].find((u) => u.type === 'attack_drone')!;
  const plain = io(raid).raidDefenseDamage(turret, 10, drone);
  assert.ok(Math.abs(plain - 10 * (1 + 0.2 * ((turret.level ?? 1) - 1)) * 0.5) < 1e-9, 'level ×, grid factor floored at 0.5');
  assert.equal(raid.raidDeploy('iron_guardian', drone.x, drone.y), null);
  io(raid).tick = 0; // inside the field pulse
  assert.ok(Math.abs(io(raid).raidDefenseDamage(turret, 10, drone) - plain * 0.7) < 1e-9, 'Guardian field −30%');
  io(raid).tick = 70; // between pulses
  assert.ok(Math.abs(io(raid).raidDefenseDamage(turret, 10, drone) - plain) < 1e-9, 'field is temporary');
  const sensor = [...raid.buildings.values()].find((b) => b.type === 'sensor_tower');
  const near = [...raid.buildings.values()].find((b) => b.type === 'point_turret' && sensor && Math.hypot(b.tileX - sensor.tileX, b.tileY - sensor.tileY) <= 6);
  if (near) assert.ok(io(raid).raidDefenseRange(near, 7) > 7 + 0.5 * ((near.level ?? 1) - 1), 'Sensor Tower extends range');

  // Fighters open on anti-air; Valkyrie arcs and bomber blasts hit several structures.
  // Ability geometry is tested on the same base with its defenses removed, so a
  // lone probe unit survives long enough to land its first hit.
  const unarmedBody = { ...base, buildings: base.buildings.filter((b) => !['point_turret', 'anti_air', 'watch_tower'].includes(b.type)) };
  const unarmed = { ...unarmedBody, checksum: snapshotChecksum(unarmedBody) };
  const probe = (unit: keyof RaidArmy, snap = base) => {
    const g = createRaidGame(snap, { id: 3, name: 'A', color: '#fff' }, () => undefined);
    g.setRaidReserve(army({ [unit]: 1 }), 900);
    const z = deployZone(snap);
    assert.equal(g.raidDeploy(unit, z.x0 + 1, z.y0 + 1), null);
    const u = [...g.units.values()][0];
    const firstTarget = g.buildings.get(u.attackTargetId!)!;
    const hp0 = new Map([...g.buildings.values()].map((b) => [b.id, b.hp]));
    for (let i = 0; i < 400 && !g.raidOutcome; i++) {
      g.advance();
      const damaged = [...g.buildings.values()].filter((b) => b.hp < hp0.get(b.id)!).length + (snap.buildings.length - g.buildings.size);
      if (damaged >= 2) return { firstTarget, multi: true };
    }
    return { firstTarget, multi: false };
  };
  assert.equal(probe('fighter').firstTarget.type, 'anti_air', 'fighter strike pass on anti-air');
  assert.ok(['point_turret', 'anti_air', 'watch_tower'].includes(probe('rocket_launcher').firstTarget.type), 'rockets suppress defenses');
  assert.ok(probe('aegis_valkyrie', unarmed).multi, 'Valkyrie arcs to nearby structures');
  assert.ok(probe('stealth_bomber', unarmed).multi, 'bomber blast hits a cluster');

  // Research changes the fight and is part of the replay.
  const snap = botSnapshot(4040, 2);
  const z = deployZone(snap);
  const deploys = Array.from({ length: 6 }, (_, i) => ({ tick: 0, unit: 'attack_drone' as const, x: z.x0 + 1 + i, y: z.y0 + 1, homeUnitId: i }));
  const replay = (research: Partial<RaidArmy>) => simulateRaid(snap, {
    rulesVersion: 1, snapshotId: snap.id, snapshotChecksum: snap.checksum, maxTicks: 900,
    reserved: army({ attack_drone: 6 }), research, deploys,
  });
  const none = replay({});
  const max = replay({ attack_drone: 5 });
  assert.notEqual(none.checksum, max.checksum, 'research changes the outcome');
  assert.deepEqual(replay({ attack_drone: 5 }), max, 'replay with research is deterministic');
}

function matchmaking(): void {
  const snap = botSnapshot(1, 2);
  const entry = (id: string, level: number, trophies: number, shieldUntil = 0): PublishedDefense =>
    ({ profileId: id.repeat(64).slice(0, 64), snapshot: snap, cityLevel: level, trophies, shieldUntil, publishedAt: 0 });
  const entries = [entry('a', 2, 100), entry('b', 2, 900), entry('c', 4, 100), entry('d', 2, 120, now() + 1000)];
  const me = 'f'.repeat(64);
  assert.equal(pickOpponent(entries, me, 2, 110, now(), 0)?.profileId[0], 'a', 'closest tolerance band first; shielded and off-level skipped');
  assert.equal(pickOpponent([entries[1]], me, 2, 110, now(), 0)?.profileId[0], 'b', 'tolerance widens when needed');
  assert.equal(pickOpponent([entries[2], entries[3]], me, 2, 110, now(), 0), null, 'nobody eligible → bot');
  assert.equal(pickOpponent([entry('f', 2, 100)], me, 2, 100, now(), 0), null, 'never yourself');
}

async function playerSnapshots(): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'age-p4-'));
  try {
    const registry = new MemorySnapshotRegistry();
    const repo = new JsonHomeRepository(dir);
    const manager = new HomeManager(repo, now, registry);
    const inboxA: ServerMessage[] = [];
    const inboxB: ServerMessage[] = [];
    await manager.enter({ id: 21, name: 'Defender', color: '#f00', clientId: 'p4-defender', send: (m) => inboxA.push(m) });
    await manager.enter({ id: 22, name: 'Attacker', color: '#0f0', clientId: 'p4-attacker', send: (m) => inboxB.push(m) });
    const A = manager.homeGame(21)!;
    const B = manager.homeGame(22)!;
    A.stop(); B.stop();
    A.players.get(21)!.age = 2;
    place(A, 'point_turret', 1, 21);
    place(A, 'watch_tower', 1, 21);
    const resourcesA = JSON.stringify(A.players.get(21)!.resources);

    // Publishing: persist (here via a harmless raid-less action path) pushes A's snapshot.
    await manager.raid(21, { kind: 'cancel' }); // no record: returns home and persists
    const published = registry.entries().find((e) => e.profileId === HomeManager.profileId('p4-defender'));
    assert.ok(published, 'A published a defense snapshot');
    assert.equal(published!.snapshot.kind, 'player');
    assert.ok(published!.snapshot.buildings.some((b) => b.type === 'point_turret'));

    // B (level 2) is matched against A's published base; the copy is pinned.
    B.players.get(22)!.age = 2;
    place(B, 'army_camp', 1, 22);
    for (let i = 0; i < 8; i++) { const id = io(B).nextId++; B.units.set(id, createUnit(id, 22, 'attack_drone', hubOf(B, 22).tileX - 1.5, hubOf(B, 22).tileY + 0.5)); }
    const act = (a: RaidAction) => manager.raid(22, a);
    await act({ kind: 'scout' });
    const record = B.raidData.active!;
    assert.equal(record.defenderProfileId, HomeManager.profileId('p4-defender'), 'matched the player base');
    const pinned = structuredClone(record.snapshot);
    place(A, 'house', 1, 21);
    await manager.raid(21, { kind: 'cancel' });
    const republished = registry.entries().find((e) => e.profileId === record.defenderProfileId)!;
    assert.notEqual(republished.snapshot.id, pinned.id, 'layout change publishes a new snapshot');
    assert.deepEqual(record.snapshot, pinned, 'the scouted copy never changes');

    // Raid A's base to the end; settlement queues a defender delivery atomically.
    await act({ kind: 'reserve', army: army({ attack_drone: 8 }) });
    const zone = deployZone(record.snapshot);
    for (let i = 0; i < 8; i++) await act({ kind: 'deploy', unit: 'attack_drone', x: zone.x0 + 1 + i, y: zone.y0 + 1 });
    const raid = manager.raidGame(22)!;
    raid.stop();
    for (let i = 0; i < 2_000 && !raid.raidOutcome; i++) raid.advance();
    const report = B.raidData.reports[0];
    assert.equal(report.raidId, record.id);
    for (const k of ['food', 'wood', 'gold', 'stone'] as const) assert.ok(report.reward[k] <= report.earned[k], 'credit never exceeds what was earned');
    // Delivery runs right after the settlement save; wait for it to land.
    for (let i = 0; i < 50 && B.raidData.outbox.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(B.raidData.outbox.length, 0, 'outbox drained after delivery');
    const defenseReport = A.progression.defenseReports.find((r) => r.raidId === record.id);
    assert.ok(defenseReport, 'online defender received the report');
    assert.equal(defenseReport!.attacker, 'Attacker');
    assert.deepEqual(defenseReport!.attackerReward, report.reward, 'defender sees the system-funded attacker reward');
    assert.equal(JSON.stringify(A.players.get(21)!.resources), resourcesA, 'defender stockpile unchanged by the raid');
    if (report.stars > 0) {
      assert.ok(A.progression.shieldUntil > now(), 'defender shielded after losing a star');
      const entryA = registry.entries().find((e) => e.profileId === record.defenderProfileId)!;
      assert.equal(entryA.shieldUntil, A.progression.shieldUntil, 'registry knows the shield');
      await manager.raid(22, { kind: 'return' });
      await act({ kind: 'scout' });
      assert.notEqual(B.raidData.active?.defenderProfileId, record.defenderProfileId, 'shielded base is not offered');
      await act({ kind: 'cancel' });
    }

    // Idempotent delivery: a retried delivery adds nothing.
    const count = A.progression.defenseReports.length;
    await manager.deliverDefense({ defenderProfileId: record.defenderProfileId!, report: defenseReport!, shieldUntil: 0 });
    assert.equal(A.progression.defenseReports.length, count, 'duplicate delivery ignored');

    // Offline defender: delivered into the save file and visible on next login.
    await manager.leave(21);
    await manager.deliverDefense({
      defenderProfileId: record.defenderProfileId!,
      report: { ...defenseReport!, raidId: 'offline-raid' }, shieldUntil: now() + 5_000,
    });
    await manager.enter({ id: 23, name: 'Defender', color: '#f00', clientId: 'p4-defender', send: () => undefined });
    const A2 = manager.homeGame(23)!;
    A2.stop();
    assert.ok(A2.progression.defenseReports.some((r) => r.raidId === 'offline-raid'), 'offline delivery persisted');

    // Attacking breaks your own shield.
    A2.progression.shieldUntil = now() + 3_600_000;
    A2.players.get(23)!.age = 2;
    place(A2, 'army_camp', 1, 23);
    const did = io(A2).nextId++;
    A2.units.set(did, createUnit(did, 23, 'attack_drone', hubOf(A2, 23).tileX - 1.5, hubOf(A2, 23).tileY + 0.5));
    await manager.raid(23, { kind: 'scout' });
    await manager.raid(23, { kind: 'reserve', army: army({ attack_drone: 1 }) });
    const z2 = deployZone(A2.raidData.active!.snapshot);
    await manager.raid(23, { kind: 'deploy', unit: 'attack_drone', x: z2.x0 + 1, y: z2.y0 + 1 });
    assert.ok(A2.progression.shieldUntil <= now(), 'first deployment breaks the attacker shield');
    await manager.leave(23);
    await manager.leave(22);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  requirementTableIsReachable();
  await progression();
  raidMechanics();
  matchmaking();
  await playerSnapshots();
  console.log('home phase 4: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
