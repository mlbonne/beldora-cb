"use strict";

/** In-app updates of Beldora CB itself (the interface), published to Cloudflare with `npm run publish:update`. */
globalThis.TBAppUpdate = (() => {
	const {h, clear} = TBUI;
	const N = () => window.tbNative;
	const available = () => !!(N() && N().appUpdateCheck);
	const st = {check: null, busy: false, installed: null, error: null};
	const URL_BASE = "https://beldora-cb.beldora-cb.workers.dev/api/updates";
	const cmp = (a, b) => {
		const pa = String(a || "0").split(".").map(Number);
		const pb = String(b || "0").split(".").map(Number);
		for (let i = 0; i < 3; ++i) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
		return 0;
	};
	const manifestHere = async () => (await (await fetch(`${URL_BASE}/manifest`, {cache: "no-store"})).json()).desktop || null;

	/** Check through the app; if it can't reach the server, ask from this page (Chromium's network). */
	const check = async () => {
		const r = await N().appUpdateCheck();
		if (!r.error) return r;
		try {
			const info = await N().appUpdateInfo();
			const m = await manifestHere();
			if (!m) return {current: info.ui, latest: null, hasUpdate: false};
			const newer = cmp(m.version, info.ui) > 0;
			const compatible = cmp(info.app, m.minApp) >= 0;
			return {current: info.ui, latest: m.version, notes: m.notes || "", hasUpdate: newer && compatible, needsInstaller: newer && !compatible, viaPage: true};
		} catch (e) {
			return r;
		}
	};

	/** Install through the app; if it can't download, this page downloads and the app checks and unpacks it. */
	const installAny = async () => {
		const r = await N().appUpdateInstall();
		if (!r.error || !N().appUpdateInstallBytes || !/reach|fetch|network/i.test(r.error)) return r;
		try {
			const m = await manifestHere();
			const res = await fetch(`${URL_BASE}/bundle/${encodeURIComponent(m.version)}`);
			if (!res.ok) throw new Error(`Download failed (${res.status}).`);
			return await N().appUpdateInstallBytes({manifest: m, bytes: new Uint8Array(await res.arrayBuffer())});
		} catch (e) {
			return {error: `${r.error} · ${e.message || e}`};
		}
	};

	const install = async (onDone) => {
		st.busy = true;
		st.error = null;
		onDone && onDone();
		const r = await installAny();
		st.busy = false;
		if (r.error) st.error = r.error; else st.installed = r.version;
		onDone && onDone();
		if (r.ok) TBUI.toast(`Beldora CB ${r.version} is installed.`, {timeout: 20000, action: {label: "Restart now", fn: () => N().relaunch()}});
		else TBUI.toast(`Update failed: ${r.error}`, {error: true});
	};

	/** Card for App Files. */
	const card = () => {
		const el = h("div.fcard.updater");
		const fill = async () => {
			clear(el);
			const info = await N().appUpdateInfo();
			const c = st.check;
			// h() skips empty parts; DOM append() would print them as "null"
			el.appendChild(h("div",
				h("div.fcard-h", h("span.ficon", "⬆"), h("h3", "Beldora CB updates")),
				h("div.fline", h("b", "Running: "), `version ${info.ui}`, info.usingUpdate ? h("span.muted", ` (in-app update; built-in ${info.bundled})`) : h("span.muted", " (built-in)"), h("span.muted", ` · app shell ${info.app}`)),
				h("div.muted", {style: {fontSize: "13px", margin: "4px 0 10px"}}, "New versions of the interface (tabs, rules, PDFs) install here in seconds, without a new installer."),
				c && c.error ? h("div.fline.warn", `Could not check: ${c.error}`) : null,
				c && !c.error ? h("div.fline", c.hasUpdate ? [h("b", `Version ${c.latest} is available`), c.notes ? h("span", ` — ${c.notes}`) : null] : c.needsInstaller ? h("span.warn", `Version ${c.latest} needs the new installer.`) : h("span", `Up to date${c.latest ? ` (latest: ${c.latest})` : ""}.`)) : null,
				st.installed ? h("div.fline", h("b", `Version ${st.installed} is installed: restart to use it.`)) : null,
				st.error ? h("div.fline.warn", st.error) : null,
				h("div.row", {style: {flexWrap: "wrap"}},
					h("button.btn.primary", {disabled: st.busy, on: {click: async () => { st.busy = true; fill(); st.check = await check(); st.busy = false; fill(); }}}, st.busy ? "Working…" : "Check for updates"),
					c && c.hasUpdate && !st.installed ? h("button.btn.primary", {disabled: st.busy, on: {click: () => install(fill)}}, `Install ${c.latest}`) : null,
					st.installed ? h("button.btn", {on: {click: () => N().relaunch()}}, "Restart now") : null,
					info.usingUpdate ? h("button.btn.ghost", {title: "Go back to the version that came with the installer", on: {click: async () => { if (await TBUI.confirm("Use the built-in version", `Remove the in-app update and restart with the built-in version ${info.bundled}?`, {okLabel: "Restart"})) N().appUpdateUseBuiltIn(); }}}, "Use built-in version") : null,
				),
			));
		};
		fill();
		return el;
	};

	/** Quiet check a few seconds after start: a toast only when there is something to install. */
	const startupCheck = () => {
		if (!available()) return;
		setTimeout(async () => {
			const c = await check();
			st.check = c;
			if (c && c.hasUpdate) TBUI.toast(`Beldora CB ${c.latest} is available${c.notes ? `: ${c.notes}` : ""}.`, {timeout: 15000, action: {label: "Install", fn: () => install()}});
		}, 4000);
	};

	return {card, startupCheck, available, check, installAny};
})();
