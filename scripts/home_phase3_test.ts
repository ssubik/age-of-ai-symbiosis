// Phase 3 for the persistent Home (master spec §6, §9.3, §10, §11): bot snapshots,
// scouting, reservation, perimeter deployment, autonomous combat, stars, bounded
// system-funded rewards, replay determinism and exactly-once settlement across
// retry, disconnect and restart.
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RaidAction, RaidArmy, ServerMessage } from '../shared/src';
import { BUILDING_DEFS, canRaidTransition, isFlyingUnit, MAP_SIZE, RAID_NEXT_SCOUT_GOLD, RAID_REWARD_BY_LEVEL } from '../shared/src/constants';
import type { Game } from '../server/src/game/room';
import { createUnit } from '../server/src/game/state';
import { HomeManager } from '../server/src/home/manager';
import { JsonHomeRepository, migrateHomeSave } from '../server/src/home/repository';
import type { RaidSessionRecord } from '../server/src/home/types';
import { settleRaid } from '../server/src/raid/orchestrator';
import { createRaidGame, simulateRaid } from '../server/src/raid/sim';
import { botSnapshot, deployZone, inDeployZone, verifySnapshot } from '../server/src/raid/snapshot';

let clock = 2_100_000_000_000;
const now = () => clock;

type Inbox = ServerMessage[];
function connection(id: number, clientId: string, inbox: Inbox) {
  return { id, name: `P${id}`, color: '#39c6e8', clientId, send: (m: ServerMessage) => inbox.push(m) };
}
const errors = (inbox: Inbox) => inbox.filter((m) => m.type === 'error').map((m) => (m as { code: string }).code);
const lastSession = (inbox: Inbox) => [...inbox].reverse().find((m) => m.type === 'gameStart') as Extract<ServerMessage, { type: 'gameStart' }> | undefined;

function army(partial: Partial<RaidArmy>): RaidArmy {
  return { attack_drone: 0, fighter: 0, rocket_launcher: 0, siege_mech: 0, stealth_bomber: 0, plasma_tank: 0, iron_guardian: 0, aegis_valkyrie: 0, ...partial };
}

/** Gives a Home a camp and a manufactured army (Phase 2 covers how they are made). */
function arm(home: Game, playerId: number, drones: number, mechs: number): void {
  const internals = home as unknown as { nextId: number; validFootprint(x: number, y: number, s: number): boolean; blockFootprint(x: number, y: number, s: number): void };
  const hub = [...home.buildings.values()].find((b) => b.type === 'town_center')!;
  let placed = false;
  for (let r = 5; r < 30 && !placed; r++) {
    for (let y = hub.tileY - r; y <= hub.tileY + r && !placed; y++) {
      for (let x = hub.tileX - r; x <= hub.tileX + r && !placed; x++) {
        if (!internals.validFootprint(x - 1, y - 1, 5)) continue;
        const id = internals.nextId++;
        home.buildings.set(id, { id, owner: playerId, type: 'army_camp', tileX: x, tileY: y, hp: 600, progress: 1, queue: [] });
        internals.blockFootprint(x, y, 3);
        placed = true;
      }
    }
  }
  for (let i = 0; i < drones + mechs; i++) {
    const id = internals.nextId++;
    home.units.set(id, createUnit(id, playerId, i < drones ? 'attack_drone' : 'siege_mech', hub.tileX - 1.5, hub.tileY + 0.5));
  }
}

const count = (home: Game, type: string) => [...home.units.values()].filter((u) => u.type === type).length;

/** Runs a started live raid to its end on manual ticks (the 10 Hz timer is stopped). */
function finish(raid: Game, maxTicks = 2_000): void {
  raid.stop();
  for (let i = 0; i < maxTicks && !raid.raidOutcome; i++) raid.advance();
  assert.ok(raid.raidOutcome, 'raid ended');
}

