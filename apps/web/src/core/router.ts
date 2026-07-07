/**
 * router.ts — Cross-pair swap routing via CrossSwapRouter contract
 */

import { ethers } from "ethers";

// ── ABI ───────────────────────────────────────────────────────────────────────

const ROUTER_ABI = [
  // CrossSwapRouter.sol: swap(inputERC20, inputERC7984, outputERC7984, outputERC20, amount)
  "function swap(address inputERC20, address inputERC7984, address outputERC7984, address outputERC20, uint256 amount) external returns (uint256 outputAmount)",
  "function estimateOutput(address inputERC20, address outputERC20, uint256 inputAmount) external pure returns (uint256)",
  // registerPair(erc20, erc7984, decimals) — one pair at a time
  "function registerPair(address erc20, address erc7984, uint8 decimals) external",
  // public mapping getter: pairs(bytes32) → (erc20, erc7984, decimals, active)
  "function pairs(bytes32 id) external view returns (address erc20, address erc7984, uint8 decimals, bool active)",
  "event SwapExecuted(address indexed user, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount)",
];

const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
];

// ── Types ─────────────────────────────────────────────────────────────────────

/** Contract-level cross-swap route — maps directly to CrossSwapRouter.swap() args */
export interface CrossSwapRoute {
  inputERC20:      string;
  inputERC7984:    string;
  outputERC20:     string;
  outputERC7984:   string;
  estimatedOutput: bigint;
}

export interface SwapResult {
  txHash: string;
  outputAmount: bigint;
}

// ── Functions ─────────────────────────────────────────────────────────────────

export async function estimateSwapOutput(
  routerAddress: string,
  inputERC20: string,
  outputERC20: string,
  amount: bigint,
  provider: ethers.Provider
): Promise<bigint> {
  const router = new ethers.Contract(routerAddress, ROUTER_ABI, provider);
  return router.estimateOutput(inputERC20, outputERC20, amount) as Promise<bigint>;
}

/**
 * Check whether both the input and output pairs are registered in the router.
 * The contract stores pairs keyed by keccak256(abi.encodePacked(erc20, erc7984)).
 * There is no isPairRegistered view — we compute both IDs and call pairs() directly.
 */
export async function isPairRegistered(
  routerAddress: string,
  inputERC20: string,
  inputERC7984: string,
  outputERC20: string,
  outputERC7984: string,
  provider: ethers.Provider
): Promise<boolean> {
  const router = new ethers.Contract(routerAddress, ROUTER_ABI, provider);
  const idA = ethers.keccak256(ethers.solidityPacked(["address", "address"], [inputERC20,  inputERC7984]));
  const idB = ethers.keccak256(ethers.solidityPacked(["address", "address"], [outputERC20, outputERC7984]));
  const [pairA, pairB] = await Promise.all([
    router.pairs(idA) as Promise<{ active: boolean }>,
    router.pairs(idB) as Promise<{ active: boolean }>,
  ]);
  return pairA.active && pairB.active;
}

/**
 * Execute a cross-pair swap.
 * Approves the router to spend inputERC20, then calls swap().
 */
export async function executeSwap(
  routerAddress: string,
  route: CrossSwapRoute,
  amount: bigint,
  signer: ethers.Signer
): Promise<SwapResult> {
  // 1. Approve router to pull input ERC-20
  const erc20 = new ethers.Contract(route.inputERC20, ERC20_APPROVE_ABI, signer);
  const approveTx = await erc20.approve(routerAddress, amount);
  await approveTx.wait();

  // 2. Execute swap
  const router = new ethers.Contract(routerAddress, ROUTER_ABI, signer);
  const tx = await router.swap(
    route.inputERC20,
    route.inputERC7984,
    route.outputERC7984,   // contract order: outputERC7984 before outputERC20
    route.outputERC20,
    amount
  );
  const receipt = await tx.wait();

  // Parse outputAmount from Swap event
  let outputAmount = 0n;
  const iface = new ethers.Interface(ROUTER_ABI);
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "SwapExecuted") {
        outputAmount = BigInt(parsed.args[4]);
      }
    } catch {
      // skip
    }
  }

  return { txHash: receipt.hash, outputAmount };
}
