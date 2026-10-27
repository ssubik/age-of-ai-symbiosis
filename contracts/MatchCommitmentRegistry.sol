// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MatchCommitmentRegistry {
    mapping(bytes32 => bytes32) public archiveHashes;
    event MatchCommitted(bytes32 indexed matchId, bytes32 indexed archiveHash, address indexed submitter);

    function commit(bytes32 matchId, bytes32 archiveHash) external {
        require(matchId != bytes32(0) && archiveHash != bytes32(0), "empty commitment");
        require(archiveHashes[matchId] == bytes32(0), "already committed");
        archiveHashes[matchId] = archiveHash;
        emit MatchCommitted(matchId, archiveHash, msg.sender);
    }
}
