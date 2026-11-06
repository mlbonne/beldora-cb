"use strict";

const {app, BrowserWindow, ipcMain, dialog, shell, Menu, net} = require("electron");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");

// region Paths
// Everything lives next to the program: nothing is written to AppData.
const APP_DIR = __dirname;
const UI_BUNDLED = path.join(APP_DIR, "ui");
// The ui/ folder actually served: the built-in one, or a newer in-app update (see "App updates")
let UI_DIR = UI_BUNDLED;
const MODULES_DIR = path.join(APP_DIR, "node_modules");
const ROOT = process.env.BELDORA_HOME
	|| (app.isPackaged ? path.dirname(process.execPath) : path.join(APP_DIR, "dev-home"));
const DIRS = {
	saves: path.join(ROOT, "Saves"),
	characters: path.join(ROOT, "Saves", "Characters"),
	books: path.join(ROOT, "Saves", "Books"),
	encounters: path.join(ROOT, "Saves", "Encounters"),
	exports: path.join(ROOT, "Exports"),
	images: path.join(ROOT, "images"),
	site: path.join(ROOT, "5etools"),
	siteNext: path.join(ROOT, "5etools-next"),
	updates: path.join(ROOT, "Updates"),
	system: path.join(ROOT, "System"),
};
// Electron's own cache, cookies and logs go to System instead of %APPDATA%
app.setPath("userData", DIRS.system);
app.setPath("sessionData", DIRS.system);
try { app.setPath("crashDumps", path.join(DIRS.system, "Crashpad")); } catch (e) { /* older Electron */ }
try { app.setAppLogsPath(path.join(DIRS.system, "logs")); } catch (e) { /* ignore */ }

const CONFIG_PATH = () => path.join(DIRS.system, "beldora-config.json");
const isSite = (dir) => { try { return !!dir && fs.existsSync(path.join(dir, "data", "races.json")) && fs.existsSync(path.join(dir, "js", "render.js")); } catch (e) { return false; } };
const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_PATH(), "utf8")); } catch (e) { return {}; } };
const writeConfig = (cfg) => { fs.mkdirSync(path.dirname(CONFIG_PATH()), {recursive: true}); fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, "\t")); };

// The installer ships the site in resources/site; the updater installs newer ones into <root>/5etools
const BUNDLED_SITE = () => (app.isPackaged ? path.join(process.resourcesPath, "site") : path.resolve(APP_DIR, ".."));

function findSiteRoot () {
	const candidates = [
		process.env.TOMEBINDER_SITE,
		readConfig().siteRoot,
		DIRS.site,
		BUNDLED_SITE(),
	];
	return candidates.find(isSite) || null;
}

async function askForSiteRoot () {
	for (;;) {
		const {canceled, filePaths} = await dialog.showOpenDialog({
			title: "Locate a 5etools folder (the one containing index.html, data and js)",
			properties: ["openDirectory"],
		});
		if (canceled || !filePaths.length) return null;
		const pick = [filePaths[0], path.join(filePaths[0], "5etools")].find(isSite);
		if (pick) return pick;
		await dialog.showMessageBox({type: "warning", message: "That folder does not look like a 5etools site.", detail: "Pick the folder that contains index.html and the data and js folders."});
	}
}
let SITE_ROOT = null;

/** Image folders the wiki's /img/ requests are served from (the user's images folder first). */
const imageDirs = () => [DIRS.images, path.join(DIRS.images, "img"), SITE_ROOT ? path.join(SITE_ROOT, "img") : null].filter(Boolean);

const IMAGES_README = `IMAGES FOR THE 5ETOOLS WIKI
===========================

Put the 5etools artwork here and the wiki inside Beldora CB shows it automatically
(no restart needed for new pages you open).

Easiest: open Beldora CB > App Files > 5etools updater, choose the image categories
you want and press Download. Only what you pick is downloaded.

By hand: download the image release from
https://github.com/5etools-mirror-3/5etools-img/releases
(all the .z01 ... .z12 parts plus the .zip, in one folder) and extract the .zip
with 7-Zip. Then move the contents here so this folder looks like:

  images\\adventure\\...
  images\\bestiary\\...
  images\\book\\...
  images\\items\\...   (and so on)

An extra "img" level (images\\img\\bestiary\\...) also works.
`;

function ensureDirs () {
	[DIRS.saves, DIRS.characters, DIRS.books, DIRS.encounters, DIRS.exports, DIRS.images, DIRS.system].forEach(d => fs.mkdirSync(d, {recursive: true}));
	const readme = path.join(DIRS.images, "README - how to add images.txt");
	if (!fs.existsSync(readme)) fs.writeFileSync(readme, IMAGES_README.replace(/\n/g, "\r\n"));
}

function isWritable (dir) {
	try {
		fs.mkdirSync(dir, {recursive: true});
		const probe = path.join(dir, `.write-test-${process.pid}`);
		fs.writeFileSync(probe, "ok");
		fs.unlinkSync(probe);
		return true;
	} catch (e) { return false; }
}

