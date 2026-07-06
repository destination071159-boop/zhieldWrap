/**
 * useConfidentialSwap.ts
 *
 * Hook for swapping one ERC-7984 confidential token for another via
 * ConfidentialSwapPool using confidentialTransferAndCall.
 *
 * Flow:
 *   1. Encrypt the amount with the INPUT cToken contract as the contract address.
 *   2. Call cInput.confidentialTransferAndCall(pool, encHandle, inputProof, abi.encode(cOutput)).
 *   3. Pool sends same encrypted amount of cOutput back to the user.
 */

import { useState, useCallback } from "react";
import { useWalletClient, usePublicClient } from "wagmi";
import { useEncrypt } from "@zama-fhe/react-sdk";
import { ethers } from "ethers";
import { walletClientToSigner } from "./useWrap";
import { CONFIDENTIAL_SWAP_POOL_ADDRESS } from "@zhieldwrap/core";

const POOL_ADDRESS =
  (import.meta.env.VITE_CONFIDENTIAL_SWAP_POOL_ADDRESS as string | undefined) ??
  CONFIDENTIAL_SWAP_POOL_ADDRESS;

// Minimal ABI — confidentialTransferAndCall on an ERC-7984 token
const ERC7984_ABI = [
  "function confidentialTransferAndCall(address to, bytes32 encryptedAmount, bytes calldata inputProof, bytes calldata data) external returns (bool)",
];

export type ConfidentialSwapStep = "idle" | "encrypting" | "swapping" | "done" | "error";

interface UseConfidentialSwapReturn {
  step: ConfidentialSwapStep;
  txHash: string | null;
  error: string | null;
  swap: (params: {
    inputTokenAddress: string;
    outputTokenAddress: string;
    amount: bigint;
    userAddress: string;
  }) => Promise<{ txHash: string } | null>;
  reset: () => void;
}

export function useConfidentialSwap(): UseConfidentialSwapReturn {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const encrypt = useEncrypt();

  const [step, setStep]       = useState<ConfidentialSwapStep>("idle");
  const [txHash, setTxHash]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const swap = useCallback(
    async ({
      inputTokenAddress,
      outputTokenAddress,
      amount,
      userAddress,
    }: {
      inputTokenAddress: string;
      outputTokenAddress: string;
      amount: bigint;
      userAddress: string;
    }): Promise<{ txHash: string } | null> => {
      if (!walletClient || !POOL_ADDRESS) {
        setError("Wallet not connected or pool address missing");
        return null;
      }
      setError(null);

      try {
        // Step 1: Encrypt amount against the INPUT token contract
        setStep("encrypting");
        const enc = await encrypt.mutateAsync({
          values: [{ value: amount, type: "euint64" as const }],
          contractAddress: inputTokenAddress as `0x${string}`,
          userAddress: userAddress as `0x${string}`,
        });

        const encHandle   = enc.handles[0]!;
        const inputProof  = ethers.hexlify(enc.inputProof);

        // Step 2: Call confidentialTransferAndCall on the input cToken
        // data = abi.encode(outputTokenAddress)
        setStep("swapping");
        const signer = await walletClientToSigner(walletClient);
        if (!signer) throw new Error("Could not create signer");

        const cToken = new ethers.Contract(inputTokenAddress, ERC7984_ABI, signer);
        const callData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address"],
          [outputTokenAddress]
        );

        const tx = await cToken.confidentialTransferAndCall(
          POOL_ADDRESS,
          encHandle,
          inputProof,
          callData
        );
        const receipt = await tx.wait();

        setTxHash(receipt.hash);
        setStep("done");
        return { txHash: receipt.hash };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Swap failed";
        setError(msg);
        setStep("error");
        return null;
      }
    },
    [walletClient, publicClient, encrypt]
  );

  const reset = useCallback(() => {
    setStep("idle");
    setTxHash(null);
    setError(null);
  }, []);

  return { step, txHash, error, swap, reset };
}
