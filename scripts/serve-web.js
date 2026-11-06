"use strict";

/** Serve web-dist/ locally: node scripts/serve-web.js [port] [folder] (any static web server works too). */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(process.argv[3] || path.join(__dirname, "..", "web-dist"));
const PORT = Number(process.argv[2] || 8080);
const TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".webmanifest": "application/manifest+json", ".opus": "audio/ogg", ".mp3": "audio/mpeg"};

http.createServer((req, res) => {
	let p = decodeURIComponent(req.url.split("?")[0]);
	if (p.endsWith("/")) p += "index.html";
	const file = path.normalize(path.join(ROOT, p));
	if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
	fs.readFile(file, (err, data) => {
		if (err) { res.writeHead(404); return res.end("Not found"); }
		res.writeHead(200, {"Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream"});
		res.end(data);
	});
}).listen(PORT, () => console.log(`Beldora CB (web) on http://localhost:${PORT}/`));
