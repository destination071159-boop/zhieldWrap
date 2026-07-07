import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { useQuery } from "@tanstack/react-query";
import type { RegistryPair } from "@zhieldwrap/core";
import { fetchAllPairs, OFFICIAL_PAIRS, getERC20Balance, FAUCET_MINT_AMOUNT, getFaucetCooldownRemaining } from "@zhieldwrap/core";
import { useFaucet } from "../hooks/useFaucet";
import { TxStatusModal } from "../components/ui/TxStatusModal";

const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC ?? "https://sepolia.infura.io/v3/af5f1e33ac0c4cd69daa3f63a587723e";

function formatCooldown(ms: number): string {
  if (ms <= 0) return "";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

interface FaucetCardProps {
  pair: RegistryPair;
  userAddress: string;
}

function FaucetCard({ pair, userAddress }: FaucetCardProps) {
  const { step, txStatus, error, claim, reset } = useFaucet(pair);
  const [showModal, setShowModal] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [cooldown, setCooldown] = useState(getFaucetCooldownRemaining(pair.erc20Address));

  useEffect(() => {
    const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
    getERC20Balance(pair.erc20Address, userAddress, provider)
      .then(setBalance)
      .catch(() => {});
  }, [pair.erc20Address, userAddress]);

  // Refresh cooldown every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCooldown(getFaucetCooldownRemaining(pair.erc20Address));
    }, 60_000);
    return () => clearInterval(interval);
  }, [pair.erc20Address]);

  useEffect(() => {
    if (txStatus) setShowModal(true);
  }, [txStatus]);

  const isMinting = step === "minting";
  const hasCooldown = cooldown > 0;

  const mintAmount =
    pair.decimals === 6
      ? BigInt("1000000000") // 1,000 for 6-decimal tokens
      : FAUCET_MINT_AMOUNT;

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-zama-900/50 border border-zama-800/50 flex items-center justify-center text-sm font-bold text-zama-400 shrink-0">
            {pair.underlyingSymbol.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-white text-sm truncate">{pair.underlyingSymbol}</div>
            <div className="text-xs text-gray-500 truncate">{pair.name}</div>
          </div>
        </div>
        <span className="badge-official shrink-0 ml-2">Public mint</span>
      </div>

      {/* Balance */}
      <div className="bg-gray-950/50 rounded-lg p-3 border border-gray-800/50 mb-4 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-500">Your balance</span>
          <span className="font-mono text-white">
            {balance !== null
              ? ethers.formatUnits(balance, pair.decimals)
              : "..."}{" "}
            {pair.underlyingSymbol}
          </span>
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-gray-500">Mint amount</span>
          <span className="font-mono text-emerald-400">
            +{ethers.formatUnits(mintAmount, pair.decimals)} {pair.underlyingSymbol}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/40 rounded p-2 mb-3">
          {error}
        </div>
      )}

      {/* Claim button */}
      <button
        onClick={async () => {
          reset();
          await claim(userAddress);
        }}
        disabled={isMinting || hasCooldown}
        className="btn-primary w-full"
      >
        {isMinting
          ? "Minting..."
          : hasCooldown
          ? `Cooldown: ${formatCooldown(cooldown)}`
          : `Get ${pair.underlyingSymbol}`}
      </button>

      <TxStatusModal
        txStatus={txStatus}
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          if (txStatus?.status === "confirmed") {
            // Refresh balance
            const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
            getERC20Balance(pair.erc20Address, userAddress, provider)
              .then(setBalance)
              .catch(() => {});
            setCooldown(getFaucetCooldownRemaining(pair.erc20Address));
          }
          reset();
        }}
      />
    </div>
  );
}

export function Faucet() {
  const { address, isConnected } = useAccount();
  const [searchParams] = useSearchParams();
  const tokenParam = searchParams.get("token");

  const { data: pairs = OFFICIAL_PAIRS } = useQuery({
    queryKey: ["registry", "pairs"],
    queryFn: fetchAllPairs,
    staleTime: 30_000,
  });

  const faucetPairs = pairs.filter((p) => p.hasFaucet);

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Faucet</h1>
        <p className="text-gray-400 text-sm mt-1 max-w-2xl">
          Claim official Zama cTokenMock test tokens on Sepolia. The mock ERC-20 contracts
          have a public <code className="font-mono text-zama-400">mint()</code> function
          — no faucet contract needed. Client-side 24h cooldown applies.
        </p>
      </div>

      {!isConnected || !address ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-3">🔌</div>
          <p className="text-gray-400 font-medium">Connect your wallet</p>
          <p className="text-gray-600 text-sm mt-1">
            Connect to claim test tokens from the faucet.
          </p>
        </div>
      ) : (
        <>
          {faucetPairs.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-gray-400">No faucet pairs found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {faucetPairs.map((pair) => (
                <div
                  key={pair.id}
                  className={
                    tokenParam?.toLowerCase() === pair.erc20Address.toLowerCase()
                      ? "ring-2 ring-zama-500 rounded-xl"
                      : ""
                  }
                >
                  <FaucetCard
                    pair={pair}
                    userAddress={address}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Info about ctGBP */}
          <div className="mt-6 p-4 bg-amber-900/20 border border-amber-800/40 rounded-xl text-xs text-amber-400">
            <span className="font-medium">Note:</span> The <code className="font-mono">ctGBP</code>{" "}
            pair (non-mock tGBP) has a restricted mint function and is not available from this
            faucet. Only the 7 official <code className="font-mono">*Mock</code> tokens are listed.
          </div>
        </>
      )}
    </div>
  );
}
