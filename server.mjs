import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { networkInterfaces } from "node:os";

const root = resolve("frontend");
const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const BACKEND_PORT = 8000;
const BACKEND_HOST = "127.0.0.1";

function proxyRequest(req, res) {
  const options = {
    hostname: BACKEND_HOST,
    port: BACKEND_PORT,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: `${BACKEND_HOST}:${BACKEND_PORT}`
    }
  };

  const proxy = httpRequest(options, (backendRes) => {
    res.writeHead(backendRes.statusCode, backendRes.headers);
    backendRes.pipe(res);
  });

  proxy.on("error", (err) => {
    console.error("API proxy error:", err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: `Backend proxy unavailable: ${err.message}. Ensure backend is running.` }));
  });

  req.pipe(proxy);
}

const server = createServer((request, response) => {
  const requestPath = request.url?.split("?")[0] || "/";

  // Proxy API and health requests to FastAPI backend
  if (requestPath.startsWith("/api/") || requestPath === "/health") {
    proxyRequest(request, response);
    return;
  }

  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = normalize(join(root, relativePath));

  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": `${types[extname(filePath)] || "application/octet-stream"}; charset=utf-8`,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  createReadStream(filePath).pipe(response);
});

const PORT = 5173;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`DrishtiPay frontend & API proxy running on:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`  Network: http://${net.address}:${PORT}`);
      }
    }
  }
});
