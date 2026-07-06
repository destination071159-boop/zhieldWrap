import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import * as snarkjs from "snarkjs";
import { MerkleTree } from "fixed-merkle-tree";
import { poseidon2 } from "poseidon-lite";
import * as path from "path";

const TREE_LEVELS = 20;
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const WASM_PATH = path.join(__dirname, "../../circuits/proof-source/privacyProof_js/privacyProof.wasm");
const ZKEY_PATH = path.join(__dirname, "../../circuits/proof-source/privacyProof.zkey");

// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateWithdrawProof(secret: bigint, amount: bigint, onChainRoot: bigint) {
  const commitment = poseidon2([secret, amount]) as any;
  const nullifier  = poseidon2([secret, 1n]);

  const tree = new MerkleTree(TREE_LEVELS, [commitment], {
    hashFunction: (a: any, b: any) => poseidon2([BigInt(a), BigInt(b)]) as any,
    zeroElement: 0n as any,
  });

  const { pathElements, pathIndices } = tree.proof(commitment);

  const input = {
    root:         onChainRoot.toString(),
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
    pA: parsed[0] as [string, string],
    pB: parsed[1] as [[string, string], [string, string]],
    pC: parsed[2] as [string, string],
    publicSignals: parsed[3] as [string, string],
    nullifier,
  };
}

// ── Fixture ────────────────────────────────────────────────────────────────────

