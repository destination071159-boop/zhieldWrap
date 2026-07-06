import { ethers } from "ethers";
import { RegistryPair, TxStatus } from "./types";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// ERC-7984 ABI — per OpenZeppelin ERC7984ERC20Wrapper standard
// https://docs.openzeppelin.com/confidential-contracts/api/token#ERC7984ERC20Wrapper
// euint64 and externalEuint64 are both `bytes32` in ABI encoding (type T is bytes32)
const ERC7984_ABI = [
  "function wrap(address to, uint256 amount) external returns (uint256)",
  // unwrap(from, to, externalEuint64 encryptedAmount, bytes inputProof)
  "function unwrap(address from, address to, bytes32 encryptedAmount, bytes inputProof) external returns (bytes32)",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function underlying() view returns (address)",
];

/**
 * getERC20Balance — returns the raw ERC-20 balance of a wallet
 */
export async function getERC20Balance(
  tokenAddress: string,
  ownerAddress: string,
  provider: ethers.Provider
): Promise<bigint> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return (await token.balanceOf(ownerAddress)) as bigint;
}

/**
 * checkAllowance — checks how much ERC-20 is approved for a spender
 */
export async function checkAllowance(
  tokenAddress: string,
  ownerAddress: string,
  spenderAddress: string,
  provider: ethers.Provider
): Promise<bigint> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  return (await token.allowance(ownerAddress, spenderAddress)) as bigint;
}

/**
 * approveToken — sends an ERC-20 approval transaction
 * Waits for 1 confirmation before resolving.
 */
export async function approveToken(
  tokenAddress: string,
  spenderAddress: string,
  amount: bigint,
  signer: ethers.Signer
): Promise<TxStatus> {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

  try {
    const tx = await token.approve(spenderAddress, amount);
    const receipt = await tx.wait(1);

    return {
      hash: tx.hash as string,
      status: "confirmed",
      message: "Token approved successfully",
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
      return { hash: "", status: "failed", message: "User rejected approval" };
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Approval failed: ${msg}`);
  }
}

/**
 * wrapToken — wraps ERC-20 into ERC-7984 confidential tokens.
 * Requires prior ERC-20 approval for `pair.erc7984Address`.
 * The wrapper contract encrypts the amount internally via FhEVM.
 */
export async function wrapToken(
  pair: RegistryPair,
  amount: bigint,
  signer: ethers.Signer
): Promise<TxStatus> {
  const wrapper = new ethers.Contract(pair.erc7984Address, ERC7984_ABI, signer);
  const userAddress = await signer.getAddress();

  try {
    const tx = await wrapper.wrap(userAddress, amount);
    const receipt = await tx.wait(1);

    return {
      hash: tx.hash as string,
      status: "confirmed",
      message: `Wrapped ${ethers.formatUnits(amount, pair.decimals)} ${pair.underlyingSymbol} → ${pair.symbol}`,
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
    throw new Error(`Wrap failed: ${msg}`);
  }
}

/**
 * unwrapToken — unwraps ERC-7984 confidential tokens back to ERC-20.
 * Requires an encrypted amount handle + inputProof from the Zama SDK encrypt hook.
 * The Gateway will call finalizeUnwrap automatically after ~1 block to send the ERC-20.
 */
export async function unwrapToken(
  pair: RegistryPair,
  amount: bigint,
  encryptedAmount: string, // bytes32 externalEuint64 handle from Zama SDK
  inputProof: string,      // bytes input proof from Zama SDK
  signer: ethers.Signer
): Promise<TxStatus> {
  const wrapper = new ethers.Contract(pair.erc7984Address, ERC7984_ABI, signer);
  const userAddress = await signer.getAddress();

  try {
    const tx = await wrapper.unwrap(userAddress, userAddress, encryptedAmount, inputProof);
    const receipt = await tx.wait(1);

    return {
      hash: tx.hash as string,
      status: "confirmed",
      message: `Unwrap requested — ${ethers.formatUnits(amount, pair.decimals)} ${pair.symbol} → ${pair.underlyingSymbol} (ERC-20 arrives after Gateway finalizes in ~30s)`,
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
    throw new Error(`Unwrap failed: ${msg}`);
  }
}

/**
 * getERC7984BalanceHandle — reads the encrypted balance handle (bytes32) from an ERC-7984 token.
 * The handle is what `useUserDecrypt` from @zama-fhe/react-sdk uses.
 */
export async function getERC7984BalanceHandle(
  tokenAddress: string,
  ownerAddress: string,
  provider: ethers.Provider
): Promise<string> {
  const ABI = ["function getHandle(address owner) view returns (bytes32)"];
  const token = new ethers.Contract(tokenAddress, ABI, provider);
  return (await token.getHandle(ownerAddress)) as string;
}
