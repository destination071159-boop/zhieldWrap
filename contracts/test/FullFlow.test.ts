/**
 * Full End-to-End Integration Test
 *
 * Covers the complete ZhieldWrap flow:
 *
 *   ERC-20 (USDC)
 *     │  1. approve + swap
 *     ▼
 *   CrossSwapRouter  →  user receives cDAI (ERC-7984)
 *     │  2. confidentialTransferAndCall → pool.onConfidentialTransferReceived
 *     ▼
 *   PrivacyPool  (commitment inserted into Merkle tree)
 *     │  3. generate ZK proof off-chain
 *     │  4. pool.withdraw → cDAI to fresh recipient
 *     ▼
 *   Fresh recipient holds cDAI — no on-chain link to original depositor
 */

import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import * as snarkjs from "snarkjs";
import { MerkleTree } from "fixed-merkle-tree";
import { poseidon2 } from "poseidon-lite";
import * as path from "path";

const TREE_LEVELS  = 20;
const FIELD        = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const WASM_PATH    = path.join(__dirname, "../../circuits/proof-source/privacyProof_js/privacyProof.wasm");
const ZKEY_PATH    = path.join(__dirname, "../../circuits/proof-source/privacyProof.zkey");

// ── ZK helper ────────────────────────────────────────────────────────────────

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

// ── Fixture ───────────────────────────────────────────────────────────────────

