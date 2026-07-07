import { useState, useCallback } from "react";
import { useWalletClient, usePublicClient } from "wagmi";
import { ethers } from "ethers";
import { walletClientToSigner } from "./useWrap";
import {
  getAnonymitySet,
  getPrivacyLevel,
  getMerkleRoot,
  getMerkleProof,
  depositToPool,
  withdrawFromPool,
  withdrawToERC20FromPool,
  isNullifierSpent,
  PRIVACY_POOL_ADDRESS as POOL_ADDRESS_CONSTANT,
  SEPOLIA_LOGS_RPC,
  type PrivacyLevel,
  type ZKProof,
} from "@zhieldwrap/core";

const POOL_ADDRESS =
  (import.meta.env.VITE_PRIVACY_POOL_ADDRESS as string | undefined) ??
  POOL_ADDRESS_CONSTANT;

export type PoolStep = "idle" | "approving" | "depositing" | "withdrawing" | "done" | "error";

interface UsePrivacyPoolReturn {
  step: PoolStep;
  txHash: string | null;
  error: string | null;
  deposit: (params: {
    tokenAddress: string;
    commitment: bigint;
    encryptedAmount: Uint8Array;
    inputProof: Uint8Array;
  }) => Promise<{ txHash: string; leafIndex?: number } | null>;
  withdraw: (params: {
    tokenAddress: string;
    amount: bigint;
    proof: ZKProof;
  }) => Promise<{ txHash: string } | null>;
  withdrawToERC20: (params: {
    wrapperAddress: string;
    amount: bigint;
    proof: ZKProof;
  }) => Promise<{ txHash: string; requestId: string } | null>;
  fetchAnonymitySet: (tokenAddress: string) => Promise<number>;
  fetchPrivacyLevel: (tokenAddress: string) => Promise<PrivacyLevel>;
  fetchMerkleRoot: () => Promise<string>;
  fetchMerkleProof: (commitment: bigint) => Promise<{ pathElements: bigint[]; pathIndices: number[]; root: bigint } | null>;
  checkNullifier: (nullifier: bigint) => Promise<boolean>;
  reset: () => void;
}

export function usePrivacyPool(): UsePrivacyPoolReturn {
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  const [step, setStep]     = useState<PoolStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const poolAddress = POOL_ADDRESS ?? "";

  const deposit = useCallback(
    async (params: {
      tokenAddress: string;
      commitment: bigint;
      encryptedAmount: Uint8Array;
      inputProof: Uint8Array;
    }) => {
      if (!walletClient || !poolAddress) {
        setError("Wallet not connected or pool address not configured");
        return null;
      }
      setError(null);
      setStep("depositing");
      try {
        const signer = await walletClientToSigner(walletClient);
        if (!signer) throw new Error("Could not create signer");
        const result = await depositToPool(
          poolAddress,
          params.tokenAddress,
          params.commitment,
          params.encryptedAmount,
          params.inputProof,
          signer
        );
        setTxHash(result.txHash);
        setStep("done");
        return result;
      } catch (err) {
        setStep("error");
        setError(err instanceof Error ? err.message : "Deposit failed");
        return null;
      }
    },
    [walletClient, poolAddress]
  );

  const withdraw = useCallback(
    async (params: {
      tokenAddress: string;
      amount: bigint;
      proof: ZKProof;
    }) => {
      if (!walletClient || !poolAddress) {
        setError("Wallet not connected or pool address not configured");
        return null;
      }
      setError(null);
      setStep("withdrawing");
      try {
        const signer = await walletClientToSigner(walletClient);
        if (!signer) throw new Error("Could not create signer");
        const result = await withdrawFromPool(
          poolAddress,
          params.tokenAddress,
          params.amount,
          params.proof,
          signer
        );
        setTxHash(result.txHash);
        setStep("done");
        return result;
      } catch (err) {
        setStep("error");
        setError(err instanceof Error ? err.message : "Withdrawal failed");
        return null;
      }
    },
    [walletClient, poolAddress]
  );

  const withdrawToERC20 = useCallback(
    async (params: {
      wrapperAddress: string;
      amount: bigint;
      proof: ZKProof;
    }) => {
      if (!walletClient || !poolAddress) {
        setError("Wallet not connected or pool address not configured");
        return null;
      }
      setError(null);
      setStep("withdrawing");
      try {
        const signer = await walletClientToSigner(walletClient);
        if (!signer) throw new Error("Could not create signer");
        const result = await withdrawToERC20FromPool(
          poolAddress,
          params.wrapperAddress,
          params.amount,
          params.proof,
          signer
        );
        setTxHash(result.txHash);
        setStep("done");
        return result;
      } catch (err) {
        setStep("error");
        setError(err instanceof Error ? err.message : "Withdrawal failed");
        return null;
      }
    },
    [walletClient, poolAddress]
  );

  const fetchAnonymitySet = useCallback(
    async (tokenAddress: string) => {
      if (!publicClient || !poolAddress) return 0;
      const provider = { getNetwork: async () => ({ chainId: 11155111n }), ...publicClient } as never;
      return getAnonymitySet(poolAddress, tokenAddress, provider);
    },
    [publicClient, poolAddress]
  );

  const fetchPrivacyLevel = useCallback(
    async (tokenAddress: string) => {
      if (!publicClient || !poolAddress) return "LOW" as PrivacyLevel;
      const provider = { getNetwork: async () => ({ chainId: 11155111n }), ...publicClient } as never;
      return getPrivacyLevel(poolAddress, tokenAddress, provider);
    },
    [publicClient, poolAddress]
  );

  const fetchMerkleRoot = useCallback(async () => {
    if (!publicClient || !poolAddress) return "0x0";
    const provider = { getNetwork: async () => ({ chainId: 11155111n }), ...publicClient } as never;
    return getMerkleRoot(poolAddress, provider);
  }, [publicClient, poolAddress]);

  const fetchMerkleProof = useCallback(
    async (commitment: bigint) => {
      if (!poolAddress) return null;
      try {
        // drpc.org: CORS-enabled, supports eth_getLogs without archive restrictions
        const provider = new ethers.JsonRpcProvider(SEPOLIA_LOGS_RPC);
        return await getMerkleProof(poolAddress, commitment, provider);
      } catch {
        return null;
      }
    },
    [poolAddress]
  );

  const checkNullifier = useCallback(
    async (nullifier: bigint) => {
      if (!publicClient || !poolAddress) return false;
      const provider = { getNetwork: async () => ({ chainId: 11155111n }), ...publicClient } as never;
      return isNullifierSpent(poolAddress, nullifier, provider);
    },
    [publicClient, poolAddress]
  );

  const reset = useCallback(() => {
    setStep("idle");
    setTxHash(null);
    setError(null);
  }, []);

  return {
    step,
    txHash,
    error,
    deposit,
    withdraw,
    withdrawToERC20,
    fetchAnonymitySet,
    fetchPrivacyLevel,
    fetchMerkleRoot,
    fetchMerkleProof,
    checkNullifier,
    reset,
  };
}
