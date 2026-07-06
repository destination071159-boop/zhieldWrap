// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984Receiver} from "@openzeppelin/confidential-contracts/interfaces/IERC7984Receiver.sol";

// Minimal interface to transfer confidential tokens out
interface IERC7984Transfer {
  function confidentialTransfer(address to, euint64 amount) external returns (euint64);
}

/**
 * @title ConfidentialSwapPool
 * @notice Direct 1:1 confidential token swap pool — swap any supported cToken for another.
 *
 * Swap flow (single transaction, fully on-chain):
 *   User calls: cInput.confidentialTransferAndCall(pool, encAmount, proof, abi.encode(cOutput))
 *   cInput transfers encrypted tokens to pool, then calls onConfidentialTransferReceived.
 *   Pool immediately sends the same encrypted amount of cOutput back to the user.
 *
 * Privacy properties:
 *   - The swap AMOUNT is never revealed on-chain (FHE encrypted throughout).
 *   - The input token type is visible (msg.sender in the callback = cInput contract).
 *   - The output token type is visible (abi.decoded from calldata).
 *   - Sender is visible (from address in callback).
 *
 * Liquidity:
 *   - Admin pre-funds the pool with each supported cToken via
 *     cToken.wrap(poolAddress, amount) on the underlying ERC-20 wrapper.
 *   - No liquidity management is needed in this contract; the pool's
 *     cToken balances (held in each token contract) are drained by swaps.
 */
contract ConfidentialSwapPool is ZamaEthereumConfig, IERC7984Receiver {
  // ── State
  // ─────────────────────────────────────────────────────────────────

  address public owner;

  // supported cToken address → active
  mapping(address => bool) public supportedToken;

  // ── Events
  // ────────────────────────────────────────────────────────────────

  event TokenAdded(address indexed token);
  event TokenRemoved(address indexed token);
  event SwapExecuted(address indexed from, address indexed inputToken, address indexed outputToken);

  // ── Constructor
  // ───────────────────────────────────────────────────────────

  constructor() {
    owner = msg.sender;
  }

  // ── Admin
  // ──────────────────────────────────────────────────────────────────

  modifier onlyOwner() {
    require(msg.sender == owner, "ConfidentialSwapPool: not owner");
    _;
  }

  /**
   * @notice Register a cToken as a supported swap token.
   * @param token ERC-7984 confidential token address
   */
  function addToken(address token) external onlyOwner {
    require(token != address(0), "ConfidentialSwapPool: zero address");
    supportedToken[token] = true;
    emit TokenAdded(token);
  }

  /**
   * @notice Remove a cToken from the supported list.
   */
  function removeToken(address token) external onlyOwner {
    supportedToken[token] = false;
    emit TokenRemoved(token);
  }

  // ── ERC-7984 Receiver (deposit + swap)
  // ─────────────────────────────────────

  /**
   * @notice Called by the input cToken contract when a user calls
   *         cInput.confidentialTransferAndCall(pool, encAmount, proof, abi.encode(cOutput)).
   *
   * @param  from   The original sender (user address)
   * @param  amount The encrypted amount deposited (euint64 handle)
   * @param  data   ABI-encoded output token address: abi.encode(address outputToken)
   * @return result ebool(true) to signal acceptance to the calling token contract
   */
  function onConfidentialTransferReceived(
    address,        // operator (msg.sender already captured)
    address from,
    euint64 amount,
    bytes calldata data
  ) external override returns (ebool) {
    require(supportedToken[msg.sender], "ConfidentialSwapPool: unsupported input token");

    address outputToken = abi.decode(data, (address));
    require(supportedToken[outputToken], "ConfidentialSwapPool: unsupported output token");
    require(outputToken != msg.sender, "ConfidentialSwapPool: same token swap");

    // Grant pool persistent ACL access to the received encrypted amount
    FHE.allowThis(amount);

    // Grant output token transient ACL access so it can use the encrypted amount
    // in its own FHE balance arithmetic
    FHE.allowTransient(amount, outputToken);

    // Transfer the same encrypted amount of outputToken back to the user
    IERC7984Transfer(outputToken).confidentialTransfer(from, amount);

    emit SwapExecuted(from, msg.sender, outputToken);

    // Signal acceptance to the calling cInput token
    ebool result = FHE.asEbool(true);
    FHE.allowTransient(result, msg.sender);
    return result;
  }
}
