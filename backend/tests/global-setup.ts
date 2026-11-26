import fs from "fs";
import path from "path";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";

/**
 * Преди тестовете: публикува нов екземпляр на договора в локалния Hardhat възел
 * (npx hardhat node), за да започва всяко пускане от чисто състояние.
 */
export default async function setup() {
  const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const artifactPath = path.resolve(__dirname, "../../contracts/artifacts/contracts/CertificateRegistry.sol/CertificateRegistry.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
  // Акаунт #9 на Hardhat, за да не се бърка с nonce-а на акаунта на демо средата.
  const admin = new Wallet("0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6", provider);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, admin);
  const contract = await factory.deploy(admin.address);
  await contract.waitForDeployment();
  const net = await provider.getNetwork();
  fs.writeFileSync(
    "/tmp/certchain-test-deployment.json",
    JSON.stringify({ address: await contract.getAddress(), chainId: Number(net.chainId), abi: artifact.abi }),
  );
  process.env.ADMIN_PRIVATE_KEY = admin.privateKey;
  fs.rmSync("/tmp/certchain-test-storage", { recursive: true, force: true });
}
