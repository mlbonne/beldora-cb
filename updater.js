"use strict";

/**
 * 5etools updater.
 * - Text & rules: latest release of 5etools-mirror-3/5etools-src (one zip, ~50 MB), extracted into <root>/5etools.
 * - Images: latest release of 5etools-mirror-3/5etools-img, a multi-part zip (~6.5 GB). Its index is read with
 *   HTTP range requests so only the chosen categories are downloaded, straight into <root>/images.
 * The zip reader understands split archives (.z01 … .zip) and ZIP64.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const REPO_SITE = "5etools-mirror-3/5etools-src";
const REPO_IMG = "5etools-mirror-3/5etools-img";
const UA = {"User-Agent": "Beldora-CB-updater"};

// region GitHub
async function latestRelease (repo) {
	const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {headers: {...UA, Accept: "application/vnd.github+json"}});
	if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${repo}`);
	const j = await res.json();
	return {tag: j.tag_name, version: String(j.tag_name || "").replace(/^v/, ""), published: j.published_at, assets: (j.assets || []).map(a => ({name: a.name, size: a.size, url: a.browser_download_url}))};
}

/** Order split-zip parts: name.z01, name.z02, …, name.zip (the last disk). */
function orderParts (assets) {
	const parts = assets.filter(a => /\.z\d+$/i.test(a.name)).sort((a, b) => Number(a.name.match(/\.z(\d+)$/i)[1]) - Number(b.name.match(/\.z(\d+)$/i)[1]));
	const last = assets.find(a => /\.zip$/i.test(a.name));
	if (!last) throw new Error("The release has no .zip file.");
	return [...parts, last];
}
// endregion

// region Byte sources (remote parts or local files), addressed as one concatenated stream
class Source {
	constructor (parts) {
		this.parts = parts; // [{size, url} | {size, file}]
		this.starts = [];
		let acc = 0;
		parts.forEach(p => { this.starts.push(acc); acc += p.size; });
		this.total = acc;
	}

	abs (disk, offset) { return this.starts[disk] + offset; }

	async readPart (i, start, end) {
		const p = this.parts[i];
		if (p.file) {
			const fd = await fs.promises.open(p.file, "r");
			try {
				const buf = Buffer.alloc(end - start);
				await fd.read(buf, 0, buf.length, start);
				return buf;
			} finally { await fd.close(); }
		}
		for (let attempt = 0; ; ++attempt) {
			try {
				const res = await fetch(p.url, {headers: {...UA, Range: `bytes=${start}-${end - 1}`}, redirect: "follow"});
				if (res.status !== 206 && !(res.status === 200 && start === 0 && end === p.size)) throw new Error(`Range request failed (${res.status})`);
				const buf = Buffer.from(await res.arrayBuffer());
				if (buf.length !== end - start) throw new Error("Short read from server");
				return buf;
			} catch (e) {
				if (attempt >= 3) throw e;
				await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
			}
		}
	}

	/** Read [start, end) of the virtual concatenation, crossing part boundaries as needed. */
	async read (start, end) {
		const bufs = [];
		for (let i = 0; i < this.parts.length && start < end; ++i) {
			const ps = this.starts[i];
			const pe = ps + this.parts[i].size;
			if (start >= pe) continue;
			const s = Math.max(start, ps);
			const e = Math.min(end, pe);
			bufs.push(await this.readPart(i, s - ps, e - ps));
			start = e;
		}
		return Buffer.concat(bufs);
	}
}
// endregion

// region Zip index
const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);
const u64 = (b, o) => Number(b.readBigUInt64LE(o));

