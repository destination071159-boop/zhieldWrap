import { useState, useCallback } from "react";
import { useWalletClient } from "wagmi";
import { ethers } from "ethers";
import type { RegistryPair, TxStatus } from "@zhieldwrap/core";
import { mintFromFaucet, recordFaucetClaim, getFaucetCooldownRemaining, FAUCET_MINT_AMOUNT } from "@zhieldwrap/core";

export type FaucetStep = "idle" | "minting" | "done" | "error";

type WalletClientData = NonNullable<ReturnType<typeof useWalletClient>["data"]>;

function walletClientToSigner(walletClient: WalletClientData | undefined) {
  if (!walletClient) return null;
  const { account, chain, transport } = walletClient as {
    account: { address: string };
    chain: { id: number; name: string };
    transport: ethers.Eip1193Provider;
  };
  const provider = new ethers.BrowserProvider(transport as ethers.Eip1193Provider, {
    chainId: chain.id,
    name: chain.name,
  });
  return provider.getSigner(account.address);
}

export function useFaucet(pair: RegistryPair | null) {
  const [step, setStep] = useState<FaucetStep>("idle");
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: walletClient } = useWalletClient();

  const cooldownRemaining = pair
    ? getFaucetCooldownRemaining(pair.erc20Address)
    : 0;

  const claim = useCallback(async (userAddress: string) => {
    if (!pair || !walletClient) {
      setError("Wallet not connected");
      return;
    }
    if (!pair.hasFaucet) {
      setError("This token does not have a public faucet");
      return;
    }
    if (getFaucetCooldownRemaining(pair.erc20Address) > 0) {
      setError("You already claimed from this faucet recently. Wait 24 hours.");
      return;
    }

    setError(null);
    setTxStatus(null);

    try {
      const signerPromise = walletClientToSigner(walletClient);
      if (!signerPromise) throw new Error("Could not get signer");
      const signer = await signerPromise;

      setStep("minting");
      setTxStatus({ hash: "", status: "pending", message: "Minting tokens..." });

      // Adjust amount for token decimals
      const amount = pair.decimals === 6
        ? BigInt("1000000000") // 1,000 USDC/USDT (6 decimals)
        : FAUCET_MINT_AMOUNT;

      const result = await mintFromFaucet(pair.erc20Address, userAddress, amount, signer);
      setTxStatus(result);

      if (result.status === "confirmed") {
        recordFaucetClaim(pair.erc20Address);
        setStep("done");
      } else {
        setStep("error");
        setError(result.message);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setTxStatus({ hash: "", status: "failed", message: msg });
      setStep("error");
    }
  }, [pair, walletClient]);

  const reset = useCallback(() => {
    setStep("idle");
    setTxStatus(null);
    setError(null);
  }, []);

  return { step, txStatus, error, cooldownRemaining, claim, reset };
}