async function deployAll() {
  const [deployer, user, recipient] = await ethers.getSigners();

  const Hasher = await ethers.getContractFactory("Hasher");
  const hasher = await Hasher.deploy();
  await hasher.waitForDeployment();
  const hasherAddr = await hasher.getAddress();

  const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
  const verifier = await ZKVerifier.deploy();
  await verifier.waitForDeployment();

  const PrivacyPool = await ethers.getContractFactory("PrivacyPool", {
    libraries: { Hasher: hasherAddr },
  });
  const pool = await PrivacyPool.deploy(await verifier.getAddress());
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();

  // Real ERC-7984 confidential token
  const Token = await ethers.getContractFactory("MockConfidentialToken");
  const token = await Token.deploy("Mock cWETH", "mcWETH");
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();

  return { pool, verifier, token, deployer, user, recipient, poolAddr, tokenAddr };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("PrivacyPool", function () {
  describe("Deployment", () => {
    it("deploys pool and verifier", async () => {
      const { pool, verifier } = await deployAll();
      expect(await pool.getAddress()).to.be.properAddress;
      expect(await verifier.getAddress()).to.be.properAddress;
    });

    it("sets verifier address correctly", async () => {
      const { pool, verifier } = await deployAll();
      expect(await pool.verifier()).to.equal(await verifier.getAddress());
    });

    it("starts with nextIndex = 0 (empty Merkle tree)", async () => {
      const { pool } = await deployAll();
      expect(await pool.nextIndex()).to.equal(0n);
    });

    it("starts with tree depth = 20", async () => {
      const { pool } = await deployAll();
      expect(await pool.levels()).to.equal(20n);
    });

    it("starts with zero anonymity set for any token", async () => {
      const { pool } = await deployAll();
      const randomToken = ethers.Wallet.createRandom().address;
      expect(await pool.anonymitySet(randomToken)).to.equal(0n);
    });
  });

  describe("MerkleTree root history", () => {
    it("getLastRoot returns initial Z_20 (non-zero Poseidon zero hash)", async () => {
      const { pool } = await deployAll();
      const root = await pool.getLastRoot();
      expect(root).to.not.equal(ethers.ZeroHash);
    });

    it("isKnownRoot returns false for random bytes32", async () => {
      const { pool } = await deployAll();
      expect(await pool.isKnownRoot(ethers.randomBytes(32))).to.be.false;
    });
  });

  describe("hasDeposit", () => {
    it("returns false for unknown commitment", async () => {
      const { pool } = await deployAll();
      expect(await pool.hasDeposit(ethers.randomBytes(32))).to.be.false;
    });
  });

  describe("getPrivacyLevel", () => {
    it("returns LOW for new pool", async () => {
      const { pool } = await deployAll();
      const token = ethers.Wallet.createRandom().address;
      expect(await pool.getPrivacyLevel(token)).to.equal("LOW");
    });
  });

  // ── FHE Deposit ─────────────────────────────────────────────────────────────

  describe("deposit (FHE)", () => {
    it("inserts commitment into Merkle tree and stores encrypted balance", async () => {
      if (!fhevm.isMock) this.skip();

      const { pool, token, user, poolAddr, tokenAddr } = await deployAll();
      const secret = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
      const amount = 1000n;

      // Compute commitment leaf
      const commitment = poseidon2([secret, amount]);
      const commitmentBytes = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);

      // Mint confidential tokens to user
      await token.mint(user.address, Number(amount));

      // Encrypt amount — tx.to = token, so FHE proof is verified against tokenAddr
      const inp = fhevm.createEncryptedInput(tokenAddr, user.address);
      inp.add64(Number(amount));
      const { handles, inputProof } = await inp.encrypt();

      const rootBefore = await pool.getLastRoot();

      // Deposit via token.confidentialTransferAndCall — keeps tx.to = token
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentBytes]);
      await token.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](poolAddr, handles[0], inputProof, data);

      // Merkle tree was updated
      expect(await pool.nextIndex()).to.equal(1n);
      expect(await pool.getLastRoot()).to.not.equal(rootBefore);

      // Commitment has an active deposit
      expect(await pool.hasDeposit(commitmentBytes)).to.be.true;

      // Anonymity set incremented
      expect(await pool.anonymitySet(tokenAddr)).to.equal(1n);
    });
  });

  // ── ZK Withdrawal ───────────────────────────────────────────────────────────

  describe("withdraw (ZK proof)", () => {
    it("reverts when root is not known", async () => {
      const { pool, user, tokenAddr } = await deployAll();
      const unknownRoot = ethers.randomBytes(32);
      const pA: [bigint, bigint] = [1n, 2n];
      const pB: [[bigint, bigint], [bigint, bigint]] = [[1n, 2n], [3n, 4n]];
      const pC: [bigint, bigint] = [1n, 2n];
      const pubSignals: [bigint, bigint] = [BigInt(ethers.hexlify(unknownRoot)), 1n];

      await expect(
        pool.connect(user).withdraw(tokenAddr, 100n, pA, pB, pC, pubSignals)
      ).to.be.revertedWith("PrivacyPool: unknown root");
    });

    it("verifies real ZK proof and marks nullifier spent", async () => {
      this.timeout(120_000);
      if (!fhevm.isMock) this.skip();

      const { pool, token, user, recipient, poolAddr, tokenAddr } = await deployAll();
      const secret = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
      const amount = 500n;

      const commitment = poseidon2([secret, amount]);
      const commitmentBytes = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);

      // ── Deposit ──────────────────────────────────────────────────────────
      await token.mint(user.address, Number(amount));

      const inp = fhevm.createEncryptedInput(tokenAddr, user.address);
      inp.add64(Number(amount));
      const { handles, inputProof } = await inp.encrypt();
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentBytes]);
      await token.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](poolAddr, handles[0], inputProof, data);

      // ── Generate ZK proof using on-chain root ─────────────────────────────
      const onChainRoot = BigInt(await pool.getLastRoot());
      console.log("    On-chain root after deposit:", onChainRoot.toString());
      console.log("    Generating ZK withdrawal proof...");

      const { pA, pB, pC, publicSignals, nullifier } = await generateWithdrawProof(
        secret, amount, onChainRoot
      );

      const nullifierBytes = ethers.zeroPadValue(ethers.toBeHex(nullifier), 32);

      // Nullifier not yet spent
      expect(await pool.nullifierSpent(nullifierBytes)).to.be.false;

      // ── Withdraw — connect as recipient (fresh wallet) so msg.sender = recipient ──
      await pool.connect(recipient).withdraw(
        tokenAddr, amount, pA, pB, pC, publicSignals
      );

      // Nullifier is now spent
      expect(await pool.nullifierSpent(nullifierBytes)).to.be.true;
      console.log("    Withdrawal complete — nullifier spent");
    });

    it("reverts on double-spend (same nullifier)", async () => {
      this.timeout(180_000);
      if (!fhevm.isMock) this.skip();

      const { pool, token, user, recipient, poolAddr, tokenAddr } = await deployAll();
      const secret = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
      const amount = 200n;

      const commitment = poseidon2([secret, amount]);
      const commitmentBytes = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);

      await token.mint(user.address, Number(amount));

      const inp = fhevm.createEncryptedInput(tokenAddr, user.address);
      inp.add64(Number(amount));
      const { handles, inputProof } = await inp.encrypt();
      const data = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentBytes]);
      await token.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](poolAddr, handles[0], inputProof, data);

      const onChainRoot = BigInt(await pool.getLastRoot());
      const { pA, pB, pC, publicSignals } = await generateWithdrawProof(
        secret, amount, onChainRoot
      );

      // First withdrawal succeeds
      await pool.connect(user).withdraw(
        tokenAddr, amount, pA, pB, pC, publicSignals
      );

      // Second withdrawal with same proof/nullifier must revert
      await expect(
        pool.connect(user).withdraw(
          tokenAddr, amount, pA, pB, pC, publicSignals
        )
      ).to.be.revertedWith("PrivacyPool: nullifier already spent");
    });
  });

  // ── withdrawToERC20 ──────────────────────────────────────────────────────────

  describe("withdrawToERC20 (ZK proof + async unwrap to ERC-20)", () => {
    async function deployWithWrapper() {
      const [deployer, user, recipient] = await ethers.getSigners();

      const Underlying = await ethers.getContractFactory("MockERC20");
      const underlying = await Underlying.deploy();
      await underlying.waitForDeployment();

      const Wrapper = await ethers.getContractFactory("MockConfidentialUSDT");
      const wrapper = await Wrapper.deploy(await underlying.getAddress());
      await wrapper.waitForDeployment();
      const wrapperAddr = await wrapper.getAddress();

      const Hasher = await ethers.getContractFactory("Hasher");
      const hasher = await Hasher.deploy();
      await hasher.waitForDeployment();

      const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
      const verifier = await ZKVerifier.deploy();
      await verifier.waitForDeployment();

      const PrivacyPool = await ethers.getContractFactory("PrivacyPool", {
        libraries: { Hasher: await hasher.getAddress() },
      });
      const pool = await PrivacyPool.deploy(await verifier.getAddress());
      await pool.waitForDeployment();
      const poolAddr = await pool.getAddress();

      return { pool, wrapper, underlying, deployer, user, recipient, poolAddr, wrapperAddr };
    }

    it("initiates unwrap request and marks nullifier spent", async () => {
      this.timeout(120_000);
      if (!fhevm.isMock) this.skip();

      const { pool, wrapper, user, recipient, poolAddr, wrapperAddr } = await deployWithWrapper();
      const secret = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
      const amount = 100n;

      const commitment = poseidon2([secret, amount]);
      const commitmentBytes = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);

      // Mint cTokens directly to user (no underlying ERC-20 needed)
      await wrapper.mint(user.address, Number(amount));

      // Deposit into pool via confidentialTransferAndCall
      const inp = fhevm.createEncryptedInput(wrapperAddr, user.address);
      inp.add64(Number(amount));
      const { handles, inputProof } = await inp.encrypt();
      const callData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentBytes]);
      await wrapper.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](
        poolAddr, handles[0], inputProof, callData
      );
      expect(await pool.hasDeposit(commitmentBytes)).to.be.true;

      // Generate ZK proof
      const onChainRoot = BigInt(await pool.getLastRoot());
      const { pA, pB, pC, publicSignals, nullifier } = await generateWithdrawProof(secret, amount, onChainRoot);
      const nullifierBytes = ethers.zeroPadValue(ethers.toBeHex(nullifier), 32);

      expect(await pool.nullifierSpent(nullifierBytes)).to.be.false;

      // Connect as recipient (fresh wallet) — msg.sender becomes the ERC-20 receiver
      await expect(
        pool.connect(recipient).withdrawToERC20(
          wrapperAddr, amount, pA, pB, pC, publicSignals
        )
      ).to.emit(pool, "WithdrawalToERC20Requested")
       .withArgs(wrapperAddr, nullifierBytes, (v: any) => v !== ethers.ZeroHash, recipient.address, (v: any) => v > 0n);

      // Nullifier is now spent
      expect(await pool.nullifierSpent(nullifierBytes)).to.be.true;
    });

    it("reverts double-spend on withdrawToERC20", async () => {
      this.timeout(180_000);
      if (!fhevm.isMock) this.skip();

      const { pool, wrapper, user, recipient, poolAddr, wrapperAddr } = await deployWithWrapper();
      const secret = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
      const amount = 50n;

      const commitment = poseidon2([secret, amount]);
      const commitmentBytes = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);

      await wrapper.mint(user.address, Number(amount));
      const inp = fhevm.createEncryptedInput(wrapperAddr, user.address);
      inp.add64(Number(amount));
      const { handles, inputProof } = await inp.encrypt();
      const callData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentBytes]);
      await wrapper.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](
        poolAddr, handles[0], inputProof, callData
      );

      const onChainRoot = BigInt(await pool.getLastRoot());
      const { pA, pB, pC, publicSignals } = await generateWithdrawProof(secret, amount, onChainRoot);

      await pool.connect(user).withdrawToERC20(
        wrapperAddr, amount, pA, pB, pC, publicSignals
      );

      await expect(
        pool.connect(user).withdrawToERC20(
          wrapperAddr, amount, pA, pB, pC, publicSignals
        )
      ).to.be.revertedWith("PrivacyPool: nullifier already spent");
    });

    it("cannot use same nullifier across withdraw and withdrawToERC20", async () => {
      this.timeout(180_000);
      if (!fhevm.isMock) this.skip();

      const { pool, wrapper, user, recipient, poolAddr, wrapperAddr } = await deployWithWrapper();
      const secret = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
      const amount = 75n;

      const commitment = poseidon2([secret, amount]);
      const commitmentBytes = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);

      await wrapper.mint(user.address, Number(amount));
      const inp = fhevm.createEncryptedInput(wrapperAddr, user.address);
      inp.add64(Number(amount));
      const { handles, inputProof } = await inp.encrypt();
      const callData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentBytes]);
      await wrapper.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](
        poolAddr, handles[0], inputProof, callData
      );

      const onChainRoot = BigInt(await pool.getLastRoot());
      const { pA, pB, pC, publicSignals } = await generateWithdrawProof(secret, amount, onChainRoot);

      // First withdrawal: get ERC-7984 out
      await pool.connect(user).withdraw(
        wrapperAddr, amount, pA, pB, pC, publicSignals
      );

      // Attempt second withdrawal via withdrawToERC20 with same nullifier — must revert
      await expect(
        pool.connect(user).withdrawToERC20(
          wrapperAddr, amount, pA, pB, pC, publicSignals
        )
      ).to.be.revertedWith("PrivacyPool: nullifier already spent");
    });
  });
});