/** A site update downloaded last session is swapped in before anything reads the site. */
function applyPendingSiteUpdate () {
	try {
		if (!isSite(DIRS.siteNext)) return;
		if (fs.existsSync(DIRS.site)) fs.rmSync(DIRS.site, {recursive: true, force: true});
		fs.renameSync(DIRS.siteNext, DIRS.site);
	} catch (e) { console.warn("Could not apply the 5etools update", e); }
}
// endregion

const {startServer} = require("./server");
const U = require("./updater");

// region Store: one file per character and per book, in Saves
const safeName = (s) => (String(s || "").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 60) || "Unnamed");
const shortId = (id) => String(id || "").replace(/[^a-z0-9]/gi, "").slice(0, 8) || Math.random().toString(36).slice(2, 10);
const ID_RE = /\[([a-z0-9]+)\]\.beldora\.json$/i;
const LIBRARY = () => path.join(DIRS.saves, "library.json");
const written = new Map();
let storeCache = null;

const writeJsonFile = (p, data) => { fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, JSON.stringify(data, null, "\t")); };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } };

/** Read every .json in a folder; files a friend dropped in (no [id] in the name) are adopted. */
function readFolder (dir, kind) {
	const out = [];
	if (!fs.existsSync(dir)) return out;
	for (const f of fs.readdirSync(dir)) {
		if (!/\.json$/i.test(f)) continue;
		const full = path.join(dir, f);
		const data = readJson(full);
		if (!data) continue;
		if (kind === "character" && !data.character) continue;
		if (kind === "book" && (!data.book || data.character)) continue;
		if (kind === "encounter" && !data.encounter) continue;
		out.push({file: full, data, adopted: !ID_RE.test(f)});
	}
	return out;
}

function readStore () {
	if (storeCache) return storeCache;
	const lib = readJson(LIBRARY()) || {};
	const chars = [];
	const books = [];
	const seen = new Set();
	const adopt = [];
	for (const {file, data, adopted} of readFolder(DIRS.characters, "character")) {
		const c = data.character;
		if (!c.id || seen.has(c.id)) c.id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
		seen.add(c.id);
		chars.push(c);
		if (data.book) books.push({...data.book, ownerCharId: c.id});
		if (adopted) adopt.push(file);
	}
	for (const {file, data, adopted} of readFolder(DIRS.books, "book")) {
		const b = data.book;
		if (!b.id || seen.has(b.id)) b.id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
		seen.add(b.id);
		b.ownerCharId = null;
		books.push(b);
		if (adopted) adopt.push(file);
	}
	const encounters = [];
	for (const {file, data, adopted} of readFolder(DIRS.encounters, "encounter")) {
		const e = data.encounter;
		if (!e.id || seen.has(e.id)) e.id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
		seen.add(e.id);
		encounters.push(e);
		if (adopted) adopt.push(file);
	}
	const order = (list, ids) => (ids ? [...list].sort((a, b) => ((ids.indexOf(a.id) + 1) || 1e9) - ((ids.indexOf(b.id) + 1) || 1e9)) : list);
	storeCache = {
		version: 2,
		characters: order(chars, lib.characterOrder),
		books: order(books, lib.bookOrder),
		encounters: order(encounters, lib.encounterOrder),
		settings: lib.settings || {},
	};
	// Re-save adopted files under the app's naming, then remove the originals
	if (adopt.length) {
		writeStore(storeCache);
		adopt.forEach(f => { try { if (![...written.keys()].includes(f)) fs.unlinkSync(f); } catch (e) { /* ignore */ } });
	}
	return storeCache;
}

function writeIfChanged (file, text) {
	if (written.get(file) === text && fs.existsSync(file)) return;
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, text);
	fs.renameSync(tmp, file);
	written.set(file, text);
}

function writeStore (data) {
	storeCache = data;
	ensureDirs();
	const keep = new Set();
	for (const c of data.characters || []) {
		const book = (data.books || []).find(b => b.ownerCharId === c.id) || null;
		const file = path.join(DIRS.characters, `${safeName(c.name)} [${shortId(c.id)}].beldora.json`);
		writeIfChanged(file, JSON.stringify({beldora: 1, character: c, book}, null, "\t"));
		keep.add(file);
	}
	for (const b of (data.books || []).filter(x => !x.ownerCharId)) {
		const file = path.join(DIRS.books, `${safeName(b.title)} [${shortId(b.id)}].beldora.json`);
		writeIfChanged(file, JSON.stringify({beldora: 1, book: b}, null, "\t"));
		keep.add(file);
	}
	for (const e of data.encounters || []) {
		const file = path.join(DIRS.encounters, `${safeName(e.name)} [${shortId(e.id)}].beldora.json`);
		writeIfChanged(file, JSON.stringify({beldora: 1, encounter: e}, null, "	"));
		keep.add(file);
	}
	// Files for deleted or renamed characters/books/encounters
	for (const dir of [DIRS.characters, DIRS.books, DIRS.encounters]) {
		for (const f of fs.readdirSync(dir)) {
			const full = path.join(dir, f);
			if (ID_RE.test(f) && !keep.has(full)) { try { fs.unlinkSync(full); written.delete(full); } catch (e) { /* ignore */ } }
		}
	}
	writeIfChanged(LIBRARY(), JSON.stringify({
		beldora: 1,
		characterOrder: (data.characters || []).map(c => c.id),
		bookOrder: (data.books || []).map(b => b.id),
		encounterOrder: (data.encounters || []).map(e => e.id),
		settings: data.settings || {},
	}, null, "\t"));
	return true;
}

