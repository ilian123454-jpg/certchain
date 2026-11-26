import crypto from "crypto";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { query, queryOne } from "../db/pool";
import { HttpError, badRequest, conflict, forbidden, notFound } from "../middleware/errors";
import type { AuthUser } from "../middleware/auth";
import { audit } from "./audit";
import * as chain from "./blockchain";
import { BlockchainError } from "./blockchain";
import { anonymizeClient, decryptSecret, sha256Hex } from "./crypto";
import { renderCertificatePdf } from "./pdf";

export interface IssueInput {
  holderName: string;
  holderEmail: string;
  title: string;
  program: string;
  description?: string | null;
  grade?: string | null;
  issueDate: string;
}

export interface CertificateRow {
  id: string;
  certificate_number: string;
  chain_id: string;
  issuer_id: string;
  holder_id: string | null;
  holder_name: string;
  holder_email: string;
  title: string;
  program: string;
  description: string | null;
  grade: string | null;
  issue_date: string;
  pdf_path: string;
  document_hash: string;
  status: "PENDING" | "ISSUED" | "FAILED" | "REVOKED";
  tx_hash: string | null;
  block_number: string | null;
  error_message: string | null;
  revoke_reason: string | null;
  revoked_at: Date | null;
  revoke_tx_hash: string | null;
  created_at: Date;
  organization_name?: string;
  issuer_name?: string;
}

const SELECT_CERT = `
  SELECT c.*, to_char(c.issue_date, 'YYYY-MM-DD') AS issue_date,
         u.organization_name, u.full_name AS issuer_name
    FROM certificates c JOIN users u ON u.id = c.issuer_id`;

export function verifyUrl(id: string): string {
  return `${config.publicAppUrl.replace(/\/$/, "")}/verify/${id}`;
}

