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
}
