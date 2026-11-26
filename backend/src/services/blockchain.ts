import fs from "fs";
import { Contract, JsonRpcProvider, Network, Wallet, ethers } from "ethers";
import { config } from "../config";

/**
 * Слой за достъп до смарт договора CertificateRegistry чрез ethers.js.
 * Всички грешки се превръщат в BlockchainError с ясен код, за да може API-то
 * да покаже разбираемо съобщение и никога да не отчете непотвърдена операция като успешна.
 */

export type ChainStatus = "NONE" | "VALID" | "REVOKED";
export type ChainVerification = "NOT_FOUND" | "VALID" | "HASH_MISMATCH" | "REVOKED";

export interface ChainRecord {
  documentHash: string;
  issuer: string;
  issuerName: string;
  issuedAt: Date | null;
  revokedAt: Date | null;
  status: ChainStatus;
}

export interface TxResult {
  txHash: string;
  blockNumber: number;
}

export class BlockchainError extends Error {
  constructor(
    public code: "UNAVAILABLE" | "TIMEOUT" | "REVERTED" | "NOT_DEPLOYED",
    message: string,
    public reason?: string,
  ) {
    super(message);
  }
}

interface Deployment {
  address: string;
  chainId: number;
  abi: any[];
}

const STATUS: ChainStatus[] = ["NONE", "VALID", "REVOKED"];
const VERIFY: ChainVerification[] = ["NOT_FOUND", "VALID", "HASH_MISMATCH", "REVOKED"];

let deployment: Deployment | null = null;
let provider: JsonRpcProvider | null = null;

function loadDeployment(): Deployment {
  if (deployment) return deployment;
  if (!fs.existsSync(config.deploymentFile)) {
    throw new BlockchainError("NOT_DEPLOYED", "Смарт договорът не е публикуван (липсва файл " + config.deploymentFile + ")");
  }
  deployment = JSON.parse(fs.readFileSync(config.deploymentFile, "utf8")) as Deployment;
  return deployment;
}

function getProvider(): JsonRpcProvider {
  if (provider) return provider;
  const d = loadDeployment();
  // staticNetwork: не питаме възела за мрежата при всяка заявка и не влизаме в безкраен цикъл,
  // когато възелът е недостъпен. cacheTimeout: -1 изключва кеша на еднакви заявки,
  // иначе две поредни транзакции може да получат един и същ nonce.
  provider = new JsonRpcProvider(config.rpcUrl, Network.from(d.chainId), { staticNetwork: true, polling: true, pollingInterval: 250, cacheTimeout: -1 });
  return provider;
}

function readContract(): Contract {
  const d = loadDeployment();
  return new Contract(d.address, d.abi, getProvider());
}

function writeContract(privateKey: string): Contract {
  const d = loadDeployment();
  return new Contract(d.address, d.abi, new Wallet(privateKey, getProvider()));
}

export function contractAddress(): string | null {
  try {
    return loadDeployment().address;
  } catch {
    return null;
  }
}

export function adminAddress(): string {
  return new Wallet(config.adminPrivateKey).address;
}

