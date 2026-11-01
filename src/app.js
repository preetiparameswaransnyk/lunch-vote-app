import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { defaultDbPath, openDatabase } from "./db.js";
import { HttpError } from "./errors.js";
import { pollsRouter } from "./routes/polls.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

export function resolveDbPath(explicitPath) {
  if (explicitPath) {
    return explicitPath;
  }
  if (process.env.LUNCH_DB_PATH) {
    return process.env.LUNCH_DB_PATH;
  }
  return defaultDbPath;
}

export function createApp({ dbPath } = {}) {
  const resolvedPath = resolveDbPath(dbPath);
  const db = openDatabase(resolvedPath);
  const app = express();

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    res.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", pollsRouter(db));
  app.use(
    express.static(publicDir, {
      index: "index.html",
      dotfiles: "deny",
      maxAge: 0,
      setHeaders(res) {
        res.set("Cache-Control", "no-cache");
      },
    }),
  );
  app.use((req, res) => {
    res.status(404).type("text/plain").send("Not found");
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body must be JSON" });
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large" });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Something went wrong" });
  });

  return { app, db, dbPath: resolvedPath };
}
