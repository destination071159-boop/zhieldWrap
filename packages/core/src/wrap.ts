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
  // finalizeUnwrap must be called manually with cleartext + KMS proof from Zama relayer
  "function finalizeUnwrap(bytes32 unwrapRequestId, uint64 unwrapAmountCleartext, bytes decryptionProof) external",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function underlying() view returns (address)",
];

// Topic0 of UnwrapRequested(address indexed receiver, bytes32 indexed unwrapRequestId, euint64 amount)
// keccak256("UnwrapRequested(address,bytes32,bytes32)") — euint64 is bytes32 in ABI
const UNWRAP_REQUESTED_TOPIC0 = "0x4b1bfb262557cf08a74ddeefb8aef086b81deb08484bdc1820b9f420cdd1aa0e";

/**
 * getPendingUnwrapRequests — returns requestIds that were requested but not yet finalized.
 * Uses a logs-capable RPC (drpc.org) for event queries, and logsProvider for contract reads.
 */
export async function getPendingUnwrapRequests(
  wrapperAddress: string,
  userAddress: string,
  logsProvider: ethers.Provider,
  fromBlock: number
): Promise<string[]> {
  const ABI = ["function unwrapRequester(bytes32 unwrapRequestId) view returns (address)"];
  const wrapper = new ethers.Contract(wrapperAddress, ABI, logsProvider);

  const logs = await logsProvider.getLogs({
    address: wrapperAddress,
    topics: [
      UNWRAP_REQUESTED_TOPIC0,
      ethers.zeroPadValue(userAddress, 32),
    ],
    fromBlock,
    toBlock: "latest",
  });

  const pending: string[] = [];
  for (const log of logs) {
    const requestId = log.topics[2];
    if (!requestId) continue;
    const requester = await wrapper.unwrapRequester(requestId) as string;
    if (requester.toLowerCase() === userAddress.toLowerCase()) {
      pending.push(requestId);
    }
  }
  return pending;
}

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
 * Returns unwrapRequestId in TxStatus — caller must then call finalizeUnwrap to complete the flow.
 */
export async function unwrapToken(
  pair: RegistryPair,
  _amount: bigint,
  encryptedAmount: string, // bytes32 externalEuint64 handle from Zama SDK
  inputProof: string,      // bytes input proof from Zama SDK
  signer: ethers.Signer
): Promise<TxStatus> {
  const wrapper = new ethers.Contract(pair.erc7984Address, ERC7984_ABI, signer);
  const userAddress = await signer.getAddress();

  try {
    const tx = await wrapper.unwrap(userAddress, userAddress, encryptedAmount, inputProof);
    const receipt = await tx.wait(1) as ethers.TransactionReceipt;

    // Extract unwrapRequestId from UnwrapRequested event (topic[2] = bytes32 requestId)
    const unwrapLog = receipt.logs.find(
      (l) => l.topics[0]?.toLowerCase() === UNWRAP_REQUESTED_TOPIC0.toLowerCase()
    );
    const unwrapRequestId = unwrapLog?.topics[2] ?? undefined;

    return {
      hash: tx.hash as string,
      status: "confirmed",
      message: `Unwrap initiated — fetching decryption proof from KMS...`,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      unwrapRequestId,
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
 * finalizeUnwrap — completes an unwrap by calling finalizeUnwrap on the wrapper contract.
 * Must be called after unwrapToken with the cleartext + decryptionProof from Zama's public decrypt API.
 */
export async function finalizeUnwrap(
  pair: RegistryPair,
  unwrapRequestId: string,  // bytes32 handle from UnwrapRequested event
  cleartext: bigint,        // decrypted amount from publicDecrypt
  decryptionProof: string,  // KMS signature from publicDecrypt
  signer: ethers.Signer
): Promise<TxStatus> {
  const wrapper = new ethers.Contract(pair.erc7984Address, ERC7984_ABI, signer);

  try {
    const tx = await wrapper.finalizeUnwrap(unwrapRequestId, cleartext, decryptionProof);
    const receipt = await tx.wait(1) as ethers.TransactionReceipt;

    return {
      hash: tx.hash as string,
      status: "confirmed",
      message: `Unwrapped ${ethers.formatUnits(cleartext, pair.decimals)} ${pair.symbol} → ${pair.underlyingSymbol} successfully`,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "ACTION_REJECTED"
    ) {
      return { hash: "", status: "failed", message: "User rejected finalization" };
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`FinalizeUnwrap failed: ${msg}`);
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
