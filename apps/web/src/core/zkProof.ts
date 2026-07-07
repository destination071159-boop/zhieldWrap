/**
 * zkProof.ts — Client-side ZK proof generation using snarkjs + Groth16
 *
 * Uses pre-compiled .wasm and .zkey artifacts from /public/zkeys/ (served by Vite).
 * All proofs are generated fully in-browser — no server-side proving.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PrivacyProofInputs {
  secret:       bigint;
  amount:       bigint;
  root:         bigint;
  pathElements: bigint[]; // 20 elements (Merkle sibling hashes)
  pathIndices:  number[]; // 20 binary values (0=left, 1=right)
}

export interface ZKProof {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
  publicSignals: [bigint, bigint]; // [root, nullifier]
}

export interface PoolDepositProof {
  commitment: bigint;
  secret:     bigint; // keep safe — needed to generate withdraw proof later
}

// ── Poseidon hash ─────────────────────────────────────────────────────────────

// ── Poseidon hash ─────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-ignore — poseidon-lite ships no TypeScript types
import { poseidon2 } from "poseidon-lite/poseidon2";

function poseidonHash(inputs: [bigint, bigint]): bigint {
  return BigInt((poseidon2 as any)(inputs));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── snarkjs dynamic import ────────────────────────────────────────────────────

async function getSnarkjs() {
  // @ts-expect-error — snarkjs has no bundled ESM types
  const snarkjs = await import("snarkjs");
  return snarkjs;
}

import { ZK_WASM_PATH, ZK_ZKEY_PATH } from "./constants.js";

// ── Key paths (Vite /public/) ─────────────────────────────────────────────────
// Defaults match apps/web/public/zkeys/. Pass explicit paths if calling from
// the browser extension (chrome-extension:// URLs need absolute paths).

const DEFAULT_WASM = ZK_WASM_PATH;
const DEFAULT_ZKEY = ZK_ZKEY_PATH;

// ── Public API ────────────────────────────────────────────────────────────────

/** Generate a cryptographically random 31-byte secret (fits in BN128 scalar field) */
export function generateSecret(): bigint {
  const buf = new Uint8Array(31);
  crypto.getRandomValues(buf);
  return BigInt("0x" + Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join(""));
}

/** Compute the deposit commitment leaf: Poseidon(secret, amount) */
export function computeCommitment(secret: bigint, amount: bigint): bigint {
  return poseidonHash([secret, amount]);
}

/** Compute the nullifier: Poseidon(secret, leafIndex) */
export function computeNullifier(secret: bigint, leafIndex: number): bigint {
  return poseidonHash([secret, BigInt(leafIndex)]);
}

/**
 * Generate a Groth16 proof for withdrawing from the Privacy Pool.
 * Circuit public inputs: [root, nullifier]
 * Circuit private inputs: secret, amount, pathElements[20], pathIndices[20]
 */
export async function generatePrivacyProof(
  inputs: PrivacyProofInputs,
  wasmPath = DEFAULT_WASM,
  zkeyPath = DEFAULT_ZKEY
): Promise<ZKProof> {
  const snarkjs = await getSnarkjs();

  // Nullifier = Poseidon(secret, 1) — circuit convention
  const nullifier = poseidonHash([inputs.secret, 1n]);

  // Pad Merkle path to depth 20
  const pathElements = [...inputs.pathElements];
  const pathIndices  = [...inputs.pathIndices];
  while (pathElements.length < 20) pathElements.push(0n);
  while (pathIndices.length  < 20) pathIndices.push(0);

  const circuitInputs = {
    root:         inputs.root.toString(),
    nullifier:    nullifier.toString(),
    secret:       inputs.secret.toString(),
    amount:       inputs.amount.toString(),
    pathElements: pathElements.map((e) => e.toString()),
    pathIndices:  pathIndices.map((i) => i.toString()),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInputs,
    wasmPath,
    zkeyPath
  );

  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const parsed   = JSON.parse(`[${calldata}]`);

  return {
    pA: [BigInt(parsed[0][0]), BigInt(parsed[0][1])],
    pB: [
      [BigInt(parsed[1][0][0]), BigInt(parsed[1][0][1])],
      [BigInt(parsed[1][1][0]), BigInt(parsed[1][1][1])],
    ],
    pC: [BigInt(parsed[2][0]), BigInt(parsed[2][1])],
    publicSignals: [BigInt(parsed[3][0]), BigInt(parsed[3][1])],
  };
}

/**
 * Compute commitment and generate a fresh secret for depositing.
 * No ZK proof is needed — deposit uses FHE encryption only.
 */
export async function generateDepositProof(
  inputs: { secret: bigint; amount: bigint },
  _tokenAddress: string
): Promise<PoolDepositProof> {
  const commitment = poseidonHash([inputs.secret, inputs.amount]);
  return { commitment, secret: inputs.secret };
}

/** Returns a zero-filled mock ZKProof for UI development before circuits are compiled. */
export function mockProof(): ZKProof {
  return {
    pA: [0n, 0n],
    pB: [[0n, 0n], [0n, 0n]],
    pC: [0n, 0n],
    publicSignals: [0n, 0n],
  };
}
