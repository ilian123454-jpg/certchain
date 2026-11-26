import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { BlockchainError } from "../services/blockchain";

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "ERROR", public details?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, "BAD_REQUEST", details);
export const notFound = (msg = "Ресурсът не е намерен") => new HttpError(404, msg, "NOT_FOUND");
export const forbidden = (msg = "Нямате права за тази операция") => new HttpError(403, msg, "FORBIDDEN");
export const conflict = (msg: string) => new HttpError(409, msg, "CONFLICT");

/** Обвивка за async обработчици, за да стигат грешките до централния обработчик. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "Невалидни входни данни", details: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) },
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof BlockchainError) {
    const status = err.code === "REVERTED" ? 409 : 503;
    return res.status(status).json({ error: { code: "BLOCKCHAIN_" + err.code, message: err.message, reason: err.reason } });
  }
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: { code: "FILE_TOO_LARGE", message: "Файлът е твърде голям" } });
  }
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "BAD_JSON", message: "Невалиден JSON" } });
  }
  console.error(err);
  return res.status(500).json({ error: { code: "INTERNAL", message: "Вътрешна грешка на сървъра" } });
}
