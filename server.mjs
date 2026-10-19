import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve("frontend");
const types = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml" };

createServer((request, response) => {
  const requestPath = request.url?.split("?")[0] || "/";
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = normalize(join(root, relativePath));
  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": `${types[extname(filePath)] || "application/octet-stream"}; charset=utf-8`,
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(response);
}).listen(5173, () => console.log("DrishtiPay is running at http://localhost:5173"));
