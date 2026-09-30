#!/usr/bin/env node
// Minimal static file server for local development, without dependencies.
//   node tools/serve.mjs [directory=web] [port=8000] [host=127.0.0.1]
// ES modules need correct MIME types, which `python -m http.server` does not always
// provide (e.g. on some Windows installations). Camera access in the browser also
// requires a secure context: http://localhost counts as one, a LAN address does not.
// Only this computer can connect unless another host is given (0.0.0.0 = all networks).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] || "web");
const port = Number(process.argv[3] || process.env.PORT || 8000);
const host = process.argv[4] || process.env.HOST || "127.0.0.1";
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(file).catch(() => null);
    if (info && info.isDirectory()) {
      if (!path.endsWith("/")) {
        // built from the checked file path, never from the request (no redirects to other sites)
        const rel = relative(root, file).split(sep).join("/");
        res.writeHead(301, { Location: rel ? `/${rel}/` : "/" }).end();
        return;
      }
      file = join(file, "index.html");
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(port, host, () => {
  const where = host === "127.0.0.1" || host === "localhost" ? "localhost" : host;
  console.log(`Serving ${root} at http://${where}:${port}/`);
});
