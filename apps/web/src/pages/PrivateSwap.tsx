import { useState } from "react";
import { useAccount } from "wagmi";
import { useEncrypt } from "@zama-fhe/react-sdk";
import { parseUnits } from "ethers";
import { OFFICIAL_PAIRS, computeCommitment } from "@zhieldwrap/core";
import { TxStatusModal } from "../components/ui/TxStatusModal";
import { PrivacyScore } from "../components/ui/PrivacyScore";
import { usePrivacyPool } from "../hooks/usePrivacyPool";
import { useZKProof } from "../hooks/useZKProof";

type Tab = "deposit" | "withdraw";

interface SwapNote {
  secret: string;  // bigint as decimal string
  amount: string;  // bigint as decimal string
  symbol: string;
}

function encodeNote(note: SwapNote): string {
  return btoa(JSON.stringify(note));
}

function decodeNote(encoded: string): SwapNote | null {
  try {
    return JSON.parse(atob(encoded.trim())) as SwapNote;
  } catch {
    return null;
  }
}

export default function PrivateSwap() {
  const { address, isConnected } = useAccount();
  const pool    = usePrivacyPool();
  const zk      = useZKProof();
  const encrypt = useEncrypt();

  const [tab, setTab] = useState<Tab>("deposit");

  // ── Deposit state (Wallet A)
  const [depositPairId, setDepositPairId] = useState(OFFICIAL_PAIRS[0]?.id ?? "");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositNote,   setDepositNote]   = useState<string | null>(null);
  const [showDepositModal, setShowDepositModal] = useState(false);

  // ── Withdraw state (Wallet B)
  const [withdrawNote,   setWithdrawNote]   = useState("");
  const [withdrawPairId, setWithdrawPairId] = useState(OFFICIAL_PAIRS[1]?.id ?? "");
  const [withdrawError,  setWithdrawError]  = useState<string | null>(null);
  const [withdrawTxHash, setWithdrawTxHash] = useState<string | null>(null);
  const [withdrawStep,   setWithdrawStep]   = useState<"idle" | "proving" | "done" | "error">("idle");
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);

  const depositPair  = OFFICIAL_PAIRS.find((p) => p.id === depositPairId);
  const withdrawPair = OFFICIAL_PAIRS.find((p) => p.id === withdrawPairId);

  // ──────────────────────────────────────────────────────────────────────────
  // DEPOSIT (Wallet A)
  // ──────────────────────────────────────────────────────────────────────────
  const handleDeposit = async () => {
    if (!isConnected || !address || !depositPair || !depositAmount) return;
    const amtBase = parseUnits(depositAmount, depositPair.decimals);
    if (amtBase === 0n) return;

    // 1. Generate a random secret + commitment
    const depositProof = await zk.generateDepositCommitment({
      amount:       amtBase,
      tokenAddress: depositPair.erc7984Address,
    });
    if (!depositProof) return;

    // 2. Encrypt amount against the cToken contract (FHE input proof)
    let enc: Awaited<ReturnType<typeof encrypt.mutateAsync>>;
    try {
      enc = await encrypt.mutateAsync({
        values:          [{ value: amtBase, type: "euint64" as const }],
        contractAddress: depositPair.erc7984Address as `0x${string}`,
        userAddress:     address as `0x${string}`,
      });
    } catch {
      return;
    }

    // 3. Deposit into the Privacy Pool
    setShowDepositModal(true);
    const result = await pool.deposit({
      tokenAddress:    depositPair.erc7984Address,
      commitment:      depositProof.commitment,
      encryptedAmount: enc.handles[0]! as Uint8Array,
      inputProof:      enc.inputProof,
    });
    if (!result) return;

    // 4. Build the note for Wallet B to redeem
    const note: SwapNote = {
      secret: depositProof.secret.toString(),
      amount: amtBase.toString(),
      symbol: depositPair.symbol,
    };
    setDepositNote(encodeNote(note));
  };

  // ──────────────────────────────────────────────────────────────────────────
  // WITHDRAW (Wallet B — fresh wallet, unlinked from Wallet A)
  // ──────────────────────────────────────────────────────────────────────────
  const handleWithdraw = async () => {
    if (!isConnected || !address || !withdrawPair || !withdrawNote.trim()) return;

    const note = decodeNote(withdrawNote);
    if (!note) {
      setWithdrawError("Invalid note — paste the exact note from the depositor.");
      return;
    }

    setWithdrawError(null);
    setWithdrawStep("proving");
    setShowWithdrawModal(true);

    try {
      const secret = BigInt(note.secret);
      const amount = BigInt(note.amount);
      const commitment = computeCommitment(secret, amount);

      // 1. Rebuild the full Merkle tree (all tokens) and get the path for this commitment
      const merkleProof = await pool.fetchMerkleProof(commitment);
      if (!merkleProof) {
        throw new Error("Commitment not found in pool. Is the deposit confirmed?");
      }

      // 2. Generate a ZK proof of Merkle membership (proving secret + amount without revealing them)
      const zkProof = await zk.generateWithdrawProof({
        secret,
        amount,
        root:         merkleProof.root,
        pathElements: merkleProof.pathElements,
        pathIndices:  merkleProof.pathIndices,
      });
      if (!zkProof) throw new Error("ZK proof generation failed");

      // 3. Withdraw output token — this wallet receives withdrawPair.symbol
      const result = await pool.withdraw({
        tokenAddress: withdrawPair.erc7984Address,
        amount,
        proof:        zkProof,
      });
      if (!result) throw new Error("Withdraw transaction failed");

      setWithdrawTxHash(result.txHash);
      setWithdrawStep("done");
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "Withdrawal failed");
      setWithdrawStep("error");
    }
  };

  const depositIsLoading =
    zk.step === "generating-commitment" || pool.step === "depositing";
  const withdrawIsLoading =
    withdrawStep === "proving" || pool.step === "withdrawing";

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-1">ZK Private Swap</h1>
      <p className="text-zinc-400 text-sm mb-6">
        Wallet A deposits a cToken with a secret commitment. Wallet B uses the note
        to withdraw a <span className="text-white">different</span> cToken — no on-chain link between them.
      </p>

      {/* ── Tabs ── */}
      <div className="flex mb-4 rounded-lg overflow-hidden border border-zinc-700">
        {(["deposit", "withdraw"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              tab === t
                ? "bg-zinc-700 text-white"
                : "bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
            }`}
            onClick={() => setTab(t)}
          >
            {t === "deposit" ? "1 · Deposit (Wallet A)" : "2 · Withdraw (Wallet B)"}
          </button>
        ))}
      </div>

      {/* ──────────────── DEPOSIT TAB ──────────────── */}
      {tab === "deposit" && (
        <div className="card space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Token to deposit</label>
            <select
              className="input-field w-full"
              value={depositPairId}
              onChange={(e) => { setDepositPairId(e.target.value); setDepositNote(null); pool.reset(); }}
            >
              {OFFICIAL_PAIRS.map((p) => (
                <option key={p.id} value={p.id}>{p.symbol}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Amount</label>
            <input
              className="input-field w-full"
              type="number"
              min="0"
              step="any"
              placeholder="0.0"
              value={depositAmount}
              onChange={(e) => { setDepositAmount(e.target.value); setDepositNote(null); }}
            />
          </div>

          <div className="bg-zinc-800 rounded p-3 flex items-center justify-between gap-3">
            <div className="text-xs text-zinc-400 space-y-1 min-w-0">
              <div>Pool: <span className="text-zinc-200">PrivacyPool (shared Merkle tree)</span></div>
              <div className="text-green-400">Deposit amount is FHE-encrypted — never on-chain in clear</div>
              <div className="text-zinc-500">You receive a note — share it with Wallet B to claim</div>
            </div>
            <PrivacyScore score={85} size="sm" label="High" />
          </div>

          {zk.step === "generating-commitment" && (
            <p className="text-xs text-indigo-300 animate-pulse">Generating commitment…</p>
          )}
          {pool.step === "depositing" && (
            <p className="text-xs text-indigo-300 animate-pulse">Depositing into pool…</p>
          )}
          {pool.error && <p className="text-xs text-red-400">{pool.error}</p>}

          {/* Swap note */}
          {depositNote && (
            <div className="bg-green-900/30 border border-green-700/40 rounded p-3 space-y-2">
              <p className="text-xs text-green-400 font-medium">
                Deposit confirmed! Give this note to Wallet B:
              </p>
              <div className="bg-zinc-900 rounded p-2 font-mono text-xs text-zinc-300 break-all select-all cursor-text">
                {depositNote}
              </div>
              <button
                className="text-xs text-zinc-400 hover:text-white underline"
                onClick={() => navigator.clipboard.writeText(depositNote)}
              >
                Copy note
              </button>
            </div>
          )}

          <button
            className="btn-primary w-full"
            disabled={
              !isConnected ||
              !depositAmount ||
              parseFloat(depositAmount || "0") <= 0 ||
              depositIsLoading
            }
            onClick={handleDeposit}
          >
            {depositIsLoading ? "Processing…" : "Deposit & Get Note"}
          </button>
        </div>
      )}

      {/* ──────────────── WITHDRAW TAB ──────────────── */}
      {tab === "withdraw" && (
        <div className="card space-y-4">
          <div className="bg-amber-900/20 border border-amber-700/40 rounded p-2 text-xs text-amber-300">
            Use a <strong>fresh wallet</strong> with no prior on-chain activity for maximum unlinkability.
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Note from depositor (Wallet A)</label>
            <textarea
              className="input-field w-full font-mono text-xs resize-none"
              rows={3}
              placeholder="Paste the note here…"
              value={withdrawNote}
              onChange={(e) => { setWithdrawNote(e.target.value); setWithdrawError(null); setWithdrawStep("idle"); }}
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Token you want to receive</label>
            <select
              className="input-field w-full"
              value={withdrawPairId}
              onChange={(e) => setWithdrawPairId(e.target.value)}
            >
              {OFFICIAL_PAIRS.map((p) => (
                <option key={p.id} value={p.id}>{p.symbol}</option>
              ))}
            </select>
          </div>

          <div className="bg-zinc-800 rounded p-3 flex items-center justify-between gap-3">
            <div className="text-xs text-zinc-400 space-y-1 min-w-0">
              <div>
                Route:{" "}
                <span className="text-zinc-200">
                  Note → Merkle proof → ZK proof → {withdrawPair?.symbol}
                </span>
              </div>
              <div className="text-green-400">No on-chain link to the depositor</div>
              <div className="text-zinc-500">Proof generation runs fully in-browser (~30s)</div>
            </div>
            <PrivacyScore score={90} size="sm" label="High" />
          </div>

          {withdrawStep === "proving" && zk.step !== "generating-proof" && (
            <p className="text-xs text-indigo-300 animate-pulse">Fetching Merkle proof from pool…</p>
          )}
          {zk.step === "generating-proof" && (
            <p className="text-xs text-indigo-300 animate-pulse">Generating ZK proof (~30s)…</p>
          )}
          {pool.step === "withdrawing" && (
            <p className="text-xs text-indigo-300 animate-pulse">
              Sending {withdrawPair?.symbol} to your wallet…
            </p>
          )}
          {(withdrawError || zk.error) && (
            <p className="text-xs text-red-400">{withdrawError ?? zk.error}</p>
          )}

          <button
            className="btn-primary w-full"
            disabled={!isConnected || !withdrawNote.trim() || withdrawIsLoading}
            onClick={handleWithdraw}
          >
            {withdrawIsLoading ? "Processing…" : "Withdraw"}
          </button>
        </div>
      )}

      {/* Deposit modal */}
      {showDepositModal && tab === "deposit" && (
        <TxStatusModal
          txStatus={
            pool.step === "done"
              ? { hash: pool.txHash ?? "", status: "confirmed", message: "Deposited! Share the note with Wallet B." }
              : pool.step === "error"
              ? { hash: "", status: "failed", message: pool.error ?? "Deposit failed" }
              : { hash: "", status: "pending", message: "Encrypting and depositing…" }
          }
          isOpen
          onClose={() => { setShowDepositModal(false); pool.reset(); }}
        />
      )}

      {/* Withdraw modal */}
      {showWithdrawModal && tab === "withdraw" && (
        <TxStatusModal
          txStatus={
            withdrawStep === "done"
              ? { hash: withdrawTxHash ?? "", status: "confirmed", message: `${withdrawPair?.symbol} sent to your wallet` }
              : withdrawStep === "error"
              ? { hash: "", status: "failed", message: withdrawError ?? "Withdrawal failed" }
              : { hash: "", status: "pending", message: zk.step === "generating-proof" ? "Generating ZK proof…" : "Building proof…" }
          }
          isOpen
          onClose={() => { setShowWithdrawModal(false); pool.reset(); setWithdrawStep("idle"); }}
        />
      )}
    </div>
  );
}
