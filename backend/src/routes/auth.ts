import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { query, queryOne } from "../db/pool";
import { asyncHandler, conflict, HttpError } from "../middleware/errors";
import { authenticate, signToken, Role } from "../middleware/auth";
import { audit } from "../services/audit";

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === "test" });

const loginSchema = z.object({ email: z.string().trim().email("Невалиден имейл"), password: z.string().min(1, "Въведете парола") });
const registerSchema = z.object({
  email: z.string().trim().email("Невалиден имейл").max(255),
  password: z.string().min(8, "Паролата трябва да е поне 8 символа").max(100),
  fullName: z.string().trim().min(3, "Въведете име и фамилия").max(200),
});

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: Role;
  organization_name: string | null;
  wallet_address: string | null;
  is_active: boolean;
}

const publicUser = (u: UserRow) => ({ id: u.id, email: u.email, fullName: u.full_name, role: u.role, organizationName: u.organization_name, walletAddress: u.wallet_address });

authRouter.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await queryOne<UserRow>("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
    // Сравняваме и при несъществуващ потребител, за да няма разлика във времето за отговор.
    const ok = await bcrypt.compare(password, user?.password_hash ?? "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
    if (!user || !ok) throw new HttpError(401, "Грешен имейл или парола", "INVALID_CREDENTIALS");
    if (!user.is_active) throw new HttpError(403, "Акаунтът е деактивиран", "INACTIVE");
    const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.full_name });
    await audit(user.id, "LOGIN", user.id);
    res.json({ token, user: publicUser(user) });
  }),
);

/** Регистрация на притежател. Издателите се създават само от администратор. */
authRouter.post(
  "/register",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const exists = await queryOne("SELECT 1 FROM users WHERE lower(email) = lower($1)", [input.email]);
    if (exists) throw conflict("Вече има акаунт с този имейл");
    const hash = await bcrypt.hash(input.password, 10);
    const user = (await queryOne<UserRow>(
      "INSERT INTO users (email, password_hash, full_name, role) VALUES (lower($1), $2, $3, 'HOLDER') RETURNING *",
      [input.email, hash, input.fullName],
    ))!;
    // Свързваме вече издадени сертификати за този имейл с новия акаунт.
    const linked = await query("UPDATE certificates SET holder_id = $1 WHERE lower(holder_email) = lower($2) AND holder_id IS NULL RETURNING id", [user.id, user.email]);
    await audit(user.id, "REGISTER", user.id, { linkedCertificates: linked.length });
    const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.full_name });
    res.status(201).json({ token, user: publicUser(user) });
  }),
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await queryOne<UserRow>("SELECT * FROM users WHERE id = $1", [req.user!.id]);
    if (!user) throw new HttpError(401, "Потребителят не съществува", "UNAUTHENTICATED");
    res.json({ user: publicUser(user) });
  }),
);
