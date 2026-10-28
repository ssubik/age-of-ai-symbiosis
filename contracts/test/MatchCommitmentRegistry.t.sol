// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MatchCommitmentRegistry} from "../MatchCommitmentRegistry.sol";

contract MatchCommitmentRegistryTest {
    function testCommitStoresHash() public {
        MatchCommitmentRegistry registry = new MatchCommitmentRegistry();
        bytes32 matchId = keccak256("match-1");
        bytes32 archiveHash = keccak256("archive-1");
        registry.commit(matchId, archiveHash);
        require(registry.archiveHashes(matchId) == archiveHash, "hash not stored");
    }

    function testCannotOverwriteCommitment() public {
        MatchCommitmentRegistry registry = new MatchCommitmentRegistry();
        bytes32 matchId = keccak256("match-1");
        registry.commit(matchId, keccak256("archive-1"));
        try registry.commit(matchId, keccak256("archive-2")) {
            revert("overwrite accepted");
        } catch {}
    }

    function testCommitWithLedgerAnchorsHead() public {
        MatchCommitmentRegistry registry = new MatchCommitmentRegistry();
        bytes32 matchId = keccak256("match-2");
        bytes32 head = keccak256("ledger-head");
        registry.commitWithLedger(matchId, keccak256("archive-2"), head, 42);
        (bytes32 storedHead, uint64 height) = registry.ledgers(matchId);
        require(storedHead == head && height == 42, "ledger not anchored");
        require(registry.archiveHashes(matchId) == keccak256("archive-2"), "archive not stored");
    }

    function testLedgerCommitCannotOverwrite() public {
        MatchCommitmentRegistry registry = new MatchCommitmentRegistry();
        bytes32 matchId = keccak256("match-3");
        registry.commitWithLedger(matchId, keccak256("a"), keccak256("h"), 1);
        try registry.commitWithLedger(matchId, keccak256("b"), keccak256("h2"), 2) {
            revert("overwrite accepted");
        } catch {}
    }
}