/** First run of this version: bring characters over from the AppData stores of older versions (read only). */
function migrateOldStores () {
	if (fs.existsSync(LIBRARY())) return;
	const appData = process.env.APPDATA;
	if (!appData) return;
	const candidates = [
		path.join(appData, "Beldora Character Builder", "tomebinder-store.json"),
		path.join(appData, "Tomebinder", "tomebinder-store.json"),
	].map(p => ({p, data: readJson(p)})).filter(x => x.data && ((x.data.characters || []).length || (x.data.books || []).length));
	if (!candidates.length) return;
	candidates.sort((a, b) => ((b.data.characters || []).length + (b.data.books || []).length) - ((a.data.characters || []).length + (a.data.books || []).length));
	const best = candidates[0].data;
	writeStore({characters: best.characters || [], books: best.books || [], settings: {...(best.settings || {})}});
	storeCache = null;
}
// endregion

// region PDF export
let BASE_URL = null;
let mainWindow = null;
const pendingPrintJobs = new Map();
let printJobCounter = 0;

/** Render a print page in a hidden window, wait for it to signal readiness, then print it. */
function renderPdf (pagePath, payload, {timeoutMs = 180000} = {}) {
	return new Promise((resolve, reject) => {
		const jobId = String(++printJobCounter);
		const win = new BrowserWindow({
			show: false,
			width: 1000,
			height: 1400,
			webPreferences: {
				preload: path.join(APP_DIR, "preload.js"),
				contextIsolation: true,
				sandbox: false,
				backgroundThrottling: false,
			},
		});
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out while laying out the document."));
		}, timeoutMs);
		const cleanup = () => {
			clearTimeout(timer);
			pendingPrintJobs.delete(jobId);
			if (!win.isDestroyed()) win.destroy();
		};
		pendingPrintJobs.set(jobId, {
			payload,
			onReady: async (result) => {
				try {
					if (result && result.error) throw new Error(result.error);
					const pdf = await win.webContents.printToPDF({
						printBackground: true,
						preferCSSPageSize: true,
						margins: {marginType: "none"},
						generateDocumentOutline: true,
						generateTaggedPDF: false,
					});
					cleanup();
					resolve({pdf, info: result || {}});
				} catch (e) {
					cleanup();
					reject(e);
				}
			},
		});
		win.loadURL(`${BASE_URL}${pagePath}?job=${jobId}`);
	});
}

ipcMain.handle("print:getPayload", (evt, jobId) => {
	const job = pendingPrintJobs.get(String(jobId));
	return job ? job.payload : null;
});
ipcMain.on("print:ready", (evt, jobId, result) => {
	const job = pendingPrintJobs.get(String(jobId));
	if (job) job.onReady(result);
});

/**
 * Put two booklet pages on each landscape sheet for printing at home.
 * "saddle": pages ordered so the printed stack folds into a booklet (duplex, flip on short edge).
 * "2up": pages in reading order, two per sheet.
 */
async function imposePdf (pdfBytes, mode, pageSize) {
	const {PDFDocument} = require("pdf-lib");
	const src = await PDFDocument.load(pdfBytes);
	const out = await PDFDocument.create();
	const n = src.getPageCount();
	const {width: pw, height: ph} = src.getPage(0).getSize();
	// A5 -> A4 landscape, Half Letter -> Letter landscape (exactly two pages wide)
	const sheetW = pw * 2;
	const sheetH = ph;
	let order;
	if (mode === "saddle") {
		const total = Math.ceil(n / 4) * 4;
		order = [];
		for (let s = 0; s < total / 4; ++s) {
			order.push([total - 1 - 2 * s, 2 * s]);
			order.push([2 * s + 1, total - 2 - 2 * s]);
		}
	} else {
		order = [];
		for (let i = 0; i < n; i += 2) order.push([i, i + 1]);
	}
	const embedded = await out.embedPages(src.getPages());
	for (const [l, r] of order) {
		const sheet = out.addPage([sheetW, sheetH]);
		if (l < n) sheet.drawPage(embedded[l], {x: 0, y: 0, width: pw, height: ph});
		if (r < n) sheet.drawPage(embedded[r], {x: pw, y: 0, width: pw, height: ph});
	}
	out.setTitle(src.getTitle() || "Beldora CB");
	return Buffer.from(await out.save());
}

const EXPORT_LABELS = {book: "Booklet", cheat: "Cheat Sheet", sheet: "Character Sheet", cards: "Cards", encounter: "Encounter"};

