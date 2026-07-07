import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useEncrypt, useUserDecrypt } from "@zama-fhe/react-sdk";
import { ethers } from "ethers";
import { OFFICIAL_PAIRS, getERC20Balance, computeCommitment } from "@zhieldwrap/core";
import { TxStatusModal } from "../components/ui/TxStatusModal";
import { PrivacyScore } from "../components/ui/PrivacyScore";
import { usePrivacyPool } from "../hooks/usePrivacyPool";
import { useZKProof } from "../hooks/useZKProof";

type Tab = "deposit" | "withdraw";

export default function Pool() {
  const { address, isConnected } = useAccount();
  const pool = usePrivacyPool();
  const zk   = useZKProof();
  const encrypt = useEncrypt();

  const [tab, setTab]               = useState<Tab>("deposit");
  const [tokenAddress, setToken]    = useState(OFFICIAL_PAIRS[0]?.erc7984Address ?? "");
  const [amount, setAmount]         = useState("");
  const [secretHex, setSecretHex]   = useState("");
  const [autoPath, setAutoPath]     = useState<{ pathElements: bigint[]; pathIndices: number[]; root: bigint } | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [anonymitySet, setAnonSet]  = useState<number>(0);
  const [merkleRoot, setRoot]       = useState("");
  const [showModal, setShowModal]   = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const refresh = () => setRefreshTrigger((n) => n + 1);

  // Balances
  const [erc20Balance, setErc20Balance]         = useState<bigint | null>(null);
  const [handleHex, setHandleHex]               = useState<`0x${string}` | null>(null);
  const [balanceLoading, setBalanceLoading]     = useState(false);

  const selectedPair = OFFICIAL_PAIRS.find(
    (p) => p.erc7984Address.toLowerCase() === tokenAddress.toLowerCase()
  );

  // Auto-fetch balances when token or address changes
  useEffect(() => {
    if (!address || !tokenAddress || !selectedPair) return;
    setErc20Balance(null);
    setHandleHex(null);
    setBalanceLoading(true);
    const provider = window.ethereum
      ? new ethers.BrowserProvider(window.ethereum as ethers.Eip1193Provider)
      : null;
    if (!provider) { setBalanceLoading(false); return; }
    const erc7984ABI = [
      "function confidentialBalanceOf(address) view returns (bytes32)",
      "function getHandle(address) view returns (bytes32)",
    ];
    Promise.allSettled([
      getERC20Balance(selectedPair.erc20Address, address, provider).then(setErc20Balance),
      (async () => {
        const contract = new ethers.Contract(tokenAddress, erc7984ABI, provider);
        let h: string;
        try { h = await contract.confidentialBalanceOf(address); }
        catch { h = await contract.getHandle(address); }
        if (h && h !== ethers.ZeroHash) setHandleHex(h as `0x${string}`);
      })(),
    ]).finally(() => setBalanceLoading(false));
  }, [tokenAddress, address, refreshTrigger]);

  useEffect(() => {
    if (!tokenAddress) return;
    pool.fetchAnonymitySet(tokenAddress).then(setAnonSet).catch(() => {});
    pool.fetchMerkleRoot().then(setRoot).catch(() => {});
  }, [tokenAddress, refreshTrigger]);

  // Decrypt ERC-7984 balance via Zama SDK
  const { data: decryptedData } = useUserDecrypt(
    { handles: handleHex ? [{ handle: handleHex, contractAddress: tokenAddress as `0x${string}` }] : [] },
    { enabled: !!handleHex }
  );
  const decryptedBalance = handleHex && decryptedData
    ? (decryptedData[handleHex] as bigint | undefined)
    : undefined;

  // Privacy score = min(anonymitySet / 100 * 100, 100) — scales with set size
  const privacyScore = Math.min(100, Math.floor((anonymitySet / 50) * 100));

  const handleDeposit = async () => {
    if (!isConnected) return;
    const decimals = selectedPair?.decimals ?? 18;
    const amtBig = BigInt(Math.floor(parseFloat(amount || "0") * 10 ** decimals));
    if (amtBig === 0n) return;

    // 1. Generate ZK commitment
    const depositProof = await zk.generateDepositCommitment({
      amount: amtBig,
      tokenAddress,
    });
    if (!depositProof) return;

    // 2. Encrypt amount
    const enc = await encrypt.mutateAsync({
      values: [{ value: amtBig, type: "euint64" as const }],
      contractAddress: tokenAddress as `0x${string}`,
      userAddress: address!,
    });
    const encryptedAmount = enc.handles[0]!;
    const inputProof = enc.inputProof;

    setShowModal(true);
    await pool.deposit({
      tokenAddress,
      commitment: depositProof.commitment,
      encryptedAmount,
      inputProof,
    });
    refresh();

    // Save SECRET — needed to regenerate ZK proof at withdrawal
    setSecretHex("0x" + depositProof.secret.toString(16));
  };

  const handleWithdraw = async () => {
    if (!isConnected || !address) return;
    const decimals = selectedPair?.decimals ?? 18;
    const amtBig = BigInt(Math.floor(parseFloat(amount || "0") * 10 ** decimals));
    if (amtBig === 0n || !secretHex || !autoPath) return;

    const secret = BigInt(secretHex);
    const { pathElements: path, pathIndices: pathIndicesArr, root } = autoPath;

    const proof = await zk.generateWithdrawProof({
      secret,
      amount:       amtBig,
      root,
      pathElements: path,
      pathIndices:  pathIndicesArr,
    });
    if (!proof) return;

    setShowModal(true);
    await pool.withdraw({
      tokenAddress,
      amount: amtBig,
      proof,
    });
    refresh();
  };

  const handleFetchProof = async () => {
    if (!secretHex || !amount) return;
    setProofLoading(true);
    try {
      const decimals = selectedPair?.decimals ?? 18;
      const amtBig = BigInt(Math.floor(parseFloat(amount) * 10 ** decimals));
      const commitment = computeCommitment(BigInt(secretHex), amtBig);
      const result = await pool.fetchMerkleProof(commitment);
      if (result) setAutoPath(result);
    } finally {
      setProofLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-1">Privacy Pool</h1>
      <p className="text-zinc-400 text-sm mb-6">
        Deposit ERC-7984 tokens with FHE encryption and withdraw privately using ZK proofs.
      </p>

      {/* Token selector */}
      <div className="card mb-4">
        <label className="block text-xs text-zinc-400 mb-1">Token</label>
        <select
          className="input-field"
          value={tokenAddress}
          onChange={(e) => { setToken(e.target.value); pool.reset(); }}
        >
          {OFFICIAL_PAIRS.map((p) => (
            <option key={p.id} value={p.erc7984Address}>
              {p.symbol} ({p.erc7984Address.slice(0, 8)}…)
            </option>
          ))}
        </select>

        {/* Balances */}
        {isConnected && (
          <div className="mt-3 flex gap-3">
            <div className="flex-1 bg-zinc-800/60 rounded-lg p-2.5 text-center">
              <div className="text-xs text-zinc-400 mb-0.5">ERC-20 Balance</div>
              <div className="text-sm font-mono text-white">
                {balanceLoading ? "…" : erc20Balance !== null
                  ? ethers.formatUnits(erc20Balance, selectedPair?.decimals ?? 18)
                  : "—"}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">{selectedPair?.underlyingSymbol}</div>
            </div>
            <div className="flex-1 bg-zinc-800/60 rounded-lg p-2.5 text-center">
              <div className="text-xs text-zinc-400 mb-0.5">ERC-7984 Balance</div>
              <div className="text-sm font-mono text-emerald-400">
                {balanceLoading ? "…" : decryptedBalance !== undefined
                  ? ethers.formatUnits(decryptedBalance, selectedPair?.decimals ?? 18)
                  : <span className="text-zinc-500">🔒 Encrypted</span>}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">{selectedPair?.symbol}</div>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div className="bg-zinc-800 rounded p-2">
            <div className="text-xs text-zinc-400 mb-1">Anonymity Set</div>
            <div className="font-mono text-sm">{anonymitySet}</div>
          </div>
          <div className="bg-zinc-800 rounded p-2">
            <div className="text-xs text-zinc-400 mb-1">Privacy</div>
            <PrivacyScore score={privacyScore} size="sm" />
          </div>
          <div className="bg-zinc-800 rounded p-2">
            <div className="text-xs text-zinc-400 mb-1">Merkle Root</div>
            <div className="font-mono text-xs truncate">
              {merkleRoot ? merkleRoot.slice(0, 10) + "…" : "none"}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg overflow-hidden mb-4 border border-zinc-700">
        {(["deposit", "withdraw"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); pool.reset(); zk.step !== "idle" && null; }}
            className={`flex-1 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Deposit form */}
      {tab === "deposit" && (
        <div className="card space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Amount ({selectedPair?.symbol ?? "token"})</label>
            <input
              className="input-field"
              type="number"
              min="0"
              step="any"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {zk.step === "generating-commitment" && (
            <p className="text-xs text-indigo-300 animate-pulse">Generating ZK commitment…</p>
          )}
          {zk.error && <p className="text-xs text-red-400">{zk.error}</p>}
          {pool.error && <p className="text-xs text-red-400">{pool.error}</p>}

          {secretHex && (
            <div className="bg-yellow-900/40 border border-yellow-600 rounded p-3 text-xs">
              <span className="text-yellow-300 font-semibold">Save this secret! </span>
              <span className="text-yellow-200">You need it to withdraw: </span>
              <code className="block mt-1 break-all">{secretHex}</code>
            </div>
          )}

          <button
            className="btn-primary w-full"
            disabled={!isConnected || !amount || pool.step === "depositing"}
            onClick={handleDeposit}
          >
            {pool.step === "depositing" ? "Depositing…" : "Deposit"}
          </button>
        </div>
      )}

      {/* Withdraw form */}
      {tab === "withdraw" && (
        <div className="card space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Amount</label>
            <input className="input-field" type="number" min="0" placeholder="0.0"
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Secret (from deposit)</label>
            <input className="input-field font-mono text-xs" placeholder="0x…"
              value={secretHex} onChange={(e) => setSecretHex(e.target.value)} />
          </div>

          {/* Merkle proof — auto-fetch button */}
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary text-xs px-3 py-1.5"
              disabled={!secretHex || !amount || proofLoading}
              onClick={handleFetchProof}
            >
              {proofLoading ? "Fetching…" : autoPath ? "↺ Re-fetch Proof" : "Fetch Merkle Proof"}
            </button>
            {autoPath && (
              <span className="text-xs text-emerald-400">✓ Proof ready ({autoPath.pathElements.length} elements)</span>
            )}
            {!autoPath && !proofLoading && (
              <span className="text-xs text-zinc-500">Auto-finds your leaf from chain</span>
            )}
          </div>

          <p className="text-xs text-zinc-500">Connected wallet is the recipient — use a fresh address to preserve privacy.</p>

          {zk.step === "generating-proof" && (
            <p className="text-xs text-indigo-300 animate-pulse">Generating ZK proof (may take ~30s)…</p>
          )}
          {zk.error && <p className="text-xs text-red-400">{zk.error}</p>}
          {pool.error && <p className="text-xs text-red-400">{pool.error}</p>}

          <button
            className="btn-primary w-full"
            disabled={!isConnected || !amount || !secretHex || !autoPath || pool.step === "withdrawing"}
            onClick={handleWithdraw}
          >
            {pool.step === "withdrawing" ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      )}

      {showModal && (
        <TxStatusModal
          txStatus={
            pool.step === "done"  ? { hash: pool.txHash ?? "", status: "confirmed", message: "Transaction confirmed" } :
            pool.step === "error" ? { hash: "", status: "failed", message: pool.error ?? "Transaction failed" } :
            { hash: "", status: "pending", message: "Transaction in progress…" }
          }
          isOpen
          onClose={() => { setShowModal(false); pool.reset(); }}
        />
      )}
    </div>
  );
}