/** Опашка по адрес: транзакциите от един и същи акаунт се изпращат последователно, за да няма конфликт на nonce. */
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(address: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(address) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(job);
  queues.set(address, next.catch(() => undefined));
  return next;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new BlockchainError("TIMEOUT", `Изтече времето за изчакване: ${what}`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function translateError(e: any, what: string): BlockchainError {
  if (e instanceof BlockchainError) return e;
  const d = deployment;
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (d && data && typeof data === "string" && data.length >= 10) {
    try {
      const parsed = new ethers.Interface(d.abi).parseError(data);
      if (parsed) return new BlockchainError("REVERTED", `Договорът отхвърли операцията: ${parsed.name}`, parsed.name);
    } catch {
      /* непознат формат */
    }
  }
  if (e?.code === "CALL_EXCEPTION") {
    return new BlockchainError("REVERTED", `Договорът отхвърли операцията (${what})`, e?.reason ?? undefined);
  }
  const msg = String(e?.message ?? e);
  if (e?.code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed|ENOTFOUND|socket hang up|NETWORK_ERROR|could not coalesce/i.test(msg)) {
    return new BlockchainError("UNAVAILABLE", "Блокчейн мрежата е недостъпна. Операцията не е записана.");
  }
  return new BlockchainError("UNAVAILABLE", `Грешка при връзка с блокчейна (${what}): ${msg.slice(0, 200)}`);
}

async function sendTx(privateKey: string, what: string, build: (c: Contract) => Promise<ethers.ContractTransactionResponse>): Promise<TxResult> {
  const contract = writeContract(privateKey);
  const address = new Wallet(privateKey).address;
  return enqueue(address, async () => {
    try {
      const tx = await withTimeout(build(contract), config.txTimeoutMs, what);
      const receipt = await withTimeout(tx.wait(config.txConfirmations), config.txTimeoutMs, what);
      if (!receipt || receipt.status !== 1) throw new BlockchainError("REVERTED", `Транзакцията е отхвърлена (${what})`);
      return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
    } catch (e) {
      throw translateError(e, what);
    }
  });
}

export function certificateChainId(certificateUuid: string): string {
  return ethers.id(certificateUuid);
}

export async function isAvailable(): Promise<{ ok: boolean; blockNumber?: number; error?: string }> {
  try {
    const n = await withTimeout(getProvider().getBlockNumber(), 3000, "проверка на възела");
    return { ok: true, blockNumber: n };
  } catch (e) {
    return { ok: false, error: translateError(e, "проверка на възела").message };
  }
}

export async function registerIssuer(address: string, name: string): Promise<TxResult> {
  const result = await sendTx(config.adminPrivateKey, "добавяне на издател", (c) => c.addIssuer(address, name));
  const amount = ethers.parseEther(config.issuerFundingEth);
  if (amount > 0n) {
    const admin = new Wallet(config.adminPrivateKey, getProvider());
    await enqueue(admin.address, async () => {
      try {
        const tx = await admin.sendTransaction({ to: address, value: amount });
        await withTimeout(tx.wait(config.txConfirmations), config.txTimeoutMs, "захранване на издател");
      } catch (e) {
        throw translateError(e, "захранване на издател");
      }
    });
  }
  return result;
}

export async function removeIssuer(address: string): Promise<TxResult> {
  return sendTx(config.adminPrivateKey, "премахване на издател", (c) => c.removeIssuer(address));
}

export async function issueOnChain(issuerPrivateKey: string, chainId: string, documentHash: string): Promise<TxResult> {
  return sendTx(issuerPrivateKey, "издаване на сертификат", (c) => c.issueCertificate(chainId, documentHash));
}

export async function revokeOnChain(privateKey: string, chainId: string, reason: string): Promise<TxResult> {
  return sendTx(privateKey, "отнемане на сертификат", (c) => c.revokeCertificate(chainId, reason));
}

const toDate = (v: bigint): Date | null => (v === 0n ? null : new Date(Number(v) * 1000));

export async function getRecord(chainId: string): Promise<ChainRecord> {
  try {
    const c = readContract();
    const r = await withTimeout(c.getCertificate(chainId), 5000, "четене на запис");
    const status = STATUS[Number(r.status)] ?? "NONE";
    const issuerName = status === "NONE" ? "" : await withTimeout(c.issuerNames(r.issuer), 5000, "четене на издател");
    return {
      documentHash: r.documentHash,
      issuer: r.issuer,
      issuerName,
      issuedAt: toDate(r.issuedAt),
      revokedAt: toDate(r.revokedAt),
      status,
    };
  } catch (e) {
    throw translateError(e, "четене на запис");
  }
}

export async function verifyOnChain(chainId: string, documentHash: string): Promise<ChainVerification> {
  try {
    const r = await withTimeout(readContract().verifyCertificate(chainId, documentHash), 5000, "проверка");
    return VERIFY[Number(r)] ?? "NOT_FOUND";
  } catch (e) {
    throw translateError(e, "проверка");
  }
}

export async function findByHash(documentHash: string): Promise<string | null> {
  try {
    const id: string = await withTimeout(readContract().findByHash(documentHash), 5000, "търсене по хеш");
    return id === ethers.ZeroHash ? null : id;
  } catch (e) {
    throw translateError(e, "търсене по хеш");
  }
}

export async function totals(): Promise<{ issued: number; revoked: number }> {
  try {
    const c = readContract();
    const [issued, revoked] = await Promise.all([c.totalIssued(), c.totalRevoked()]);
    return { issued: Number(issued), revoked: Number(revoked) };
  } catch (e) {
    throw translateError(e, "статистика");
  }
}

/** Само за тестове: подмяна на конфигурацията след стартиране. */
export function __resetForTests(): void {
  deployment = null;
  provider = null;
  queues.clear();
}
