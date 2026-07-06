import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { OFFICIAL_PAIRS, CROSS_SWAP_ROUTER_ADDRESS as ROUTER_CONSTANT } from "@zhieldwrap/core";
import { TxStatusModal } from "../components/ui/TxStatusModal";
import { useCrossSwap, type SwapStep } from "../hooks/useCrossSwap";
import type { CrossSwapRoute } from "@zhieldwrap/core";

const ROUTER_ADDRESS =
  (import.meta.env.VITE_CROSS_SWAP_ROUTER_ADDRESS as string | undefined) ??
  ROUTER_CONSTANT;

// Only show pairs that are registered + funded in CrossSwapRouter (USDC + USDT, both 6-dec)
const SWAP_PAIRS = OFFICIAL_PAIRS.filter((p) => p.id === "official-0" || p.id === "official-1");

function stepLabel(step: SwapStep): string {
  switch (step) {
    case "approving": return "Approving token…";
    case "swapping":  return "Executing swap…";
    case "done":      return "Swap complete!";
    case "error":     return "Swap failed";
    default:          return "Cross Swap";
  }
}

export default function CrossSwap() {
  const { isConnected } = useAccount();
  const { step, txHash, error, estimatedOutput, isRegistered, estimate, swap, checkRoute, reset } =
    useCrossSwap();

  const [inputPairId,  setInputPairId]  = useState(SWAP_PAIRS[0]?.id ?? "");
  const [outputPairId, setOutputPairId] = useState(SWAP_PAIRS[1]?.id ?? "");
  const [amount, setAmount]             = useState("");
  const [showModal, setShowModal]       = useState(false);

  const inPair  = SWAP_PAIRS.find((p) => p.id === inputPairId);
  const outPair = SWAP_PAIRS.find((p) => p.id === outputPairId);
  const amtBig  = inPair ? BigInt(Math.floor(parseFloat(amount || "0") * 10 ** inPair.decimals)) : 0n;

  // Live quote
  useEffect(() => {
    if (!inPair || !outPair || amtBig === 0n) return;
    const timer = setTimeout(() => {
      estimate(inPair.erc20Address, outPair.erc20Address, amtBig);
    }, 400);
    return () => clearTimeout(timer);
  }, [inputPairId, outputPairId, amount]);

  // Route check
  useEffect(() => {
    if (!inPair || !outPair) return;
    checkRoute(inPair.erc20Address, inPair.erc7984Address, outPair.erc20Address, outPair.erc7984Address);
  }, [inputPairId, outputPairId]);

  const handleSwap = async () => {
    if (!inPair || !outPair || amtBig === 0n) return;
    const route: CrossSwapRoute = {
      inputERC20:    inPair.erc20Address,
      inputERC7984:  inPair.erc7984Address,
      outputERC20:   outPair.erc20Address,
      outputERC7984: outPair.erc7984Address,
      estimatedOutput: estimatedOutput ?? amtBig,
    };
    setShowModal(true);
    await swap(route, amtBig);
  };

  const estimatedDisplay =
    estimatedOutput !== null && outPair
      ? (Number(estimatedOutput) / 10 ** outPair.decimals).toFixed(outPair.decimals)
      : amount;

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-1">Cross-Pair Swap</h1>
      <p className="text-zinc-400 text-sm mb-6">
        Pay with a plain ERC-20 token, receive a confidential ERC-7984 token.
        The output balance is encrypted on-chain via FhEVM.
      </p>

      {!ROUTER_ADDRESS && (
        <div className="bg-yellow-900/40 border border-yellow-600 rounded p-3 text-sm text-yellow-300 mb-4">
          Router not deployed yet — set <code>VITE_CROSS_SWAP_ROUTER_ADDRESS</code> in your .env.
        </div>
      )}

      <div className="card space-y-4">
        {/* Input pair */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">From (ERC-20)</label>
          <div className="flex gap-2">
            <select
              className="input-field w-36 shrink-0"
              value={inputPairId}
              onChange={(e) => { setInputPairId(e.target.value); reset(); }}
            >
              {SWAP_PAIRS.map((p) => (
                <option key={p.id} value={p.id}>{p.underlyingSymbol}</option>
              ))}
            </select>
            <input
              className="input-field flex-1"
              type="number" min="0" step="any" placeholder="0.0"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); reset(); }}
            />
          </div>
        </div>

        {/* Arrow */}
        <div className="flex justify-center">
          <button
            onClick={() => { setInputPairId(outputPairId); setOutputPairId(inputPairId); reset(); }}
            className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center hover:bg-zinc-600 transition-colors"
          >
            ⇅
          </button>
        </div>

        {/* Output pair */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">To (confidential cToken)</label>
          <div className="flex gap-2">
            <select
              className="input-field w-36 shrink-0"
              value={outputPairId}
              onChange={(e) => { setOutputPairId(e.target.value); reset(); }}
            >
              {SWAP_PAIRS.filter((p) => p.id !== inputPairId).map((p) => (
                <option key={p.id} value={p.id}>{p.symbol}</option>
              ))}
            </select>
            <div className="input-field flex-1 text-zinc-400">
              {estimatedDisplay || "0.0"}
            </div>
          </div>
        </div>

        {/* Route status */}
        {isRegistered !== null && (
          <div className={`text-xs px-3 py-2 rounded ${isRegistered ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
            {isRegistered
              ? `Route available: ${inPair?.underlyingSymbol} → ${outPair?.symbol}`
              : `Route not registered: ${inPair?.underlyingSymbol} → ${outPair?.symbol}`}
          </div>
        )}

        {/* Route details */}
        <div className="bg-zinc-800 rounded p-3 text-xs space-y-1 text-zinc-400">
          <div className="flex justify-between">
            <span>Exchange rate</span>
            <span className="text-zinc-200">1 {inPair?.underlyingSymbol} ≈ 1 {outPair?.symbol}</span>
          </div>
          <div className="flex justify-between">
            <span>Fee</span>
            <span className="text-zinc-200">0.00% (demo)</span>
          </div>
          <div className="flex justify-between">
            <span>Encrypted intermediary</span>
            <span className="text-green-400">Yes (FhEVM)</span>
          </div>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          className="btn-primary w-full"
          disabled={!isConnected || !amount || !isRegistered || step !== "idle"}
          onClick={handleSwap}
        >
          {step !== "idle" ? stepLabel(step) : "Swap"}
        </button>
      </div>

      {showModal && (
        <TxStatusModal
          txStatus={step === "done" ? { hash: txHash ?? "", status: "confirmed", message: "Swap confirmed" } :
                    step === "error" ? { hash: "", status: "failed", message: error ?? "Swap failed" } :
                    { hash: "", status: "pending", message: "Swap in progress…" }}
          isOpen
          onClose={() => { setShowModal(false); reset(); }}
        />
      )}
    </div>
  );
}
