import { Router } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import { query } from "../db/pool";
import { asyncHandler, forbidden, notFound } from "../middleware/errors";
import { authenticate, requireRole } from "../middleware/auth";
import * as certs from "../services/certificates";

export const certificatesRouter = Router();
certificatesRouter.use(authenticate);

const today = () => new Date().toISOString().slice(0, 10);

const issueSchema = z.object({
  holderName: z.string().trim().min(3, "Въведете името на притежателя").max(200),
  holderEmail: z.string().trim().email("Невалиден имейл").max(255),
  title: z.string().trim().min(3).max(200).default("Сертификат"),
  program: z.string().trim().min(3, "Въведете курс или програма").max(200),
  description: z.string().trim().max(1000).optional().nullable(),
  grade: z.string().trim().max(50).optional().nullable(),
  issueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Датата трябва да е във формат ГГГГ-ММ-ДД")
    .refine((d) => !Number.isNaN(Date.parse(d)), "Невалидна дата")
    .refine((d) => d <= today(), "Датата на издаване не може да е в бъдещето")
    .default(today),
});

const revokeSchema = z.object({ reason: z.string().trim().min(5, "Посочете причина (поне 5 символа)").max(300) });

/** Издаване на нов сертификат. */
certificatesRouter.post(
  "/",
  requireRole("ISSUER"),
  asyncHandler(async (req, res) => {
    const input = issueSchema.parse(req.body);
    const cert = await certs.issueCertificate(req.user!, input);
    res.status(201).json({ certificate: cert });
  }),
);

/** Списък: издателят вижда издадените от него, притежателят своите, администраторът всички. */
certificatesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const search = typeof req.query.q === "string" && req.query.q.trim() ? `%${req.query.q.trim()}%` : null;
    const where: string[] = [];
    const params: unknown[] = [];
    if (u.role === "ISSUER") {
      params.push(u.id);
      where.push(`c.issuer_id = $${params.length}`);
    } else if (u.role === "HOLDER") {
      params.push(u.id, u.email);
      where.push(`(c.holder_id = $${params.length - 1} OR lower(c.holder_email) = lower($${params.length}))`);
      where.push(`c.status IN ('ISSUED','REVOKED')`);
    }
    if (search) {
      params.push(search);
      where.push(`(c.holder_name ILIKE $${params.length} OR c.certificate_number ILIKE $${params.length} OR c.program ILIKE $${params.length} OR c.holder_email ILIKE $${params.length})`);
    }
    const rows = await query<certs.CertificateRow>(
      `SELECT c.*, to_char(c.issue_date,'YYYY-MM-DD') AS issue_date, u.organization_name, u.full_name AS issuer_name
         FROM certificates c JOIN users u ON u.id = c.issuer_id
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY c.created_at DESC LIMIT 500`,
      params,
    );
    res.json({ certificates: rows.map(certs.toDto) });
  }),
);

certificatesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const row = await certs.findCertificate(req.params.id);
    if (!row) throw notFound("Сертификатът не е намерен");
    if (!certs.canAccess(req.user!, row)) throw forbidden();
    res.json({ certificate: certs.toDto(row) });
  }),
);

/** Изтегляне на оригиналния PDF (точно същите байтове, които са хеширани при издаване). */
certificatesRouter.get(
  "/:id/pdf",
  asyncHandler(async (req, res) => {
    const row = await certs.findCertificate(req.params.id);
    if (!row) throw notFound("Сертификатът не е намерен");
    if (!certs.canAccess(req.user!, row)) throw forbidden();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${row.certificate_number}.pdf"`);
    res.send(certs.readPdf(row));
  }),
);

certificatesRouter.get(
  "/:id/qr",
  asyncHandler(async (req, res) => {
    const row = await certs.findCertificate(req.params.id);
    if (!row) throw notFound("Сертификатът не е намерен");
    if (!certs.canAccess(req.user!, row)) throw forbidden();
    res.setHeader("Content-Type", "image/png");
    res.send(await QRCode.toBuffer(certs.verifyUrl(row.id), { width: 320, margin: 1 }));
  }),
);

certificatesRouter.post(
  "/:id/revoke",
  requireRole("ISSUER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { reason } = revokeSchema.parse(req.body);
    res.json({ certificate: await certs.revokeCertificate(req.user!, req.params.id, reason) });
  }),
);

certificatesRouter.post(
  "/:id/retry",
  requireRole("ISSUER"),
  asyncHandler(async (req, res) => {
    res.json({ certificate: await certs.retryCertificate(req.user!, req.params.id) });
  }),
);
