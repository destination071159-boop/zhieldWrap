/**
 * privacy.ts — Privacy Pool contract interactions
 *
 * Deposit: user calls token.confidentialTransferAndCall(pool, handle, proof, commitment)
 * Withdraw: pool.withdraw/withdrawToERC20 — msg.sender receives tokens (use a fresh wallet)
 */

import { ethers } from "ethers";
import { MerkleTree } from "fixed-merkle-tree";
// @ts-ignore — poseidon-lite ships no TypeScript types
import { poseidon2 } from "poseidon-lite/poseidon2";
import type { ZKProof } from "./zkProof.js";
import { PRIVACY_POOL_DEPLOY_BLOCK } from "./constants.js";

// ── ABI ───────────────────────────────────────────────────────────────────────

// Matches deployed PrivacyPool.sol
const PRIVACY_POOL_ABI = [
  // Withdraw to ERC-7984 — msg.sender receives immediately
  "function withdraw(address token, uint256 amount, uint256[2] calldata pA, uint256[2][2] calldata pB, uint256[2] calldata pC, uint256[2] calldata pubSignals) external",
  // Withdraw to ERC-20 — msg.sender receives after gateway finalizeUnwrap
  "function withdrawToERC20(address wrapper, uint256 amount, uint256[2] calldata pA, uint256[2][2] calldata pB, uint256[2] calldata pC, uint256[2] calldata pubSignals) external",
  // Views
  "function hasDeposit(bytes32 commitment) external view returns (bool)",
  "function nullifierSpent(bytes32) external view returns (bool)",
  "function anonymitySet(address) external view returns (uint256)",
  "function getLastRoot() external view returns (bytes32)",
  "function isKnownRoot(bytes32 root) external view returns (bool)",
  "function getPrivacyLevel(address token) external view returns (string)",
  // Events
  "event Deposit(address indexed token, bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)",
  "event Withdrawal(address indexed token, bytes32 indexed nullifierHash, address indexed recipient, uint256 timestamp)",
  "event WithdrawalToERC20Requested(address indexed wrapper, bytes32 indexed nullifierHash, bytes32 indexed unwrapRequestId, address recipient, uint256 timestamp)",
];

// ERC-7984 token — used for the deposit path (confidentialTransferAndCall)
const ERC7984_ABI = [
  "function confidentialTransferAndCall(address to, bytes32 encryptedAmount, bytes calldata inputProof, bytes calldata data) external",
];

export const PRIVACY_LEVEL_LABELS = ["LOW", "MEDIUM", "HIGH", "MAXIMUM"] as const;
export type PrivacyLevel = typeof PRIVACY_LEVEL_LABELS[number];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DepositResult {
  txHash: string;
  commitment: bigint;
  leafIndex?: number;
}

export interface WithdrawResult {
  txHash: string;
}

// ── View functions ────────────────────────────────────────────────────────────

export async function getAnonymitySet(
  poolAddress: string,
  tokenAddress: string,
  provider: ethers.Provider
): Promise<number> {
  const pool = new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, provider);
  const n = await pool.anonymitySet(tokenAddress) as bigint;
  return Number(n);
}

export async function getPrivacyLevel(
  poolAddress: string,
  tokenAddress: string,
  provider: ethers.Provider
): Promise<PrivacyLevel> {
  const pool = new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, provider);
  const label = await pool.getPrivacyLevel(tokenAddress) as string;
  return (PRIVACY_LEVEL_LABELS.includes(label as PrivacyLevel) ? label : "LOW") as PrivacyLevel;
}

export async function getMerkleRoot(
  poolAddress: string,
  provider: ethers.Provider
): Promise<string> {
  const pool = new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, provider);
  return pool.getLastRoot() as Promise<string>;
}

export async function isKnownRoot(
  poolAddress: string,
  root: string,
  provider: ethers.Provider
): Promise<boolean> {
  const pool = new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, provider);
  return pool.isKnownRoot(root) as Promise<boolean>;
}

export async function hasDeposit(
  poolAddress: string,
  commitment: bigint,
  provider: ethers.Provider
): Promise<boolean> {
  const pool = new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, provider);
  return pool.hasDeposit(ethers.zeroPadValue(ethers.toBeHex(commitment), 32)) as Promise<boolean>;
}

export async function isNullifierSpent(
  poolAddress: string,
  nullifier: bigint,
  provider: ethers.Provider
): Promise<boolean> {
  const pool = new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, provider);
  return pool.nullifierSpent(ethers.zeroPadValue(ethers.toBeHex(nullifier), 32)) as Promise<boolean>;
}

// ── Write functions ───────────────────────────────────────────────────────────

/**
 * Deposit into the Privacy Pool.
 * Calls the ERC-7984 TOKEN contract (not the pool) so FHE proof verification
 * sees userAddress = depositor wallet (msg.sender of the token call).
 */
