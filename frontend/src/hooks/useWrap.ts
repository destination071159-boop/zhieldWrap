import { useState, useCallback } from "react";
import { useWalletClient } from "wagmi";
import { ethers } from "ethers";
import { usePublicDecrypt } from "@zama-fhe/react-sdk";
import type { RegistryPair, TxStatus } from "@zhieldwrap/core";
import {
  checkAllowance,
  approveToken,
  wrapToken,
  unwrapToken,
  finalizeUnwrap,
  getPendingUnwrapRequests,
  getERC20Balance,
  SEPOLIA_LOGS_RPC,
  PRIVACY_POOL_DEPLOY_BLOCK,
} from "@zhieldwrap/core";

export type WrapMode = "wrap" | "unwrap";
export type WrapStep =
  | "idle"
  | "checking_allowance"
  | "approving"
  | "wrapping"
  | "unwrapping"
  | "finalizing"
  | "done"
  | "error";

type WalletClientData = NonNullable<ReturnType<typeof useWalletClient>["data"]>;

function getWalletProvider(walletClient: WalletClientData) {
  const { chain, transport } = walletClient as {
    chain: { id: number; name: string };
    transport: ethers.Eip1193Provider;
  };
  return new ethers.BrowserProvider(transport, { chainId: chain.id, name: chain.name });
}

export function walletClientToSigner(walletClient: WalletClientData | undefined) {
  if (!walletClient) return null;
  const { account } = walletClient as { account: { address: string } };
  const provider = getWalletProvider(walletClient);
  return provider.getSigner(account.address);
}

