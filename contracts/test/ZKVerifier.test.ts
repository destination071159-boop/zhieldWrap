import { expect } from "chai";
import { ethers } from "hardhat";
import * as snarkjs from "snarkjs";
import { MerkleTree } from "fixed-merkle-tree";
import { poseidon2 } from "poseidon-lite";
import * as path from "path";

const TREE_LEVELS = 20;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Relative to contracts/ directory (where hardhat runs)
const WASM_PATH = path.join(__dirname, "../../circuits/proof-source/privacyProof_js/privacyProof.wasm");
const ZKEY_PATH = path.join(__dirname, "../../circuits/proof-source/privacyProof.zkey");

async function generateProof(secret: bigint, amount: bigint) {
  // commitment = Poseidon(secret, amount)  — the deposit leaf
  const commitment = poseidon2([secret, amount]);

  // nullifier = Poseidon(secret, 1)  — single-use withdrawal tag
  const nullifier = poseidon2([secret, 1n]);

  // Build off-chain Merkle tree matching on-chain MerkleTree.sol
  const tree = new MerkleTree(TREE_LEVELS, [commitment], {
    hashFunction: (a: any, b: any) => poseidon2([BigInt(a), BigInt(b)]) as any,
    zeroElement: 0n as any,
  });

  const { pathElements, pathIndices, pathRoot } = tree.proof(commitment);

  const input = {
    root:         pathRoot.toString(),
    nullifier:    nullifier.toString(),
    secret:       secret.toString(),
    amount:       amount.toString(),
    pathElements: pathElements.map((x: any) => x.toString()),
    pathIndices:  pathIndices.map((x: any) => x.toString()),
  };

  const { proof, publicSignals } = await (snarkjs as any).groth16.fullProve(input, WASM_PATH, ZKEY_PATH);
  const calldata = await (snarkjs as any).groth16.exportSolidityCallData(proof, publicSignals);
  const parsed = JSON.parse(`[${calldata}]`);

  return {
    pA:           parsed[0] as [string, string],
    pB:           parsed[1] as [[string, string], [string, string]],
    pC:           parsed[2] as [string, string],
    publicSignals: parsed[3] as [string, string],
    root:         pathRoot,
    nullifier,
  };
}

describe("ZKVerifier (real circuit proof)", function () {
  let verifier: any;

  before(async () => {
    const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
    verifier = await ZKVerifier.deploy();
    await verifier.waitForDeployment();
    console.log("  ZKVerifier deployed to:", await verifier.getAddress());
  });

  it("verifies a valid proof", async function () {
    this.timeout(120_000);
    const secret = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
    const amount = 1000n;

    console.log("  Generating proof...");
    const { pA, pB, pC, publicSignals, root, nullifier } = await generateProof(secret, amount);
    console.log("  Root:", root.toString());
    console.log("  Nullifier:", nullifier.toString());

    const isValid = await verifier.verifyProof(pA, pB, pC, publicSignals);
    expect(isValid).to.be.true;
    console.log("  Proof verified on-chain!");
  });

  it("rejects proof with tampered public signals", async function () {
    this.timeout(120_000);
    const secret = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
    const amount = 500n;

    const { pA, pB, pC, publicSignals } = await generateProof(secret, amount);

    // Swap root with a wrong value
    const tampered: [string, string] = ["1", publicSignals[1]];
    const isValid = await verifier.verifyProof(pA, pB, pC, tampered);
    expect(isValid).to.be.false;
    console.log("  Invalid proof correctly rejected!");
  });

  it("verifies multiple independent proofs", async function () {
    this.timeout(300_000);
    for (let i = 0; i < 3; i++) {
      const secret = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
      const amount = BigInt(i + 1) * 100n;
      const { pA, pB, pC, publicSignals } = await generateProof(secret, amount);
      const isValid = await verifier.verifyProof(pA, pB, pC, publicSignals);
      expect(isValid).to.be.true;
      console.log(`  Proof ${i + 1}/3 verified`);
    }
  });
});
