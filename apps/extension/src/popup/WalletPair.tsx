import { removeWalletPair, type WalletPairedToken } from "@zhieldwrap/core";

type DecryptState = "idle" | "loading-sdk" | "building-eip712" | "waiting-sig" | "decrypting" | "done" | "error";

interface WalletPairProps {
  pair:             WalletPairedToken;
  etherscanBase:    string;
  onRemove:         () => void;
  erc20Balance:     string | null;
  handle:           string | null;
  decryptedBalance: bigint | null;
  decryptState:     DecryptState;
  decryptError:     string | null;
  onDecrypt:        () => void;
}

const DECRYPT_LABELS: Record<DecryptState, string> = {
  "idle":           "Decrypt Balance",
  "loading-sdk":    "Loading SDK…",
  "building-eip712":"Building EIP-712…",
  "waiting-sig":    "Sign in MetaMask…",
  "decrypting":     "Decrypting…",
  "done":           "Decrypted ✓",
  "error":          "Retry Decrypt",
};

export function WalletPair({
  pair, etherscanBase, onRemove,
  erc20Balance, handle, decryptedBalance, decryptState, decryptError, onDecrypt,
}: WalletPairProps) {
  const handleRemove = async () => {
    await removeWalletPair(pair.pairId);
    onRemove();
  };

  const erc7984Url = `${etherscanBase}/token/${pair.erc7984Address}`;
  const erc20Url   = `${etherscanBase}/token/${pair.erc20Address}`;
  const since = new Date(pair.lastSeen).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const isBusy = ["loading-sdk","building-eip712","waiting-sig","decrypting"].includes(decryptState);
  const canDecrypt = !!handle && decryptState !== "loading-sdk" && decryptState !== "building-eip712"
    && decryptState !== "waiting-sig" && decryptState !== "decrypting";

  return (
    <div style={{
      background: "#18181b",
      border: "1px solid #27272a",
      borderRadius: 10,
      padding: "10px 12px",
      marginBottom: 8,
      fontSize: 12,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{pair.symbol}</div>
          <div style={{ fontSize: 10, color: "#71717a" }}>Last seen: {since}</div>
        </div>
        <button onClick={handleRemove} title="Remove"
          style={{ background: "transparent", color: "#71717a", border: "none", cursor: "pointer", fontSize: 14 }}>
          ×
        </button>
      </div>

      {/* Balances */}
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
        {/* ERC-20 balance */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#a1a1aa" }}>ERC-20</span>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#d4d4d8" }}>
            {erc20Balance !== null ? `${erc20Balance} ${pair.symbol}` : "—"}
          </span>
        </div>

        {/* Confidential balance */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#a1a1aa" }}>Confidential</span>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: decryptedBalance !== null ? "#a78bfa" : "#52525b" }}>
            {decryptedBalance !== null
              ? `${(Number(decryptedBalance) / 10 ** pair.decimals).toFixed(2)} c${pair.symbol}`
              : handle
                ? "🔒 encrypted"
                : "—"}
          </span>
        </div>
      </div>

      {/* Addresses */}
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        <AddressRow label="ERC-7984" address={pair.erc7984Address} url={erc7984Url} />
        <AddressRow label="ERC-20"   address={pair.erc20Address}   url={erc20Url} />
      </div>

      {/* Decrypt button */}
      {handle && (
        <button
          onClick={onDecrypt}
          disabled={isBusy || !canDecrypt}
          style={{
            marginTop: 8,
            width: "100%",
            background: decryptState === "done" ? "#14532d" : decryptState === "error" ? "#450a0a" : "#312e81",
            color: "#c7d2fe",
            border: "none",
            borderRadius: 6,
            padding: "5px 8px",
            fontSize: 11,
            cursor: isBusy ? "default" : "pointer",
            opacity: isBusy ? 0.7 : 1,
          }}
        >
          {DECRYPT_LABELS[decryptState]}
        </button>
      )}

      {decryptError && (
        <div style={{ marginTop: 4, fontSize: 10, color: "#f87171", wordBreak: "break-word" }}>
          {decryptError}
        </div>
      )}
    </div>
  );
}

function AddressRow({ label, address, url }: { label: string; address: string; url: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{
        fontSize: 9, background: "#27272a", color: "#a1a1aa",
        borderRadius: 4, padding: "1px 5px", minWidth: 44, textAlign: "center",
      }}>
        {label}
      </span>
      <a href={url} target="_blank" rel="noreferrer"
        style={{ fontFamily: "monospace", fontSize: 11, color: "#818cf8", textDecoration: "none" }}>
        {address.slice(0, 10)}…{address.slice(-6)}
      </a>
    </div>
  );
}


