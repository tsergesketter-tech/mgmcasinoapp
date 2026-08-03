// Minimal static file server for the built Vite app (dist/).
// Uses only Node built-ins so it survives Heroku's devDependency pruning
// (NODE_ENV=production removes anything not in "dependencies").
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = process.env.PORT || 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".csv": "text/csv; charset=utf-8",
};

async function sendFile(res, filePath) {
  const body = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
    // Hashed asset filenames are safe to cache long-term; index.html isn't.
    "Cache-Control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    // Strip query string; prevent path traversal outside dist/.
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(DIST, safe);

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, "index.html");
      info = await stat(filePath).catch(() => null);
    }

    if (info?.isFile()) {
      await sendFile(res, filePath);
    } else {
      // SPA fallback — hand any unknown route to index.html.
      await sendFile(res, join(DIST, "index.html"));
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
    console.error(err);
  }
});

server.listen(PORT, () => {
  console.log(`MGM Host:Player serving dist/ on port ${PORT}`);
});
