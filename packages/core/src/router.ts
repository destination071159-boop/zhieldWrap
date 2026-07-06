/**
 * router.ts — Cross-pair swap routing via CrossSwapRouter contract
 */

import { ethers } from "ethers";

// ── ABI ───────────────────────────────────────────────────────────────────────

const ROUTER_ABI = [
  "function swap(address inputERC20, address inputERC7984, address outputERC20, address outputERC7984, uint256 amount) external returns (uint256 outputAmount)",
  "function estimateOutput(address inputERC20, address outputERC20, uint256 amount) external view returns (uint256)",
  "function registerPair(address erc20A, address erc7984A, address erc20B, address erc7984B) external",
  "function getPairCount() external view returns (uint256)",
  "function isPairRegistered(address erc20A, address erc20B) external view returns (bool)",
  "event Swap(address indexed inputERC20, address indexed outputERC20, address indexed trader, uint256 inputAmount, uint256 outputAmount)",
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

export async function isPairRegistered(
  routerAddress: string,
  erc20A: string,
  erc20B: string,
  provider: ethers.Provider
): Promise<boolean> {
  const router = new ethers.Contract(routerAddress, ROUTER_ABI, provider);
  return router.isPairRegistered(erc20A, erc20B) as Promise<boolean>;
}

export async function getPairCount(
  routerAddress: string,
  provider: ethers.Provider
): Promise<number> {
  const router = new ethers.Contract(routerAddress, ROUTER_ABI, provider);
  const count = await router.getPairCount() as bigint;
  return Number(count);
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
    route.outputERC20,
    route.outputERC7984,
    amount
  );
  const receipt = await tx.wait();

  // Parse outputAmount from Swap event
  let outputAmount = 0n;
  const iface = new ethers.Interface(ROUTER_ABI);
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "Swap") {
        outputAmount = BigInt(parsed.args[4]);
      }
    } catch {
      // skip
    }
  }

  return { txHash: receipt.hash, outputAmount };
}