async function deployAll() {
  const [deployer, user, freshRecipient] = await ethers.getSigners();

  // ── ERC-20 tokens (underlying)
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const usdc  = await ERC20.deploy(); await usdc.waitForDeployment();
  const dai   = await ERC20.deploy(); await dai.waitForDeployment();

  // ── ERC-7984 wrappers
  const Wrapper = await ethers.getContractFactory("MockConfidentialUSDT");
  const cUsdc   = await Wrapper.deploy(await usdc.getAddress()); await cUsdc.waitForDeployment();
  const cDai    = await Wrapper.deploy(await dai.getAddress());  await cDai.waitForDeployment();

  // ── CrossSwapRouter
  const Router = await ethers.getContractFactory("CrossSwapRouter");
  const router = await Router.connect(deployer).deploy(); await router.waitForDeployment();

  // ── ZK stack (Hasher + ZKVerifier + PrivacyPool)
  const Hasher = await ethers.getContractFactory("Hasher");
  const hasher = await Hasher.deploy(); await hasher.waitForDeployment();

  const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
  const verifier   = await ZKVerifier.deploy(); await verifier.waitForDeployment();

  const PrivacyPool = await ethers.getContractFactory("PrivacyPool", {
    libraries: { Hasher: await hasher.getAddress() },
  });
  const pool = await PrivacyPool.deploy(await verifier.getAddress());
  await pool.waitForDeployment();

  return {
    router, usdc, dai, cUsdc, cDai, pool,
    deployer, user, freshRecipient,
    usdcAddr:  await usdc.getAddress(),
    daiAddr:   await dai.getAddress(),
    cUsdcAddr: await cUsdc.getAddress(),
    cDaiAddr:  await cDai.getAddress(),
    routerAddr: await router.getAddress(),
    poolAddr:   await pool.getAddress(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Full Flow — ERC-20 → CrossSwapRouter → ERC-7984 → PrivacyPool → withdraw", function () {

  // ── Step 1: ERC-20 → ERC-7984 via CrossSwapRouter ───────────────────────

  describe("Step 1: CrossSwapRouter — USDC → cDAI", () => {
    it("user receives cDAI after swapping USDC", async () => {
      const { router, usdc, dai, cDai, deployer, user, usdcAddr, daiAddr, cUsdcAddr, cDaiAddr, routerAddr } = await deployAll();

      const amount = ethers.parseUnits("100", 6); // 100 USDC (6 decimals)

      await router.connect(deployer).registerPair(usdcAddr, cUsdcAddr, 6);
      await router.connect(deployer).registerPair(daiAddr,  cDaiAddr,  18);

      await usdc.mint(user.address,   amount);
      await dai.mint(routerAddr, amount); // liquidity for output side

      await usdc.connect(user).approve(routerAddr, amount);

      const usdcBefore = await usdc.balanceOf(user.address);

      await router.connect(user).swap(usdcAddr, cUsdcAddr, cDaiAddr, daiAddr, amount);

      // User spent USDC
      expect(await usdc.balanceOf(user.address)).to.equal(usdcBefore - amount);
      // Router's DAI was used up
      expect(await dai.balanceOf(routerAddr)).to.equal(0n);
    });
  });

  // ── Full pipeline ────────────────────────────────────────────────────────

  describe("Full pipeline: swap → deposit → ZK withdraw", () => {
    it("completes end-to-end: USDC → cDAI → pool deposit → nullifier-gated withdrawal", async () => {
      this.timeout(180_000);
      if (!fhevm.isMock) this.skip();

      const { router, usdc, dai, cDai, pool, deployer, user, freshRecipient,
              usdcAddr, daiAddr, cUsdcAddr, cDaiAddr, routerAddr, poolAddr } = await deployAll();

      // Use 6-decimal unit amount that fits comfortably in uint64 and the ZK circuit
      const amount = 100n; // 100 base units (small to avoid rate issues)

      // ── 1. Register pairs & seed liquidity
      await router.connect(deployer).registerPair(usdcAddr, cUsdcAddr, 6);
      await router.connect(deployer).registerPair(daiAddr,  cDaiAddr,  18);

      await usdc.mint(user.address, amount);
      await dai.mint(routerAddr,    amount);

      // ── 2. CrossSwapRouter: USDC → cDAI
      await usdc.connect(user).approve(routerAddr, amount);
      await router.connect(user).swap(usdcAddr, cUsdcAddr, cDaiAddr, daiAddr, amount);
      // User now holds cDAI (euint64)

      console.log("    [1/4] Swap complete — user holds cDAI");

      // ── 3. Build ZK commitment
      const secret        = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
      const commitment    = poseidon2([secret, amount]);
      const commitmentBytes = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);

      // ── 4. FHE-encrypt amount for the pool deposit
      //   tx.to = cDai (ERC-7984 token) → FHE verification uses cDaiAddr ✓
      const inp = fhevm.createEncryptedInput(cDaiAddr, user.address);
      inp.add64(Number(amount));
      const { handles, inputProof } = await inp.encrypt();

      // ── 5. Deposit: user calls confidentialTransferAndCall on cDAI
      const callData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentBytes]);
      const rootBefore = await pool.getLastRoot();

      await cDai.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](
        poolAddr, handles[0], inputProof, callData
      );

      console.log("    [2/4] Deposit complete — commitment in Merkle tree");

      // Verify on-chain state
      expect(await pool.nextIndex()).to.equal(1n);
      expect(await pool.getLastRoot()).to.not.equal(rootBefore);
      expect(await pool.hasDeposit(commitmentBytes)).to.be.true;
      expect(await pool.anonymitySet(cDaiAddr)).to.equal(1n);

      // ── 6. Generate ZK withdrawal proof off-chain
      const onChainRoot = BigInt(await pool.getLastRoot());
      console.log("    [3/4] Generating ZK proof for root:", onChainRoot.toString().slice(0, 20) + "...");

      const { pA, pB, pC, publicSignals, nullifier } = await generateWithdrawProof(
        secret, amount, onChainRoot
      );

      const nullifierBytes = ethers.zeroPadValue(ethers.toBeHex(nullifier), 32);
      expect(await pool.nullifierSpent(nullifierBytes)).to.be.false;

      // ── 7. Fresh recipient connects and withdraws — msg.sender = freshRecipient
      await pool.connect(freshRecipient).withdraw(
        cDaiAddr, amount, pA, pB, pC, publicSignals
      );

      console.log("    [4/4] Withdrawal complete — cDAI sent to fresh recipient");

      // Nullifier is now spent — double-spend not possible
      expect(await pool.nullifierSpent(nullifierBytes)).to.be.true;

      // Anonymity set decremented
      expect(await pool.anonymitySet(cDaiAddr)).to.equal(0n);
    });

    it("prevents double-spend across the full pipeline", async () => {
      this.timeout(180_000);
      if (!fhevm.isMock) this.skip();

      const { router, usdc, dai, cDai, pool, deployer, user, freshRecipient,
              usdcAddr, daiAddr, cUsdcAddr, cDaiAddr, routerAddr, poolAddr } = await deployAll();

      const amount = 100n;

      await router.connect(deployer).registerPair(usdcAddr, cUsdcAddr, 6);
      await router.connect(deployer).registerPair(daiAddr,  cDaiAddr,  18);
      await usdc.mint(user.address, amount);
      await dai.mint(routerAddr,    amount);

      await usdc.connect(user).approve(routerAddr, amount);
      await router.connect(user).swap(usdcAddr, cUsdcAddr, cDaiAddr, daiAddr, amount);

      const secret       = BigInt(ethers.hexlify(ethers.randomBytes(31))) % FIELD;
      const commitment   = poseidon2([secret, amount]);
      const commitmentBytes = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);

      const inp = fhevm.createEncryptedInput(cDaiAddr, user.address);
      inp.add64(Number(amount));
      const { handles, inputProof } = await inp.encrypt();

      const callData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [commitmentBytes]);
      await cDai.connect(user)["confidentialTransferAndCall(address,bytes32,bytes,bytes)"](
        poolAddr, handles[0], inputProof, callData
      );

      const onChainRoot = BigInt(await pool.getLastRoot());
      const { pA, pB, pC, publicSignals } = await generateWithdrawProof(secret, amount, onChainRoot);

      // First withdrawal succeeds
      await pool.connect(user).withdraw(cDaiAddr, amount, pA, pB, pC, publicSignals);

      // Second withdrawal with same proof reverts
      await expect(
        pool.connect(user).withdraw(cDaiAddr, amount, pA, pB, pC, publicSignals)
      ).to.be.revertedWith("PrivacyPool: nullifier already spent");
    });
  });
});