/** Encounter cheat sheet: one PDF, no booklet involved. */
async function exportEncounter ({title, encounter}) {
	const safe = (title || "Encounter").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Encounter";
	const {canceled, filePath} = await dialog.showSaveDialog(mainWindow, {
		title: "Save encounter PDF",
		defaultPath: path.join(DIRS.exports, `${safe} - Encounter.pdf`),
		filters: [{name: "PDF", extensions: ["pdf"]}],
	});
	if (canceled || !filePath) return {canceled: true};
	const r = await renderPdf("/tb-encounter.html", encounter);
	fs.writeFileSync(filePath, r.pdf);
	return {saved: [filePath], info: r.info};
}

/**
 * kind: "book" | "cheat" | "sheet" | "cards" | "both" (booklet + cheat sheet) | "all".
 * The booklet is always laid out first so every other PDF can point at its pages.
 */
async function exportCharacterOrBook ({kind, title, book, cheat, sheet, cards, options}) {
	const safe = (title || "Beldora CB").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Beldora CB";
	const parts = kind === "all" ? ["sheet", "cards", "book", "cheat"].filter(k => (k !== "cheat" || cheat) && (k !== "sheet" || sheet) && (k !== "cards" || cards))
		: kind === "both" ? ["book", "cheat"] : [kind];
	const single = parts.length === 1;
	const {canceled, filePath} = await dialog.showSaveDialog(mainWindow, {
		title: single ? `Save ${EXPORT_LABELS[parts[0]].toLowerCase()} PDF` : "Choose a name: each PDF is saved next to it with its own suffix",
		defaultPath: path.join(DIRS.exports, `${safe}${single && parts[0] !== "book" ? ` - ${EXPORT_LABELS[parts[0]]}` : ""}.pdf`),
		filters: [{name: "PDF", extensions: ["pdf"]}],
	});
	if (canceled || !filePath) return {canceled: true};
	const base = filePath.replace(/\.pdf$/i, "");
	const pathFor = (k) => single ? filePath : `${base} - ${EXPORT_LABELS[k]}.pdf`;

	const bookRes = await renderPdf("/tb-print.html", {book, options});
	const pageMap = bookRes.info.pageMap || {};
	const saved = [];
	for (const k of parts) {
		if (k === "book") {
			fs.writeFileSync(pathFor("book"), bookRes.pdf);
			saved.push(pathFor("book"));
			if (options && ["saddle", "2up"].includes(options.imposition) && ["A5", "half-letter"].includes(options.pageSize)) {
				const printPath = pathFor("book").replace(/\.pdf$/i, "") + (options.imposition === "saddle" ? " - Print (folded booklet).pdf" : " - Print (2 per sheet).pdf");
				fs.writeFileSync(printPath, await imposePdf(bookRes.pdf, options.imposition, options.pageSize));
				saved.push(printPath);
			}
		} else if (k === "cheat") {
			const r = await renderPdf("/tb-cheat.html", {cheat, pageMap, bookTitle: book.title, options});
			fs.writeFileSync(pathFor("cheat"), r.pdf);
			saved.push(pathFor("cheat"));
		} else if (k === "sheet") {
			const r = await renderPdf("/tb-sheet.html", {sheet, pageMap, options});
			fs.writeFileSync(pathFor("sheet"), r.pdf);
			saved.push(pathFor("sheet"));
		} else if (k === "cards") {
			const r = await renderPdf("/tb-cards.html", {...cards, pageMap, options});
			fs.writeFileSync(pathFor("cards"), r.pdf);
			saved.push(pathFor("cards"));
		}
	}
	return {saved, pages: bookRes.info.pageCount};
}

ipcMain.handle("export:pdf", async (evt, args) => {
	try {
		if (args && args.kind === "encounter") return await exportEncounter(args);
		return await exportCharacterOrBook(args);
	} catch (e) {
		console.error(e);
		return {error: e.message || String(e)};
	}
});
ipcMain.handle("shell:openPath", (evt, p) => shell.openPath(p));
ipcMain.handle("shell:showItem", (evt, p) => shell.showItemInFolder(p));
// endregion

// region App updates
// The interface (the ui/ folder) updates in place from Cloudflare: no new installer for most patches.
// Changes to main.js/preload.js raise "minApp" and still need an installer.
const UPDATE_URL = process.env.BELDORA_UPDATE_URL || "https://beldora-cb.beldora-cb.workers.dev/api/updates";
const UI_UPDATES = () => path.join(DIRS.system, "ui-updates");
const UI_STATE = () => path.join(DIRS.system, "ui-update.json");
const uiVersionOf = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, "version.json"), "utf8")); } catch (e) { return {version: "0.0.0", minApp: "0.0.0"}; } };

/** The installed update when it is newer than the built-in interface and this app can run it. */
function activeUiDir () {
	const st = readJson(UI_STATE());
	if (!st || !st.dir) return UI_BUNDLED;
	const dir = path.join(UI_UPDATES(), st.dir);
	const v = uiVersionOf(dir);
	const ok = fs.existsSync(path.join(dir, "tb-app.html"))
		&& U.cmpVersion(v.version, uiVersionOf(UI_BUNDLED).version) > 0
		&& U.cmpVersion(app.getVersion(), v.minApp || "0.0.0") >= 0;
	return ok ? dir : UI_BUNDLED;
}

