# Age of AI: Symbiosis — ELON, blockchain, and the five-minute demo

## The one-sentence explanation

**ELON is a non-transferable record of useful contribution; the ledger makes important game history tamper-evident; blockchain, when enabled, stores only a final proof fingerprint.**

None of these replaces the real-time strategy game or its authoritative server.

## What ELON means

ELON stands for **Energy, Labor, Obligation, and Need**. It represents a player's standing in the city and match: useful infrastructure built, productive work performed, declared needs served, and reliable participation.

ELON is:

- a gameplay measure of contribution and stewardship;
- non-transferable between players;
- visible in the HUD, results, and city ledger;
- recorded alongside the actions that produced it.

ELON is not:

- cryptocurrency, cash, or a wallet balance;
- a token or NFT;
- something players can trade or sell;
- a substitute for Energy, Alloys, or Compute;
- a way to buy combat power with real money.

In arena matches, the Impact display combines contribution with stewardship and reliability. In the persistent city, ELON may be settled into the city ledger. “Settlement” means moving whole ELON from the currently playable balance into a sealed historical record. It does not mean selling, cashing out, or transferring value.

### Is ELON settled between bases?

No ELON is transferred from one base to another. After an attack, the raid result and system-funded resource reward are settled, and contribution can be recorded in the attacker's own ledger. The defender does not pay the attacker ELON and does not lose ELON. This preserves the central rule that ELON is standing, not currency.

The player-facing sequence is:

1. Base A attacks a saved snapshot of Base B or a computer outpost.
2. The authoritative raid simulation determines destruction, stars, and outcome.
3. The system settles the raid report and system-funded resource reward.
4. Relevant contribution is recorded as ELON for the contributing player.
5. The player may seal whole ELON into their own city ledger.
6. If blockchain anchoring is enabled, only the sealed ledger hash is submitted as a receipt.

## What the ledger does

The authoritative server records important events such as construction, production, research, raids, defense, and ELON changes. Records are grouped into blocks whose hashes refer to the previous block.

This creates a tamper-evident history:

1. An important event occurs on the authoritative server.
2. The event is added to the pending ledger.
3. The server seals a block with a cryptographic hash.
4. The next block links to that hash.
5. Changing old history would break verification of the blocks after it.

The ledger does not decide whether an attack hits, whether a building is legal, or who won. The ordinary server simulation does that.

## What blockchain does

Blockchain anchoring is optional and is disabled unless the server operator explicitly configures it.

When enabled, the game submits a final hash—effectively a fingerprint of the sealed ledger—to a commitment contract. That receipt can later show that the same ledger existed at the time of anchoring without putting the complete match on-chain.

Blockchain does not:

- run the game simulation;
- validate movement, combat, resources, or victory;
- store ordinary gameplay events or player cities;
- turn ELON into a token;
- require a player wallet;
- make a chain outage change a match result.

The player-facing status must always be explicit: **off**, **local**, **submitted**, **confirmed**, or **failed**. “Off” is a normal supported mode, not a broken match.

## Five-minute demo experience

The demo has two complementary routes.

### Route A: guided city and computer outpost

The intended quick path is:

1. **Power:** build a Solar Field. Attack is not available yet.
2. **Automation:** build a Robotics Workshop, completing the infrastructure for the first Hub upgrade.
3. **Weapons unlock:** upgrade the Civic Hub to City Level 2, unlocking the Drone Factory.
4. **Production:** build a Drone Factory.
5. **Storage:** build an Army Camp so completed combat units have capacity.
6. **Strike force:** manufacture at least one Attack Drone. Attack deployment is now unlocked.
7. **Attack:** open **Attack**, scout a generated computer outpost, reserve units, and deploy them in the cyan perimeter.
8. **Next target:** use **Next computer base** to try another seeded layout.
9. **Record:** after the raid, seal earned ELON into the attacker's own ledger; nothing is transferred from the defender.

A fresh demo city begins with full base storage and three different builders. Parallel construction is intentional: a quick player can reach the first raid in about five minutes. Computer outposts are deterministic snapshots, so they are replayable and require no second human player.

For this vertical slice, “base complete” means a powered, strike-capable base—not completion of the entire long-term City Level 5 progression tree.

### Route B: immediate skirmish

**Skirmish** starts a fast 1v1 against a computer base in Battle mode. The player begins in an advanced age with abundant resources, can construct a larger base immediately, manufacture an army, and attack the enemy Command Core. This is the fastest way to demonstrate the RTS combat and AI Commander.

## What the player should learn

By the end of the demo, a player should be able to say:

- “I built a functioning AI-industry base.”
- “I attacked a computer-controlled outpost.”
- “ELON measured contribution; it was not cryptocurrency.”
- “The ledger preserved a verifiable history.”
- “Blockchain was an optional receipt, not the game engine.”

## Implementation map

- ELON and match ledger: `server/src/ledger.ts`, `server/src/home/ledger.ts`
- Optional proof adapters: `server/src/proofs.ts`
- Player explanation and city ledger: `client/src/screens/game.ts`, `client/src/screens/ledger.ts`
- Computer outpost generation: `server/src/raid/snapshot.ts`
- Raid selection and deterministic settlement: `server/src/raid/orchestrator.ts`
- Demo resource and battle tuning: `server/src/game/room.ts`, `server/src/lobby.ts`