export function useWrap(pair: RegistryPair | null) {
  const [step, setStep] = useState<WrapStep>("idle");
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [erc20Balance, setErc20Balance] = useState<bigint | null>(null);
  const [pendingRequestIds, setPendingRequestIds] = useState<string[]>([]);

  const { data: walletClient } = useWalletClient();
  const publicDecrypt = usePublicDecrypt();

  const fetchErc20Balance = useCallback(
    async (userAddress: string) => {
      if (!pair || !walletClient) return;
      try {
        const provider = getWalletProvider(walletClient);
        const balance = await getERC20Balance(pair.erc20Address, userAddress, provider);
        setErc20Balance(balance);
      } catch {
        // Non-critical
      }
    },
    [pair, walletClient]
  );

  const wrap = useCallback(
    async (amount: bigint, userAddress: string) => {
      if (!pair || !walletClient) {
        setError("Wallet not connected");
        return;
      }

      setError(null);
      setTxStatus(null);

      try {
        const signerPromise = walletClientToSigner(walletClient);
        if (!signerPromise) throw new Error("Could not get signer");
        const signer = await signerPromise;

        // Step 1: Check balance — use wallet's own provider (no external RPC needed)
        const provider = getWalletProvider(walletClient);
        const balance = await getERC20Balance(pair.erc20Address, userAddress, provider);
        if (balance < amount) {
          setError(
            `Insufficient ${pair.underlyingSymbol} balance. You have ${ethers.formatUnits(balance, pair.decimals)} but need ${ethers.formatUnits(amount, pair.decimals)}.`
          );
          setStep("error");
          return;
        }

        // Step 2: Check allowance
        setStep("checking_allowance");
        const allowance = await checkAllowance(
          pair.erc20Address,
          userAddress,
          pair.erc7984Address,
          provider
        );

        // Step 3: Approve if needed
        if (allowance < amount) {
          setStep("approving");
          const approvalResult = await approveToken(
            pair.erc20Address,
            pair.erc7984Address,
            amount,
            signer
          );
          if (approvalResult.status === "failed") {
            setError(approvalResult.message);
            setStep("error");
            return;
          }
        }

        // Step 4: Wrap
        setStep("wrapping");
        setTxStatus({ hash: "", status: "pending", message: "Wrapping tokens..." });
        const result = await wrapToken(pair, amount, signer);
        setTxStatus(result);
        setStep(result.status === "confirmed" ? "done" : "error");
        if (result.status === "failed") setError(result.message);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setTxStatus({ hash: "", status: "failed", message: msg });
        setStep("error");
      }
    },
    [pair, walletClient]
  );

  const unwrap = useCallback(
    async (amount: bigint, encryptedAmount: `0x${string}`, inputProof: `0x${string}`) => {
      if (!pair || !walletClient) {
        setError("Wallet not connected");
        return;
      }

      setError(null);
      setTxStatus(null);

      try {
        const signerPromise = walletClientToSigner(walletClient);
        if (!signerPromise) throw new Error("Could not get signer");
        const signer = await signerPromise;

        // Step 1: Submit unwrap TX (burns encrypted tokens, emits UnwrapRequested)
        setStep("unwrapping");
        setTxStatus({ hash: "", status: "pending", message: "Unwrapping tokens (sign in wallet)..." });
        const unwrapResult = await unwrapToken(pair, amount, encryptedAmount, inputProof, signer);

        if (unwrapResult.status === "failed") {
          setTxStatus(unwrapResult);
          setError(unwrapResult.message);
          setStep("error");
          return;
        }

        const requestId = unwrapResult.unwrapRequestId;
        if (!requestId) {
          // UnwrapRequested not found in logs — unexpected
          setTxStatus({ ...unwrapResult, message: "Unwrap TX confirmed but could not find UnwrapRequestId in logs" });
          setStep("done");
          return;
        }

        // Step 2: Fetch KMS decryption proof via Zama public decrypt API
        setStep("finalizing");
        setTxStatus({ ...unwrapResult, status: "pending", message: "Fetching decryption proof from KMS..." });

        const decryptResult = await publicDecrypt.mutateAsync([requestId as `0x${string}`]);
        const cleartext = decryptResult.clearValues[requestId as `0x${string}`];
        if (cleartext === undefined) {
          throw new Error("publicDecrypt returned no cleartext for requestId");
        }

        // Step 3: Call finalizeUnwrap on-chain to release ERC-20
        setTxStatus({ ...unwrapResult, status: "pending", message: "Finalizing unwrap (sign in wallet)..." });
        const finalResult = await finalizeUnwrap(
          pair,
          requestId,
          cleartext as bigint,
          decryptResult.decryptionProof,
          signer
        );

        setTxStatus(finalResult);
        setStep(finalResult.status === "confirmed" ? "done" : "error");
        if (finalResult.status === "failed") setError(finalResult.message);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setTxStatus({ hash: "", status: "failed", message: msg });
        setStep("error");
      }
    },
    [pair, walletClient, publicDecrypt]
  );

  const reset = useCallback(() => {
    setStep("idle");
    setTxStatus(null);
    setError(null);
  }, []);

  const checkPendingUnwraps = useCallback(
    async (userAddress: string) => {
      if (!pair) return;
      try {
        const logsProvider = new ethers.JsonRpcProvider(SEPOLIA_LOGS_RPC);
        const ids = await getPendingUnwrapRequests(
          pair.erc7984Address,
          userAddress,
          logsProvider,
          PRIVACY_POOL_DEPLOY_BLOCK
        );
        setPendingRequestIds(ids);
      } catch {
        // Non-critical — silently ignore
      }
    },
    [pair]
  );

  const finalizePending = useCallback(
    async (requestId: string) => {
      if (!pair || !walletClient) {
        setError("Wallet not connected");
        return;
      }
      setError(null);
      setTxStatus(null);
      try {
        const signerPromise = walletClientToSigner(walletClient);
        if (!signerPromise) throw new Error("Could not get signer");
        const signer = await signerPromise;

        setStep("finalizing");
        setTxStatus({ hash: "", status: "pending", message: "Fetching KMS decryption proof..." });

        const decryptResult = await publicDecrypt.mutateAsync([requestId as `0x${string}`]);
        const cleartext = decryptResult.clearValues[requestId as `0x${string}`];
        if (cleartext === undefined) throw new Error("publicDecrypt returned no cleartext");

        setTxStatus({ hash: "", status: "pending", message: "Finalizing unwrap (sign in wallet)..." });
        const finalResult = await finalizeUnwrap(
          pair,
          requestId,
          cleartext as bigint,
          decryptResult.decryptionProof,
          signer
        );

        setTxStatus(finalResult);
        setStep(finalResult.status === "confirmed" ? "done" : "error");
        if (finalResult.status === "confirmed") {
          setPendingRequestIds((prev) => prev.filter((id) => id !== requestId));
        } else {
          setError(finalResult.message);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setTxStatus({ hash: "", status: "failed", message: msg });
        setStep("error");
      }
    },
    [pair, walletClient, publicDecrypt]
  );

  return {
    step,
    txStatus,
    error,
    erc20Balance,
    pendingRequestIds,
    wrap,
    unwrap,
    finalizePending,
    checkPendingUnwraps,
    reset,
    fetchErc20Balance,
  };
}