/**
 * Download with Chromium's network stack first (Windows proxy settings and certificate store, like the app's
 * pages), then Node's. The error names the real cause instead of a bare "fetch failed".
 */
async function getUrl (url, opts = {}) {
	const why = (e) => `${e.message || e}${e.cause ? ` (${e.cause.code || e.cause.message || e.cause})` : ""}`;
	try {
		return await net.fetch(url, opts);
	} catch (e1) {
		try {
			return await fetch(url, opts);
		} catch (e2) {
			throw new Error(`Could not reach the update server: ${why(e1)}; ${why(e2)}`);
		}
	}
}

async function fetchManifest () {
	const res = await getUrl(`${UPDATE_URL}/manifest`, {headers: {"cache-control": "no-cache"}});
	if (!res.ok) throw new Error(`The update server answered ${res.status}.`);
	return (await res.json()).desktop || null;
}

ipcMain.handle("appupdate:info", () => ({app: app.getVersion(), ui: uiVersionOf(UI_DIR).version, bundled: uiVersionOf(UI_BUNDLED).version, usingUpdate: UI_DIR !== UI_BUNDLED}));

ipcMain.handle("appupdate:check", async () => {
	try {
		const m = await fetchManifest();
		const current = uiVersionOf(UI_DIR).version;
		if (!m) return {current, latest: null, hasUpdate: false};
		const newer = U.cmpVersion(m.version, current) > 0;
		const compatible = U.cmpVersion(app.getVersion(), m.minApp || "0.0.0") >= 0;
		return {current, latest: m.version, notes: m.notes || "", size: m.size, published: m.published, hasUpdate: newer && compatible, needsInstaller: newer && !compatible};
	} catch (e) {
		return {error: e.message || String(e)};
	}
});

ipcMain.handle("appupdate:install", async () => {
	try {
		const m = await fetchManifest();
		if (!m) throw new Error("No update is published.");
		if (U.cmpVersion(app.getVersion(), m.minApp || "0.0.0") < 0) throw new Error(`Version ${m.version} needs a newer installer (app ${m.minApp} or later).`);
		const res = await getUrl(`${UPDATE_URL}/bundle/${encodeURIComponent(m.version)}`);
		if (!res.ok) throw new Error(`Download failed (${res.status}).`);
		return installBundle(m, Buffer.from(await res.arrayBuffer()));
	} catch (e) {
		return {error: e.message || String(e)};
	}
});

/** The page downloaded the update itself (when this process can't reach the server): check and install it. */
ipcMain.handle("appupdate:installBytes", async (evt, {manifest, bytes} = {}) => {
	try {
		if (!manifest || !bytes) throw new Error("Nothing to install.");
		if (U.cmpVersion(app.getVersion(), manifest.minApp || "0.0.0") < 0) throw new Error(`Version ${manifest.version} needs a newer installer (app ${manifest.minApp} or later).`);
		return installBundle(manifest, Buffer.from(bytes));
	} catch (e) {
		return {error: e.message || String(e)};
	}
});

/** Verify a downloaded bundle against its manifest checksum and unpack it into System\ui-updates. */
function installBundle (m, gz) {
	const sha = require("crypto").createHash("sha256").update(gz).digest("hex");
	if (sha !== m.sha256) throw new Error("The download is damaged (checksum mismatch). Try again.");
	const bundle = JSON.parse(zlib.gunzipSync(gz).toString("utf8"));
	if (bundle.version !== m.version || !bundle.files || !bundle.files["tb-app.html"]) throw new Error("The update bundle is incomplete.");
	const name = `${m.version}-${Date.now().toString(36)}`;
	const tmp = path.join(UI_UPDATES(), `${name}.partial`);
	fs.mkdirSync(tmp, {recursive: true});
	for (const [rel, b64] of Object.entries(bundle.files)) {
		// Only plain relative paths inside the update folder
		if (!/^[\w][\w./ -]*$/.test(rel) || rel.split("/").includes("..")) throw new Error(`Unexpected file in the update: ${rel}`);
		const out = path.join(tmp, ...rel.split("/"));
		if (!out.startsWith(tmp + path.sep)) throw new Error(`Unexpected file in the update: ${rel}`);
		fs.mkdirSync(path.dirname(out), {recursive: true});
		fs.writeFileSync(out, Buffer.from(b64, "base64"));
	}
	const final = path.join(UI_UPDATES(), name);
	fs.renameSync(tmp, final);
	writeJsonFile(UI_STATE(), {dir: name, version: m.version, installedAt: new Date().toISOString()});
	// Older downloaded versions are no longer needed (the one running now stays until restart)
	for (const d of fs.readdirSync(UI_UPDATES())) {
		const full = path.join(UI_UPDATES(), d);
		if (d !== name && full !== UI_DIR) { try { fs.rmSync(full, {recursive: true, force: true}); } catch (e) { /* in use */ } }
	}
	return {ok: true, version: m.version};
}

ipcMain.handle("appupdate:useBuiltIn", () => {
	try { fs.rmSync(UI_STATE(), {force: true}); } catch (e) { /* ignore */ }
	app.relaunch();
	app.exit(0);
});
// endregion

