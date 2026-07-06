// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984Receiver} from "@openzeppelin/confidential-contracts/interfaces/IERC7984Receiver.sol";
import {MerkleTree} from "./MerkleTree.sol";

// Interface for the snarkjs-generated Groth16 verifier (privacyProof.circom)
// Deploy the output of `bash circuits/compile.sh` and pass its address to the constructor.
interface IVerifier {
  function verifyProof(
    uint256[2] calldata _pA,
    uint256[2][2] calldata _pB,
    uint256[2] calldata _pC,
    uint256[2] calldata _pubSignals // [0]=root  [1]=nullifier
  )
    external
    view
    returns (bool);
}

// Minimal interface for sending ERC-7984 confidential tokens out of the pool
interface IERC7984Pool {
  function confidentialTransfer(address to, euint64 amount) external returns (euint64);
}

// Minimal interface for unwrapping ERC-7984 back to ERC-20
// Uses the internal euint64 overload — no FHE input proof required from the pool
interface IERC7984Wrapper {
  function unwrap(address from, address to, euint64 amount) external returns (bytes32);
}

/**
 * @title PrivacyPool
 * @notice Confidential token mixing pool using FhEVM + ZK proofs.
 *
 * Deposit flow (ERC-7984 receiver pattern):
 *   User calls: token.confidentialTransferAndCall(pool, encAmount, proof, abi.encode(commitment))
 *   Token transfers confidential tokens to pool, then calls onConfidentialTransferReceived.
 *   Pool inserts commitment into the Merkle tree.
 *
 * Withdrawal flow:
 *   User generates a ZK proof off-chain (privacyProof.circom) and calls withdraw().
 *   Pool verifies proof via ZKVerifier, checks root, sends confidential tokens.
 */
