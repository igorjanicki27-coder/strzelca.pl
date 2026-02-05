/**
 * Lists available avatar files from /konto.strzelca.pl/avatary.
 *
 * This enables the frontend to show "all avatars regardless of name" and sort them alphabetically,
 * without needing directory listing on static hosting.
 */
const fs = require("fs");
const path = require("path");

module.exports = (req, res) => {
  try {
    // --- CORS (allow strzelca.pl + any subdomain of strzelca.pl) ---
    const origin = req.headers?.origin;
    const allowed =
      origin === "https://strzelca.pl" ||
      (typeof origin === "string" && /^https:\/\/[a-z0-9-]+\.strzelca\.pl$/i.test(origin));

    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const rootDir = path.resolve(__dirname, "..");
    const avatarsDir = path.join(rootDir, "konto.strzelca.pl", "avatary");

    if (!fs.existsSync(avatarsDir)) {
      res.statusCode = 200;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ files: [] }));
      return;
    }

    const allowedExt = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif"]);

    const files = fs
      .readdirSync(avatarsDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((name) => !name.startsWith("."))
      .filter((name) => name !== ".gitkeep")
      .filter((name) => allowedExt.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, "pl"));

    res.statusCode = 200;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ files }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "avatars handler failed" }));
  }
};