function snapshotsAreLegal(): void {
  for (let level = 1; level <= 5; level++) {
    const a = botSnapshot(4242 + level, level);
    const b = botSnapshot(4242 + level, level);
    assert.deepEqual(a, b, 'bot snapshots are deterministic');
    assert.ok(verifySnapshot(a));
    assert.equal(a.buildings.filter((x) => x.type === 'town_center').length, 1, 'exactly one Hub');
    const seen = new Set<number>();
    for (const s of a.buildings) {
      const size = BUILDING_DEFS[s.type].size;
      assert.ok(s.tileX >= 0 && s.tileY >= 0 && s.tileX + size <= MAP_SIZE && s.tileY + size <= MAP_SIZE, 'in bounds');
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
        const key = (s.tileY + dy) * MAP_SIZE + s.tileX + dx;
        assert.ok(!seen.has(key), 'no overlapping footprints');
        seen.add(key);
      }
    }
    const zone = deployZone(a);
    for (const s of a.buildings) assert.ok(!inDeployZone(zone, s.tileX, s.tileY), 'perimeter excludes the base');
    const tampered = { ...a, label: 'Edited' };
    assert.equal(verifySnapshot(tampered), false, 'checksum detects edits');
  }
  assert.ok(!canRaidTransition('SETTLED', 'SETTLING'), 'settled raids never reopen');
  assert.ok(!canRaidTransition('IN_PROGRESS', 'ARMY_RESERVED'), 'no un-deploying');
  assert.ok(!canRaidTransition('ARMY_RESERVED', 'ARMY_RESERVED'), 'no duplicate reservation');
}

function defensesRespectTargetClass(): void {
  const snap = botSnapshot(99, 2);
  const zone = deployZone(snap);
  const raid = createRaidGame(snap, { id: 7, name: 'A', color: '#fff' }, () => undefined);
  raid.setRaidReserve(army({ attack_drone: 6, siege_mech: 2 }), 900);
  for (let i = 0; i < 6; i++) assert.equal(raid.raidDeploy('attack_drone', zone.x0 + 1 + i, zone.y0 + 1), null);
  for (let i = 0; i < 2; i++) assert.equal(raid.raidDeploy('siege_mech', zone.x0 + 1, zone.y0 + 3 + i), null);
  let air = 0; let ground = 0;
  while (!raid.raidOutcome) {
    raid.advance();
    for (const b of raid.buildings.values()) {
      if (b.targetId === undefined) continue;
      const target = raid.units.get(b.targetId);
      if (!target) continue;
      if (b.type === 'point_turret') { assert.ok(!isFlyingUnit(target.type), 'point turret never targets air'); ground++; }
      if (b.type === 'anti_air') { assert.ok(isFlyingUnit(target.type), 'anti-air never targets ground'); air++; }
    }
  }
  assert.ok(air > 0 && ground > 0, 'both defense classes engaged');
  assert.equal(raid.raidDeploy('attack_drone', zone.x0 + 1, zone.y0 + 1), 'err.raid_over');
}

function liveMatchesReplay(): void {
  // Live-style: different attacker id, deployments interleaved with ticks.
  const snap = botSnapshot(31337, 2);
  const zone = deployZone(snap);
  const live = createRaidGame(snap, { id: 42, name: 'Live', color: '#fff' }, () => undefined);
  live.setRaidReserve(army({ attack_drone: 8, siege_mech: 2 }), 1_800); // 2 drones stay undeployed
  const deploys: { tick: number; unit: keyof RaidArmy; x: number; y: number; homeUnitId: number }[] = [];
  const plan: [number, keyof RaidArmy][] = [[0, 'attack_drone'], [0, 'attack_drone'], [3, 'siege_mech'], [40, 'attack_drone'], [40, 'attack_drone'], [41, 'attack_drone'], [90, 'siege_mech'], [120, 'attack_drone']];
  let n = 0;
  for (const [tick, unit] of plan) {
    while (live.tickNow < tick) live.advance();
    const x = zone.x1 - 2 - n;
    const y = zone.y0 + 1;
    assert.equal(live.raidDeploy(unit, x, y), null);
    deploys.push({ tick: live.tickNow, unit, x, y, homeUnitId: n++ });
  }
  while (!live.raidOutcome) live.advance();
  const reserved = army({ attack_drone: 8, siege_mech: 2 });
  const replayed = simulateRaid(snap, { rulesVersion: 1, snapshotId: snap.id, snapshotChecksum: snap.checksum, maxTicks: 1_800, reserved, deploys });
  assert.deepEqual(replayed, live.raidOutcome, 'replay reproduces the live outcome and checksum');
}

