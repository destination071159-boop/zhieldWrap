import { useState, useEffect, useCallback } from "react";
import { WalletPair } from "./WalletPair";
import { getWalletPairs, type WalletPairedToken } from "@zhieldwrap/core";
import {
  loadRelayerSDK,
  buildUserDecryptEIP712,
  runUserDecrypt,
  serializeTypedDataForMessage,
} from "../zamaRelayer";

const SEPOLIA_ETHERSCAN = "https://sepolia.etherscan.io";

// ── helpers ───────────────────────────────────────────────────────────────────

function hexToDecimal(hex: string): string {
  if (!hex || hex === "0x") return "0";
  try { return BigInt(hex).toString(); } catch { return "0"; }
}

function formatUnits(rawStr: string, decimals = 6): string {
  try {
    const raw = BigInt(rawStr);
    const d = BigInt(10 ** decimals);
    const whole = raw / d;
    const frac  = raw % d;
    const fracStr = frac.toString().padStart(decimals, "0").slice(0, 2);
    return `${whole}.${fracStr}`;
  } catch { return "0.00"; }
}

function sendBg<T>(type: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response as T);
    });
  });
}

// ── component ─────────────────────────────────────────────────────────────────

interface PairState {
  erc20Balance: string | null;  // formatted
  handle: string | null;        // bytes32 hex
  decryptedBalance: bigint | null;
  decryptState: "idle" | "loading-sdk" | "building-eip712" | "waiting-sig" | "decrypting" | "done" | "error";
  decryptError: string | null;
}