ipcMain.handle("site:info", () => ({siteRoot: SITE_ROOT, root: ROOT, usingBundled: SITE_ROOT === BUNDLED_SITE(), usingUpdated: SITE_ROOT === DIRS.site, custom: !!readConfig().siteRoot}));
ipcMain.handle("site:reset", () => {
	const cfg = readConfig();
	delete cfg.siteRoot;
	writeConfig(cfg);
	app.relaunch();
	app.exit(0);
});
ipcMain.handle("site:change", async () => {
	const pick = await askForSiteRoot();
	if (!pick) return null;
	writeConfig({...readConfig(), siteRoot: pick});
	app.relaunch();
	app.exit(0);
	return pick;
});
ipcMain.handle("app:relaunch", () => { app.relaunch(); app.exit(0); });

// region App Files
const folderSize = (dir, {maxFiles = 200000} = {}) => {
	let files = 0;
	let bytes = 0;
	const walk = (d) => {
		let ents;
		try { ents = fs.readdirSync(d, {withFileTypes: true}); } catch (e) { return; }
		for (const e of ents) {
			if (files > maxFiles) return;
			const full = path.join(d, e.name);
			if (e.isDirectory()) walk(full);
			else { files++; try { bytes += fs.statSync(full).size; } catch (x) { /* ignore */ } }
		}
	};
	walk(dir);
	return {files, bytes};
};

/** Which image folders are present (in images/ or images/img/). */
function imagesStatus () {
	const found = new Set();
	for (const base of [DIRS.images, path.join(DIRS.images, "img")]) {
		try {
			fs.readdirSync(base, {withFileTypes: true}).forEach(e => { if (e.isDirectory() && e.name !== "img") found.add(e.name); });
		} catch (e) { /* missing */ }
	}
	const meta = readJson(path.join(DIRS.images, ".beldora-images.json")) || {};
	return {folders: [...found].sort(), version: meta.version || null, size: folderSize(DIRS.images)};
}

const countFiles = (dir, re) => { try { return fs.readdirSync(dir).filter(f => re.test(f)).length; } catch (e) { return 0; } };

ipcMain.handle("files:info", () => ({
	root: ROOT,
	saves: DIRS.saves,
	exports: DIRS.exports,
	images: DIRS.images,
	siteRoot: SITE_ROOT,
	siteVersion: U.readSiteVersion(SITE_ROOT),
	bundledVersion: U.readSiteVersion(BUNDLED_SITE()),
	usingBundled: SITE_ROOT === BUNDLED_SITE(),
	usingUpdated: SITE_ROOT === DIRS.site,
	custom: !!readConfig().siteRoot,
	pendingSite: isSite(DIRS.siteNext) ? U.readSiteVersion(DIRS.siteNext) : null,
	savesCount: {characters: countFiles(DIRS.characters, /\.json$/i), books: countFiles(DIRS.books, /\.json$/i)},
	exportsCount: countFiles(DIRS.exports, /\.pdf$/i),
	imagesInfo: imagesStatus(),
}));
ipcMain.handle("files:open", (evt, kind) => {
	const dir = {saves: DIRS.saves, exports: DIRS.exports, images: DIRS.images, root: ROOT, site: SITE_ROOT}[kind];
	if (!dir) return false;
	fs.mkdirSync(dir, {recursive: true});
	return shell.openPath(dir);
});
// endregion

// region 5etools updater
const upd = {cancelled: false, running: false, imgIndex: null, imgRelease: null};
const sendProgress = (p) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("updater:progress", p); };
const siteAsset = (rel) => rel.assets.find(a => /^5etools-v.*\.zip$/i.test(a.name)) || rel.assets.find(a => /\.zip$/i.test(a.name));

async function imagesIndex () {
	const rel = await U.latestRelease(U.REPO_IMG);
	if (!upd.imgIndex || !upd.imgRelease || upd.imgRelease.tag !== rel.tag) {
		const src = new U.Source(U.orderParts(rel.assets).map(a => ({size: a.size, url: a.url})));
		upd.imgIndex = {src, entries: await U.readIndex(src)};
		upd.imgRelease = rel;
	}
	return upd.imgIndex;
}

ipcMain.handle("updater:check", async () => {
	const out = {site: null, images: null, errors: []};
	try {
		const rel = await U.latestRelease(U.REPO_SITE);
		const asset = siteAsset(rel);
		const current = U.readSiteVersion(SITE_ROOT);
		out.site = {current, latest: rel.version, published: rel.published, size: asset ? asset.size : 0, hasUpdate: !!asset && U.cmpVersion(rel.version, current) > 0, available: !!asset};
	} catch (e) { out.errors.push(`Text & rules: ${e.message}`); }
	try {
		const {entries} = await imagesIndex();
		const {categories, prefix} = U.imageCategories(entries);
		const st = imagesStatus();
		out.images = {
			current: st.version,
			latest: upd.imgRelease.version,
			published: upd.imgRelease.published,
			hasUpdate: !st.version || U.cmpVersion(upd.imgRelease.version, st.version) > 0,
			prefix,
			categories: categories.map(c => ({...c, present: st.folders.includes(c.name)})),
		};
	} catch (e) { out.errors.push(`Images: ${e.message}`); }
	return out;
});

