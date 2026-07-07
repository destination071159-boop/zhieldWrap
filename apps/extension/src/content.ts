/**
 * content.ts — Content script injected into all pages
 *
 * 1. Detects ERC-7984 token addresses on Etherscan and offers to add them to the watchlist.
 * 2. Handles EIP-712 signing bridge: popup → background → here → MetaMask → back.
 *    window.ethereum is available here (injected by MetaMask into web pages).
 *    It is NOT available in extension popup pages (chrome-extension:// scheme).
 */

// ── EIP-712 signing bridge ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SIGN_EIP712") {
    const { address, typedData } = message.payload as {
      address: string;
      typedData: Record<string, unknown>;
    };

    const eth = (window as unknown as {
      ethereum?: { request: (a: { method: string; params: unknown[] }) => Promise<unknown> };
    }).ethereum;

    if (!eth) {
      sendResponse({ success: false, error: "MetaMask not found on this page" });
      return true;
    }

    eth
      .request({
        method: "eth_signTypedData_v4",
        params: [address, JSON.stringify(typedData)],
      })
      .then((signature) => sendResponse({ success: true, signature }))
      .catch((err: unknown) => sendResponse({ success: false, error: String(err) }));

    return true; // async
  }
});

// ── Etherscan token page detector ─────────────────────────────────────────────

function isLikelyTokenPage(): boolean {
  const url = window.location.href.toLowerCase();
  return (
    url.includes("sepolia.etherscan.io/token") ||
    url.includes("sepolia.etherscan.io/address")
  );
}

function extractAddress(): string | null {
  const match = window.location.pathname.match(/\/(?:token|address)\/(0x[0-9a-fA-F]{40})/i);
  return match ? match[1] : null;
}

function injectBadge(address: string) {
  if (document.getElementById("zhieldwrap-badge")) return;

  const badge = document.createElement("div");
  badge.id = "zhieldwrap-badge";
  badge.style.cssText = [
    "position:fixed",
    "bottom:24px",
    "right:24px",
    "z-index:2147483647",
    "background:#1e1b4b",
    "border:1px solid #4f46e5",
    "border-radius:12px",
    "padding:12px 16px",
    "font-family:-apple-system,sans-serif",
    "font-size:13px",
    "color:#c7d2fe",
    "box-shadow:0 4px 24px rgba(0,0,0,0.4)",
    "cursor:pointer",
    "max-width:280px",
  ].join(";");

  badge.innerHTML = `
    <div style="font-weight:600;margin-bottom:4px;">⬡ ZhieldWrap</div>
    <div style="font-size:11px;opacity:0.7;margin-bottom:8px;">Add to watchlist?</div>
    <code style="font-size:10px;word-break:break-all;opacity:0.6;">${address.slice(0, 20)}…</code>
    <div style="margin-top:8px;display:flex;gap:8px;">
      <button id="zhieldwrap-add" style="flex:1;background:#4f46e5;color:#fff;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">Add</button>
      <button id="zhieldwrap-dismiss" style="flex:1;background:transparent;color:#c7d2fe;border:1px solid #4f46e5;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">Dismiss</button>
    </div>
  `;

  document.body.appendChild(badge);

  document.getElementById("zhieldwrap-add")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type:    "ADD_TO_WATCHLIST",
      payload: { address },
    });
    badge.remove();
  });

  document.getElementById("zhieldwrap-dismiss")?.addEventListener("click", () => {
    badge.remove();
  });
}

// Run on page load if we're on Etherscan token/address page
if (isLikelyTokenPage()) {
  const addr = extractAddress();
  if (addr) {
    // Small delay to not interfere with page load
    setTimeout(() => injectBadge(addr), 1500);
  }
}

// ── Wallet address sync: localStorage → chrome.storage.local ─────────────────
// The web app (zhieldwrap.vercel.app) writes the connected wallet address to
// localStorage under "zhieldwrap:wallet-address". The extension popup can only
// read chrome.storage.local (not the page's localStorage), so we sync it here.

function syncWalletAddress() {
  const addr = localStorage.getItem("zhieldwrap:wallet-address");
  if (addr) {
    chrome.storage.local.set({ "zhieldwrap:wallet-address": addr });
  } else {
    chrome.storage.local.remove("zhieldwrap:wallet-address");
  }
}

// Sync on initial load
syncWalletAddress();

// Re-sync whenever the page's localStorage changes (wagmi connect/disconnect)
window.addEventListener("storage", (e) => {
  if (e.key === "zhieldwrap:wallet-address") {
    syncWalletAddress();
  }
});
