import "dotenv/config";
import path from "path";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Липсва задължителна променлива на средата: ${name}`);
  }
  return value;
}

const isTest = process.env.NODE_ENV === "test";

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),

  databaseUrl: required(
    "DATABASE_URL",
    isTest
      ? "postgres://certchain:certchain@127.0.0.1:5432/certchain_test"
      : "postgres://certchain:certchain@127.0.0.1:5432/certchain",
  ),

  jwtSecret: required("JWT_SECRET", "dev-only-secret-change-me-at-least-32-chars"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",

  /** Ключ за AES-256-GCM криптиране на частните ключове на издателите в базата. */
  keyEncryptionSecret: required("KEY_ENCRYPTION_SECRET", "dev-only-key-encryption-secret-change-me"),

  /** Сол за хеширане на IP адреси в журнала на проверките (не пазим IP в чист вид). */
  logSalt: process.env.LOG_SALT ?? "dev-log-salt",

  rpcUrl: required("RPC_URL", "http://127.0.0.1:8545"),
  /** Частен ключ на администратора на договора. По подразбиране е акаунт #0 на локалния Hardhat възел. */
  adminPrivateKey: required(
    "ADMIN_PRIVATE_KEY",
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  ),
  deploymentFile: required(
    "DEPLOYMENT_FILE",
    path.resolve(__dirname, "..", "..", "contracts", "deployments", "localhost.json"),
  ),
  /** Колко ETH да получи нов издател за такси (само за локална/тестова мрежа). */
  issuerFundingEth: process.env.ISSUER_FUNDING_ETH ?? "1.0",
  txConfirmations: Number(process.env.TX_CONFIRMATIONS ?? 1),
  txTimeoutMs: Number(process.env.TX_TIMEOUT_MS ?? 30000),

  publicAppUrl: process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000,http://localhost:5173").split(","),
  storageDir: path.resolve(process.env.STORAGE_DIR ?? path.join(__dirname, "..", "storage")),
  fontsDir: path.resolve(__dirname, "..", "assets", "fonts"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024),
};

export type AppConfig = typeof config;