ipcMain.handle("updater:cancel", () => { upd.cancelled = true; return true; });

ipcMain.handle("updater:run", async (evt, {site = false, images = [], skipExisting = true} = {}) => {
	if (upd.running) return {error: "An update is already running."};
	upd.running = true;
	upd.cancelled = false;
	const result = {site: null, images: null, needsRestart: false};
	const isCancelled = () => upd.cancelled;
	try {
		fs.mkdirSync(DIRS.updates, {recursive: true});
		if (site) {
			const rel = await U.latestRelease(U.REPO_SITE);
			const asset = siteAsset(rel);
			if (!asset) throw new Error("The latest 5etools release has no zip.");
			const zip = path.join(DIRS.updates, asset.name);
			const label = `Downloading text & rules ${rel.tag}`;
			sendProgress({stage: "site-download", label, doneBytes: 0, totalBytes: asset.size});
			await U.downloadFile(asset.url, zip, {isCancelled, onProgress: p => sendProgress({stage: "site-download", label, ...p})});
			const staging = path.join(DIRS.updates, "site-staging");
			fs.rmSync(staging, {recursive: true, force: true});
			const src = new U.Source([{size: fs.statSync(zip).size, file: zip}]);
			const entries = await U.readIndex(src);
			const prefix = U.commonPrefix(entries);
			await U.extract(src, entries, staging, {mapName: n => n.slice(prefix.length), isCancelled, onProgress: p => sendProgress({stage: "site-extract", label: "Unpacking text & rules", ...p})});
			if (isCancelled()) throw new Error("Cancelled");
			if (!isSite(staging)) throw new Error("The downloaded release does not look like a 5etools site.");
			fs.rmSync(DIRS.siteNext, {recursive: true, force: true});
			fs.renameSync(staging, DIRS.siteNext);
			fs.rmSync(zip, {force: true});
			// A custom site folder would keep overriding the update, so it is cleared
			const cfg = readConfig();
			if (cfg.siteRoot) { delete cfg.siteRoot; writeConfig(cfg); }
			result.site = {version: rel.version};
			result.needsRestart = true;
		}
		if (images && images.length) {
			const {src, entries} = await imagesIndex();
			const prefix = U.commonPrefix(entries);
			const want = new Set(images);
			const pick = entries.filter(e => want.has(U.categoryOf(e.name, prefix)));
			const label = `Downloading images ${upd.imgRelease.tag}`;
			sendProgress({stage: "images", label, doneBytes: 0, totalBytes: 1});
			const r = await U.extract(src, pick, DIRS.images, {mapName: n => n.slice(prefix.length), skipExisting, isCancelled, onProgress: p => sendProgress({stage: "images", label, ...p})});
			if (!r.cancelled) {
				const metaPath = path.join(DIRS.images, ".beldora-images.json");
				const meta = readJson(metaPath) || {};
				fs.writeFileSync(metaPath, JSON.stringify({version: upd.imgRelease.version, categories: [...new Set([...(meta.categories || []), ...images])].sort(), updated: new Date().toISOString()}, null, "\t"));
			}
			result.images = r;
		}
		if (isCancelled()) result.cancelled = true;
	} catch (e) {
		result.error = e.message || String(e);
	} finally {
		upd.running = false;
		try { fs.rmSync(path.join(DIRS.updates, "site-staging"), {recursive: true, force: true}); } catch (e) { /* ignore */ }
		sendProgress({stage: "done"});
	}
	return result;
});
// endregion

ipcMain.handle("store:read", () => readStore());
ipcMain.handle("store:write", (evt, data) => writeStore(data));
ipcMain.handle("store:exportFile", async (evt, {defaultName, data}) => {
	const {canceled, filePath} = await dialog.showSaveDialog(mainWindow, {
		defaultPath: path.join(DIRS.exports, defaultName),
		filters: [{name: "Beldora CB file", extensions: ["json"]}],
	});
	if (canceled || !filePath) return null;
	fs.writeFileSync(filePath, JSON.stringify(data, null, "\t"));
	return filePath;
});
ipcMain.handle("store:importFile", async () => {
	const {canceled, filePaths} = await dialog.showOpenDialog(mainWindow, {
		defaultPath: DIRS.exports,
		properties: ["openFile"],
		filters: [{name: "Beldora CB file", extensions: ["json"]}],
	});
	if (canceled || !filePaths.length) return null;
	return JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
});

module.exports = {renderPdf, imposePdf};

