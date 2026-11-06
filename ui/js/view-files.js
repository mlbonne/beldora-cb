"use strict";

/** App Files: where saves, PDFs and images live, plus the 5etools updater. */
globalThis.TBViewFiles = (() => {
	const {h, clear} = TBUI;
	const N = () => window.tbNative;
	const ui = {check: null, checking: false, selected: null, site: false, skipExisting: true, progress: null, running: false, result: null};

	// Art that matters for characters (portraits, items, spells…); the big books/adventures/bestiary are opt-in
	const RECOMMENDED = ["backgrounds", "bastions", "charcreationoptions", "classes", "conditionsdiseases", "covers", "deities", "feats", "hazards", "items", "languages", "objects", "optionalfeatures", "races", "spells", "traps", "variantrules", "vehicles", "(loose files)", "characters", "dmscreen"];
	const LABELS = {
		adventure: "Adventure art & maps", book: "Sourcebook art", bestiary: "Monster art & tokens", items: "Items", races: "Species", classes: "Classes",
		spells: "Spells", feats: "Feats", backgrounds: "Backgrounds", deities: "Deities", covers: "Book covers", decks: "Card decks", recipes: "Recipes",
		pdf: "Printable PDFs (maps, handouts)", crochetpatterns: "Crochet patterns", plutonium: "Plutonium (Foundry) art", vehicles: "Vehicles", objects: "Objects",
		hazards: "Hazards", traps: "Traps", conditionsdiseases: "Conditions", bastions: "Bastions", charcreationoptions: "Character options",
		optionalfeatures: "Optional features", variantrules: "Rules", languages: "Languages", characters: "Characters", dmscreen: "DM screen", "(loose files)": "Misc.",
	};

	const fmtBytes = (n) => {
		if (!n) return "0 MB";
		if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
		return `${Math.max(0.1, n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
	};

	let root = null;
	let unsub = null;

	const folderCard = (title, icon, dir, kind, lines, extra) => h("div.fcard",
		h("div.fcard-h", h("span.ficon", icon), h("h3", title)),
		h("div.fpath", {title: dir}, dir),
		...lines.map(l => h("div.fline", l)),
		extra || null,
		h("div.row", {style: {marginTop: "10px"}}, h("button.btn.primary", {on: {click: () => N().openFolder(kind)}}, "Open folder")),
	);

	const render = async (el) => {
		root = el || root;
		if (!root) return;
		if (!N()) { clear(root).appendChild(h("div.empty", "App Files are available in the desktop app.")); return; }
		const info = await N().filesInfo();
		if (!unsub) unsub = N().onUpdaterProgress(p => { ui.progress = p.stage === "done" ? null : p; renderProgress(); });
		clear(root);

		const img = info.imagesInfo;
		const imgLines = img.folders.length
			? [`${img.folders.length} image folders · ${img.size.files.toLocaleString()} files · ${fmtBytes(img.size.bytes)}${img.version ? ` · version ${img.version}` : ""}`, h("span.muted", img.folders.slice(0, 14).map(f => LABELS[f] || f).join(", ") + (img.folders.length > 14 ? "…" : ""))]
			: [h("span.warn", "No images yet. The wiki works without them; pictures show once they are here.")];

		const siteLine = info.custom ? `Custom folder: ${info.siteRoot}` : info.usingUpdated ? "Updated copy (installed by the updater)" : "Built-in copy (shipped with the installer)";

		root.appendChild(h("div.files",
			h("div.files-head",
				h("div.grow", h("h2", "App Files"), h("div.muted", "Everything Beldora CB keeps is inside its installation folder:"), h("div.fpath", info.root)),
				h("button.btn", {on: {click: () => N().openFolder("root")}}, "Open installation folder"),
			),
			h("div.fgrid",
				folderCard("Character saves", "📜", info.saves, "saves", [
					`${info.savesCount.characters} character file${info.savesCount.characters === 1 ? "" : "s"} · ${info.savesCount.books} book${info.savesCount.books === 1 ? "" : "s"}`,
					h("span.muted", "One .beldora.json per character in Characters\\, per book in Books\\. Copy a file to a friend; dropping one in here adds it to the app on next start."),
				]),
				folderCard("PDF exports", "📄", info.exports, "exports", [
					`${info.exportsCount} PDF${info.exportsCount === 1 ? "" : "s"}`,
					h("span.muted", "Character sheets, cards, booklets and cheat sheets are saved here by default."),
				]),
				folderCard("Images", "🖼", info.images, "images", imgLines, h("details.fhelp",
					h("summary", "How to add the 5etools images"),
					h("ol",
						h("li", "Easiest: use the 5etools updater below, tick the image categories you want and press Download. Only those are downloaded, straight into this folder."),
						h("li", "By hand: download every part of the image release (img-vX.z01 … .z12 and img-vX.zip) from github.com/5etools-mirror-3/5etools-img/releases into one folder and extract the .zip with 7-Zip."),
						h("li", "Move the extracted folders here so it contains adventure, bestiary, book, items… (an extra img folder level also works)."),
						h("li", "Open or reload a wiki page: the pictures appear. No restart needed."),
					),
				)),
			),
			TBAppUpdate.available() ? TBAppUpdate.card() : null,
			h("div.fcard.updater",
				h("div.fcard-h", h("span.ficon", "⟳"), h("h3", "5etools updater")),
				h("div.fline", h("b", "Text & rules: "), `version ${info.siteVersion || "?"} · ${siteLine}`, info.pendingSite ? h("span.warn", ` · version ${info.pendingSite} is downloaded and applies on restart`) : null),
				h("div.fline", h("b", "Images: "), img.version ? `version ${img.version}` : (img.folders.length ? "added by hand (version unknown)" : "none")),
				h("div.muted", {style: {fontSize: "13px", margin: "4px 0 10px"}}, "Checks github.com/5etools-mirror-3/5etools-src (text & rules) and github.com/5etools-mirror-3/5etools-img (images) for newer releases."),
				h("div.row",
					h("button.btn.primary", {disabled: ui.checking || ui.running, on: {click: check}}, ui.checking ? "Checking…" : (ui.check ? "Check again" : "Check for updates")),
					info.pendingSite ? h("button.btn", {on: {click: () => N().relaunch()}}, "Restart to apply") : null,
				),
				h("div#upd-body"),
			),
		));
		renderUpdater();
	};

	const check = async () => {
		ui.checking = true;
		ui.result = null;
		render();
		try {
			ui.check = await N().updaterCheck();
			const c = ui.check;
			ui.site = !!(c.site && c.site.hasUpdate);
			ui.selected = new Set();
			if (c.images) {
				// Pre-select: updates for categories already present, or the recommended set on first download
				const present = c.images.categories.filter(x => x.present).map(x => x.name);
				(present.length ? (c.images.hasUpdate ? present : []) : RECOMMENDED.filter(n => c.images.categories.some(x => x.name === n))).forEach(n => ui.selected.add(n));
			}
		} catch (e) {
			ui.check = {errors: [e.message]};
		}
		ui.checking = false;
		render();
	};

	const renderUpdater = () => {
		const body = root && root.querySelector("#upd-body");
		if (!body) return;
		clear(body);
		const c = ui.check;
		if (!c) return;
		(c.errors || []).forEach(e => body.appendChild(h("div.export-result.err", e)));

		if (c.site) {
			body.appendChild(h("div.upd-sec",
				h("label.chk", {style: {display: "flex", alignItems: "flex-start"}},
					h("input", {type: "checkbox", checked: ui.site, disabled: ui.running, on: {change: (e) => { ui.site = e.target.checked; renderUpdater(); }}}),
					h("div",
						h("b", "Text & rules (5etools-src) "),
						c.site.hasUpdate ? h("span.badge.new", `${c.site.current || "?"} → ${c.site.latest}`) : h("span.badge", `up to date (${c.site.current})`),
						h("div.muted", `${fmtBytes(c.site.size)} download · released ${new Date(c.site.published).toLocaleDateString()}${c.site.hasUpdate ? "" : " · tick to reinstall anyway"}`),
					),
				),
			));
		}

		if (c.images) {
			const cats = c.images.categories;
			const selBytes = cats.filter(x => ui.selected.has(x.name)).reduce((s, x) => s + x.bytes, 0);
			const setSel = (names) => { ui.selected = new Set(names); renderUpdater(); };
			body.appendChild(h("div.upd-sec",
				h("div", h("b", "Images (5etools-img) "), c.images.hasUpdate ? h("span.badge.new", `${c.images.current || "none"} → ${c.images.latest}`) : h("span.badge", `up to date (${c.images.current})`),
					h("span.muted", ` · released ${new Date(c.images.published).toLocaleDateString()}`)),
				h("div.row", {style: {margin: "6px 0", flexWrap: "wrap"}},
					h("span.muted", "Select:"),
					h("button.btn.small", {disabled: ui.running, on: {click: () => setSel(RECOMMENDED.filter(n => cats.some(x => x.name === n)))}}, "Recommended for players"),
					h("button.btn.small", {disabled: ui.running, on: {click: () => setSel(cats.filter(x => x.present).map(x => x.name))}}, "What I already have"),
					h("button.btn.small", {disabled: ui.running, on: {click: () => setSel(cats.map(x => x.name))}}, "Everything"),
					h("button.btn.small", {disabled: ui.running, on: {click: () => setSel([])}}, "None"),
				),
				h("div.cat-grid", ...cats.map(x => h("label.cat", {class: ui.selected.has(x.name) ? "on" : ""},
					h("input", {type: "checkbox", checked: ui.selected.has(x.name), disabled: ui.running, on: {change: (e) => { e.target.checked ? ui.selected.add(x.name) : ui.selected.delete(x.name); renderUpdater(); }}}),
					h("span.grow", LABELS[x.name] || x.name, x.present ? h("span.have", " ✓") : null),
					h("span.muted", fmtBytes(x.bytes)),
				))),
				h("label.chk", {style: {display: "flex", marginTop: "8px"}}, h("input", {type: "checkbox", checked: ui.skipExisting, disabled: ui.running, on: {change: (e) => { ui.skipExisting = e.target.checked; }}}), "Skip images I already have (only download new or changed files)"),
				h("div.muted", {style: {marginTop: "4px"}}, `Selected: ${ui.selected.size} categor${ui.selected.size === 1 ? "y" : "ies"} · up to ${fmtBytes(selBytes)}`),
			));
		}

		const nothing = !ui.site && !(ui.selected && ui.selected.size);
		body.appendChild(h("div.row", {style: {marginTop: "12px"}},
			h("button.btn.primary", {disabled: nothing || ui.running, on: {click: run}}, ui.running ? "Updating…" : "Download & update"),
			ui.running ? h("button.btn.danger", {on: {click: () => N().updaterCancel()}}, "Cancel") : null,
		));
		body.appendChild(h("div#upd-progress"));
		renderProgress();
		if (ui.result) {
			const r = ui.result;
			const lines = [];
			if (r.error) lines.push(h("div.export-result.err", `Update failed: ${r.error}`));
			if (r.cancelled) lines.push(h("div.export-result", "Update cancelled. Anything already downloaded was kept."));
			if (r.images && !r.error) lines.push(h("div.export-result", `Images: ${r.images.files.toLocaleString()} files downloaded${r.images.skipped ? `, ${r.images.skipped.toLocaleString()} already up to date` : ""}. Reload wiki pages to see them.`));
			if (r.site && !r.error) lines.push(h("div.export-result", `Text & rules ${r.site.version} downloaded. Restart Beldora CB to use it.`, h("button.btn.primary.small", {style: {marginLeft: "10px"}, on: {click: () => N().relaunch()}}, "Restart now")));
			lines.forEach(l => body.appendChild(l));
		}
	};

	const renderProgress = () => {
		const el = root && root.querySelector("#upd-progress");
		if (!el) return;
		clear(el);
		const p = ui.progress;
		if (!p || !ui.running) return;
		const pct = p.totalBytes ? Math.min(100, (p.doneBytes / p.totalBytes) * 100) : 0;
		el.appendChild(h("div.prog",
			h("div.prog-l", p.label || "Working…", h("span.muted", ` ${pct.toFixed(0)}% · ${fmtBytes(p.doneBytes || 0)} of ${fmtBytes(p.totalBytes || 0)}${p.totalFiles ? ` · ${(p.files || 0).toLocaleString()} / ${p.totalFiles.toLocaleString()} files` : ""}`)),
			h("div.prog-bar", h("div.prog-fill", {style: {width: `${pct}%`}})),
		));
	};

	const run = async () => {
		const images = [...(ui.selected || [])];
		const sizeOf = ui.check.images ? ui.check.images.categories.filter(x => ui.selected.has(x.name)).reduce((s, x) => s + x.bytes, 0) : 0;
		const msg = [ui.site ? `text & rules ${ui.check.site.latest}` : null, images.length ? `${images.length} image categor${images.length === 1 ? "y" : "ies"} (up to ${fmtBytes(sizeOf)})` : null].filter(Boolean).join(" and ");
		if (!(await TBUI.confirm("Download & update", `Download ${msg}? You can keep using the app meanwhile.${ui.site ? " Text & rules apply after a restart." : ""}`, {okLabel: "Download"}))) return;
		ui.running = true;
		ui.result = null;
		renderUpdater();
		try {
			ui.result = await N().updaterRun({site: ui.site, images, skipExisting: ui.skipExisting});
		} catch (e) {
			ui.result = {error: e.message};
		}
		ui.running = false;
		ui.progress = null;
		await render();
		if (ui.result && ui.result.needsRestart && !ui.result.error) {
			if (await TBUI.confirm("Restart Beldora CB", "The new text & rules are ready. Restart now to use them?", {okLabel: "Restart now"})) N().relaunch();
		}
	};

	return {render};
})();
