/**
 * wallet.ts — Wallet pairing utilities for the Chrome extension
 *
 * Tracks which ERC-7984 / ERC-20 pairs the user has interacted with,
 * persisting the watchlist in chrome.storage.local (extension context)
 * or localStorage (web context fallback).
 */

import type { RegistryPair } from "./types.js";

// ── Storage abstraction ────────────────────────────────────────────────────────

type StorageBackend = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
};

function getStorage(): StorageBackend {
  // Chrome extension context — guard with typeof to avoid TS errors in web bundle
  if (
    typeof globalThis !== "undefined" &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome?.storage?.local
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cs = (globalThis as any).chrome.storage.local;
    return {
      get: (key) =>
        new Promise((res) => cs.get(key, (result: Record<string, string>) => res(result[key] ?? null))),
      set: (key, value) =>
        new Promise((res) => cs.set({ [key]: value }, res)),
    };
  }
  // Web fallback
  return {
    get: async (key) => localStorage.getItem(key),
    set: async (key, value) => localStorage.setItem(key, value),
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WalletPairedToken {
  pairId: string;
  erc20Address: string;
  erc7984Address: string;
  symbol: string;
  lastSeen: number; // unix ms
}

const STORAGE_KEY = "zhieldwrap:wallet-pairs";

// ── Functions ─────────────────────────────────────────────────────────────────

export async function getWalletPairs(): Promise<WalletPairedToken[]> {
  const storage = getStorage();
  const raw = await storage.get(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as WalletPairedToken[];
  } catch {
    return [];
  }
}

export async function addWalletPair(pair: RegistryPair): Promise<void> {
  const storage = getStorage();
  const existing = await getWalletPairs();
  const idx = existing.findIndex((p) => p.pairId === pair.id);

  const entry: WalletPairedToken = {
    pairId:         pair.id,
    erc20Address:   pair.erc20Address,
    erc7984Address: pair.erc7984Address,
    symbol:         pair.symbol,
    lastSeen:       Date.now(),
  };

  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }

  await storage.set(STORAGE_KEY, JSON.stringify(existing));
}

export async function removeWalletPair(pairId: string): Promise<void> {
  const storage = getStorage();
  const existing = await getWalletPairs();
  const filtered = existing.filter((p) => p.pairId !== pairId);
  await storage.set(STORAGE_KEY, JSON.stringify(filtered));
}

export async function clearWalletPairs(): Promise<void> {
  const storage = getStorage();
  await storage.set(STORAGE_KEY, JSON.stringify([]));
}
