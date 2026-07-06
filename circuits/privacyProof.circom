pragma circom 2.1.6;

/*
 * privacyProof.circom
 * ZK circuit for ZhieldWrap pool withdrawals.
 *
 * Proves the withdrawer knows a (secret, amount) pair whose commitment
 * Poseidon(secret, amount) is included in the Merkle tree, without
 * revealing the secret or amount.  Used only at withdrawal time.
 *
 * Public inputs:
 *   - root      : Merkle tree root of all deposit commitments
 *   - nullifier : Poseidon(secret, 1) — single-use tag, prevents double-spend
 *
 * Private inputs:
 *   - secret        : random 31-byte value chosen at deposit time
 *   - amount        : deposit amount in token base units
 *   - pathElements  : Merkle sibling nodes [0..levels-1]
 *   - pathIndices   : left/right flags [0..levels-1] (0 = left, 1 = right)
 */

include "../contracts/node_modules/circomlib/circuits/poseidon.circom";

// ── Selector: picks left/right based on index bit ───────────────────────────
template Selector() {
  signal input in[2];
  signal input sel;
  signal output out;

  sel * (1 - sel) === 0;

  signal t;
  t <== sel * (in[1] - in[0]);
  out <== t + in[0];
}

// ── Merkle inclusion proof (depth = levels) ──────────────────────────────────
template MerkleInclusionProof(levels) {
  signal input  leaf;
  signal input  pathElements[levels];
  signal input  pathIndices[levels];
  signal output root;

  signal nodes[levels + 1];
  nodes[0] <== leaf;

  component hashes[levels];
  component selL[levels];
  component selR[levels];

  for (var i = 0; i < levels; i++) {
    selL[i] = Selector();
    selL[i].in[0] <== nodes[i];
    selL[i].in[1] <== pathElements[i];
    selL[i].sel   <== pathIndices[i];

    selR[i] = Selector();
    selR[i].in[0] <== pathElements[i];
    selR[i].in[1] <== nodes[i];
    selR[i].sel   <== pathIndices[i];

    hashes[i] = Poseidon(2);
    hashes[i].inputs[0] <== selL[i].out;
    hashes[i].inputs[1] <== selR[i].out;

    nodes[i + 1] <== hashes[i].out;
  }

  root <== nodes[levels];
}

// ── Main withdrawal circuit ───────────────────────────────────────────────────
template PrivacyProof(levels) {
  // Public inputs
  signal input root;
  signal input nullifier;

  // Private inputs
  signal input secret;
  signal input amount;
  signal input pathElements[levels];
  signal input pathIndices[levels];

  // 1. commitment = Poseidon(secret, amount)  — this is the deposit leaf
  component commitment = Poseidon(2);
  commitment.inputs[0] <== secret;
  commitment.inputs[1] <== amount;

  // 2. nullifier = Poseidon(secret, 1)  — single-use, different from commitment
  component nullifierHash = Poseidon(2);
  nullifierHash.inputs[0] <== secret;
  nullifierHash.inputs[1] <== 1;
  nullifier === nullifierHash.out;

  // 3. commitment is a leaf in the tree at root
  component merkle = MerkleInclusionProof(levels);
  merkle.leaf <== commitment.out;
  for (var i = 0; i < levels; i++) {
    merkle.pathElements[i] <== pathElements[i];
    merkle.pathIndices[i]  <== pathIndices[i];
  }
  root === merkle.root;
}

component main {public [root, nullifier]} = PrivacyProof(20);
