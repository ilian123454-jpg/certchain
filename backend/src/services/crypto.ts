import crypto from "crypto";
import { config } from "../config";

/** SHA-256 на точните байтове на файла, във формат 0x + 64 шестнайсетични знака (bytes32). */
export function sha256Hex(data: Buffer): string {
  return "0x" + crypto.createHash("sha256").update(data).digest("hex");
}

export function isBytes32Hex(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function encryptionKey(): Buffer {
  // Извеждаме 256-битов ключ от тайната с scrypt, за да не зависим от дължината ѝ.
  return crypto.scryptSync(config.keyEncryptionSecret, "certchain-key-encryption", 32);
}

/**
 * Криптира частния ключ на издател с AES-256-GCM.
 * Формат на резултата: iv.authTag.ciphertext (base64, разделени с точка).
 */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("Невалиден формат на криптиран ключ");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]).toString("utf8");
}

/** Кратък необратим отпечатък на IP адрес за статистика, без да пазим самия адрес. */
export function anonymizeClient(ip: string | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(config.logSalt + ip).digest("hex").slice(0, 16);
}
