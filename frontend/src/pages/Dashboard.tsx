import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";
import type { RegistryPair } from "@zhieldwrap/core";
import { fetchAllPairs, OFFICIAL_PAIRS, getERC20Balance } from "@zhieldwrap/core";
import { useNavigate } from "react-router-dom";

import { useUserDecrypt } from "@zama-fhe/react-sdk";

const SEPOLIA_RPC = import.meta.env.VITE_SEPOLIA_RPC ?? "https://sepolia.infura.io/v3/af5f1e33ac0c4cd69daa3f63a587723e";

interface BalanceRowProps {
  pair: RegistryPair;
  userAddress: string;
}

function BalanceRow({ pair, userAddress }: BalanceRowProps) {
  const navigate = useNavigate();
  const [handleHex, setHandleHex] = useState<`0x${string}` | null>(null);
  const [handleLoading, setHandleLoading] = useState(false);
  const [erc20Balance, setErc20Balance] = useState<bigint | null>(null);

  // Fetch ERC-20 balance + balance handle together on mount
  const fetchData = async () => {
    setHandleLoading(true);
    try {
      const provider = window.ethereum
        ? new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider)
        : new ethers.JsonRpcProvider(SEPOLIA_RPC);

      // ERC-20 balance (plaintext)
      const bal = await getERC20Balance(pair.erc20Address, userAddress, provider);
      setErc20Balance(bal);

      // ERC-7984 handle — try OZ confidentialBalanceOf first, then fallbacks
      const ABI = [
        "function confidentialBalanceOf(address) view returns (bytes32)",
        "function getHandle(address) view returns (bytes32)",
      ];
      const contract = new ethers.Contract(pair.erc7984Address, ABI, provider);
      let h: string;
      try {
        h = await contract.confidentialBalanceOf(userAddress);
      } catch {
        h = await contract.getHandle(userAddress);
      }
      if (h && h !== ethers.ZeroHash) {
        setHandleHex(h as `0x${string}`);
      }
    } catch {
      // Non-critical — some handles may not exist yet
    } finally {
      setHandleLoading(false);
    }
  };

  // Decrypt using @zama-fhe/react-sdk
  const { data: decryptedData, isLoading: isDecrypting } = useUserDecrypt(
    {
      handles: handleHex
        ? [{ handle: handleHex, contractAddress: pair.erc7984Address as `0x${string}` }]
        : [],
    },
    { enabled: !!handleHex }
  );

  const decryptedBalance =
    handleHex && decryptedData
      ? (decryptedData[handleHex] as bigint | undefined)
      : undefined;

  return (
    <div className="flex items-center justify-between py-4 gap-4">
      {/* Token info */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full bg-zama-900/50 border border-zama-800/50 flex items-center justify-center text-xs font-bold text-zama-400 shrink-0">
          {pair.underlyingSymbol.slice(0, 2)}
        </div>
        <div className="min-w-0">
          <div className="font-medium text-sm text-white truncate">{pair.symbol}</div>
          <div className="text-xs text-gray-500">{pair.underlyingSymbol}</div>
        </div>
      </div>

      {/* ERC-20 balance */}
      <div className="text-right shrink-0">
        <div className="text-xs text-gray-500 mb-0.5">ERC-20</div>
        <div className="text-sm text-white font-mono">
          {erc20Balance !== null
            ? ethers.formatUnits(erc20Balance, pair.decimals)
            : "—"}
        </div>
      </div>

      {/* ERC-7984 balance */}
      <div className="text-right shrink-0">
        <div className="text-xs text-gray-500 mb-0.5">ERC-7984</div>
        {isDecrypting ? (
          <div className="text-xs text-zama-400 animate-pulse">Decrypting...</div>
        ) : decryptedBalance !== undefined ? (
          <div className="text-sm text-emerald-400 font-mono">
            {ethers.formatUnits(decryptedBalance, pair.decimals)}
          </div>
        ) : (
          <div className="text-sm text-gray-600">🔒 Encrypted</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={fetchData}
          disabled={handleLoading}
          className="text-xs text-zama-400 hover:text-zama-300 border border-zama-800 rounded px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed min-w-[54px] text-center"
        >
          {handleLoading ? "..." : handleHex ? "↺" : "Load"}
        </button>
        <button
          onClick={() => navigate(`/wrap/${pair.id}?mode=wrap`)}
          className="text-xs btn-secondary py-1 px-2"
        >
          Wrap
        </button>
        <button
          onClick={() => navigate(`/wrap/${pair.id}?mode=unwrap`)}
          className="text-xs btn-secondary py-1 px-2"
        >
          Unwrap
        </button>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { address, isConnected } = useAccount();

  const { data: pairs = OFFICIAL_PAIRS } = useQuery({
    queryKey: ["registry", "pairs"],
    queryFn: fetchAllPairs,
    staleTime: 30_000,
  });

  const officialPairs = pairs.filter((p) => p.isOfficial);

  if (!isConnected || !address) {
    return (
      <div className="max-w-3xl mx-auto animate-fade-in">
        <h1 className="text-2xl font-bold text-white mb-2">Balance Dashboard</h1>
        <p className="text-gray-400 text-sm mb-8">
          View and decrypt your ERC-7984 confidential token balances.
        </p>
        <div className="card text-center py-12">
          <div className="text-4xl mb-3">🔌</div>
          <p className="text-gray-400 font-medium">Connect your wallet</p>
          <p className="text-gray-600 text-sm mt-1">
            Connect to view your balances across all registry pairs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Balance Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">
          Your holdings across all official ERC-20 ↔ ERC-7984 pairs.
          Click <strong className="text-white">Load</strong> on a row to fetch the handle,
          then the SDK will request your signature to decrypt the confidential balance.
        </p>
      </div>

      <div className="card mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Official Pairs ({officialPairs.length})</h2>
          <span className="text-xs text-gray-500">EIP-712 decryption via @zama-fhe/react-sdk</span>
        </div>

        <div className="divide-y divide-gray-800">
          {officialPairs.map((pair) => (
            <BalanceRow key={pair.id} pair={pair} userAddress={address} />
          ))}
        </div>
      </div>

      <div className="p-4 bg-gray-900/50 border border-gray-800 rounded-xl text-xs text-gray-500">
        <p className="font-medium text-gray-400 mb-1">How balance decryption works</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Click <strong className="text-gray-300">Load</strong> to fetch the encrypted balance handle from the contract</li>
          <li>The Zama SDK automatically requests your EIP-712 signature in your wallet</li>
          <li>Your signature is sent to the Zama KMS gateway which decrypts and returns your balance</li>
          <li>The plaintext balance is displayed — your private key never leaves your wallet</li>
        </ol>
        <p className="mt-2">
          To decrypt any ERC-7984 token not listed here, use the{" "}
          <a href="/decrypt" className="text-zama-400 hover:text-zama-300 underline">
            Decrypt Any
          </a>{" "}
          page.
        </p>
      </div>
    </div>
  );
}
