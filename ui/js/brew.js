"use strict";

/**
 * 5etools homebrew inside Beldora CB.
 *
 * The site's own homebrew engine (BrewUtil2, utils-brew.js) stores what the user adds in the browser's storage for
 * this origin (desktop: the System profile in the install folder). This module
 * - gives the data loaders the processed homebrew of each kind (TBBrew.get / races / items), flagged `_tbBrew`;
 * - shows the Homebrew Manager (Settings): what's installed, the public repository, local files, and an analysis
 *   of what Beldora CB can use from each file (Build, Play, Store);
 * - reloads the app after a change, since every loader caches its lists.
 *
 * Everything degrades to "no homebrew" when the engine is missing or a file fails.
 */
globalThis.TBBrew = (() => {
	const lc = (s) => String(s ?? "").toLowerCase();
	const engine = () => (typeof BrewUtil2 !== "undefined" ? BrewUtil2 : null);
	const flag = (arr) => (arr || []).filter(e => e && e.name).map(e => { e._tbBrew = true; return e; });

	// region Data for the loaders
	const _cache = {};
	const once = (k, fn) => (_cache[k] ||= fn().catch(e => { console.warn(`Homebrew ${k}:`, e); return []; }));
	/** Is this source a homebrew source (from an installed file)? */
	const isBrew = (source) => {
		const B = engine();
		if (!B || !source) return false;
		try { return !!B.hasSourceJson(source); } catch (e) { return false; }
	};
	/** Any homebrew installed? (cheap check before loading anything) */
	const any = () => once("any", async () => {
		const B = engine();
		if (!B) return false;
		const list = await B.pGetBrew();
		return !!(list && list.length);
	});
	/** Every entity of a kind ("spell", "feat", "monster"…), with `_copy` resolved by the site's loader. */
	const get = (prop) => once(`p:${prop}`, async () => {
		if (!(await any()) || typeof DataLoader === "undefined") return [];
		await warmCopies(prop);
		return flag(await DataLoader.pCacheAndGetAllBrew(prop));
	});
	/** A `_copy` of an official entity resolves only once the site's entities of that kind are in the loader's cache. */
	const warmCopies = async (prop) => {
		try {
			const raw = ((await engine().pGetBrewProcessed()) || {})[prop] || [];
			if (raw.some(e => e && e._copy)) await DataLoader.pCacheAndGetAllSite(prop);
		} catch (e) { /* the copies stay unresolved and are skipped */ }
	};
	/** Homebrew as stored (references not expanded): classes, subclasses and their features, like the site's raw class data. */
	const raw = (prop) => once(`r:${prop}`, async () => {
		if (!(await any())) return [];
		return flag(((await engine().pGetBrewProcessed()) || {})[prop] || []);
	});
	/** Species with their subraces merged and lineages (versions) listed, like the site's list. */
	const races = () => once("races", async () => {
		if (!(await any())) return [];
		const out = [];
		// The site's loader resolves `_copy` entries (in place) first; the race helper then merges subraces
		try { await warmCopies("race"); await DataLoader.pCacheAndGetAllBrew("race"); } catch (e) { /* plain list below */ }
		let list = [];
		try { list = (await DataUtil.race.loadBrew()).race || []; } catch (e) { list = (await DataLoader.pCacheAndGetAllBrew("race")).filter(r => !r._copy); }
		list.filter(r => !r._copy).forEach(r => {
			out.push(r);
			try { DataUtil.proxy.getVersions("race", r).forEach(v => out.push(v)); } catch (e) { /* no versions */ }
		});
		return flag(out);
	});
	/** Items: base items, magic items and the variants homebrew adds (needs the site's item list first). */
	const items = () => once("items", async () => {
		if (!(await any())) return [];
		return flag(((await DataUtil.item.loadBrew()).item || []).filter(i => isBrew(i.source)));
	});
	/** Spell class lists as Beldora keys them ("wizard|xphb"). */
	const spellClassKeys = (sp) => {
		const c = sp.classes || {};
		return [...(c.fromClassList || []), ...(c.fromClassListVariant || [])].filter(x => x && x.name).map(x => `${lc(x.name)}|${lc(x.source || "PHB")}`);
	};
	// endregion

	// region Manager
	const KINDS = [
		["race", "Species", "Build"], ["subrace", "Lineages", "Build"], ["background", "Backgrounds", "Build"], ["class", "Classes", "Build"], ["subclass", "Subclasses", "Build"],
		["feat", "Feats", "Build"], ["optionalfeature", "Options (invocations, maneuvers…)", "Build"], ["spell", "Spells", "Build · Play"],
		["item", "Items", "Build · Play · Store"], ["baseitem", "Base items", "Build · Play · Store"], ["magicvariant", "Magic variants", "Store"],
		["monster", "Creatures", "Play (summons, forms) · Encounters"], ["language", "Languages", "Build"],
	];
	const USED = new Set(KINDS.map(k => k[0]).concat(["classFeature", "subclassFeature", "raceFeature", "itemProperty", "itemType", "itemMastery", "legendaryGroup"]));
	let dirty = false;

	const sourcesOf = (brew) => ((brew.body && brew.body._meta && brew.body._meta.sources) || []).map(s => s.full || s.json);
	const nameOf = (brew) => (brew.head && (brew.head.filename || brew.head.url) || "Homebrew").replace(/\.json$/i, "").replace(/^[^;]*;\s*/, "");
	const authorOf = (brew) => { const m = /^([^;]+);/.exec((brew.head && brew.head.filename) || ""); return m ? m[1] : ""; };

	/** What Beldora CB can do with one file. */
	const analyse = (brew) => {
		const body = brew.body || {};
		const rows = KINDS.filter(([k]) => Array.isArray(body[k]) && body[k].length).map(([k, label, where]) => ({k, label, where, n: body[k].length}));
		const unused = Object.keys(body).filter(k => Array.isArray(body[k]) && body[k].length && !USED.has(k) && !/Fluff$|^foundry|^_/.test(k));
		const notes = [];
		const its = [...(body.item || []), ...(body.baseitem || [])];
		const unpriced = its.filter(i => !i.value && (!i.rarity || i.rarity === "none" || i.rarity === "unknown"));
		if (unpriced.length) notes.push(`${unpriced.length} item${unpriced.length === 1 ? " has" : "s have"} no price and no rarity: the Store can't sell ${unpriced.length === 1 ? "it" : "them"} (you can still add ${unpriced.length === 1 ? "it" : "them"} to a character).`);
		const magicNoPrice = its.filter(i => !i.value && i.rarity && !["none", "unknown", "unknown (magic)", "artifact"].includes(i.rarity));
		if (magicNoPrice.length) notes.push(`${magicNoPrice.length} magic item${magicNoPrice.length === 1 ? " is" : "s are"} priced by rarity in the Store (2024 DMG values).`);
		const subcls = (body.subclass || []).filter(s => !(body.class || []).some(c => lc(c.name) === lc(s.className)));
		if (subcls.length) notes.push(`${subcls.length} subclass${subcls.length === 1 ? "" : "es"} for existing classes (${[...new Set(subcls.map(s => s.className))].slice(0, 6).join(", ")}).`);
		if ((body.spell || []).some(s => !spellClassKeys(s).length)) notes.push(`${(body.spell || []).filter(s => !spellClassKeys(s).length).length} spell(s) aren't on any class list: only feats, species or house rules can grant them.`);
		if (unused.length) notes.push(`Not used by Beldora CB (readable in the Wiki): ${unused.join(", ")}.`);
		return {rows, notes};
	};

	const fmtDate = (s) => { if (!s) return ""; try { return new Date(s * 1000).toLocaleDateString("en-US", {year: "numeric", month: "short", day: "numeric"}); } catch (e) { return ""; } };

	const open = async () => {
		const {h, clear} = TBUI;
		const B = engine();
		if (!B) { TBUI.toast("The 5etools homebrew engine isn't available here.", {error: true}); return; }
		const S = {tab: "installed", q: "", edition: "one", kind: "", repo: null, busy: false};
		const body = h("div.hb-body");
		const tabs = h("div.hb-tabs");
		const status = h("span.muted.hb-status");
		const setBusy = (msg) => { S.busy = !!msg; status.textContent = msg || (dirty ? "Changes apply when you close this window (the app reloads)." : ""); };

		const installedTab = async () => {
			const list = (await B.pGetBrew()) || [];
			const fileIn = h("input", {type: "file", accept: ".json,application/json", multiple: true, style: {display: "none"}});
			fileIn.addEventListener("change", async () => {
				const files = [];
				for (const f of fileIn.files) { try { files.push({json: JSON.parse(await f.text()), name: f.name}); } catch (e) { TBUI.toast(`${f.name} isn't a homebrew JSON file.`, {error: true}); } }
				if (!files.length) return;
				setBusy("Adding…");
				try { await B.pAddBrewsFromFiles(files); dirty = true; TBUI.toast(`Added ${files.length} file${files.length === 1 ? "" : "s"}.`); } catch (e) { TBUI.toast(`Couldn't add: ${e.message}`, {error: true}); }
				setBusy("");
				fill();
			});
			const head = h("div.hb-head",
				h("div.grow", h("b", `${list.length} homebrew file${list.length === 1 ? "" : "s"} installed`), h("div.muted", "Flagged “5etools homebrew” everywhere in Beldora CB. Shared character files need the same homebrew installed on the other device.")),
				h("button.btn.small.primary", {on: {click: () => { S.tab = "browse"; fill(); }}}, "+ Get homebrew"),
				h("button.btn.small", {title: "Load a homebrew .json file from this device", on: {click: () => fileIn.click()}}, "⇪ From file"),
				list.some(b => B.isPullable(b)) ? h("button.btn.small", {title: "Download the newest version of every file from the repository", on: {click: async () => { setBusy("Updating…"); try { const n = await B.pPullAllBrews(); dirty = true; TBUI.toast(n ? `Updated ${n} file${n === 1 ? "" : "s"}.` : "Everything is up to date."); } catch (e) { TBUI.toast(`Update failed: ${e.message}`, {error: true}); } setBusy(""); fill(); }}}, "⟳ Update all") : null,
				fileIn);
			const rows = list.map(brew => {
				const a = analyse(brew);
				const el = h("div.hb-item",
					h("div.hb-item-h",
						h("div.grow", h("b", nameOf(brew)), authorOf(brew) ? h("span.muted", ` · ${authorOf(brew)}`) : null, h("span.tag.brew", "5etools homebrew"),
							h("div.muted.hb-src", sourcesOf(brew).join(" · "))),
						h("button.btn.ghost.small", {title: "Remove this homebrew", on: {click: async () => {
							if (!(await TBUI.confirm("Remove homebrew", `Remove “${nameOf(brew)}”? Characters using its content will show it as missing until it's added again.`, {okLabel: "Remove", danger: true}))) return;
							setBusy("Removing…");
							try { await B.pDeleteBrews([brew]); dirty = true; } catch (e) { TBUI.toast(`Couldn't remove: ${e.message}`, {error: true}); }
							setBusy("");
							fill();
						}}}, "✕ Remove")),
					h("div.hb-chips", ...a.rows.map(r => h("span.hb-chip", {title: `Used in: ${r.where}`}, h("b", String(r.n)), ` ${r.label}`))),
					...a.notes.map(n => h("div.hb-note", n)),
				);
				return el;
			});
			return [head, ...(rows.length ? rows : [h("div.pick-empty", "No homebrew yet. Get some from the public 5etools homebrew repository, or load a .json file.")])];
		};

		const browseTab = async () => {
			if (!S.repo) {
				setBusy("Loading the repository index…");
				try { S.repo = await B.pGetCombinedIndexes(); } catch (e) { setBusy(""); return [h("div.pick-empty", `Couldn't reach the homebrew repository (${e.message}). Check the internet connection.`)]; }
				setBusy("");
			}
			const installed = new Set(((await B.pGetBrew()) || []).map(b => b.head && b.head.url).filter(Boolean));
			const search = h("input", {type: "search", placeholder: "Search homebrew by name or author…", value: S.q});
			const list = h("div.hb-list");
			const ed = h("select", h("option", {value: "one", selected: S.edition === "one"}, "2024 (5.5e) only"), h("option", {value: "classic", selected: S.edition === "classic"}, "2014 only"), h("option", {value: "", selected: !S.edition}, "Both editions"));
			const kind = h("select", h("option", {value: ""}, "Any content"), ...KINDS.map(([k, l]) => h("option", {value: k, selected: S.kind === k}, l)));
			const draw = () => {
				clear(list);
				const q = lc(S.q);
				const rows = S.repo.filter(r => (!S.edition || r._brewEdition === S.edition) && (!S.kind || (r.props || []).includes(S.kind)) && (!q || lc(r._brewName).includes(q) || lc(r._brewAuthor).includes(q)))
					.sort((a, b) => (b._brewAdded || 0) - (a._brewAdded || 0));
				rows.slice(0, 200).forEach(r => {
					const has = installed.has(r.urlDownload);
					const useful = (r.props || []).filter(p => KINDS.some(k => k[0] === p)).map(p => KINDS.find(k => k[0] === p)[1]);
					list.appendChild(h("div.hb-row",
						h("div.grow", h("b", r._brewName), h("span.muted", ` · ${r._brewAuthor || ""}`), r._brewEdition === "one" ? h("span.tag", "2024") : h("span.tag", "2014"),
							h("div.muted.hb-src", useful.length ? useful.join(", ") : (r._brewPropDisplayName || r.dirProp), r._brewAdded ? ` · added ${fmtDate(r._brewAdded)}` : "")),
						has ? h("span.muted", "Installed") : h("button.btn.small.primary", {on: {click: async (e) => {
							const btn = e.currentTarget;
							btn.disabled = true;
							btn.textContent = "Adding…";
							try { await B.pAddBrewFromUrl(r.urlDownload); dirty = true; installed.add(r.urlDownload); btn.replaceWith(h("span.muted", "Installed ✓")); setBusy(""); } catch (err) { btn.disabled = false; btn.textContent = "Add"; TBUI.toast(`Couldn't add: ${err.message}`, {error: true}); }
						}}}, "Add"),
					));
				});
				if (rows.length > 200) list.appendChild(h("div.pick-empty", `${rows.length - 200} more: narrow the search.`));
				if (!rows.length) list.appendChild(h("div.pick-empty", "Nothing matches."));
			};
			search.addEventListener("input", TBUI.debounce(() => { S.q = search.value; draw(); }, 150));
			ed.addEventListener("change", () => { S.edition = ed.value; draw(); });
			kind.addEventListener("change", () => { S.kind = kind.value; draw(); });
			draw();
			return [h("div.hb-head", search, ed, kind), h("div.muted", {style: {fontSize: "12.5px"}}, `The public 5etools homebrew repository: ${S.repo.length} files. Third-party content: check its license and your table's agreement before using it.`), list];
		};

		const fill = async () => {
			clear(tabs);
			[["installed", "Installed"], ["browse", "Get homebrew"]].forEach(([k, l]) => tabs.appendChild(h("button", {class: S.tab === k ? "active" : "", on: {click: () => { S.tab = k; fill(); }}}, l)));
			clear(body);
			body.appendChild(h("div.pick-empty", "Loading…"));
			const els = S.tab === "browse" ? await browseTab() : await installedTab();
			clear(body);
			els.forEach(e => body.appendChild(e));
			setBusy("");
		};
		const m = TBUI.modal({
			title: "Homebrew Manager",
			className: "hb-modal",
			body: h("div.hb-wrap", tabs, body),
			footer: [status, h("div.spacer"), h("button.btn.primary", {on: {click: () => m.close()}}, "Done")],
			onClose: async () => {
				if (!dirty) return;
				// Every list (species, spells, items…) is cached: reload so the new homebrew is everywhere
				TBUI.toast("Applying homebrew…");
				try { if (TBStore.flush) await TBStore.flush(); } catch (e) { /* saved on the next change */ }
				setTimeout(() => location.reload(), 300);
			},
		});
		fill();
	};
	// endregion

	return {isBrew, any, get, raw, races, items, spellClassKeys, open, analyse};
})();