export function toDto(row: CertificateRow) {
  return {
    id: row.id,
    certificateNumber: row.certificate_number,
    chainId: row.chain_id,
    holderName: row.holder_name,
    holderEmail: row.holder_email,
    title: row.title,
    program: row.program,
    description: row.description,
    grade: row.grade,
    issueDate: row.issue_date,
    organizationName: row.organization_name,
    issuerName: row.issuer_name,
    documentHash: row.document_hash,
    status: row.status,
    txHash: row.tx_hash,
    blockNumber: row.block_number ? Number(row.block_number) : null,
    errorMessage: row.error_message,
    revokeReason: row.revoke_reason,
    revokedAt: row.revoked_at,
    revokeTxHash: row.revoke_tx_hash,
    createdAt: row.created_at,
    verifyUrl: verifyUrl(row.id),
  };
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

export async function findCertificate(id: string): Promise<CertificateRow | null> {
  if (!isUuid(id)) return null;
  return queryOne<CertificateRow>(`${SELECT_CERT} WHERE c.id = $1`, [id]);
}

async function loadIssuer(issuerId: string) {
  const issuer = await queryOne<{ id: string; full_name: string; organization_name: string; wallet_address: string; encrypted_private_key: string; is_active: boolean }>(
    "SELECT id, full_name, organization_name, wallet_address, encrypted_private_key, is_active FROM users WHERE id = $1 AND role = 'ISSUER'",
    [issuerId],
  );
  if (!issuer) throw forbidden("Само регистриран издател може да издава сертификати");
  if (!issuer.is_active) throw forbidden("Акаунтът на издателя е деактивиран");
  return issuer;
}

function pdfAbsolutePath(relative: string) {
  return path.join(config.storageDir, relative);
}

/**
 * Издаване: генериране на PDF -> SHA-256 -> запис в базата (PENDING) -> транзакция към договора -> ISSUED.
 * При неуспешна транзакция записът остава FAILED и API-то връща грешка; сертификатът не се показва като издаден.
 */
export async function issueCertificate(actor: AuthUser, input: IssueInput) {
  const issuer = await loadIssuer(actor.id);
  const id = crypto.randomUUID();
  const chainId = chain.certificateChainId(id);
  const year = input.issueDate.slice(0, 4);
  const seq = await queryOne<{ n: string }>("SELECT nextval('certificate_number_seq')::text AS n");
  const certificateNumber = `CC-${year}-${seq!.n.padStart(6, "0")}`;
  const holder = await queryOne<{ id: string }>("SELECT id FROM users WHERE lower(email) = lower($1) AND role = 'HOLDER'", [input.holderEmail]);

  const pdf = await renderCertificatePdf({
    certificateNumber,
    verifyUrl: verifyUrl(id),
    holderName: input.holderName,
    title: input.title,
    program: input.program,
    description: input.description,
    grade: input.grade,
    issueDate: input.issueDate,
    organizationName: issuer.organization_name,
    signerName: issuer.full_name,
    createdAt: new Date(),
  });
  const documentHash = sha256Hex(pdf);

  const relPath = path.join("certificates", `${id}.pdf`);
  fs.mkdirSync(path.dirname(pdfAbsolutePath(relPath)), { recursive: true });
  fs.writeFileSync(pdfAbsolutePath(relPath), pdf, { flag: "wx" });

  await query(
    `INSERT INTO certificates (id, certificate_number, chain_id, issuer_id, holder_id, holder_name, holder_email, title, program,
                               description, grade, issue_date, pdf_path, document_hash, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'PENDING')`,
    [id, certificateNumber, chainId, issuer.id, holder?.id ?? null, input.holderName, input.holderEmail.toLowerCase(), input.title, input.program,
     input.description ?? null, input.grade ?? null, input.issueDate, relPath, documentHash],
  );

  return registerOnChain(actor, id, issuer.encrypted_private_key, chainId, documentHash);
}

async function registerOnChain(actor: AuthUser, id: string, encryptedKey: string, chainId: string, documentHash: string) {
  try {
    const tx = await chain.issueOnChain(decryptSecret(encryptedKey), chainId, documentHash);
    await query("UPDATE certificates SET status='ISSUED', tx_hash=$2, block_number=$3, error_message=NULL, updated_at=now() WHERE id=$1", [id, tx.txHash, tx.blockNumber]);
    await audit(actor.id, "CERTIFICATE_ISSUED", id, { txHash: tx.txHash, blockNumber: tx.blockNumber, documentHash });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await query("UPDATE certificates SET status='FAILED', error_message=$2, updated_at=now() WHERE id=$1", [id, message.slice(0, 500)]);
    await audit(actor.id, "CERTIFICATE_ISSUE_FAILED", id, { error: message });
    const row = await findCertificate(id);
    if (e instanceof BlockchainError) {
      throw new HttpError(e.code === "REVERTED" ? 409 : 503, message, "BLOCKCHAIN_" + e.code, { certificate: row && toDto(row) });
    }
    throw e;
  }
  return toDto((await findCertificate(id))!);
}

/** Повторен опит за запис в блокчейна на сертификат със статус FAILED (напр. след недостъпна мрежа). */
export async function retryCertificate(actor: AuthUser, id: string) {
  const row = await findCertificate(id);
  if (!row) throw notFound("Сертификатът не е намерен");
  if (row.issuer_id !== actor.id) throw forbidden();
  if (row.status !== "FAILED") throw conflict("Повторен опит е възможен само за сертификат със статус FAILED");
  const issuer = await loadIssuer(actor.id);

  // Файлът трябва да е непроменен спрямо хеша, изчислен при издаването.
  const bytes = fs.readFileSync(pdfAbsolutePath(row.pdf_path));
  if (sha256Hex(bytes) !== row.document_hash) throw new HttpError(500, "Съхраненият PDF не съответства на записания хеш", "INTEGRITY");

  // Ако предишната транзакция все пак е минала (напр. изтекло изчакване), само синхронизираме статуса.
  const existing = await chain.getRecord(row.chain_id);
  if (existing.status !== "NONE" && existing.documentHash === row.document_hash) {
    await query("UPDATE certificates SET status='ISSUED', error_message=NULL, updated_at=now() WHERE id=$1", [id]);
    await audit(actor.id, "CERTIFICATE_RECONCILED", id, {});
    return toDto((await findCertificate(id))!);
  }
  return registerOnChain(actor, id, issuer.encrypted_private_key, row.chain_id, row.document_hash);
}

export async function revokeCertificate(actor: AuthUser, id: string, reason: string) {
  const row = await findCertificate(id);
  if (!row) throw notFound("Сертификатът не е намерен");
  if (actor.role === "ISSUER" && row.issuer_id !== actor.id) throw forbidden("Можете да отнемате само сертификати, издадени от вас");
  if (row.status === "REVOKED") throw conflict("Сертификатът вече е отнет");
  if (row.status !== "ISSUED") throw conflict("Само издаден сертификат може да бъде отнет");

  let key: string;
  if (actor.role === "ADMIN") {
    key = config.adminPrivateKey;
  } else {
    const issuer = await loadIssuer(actor.id);
    key = decryptSecret(issuer.encrypted_private_key);
  }
  const tx = await chain.revokeOnChain(key, row.chain_id, reason);
  await query("UPDATE certificates SET status='REVOKED', revoke_reason=$2, revoked_at=now(), revoke_tx_hash=$3, updated_at=now() WHERE id=$1", [id, reason, tx.txHash]);
  await audit(actor.id, "CERTIFICATE_REVOKED", id, { reason, txHash: tx.txHash });
  return toDto((await findCertificate(id))!);
}

export function readPdf(row: CertificateRow): Buffer {
  return fs.readFileSync(pdfAbsolutePath(row.pdf_path));
}

export function canAccess(actor: AuthUser, row: CertificateRow): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "ISSUER") return row.issuer_id === actor.id;
  return row.holder_id === actor.id || row.holder_email.toLowerCase() === actor.email.toLowerCase();
}

