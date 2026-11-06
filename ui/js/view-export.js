"use strict";

/** "Export" tab: layout options, previews and PDF export for the booklet and the cheat sheet. */
globalThis.TBViewExport = (() => {
	const {h, clear} = TBUI;

	const DEFAULTS = {
		pageSize: "A5",
		theme: "parchment",
		fontScale: "normal",
		accent: "#7a1f1a",
		cover: true,
		toc: true,
		tocItems: true,
		chapterBreak: "flow",
		imposition: "none",
		cheatPaper: "auto",
		showClipSources: true,
		cardSpells: true,
		cardPassives: true,
	};
	const ACCENTS = [["#7a1f1a", "Crimson"], ["#1f3a6b", "Royal blue"], ["#2f5a32", "Forest"], ["#5a2f6b", "Arcane purple"], ["#6b4a1f", "Bronze"], ["#222222", "Ink"]];

	const optionsOf = (book) => {
		const saved = {...(book.exportOptions || {})};
		// Options saved before v2 carried the old "new page per chapter" default; let the tighter default apply
		if (saved.v !== 2) delete saved.chapterBreak;
		return {...DEFAULTS, ...saved, v: 2};
	};

	/** Book as printed: cover defaults filled from the character. */
	const printableBook = (book, char) => {
		const b = JSON.parse(JSON.stringify(book));
		if (char) {
			const cls = (char.classes || []).map(c => `${c.subclass ? c.subclass.name + " " : ""}${c.name} ${c.level}`).join(" / ");
			const lineage = (char.choices || {})["species:lineage"]?.[0];
			const species = char.species ? TBRules.speciesLabel(lineage || char.species.name) : "";
			if (!b.title) b.title = char.name || "Unnamed Character";
			if (!b.subtitle) b.subtitle = [species, cls].filter(Boolean).join(" · ");
			if (!b.byline && char.player) b.byline = `Player: ${char.player}`;
			if (!b.portrait && char.portrait) b.portrait = char.portrait;
		}
		return b;
	};

	const pdfOptions = (opts) => ({...opts, cheatPaper: opts.cheatPaper === "auto" ? undefined : opts.cheatPaper});

	/** Lay the booklet out in an invisible iframe to learn page numbers (for the cheat sheet preview). */
	const layoutBooklet = (payload) => new Promise((resolve, reject) => {
		window.__tbPreviewPayload = payload;
		const f = h("iframe", {src: `tb-print.html?preview=1&t=${Date.now()}`, style: {position: "fixed", left: "-12000px", top: "0", width: "900px", height: "1200px", border: "0"}});
		document.body.appendChild(f);
		const started = Date.now();
		const poll = setInterval(() => {
			const r = f.contentWindow && f.contentWindow.__tbResult;
			if (r || Date.now() - started > 180000) {
				clearInterval(poll);
				f.remove();
				r ? resolve(r) : reject(new Error("Layout timed out"));
			}
		}, 250);
	});

	/** What the booklet includes for a character (used to live in the old Build tab). */
	const bookContents = (char) => {
		const S = TBBook.settingsOf(char);
		const setS = (k, v) => { char.settings = {...(char.settings || {}), [k]: v}; TBApp.charChanged(char); };
		const lvlSel = h("select", ...[["all", "All levels 1–20 (plan ahead)"], ["current", "Up to current level"], ["next1", "Current level + 1"], ["next3", "Current level + 3"]].map(([v, l]) => h("option", {value: v, selected: S.levels === v}, l)));
		lvlSel.addEventListener("change", () => setS("levels", lvlSel.value));
		const c = (k, label) => {
			const i = h("input", {type: "checkbox", checked: !!S[k]});
			i.addEventListener("change", () => setS(k, i.checked));
			return h("label.chk", {style: {display: "flex", marginBottom: "6px"}}, i, label);
		};
		return h("div.card", {style: {marginTop: "14px"}}, h("div.card-h", h("h3", "Booklet contents")), h("div.card-b",
			h("label.field", h("span", "Class features in the booklet"), lvlSel),
			c("actions", "Actions reference (Attack, Dash, Help…)"),
			c("conditions", "Conditions reference"),
			c("catalogues", "Full option catalogues (e.g. every Eldritch Invocation)"),
		));
	};

	/** Subclasses chosen ahead of time and future multiclass classes, so the booklet guides levels 1–20. */
	const planCard = (char) => {
		const body = h("div.card-b");
		const plan = () => {
			char.settings = char.settings || {};
			char.settings.plan = {subclasses: {}, classes: [], ...(char.settings.plan || {})};
			return char.settings.plan;
		};
		const save = () => { TBApp.charChanged(char); fill(); };
		const scKey = (c) => `${c.name}|${c.source}`.toLowerCase();
		const subclassSelect = async (clsRef, value, onChange) => {
			const cls = await TBData.getClass(clsRef.name, clsRef.source);
			const scs = cls ? await TBData.getSubclasses(cls) : [];
			const modern = scs.filter(s => TBData.isModern(s.source));
			const list = (modern.length ? modern : scs).sort((a, b) => a.name.localeCompare(b.name));
			const s = h("select", h("option", {value: ""}, "— not decided —"), ...list.map(sc => h("option", {value: `${sc.shortName}|${sc.source}`, selected: value && value.shortName === sc.shortName && value.source === sc.source}, `${sc.name} (${TBData.sourceShort(sc.source)})`)));
			s.addEventListener("change", () => {
				const sc = list.find(x => `${x.shortName}|${x.source}` === s.value);
				onChange(sc ? {name: sc.name, shortName: sc.shortName, source: sc.source} : null);
			});
			return s;
		};
		const fill = async () => {
			clear(body);
			const P = plan();
			for (const c of (char.classes || [])) {
				const cls = await TBData.getClass(c.name, c.source);
				const title = cls?.subclassTitle || "Subclass";
				if (c.subclass) {
					body.appendChild(h("div.field", h("span", `${c.name} ${c.level} · ${title}`), h("div.dim", `${c.subclass.name} (chosen in the builder)`)));
					continue;
				}
				body.appendChild(h("label.field", h("span", `${c.name} ${c.level} · ${title} (planned)`), await subclassSelect(c, P.subclasses[scKey(c)], sc => {
					if (sc) P.subclasses[scKey(c)] = sc; else delete P.subclasses[scKey(c)];
					save();
				})));
			}
			P.classes.forEach((pc, i) => {
				const row = h("div.row", {style: {marginBottom: "8px"}}, h("b", {style: {minWidth: "90px"}}, pc.name));
				subclassSelect(pc, pc.subclass, sc => { pc.subclass = sc; save(); }).then(sel => { sel.classList.add("grow"); row.appendChild(sel); row.appendChild(h("button.btn.ghost.small", {title: "Remove from the plan", on: {click: () => { P.classes.splice(i, 1); save(); }}}, "✕")); });
				body.appendChild(row);
			});
			const {classes} = await TBData.loadClasses();
			const taken = new Set([...(char.classes || []), ...P.classes].map(c => c.name.toLowerCase()));
			const modern = classes.filter(c => TBData.isModern(c.source) && !taken.has(c.name.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
			const add = h("select", h("option", {value: ""}, "+ Plan a multiclass…"), ...modern.map(c => h("option", {value: `${c.name}|${c.source}`}, c.name)));
			add.addEventListener("change", () => {
				const c = modern.find(x => `${x.name}|${x.source}` === add.value);
				if (c) { P.classes.push({name: c.name, source: c.source, subclass: null}); save(); }
			});
			body.appendChild(h("div.row", {style: {marginTop: "6px"}}, add));
			body.appendChild(h("p.muted", {style: {fontSize: "12.5px", margin: "8px 0 0"}}, "Planned subclasses and classes go into the booklet (all 20 levels for planned classes) and the cheat sheet, marked “planned”. They don't change the character until you pick them in the builder."));
		};
		fill();
		return h("div.card", {style: {marginTop: "14px"}}, h("div.card-h", h("h3", "Level-up plan")), body);
	};

	const render = (root, char, book) => {
		clear(root);
		const opts = optionsOf(book);
		const save = (k, v) => { book.exportOptions = {...optionsOf(book), [k]: v}; TBStore.changed("book"); };

		const sel = (k, label, choices, note) => {
			const s = h("select", ...choices.map(([v, l]) => h("option", {value: v, selected: String(opts[k]) === String(v)}, l)));
			s.addEventListener("change", () => { save(k, s.value); if (k === "pageSize") render(root, char, book); });
			return h("label.field", h("span", label), s, note ? h("span.muted", {style: {textTransform: "none", letterSpacing: 0, fontSize: "12.5px"}}, note) : null);
		};
		const chk = (k, label) => {
			const i = h("input", {type: "checkbox", checked: !!opts[k]});
			i.addEventListener("change", () => save(k, i.checked));
			return h("label.chk", {style: {display: "flex", marginBottom: "6px"}}, i, label);
		};

		const canImpose = ["A5", "half-letter"].includes(opts.pageSize) && !(window.tbNative && window.tbNative.isWeb);
		const result = h("div");
		const previewFrame = h("iframe");
		const previewTitle = h("span.grow.dim", "Preview");
		const busy = (on, msg) => {
			root.querySelectorAll("button[data-busy]").forEach(b => { b.disabled = on; });
			if (msg) previewTitle.textContent = msg;
		};

		const prepare = async () => {
			if (char) await TBApp.syncBook(char);
			const pBook = printableBook(book, char);
			const cheat = char ? await TBBook.buildCheat(char) : null;
			let sheet = null;
			let cards = null;
			if (char) {
				const A = await TBRules.analyze(char);
				sheet = TBExportData.sheetData(A);
				const o = optionsOf(book);
				cards = TBExportData.cardsData(A, {passives: o.cardPassives !== false, spells: o.cardSpells !== false});
			}
			return {pBook, cheat, sheet, cards, options: pdfOptions(optionsOf(book))};
		};

		const previewBooklet = async () => {
			busy(true, "Laying out the booklet…");
			try {
				const {pBook, options} = await prepare();
				window.__tbPreviewPayload = {book: pBook, options};
				previewFrame.src = `tb-print.html?preview=1&t=${Date.now()}`;
				const started = Date.now();
				const poll = setInterval(() => {
					const r = previewFrame.contentWindow && previewFrame.contentWindow.__tbResult;
					if (r) { clearInterval(poll); previewTitle.textContent = `Booklet preview · ${r.pageCount} pages`; busy(false); }
					else if (Date.now() - started > 180000) { clearInterval(poll); busy(false, "Preview timed out"); }
				}, 300);
			} catch (e) {
				console.error(e);
				busy(false, `Preview failed: ${e.message}`);
			}
		};

		const previewCheat = async () => {
			if (!char) return;
			busy(true, "Laying out the booklet to number the cheat sheet…");
			try {
				const {pBook, cheat, options} = await prepare();
				const layout = await layoutBooklet({book: pBook, options});
				window.__tbCheatPayload = {cheat, pageMap: layout.pageMap, bookTitle: pBook.title, options};
				previewFrame.src = `tb-cheat.html?preview=1&t=${Date.now()}`;
				previewFrame.onload = () => { previewTitle.textContent = "Cheat sheet preview"; busy(false); };
			} catch (e) {
				console.error(e);
				busy(false, `Preview failed: ${e.message}`);
			}
		};

		/** Sheet and cards previews also need the booklet's page numbers. */
		const previewWithPages = async (page, globalName, makePayload, label) => {
			if (!char) return;
			busy(true, `Laying out the booklet to number the ${label}…`);
			try {
				const prep = await prepare();
				const layout = await layoutBooklet({book: prep.pBook, options: prep.options});
				window[globalName] = makePayload(prep, layout.pageMap);
				previewFrame.src = `${page}?preview=1&t=${Date.now()}`;
				previewFrame.onload = () => { previewTitle.textContent = `${label[0].toUpperCase()}${label.slice(1)} preview`; busy(false); };
			} catch (e) {
				console.error(e);
				busy(false, `Preview failed: ${e.message}`);
			}
		};
		const previewSheet = () => previewWithPages("tb-sheet.html", "__tbSheetPayload", (p, pageMap) => ({sheet: p.sheet, pageMap, options: p.options}), "character sheet");
		const previewCards = () => previewWithPages("tb-cards.html", "__tbCardsPayload", (p, pageMap) => ({...p.cards, pageMap, options: p.options}), "cards");

		const doExport = async (kind) => {
			if (!window.tbNative) { TBUI.toast("PDF export is not available here. Use the previews.", {error: true}); return; }
			busy(true, kind === "cheat" ? "Exporting the cheat sheet…" : "Exporting…");
			clear(result);
			try {
				const {pBook, cheat, sheet, cards, options} = await prepare();
				const res = await window.tbNative.exportPdf({kind, title: pBook.title, book: pBook, cheat, sheet, cards, options});
				if (res.canceled) { busy(false, "Export canceled"); return; }
				if (res.error) throw new Error(res.error);
				result.appendChild(h("div.export-result",
					h("div", h("b", "Saved"), res.pages ? ` · booklet ${res.pages} pages` : ""),
					...res.saved.map(p => h("div.row", {style: {marginTop: "6px"}},
						h("span.grow", {style: {wordBreak: "break-all", fontSize: "13px"}}, res.printed ? `Sent to “Save as PDF”: ${p}` : p),
						window.tbNative.isWeb ? null : h("button.btn.small", {on: {click: () => window.tbNative.openPath(p)}}, "Open"),
						window.tbNative.isWeb ? null : h("button.btn.small", {on: {click: () => window.tbNative.showItem(p)}}, "Show in folder"),
					)),
				));
				busy(false, "Export finished");
			} catch (e) {
				console.error(e);
				result.appendChild(h("div.export-result.err", `Export failed: ${e.message}`));
				busy(false, "Export failed");
			}
		};

		root.appendChild(h("div.export",
			h("div.opts",
				h("div.card", h("div.card-h", h("h3", "Booklet")), h("div.card-b",
					h("div.grid2",
						sel("pageSize", "Page size", [["A5", "A5 (handbook)"], ["half-letter", "Half Letter (5.5×8.5 in)"], ["A4", "A4"], ["letter", "US Letter"]]),
						sel("fontScale", "Text size", [["small", "Small"], ["normal", "Normal"], ["large", "Large"]]),
						sel("theme", "Paper", [["parchment", "Parchment"], ["clean", "Clean white (ink-saving)"]]),
						sel("accent", "Accent color", ACCENTS),
						sel("chapterBreak", "Chapters", [["flow", "Continuous (tightest)"], ["page", "Start on a new page"], ["right", "Start on a right-hand page"]]),
						canImpose ? sel("imposition", "Printing at home", [["none", "Single pages"], ["saddle", "Folded booklet (2 per sheet, saddle-stitch order)"], ["2up", "2 per sheet, in order"]],
							"Folded: print double-sided, flip on short edge, fold in half.") : h("div"),
					),
					chk("cover", "Cover page"),
					chk("toc", "Table of contents"),
					chk("tocItems", "List every item in the contents (compact, inline)"),
					chk("showClipSources", "Show where wiki clips came from"),
				)),
				char ? h("div.card", {style: {marginTop: "14px"}}, h("div.card-h", h("h3", "Character sheet, cards & cheat sheet")), h("div.card-b",
					sel("cheatPaper", "Paper", [["auto", "Match the booklet (A4 or Letter)"], ["A4", "A4"], ["letter", "US Letter"]]),
					chk("cardSpells", "Cards for every spell"),
					chk("cardPassives", "Cards for passive features and traits too (not just actions and limited uses)"),
					h("p.muted", {style: {fontSize: "13px", margin: "4px 0 0"}}, "The sheet is filled from the builder. Cards are poker-sized, nine per page with cut guides. Every page reference points into the booklet exported with them."),
				)) : null,
				char ? planCard(char) : null,
				char ? bookContents(char) : null,
				h("div.card", {style: {marginTop: "14px"}}, h("div.card-h", h("h3", "Export")), h("div.card-b",
					char ? h("div.row", {style: {flexWrap: "wrap", marginBottom: "10px"}},
						h("button.btn.primary", {dataset: {busy: 1}, on: {click: () => doExport("all")}}, "⇩ Export everything"),
						h("span.muted", {style: {fontSize: "12.5px"}}, "Character sheet, cards, booklet and cheat sheet, saved side by side."),
					) : null,
					h("div.row", {style: {flexWrap: "wrap"}},
						char ? h("button.btn", {dataset: {busy: 1}, on: {click: previewSheet}}, "Preview sheet") : null,
						char ? h("button.btn", {dataset: {busy: 1}, on: {click: previewCards}}, "Preview cards") : null,
						h("button.btn", {dataset: {busy: 1}, on: {click: previewBooklet}}, "Preview booklet"),
						char ? h("button.btn", {dataset: {busy: 1}, on: {click: previewCheat}}, "Preview cheat sheet") : null,
					),
					h("div.row", {style: {flexWrap: "wrap", marginTop: "10px"}},
						char ? h("button.btn", {dataset: {busy: 1}, on: {click: () => doExport("sheet")}}, "Sheet PDF") : null,
						char ? h("button.btn", {dataset: {busy: 1}, on: {click: () => doExport("cards")}}, "Cards PDF") : null,
						h("button.btn", {dataset: {busy: 1}, on: {click: () => doExport("book")}}, "Booklet PDF"),
						char ? h("button.btn", {dataset: {busy: 1}, on: {click: () => doExport("cheat")}}, "Cheat sheet PDF") : null,
					),
					result,
				)),
			),
			h("div.preview-box", h("div.bar", previewTitle), previewFrame),
		));
	};

	return {render, printableBook, optionsOf, pdfOptions};
})();
