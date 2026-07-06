import { ethers } from "hardhat";

const POOL     = "0x6Cb4dA4E8712866ED8B98c753DC396D94281C36E";
const TOKENS   = [
  { symbol: "cUSDCMock", erc7984: "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639", erc20: "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF" },
  { symbol: "cUSDTMock", erc7984: "0x4E7B06D78965594eB5EF5414c357ca21E1554491", erc20: "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0" },
];
const AMOUNT   = 1_000_000_000n; // 1,000 units (6 decimals)
const ERC20_ABI  = ["function approve(address,uint256) returns(bool)", "function balanceOf(address) view returns(uint256)", "function mint(address,uint256) external"];
const ERC7984_ABI = ["function wrap(address,uint256) returns(uint64)"];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address, "\nPool:", POOL);
  for (const t of TOKENS) {
    const erc20  = new ethers.Contract(t.erc20,  ERC20_ABI,  deployer);
    const erc7984 = new ethers.Contract(t.erc7984, ERC7984_ABI, deployer);
    const bal = await erc20.balanceOf(deployer.address) as bigint;
    if (bal < AMOUNT) { await (await erc20.mint(deployer.address, AMOUNT * 2n)).wait(); }
    await (await erc20.approve(t.erc7984, AMOUNT)).wait();
    await (await erc7984.wrap(POOL, AMOUNT)).wait();
    console.log(`✓ Seeded ${AMOUNT} ${t.symbol} into PrivacyPool`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
