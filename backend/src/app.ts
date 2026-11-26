import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config";
import { errorHandler, notFound } from "./middleware/errors";
import { authRouter } from "./routes/auth";
import { certificatesRouter } from "./routes/certificates";
import { verifyRouter } from "./routes/verify";
import { adminRouter } from "./routes/admin";
import * as chain from "./services/blockchain";
import { pool } from "./db/pool";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: false }));
  app.use(express.json({ limit: "100kb" }));
  if (config.env !== "test") app.use(morgan("dev"));

  app.get("/api/health", async (_req, res) => {
    const node = await chain.isAvailable();
    let db = true;
    try {
      await pool.query("SELECT 1");
    } catch {
      db = false;
    }
    res.status(db && node.ok ? 200 : 503).json({ status: db && node.ok ? "ok" : "degraded", database: db, blockchain: node, contract: chain.contractAddress() });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/certificates", certificatesRouter);
  app.use("/api/verify", verifyRouter);
  app.use("/api/admin", adminRouter);

  app.use((_req, _res, next) => next(notFound("Няма такъв адрес")));
  app.use(errorHandler);
  return app;
}
