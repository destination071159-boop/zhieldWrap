import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { useWalletClient } from "wagmi";
import { walletClientToSigner } from "./useWrap";
import {
  estimateSwapOutput,
  executeSwap,
  isPairRegistered,
  CROSS_SWAP_ROUTER_ADDRESS as ROUTER_ADDRESS_CONSTANT,
  SEPOLIA_RPC,
  type CrossSwapRoute,
} from "@zhieldwrap/core";

const ROUTER_ADDRESS =
  (import.meta.env.VITE_CROSS_SWAP_ROUTER_ADDRESS as string | undefined) ??
  ROUTER_ADDRESS_CONSTANT;

export type SwapStep = "idle" | "approving" | "swapping" | "done" | "error";

interface UseCrossSwapReturn {
  step: SwapStep;
  txHash: string | null;
  error: string | null;
  estimatedOutput: bigint | null;
  isRegistered: boolean | null;
  estimate: (inputERC20: string, outputERC20: string, amount: bigint) => Promise<void>;
  swap: (route: CrossSwapRoute, amount: bigint) => Promise<{ txHash: string; outputAmount: bigint } | null>;
  checkRoute: (inputERC20: string, inputERC7984: string, outputERC20: string, outputERC7984: string) => Promise<boolean>;
  reset: () => void;
}

export function useCrossSwap(): UseCrossSwapReturn {
  const { data: walletClient } = useWalletClient();

  const [step, setStep]                     = useState<SwapStep>("idle");
  const [txHash, setTxHash]                 = useState<string | null>(null);
  const [error, setError]                   = useState<string | null>(null);
  const [estimatedOutput, setEstimatedOutput] = useState<bigint | null>(null);
  const [isRegistered, setIsRegistered]     = useState<boolean | null>(null);

  const routerAddress = ROUTER_ADDRESS ?? "";

  const estimate = useCallback(
    async (inputERC20: string, outputERC20: string, amount: bigint) => {
      if (!routerAddress || amount === 0n) {
        setEstimatedOutput(null);
        return;
      }
      try {
        const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
        const out = await estimateSwapOutput(routerAddress, inputERC20, outputERC20, amount, provider);
        setEstimatedOutput(out);
      } catch {
        setEstimatedOutput(null);
      }
    },
    [routerAddress]
  );

  const checkRoute = useCallback(
    async (inputERC20: string, inputERC7984: string, outputERC20: string, outputERC7984: string): Promise<boolean> => {
      if (!routerAddress) return false;
      try {
        const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
        const ok = await isPairRegistered(routerAddress, inputERC20, inputERC7984, outputERC20, outputERC7984, provider);
        setIsRegistered(ok);
        return ok;
      } catch (err) {
        console.error("[checkRoute] failed:", err);
        setIsRegistered(false);
        return false;
      }
    },
    [routerAddress]
  );

  const swap = useCallback(
    async (route: CrossSwapRoute, amount: bigint) => {
      if (!walletClient || !routerAddress) {
        setError("Wallet not connected or router address not configured");
        return null;
      }
      setError(null);
      setStep("approving");
      try {
        const signer = await walletClientToSigner(walletClient);
        if (!signer) throw new Error("Could not create signer");
        setStep("swapping");
        const result = await executeSwap(routerAddress, route, amount, signer);
        setTxHash(result.txHash);
        setEstimatedOutput(result.outputAmount);
        setStep("done");
        return result;
      } catch (err) {
        setStep("error");
        setError(err instanceof Error ? err.message : "Swap failed");
        return null;
      }
    },
    [walletClient, routerAddress]
  );

  const reset = useCallback(() => {
    setStep("idle");
    setTxHash(null);
    setError(null);
    setEstimatedOutput(null);
    setIsRegistered(null);
  }, []);

  return { step, txHash, error, estimatedOutput, isRegistered, estimate, swap, checkRoute, reset };
}
