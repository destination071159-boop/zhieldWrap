import { useState, useEffect } from "react";
import { useEncrypt, useUserDecrypt } from "@zama-fhe/react-sdk";
import { useParams, useSearchParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { useQuery } from "@tanstack/react-query";
import { fetchAllPairs, OFFICIAL_PAIRS } from "@zhieldwrap/core";
import type { RegistryPair } from "@zhieldwrap/core";
import { useWrap, type WrapMode } from "../hooks/useWrap";
import { TxStatusModal } from "../components/ui/TxStatusModal";

function formatBalance(raw: bigint | null, decimals: number, symbol: string) {
  if (raw === null) return "—";
  return `${ethers.formatUnits(raw, decimals)} ${symbol}`;
}

export function Wrap() {
  const { pairId } = useParams<{ pairId?: string }>();
  const [searchParams] = useSearchParams();
  const { address, isConnected } = useAccount();

  const initialMode = (searchParams.get("mode") as WrapMode) ?? "wrap";
  const [mode, setMode] = useState<WrapMode>(initialMode);
  const [selectedPair, setSelectedPair] = useState<RegistryPair | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [erc7984Handle, setErc7984Handle] = useState<`0x${string}` | null>(null);

  const { data: pairs = OFFICIAL_PAIRS } = useQuery({
    queryKey: ["registry", "pairs"],
    queryFn: fetchAllPairs,
    staleTime: 30_000,
  });

  const { step, txStatus, error, erc20Balance, pendingRequestIds, wrap, unwrap, finalizePending, checkPendingUnwraps, reset, fetchErc20Balance } =
    useWrap(selectedPair);
  const encrypt = useEncrypt();

  // Fetch ERC-7984 handle for balance decryption in unwrap mode
  useEffect(() => {
    if (mode !== "unwrap" || !selectedPair || !address) {
      setErc7984Handle(null);
      return;
    }
    const ABI = [
      "function confidentialBalanceOf(address) view returns (bytes32)",
      "function getHandle(address) view returns (bytes32)",
    ];
    const provider = window.ethereum
      ? new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider)
      : new ethers.JsonRpcProvider("https://rpc.sepolia.org");
    const contract = new ethers.Contract(selectedPair.erc7984Address, ABI, provider);
    (async () => {
      try {
        let h: string;
        try { h = await contract.confidentialBalanceOf(address); }
        catch { h = await contract.getHandle(address); }
        setErc7984Handle(h && h !== ethers.ZeroHash ? (h as `0x${string}`) : null);
      } catch { setErc7984Handle(null); }
    })();
  }, [mode, selectedPair, address]);

  const { data: decryptedData, isLoading: isDecrypting } = useUserDecrypt(
    {
      handles: erc7984Handle && selectedPair
        ? [{ handle: erc7984Handle, contractAddress: selectedPair.erc7984Address as `0x${string}` }]
        : [],
    },
    { enabled: !!erc7984Handle }
  );
  const decryptedErc7984Balance: bigint | undefined =
    erc7984Handle && decryptedData ? (decryptedData[erc7984Handle] as bigint | undefined) : undefined;

  // Pre-select pair from route
  useEffect(() => {
    if (pairId && pairs.length > 0) {
      const found = pairs.find((p) => p.id === pairId);
      if (found) setSelectedPair(found);
    }
  }, [pairId, pairs]);

  // Refresh ERC-20 balance when pair or address changes
  useEffect(() => {
    if (selectedPair && address) {
      fetchErc20Balance(address);
    }
  }, [selectedPair, address, fetchErc20Balance]);

  // Check for pending unwrap requests when in unwrap mode
  useEffect(() => {
    if (mode === "unwrap" && selectedPair && address) {
      checkPendingUnwraps(address);
    }
  }, [mode, selectedPair, address, checkPendingUnwraps]);

  // Open modal when tx is in-flight or done
  useEffect(() => {
    if (txStatus) setShowModal(true);
  }, [txStatus]);

  const parsedAmount = (() => {
    try {
      if (!amountRaw || !selectedPair) return 0n;
      return ethers.parseUnits(amountRaw, selectedPair.decimals);
    } catch {
      return 0n;
    }
  })();

  const isLoading =
    step === "checking_allowance" ||
    step === "approving" ||
    step === "wrapping" ||
    step === "unwrapping" ||
    step === "finalizing";

  const handleSubmit = async () => {
    if (!address) return;
    if (parsedAmount <= 0n) return;
    reset();

    if (mode === "wrap") {
      await wrap(parsedAmount, address);
    } else {
      // Encrypt the amount before passing to the contract (externalEuint64 + inputProof)
      const enc = await encrypt.mutateAsync({
        values: [{ value: parsedAmount, type: "euint64" as const }],
        contractAddress: selectedPair!.erc7984Address as `0x${string}`,
        userAddress: address,
      });
      const inputProofHex = ethers.hexlify(enc.inputProof) as `0x${string}`;
      const handleHex = ethers.hexlify(enc.handles[0]!) as `0x${string}`;
      await unwrap(parsedAmount, handleHex, inputProofHex);
    }
  };

  const handleSetMax = () => {
    if (erc20Balance !== null && selectedPair) {
      setAmountRaw(ethers.formatUnits(erc20Balance, selectedPair.decimals));
    }
  };

  const stepLabels: Record<string, string> = {
    idle: "",
    checking_allowance: "Checking allowance...",
    approving: "Approving token spend (sign in wallet)...",
    wrapping: "Wrapping tokens (sign in wallet)...",
    unwrapping: "Unwrapping tokens (sign in wallet)...",
    finalizing: "Fetching KMS proof & finalizing unwrap...",
    done: "Done!",
    error: "Something went wrong",
  };

  return (
    <div className="max-w-xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Wrap / Unwrap</h1>
        <p className="text-gray-400 text-sm mt-1">
          Convert between ERC-20 and ERC-7984 confidential tokens.
        </p>
      </div>

      <div className="card">
        {/* Mode tabs */}
        <div className="flex bg-gray-800 rounded-lg p-1 gap-1 mb-6">
          {(["wrap", "unwrap"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                reset();
              }}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-zama-700 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {m === "wrap" ? "↓ Wrap (ERC-20 → ERC-7984)" : "↑ Unwrap (ERC-7984 → ERC-20)"}
            </button>
          ))}
        </div>

        {/* Pair selector */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Select Token Pair
          </label>
          <select
            value={selectedPair?.id ?? ""}
            onChange={(e) => {
              const found = pairs.find((p) => p.id === e.target.value);
              setSelectedPair(found ?? null);
              setAmountRaw("");
              reset();
            }}
            className="input-field"
          >
            <option value="">-- Select a pair --</option>
            {pairs.map((p) => (
              <option key={p.id} value={p.id}>
                {mode === "wrap"
                  ? `${p.underlyingSymbol} → ${p.symbol}`
                  : `${p.symbol} → ${p.underlyingSymbol}`}{" "}
                {p.isCustom ? "(Custom)" : "(Official)"}
              </option>
            ))}
          </select>
        </div>

        {/* Selected pair info */}
        {selectedPair && (
          <div className="bg-gray-950/50 rounded-lg p-3 border border-gray-800/50 mb-4 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">ERC-20</span>
              <a
                href={`https://sepolia.etherscan.io/address/${selectedPair.erc20Address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-zama-400 hover:text-zama-300"
              >
                {selectedPair.erc20Address.slice(0, 10)}...
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">ERC-7984</span>
              <a
                href={`https://sepolia.etherscan.io/address/${selectedPair.erc7984Address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-zama-400 hover:text-zama-300"
              >
                {selectedPair.erc7984Address.slice(0, 10)}...
              </a>
            </div>
            <div className="flex justify-between border-t border-gray-800 pt-1 mt-1">
              <span className="text-gray-500">
                {mode === "wrap"
                  ? `Your ${selectedPair.underlyingSymbol} balance`
                  : `Your ${selectedPair.symbol} balance`}
              </span>
              <span className="text-white">
                {mode === "wrap"
                  ? formatBalance(erc20Balance, selectedPair.decimals, selectedPair.underlyingSymbol)
                  : isDecrypting
                  ? "Decrypting..."
                  : decryptedErc7984Balance !== undefined
                  ? formatBalance(decryptedErc7984Balance, selectedPair.decimals, selectedPair.symbol)
                  : "—"}
              </span>
            </div>
          </div>
        )}

        {/* Pending unwrap banner */}
        {mode === "unwrap" && pendingRequestIds.length > 0 && (
          <div className="mb-4 p-3 bg-yellow-950/40 border border-yellow-700/50 rounded-lg">
            <p className="text-xs font-semibold text-yellow-400 mb-2">
              ⚠ {pendingRequestIds.length} pending unwrap{pendingRequestIds.length > 1 ? "s" : ""} found
            </p>
            {pendingRequestIds.map((id) => (
              <div key={id} className="flex items-center justify-between gap-2 mt-1">
                <span className="text-xs font-mono text-gray-400 truncate">{id.slice(0, 18)}...</span>
                <button
                  onClick={() => finalizePending(id)}
                  disabled={isLoading}
                  className="text-xs px-3 py-1 bg-yellow-700 hover:bg-yellow-600 text-white rounded font-medium shrink-0 disabled:opacity-50"
                >
                  Finalize
                </button>
              </div>
            ))}
            <p className="text-xs text-gray-500 mt-2">
              Your ERC-7984 was already burned. Click Finalize to claim your ERC-20.
            </p>
          </div>
        )}

        {/* Amount input */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Amount
          </label>
          <div className="relative">
            <input
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={amountRaw}
              onChange={(e) => setAmountRaw(e.target.value)}
              disabled={isLoading || !selectedPair}
              className="input-field pr-16"
            />
            {mode === "wrap" && erc20Balance !== null && selectedPair && (
              <button
                onClick={handleSetMax}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zama-400 hover:text-zama-300 font-medium px-1"
              >
                MAX
              </button>
            )}
          </div>
          {selectedPair && (
            <div className="text-xs text-gray-600 mt-1">
              Token: {mode === "wrap" ? selectedPair.underlyingSymbol : selectedPair.symbol}
            </div>
          )}
        </div>

        {/* Step indicator */}
        {step !== "idle" && step !== "done" && (
          <div className="mb-4 text-sm text-zama-400 flex items-center gap-2">
            {isLoading && <span className="animate-spin">⟳</span>}
            {stepLabels[step]}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-950/40 border border-red-800/50 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Not connected */}
        {!isConnected && (
          <div className="mb-4 p-3 bg-gray-800 rounded-lg text-sm text-gray-400 text-center">
            Connect your wallet to wrap or unwrap tokens.
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!isConnected || !selectedPair || parsedAmount <= 0n || isLoading}
          className="btn-primary w-full"
        >
          {isLoading
            ? step === "approving"
              ? "Approving..."
              : "Processing..."
            : mode === "wrap"
            ? `Wrap ${selectedPair?.underlyingSymbol ?? "Token"}`
            : `Unwrap ${selectedPair?.symbol ?? "Token"}`}
        </button>

        {/* Wrap flow explanation */}
        <details className="mt-4">
          <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-400">
            How it works
          </summary>
          <div className="mt-2 text-xs text-gray-500 space-y-1 pl-2">
            {mode === "wrap" ? (
              <>
                <p>1. App checks your current ERC-20 allowance</p>
                <p>2. If needed, prompts you to approve the wrapper to spend your tokens</p>
                <p>3. Calls <code className="font-mono">wrap(amount)</code> on the ERC-7984 contract</p>
                <p>4. The contract encrypts the amount internally via FhEVM</p>
              </>
            ) : (
              <>
                <p>1. Calls <code className="font-mono">unwrap(amount)</code> on the ERC-7984 contract</p>
                <p>2. The contract decrypts your confidential balance and returns ERC-20 tokens</p>
                <p>3. ERC-20 tokens appear in your wallet</p>
              </>
            )}
          </div>
        </details>
      </div>

      <TxStatusModal
        txStatus={txStatus}
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          if (txStatus?.status === "confirmed") {
            setAmountRaw("");
            reset();
            if (address && selectedPair) fetchErc20Balance(address);
          }
        }}
        onRetry={() => {
          setShowModal(false);
          reset();
        }}
      />
    </div>
  );
}
