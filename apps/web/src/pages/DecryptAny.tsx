import { useState, useRef } from "react";
import { useAccount } from "wagmi";
import { useDecryptAny } from "../hooks/useDecryptAny";
import { OFFICIAL_PAIRS } from "@zhieldwrap/core";

// Watchlist stored in localStorage
const WATCHLIST_KEY = "zhieldwrap:decrypt:watchlist";

function getWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function addToWatchlist(address: string) {
  const list = getWatchlist();
  if (!list.includes(address.toLowerCase())) {
    list.push(address.toLowerCase());
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  }
}

import { useUserDecrypt } from "@zama-fhe/react-sdk";

const stepMessages: Record<string, string> = {
  idle: "",
  validating: "Validating contract on Sepolia...",
  fetching_metadata: "Fetching token metadata...",
  fetching_handle: "Fetching encrypted balance handle...",
  done: "Token loaded — awaiting decryption signature",
  error: "Error",
};

export function DecryptAny() {
  const { address, isConnected } = useAccount();
  const [inputAddress, setInputAddress] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>(getWatchlist());
  const [addedToWatchlist, setAddedToWatchlist] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { step, tokenInfo, error, loadToken, reset } = useDecryptAny();

  // Decryption via SDK
  const { data: decryptedData, isLoading: isDecrypting } = useUserDecrypt(
    {
      handles:
        tokenInfo?.handle
          ? [{ handle: tokenInfo.handle, contractAddress: tokenInfo.address as `0x${string}` }]
          : [],
    },
    { enabled: !!tokenInfo?.handle }
  );

  const decryptedBalance =
    tokenInfo?.handle && decryptedData
      ? (decryptedData[tokenInfo.handle] as bigint | undefined)
      : undefined;

  const handleDecrypt = () => {
    if (!isConnected || !address) return;
    reset();
    setAddedToWatchlist(false);
    loadToken(inputAddress.trim(), address);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInputAddress(text.trim());
      inputRef.current?.focus();
    } catch {
      // Clipboard access denied
    }
  };

  const handleAddToWatchlist = () => {
    if (tokenInfo) {
      addToWatchlist(tokenInfo.address);
      setWatchlist(getWatchlist());
      setAddedToWatchlist(true);
    }
  };

  const isInProgress =
    step === "validating" || step === "fetching_metadata" || step === "fetching_handle";

  return (
    <div className="max-w-xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Decrypt Any ERC-7984 Balance</h1>
        <p className="text-gray-400 text-sm mt-1">
          Paste any ERC-7984 token address on Sepolia to decrypt your balance.
          Works for tokens both inside and outside the official registry.
        </p>
      </div>

      {!isConnected && (
        <div className="card text-center py-8 mb-6">
          <div className="text-3xl mb-2">🔌</div>
          <p className="text-gray-400">Connect your wallet to decrypt balances</p>
        </div>
      )}

      <div className="card mb-4">
        {/* Address input */}
        <label className="block text-xs font-medium text-gray-400 mb-1">
          ERC-7984 Token Address
        </label>
        <div className="flex gap-2 mb-4">
          <input
            ref={inputRef}
            type="text"
            placeholder="0x..."
            value={inputAddress}
            onChange={(e) => {
              setInputAddress(e.target.value);
              reset();
            }}
            className="input-field flex-1 font-mono text-sm"
            disabled={isInProgress}
          />
          <button onClick={handlePaste} className="btn-secondary text-xs px-3">
            Paste
          </button>
        </div>

        {/* Step indicator */}
        {step !== "idle" && (
          <div
            className={`flex items-center gap-2 mb-4 text-sm ${
              step === "error" ? "text-red-400" : "text-zama-400"
            }`}
          >
            {isInProgress && <span className="animate-spin">⟳</span>}
            {step === "done" && !isDecrypting && !decryptedBalance && <span>⟳</span>}
            {stepMessages[step]}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-950/40 border border-red-800/50 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          onClick={handleDecrypt}
          disabled={!isConnected || !inputAddress.trim() || isInProgress}
          className="btn-primary w-full"
        >
          {isInProgress ? "Loading..." : "Load Token"}
        </button>
      </div>

      {/* Token info card */}
      {tokenInfo && (
        <div className="card animate-fade-in">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="font-semibold text-white">{tokenInfo.metadata.name}</div>
              <div className="text-sm text-gray-400">{tokenInfo.metadata.symbol}</div>
            </div>
            {tokenInfo.isInRegistry ? (
              <span className="badge-official">✓ In Registry</span>
            ) : (
              <span className="badge-custom">⚠ Not in Registry</span>
            )}
          </div>

          <div className="bg-gray-950/50 rounded-lg p-3 border border-gray-800/50 mb-4 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Contract</span>
              <a
                href={`https://sepolia.etherscan.io/address/${tokenInfo.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-zama-400 hover:text-zama-300"
              >
                {tokenInfo.address.slice(0, 10)}...{tokenInfo.address.slice(-6)} ↗
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Decimals</span>
              <span className="text-gray-300">{tokenInfo.metadata.decimals}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Handle</span>
              <span className="text-gray-300 font-mono">
                {tokenInfo.handle
                  ? `${tokenInfo.handle.slice(0, 10)}...`
                  : "Not found"}
              </span>
            </div>
          </div>

          {/* Decrypted balance */}
          <div className="bg-gray-950/50 rounded-lg p-4 border border-gray-800 text-center mb-4">
            <div className="text-xs text-gray-500 mb-1">Your Decrypted Balance</div>
            {isDecrypting ? (
              <div className="text-zama-400 animate-pulse text-sm">
                Waiting for your EIP-712 signature...
              </div>
            ) : decryptedBalance !== undefined ? (
              <div className="text-2xl font-bold text-emerald-400">
                {(Number(decryptedBalance) / 10 ** tokenInfo.metadata.decimals).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 6,
                })}{" "}
                <span className="text-sm font-normal text-gray-400">
                  {tokenInfo.metadata.symbol}
                </span>
              </div>
            ) : tokenInfo.handle ? (
              <div className="text-sm text-gray-500">
                🔒 Waiting for decryption...
              </div>
            ) : (
              <div className="text-sm text-gray-600">No handle found (balance may be 0)</div>
            )}
          </div>

          {/* Add to watchlist */}
          {!addedToWatchlist ? (
            <button onClick={handleAddToWatchlist} className="btn-secondary w-full text-sm">
              ⭐ Add to Watchlist
            </button>
          ) : (
            <div className="text-center text-sm text-emerald-400">✓ Added to watchlist</div>
          )}
        </div>
      )}

      {/* Watchlist */}
      {watchlist.length > 0 && (
        <div className="card mt-4">
          <h3 className="text-sm font-semibold text-white mb-3">Watchlist</h3>
          <div className="space-y-2">
            {watchlist.map((addr) => (
              <button
                key={addr}
                onClick={() => {
                  setInputAddress(addr);
                  reset();
                }}
                className="w-full text-left text-xs font-mono text-zama-400 hover:text-zama-300 bg-gray-950/50 rounded p-2 border border-gray-800 transition-colors"
              >
                {addr}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              localStorage.removeItem(WATCHLIST_KEY);
              setWatchlist([]);
            }}
            className="text-xs text-gray-600 hover:text-gray-400 mt-2"
          >
            Clear watchlist
          </button>
        </div>
      )}

      {/* Quick access — official pairs */}
      <div className="card mt-4">
        <h3 className="text-sm font-semibold text-white mb-3">Quick Access — Official ERC-7984 Tokens</h3>
        <div className="space-y-1">
          {OFFICIAL_PAIRS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setInputAddress(p.erc7984Address);
                reset();
              }}
              className="w-full flex items-center justify-between text-xs bg-gray-950/50 rounded p-2 border border-gray-800 hover:border-gray-700 transition-colors"
            >
              <span className="text-gray-300 font-medium">{p.symbol}</span>
              <span className="font-mono text-gray-600">
                {p.erc7984Address.slice(0, 10)}...
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
