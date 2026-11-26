import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Публикува CertificateRegistry и записва адреса и ABI в deployments/<network>.json.
 * Backend-ът чете този файл при стартиране.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  const artifact = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "artifacts", "contracts", "CertificateRegistry.sol", "CertificateRegistry.json"), "utf8"),
  );
  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    address,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    abi: artifact.abi,
  };
  const dir = process.env.DEPLOYMENTS_DIR || path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));
  console.log(`CertificateRegistry: ${address} (network ${network.name}, admin ${deployer.address})`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
