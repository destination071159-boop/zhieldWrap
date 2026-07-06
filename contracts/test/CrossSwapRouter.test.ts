import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * CrossSwapRouter tests
 *
 * Uses real mock tokens:
 *   MockERC20              — underlying ERC-20 (mintable)
 *   MockConfidentialUSDT   — ERC7984ERC20Wrapper (wraps MockERC20)
 *
 * Swap flow under test:
 *   User holds USDC (MockERC20) → approves router
 *   Router wraps USDC → cUSDC (held by router), 1:1
 *   Router wraps its DAI reserves → cDAI sent directly to user
 */
describe("CrossSwapRouter", function () {
  async function deployAll() {
    const [deployer, user] = await ethers.getSigners();

    // ── Deploy underlying ERC-20 tokens
    const ERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await ERC20.deploy();
    await usdc.waitForDeployment();
    const dai = await ERC20.deploy();
    await dai.waitForDeployment();

    // ── Deploy ERC-7984 wrappers backed by their underlying ERC-20
    const Wrapper = await ethers.getContractFactory("MockConfidentialUSDT");
    const cUsdc = await Wrapper.deploy(await usdc.getAddress());
    await cUsdc.waitForDeployment();
    const cDai = await Wrapper.deploy(await dai.getAddress());
    await cDai.waitForDeployment();

    // ── Deploy router
    const Router = await ethers.getContractFactory("CrossSwapRouter");
    const router = await Router.connect(deployer).deploy();
    await router.waitForDeployment();

    return {
      router, usdc, dai, cUsdc, cDai,
      deployer, user,
      usdcAddr:  await usdc.getAddress(),
      daiAddr:   await dai.getAddress(),
      cUsdcAddr: await cUsdc.getAddress(),
      cDaiAddr:  await cDai.getAddress(),
      routerAddr: await router.getAddress(),
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function registerBothPairs(ctx: Awaited<ReturnType<typeof deployAll>>) {
    await ctx.router.connect(ctx.deployer).registerPair(ctx.usdcAddr, ctx.cUsdcAddr, 6);
    await ctx.router.connect(ctx.deployer).registerPair(ctx.daiAddr,  ctx.cDaiAddr,  18);
  }

  // ── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", () => {
    it("deploys and sets owner", async () => {
      const { router, deployer } = await deployAll();
      expect(await router.owner()).to.equal(deployer.address);
    });

    it("starts with empty pair list", async () => {
      const { router } = await deployAll();
      expect((await router.getAllPairIds()).length).to.equal(0);
    });
  });

  // ── registerPair ──────────────────────────────────────────────────────────

  describe("registerPair", () => {
    it("registers a pair with real token addresses", async () => {
      const { router, deployer, usdcAddr, cUsdcAddr } = await deployAll();
      await router.connect(deployer).registerPair(usdcAddr, cUsdcAddr, 6);

      const id = ethers.keccak256(
        ethers.solidityPacked(["address", "address"], [usdcAddr, cUsdcAddr])
      );
      const pair = await router.pairs(id);
      expect(pair.erc20).to.equal(usdcAddr);
      expect(pair.erc7984).to.equal(cUsdcAddr);
      expect(pair.decimals).to.equal(6);
      expect(pair.active).to.be.true;
    });

    it("reverts if non-owner tries to register", async () => {
      const { router, user, usdcAddr, cUsdcAddr } = await deployAll();
      await expect(
        router.connect(user).registerPair(usdcAddr, cUsdcAddr, 6)
      ).to.be.revertedWith("CrossSwapRouter: not owner");
    });

    it("reverts if pair already registered", async () => {
      const { router, deployer, usdcAddr, cUsdcAddr } = await deployAll();
      await router.connect(deployer).registerPair(usdcAddr, cUsdcAddr, 6);
      await expect(
        router.connect(deployer).registerPair(usdcAddr, cUsdcAddr, 6)
      ).to.be.revertedWith("CrossSwapRouter: pair exists");
    });

    it("increments pair list after multiple registrations", async () => {
      const ctx = await deployAll();
      await registerBothPairs(ctx);
      expect((await ctx.router.getAllPairIds()).length).to.equal(2);
    });
  });

  // ── estimateOutput ────────────────────────────────────────────────────────

  describe("estimateOutput", () => {
    it("returns 1:1 for any input (demo mode)", async () => {
      const { router, usdcAddr, daiAddr } = await deployAll();
      const amount = ethers.parseUnits("100", 6);
      expect(await router.estimateOutput(usdcAddr, daiAddr, amount)).to.equal(amount);
    });
  });

  // ── swap ─────────────────────────────────────────────────────────────────

  describe("swap", () => {
    it("reverts with zero amount", async () => {
      const ctx = await deployAll();
      await expect(
        ctx.router.connect(ctx.user).swap(ctx.usdcAddr, ctx.cUsdcAddr, ctx.cDaiAddr, ctx.daiAddr, 0n)
      ).to.be.revertedWith("CrossSwapRouter: zero amount");
    });

    it("reverts when input pair is not registered", async () => {
      const ctx = await deployAll();
      await expect(
        ctx.router.connect(ctx.user).swap(ctx.usdcAddr, ctx.cUsdcAddr, ctx.cDaiAddr, ctx.daiAddr, 100n)
      ).to.be.revertedWith("CrossSwapRouter: input pair not registered");
    });

    it("reverts when output pair is not registered", async () => {
      const ctx = await deployAll();
      // Register only input pair
      await ctx.router.connect(ctx.deployer).registerPair(ctx.usdcAddr, ctx.cUsdcAddr, 6);
      await expect(
        ctx.router.connect(ctx.user).swap(ctx.usdcAddr, ctx.cUsdcAddr, ctx.cDaiAddr, ctx.daiAddr, 100n)
      ).to.be.revertedWith("CrossSwapRouter: output pair not registered");
    });

    it("reverts when router has no output liquidity", async () => {
      const ctx = await deployAll();
      const amount = ethers.parseUnits("100", 6);

      await registerBothPairs(ctx);

      // Fund user with USDC and approve router
      await ctx.usdc.mint(ctx.user.address, amount);
      await ctx.usdc.connect(ctx.user).approve(ctx.routerAddr, amount);

      // Router has no DAI reserves — should revert
      await expect(
        ctx.router.connect(ctx.user).swap(
          ctx.usdcAddr, ctx.cUsdcAddr, ctx.cDaiAddr, ctx.daiAddr, amount
        )
      ).to.be.revertedWith("CrossSwapRouter: insufficient output liquidity");
    });

    it("executes swap: user sends USDC, receives cDAI", async () => {
      const ctx = await deployAll();
      const amount = ethers.parseUnits("100", 6);

      await registerBothPairs(ctx);

      // Fund user with USDC, approve router
      await ctx.usdc.mint(ctx.user.address, amount);
      await ctx.usdc.connect(ctx.user).approve(ctx.routerAddr, amount);

      // Seed router with DAI reserves (liquidity for output side)
      await ctx.dai.mint(ctx.routerAddr, amount);

      const userUsdcBefore = await ctx.usdc.balanceOf(ctx.user.address);
      const routerDaiBefore = await ctx.dai.balanceOf(ctx.routerAddr);

      await ctx.router.connect(ctx.user).swap(
        ctx.usdcAddr, ctx.cUsdcAddr, ctx.cDaiAddr, ctx.daiAddr, amount
      );

      // User's USDC was spent
      expect(await ctx.usdc.balanceOf(ctx.user.address)).to.equal(userUsdcBefore - amount);
      // Router's DAI reserves were consumed by the wrap
      expect(await ctx.dai.balanceOf(ctx.routerAddr)).to.equal(routerDaiBefore - amount);
      // User now holds cDAI — confidentialBalanceOf returns euint64 handle (non-zero bytes32)
      const cDaiBalance = await ctx.cDai.confidentialBalanceOf(ctx.user.address);
      expect(cDaiBalance).to.not.equal(ethers.ZeroHash);
    });

    it("emits SwapExecuted event", async () => {
      const ctx = await deployAll();
      const amount = ethers.parseUnits("50", 6);

      await registerBothPairs(ctx);
      await ctx.usdc.mint(ctx.user.address, amount);
      await ctx.usdc.connect(ctx.user).approve(ctx.routerAddr, amount);
      await ctx.dai.mint(ctx.routerAddr, amount);

      await expect(
        ctx.router.connect(ctx.user).swap(
          ctx.usdcAddr, ctx.cUsdcAddr, ctx.cDaiAddr, ctx.daiAddr, amount
        )
      ).to.emit(ctx.router, "SwapExecuted")
        .withArgs(ctx.user.address, ctx.usdcAddr, ctx.daiAddr, amount, amount);
    });
  });
});

