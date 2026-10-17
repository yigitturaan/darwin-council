// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DarwinLineage {
    address public immutable owner;

    struct Analyst {
        bytes32 parentId;
        bytes32 specificationHash;
        uint8 status; // 1 trial, 2 active, 3 rejected, 4 retired
        uint64 createdAt;
        uint64 decidedAt;
        bytes32 decisionHash;
    }

    mapping(bytes32 => Analyst) public analysts;

    event AnalystRegistered(bytes32 indexed analystId, bytes32 indexed parentId,
        bytes32 specificationHash, uint8 status);
    event AnalystDecided(bytes32 indexed analystId, uint8 status, bytes32 evidenceHash);

    modifier onlyOwner() {
        require(msg.sender == owner, "owner only");
        _;
    }

    constructor() { owner = msg.sender; }

    function registerFounder(bytes32 analystId, bytes32 specificationHash) external onlyOwner {
        require(analystId != bytes32(0) && specificationHash != bytes32(0), "empty");
        require(analysts[analystId].status == 0, "already registered");
        analysts[analystId] = Analyst(bytes32(0), specificationHash, 2, uint64(block.timestamp), uint64(block.timestamp), bytes32(0));
        emit AnalystRegistered(analystId, bytes32(0), specificationHash, 2);
    }

    function registerCandidate(bytes32 analystId, bytes32 parentId, bytes32 specificationHash) external onlyOwner {
        require(analystId != bytes32(0) && parentId != bytes32(0) && specificationHash != bytes32(0), "empty");
        require(analysts[analystId].status == 0, "already registered");
        require(analysts[parentId].status == 2, "parent not active");
        analysts[analystId] = Analyst(parentId, specificationHash, 1, uint64(block.timestamp), 0, bytes32(0));
        emit AnalystRegistered(analystId, parentId, specificationHash, 1);
    }

    function decide(bytes32 analystId, uint8 status, bytes32 evidenceHash) external onlyOwner {
        require(status == 2 || status == 3, "bad status");
        require(evidenceHash != bytes32(0), "empty evidence");
        Analyst storage analyst = analysts[analystId];
        require(analyst.status == 1, "not in trial");
        analyst.status = status;
        analyst.decidedAt = uint64(block.timestamp);
        analyst.decisionHash = evidenceHash;
        emit AnalystDecided(analystId, status, evidenceHash);
    }

    function retire(bytes32 analystId, bytes32 evidenceHash) external onlyOwner {
        require(evidenceHash != bytes32(0), "empty evidence");
        Analyst storage analyst = analysts[analystId];
        require(analyst.status == 2, "not active");
        analyst.status = 4;
        analyst.decidedAt = uint64(block.timestamp);
        analyst.decisionHash = evidenceHash;
        emit AnalystDecided(analystId, 4, evidenceHash);
    }
}
