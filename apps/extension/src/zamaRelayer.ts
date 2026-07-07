/**
 * zamaRelayer.ts — Zama FheVM helpers for ZhieldWrap extension.
 *
 * Pattern follows zwallet-newUI reference (apps/extension/src/chrome/zamaRelayer.ts).
 * Loads the bundled relayer SDK from public/relayer-sdk-js.umd.cjs (MV3 compliant —
 * no remote code, only self-hosted assets).
 *
 * IMPORTANT: loadRelayerSDK() requires a DOM (document.createElement).
 * Call it only from popup context, NOT from the background service worker.
 */

const SEPOLIA_RPC = "https://rpc.sepolia.org";

// ── SDK type declarations (mirrors reference zamaRelayer.ts) ──────────────────

export interface FhevmConfig {
  aclContractAddress: string;
  kmsContractAddress: string;
  inputVerifierContractAddress: string;
  verifyingContractAddressDecryption: string;
  verifyingContractAddressInputVerification: string;
  chainId: number;
  gatewayChainId: number;
  network: string | unknown;
  relayerUrl: string;
}

export interface FhevmInstance {
  createEncryptedInput: (
    contractAddress: string,
    userAddress: string
  ) => {
    add64: (n: bigint) => {
      encrypt: () => Promise<{ handles: unknown[]; inputProof: unknown }>;
    };
  };
  generateKeypair: () => { publicKey: string; privateKey: string };
  createEIP712: (
    publicKey: string,
    contractAddresses: string[],
    startTimestamp: number,
    durationDays: number
  ) => unknown;
  userDecrypt: (...args: unknown[]) => Promise<Record<string, bigint | string>>;
}

interface RelayerSDKType {
  initSDK: () => Promise<void>;
  createInstance: (config: Partial<FhevmConfig> & { network: unknown }) => Promise<FhevmInstance>;
  SepoliaConfig: FhevmConfig;
}

declare global {
  interface Window {
    RelayerSDK?: RelayerSDKType;
    relayerSDK?: RelayerSDKType;
    ethereum?: unknown;
  }
}

function getSDK(): RelayerSDKType | null {
  return window.relayerSDK ?? window.RelayerSDK ?? null;
}

export function isRelayerSDKReady(): boolean {
  return !!getSDK();
}

/**
 * Load relayer SDK from bundled asset (MV3: no remote scripts allowed).
 * Must be called from popup (DOM context).
 */
export function loadRelayerSDK(): Promise<void> {
  if (getSDK()) return Promise.resolve();
  const url = chrome.runtime.getURL("relayer-sdk-js.umd.cjs");
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.type = "text/javascript";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Zama Relayer SDK from extension bundle."));
    document.head.appendChild(script);
  });
}

/** Minimal JSON-RPC provider pointing at Sepolia — no wallet signing. */
function getSepoliaRpcProvider(): { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } {
  return {
    request: async ({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> => {
      const res = await fetch(SEPOLIA_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const data = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (data.error) throw new Error(data.error.message ?? "RPC error");
      return data.result;
    },
  };
}

/**
 * Initialize a Sepolia FheVM instance.
 * Call from popup context after loadRelayerSDK().
 */
export async function createSepoliaFhevmInstance(): Promise<FhevmInstance | null> {
  await loadRelayerSDK();
  const sdk = getSDK();
  if (!sdk) return null;
  await sdk.initSDK();
  const instance = await sdk.createInstance({
    ...sdk.SepoliaConfig,
    network: getSepoliaRpcProvider(),
  });
  return instance as FhevmInstance;
}

// ── EIP-712 user-decrypt flow ─────────────────────────────────────────────────

const START_TIMESTAMP_TOLERANCE_SEC = 60;
const DURATION_DAYS = 10;

export interface UserDecryptEIP712 {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  message: Record<string, unknown>;
  primaryType: "UserDecryptRequestVerification";
}

export interface DecryptContext {
  keypair: { publicKey: string; privateKey: string };
  startTimestamp: number;
  durationDays: number;
}

export interface BuildUserDecryptResult {
  typedData: UserDecryptEIP712;
  decryptContext: DecryptContext;
}

/** Build EIP-712 payload that the user must sign before we can decrypt. */
export async function buildUserDecryptEIP712(
  tokenContractAddress: string
): Promise<BuildUserDecryptResult | null> {
  const instance = await createSepoliaFhevmInstance();
  if (!instance) return null;

  const keypair = instance.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000) - START_TIMESTAMP_TOLERANCE_SEC;

  const eip712 = instance.createEIP712(
    keypair.publicKey,
    [tokenContractAddress],
    startTimestamp,
    DURATION_DAYS
  ) as { domain: Record<string, unknown>; types: Record<string, unknown>; message: Record<string, unknown> };

  return {
    typedData: {
      domain: eip712.domain,
      types: eip712.types ?? {},
      message: eip712.message,
      primaryType: "UserDecryptRequestVerification",
    },
    decryptContext: { keypair, startTimestamp, durationDays: DURATION_DAYS },
  };
}

/** Recursively replace BigInt → string for chrome.runtime.sendMessage (structured clone ≠ BigInt). */
function toJsonSafe(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "bigint") return obj.toString();
  if (Array.isArray(obj)) return obj.map(toJsonSafe);
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) out[k] = toJsonSafe(v);
    return out;
  }
  return obj;
}

export function serializeTypedDataForMessage(typedData: UserDecryptEIP712): UserDecryptEIP712 {
  return {
    domain:      toJsonSafe(typedData.domain) as Record<string, unknown>,
    types:       toJsonSafe(typedData.types) as Record<string, unknown>,
    message:     toJsonSafe(typedData.message) as Record<string, unknown>,
    primaryType: typedData.primaryType,
  };
}

/**
 * Run userDecrypt after the user has signed the EIP-712 payload.
 * Returns the plaintext balance (bigint) or null on failure.
 */
export async function runUserDecrypt(params: {
  handle: string;
  contractAddress: string;
  userAddress: string;
  signature: string;
  keypair: { publicKey: string; privateKey: string };
  startTimestamp: number;
  durationDays: number;
}): Promise<bigint | null> {
  const instance = await createSepoliaFhevmInstance();
  if (!instance) return null;

  try {
    const result = await instance.userDecrypt(
      [{ handle: params.handle, contractAddress: params.contractAddress }],
      params.keypair.privateKey,
      params.keypair.publicKey,
      params.signature,
      params.userAddress,
      params.contractAddress,
    );
    const raw = result[params.handle];
    if (raw === undefined || raw === null) return null;
    return typeof raw === "bigint" ? raw : BigInt(raw as string);
  } catch {
    return null;
  }
}

/**
 * Encrypt an amount (euint64) for a confidential transfer.
 * Returns { handle: hex, inputProof: hex } ready for contract calldata.
 */
export async function encryptAmount(params: {
  amount: bigint;
  contractAddress: string;
  userAddress: string;
}): Promise<{ handle: string; inputProof: string } | null> {
  const instance = await createSepoliaFhevmInstance();
  if (!instance) return null;

  try {
    const input = instance.createEncryptedInput(params.contractAddress, params.userAddress);
    const { handles, inputProof } = await input.add64(params.amount).encrypt();
    const toHex = (b: unknown) =>
      "0x" + Array.from(b as Uint8Array).map((x) => x.toString(16).padStart(2, "0")).join("");
    return { handle: toHex(handles[0]), inputProof: toHex(inputProof) };
  } catch {
    return null;
  }
}