async function readIndex (src) {
	const lastI = src.parts.length - 1;
	const lastSize = src.parts[lastI].size;
	const tailLen = Math.min(lastSize, 66000 + 20 + 56);
	const tail = await src.readPart(lastI, lastSize - tailLen, lastSize);
	let eocd = -1;
	for (let i = tail.length - 22; i >= 0; --i) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
	if (eocd < 0) throw new Error("Not a zip archive (no end record).");
	let cdDisk = u16(tail, eocd + 6);
	let total = u16(tail, eocd + 10);
	let cdSize = u32(tail, eocd + 12);
	let cdOff = u32(tail, eocd + 16);
	// ZIP64: locator just before the end record
	const loc = eocd - 20;
	if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
		const z64Disk = u32(tail, loc + 4);
		const z64Off = u64(tail, loc + 8);
		const rec = await src.read(src.abs(z64Disk, z64Off), src.abs(z64Disk, z64Off) + 56);
		if (u32(rec, 0) !== 0x06064b50) throw new Error("Broken ZIP64 record.");
		cdDisk = u32(rec, 20);
		total = u64(rec, 32);
		cdSize = u64(rec, 40);
		cdOff = u64(rec, 48);
	}
	const cdStart = src.abs(cdDisk, cdOff);
	const cd = await src.read(cdStart, cdStart + cdSize);
	const entries = [];
	let p = 0;
	for (let n = 0; n < total && p + 46 <= cd.length; ++n) {
		if (u32(cd, p) !== 0x02014b50) throw new Error("Broken central directory.");
		const method = u16(cd, p + 10);
		let comp = u32(cd, p + 20);
		let size = u32(cd, p + 24);
		const nameLen = u16(cd, p + 28);
		const extraLen = u16(cd, p + 30);
		const commentLen = u16(cd, p + 32);
		let disk = u16(cd, p + 34);
		let off = u32(cd, p + 42);
		const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
		let e = p + 46 + nameLen;
		const eEnd = e + extraLen;
		while (e + 4 <= eEnd) {
			const id = u16(cd, e);
			const len = u16(cd, e + 2);
			if (id === 0x0001) {
				let q = e + 4;
				if (size === 0xFFFFFFFF) { size = u64(cd, q); q += 8; }
				if (comp === 0xFFFFFFFF) { comp = u64(cd, q); q += 8; }
				if (off === 0xFFFFFFFF) { off = u64(cd, q); q += 8; }
				if (disk === 0xFFFF) { disk = u32(cd, q); }
			}
			e += 4 + len;
		}
		entries.push({name, method, comp, size, abs: src.abs(disk, off), dir: name.endsWith("/")});
		p = eEnd + commentLen;
	}
	// Each entry's bytes run up to the next entry (or the central directory)
	const sorted = [...entries].sort((a, b) => a.abs - b.abs);
	sorted.forEach((en, i) => { en.next = i + 1 < sorted.length ? sorted[i + 1].abs : cdStart; });
	return entries;
}
// endregion

// region Extraction
/**
 * Extract entries into outDir, fetching them in merged chunks.
 * @param opts.mapName (entryName) => relative output path or null to skip
 * @param opts.skipExisting skip files already present with the same size
 * @param opts.onProgress ({doneBytes, totalBytes, files, skipped})
 * @param opts.isCancelled () => bool
 */
async function extract (src, entries, outDir, {mapName = (n) => n, skipExisting = false, onProgress = () => {}, isCancelled = () => false} = {}) {
	const jobs = [];
	let skipped = 0;
	for (const en of entries) {
		if (en.dir) continue;
		const rel = mapName(en.name);
		if (!rel) continue;
		const target = path.join(outDir, rel);
		if (!path.resolve(target).startsWith(path.resolve(outDir))) continue;
		if (skipExisting) {
			try { if (fs.statSync(target).size === en.size) { skipped++; continue; } } catch (e) { /* missing */ }
		}
		jobs.push({...en, target});
	}
	jobs.sort((a, b) => a.abs - b.abs);
	const totalBytes = jobs.reduce((s, j) => s + (j.next - j.abs), 0);

	// Merge neighbouring entries into chunks of up to ~24 MB
	const chunks = [];
	let cur = null;
	for (const j of jobs) {
		if (cur && j.abs - cur.end < 256 * 1024 && j.next - cur.start < 24 * 1048576) {
			cur.items.push(j);
			cur.end = j.next;
		} else {
			cur = {start: j.abs, end: j.next, items: [j]};
			chunks.push(cur);
		}
	}

	let doneBytes = 0;
	let files = 0;
	const made = new Set();
	const work = async (chunk) => {
		if (isCancelled()) return;
		const buf = await src.read(chunk.start, chunk.end);
		for (const j of chunk.items) {
			const o = j.abs - chunk.start;
			if (u32(buf, o) !== 0x04034b50) throw new Error(`Broken entry ${j.name}`);
			const dataStart = o + 30 + u16(buf, o + 26) + u16(buf, o + 28);
			const raw = buf.subarray(dataStart, dataStart + j.comp);
			const data = j.method === 0 ? raw : j.method === 8 ? zlib.inflateRawSync(raw) : null;
			if (!data) throw new Error(`Unsupported compression in ${j.name}`);
			const dir = path.dirname(j.target);
			if (!made.has(dir)) { fs.mkdirSync(dir, {recursive: true}); made.add(dir); }
			fs.writeFileSync(j.target, data);
			files++;
			doneBytes += j.next - j.abs;
		}
		onProgress({doneBytes, totalBytes, files, skipped, totalFiles: jobs.length});
	};
	// A few chunks in flight at once
	let next = 0;
	const runners = Array.from({length: 4}, async () => {
		while (next < chunks.length && !isCancelled()) await work(chunks[next++]);
	});
	await Promise.all(runners);
	return {files, skipped, totalFiles: jobs.length, cancelled: isCancelled()};
}
// endregion

