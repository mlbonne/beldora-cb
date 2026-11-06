"use strict";

/**
 * Publishes the ui/ folder as an in-app update for the desktop app (no installer needed).
 *   node scripts/publish-update.js [--notes "What changed"] [--dry]
 * Bumps nothing by itself: set the new version in ui/version.json first ("minApp" is the oldest installed
 * app that can run it; raise it only when main.js/preload.js changed, which needs a new installer anyway).
 * The bundle (gzip'd JSON of every file, base64) and the manifest go to the UPDATES KV namespace on Cloudflare.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const {spawnSync} = require("child_process");

const ROOT = path.join(__dirname, "..");
const UI = path.join(ROOT, "ui");
const OUT = path.join(ROOT, "dist-updates");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const notesIx = args.indexOf("--notes");
const notes = notesIx >= 0 ? args[notesIx + 1] || "" : "";
const SKIP = /(^|[\\/])(tb-test\.html|tb-selftest\.html|tb-boot\.html)$/;

const meta = JSON.parse(fs.readFileSync(path.join(UI, "version.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(meta.version)) throw new Error("ui/version.json needs a version like 1.5.1");

const files = {};
const walk = (dir) => {
	for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, ent.name);
		const rel = path.relative(UI, full).split(path.sep).join("/");
		if (ent.isDirectory()) walk(full);
		else if (!SKIP.test(rel)) files[rel] = fs.readFileSync(full).toString("base64");
	}
};
walk(UI);

const gz = zlib.gzipSync(Buffer.from(JSON.stringify({version: meta.version, minApp: meta.minApp, files})), {level: 9});
const sha256 = crypto.createHash("sha256").update(gz).digest("hex");
fs.mkdirSync(OUT, {recursive: true});
const bundlePath = path.join(OUT, `ui-${meta.version}.bundle`);
fs.writeFileSync(bundlePath, gz);
console.log(`Bundle ${meta.version}: ${Object.keys(files).length} files, ${(gz.length / 1024).toFixed(0)} KB, sha256 ${sha256.slice(0, 16)}…`);
if (dry) process.exit(0);

const wrangler = (...a) => {
	// One command line (arguments are quoted by the callers) so the shell sees it as typed
	const r = spawnSync(["npx", "--yes", "wrangler", ...a].join(" "), {cwd: ROOT, shell: true, encoding: "utf8"});
	if (r.status !== 0) throw new Error(`wrangler ${a.slice(0, 3).join(" ")} failed:\n${r.stderr || r.stdout}`);
	return r.stdout;
};

wrangler("kv", "key", "put", `"bundle:${meta.version}"`, "--path", `"${bundlePath}"`, "--binding", "UPDATES", "--remote");

let manifest = {};
try { manifest = JSON.parse(wrangler("kv", "key", "get", "manifest", "--binding", "UPDATES", "--remote", "--text").trim() || "{}"); } catch (e) { manifest = {}; }
manifest.desktop = {version: meta.version, minApp: meta.minApp, minAndroid: meta.minAndroid || null, sha256, size: gz.length, notes, published: new Date().toISOString()};
const mPath = path.join(OUT, "manifest.json");
fs.writeFileSync(mPath, JSON.stringify(manifest, null, "\t"));
wrangler("kv", "key", "put", "manifest", "--path", `"${mPath}"`, "--binding", "UPDATES", "--remote");
console.log(`Published desktop update ${meta.version}${notes ? `: ${notes}` : ""}`);
