/**
 * background.ts — Service worker for ZhieldWrap extension (Manifest V3)
 *
 * Responsibilities:
 * - Listen for messages from the popup / content script
 * - Sync wallet-pair data on install / update
 * - Show optional notifications after wrap/unwrap transactions
 * - Bridge EIP-712 signing requests from popup → content script → MetaMask
 * - Fetch on-chain data (ERC-20 balance, ERC-7984 handle) via JSON-RPC
 */

const SEPOLIA_RPC = "https://rpc.sepolia.org";

/** Minimal JSON-RPC fetch helper (service workers can fetch). */
async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(SEPOLIA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (data.error) throw new Error(data.error.message ?? "RPC error");
  return data.result;
}

// ERC-20 balanceOf(address) selector = 0x70a08231
async function fetchERC20Balance(token: string, wallet: string): Promise<string> {
  const data = "0x70a08231" + wallet.slice(2).padStart(64, "0");
  const result = await rpcCall("eth_call", [{ to: token, data }, "latest"]);
  return result as string;
}

// getHandle(address) selector, fallback to balanceOf
async function fetchERC7984Handle(token: string, wallet: string): Promise<string | null> {
  const padded = wallet.slice(2).padStart(64, "0");
  for (const selector of ["0xaff8e2b4", "0x70a08231"]) {
    try {
      const result = (await rpcCall("eth_call", [{ to: token, data: selector + padded }, "latest"])) as string;
      if (result && result !== "0x" && result !== "0x" + "0".repeat(64)) return result;
    } catch { /* try next */ }
  }
  return null;
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    console.log("[ZhieldWrap] Extension installed");
    chrome.storage.local.set({ "zhieldwrap:wallet-pairs": JSON.stringify([]) });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ type: "PONG", version: chrome.runtime.getManifest().version });
    return true;
  }

  if (message.type === "TX_CONFIRMED" && message.payload) {
    const { symbol, action } = message.payload as { symbol: string; action: string };
    chrome.notifications.create({
      type:    "basic",
      iconUrl: "icons/icon48.png",
      title:   "ZhieldWrap",
      message: `${action} of ${symbol} confirmed on Sepolia`,
    });
    return true;
  }

  // ── Fetch ERC-20 balance ───────────────────────────────────────────────────
  if (message.type === "GET_ERC20_BALANCE") {
    const { tokenAddress, walletAddress } = message.payload as { tokenAddress: string; walletAddress: string };
    fetchERC20Balance(tokenAddress, walletAddress)
      .then((hex) => sendResponse({ success: true, hex }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  // ── Fetch ERC-7984 encrypted handle (bytes32) ─────────────────────────────
  if (message.type === "GET_ERC7984_HANDLE") {
    const { tokenAddress, walletAddress } = message.payload as { tokenAddress: string; walletAddress: string };
    fetchERC7984Handle(tokenAddress, walletAddress)
      .then((handle) => sendResponse({ success: true, handle }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  // ── Bridge: popup → background → content script → MetaMask for EIP-712 ────
  // window.ethereum is only available in page context (not extension popup).
  if (message.type === "SIGN_EIP712_BRIDGE") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) {
        sendResponse({ success: false, error: "No active tab found" });
        return;
      }
      chrome.tabs.sendMessage(
        tabId,
        { type: "SIGN_EIP712", payload: message.payload },
        (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse(response);
          }
        }
      );
    });
    return true;
  }

  return false;
});

