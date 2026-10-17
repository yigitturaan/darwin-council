// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DarwinCommit {
    struct Record { bytes32 commitment; bool revealed; address author; }
    mapping(bytes32 => Record) public records;

    event Committed(bytes32 indexed roundId, bytes32 indexed commitment, address indexed author);
    event Revealed(bytes32 indexed roundId, bytes payload);

    function commit(bytes32 roundId, bytes32 commitment) external {
        require(roundId != bytes32(0) && commitment != bytes32(0), "empty");
        require(records[roundId].author == address(0), "already committed");
        records[roundId] = Record(commitment, false, msg.sender);
        emit Committed(roundId, commitment, msg.sender);
    }

    function reveal(bytes32 roundId, bytes calldata payload) external {
        Record storage record = records[roundId];
        require(msg.sender == record.author, "author only");
        require(!record.revealed, "already revealed");
        require(keccak256(payload) == record.commitment, "bad preimage");
        record.revealed = true;
        emit Revealed(roundId, payload);
    }
}