export function Popup() {
  const [pairs,   setPairs]   = useState<WalletPairedToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState("");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [pairStates, setPairStates] = useState<Record<string, PairState>>({});

  useEffect(() => {
    getWalletPairs().then((p) => { setPairs(p); setLoading(false); });
    setVersion(chrome.runtime.getManifest().version);
    // Try to read wallet address from storage (set by web app on connect)
    chrome.storage.local.get("zhieldwrap:wallet-address", (result) => {
      const addr = result["zhieldwrap:wallet-address"] as string | undefined;
      if (addr) setWalletAddress(addr);
    });
  }, []);

  // Fetch on-chain balances for all pairs once we have the wallet address
  useEffect(() => {
    if (!walletAddress || pairs.length === 0) return;
    pairs.forEach((pair) => {
      // ERC-20 balance
      sendBg<{ success: boolean; hex?: string }>("GET_ERC20_BALANCE", {
        tokenAddress: pair.erc20Address,
        walletAddress,
      }).then((res) => {
        if (res.success && res.hex) {
          const dec = hexToDecimal(res.hex);
          const fmt = formatUnits(dec, pair.decimals);
          setPairStates((prev) => ({
            ...prev,
            [pair.pairId]: { ...(prev[pair.pairId] ?? defaultState()), erc20Balance: fmt },
          }));
        }
      }).catch(() => {});

      // ERC-7984 encrypted handle
      sendBg<{ success: boolean; handle?: string }>("GET_ERC7984_HANDLE", {
        tokenAddress: pair.erc7984Address,
        walletAddress,
      }).then((res) => {
        if (res.success && res.handle) {
          setPairStates((prev) => ({
            ...prev,
            [pair.pairId]: { ...(prev[pair.pairId] ?? defaultState()), handle: res.handle! },
          }));
        }
      }).catch(() => {});
    });
  }, [walletAddress, pairs]);

  const refresh = () => getWalletPairs().then(setPairs);
  const openApp = () => chrome.tabs.create({ url: "https://zhieldwrap.vercel.app" });

  // ── Decrypt flow ─────────────────────────────────────────────────────────────
  const handleDecrypt = useCallback(async (pair: WalletPairedToken) => {
    if (!walletAddress) return;
    const handle = pairStates[pair.pairId]?.handle;
    if (!handle) return;

    const setState = (patch: Partial<PairState>) =>
      setPairStates((prev) => ({
        ...prev,
        [pair.pairId]: { ...(prev[pair.pairId] ?? defaultState()), ...patch },
      }));

    try {
      setState({ decryptState: "loading-sdk", decryptError: null });
      await loadRelayerSDK(); // loads relayer-sdk-js.umd.cjs from public/

      setState({ decryptState: "building-eip712" });
      const result = await buildUserDecryptEIP712(pair.erc7984Address);
      if (!result) throw new Error("Failed to build EIP-712");

      // Bridge signing through content script (MetaMask on active tab)
      setState({ decryptState: "waiting-sig" });
      const sigResult = await sendBg<{ success: boolean; signature?: string; error?: string }>(
        "SIGN_EIP712_BRIDGE",
        {
          address: walletAddress,
          typedData: serializeTypedDataForMessage(result.typedData),
        }
      );
      if (!sigResult.success || !sigResult.signature) {
        throw new Error(sigResult.error ?? "Signing failed");
      }

      setState({ decryptState: "decrypting" });
      const plaintext = await runUserDecrypt({
        handle,
        contractAddress: pair.erc7984Address,
        userAddress: walletAddress,
        signature: sigResult.signature,
        keypair: result.decryptContext.keypair,
        startTimestamp: result.decryptContext.startTimestamp,
        durationDays: result.decryptContext.durationDays,
      });

      setState({
        decryptState: "done",
        decryptedBalance: plaintext,
      });
    } catch (err) {
      setState({
        decryptState: "error",
        decryptError: err instanceof Error ? err.message : String(err),
      });
    }
  }, [walletAddress, pairStates]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 480 }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg,#1e1b4b 0%,#0a0a0f 100%)",
        borderBottom: "1px solid #312e81",
        padding: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>⬡</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>ZhieldWrap</div>
            <div style={{ fontSize: 10, opacity: 0.5 }}>v{version} · Sepolia</div>
          </div>
        </div>
        <button
          onClick={openApp}
          style={{
            background: "#4f46e5", color: "#fff", border: "none",
            borderRadius: 8, padding: "6px 12px", fontSize: 11, cursor: "pointer",
          }}
        >
          Open App
        </button>
      </div>

      {/* Wallet address bar */}
      {walletAddress && (
        <div style={{
          background: "#18181b", borderBottom: "1px solid #27272a",
          padding: "6px 16px", fontSize: 10, color: "#71717a",
          fontFamily: "monospace",
        }}>
          {walletAddress.slice(0, 10)}…{walletAddress.slice(-6)}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: 32, opacity: 0.5, fontSize: 13 }}>Loading…</div>
        ) : pairs.length === 0 ? (
          <div style={{ textAlign: "center", padding: 32, fontSize: 12, color: "#71717a" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
            <div>No pairs tracked yet.</div>
            <div style={{ marginTop: 4 }}>Visit the app to wrap tokens and they&apos;ll appear here.</div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: "#71717a", marginBottom: 8 }}>
              {pairs.length} pair{pairs.length !== 1 ? "s" : ""} tracked
            </div>
            {pairs.map((p) => {
              const ps = pairStates[p.pairId] ?? defaultState();
              return (
                <WalletPair
                  key={p.pairId}
                  pair={p}
                  etherscanBase={SEPOLIA_ETHERSCAN}
                  onRemove={refresh}
                  erc20Balance={ps.erc20Balance}
                  handle={ps.handle}
                  decryptedBalance={ps.decryptedBalance}
                  decryptState={ps.decryptState}
                  decryptError={ps.decryptError}
                  onDecrypt={() => handleDecrypt(p)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: "1px solid #27272a",
        padding: "10px 16px",
        fontSize: 10,
        color: "#52525b",
        display: "flex",
        justifyContent: "space-between",
      }}>
        <span>Powered by Zama FhEVM</span>
        <a href="https://sepolia.etherscan.io" target="_blank" rel="noreferrer"
          style={{ color: "#6366f1", textDecoration: "none" }}>
          Sepolia Explorer
        </a>
      </div>
    </div>
  );
}

function defaultState(): PairState {
  return {
    erc20Balance: null,
    handle: null,
    decryptedBalance: null,
    decryptState: "idle",
    decryptError: null,
  };
}


