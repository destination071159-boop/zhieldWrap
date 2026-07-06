// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// ── Interfaces
// ────────────────────────────────────────────────────────────────

interface IERC20Router {
  function approve(address spender, uint256 amount) external returns (bool);
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function transfer(address to, uint256 amount) external returns (bool);
  function balanceOf(address account) external view returns (uint256);
}

interface IERC7984Router {
  // Matches ERC7984ERC20Wrapper.wrap(address to, uint256 amount)
  function wrap(address to, uint256 amount) external returns (euint64);
}

/**
 * @title CrossSwapRouter
 * @notice Routes cross-pair swaps between any two registered ERC-20 ↔ ERC-7984 pairs.
 *
 * Swap flow (e.g. USDC → DAI privately):
 *   1. User approves CrossSwapRouter to spend their USDCMock (ERC-20)
 *   2. Calls swap(inputERC20, inputERC7984, outputERC7984, outputERC20, amount)
 *   3. Router wraps USDC → cUSDC (ERC-7984)
 *   4. Router unwraps cUSDC → USDC internally (via the wrapper)
 *   5. Router uses a DEX-like swap or direct pair liquidity to get DAI
 *   6. Router wraps DAI → cDAI (ERC-7984) and sends to user
 *
 * @dev For the hackathon demo, step 5 uses direct 1:1 exchange via shared liquidity.
 *      In production, integrate a confidential AMM.
 */

// ── Interfaces
// ────────────────────────────────────────────────────────────

interface IERC20 {
  function approve(address spender, uint256 amount) external returns (bool);
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function transfer(address to, uint256 amount) external returns (bool);
  function balanceOf(address account) external view returns (uint256);
}

contract CrossSwapRouter is ZamaEthereumConfig {
  // ── State
  // ─────────────────────────────────────────────────────────────────

  struct Pair {
    address erc20;
    address erc7984;
    uint8 decimals;
    bool active;
  }

  // pairId → Pair
  mapping(bytes32 => Pair) public pairs;

  // Registered pair IDs
  bytes32[] public pairIds;

  address public owner;

  // ── Events
  // ────────────────────────────────────────────────────────────────

  event PairRegistered(bytes32 indexed pairId, address erc20, address erc7984);
  event SwapExecuted(
    address indexed user, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount
  );

  // ── Constructor
  // ───────────────────────────────────────────────────────────

  constructor() {
    owner = msg.sender;
  }

  modifier onlyOwner() {
    require(msg.sender == owner, "CrossSwapRouter: not owner");
    _;
  }

  // ── Pair registration
  // ─────────────────────────────────────────────────────

  /**
   * @notice Register an ERC-20 ↔ ERC-7984 pair for routing.
   * @param erc20    ERC-20 token address
   * @param erc7984  ERC-7984 wrapper address
   * @param decimals Token decimals
   */
  function registerPair(address erc20, address erc7984, uint8 decimals) external onlyOwner {
    bytes32 id = keccak256(abi.encodePacked(erc20, erc7984));
    require(!pairs[id].active, "CrossSwapRouter: pair exists");

    pairs[id] = Pair({erc20: erc20, erc7984: erc7984, decimals: decimals, active: true});
    pairIds.push(id);

    emit PairRegistered(id, erc20, erc7984);
  }

  // ── Swap
  // ──────────────────────────────────────────────────────────────────

  /**
   * @notice Swap inputERC20 for outputERC20 via their ERC-7984 wrappers.
   *         Both pairs must be registered.
   *         User receives the output as a wrapped ERC-7984 confidential token.
   *
   * @param inputERC20    Input ERC-20 address (e.g. USDCMock)
   * @param inputERC7984  Input ERC-7984 address (e.g. cUSDCMock)
   * @param outputERC7984 Output ERC-7984 address (e.g. cDAIMock)
   * @param outputERC20   Output ERC-20 address (e.g. DAIMock)
   * @param amount        Input amount in input token's base units
   */
  function swap(
    address inputERC20,
    address inputERC7984,
    address outputERC7984,
    address outputERC20,
    uint256 amount
  )
    external
    returns (uint256 outputAmount)
  {
    require(amount > 0, "CrossSwapRouter: zero amount");

    // Validate both pairs are registered
    bytes32 inputId = keccak256(abi.encodePacked(inputERC20, inputERC7984));
    bytes32 outputId = keccak256(abi.encodePacked(outputERC20, outputERC7984));
    require(pairs[inputId].active, "CrossSwapRouter: input pair not registered");
    require(pairs[outputId].active, "CrossSwapRouter: output pair not registered");

    // Step 1: Pull input ERC-20 from user
    IERC20Router(inputERC20).transferFrom(msg.sender, address(this), amount);

    // Step 2: Approve wrapper and wrap input ERC-20 → ERC-7984 (held by router)
    IERC20Router(inputERC20).approve(inputERC7984, amount);
    IERC7984Router(inputERC7984).wrap(address(this), amount);

    // Step 3: 1:1 exchange rate for demo (same decimals).
    //         In production: integrate a confidential AMM liquidity pool here.
    outputAmount = amount;

    // Step 4: Ensure router has enough output ERC-20 in reserves
    uint256 routerBalance = IERC20Router(outputERC20).balanceOf(address(this));
    require(routerBalance >= outputAmount, "CrossSwapRouter: insufficient output liquidity");

    // Step 5: Wrap output ERC-20 → ERC-7984 and deliver directly to user
    IERC20Router(outputERC20).approve(outputERC7984, outputAmount);
    IERC7984Router(outputERC7984).wrap(msg.sender, outputAmount);

    // User now holds the output confidential token (cDAI, etc.)

    emit SwapExecuted(msg.sender, inputERC20, outputERC20, amount, outputAmount);
  }

  /**
   * @notice Estimate output amount for a swap (simplified 1:1 for same-decimal pairs).
   * @dev In production, query AMM curve.
   */
  function estimateOutput(address inputERC20, address outputERC20, uint256 inputAmount)
    external
    pure
    returns (uint256)
  {
    // Silence unused variable warning
    (inputERC20, outputERC20);
    return inputAmount; // 1:1 for demo
  }

  /**
   * @notice Get all registered pair IDs.
   */
  function getAllPairIds() external view returns (bytes32[] memory) {
    return pairIds;
  }

  /**
   * @notice Deposit output ERC-20 liquidity into the router.
   *         Admin function to seed the router with tokens for swaps.
   */
  function depositLiquidity(address token, uint256 amount) external onlyOwner {
    IERC20Router(token).transferFrom(msg.sender, address(this), amount);
  }
}
