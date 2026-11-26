import bcrypt from "bcryptjs";
import { Wallet } from "ethers";
import { query, queryOne } from "../db/pool";
import { conflict, notFound } from "../middleware/errors";
import { audit } from "./audit";
import * as chain from "./blockchain";
import { encryptSecret } from "./crypto";

export interface NewIssuer {
  email: string;
  password: string;
  fullName: string;
  organizationName: string;
}

/**
 * Създава издател: нов блокчейн акаунт (ключова двойка), криптиран частен ключ в базата,
 * роля ISSUER_ROLE в договора и малко ETH за такси (в локална/тестова мрежа).
 * Ако записът в блокчейна не успее, потребителят не се създава.
 */
export async function createIssuer(actorId: string | null, input: NewIssuer) {
  const exists = await queryOne("SELECT 1 FROM users WHERE lower(email) = lower($1)", [input.email]);
  if (exists) throw conflict("Вече има акаунт с този имейл");
  const wallet = Wallet.createRandom();
  const tx = await chain.registerIssuer(wallet.address, input.organizationName);
  const hash = await bcrypt.hash(input.password, 10);
  const user = await queryOne<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, role, organization_name, wallet_address, encrypted_private_key)
     VALUES (lower($1), $2, $3, 'ISSUER', $4, $5, $6) RETURNING id`,
    [input.email, hash, input.fullName, input.organizationName, wallet.address, encryptSecret(wallet.privateKey)],
  );
  await audit(actorId, "ISSUER_CREATED", user!.id, { wallet: wallet.address, txHash: tx.txHash });
  return { id: user!.id, walletAddress: wallet.address, txHash: tx.txHash };
}

export async function setIssuerActive(actorId: string, issuerId: string, active: boolean) {
  const issuer = await queryOne<{ id: string; wallet_address: string; is_active: boolean; organization_name: string }>(
    "SELECT id, wallet_address, is_active, organization_name FROM users WHERE id = $1 AND role = 'ISSUER'",
    [issuerId],
  );
  if (!issuer) throw notFound("Издателят не е намерен");
  if (issuer.is_active === active) return;
  const tx = active ? await chain.registerIssuer(issuer.wallet_address, issuer.organization_name) : await chain.removeIssuer(issuer.wallet_address);
  await query("UPDATE users SET is_active = $2 WHERE id = $1", [issuerId, active]);
  await audit(actorId, active ? "ISSUER_ACTIVATED" : "ISSUER_DEACTIVATED", issuerId, { txHash: tx.txHash });
}

export async function createUser(email: string, password: string, fullName: string, role: "ADMIN" | "HOLDER") {
  const hash = await bcrypt.hash(password, 10);
  return queryOne<{ id: string }>(
    "INSERT INTO users (email, password_hash, full_name, role) VALUES (lower($1), $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id",
    [email, hash, fullName, role],
  );
}