export async function depositToPool(
  poolAddress: string,
  tokenAddress: string,
  commitment: bigint,
  encryptedAmountHandle: Uint8Array,  // bytes32 handle from @zama-fhe/react-sdk
  inputProof: Uint8Array,
  signer: ethers.Signer
): Promise<DepositResult> {
  const token = new ethers.Contract(tokenAddress, ERC7984_ABI, signer);
  const commitmentBytes = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);
  const data = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentBytes]);

  const tx = await token["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](
    poolAddress,
    encryptedAmountHandle,
    inputProof,
    data
  );
  const receipt = await tx.wait();

  // Extract leafIndex from the pool's Deposit event
  let leafIndex: number | undefined;
  const poolIface = new ethers.Interface(PRIVACY_POOL_ABI);
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = poolIface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "Deposit") leafIndex = Number(parsed.args[2]);
    } catch { /* non-matching log */ }
  }

  return { txHash: receipt.hash, commitment, leafIndex };
}

/**
 * Withdraw from pool — msg.sender receives ERC-7984 tokens.
 * Connect with a FRESH wallet so the withdrawal cannot be linked to the depositor.
 */
export async function withdrawFromPool(
  poolAddress: string,
  tokenAddress: string,
  amount: bigint,
  proof: ZKProof,
  signer: ethers.Signer
): Promise<WithdrawResult> {
  const pool = new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, signer);
  const tx = await pool.withdraw(tokenAddress, amount, proof.pA, proof.pB, proof.pC, proof.publicSignals);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/**
 * Withdraw from pool and unwrap to ERC-20 — msg.sender receives ERC-20 (async).
 * ERC-20 arrives after the FhEVM gateway calls finalizeUnwrap.
 */
export async function withdrawToERC20FromPool(
  poolAddress: string,
  wrapperAddress: string,
  amount: bigint,
  proof: ZKProof,
  signer: ethers.Signer
): Promise<WithdrawResult & { requestId: string }> {
  const pool = new ethers.Contract(poolAddress, PRIVACY_POOL_ABI, signer);
  const tx = await pool.withdrawToERC20(wrapperAddress, amount, proof.pA, proof.pB, proof.pC, proof.publicSignals);
  const receipt = await tx.wait();

  let requestId = ethers.ZeroHash;
  const iface = new ethers.Interface(PRIVACY_POOL_ABI);
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "WithdrawalToERC20Requested") requestId = parsed.args[2];
    } catch { /* non-matching log */ }
  }

  return { txHash: receipt.hash, requestId };
}

// ── Merkle proof helpers ──────────────────────────────────────────────────────

const TREE_DEPTH = 20;

/**
 * Fetch ALL Deposit events from the pool (across all tokens) and return
 * an array of commitment bigints indexed by leafIndex.
 *
 * This is required for cross-token swaps: the on-chain Merkle tree includes
 * ALL deposits regardless of token, so the off-chain rebuild must do the same.
 */
export async function getDepositCommitments(
  poolAddress: string,
  provider: ethers.Provider
): Promise<bigint[]> {
  const pool = new ethers.Contract(
    poolAddress,
    ["event Deposit(address indexed token, bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)"],
    provider
  );

  // Paginate in 50k-block chunks — Infura/Alchemy reject larger ranges
  const CHUNK = 50_000;
  const currentBlock = await provider.getBlockNumber();
  const allEvents: ethers.Log[] = [];

  for (let from = PRIVACY_POOL_DEPLOY_BLOCK; from <= currentBlock; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, currentBlock);
    const chunk = await pool.queryFilter(pool.filters.Deposit(), from, to);
    allEvents.push(...(chunk as ethers.Log[]));
  }

  const entries = allEvents.map((e) => {
    const parsed = pool.interface.parseLog({ topics: e.topics as string[], data: e.data });
    return { commitment: BigInt(parsed!.args[1]), leafIndex: Number(parsed!.args[2]) };
  }).sort((a, b) => a.leafIndex - b.leafIndex);

  const commitments: bigint[] = [];
  for (const { commitment, leafIndex } of entries) {
    commitments[leafIndex] = commitment;
  }
  return commitments;
}

/**
 * Fetch all deposit events, rebuild the full Merkle tree with fixed-merkle-tree
 * (same library as the ZK circuit tests), and return the path proof for the
 * given commitment value.
 *
 * Uses ALL deposits (not filtered by token) so cross-token paths are correct.
 */
export async function getMerkleProof(
  poolAddress: string,
  commitment: bigint,
  provider: ethers.Provider
): Promise<{ pathElements: bigint[]; pathIndices: number[]; root: bigint }> {
  const commitments = await getDepositCommitments(poolAddress, provider);

  const tree = new MerkleTree(TREE_DEPTH, commitments as any[], {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    hashFunction: (a: any, b: any) =>
      (poseidon2 as any)([BigInt(a), BigInt(b)]),
    zeroElement: 0n as any,
  });

  const { pathElements, pathIndices, pathRoot } = tree.proof(commitment as any);
  return {
    pathElements: pathElements.map(BigInt),
    pathIndices:  pathIndices.map(Number),
    root:         BigInt(pathRoot as bigint | string),
  };
}
