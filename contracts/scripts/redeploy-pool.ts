import { ethers } from "hardhat";

// Reuse existing ZKVerifier — only redeploy Hasher + PrivacyPool
const EXISTING_VERIFIER = "0x62dBF2724FA845A00712FD992736289FA6a72F6d";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Network:", (await ethers.provider.getNetwork()).name);

  console.log("\n1. Deploying Hasher library...");
  const Hasher = await ethers.getContractFactory("Hasher");
  const hasher = await Hasher.deploy();
  await hasher.waitForDeployment();
  const hasherAddr = await hasher.getAddress();
  console.log("   Hasher deployed at:", hasherAddr);

  console.log("\n2. Deploying PrivacyPool (with allowTransient fix)...");
  const PrivacyPool = await ethers.getContractFactory("PrivacyPool", {
    libraries: { Hasher: hasherAddr },
  });
  const pool = await PrivacyPool.deploy(EXISTING_VERIFIER);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log("   PrivacyPool deployed at:", poolAddr);

  const block = await ethers.provider.getBlockNumber();
  console.log("\n✅ Update constants.ts:");
  console.log(`   PRIVACY_POOL_ADDRESS = "${poolAddr}"`);
  console.log(`   PRIVACY_POOL_DEPLOY_BLOCK = ${block}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
