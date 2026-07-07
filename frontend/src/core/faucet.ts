import { ethers } from "ethers";
import { TxStatus } from "./types";

// Minimal ERC-20 mock ABI — the official Zama mock tokens expose mint(address, uint256)
const MOCK_ERC20_ABI = [
  "function mint(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function symbol() view returns (string)",
];

/**
 * mintFromFaucet — calls the public mint() function on an official cTokenMock ERC-20.
 * The official Zama mock tokens allow anyone to mint up to 1,000,000 tokens per call.
 * There is no on-chain cooldown; we enforce a client-side 24-hour cooldown via localStorage.
 *
 * @param erc20Address - The underlying ERC-20 mock token address (NOT the ERC-7984 wrapper)
 * @param toAddress - Recipient wallet address
 * @param amount - Amount to mint in wei
 * @param signer - ethers.js signer
 */
export async function mintFromFaucet(
  erc20Address: string,
  toAddress: string,
  amount: bigint,
  signer: ethers.Signer
): Promise<TxStatus> {
  const token = new ethers.Contract(erc20Address, MOCK_ERC20_ABI, signer);

  try {
    const tx = await token.mint(toAddress, amount);
    const receipt = await tx.wait(1);

    return {
      hash: tx.hash as string,
      status: "confirmed",
      message: "Tokens minted successfully",
      blockNumber: (receipt as ethers.TransactionReceipt).blockNumber,
      gasUsed: (receipt as ethers.TransactionReceipt).gasUsed,
    };
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "ACTION_REJECTED"
    ) {
      return { hash: "", status: "failed", message: "User rejected transaction" };
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Faucet mint failed: ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client-side cooldown helpers (localStorage)
// ─────────────────────────────────────────────────────────────────────────────

const COOLDOWN_KEY_PREFIX = "zhieldwrap:faucet:cooldown:";

export function getFaucetCooldownRemaining(
  tokenAddress: string
): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(COOLDOWN_KEY_PREFIX + tokenAddress.toLowerCase());
  if (!raw) return 0;
  const lastClaim = parseInt(raw, 10);
  const elapsed = Date.now() - lastClaim;
  const cooldownMs = 24 * 60 * 60 * 1000;
  return Math.max(0, cooldownMs - elapsed);
}

export function recordFaucetClaim(tokenAddress: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    COOLDOWN_KEY_PREFIX + tokenAddress.toLowerCase(),
    Date.now().toString()
  );
}
