import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { HttpError, forbidden } from "./errors";

export type Role = "ADMIN" | "ISSUER" | "HOLDER";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(new HttpError(401, "Необходима е автентикация", "UNAUTHENTICATED"));
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    req.user = { id: String(payload.sub), email: payload.email, role: payload.role, name: payload.name };
    next();
  } catch {
    next(new HttpError(401, "Невалиден или изтекъл токен", "UNAUTHENTICATED"));
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Необходима е автентикация", "UNAUTHENTICATED"));
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
