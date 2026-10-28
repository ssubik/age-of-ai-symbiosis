// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Non-token commitment registry: anchors a finished match's archive hash and
/// the head of its in-match ledger. No balances, transfers, or wallet tokens.
contract MatchCommitmentRegistry {
    struct LedgerAnchor {
        bytes32 head;
        uint64 height;
    }

    mapping(bytes32 => bytes32) public archiveHashes;
    mapping(bytes32 => LedgerAnchor) public ledgers;

    event MatchCommitted(bytes32 indexed matchId, bytes32 indexed archiveHash, address indexed submitter);
    event LedgerAnchored(bytes32 indexed matchId, bytes32 head, uint64 height);

    function commit(bytes32 matchId, bytes32 archiveHash) public {
        require(matchId != bytes32(0) && archiveHash != bytes32(0), "empty commitment");
        require(archiveHashes[matchId] == bytes32(0), "already committed");
        archiveHashes[matchId] = archiveHash;
        emit MatchCommitted(matchId, archiveHash, msg.sender);
    }

    function commitWithLedger(bytes32 matchId, bytes32 archiveHash, bytes32 ledgerHead, uint64 ledgerHeight) external {
        require(ledgerHead != bytes32(0), "empty ledger");
        commit(matchId, archiveHash);
        ledgers[matchId] = LedgerAnchor(ledgerHead, ledgerHeight);
        emit LedgerAnchored(matchId, ledgerHead, ledgerHeight);
    }
}