async function createWindow () {
	if (!isWritable(ROOT)) {
		await dialog.showMessageBox({
			type: "error",
			title: "Beldora Character Builder",
			message: "Beldora CB can't write to its folder.",
			detail: `It keeps characters, PDFs and images next to the program, in:\n${ROOT}\n\nReinstall it into a folder you own (for example C:\\Users\\<you>\\Beldora CB) instead of Program Files.`,
		});
		app.quit();
		return;
	}
	ensureDirs();
	applyPendingSiteUpdate();
	migrateOldStores();
	SITE_ROOT = findSiteRoot();
	if (!SITE_ROOT) {
		await dialog.showMessageBox({type: "info", title: "Beldora Character Builder", message: "No 5etools copy was found.", detail: "Choose a 5etools folder (the one containing index.html, data and js)."});
		SITE_ROOT = await askForSiteRoot();
		if (!SITE_ROOT) { app.quit(); return; }
		writeConfig({...readConfig(), siteRoot: SITE_ROOT});
	}
	UI_DIR = activeUiDir();
	const port = await startServer({siteRoot: SITE_ROOT, uiDir: UI_DIR, modulesDir: MODULES_DIR, imageDirs});
	BASE_URL = `http://127.0.0.1:${port}`;
	Menu.setApplicationMenu(null);
	mainWindow = new BrowserWindow({
		width: 1500,
		height: 950,
		minWidth: 1000,
		minHeight: 650,
		title: "Beldora Character Builder",
		backgroundColor: "#16130f",
		icon: path.join(UI_DIR, "icon.png"),
		webPreferences: {
			preload: path.join(APP_DIR, "preload.js"),
			contextIsolation: true,
			sandbox: false,
		},
	});
	// External links open in the system browser
	mainWindow.webContents.setWindowOpenHandler(({url}) => {
		if (url.startsWith(BASE_URL)) return {action: "allow"};
		shell.openExternal(url);
		return {action: "deny"};
	});
	mainWindow.webContents.on("before-input-event", (evt, input) => {
		if (input.type === "keyDown" && input.key === "F12") mainWindow.webContents.toggleDevTools();
		if (input.type === "keyDown" && input.key === "F5") mainWindow.webContents.reload();
	});
	// Make sure the last (debounced) edit reaches disk before the window goes away
	let flushed = false;
	mainWindow.on("close", (e) => {
		if (flushed) return;
		e.preventDefault();
		const done = () => {
			if (flushed) return;
			flushed = true;
			if (!mainWindow.isDestroyed()) mainWindow.close();
		};
		mainWindow.webContents.executeJavaScript("window.TBStore ? TBStore.flush() : null").then(done, done);
		setTimeout(done, 3000);
	});
	// Touchpad/touchscreen pinch would zoom the whole app; keep it at 100%
	mainWindow.webContents.on("did-finish-load", () => { mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {}); });
	mainWindow.loadURL(`${BASE_URL}/tb-app.html`);
}

async function runSelfTest (outDir) {
	ensureDirs();
	applyPendingSiteUpdate();
	SITE_ROOT = findSiteRoot();
	UI_DIR = activeUiDir();
	const port = await startServer({siteRoot: SITE_ROOT, uiDir: UI_DIR, modulesDir: MODULES_DIR, port: 47690, imageDirs});
	BASE_URL = `http://127.0.0.1:${port}`;
	const st = require("./selftest");
	if (process.env.TOMEBINDER_DICE) await st.dice({baseUrl: BASE_URL, outDir, appDir: APP_DIR});
	else if (process.env.TOMEBINDER_STORE) await st.store({baseUrl: BASE_URL, outDir, appDir: APP_DIR});
	else if (process.env.TOMEBINDER_SPELLABILITY) await st.spellability({baseUrl: BASE_URL, outDir, appDir: APP_DIR, renderPdf});
	else if (process.env.TOMEBINDER_SUBCLASSES) await st.subclasses({baseUrl: BASE_URL, outDir, appDir: APP_DIR});
	else if (process.env.TOMEBINDER_COVERAGE) await st.coverage({baseUrl: BASE_URL, outDir, appDir: APP_DIR});
	else if (process.env.TOMEBINDER_PLAY) await st.play({baseUrl: BASE_URL, outDir, appDir: APP_DIR, renderPdf});
	else if (process.env.TOMEBINDER_ENC) await st.encounters({baseUrl: BASE_URL, outDir, appDir: APP_DIR, renderPdf});
	else if (process.env.TOMEBINDER_DM) await st.dm({baseUrl: BASE_URL, outDir, appDir: APP_DIR, renderPdf});
	else if (process.env.TOMEBINDER_SMOKE) await st.smoke({baseUrl: BASE_URL, outDir, appDir: APP_DIR});
	else await st.run({baseUrl: BASE_URL, outDir, renderPdf, imposePdf, appDir: APP_DIR});
	app.quit();
}

app.whenReady().then(() => {
	if (process.env.TOMEBINDER_SELFTEST) {
		return runSelfTest(process.env.TOMEBINDER_SELFTEST).catch(e => {
			fs.mkdirSync(process.env.TOMEBINDER_SELFTEST, {recursive: true});
			fs.writeFileSync(path.join(process.env.TOMEBINDER_SELFTEST, "error.txt"), String(e && e.stack || e));
			app.exit(1);
		});
	}
	return createWindow();
});
app.on("window-all-closed", () => { if (!process.env.TOMEBINDER_SELFTEST) app.quit(); });
