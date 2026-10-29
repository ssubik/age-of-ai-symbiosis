import type { DefenseSnapshot, RaidOutcome, RaidReplay } from '@age/shared';
import { Game, type RoomMember, type SendFn } from '../game/room';
import { deployZone, verifySnapshot } from './snapshot';

/** Fixed id for the snapshot's owner inside a raid simulation. Never a connection id. */
export const RAID_DEFENDER_ID = 1_000_000_000;

export function createRaidGame(
  snapshot: DefenseSnapshot,
  attacker: RoomMember,
  send: SendFn,
  onEnd?: (outcome: RaidOutcome) => void,
): Game {
  const defender: RoomMember = { id: RAID_DEFENDER_ID, name: snapshot.label, color: '#f47975' };
  return new Game([attacker, defender], send, () => undefined, 'normal', 'classic', 'symbiosis', snapshot.id, {
    session: 'raid',
    raid: { snapshot, zone: deployZone(snapshot), onEnd },
  });
}

/** Re-simulates a raid from its pinned snapshot and recorded deployments. The
 * live raid runs the same `Game` with the same inputs at the same ticks, so the
 * outcome (and its checksum) must match exactly. */
export function simulateRaid(snapshot: DefenseSnapshot, replay: RaidReplay): RaidOutcome {
  if (!verifySnapshot(snapshot) || snapshot.checksum !== replay.snapshotChecksum) {
    throw new Error(`raid snapshot ${snapshot.id} failed checksum verification`);
  }
  if (replay.deploys.length === 0) throw new Error('raid replay has no deployments');
  const game = createRaidGame(snapshot, { id: 1, name: 'Replay', color: '#39c6e8' }, () => undefined);
  game.setRaidReserve(replay.reserved, replay.maxTicks, replay.research ?? {});
  if (replay.surrenderAt !== undefined) game.setRaidSurrenderAt(replay.surrenderAt);
  let next = 0;
  while (!game.raidOutcome) {
    while (next < replay.deploys.length && replay.deploys[next].tick === game.tickNow) {
      const d = replay.deploys[next++];
      const error = game.raidDeploy(d.unit, d.x, d.y);
      if (error) throw new Error(`raid replay deploy rejected at tick ${d.tick}: ${error}`);
    }
    if (next < replay.deploys.length && replay.deploys[next].tick < game.tickNow) {
      throw new Error('raid replay deployments are out of order');
    }
    game.advance();
    if (game.tickNow > replay.maxTicks + 1) throw new Error('raid replay did not terminate');
  }
  return game.raidOutcome!;
}
