import { useState, useCallback } from "react";
import { ethers } from "ethers";
import type { TokenMetadata } from "@zhieldwrap/core";
import { validateERC7984Contract, getTokenMetadata, getERC7984Handle } from "@zhieldwrap/core";
import { OFFICIAL_PAIRS } from "@zhieldwrap/core";

export type DecryptAnyStep =
  | "idle"
  | "validating"
  | "fetching_metadata"
  | "fetching_handle"
  | "done"
  | "error";

export interface DecryptedTokenInfo {
  address: string;
  metadata: TokenMetadata;
  handle: `0x${string}` | null;
  isInRegistry: boolean;
}

const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC ?? "https://rpc.sepolia.org";

export function useDecryptAny() {
  const [step, setStep] = useState<DecryptAnyStep>("idle");
  const [tokenInfo, setTokenInfo] = useState<DecryptedTokenInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadToken = useCallback(async (tokenAddress: string, userAddress: string) => {
    setError(null);
    setTokenInfo(null);

    if (!tokenAddress.trim()) {
      setError("Please enter a token address");
      return;
    }

    try {
      const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);

      // Step 1: Validate
      setStep("validating");
      await validateERC7984Contract(tokenAddress, provider);

      // Step 2: Metadata
      setStep("fetching_metadata");
      const metadata = await getTokenMetadata(tokenAddress, provider);

      // Step 3: Get balance handle
      setStep("fetching_handle");
      let handle: `0x${string}` | null = null;
      try {
        handle = await getERC7984Handle(tokenAddress, userAddress, provider);
      } catch {
        // Handle fetch failing is OK — user may need to connect wallet
        handle = null;
      }

      const isInRegistry = OFFICIAL_PAIRS.some(
        (p) =>
          p.erc7984Address.toLowerCase() === tokenAddress.toLowerCase() ||
          p.erc20Address.toLowerCase() === tokenAddress.toLowerCase()
      );

      setTokenInfo({ address: tokenAddress, metadata, handle, isInRegistry });
      setStep("done");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStep("error");
    }
  }, []);

  const reset = useCallback(() => {
    setStep("idle");
    setTokenInfo(null);
    setError(null);
  }, []);

  return { step, tokenInfo, error, loadToken, reset };
}
