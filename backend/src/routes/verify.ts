import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { config } from "../config";
import { asyncHandler, badRequest } from "../middleware/errors";
import * as certs from "../services/certificates";

/** Публични крайни точки за проверка. Не изискват вход в системата. */
export const verifyRouter = Router();

const limiter = rateLimit({ windowMs: 60 * 1000, limit: Number(process.env.VERIFY_RATE_LIMIT ?? 60), standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === "test" });
verifyRouter.use(limiter);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });

verifyRouter.post(
  "/file",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest("Прикачете PDF файл в поле 'file'");
    const id = typeof req.body?.certificateId === "string" && req.body.certificateId.trim() ? req.body.certificateId.trim() : undefined;
    res.json(await certs.verifyFile(req.file.buffer, id, { method: "FILE", ip: req.ip }));
  }),
);

verifyRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await certs.verifyById(req.params.id.trim(), { method: "ID", ip: req.ip }));
  }),
);