// ---------------------------------------------------------------------------
// Проверка
// ---------------------------------------------------------------------------

export type VerificationResult = "VALID" | "INVALID" | "NOT_FOUND" | "REVOKED";
export type VerificationReason =
  | "MATCH"
  | "HASH_MISMATCH"
  | "UNKNOWN_DOCUMENT"
  | "NOT_ON_CHAIN"
  | "NOT_REGISTERED"
  | "INTEGRITY_ERROR"
  | "REVOKED"
  | "NOT_FOUND";

const MESSAGES: Record<VerificationReason, string> = {
  MATCH: "Сертификатът е автентичен. Записът в блокчейна съвпада и сертификатът не е отнет.",
  HASH_MISMATCH: "Документът е променен. Хешът му не съвпада с регистрирания в блокчейна.",
  UNKNOWN_DOCUMENT: "Няма регистриран сертификат с такъв цифров отпечатък. Документът е променен или не е издаден чрез системата.",
  NOT_ON_CHAIN: "Сертификатът не е регистриран в блокчейна.",
  NOT_REGISTERED: "Сертификатът все още не е потвърден в блокчейна.",
  INTEGRITY_ERROR: "Данните в базата не съответстват на записа в блокчейна. Сертификатът не може да бъде потвърден.",
  REVOKED: "Сертификатът е отнет от издателя.",
  NOT_FOUND: "Не е намерен сертификат с този идентификатор.",
};

interface VerifyContext {
  method: "ID" | "FILE";
  ip?: string;
}

async function logVerification(ctx: VerifyContext, certificateId: string | null, result: string, startedAt: number) {
  await query("INSERT INTO verification_logs (certificate_id, method, result, client_hash, duration_ms) VALUES ($1,$2,$3,$4,$5)", [
    certificateId,
    ctx.method,
    result,
    anonymizeClient(ctx.ip),
    Date.now() - startedAt,
  ]);
}

function publicView(row: CertificateRow | null) {
  if (!row) return null;
  // Минимални данни, които така или иначе са отпечатани върху сертификата. Имейлът не се показва.
  return {
    id: row.id,
    certificateNumber: row.certificate_number,
    holderName: row.holder_name,
    title: row.title,
    program: row.program,
    grade: row.grade,
    issueDate: row.issue_date,
    organizationName: row.organization_name,
    status: row.status,
    revokeReason: row.status === "REVOKED" ? row.revoke_reason : null,
    txHash: row.tx_hash,
    blockNumber: row.block_number ? Number(row.block_number) : null,
  };
}