contract PrivacyPool is ZamaEthereumConfig, MerkleTree, IERC7984Receiver {
  // ── State
  // ─────────────────────────────────────────────────────────────────

  IVerifier public immutable verifier;

  // Nullifiers spent — prevents double-withdraw
  mapping(bytes32 => bool) public nullifierSpent;

  // commitment → deposited (true once leaf is inserted)
  mapping(bytes32 => bool) private _deposited;

  // token → anonymity set size
  mapping(address => uint256) public anonymitySet;

  // ── Events

  event Deposit(address indexed token, bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);
  // Withdraw to ERC-7984 (synchronous)
  event Withdrawal(address indexed token, bytes32 indexed nullifierHash, address indexed recipient, uint256 timestamp);
  // Withdraw to ERC-20 (async — ERC-20 arrives after finalizeUnwrap is called by the gateway)
  event WithdrawalToERC20Requested(
    address indexed wrapper,
    bytes32 indexed nullifierHash,
    bytes32 indexed unwrapRequestId,
    address recipient,
    uint256 timestamp
  );

  // ── Constructor
  // ───────────────────────────────────────────────────────────

  constructor(address _verifier) MerkleTree(20) {
    verifier = IVerifier(_verifier);
  }

  // ── Deposit (via IERC7984Receiver callback)
  // Users deposit by calling:
  //   token.confidentialTransferAndCall(pool, encAmount, proof, abi.encode(commitment))
  // This keeps tx.to = token, so FHE proof verification succeeds.

  function onConfidentialTransferReceived(
    address, // operator
    address, // from
    euint64 amount,
    bytes calldata data
  ) external override returns (ebool) {
    bytes32 commitment = abi.decode(data, (bytes32));
    require(commitment != bytes32(0), "PrivacyPool: zero commitment");
    require(!_deposited[commitment], "PrivacyPool: commitment exists");

    FHE.allowThis(amount);

    _deposited[commitment] = true;
    uint32 leafIndex = _insert(commitment);
    anonymitySet[msg.sender]++; // msg.sender = token contract

    emit Deposit(msg.sender, commitment, leafIndex, block.timestamp);

    // Grant the token transient ACL on the return value so it can use it in FHE.select
    ebool result = FHE.asEbool(true);
    FHE.allowTransient(result, msg.sender);
    return result;
  }

  /**
   * @dev Validates the ZK proof and marks the nullifier spent.
   *      Reverts if the root is unknown, nullifier is already spent, or proof is invalid.
   *      Returns the nullifier so callers can use it in events.
   */
  function _validateAndSpendNullifier(
    uint256[2] calldata pA,
    uint256[2][2] calldata pB,
    uint256[2] calldata pC,
    uint256[2] calldata pubSignals
  ) private returns (bytes32 nullifier) {
    require(isKnownRoot(bytes32(pubSignals[0])), "PrivacyPool: unknown root");
    nullifier = bytes32(pubSignals[1]);
    require(!nullifierSpent[nullifier], "PrivacyPool: nullifier already spent");
    require(verifier.verifyProof(pA, pB, pC, pubSignals), "PrivacyPool: invalid proof");
    nullifierSpent[nullifier] = true;
  }

  /**
   * @notice Withdraw from pool — caller (msg.sender) receives ERC-7984 tokens.
   * @dev Connect with a fresh wallet so the withdrawal cannot be linked to the depositor.
   * @param token      ERC-7984 token address
   * @param amount     Plaintext withdrawal amount
   * @param pA         Groth16 proof pA
   * @param pB         Groth16 proof pB
   * @param pC         Groth16 proof pC
   * @param pubSignals [root, nullifier]
   */
  function withdraw(
    address token,
    uint256 amount,
    uint256[2] calldata pA,
    uint256[2][2] calldata pB,
    uint256[2] calldata pC,
    uint256[2] calldata pubSignals
  )
    external
  {
    bytes32 nullifier = _validateAndSpendNullifier(pA, pB, pC, pubSignals);

    euint64 withdrawAmount = FHE.asEuint64(uint64(amount));
    IERC7984Pool(token).confidentialTransfer(msg.sender, withdrawAmount);

    if (anonymitySet[token] > 0) anonymitySet[token]--;

    emit Withdrawal(token, nullifier, msg.sender, block.timestamp);
  }

  /**
   * @notice Withdraw from pool and unwrap to ERC-20 — caller (msg.sender) receives ERC-20.
   * @dev Connect with a fresh wallet so the withdrawal cannot be linked to the depositor.
   *      The actual ERC-20 transfer is async: it arrives after the gateway calls
   *      finalizeUnwrap(requestId, cleartextAmount, decryptionProof).
   * @param wrapper    ERC7984ERC20Wrapper token address
   * @param amount     Plaintext withdrawal amount
   * @param pA         Groth16 proof pA
   * @param pB         Groth16 proof pB
   * @param pC         Groth16 proof pC
   * @param pubSignals [root, nullifier]
   */
  function withdrawToERC20(
    address wrapper,
    uint256 amount,
    uint256[2] calldata pA,
    uint256[2][2] calldata pB,
    uint256[2] calldata pC,
    uint256[2] calldata pubSignals
  )
    external
  {
    bytes32 nullifier = _validateAndSpendNullifier(pA, pB, pC, pubSignals);

    euint64 withdrawAmount = FHE.asEuint64(uint64(amount));
    bytes32 requestId = IERC7984Wrapper(wrapper).unwrap(address(this), msg.sender, withdrawAmount);

    if (anonymitySet[wrapper] > 0) anonymitySet[wrapper]--;

    emit WithdrawalToERC20Requested(wrapper, nullifier, requestId, msg.sender, block.timestamp);
  }

  // ── Views
  // ─────────────────────────────────────────────────────────────────

  /**
   * @notice Check if a commitment has an active deposit.
   */
  function hasDeposit(bytes32 commitment) external view returns (bool) {
    return _deposited[commitment];
  }

  /**
   * @notice Get anonymity level label based on set size.
   */
  function getPrivacyLevel(address token) external view returns (string memory) {
    uint256 size = anonymitySet[token];
    if (size >= 100) return "MAXIMUM";
    if (size >= 20) return "HIGH";
    if (size >= 5) return "MEDIUM";
    return "LOW";
  }

  /**
   * @notice Update Merkle root after deposits are indexed off-chain.
   *         In production this would be a ZK-proven root update.
   * @dev Only callable by owner — replace with decentralized root update.
   */
}
