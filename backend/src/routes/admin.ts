import { Router } from "express";
import { z } from "zod";
import { query, queryOne } from "../db/pool";
import { asyncHandler } from "../middleware/errors";
import { authenticate, requireRole } from "../middleware/auth";
import * as chain from "../services/blockchain";
import { createIssuer, setIssuerActive } from "../services/users";

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole("ADMIN"));

const issuerSchema = z.object({
  email: z.string().trim().email("Невалиден имейл"),
  password: z.string().min(8, "Паролата трябва да е поне 8 символа"),
  fullName: z.string().trim().min(3).max(200),
  organizationName: z.string().trim().min(2).max(200),
});

adminRouter.get(
  "/issuers",
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT u.id, u.email, u.full_name AS "fullName", u.organization_name AS "organizationName", u.wallet_address AS "walletAddress",
              u.is_active AS "isActive", u.created_at AS "createdAt",
              count(c.id) FILTER (WHERE c.status IN ('ISSUED','REVOKED'))::int AS "issuedCount",
              count(c.id) FILTER (WHERE c.status = 'REVOKED')::int AS "revokedCount"
         FROM users u LEFT JOIN certificates c ON c.issuer_id = u.id
        WHERE u.role = 'ISSUER' GROUP BY u.id ORDER BY u.created_at`,
    );
    res.json({ issuers: rows });
  }),
);

adminRouter.post(
  "/issuers",
  asyncHandler(async (req, res) => {
    const input = issuerSchema.parse(req.body);
    res.status(201).json({ issuer: await createIssuer(req.user!.id, input) });
  }),
);

adminRouter.patch(
  "/issuers/:id",
  asyncHandler(async (req, res) => {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    await setIssuerActive(req.user!.id, req.params.id, isActive);
    res.json({ ok: true });
  }),
);

adminRouter.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const db = await queryOne(
      `SELECT count(*) FILTER (WHERE status='ISSUED')::int AS issued,
              count(*) FILTER (WHERE status='REVOKED')::int AS revoked,
              count(*) FILTER (WHERE status='FAILED')::int AS failed,
              count(*) FILTER (WHERE status='PENDING')::int AS pending,
              (SELECT count(*)::int FROM users WHERE role='HOLDER') AS holders,
              (SELECT count(*)::int FROM users WHERE role='ISSUER' AND is_active) AS issuers
         FROM certificates`,
    );
    const verifications = await query(
      `SELECT result, count(*)::int AS count, round(avg(duration_ms))::int AS "avgMs" FROM verification_logs GROUP BY result ORDER BY result`,
    );
    const daily = await query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              (SELECT count(*)::int FROM verification_logs v WHERE v.created_at::date = d) AS verifications,
              (SELECT count(*)::int FROM certificates c WHERE c.created_at::date = d AND c.status IN ('ISSUED','REVOKED')) AS issued
         FROM generate_series(current_date - 6, current_date, interval '1 day') d ORDER BY d`,
    );
    const node = await chain.isAvailable();
    let onChain = null;
    if (node.ok) {
      try {
        onChain = await chain.totals();
      } catch {
        onChain = null;
      }
    }
    res.json({
      database: db,
      verifications,
      daily,
      blockchain: { available: node.ok, blockNumber: node.blockNumber ?? null, contractAddress: chain.contractAddress(), admin: chain.adminAddress(), totals: onChain },
    });
  }),
);

adminRouter.get(
  "/audit",
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT a.id, a.action, a.entity_id AS "entityId", a.details, a.created_at AS "createdAt", u.email AS "actorEmail", u.role AS "actorRole"
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 200`,
    );
    res.json({ entries: rows });
  }),
);
