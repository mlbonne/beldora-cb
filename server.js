"use strict";

const path = require("path");
const fs = require("fs");
const http = require("http");

const MIME = {
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
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".ico": "image/x-icon",
	".webmanifest": "application/manifest+json",
	".xml": "application/xml",
	".opus": "audio/ogg",
	".mp3": "audio/mpeg",
	".txt": "text/plain; charset=utf-8",
	".md": "text/plain; charset=utf-8",
};

let SITE_ROOT, UI_DIR, VENDOR;
let IMAGE_DIRS = () => [];
const REMOTE_IMG_ROOT = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main/";
function vendorMap (MODULES_DIR) {
	return {
	"pagedjs": path.join(MODULES_DIR, "pagedjs", "dist"),
	"cinzel": path.join(MODULES_DIR, "@fontsource", "cinzel"),
	"garamond": path.join(MODULES_DIR, "@fontsource", "eb-garamond"),
	"alegreya-sans": path.join(MODULES_DIR, "@fontsource", "alegreya-sans"),
	};
}

function resolveRequestPath (urlPath) {
	let p = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
	if (p.startsWith("/__tb/vendor/")) {
		const [, , , key, ...rest] = p.split("/");
		const base = VENDOR[key];
		if (!base) return null;
		return safeJoin(base, rest.join("/"));
	}
	// App pages live at the site root so the site's relative data URLs resolve
	const mPage = /^\/(tb-[a-z0-9-]+\.html)$/.exec(p);
	if (mPage) return safeJoin(UI_DIR, mPage[1]);
	if (p.startsWith("/__tb/")) return safeJoin(UI_DIR, p.slice("/__tb/".length) || "index.html");
	// Artwork: the user's images folder first, then the site's own img folder
	if (p.startsWith("/img/")) {
		const rel = p.slice("/img/".length);
		for (const base of IMAGE_DIRS()) {
			const f = safeJoin(base, rel);
			if (f && fs.existsSync(f)) return f;
		}
	}
	if (p === "/" || p === "") p = "/index.html";
	return safeJoin(SITE_ROOT, p.slice(1));
}

function safeJoin (base, rel) {
	const out = path.normalize(path.join(base, rel));
	if (!out.startsWith(path.normalize(base))) return null;
	return out;
}

function startServer ({siteRoot, uiDir, modulesDir, port = 47615, imageDirs = null}) {
	SITE_ROOT = siteRoot; UI_DIR = uiDir; VENDOR = vendorMap(modulesDir);
	if (imageDirs) IMAGE_DIRS = imageDirs;
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			// The site's service worker would cache aggressively; it is not wanted inside the app
			if (req.url.startsWith("/sw.js") || req.url.startsWith("/sw-injector.js")) {
				res.writeHead(200, {"Content-Type": MIME[".js"]});
				return res.end("/* disabled in Beldora CB */");
			}
			const filePath = resolveRequestPath(req.url);
			if (!filePath) { res.writeHead(403); return res.end(); }
			fs.stat(filePath, (err, stat) => {
				if (err || !stat.isFile()) {
					// Artwork not downloaded yet: fetch it from the 5etools image repository (works when online)
					if (req.url.startsWith("/img/")) {
						res.writeHead(302, {Location: REMOTE_IMG_ROOT + req.url.slice("/img/".length).split("?")[0]});
						return res.end();
					}
					res.writeHead(404);
					return res.end("Not found");
				}
				res.writeHead(200, {
					"Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
					"Content-Length": stat.size,
					"Cache-Control": "no-cache",
				});
				fs.createReadStream(filePath).pipe(res);
			});
		});
		// A fixed port keeps the site's own localStorage (settings, etc.) stable between runs
		const tryListen = (port, attempts) => {
			server.once("error", e => {
				if (attempts > 0 && e.code === "EADDRINUSE") tryListen(port + 1, attempts - 1);
				else reject(e);
			});
			server.listen(port, "127.0.0.1", () => resolve(server.address().port));
		};
		tryListen(port, 20);
	});
}

module.exports = {startServer};

if (require.main === module) {
	startServer({
		siteRoot: path.resolve(__dirname, ".."),
		uiDir: path.join(__dirname, "ui"),
		modulesDir: path.join(__dirname, "node_modules"),
		port: Number(process.env.PORT || 47700),
	}).then(p => console.log(`Serving on http://127.0.0.1:${p}`));
}