async function managerLoop(): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'age-raid-'));
  const crashDir = await mkdtemp(path.join(os.tmpdir(), 'age-raid-crash-'));
  try {
    const repo = new JsonHomeRepository(dir);
    const manager = new HomeManager(repo, now);
    const inbox: Inbox = [];
    const conn = connection(11, 'raid-loop-client', inbox);
    await manager.enter(conn);
    const home = manager.homeGame(11)!;
    home.stop(); // drive the Home tick manually; persistence does not depend on it
    arm(home, 11, 10, 2);
    const act = (action: RaidAction) => manager.raid(11, action);

    // Scout: free, isolated raid view, ±1 City Level, pinned immutable snapshot.
    const goldBefore = home.players.get(11)!.resources.gold;
    await act({ kind: 'scout' });
    assert.equal(lastSession(inbox)?.session, 'raid', 'scouting opens the raid view');
    assert.equal(home.players.get(11)!.resources.gold, goldBefore, 'first scout is free');
    await act({ kind: 'next' });
    assert.equal(home.players.get(11)!.resources.gold, goldBefore - RAID_NEXT_SCOUT_GOLD, 'Next costs gold once');
    const record = home.raidData.active as RaidSessionRecord;
    assert.equal(record.state, 'SCOUTING');
    assert.ok(Math.abs(record.snapshot.cityLevel - home.homeLevel) <= 1, 'matchmaking within ±1 level');
    const pinned = structuredClone(record.snapshot);
    const raid = manager.raidGame(11)!;
    assert.ok(raid !== home && raid.buildings.size === pinned.buildings.length, 'raid world is the snapshot, not Home');

    // Home changes never alter a scouted base.
    arm(home, 11, 0, 0);
    assert.deepEqual(record.snapshot, pinned, 'snapshot immutable while Home evolves');

    // Commands for Home are ignored while raiding (no direct control).
    const before = home.buildings.size;
    manager.command(11, { kind: 'delete', ids: [...home.buildings.keys()].slice(-1) });
    (home as unknown as { step(): void }).step();
    assert.equal(home.buildings.size, before, 'Home commands are dropped during a raid');

    // Reserve: all-or-nothing, units leave Home into the record.
    await act({ kind: 'reserve', army: army({ attack_drone: 99 }) });
    assert.ok(errors(inbox).includes('err.raid_not_manufactured'));
    assert.equal(record.state, 'SCOUTING');
    assert.equal(count(home, 'attack_drone'), 10, 'failed reservation moves nothing');
    await act({ kind: 'reserve', army: army({ attack_drone: 8, siege_mech: 2 }) });
    assert.equal(record.state, 'ARMY_RESERVED');
    assert.equal(count(home, 'attack_drone'), 2, 'reserved drones left Home');
    assert.equal(record.reserved.length, 10);
    await act({ kind: 'reserve', army: army({ attack_drone: 1 }) });
    assert.ok(errors(inbox).includes('err.raid_stale'), 'duplicate reservation rejected');
    assert.equal(record.reserved.length, 10);

    // Deploy: illegal tile consumes nothing; legal deploys consume exactly one unit each.
    const zone = deployZone(record.snapshot);
    await act({ kind: 'deploy', unit: 'attack_drone', x: (zone.ix0 + zone.ix1) / 2, y: (zone.iy0 + zone.iy1) / 2 });
    assert.ok(errors(inbox).includes('err.raid_perimeter'));
    assert.equal(record.reserved.length, 10);
    for (let i = 0; i < 6; i++) await act({ kind: 'deploy', unit: 'attack_drone', x: zone.x0 + 1 + i, y: zone.y0 + 1 });
    await act({ kind: 'deploy', unit: 'siege_mech', x: zone.x0 + 1, y: zone.y0 + 3 });
    assert.equal(record.state, 'IN_PROGRESS');
    assert.equal(record.deploys.length, 7);
    assert.equal(record.reserved.length, 3, 'two drones and one mech still held');
    const ids = new Set([...home.units.keys(), ...record.reserved.map((u) => u.id), ...record.deploys.map((d) => d.homeUnitId)]);
    assert.equal(ids.size, home.units.size + record.reserved.length + record.deploys.length, 'each unit identity in exactly one place');

    // Combat to the end; settlement is system-funded and bounded.
    const resourcesBefore = { ...home.players.get(11)!.resources };
    const trophiesBefore = home.raidData.trophies;
    finish(raid);
    assert.equal(home.raidData.active, null, 'raid settled');
    const report = home.raidData.reports[0];
    assert.equal(report.raidId, record.id);
    assert.equal(record.state, 'SETTLED');
    assert.equal(report.deployed, 7);
    assert.equal(report.returned, 3);
    assert.equal(count(home, 'attack_drone'), 4, '2 at Home + 2 returned; 6 consumed');
    assert.equal(count(home, 'siege_mech'), 1, '1 returned; 1 consumed');
    const offer = RAID_REWARD_BY_LEVEL[record.snapshot.cityLevel];
    for (const key of ['food', 'wood', 'gold', 'stone'] as const) {
      assert.ok(report.reward[key] >= 0 && report.reward[key] <= offer[key], `reward ${key} bounded by pinned offer`);
      assert.ok(Math.abs(home.players.get(11)!.resources[key] - resourcesBefore[key] - report.reward[key]) < 1, `reward ${key} credited once`);
    }
    assert.equal(home.raidData.trophies - trophiesBefore, report.trophiesDelta);
    assert.ok(report.stars === 0 ? report.trophiesDelta <= 0 : report.trophiesDelta > 0);
    assert.equal(lastSession(inbox)?.session, 'raid', 'result screen stays on the raid');

    // Replay determinism against the real settled raid.
    assert.equal(simulateRaid(record.snapshot, report.replay).checksum, report.outcomeChecksum, 'replay checksum matches live');

    // Retried settlement returns the stored report and changes nothing.
    const frozen = JSON.stringify({ r: home.players.get(11)!.resources, t: home.raidData.trophies, u: home.units.size, n: home.raidData.reports.length });
    record.state = 'SETTLING';
    assert.deepEqual(settleRaid(home, record, now()), report);
    assert.equal(JSON.stringify({ r: home.players.get(11)!.resources, t: home.raidData.trophies, u: home.units.size, n: home.raidData.reports.length }), frozen, 'retry is a no-op');

    await act({ kind: 'return' });
    assert.equal(lastSession(inbox)?.session, 'home');

    // Cancel before deploy returns everything.
    await act({ kind: 'scout' });
    await act({ kind: 'reserve', army: army({ attack_drone: 2 }) });
    assert.equal(count(home, 'attack_drone'), 2);
    await act({ kind: 'cancel' });
    assert.equal(count(home, 'attack_drone'), 4, 'cancelled reservation fully returned');
    assert.equal(home.raidData.active, null);

    // Scout offers expire after 60 seconds.
    await act({ kind: 'scout' });
    clock += 61_000;
    await act({ kind: 'reserve', army: army({ attack_drone: 1 }) });
    assert.ok(errors(inbox).includes('err.raid_scout_expired'));
    assert.equal(count(home, 'attack_drone'), 4);

    // Surrender ends the raid on the next tick and still settles once.
    await act({ kind: 'scout' });
    await act({ kind: 'reserve', army: army({ attack_drone: 2 }) });
    const surrenderRecord = home.raidData.active!;
    const surrenderZone = deployZone(surrenderRecord.snapshot);
    await act({ kind: 'deploy', unit: 'attack_drone', x: surrenderZone.x0 + 1, y: surrenderZone.y0 + 1 });
    const surrenderRaid = manager.raidGame(11)!;
    surrenderRaid.stop();
    for (let i = 0; i < 10; i++) surrenderRaid.advance();
    await act({ kind: 'surrender' });
    finish(surrenderRaid, 5);
    assert.equal(home.raidData.reports[0].reason, 'surrender');
    assert.equal(home.raidData.reports[0].returned, 1);
    const surrenderReplay = simulateRaid(surrenderRecord.snapshot, home.raidData.reports[0].replay);
    assert.equal(surrenderReplay.reason, 'surrender', 'replay reproduces the surrender');
    assert.equal(surrenderReplay.checksum, home.raidData.reports[0].outcomeChecksum);
    await act({ kind: 'return' });

    // Disconnect mid-raid: finishes from recorded deployments, settles exactly once.
    await act({ kind: 'scout' });
    await act({ kind: 'reserve', army: army({ attack_drone: 3 }) });
    const dzone = deployZone(home.raidData.active!.snapshot);
    await act({ kind: 'deploy', unit: 'attack_drone', x: dzone.x0 + 1, y: dzone.y0 + 1 });
    await act({ kind: 'deploy', unit: 'attack_drone', x: dzone.x0 + 2, y: dzone.y0 + 1 });
    const disconnected = home.raidData.active!;
    manager.raidGame(11)!.stop();
    const reportsBefore = home.raidData.reports.length;
    await manager.leave(11);
    assert.equal(home.raidData.reports.length, reportsBefore + 1, 'one settlement on disconnect');
    assert.equal(home.raidData.reports[0].raidId, disconnected.id);
    assert.equal(home.raidData.reports[0].returned, 1);
    assert.equal(disconnected.state, 'SETTLED');

    // Restart: the save has everything; no duplicates, no second settlement.
    const inbox2: Inbox = [];
    const conn2 = connection(12, 'raid-loop-client', inbox2);
    await manager.enter(conn2);
    const reloaded = manager.homeGame(12)!;
    reloaded.stop();
    assert.equal(reloaded.raidData.reports.length, reportsBefore + 1, 'no re-settlement after reload');
    assert.equal(reloaded.raidData.trophies, home.raidData.trophies);
    assert.equal(count(reloaded, 'attack_drone'), count(home, 'attack_drone'), 'army identical after reload');
    assert.equal(new Set(reloaded.raidData.settled).size, reloaded.raidData.settled.length, 'settlement keys unique');

    // Crash mid-raid: a save taken during IN_PROGRESS recovers on the next boot.
    const act2 = (action: RaidAction) => manager.raid(12, action);
    await act2({ kind: 'scout' });
    assert.equal(count(reloaded, 'attack_drone'), 1, 'earlier raids consumed all but one drone');
    await act2({ kind: 'reserve', army: army({ attack_drone: 1, siege_mech: 1 }) });
    const czone = deployZone(reloaded.raidData.active!.snapshot);
    await act2({ kind: 'deploy', unit: 'attack_drone', x: czone.x0 + 1, y: czone.y0 + 1 });
    manager.raidGame(12)!.stop();
    const crashedId = reloaded.raidData.active!.id;
    const profileId = HomeManager.profileId('raid-loop-client');
    await repo.save(reloaded.captureHomeState(profileId)); // last write before the "crash"
    await cp(dir, crashDir, { recursive: true });
    await manager.leave(12); // tidy the original process; the copy is the crashed state
    const survivor = new HomeManager(new JsonHomeRepository(crashDir), now);
    await survivor.enter(connection(13, 'raid-loop-client', []));
    const recovered = survivor.homeGame(13)!;
    recovered.stop();
    assert.equal(recovered.raidData.active, null, 'recovered raid is terminal');
    assert.equal(recovered.raidData.reports[0].raidId, crashedId, 'recovered raid settled');
    assert.equal(recovered.raidData.reports[0].returned, 1, 'the undeployed Siege Mech came home');
    assert.equal(count(recovered, 'siege_mech'), 1, 'the one remaining mech is home again');
    assert.equal(recovered.raidData.settled.filter((k) => k === crashedId).length, 1, 'settled exactly once');
    await survivor.leave(13);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(crashDir, { recursive: true, force: true });
  }
}

function migration(): void {
  const v1 = { version: 1, profileId: 'd'.repeat(64) };
  const migrated = migrateHomeSave(v1) as { version: number; raid: unknown; progression: unknown };
  assert.equal(migrated.version, 3, 'v1 migrates through every step to current');
  assert.deepEqual(migrated.raid, { trophies: 0, scoutCounter: 0, active: null, reports: [], settled: [], outbox: [] });
  assert.deepEqual(migrated.progression, { research: {}, shieldUntil: 0, defenseReports: [], publishedSignature: '' });
}

async function main(): Promise<void> {
  snapshotsAreLegal();
  defensesRespectTargetClass();
  liveMatchesReplay();
  migration();
  await managerLoop();
  console.log('home phase 3: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
