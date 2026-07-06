import { ethers } from "hardhat";

const OFFICIAL_PAIRS = [
  {
    name: "USDCMock / cUSDCMock",
    erc20:   "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF",
    erc7984: "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639",
    decimals: 6,
  },
  {
    name: "USDTMock / cUSDTMock",
    erc20:   "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0",
    erc7984: "0x4E7B06D78965594eB5EF5414c357ca21E1554491",
    decimals: 6,
  },
  {
    name: "WETHMock / cWETHMock",
    erc20:   "0xff54739b16576FA5402F211D0b938469Ab9A5f3F",
    erc7984: "0x46208622DA27d91db4f0393733C8BA082ed83158",
    decimals: 18,
  },
  {
    name: "BRONMock / cBRONMock",
    erc20:   "0xFf021fB13cA64e5354c62c954b949a88cfDEb25E",
    erc7984: "0xaa5612FA27c927a0c7961f5AEFEE5ba3A0F9C891",
    decimals: 18,
  },
  {
    name: "ZAMAMock / cZAMAMock",
    erc20:   "0x75355a85c6FB9df5f0C80FF54e8747EEe9a0BF57",
    erc7984: "0xf2D628d2598aF4eAF94CB76a437Ff86CA78FfbFB",
    decimals: 18,
  },
  {
    name: "tGBPMock / ctGBPMock",
    erc20:   "0x93c931278A2aad1916783F952f94276eA5111442",
    erc7984: "0xfCE5c7069c5525eF6c8C2b2E35A745bA20a2F7CC",
    decimals: 18,
  },
  {
    name: "XAUtMock / cXAUtMock",
    erc20:   "0x24377AE4AA0C45ecEe71225007f17c5D423dd940",
    erc7984: "0xe4FcF848739845BC81Dee1d5352cf3844F0a60C7",
    decimals: 18,
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Network:", (await ethers.provider.getNetwork()).name);

  // ── 1. Deploy ZKVerifier (snarkjs-generated from circuits/compile.sh) ──────
  console.log("\n1. Deploying ZKVerifier...");
  const ZKVerifier = await ethers.getContractFactory("ZKVerifier");
  const verifier = await ZKVerifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log("   ZKVerifier deployed at:", verifierAddr);

  // ── 2. Deploy PrivacyPool (links Hasher library from MerkleTree) ────────────
  console.log("\n2. Deploying Hasher library...");
  const Hasher = await ethers.getContractFactory("Hasher");
  const hasher = await Hasher.deploy();
  await hasher.waitForDeployment();
  const hasherAddr = await hasher.getAddress();
  console.log("   Hasher deployed at:", hasherAddr);

  console.log("\n3. Deploying PrivacyPool...");
  const PrivacyPool = await ethers.getContractFactory("PrivacyPool", {
    libraries: { Hasher: hasherAddr },
  });
  const pool = await PrivacyPool.deploy(verifierAddr);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log("   PrivacyPool deployed at:", poolAddr);

  // ── 4. Deploy CrossSwapRouter ───────────────────────────────────────────────
  console.log("\n4. Deploying CrossSwapRouter...");
  const CrossSwapRouter = await ethers.getContractFactory("CrossSwapRouter");
  const router = await CrossSwapRouter.deploy();
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("   CrossSwapRouter deployed at:", routerAddr);

  // ── 5. Register all official pairs in the router ───────────────────────────
  console.log("\n5. Registering official pairs in CrossSwapRouter...");
  for (const pair of OFFICIAL_PAIRS) {
    const tx = await router.registerPair(pair.erc20, pair.erc7984, pair.decimals);
    await tx.wait();
    console.log(`   ✓ ${pair.name}`);
  }

  // ── 6. Summary ─────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("Deployment complete. Update .env with these values:");
  console.log("═══════════════════════════════════════════════════");
  console.log(`ZK_VERIFIER_ADDRESS=${verifierAddr}`);
  console.log(`PRIVACY_POOL_ADDRESS=${poolAddr}`);
  console.log(`CROSS_SWAP_ROUTER_ADDRESS=${routerAddr}`);
  console.log("═══════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