// region Helpers for the app
function readSiteVersion (siteRoot) {
	try {
		const js = fs.readFileSync(path.join(siteRoot, "js", "utils.js"), "utf8");
		const m = /VERSION_NUMBER\s*=\s*\/\*[^*]*\*\/\s*"([^"]+)"/.exec(js) || /VERSION_NUMBER\s*=\s*"([^"]+)"/.exec(js);
		return m ? m[1] : null;
	} catch (e) { return null; }
}

const cmpVersion = (a, b) => {
	const pa = String(a || "0").split(".").map(Number);
	const pb = String(b || "0").split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); ++i) {
		const d = (pa[i] || 0) - (pb[i] || 0);
		if (d) return d;
	}
	return 0;
};

/** Common leading folder ("img/") shared by every entry, to strip when extracting. */
function commonPrefix (entries) {
	const names = entries.filter(e => !e.dir).map(e => e.name);
	if (!names.length) return "";
	const first = names[0].split("/")[0] + "/";
	return names.every(n => n.startsWith(first)) ? first : "";
}

const LOOSE = "(loose files)";
const categoryOf = (name, prefix) => {
	const rel = name.slice(prefix.length);
	return rel.includes("/") ? rel.split("/")[0] : LOOSE;
};

/** Image categories (top-level folders) with sizes, for the chooser. */
function imageCategories (entries) {
	const prefix = commonPrefix(entries);
	const cats = new Map();
	for (const e of entries) {
		if (e.dir) continue;
		const top = categoryOf(e.name, prefix);
		const c = cats.get(top) || {name: top, files: 0, bytes: 0};
		c.files++;
		c.bytes += e.size;
		cats.set(top, c);
	}
	return {prefix, categories: [...cats.values()].sort((a, b) => a.name.localeCompare(b.name))};
}

async function downloadFile (url, dest, {onProgress = () => {}, isCancelled = () => false} = {}) {
	const res = await fetch(url, {headers: UA, redirect: "follow"});
	if (!res.ok) throw new Error(`Download failed (${res.status})`);
	const total = Number(res.headers.get("content-length")) || 0;
	fs.mkdirSync(path.dirname(dest), {recursive: true});
	const out = fs.createWriteStream(dest);
	let done = 0;
	const reader = res.body.getReader();
	try {
		for (;;) {
			if (isCancelled()) throw new Error("Cancelled");
			const {done: end, value} = await reader.read();
			if (end) break;
			done += value.length;
			if (!out.write(Buffer.from(value))) await new Promise(r => out.once("drain", r));
			onProgress({doneBytes: done, totalBytes: total});
		}
	} finally {
		await new Promise(r => out.end(r));
	}
	return dest;
}
// endregion

module.exports = {REPO_SITE, REPO_IMG, latestRelease, orderParts, Source, readIndex, extract, readSiteVersion, cmpVersion, commonPrefix, imageCategories, categoryOf, downloadFile};
