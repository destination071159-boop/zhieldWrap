import { ethers } from "hardhat";

const ROUTER   = "0x65422Cde6Af545d84184a55f6b6963B75812dcc2";
const TOKENS = [
  { symbol: "cUSDCMock", erc20: "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF", erc7984: "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639", decimals: 6 },
  { symbol: "cUSDTMock", erc20: "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0", erc7984: "0x4E7B06D78965594eB5EF5414c357ca21E1554491", decimals: 6 },
];
const LIQUIDITY = 2_000_000_000n; // 2,000 units each
const ROUTER_ABI = [
  "function registerPair(address erc20, address erc7984, uint8 decimals) external",
  "function depositLiquidity(address token, uint256 amount) external",
];
const ERC20_ABI = [
  "function approve(address,uint256) returns(bool)",
  "function balanceOf(address) view returns(uint256)",
  "function mint(address,uint256) external",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, deployer);
  console.log("Deployer:", deployer.address, "\nRouter:", ROUTER);

  for (const t of TOKENS) {
    // 1. Register pair
    const tx1 = await router.registerPair(t.erc20, t.erc7984, t.decimals);
    await tx1.wait();
    console.log(`✓ Registered pair: ${t.symbol}`);

    // 2. Mint + approve + depositLiquidity
    const erc20 = new ethers.Contract(t.erc20, ERC20_ABI, deployer);
    const bal = await erc20.balanceOf(deployer.address) as bigint;
    if (bal < LIQUIDITY) {
      await (await erc20.mint(deployer.address, LIQUIDITY * 2n)).wait();
    }
    await (await erc20.approve(ROUTER, LIQUIDITY)).wait();
    const tx2 = await router.depositLiquidity(t.erc20, LIQUIDITY);
    await tx2.wait();
    console.log(`✓ Seeded ${LIQUIDITY} ${t.symbol.slice(1)} liquidity into router`);
  }
  console.log("\n✅ CrossSwapRouter is ready.");
}
main().catch(e => { console.error(e); process.exit(1); });