function chainView(r: chain.ChainRecord | null, chainId: string | null) {
  if (!r || r.status === "NONE") return null;
  return {
    certificateId: chainId,
    contractAddress: chain.contractAddress(),
    documentHash: r.documentHash,
    issuer: r.issuer,
    issuerName: r.issuerName,
    issuedAt: r.issuedAt,
    revokedAt: r.revokedAt,
    status: r.status,
  };
}

function outcome(result: VerificationResult, reason: VerificationReason, row: CertificateRow | null, record: chain.ChainRecord | null, chainId: string | null, extra: Record<string, unknown> = {}) {
  return { result, reason, message: MESSAGES[reason], certificate: publicView(row), chain: chainView(record, chainId), checkedAt: new Date().toISOString(), ...extra };
}

/** Проверка по идентификатор (от QR кода). Източник на истината е блокчейнът, а не базата. */
export async function verifyById(id: string, ctx: VerifyContext) {
  const started = Date.now();
  const row = await findCertificate(id);
  const chainId = isUuid(id) ? chain.certificateChainId(id) : null;
  if (!chainId) {
    await logVerification(ctx, null, "NOT_FOUND", started);
    return outcome("NOT_FOUND", "NOT_FOUND", null, null, null);
  }
  const record = await chain.getRecord(chainId);
  let res;
  if (row && (row.status === "PENDING" || row.status === "FAILED") && record.status === "NONE") {
    res = outcome("INVALID", "NOT_REGISTERED", row, record, chainId);
  } else if (record.status === "NONE") {
    res = row ? outcome("INVALID", "NOT_ON_CHAIN", row, record, chainId) : outcome("NOT_FOUND", "NOT_FOUND", null, null, chainId);
  } else if (row && row.document_hash !== record.documentHash) {
    res = outcome("INVALID", "INTEGRITY_ERROR", row, record, chainId);
  } else if (record.status === "REVOKED") {
    res = outcome("REVOKED", "REVOKED", row, record, chainId);
  } else {
    res = outcome("VALID", "MATCH", row, record, chainId);
  }
  await logVerification(ctx, row?.id ?? null, res.result, started);
  return res;
}

/** Проверка по качен файл: хешира се точното съдържание и се сравнява със записа в договора. */
export async function verifyFile(file: Buffer, id: string | undefined, ctx: VerifyContext) {
  const started = Date.now();
  if (file.length < 5 || file.subarray(0, 5).toString("latin1") !== "%PDF-") throw badRequest("Файлът не е PDF документ");
  const documentHash = sha256Hex(file);

  let chainId: string | null;
  if (id) {
    if (!isUuid(id)) {
      await logVerification(ctx, null, "NOT_FOUND", started);
      return outcome("NOT_FOUND", "NOT_FOUND", null, null, null, { documentHash });
    }
    chainId = chain.certificateChainId(id);
  } else {
    chainId = await chain.findByHash(documentHash);
    if (!chainId) {
      await logVerification(ctx, null, "INVALID", started);
      return outcome("INVALID", "UNKNOWN_DOCUMENT", null, null, null, { documentHash });
    }
  }

  const [verdict, record, row] = await Promise.all([
    chain.verifyOnChain(chainId, documentHash),
    chain.getRecord(chainId),
    queryOne<CertificateRow>(`${SELECT_CERT} WHERE c.chain_id = $1`, [chainId]),
  ]);

  let res;
  switch (verdict) {
    case "VALID":
      res = outcome("VALID", "MATCH", row, record, chainId, { documentHash });
      break;
    case "REVOKED":
      res = outcome("REVOKED", "REVOKED", row, record, chainId, { documentHash });
      break;
    case "HASH_MISMATCH":
      res = outcome("INVALID", "HASH_MISMATCH", row, record, chainId, { documentHash });
      break;
    default:
      res = outcome("NOT_FOUND", "NOT_FOUND", row, null, chainId, { documentHash });
  }
  await logVerification(ctx, row?.id ?? null, res.result, started);
  return res;
}
