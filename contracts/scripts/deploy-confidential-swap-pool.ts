/**
 * deploy-confidential-swap-pool.ts
 *
 * Deploys ConfidentialSwapPool, registers all supported cTokens,
 * and seeds each with initial ERC-7984 liquidity by wrapping
 * underlying ERC-20 tokens directly into the pool's balance.
 *
 * Usage:
 *   cd contracts
 *   npx hardhat run scripts/deploy-confidential-swap-pool.ts --network sepolia
 *
 * Env required:
 *   PRIVATE_KEY=0x...  (deployer private key, holds USDCMock + USDTMock)
 *   SEPOLIA_RPC_URL=https://...
 */

import { ethers } from "hardhat";

// ── Existing deployed addresses ────────────────────────────────────────────

const TOKENS: Array<{
  symbol:       string;
  erc7984:      string;  // cToken address
  erc20:        string;  // underlying ERC-20 address
  liquidity:    bigint;  // initial liquidity to seed (in base units, 6 decimals)
}> = [
  {
    symbol:    "cUSDCMock",
    erc7984:   "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639",
    erc20:     "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF",
    liquidity: 1_000_000_000n, // 1,000 USDC (6 decimals)
  },
  {
    symbol:    "cUSDTMock",
    erc7984:   "0x4E7B06D78965594eB5EF5414c357ca21E1554491",
    erc20:     "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0",
    liquidity: 1_000_000_000n, // 1,000 USDT (6 decimals)
  },
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function mint(address to, uint256 amount) external",  // faucet-style mint if available
];

const ERC7984_WRAP_ABI = [
  "function wrap(address to, uint256 amount) external returns (uint64)",
];

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:       ", deployer.address);
  console.log("Network:        ", (await ethers.provider.getNetwork()).name);
  console.log("Balance:        ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // 1. Deploy ConfidentialSwapPool
  console.log("\n1. Deploying ConfidentialSwapPool…");
  const Factory = await ethers.getContractFactory("ConfidentialSwapPool");
  const pool = await Factory.deploy();
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log("   ConfidentialSwapPool deployed at:", poolAddr);

  // 2. Register all supported tokens
  console.log("\n2. Registering supported tokens…");
  for (const token of TOKENS) {
    const tx = await pool.addToken(token.erc7984);
    await tx.wait();
    console.log(`   ✓ ${token.symbol} (${token.erc7984}) registered`);
  }

  // 3. Seed liquidity for each token
  console.log("\n3. Seeding initial liquidity…");
  for (const token of TOKENS) {
    const erc20 = new ethers.Contract(token.erc20, ERC20_ABI, deployer);
    const erc7984 = new ethers.Contract(token.erc7984, ERC7984_WRAP_ABI, deployer);

    // Check deployer balance; try to mint if insufficient
    const bal = await erc20.balanceOf(deployer.address) as bigint;
    if (bal < token.liquidity) {
      console.log(`   Minting ${token.symbol} ERC-20 for deployer…`);
      try {
        const mintTx = await erc20.mint(deployer.address, token.liquidity * 2n);
        await mintTx.wait();
        console.log(`   ✓ Minted ${token.liquidity * 2n} ${token.symbol}`);
      } catch {
        console.warn(`   ⚠ mint() not available for ${token.symbol} — ensure deployer has enough balance`);
      }
    }

    // Approve wrapper to pull ERC-20 from deployer
    const approveTx = await erc20.approve(token.erc7984, token.liquidity);
    await approveTx.wait();
    console.log(`   ✓ Approved ${token.erc7984} to spend ${token.liquidity} ${token.symbol}`);

    // Wrap directly into the pool: pool now holds cToken balance
    const wrapTx = await erc7984.wrap(poolAddr, token.liquidity);
    await wrapTx.wait();
    console.log(`   ✓ Wrapped ${token.liquidity} ${token.symbol} → ${token.symbol.slice(1)} for pool`);
  }

  console.log("\n✅ Done! Update packages/core/src/constants.ts:");
  console.log(`   CONFIDENTIAL_SWAP_POOL_ADDRESS = "${poolAddr}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
