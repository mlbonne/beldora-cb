"use strict";

/**
 * In-app updates for the Android app: the same bundles the desktop app installs (Cloudflare, `npm run publish:update`).
 * The bundle (gzip'd JSON of the ui/ folder) is checked against its sha256, unpacked and kept in IndexedDB; the
 * boot page (index.html) then starts that version instead of the one inside the APK. Only bundles whose
 * "minAndroid" is at most this APK's shell version are offered. Fonts, the 5etools data and libraries always
 * come from the APK. If an update fails to start twice in a row, the boot page goes back to the built-in version.
 */
globalThis.TBAndroidUpdate = (() => {
	const URL_BASE = "https://beldora-cb.beldora-cb.workers.dev/api/updates";
	const DB = "beldora-ui";
	const ACTIVE = "beldora-ui-active";
	const cmp = (a, b) => {
		const pa = String(a || "0").split(".").map(Number);
		const pb = String(b || "0").split(".").map(Number);
		for (let i = 0; i < 3; ++i) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
		return 0;
	};
	const idb = () => new Promise((resolve, reject) => {
		const r = indexedDB.open(DB, 1);
		r.onupgradeneeded = () => r.result.createObjectStore("bundles");
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
	const tx = async (mode, fn) => {
		const db = await idb();
		return new Promise((resolve, reject) => {
			const t = db.transaction("bundles", mode);
			const req = fn(t.objectStore("bundles"));
			t.oncomplete = () => resolve(req ? req.result : undefined);
			t.onerror = () => reject(t.error);
		});
	};
	const getJson = async (url) => {
		const r = await fetch(url, {cache: "no-store"});
		if (!r.ok) throw new Error(`${url.split("/").pop()}: ${r.status}`);
		return r.json();
	};
	let _local = null;
	/** The APK's shell version and its built-in interface version. */
	const local = async () => (_local ||= {
		shell: (await getJson("__tb/shell.json").catch(() => ({version: "0.0.0"}))).version,
		bundled: (await getJson("__tb/version.json").catch(() => ({version: "0.0.0"}))).version,
	});

	const info = async () => {
		const l = await local();
		const active = localStorage.getItem(ACTIVE);
		const usingUpdate = !!(active && cmp(active, l.bundled) > 0 && window.__tbBootedUpdate === active);
		return {ui: usingUpdate ? active : l.bundled, bundled: l.bundled, app: l.shell, usingUpdate};
	};
	const check = async () => {
		try {
			const i = await info();
			const m = (await getJson(`${URL_BASE}/manifest`)).desktop;
			if (!m) return {current: i.ui, latest: null, hasUpdate: false};
			const newer = cmp(m.version, i.ui) > 0;
			const compatible = !!m.minAndroid && cmp(i.app, m.minAndroid) >= 0;
			return {current: i.ui, latest: m.version, notes: m.notes || "", hasUpdate: newer && compatible, needsInstaller: newer && !compatible};
		} catch (e) {
			return {error: e.message || String(e)};
		}
	};
	const gunzip = async (bytes) => {
		const ds = new DecompressionStream("gzip");
		const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
		return out.text();
	};
	const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
	/** Download, verify, unpack and keep the latest bundle; it starts with the next launch. */
	const install = async () => {
		try {
			const i = await info();
			const m = (await getJson(`${URL_BASE}/manifest`)).desktop;
			if (!m || !m.minAndroid || cmp(i.app, m.minAndroid) < 0) return {error: "This update needs a newer version of the app (APK)."};
			const r = await fetch(`${URL_BASE}/bundle/${encodeURIComponent(m.version)}`);
			if (!r.ok) return {error: `Download failed (${r.status}).`};
			const bytes = new Uint8Array(await r.arrayBuffer());
			if (m.sha256 && (await sha256(bytes)) !== m.sha256) return {error: "The download is damaged (checksum mismatch). Try again."};
			const bundle = JSON.parse(await gunzip(bytes));
			if (!bundle.files || !bundle.files["tb-app.html"]) return {error: "The update is incomplete."};
			await tx("readwrite", s => { s.clear(); return s.put({version: m.version, files: bundle.files, at: Date.now()}, m.version); });
			localStorage.setItem(ACTIVE, m.version);
			localStorage.setItem("beldora-ui-boots", "0");
			return {ok: true, version: m.version};
		} catch (e) {
			return {error: e.message || String(e)};
		}
	};
	const useBuiltIn = async () => {
		localStorage.removeItem(ACTIVE);
		try { await tx("readwrite", s => s.clear()); } catch (e) { /* nothing stored */ }
		location.replace("index.html");
	};
	/** The interface started: the boot page's crash counter goes back to zero. */
	const started = () => { try { localStorage.setItem("beldora-ui-boots", "0"); } catch (e) { /* private mode */ } };

	// The Android app gets the same calls the desktop app's updater card uses
	if (window.tbNative && window.tbNative.platform === "android") {
		Object.assign(window.tbNative, {
			appUpdateInfo: info,
			appUpdateCheck: check,
			appUpdateInstall: install,
			appUpdateUseBuiltIn: useBuiltIn,
			relaunch: () => location.replace("index.html"),
		});
	}
	return {info, check, install, useBuiltIn, started, cmp};
})();
