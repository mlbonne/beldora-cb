"use strict";

/**
 * "Encounters" tab: party and XP budget, monsters (search or random), balanced d8 loot, d6 extra actions,
 * and the encounter cheat sheet PDF.
 */
globalThis.TBViewEncounters = (() => {
	const {h, clear} = TBUI;
	const E = () => TBEnc;
	const S = {activeId: null, tab: "build", search: "", showFilters: false, busy: false};

	const list = () => (TBStore.get().encounters ||= []);
	const active = () => list().find(e => e.id === S.activeId) || null;
	const changed = (enc) => { enc.updatedAt = Date.now(); TBStore.changed("encounter"); };
	const esc = (s) => String(s ?? "");

	// region List
	let sideListEl = null;
	const renderSideList = () => {
		if (!sideListEl) return;
		clear(sideListEl);
		list().forEach(enc => {
			const ev = E().evaluate(enc);
			const n = (enc.creatures || []).reduce((a, c) => a + (c.ally ? 0 : c.count), 0);
			sideListEl.appendChild(h("div.char-card", {class: enc.id === S.activeId ? "active" : "", on: {click: () => { S.activeId = enc.id; render(); }}},
				h("div.n", enc.name || "Encounter"),
				h("div.s", `${ev.party.rows.map(r => `${r.count}×L${r.level}`).join(" + ")} · ${n ? `${n} foe${n === 1 ? "" : "s"} · ${ev.difficulty.label}` : "empty"}`),
			));
		});
		if (!list().length) sideListEl.appendChild(h("div.muted", {style: {padding: "10px", fontSize: "13px"}}, "No encounters yet."));
	};

	const createEncounter = () => {
		const enc = E().newEncounter();
		const last = list()[list().length - 1];
		if (last) { enc.party = JSON.parse(JSON.stringify(last.party)); enc.rules = last.rules; enc.filters = JSON.parse(JSON.stringify(last.filters || {})); }
		list().push(enc);
		S.activeId = enc.id;
		S.tab = "build";
		changed(enc);
		render();
	};

	const deleteEncounter = async (enc) => {
		const ok = await TBUI.confirm("Delete encounter", `Delete “${enc.name || "Encounter"}”? This cannot be undone.`, {okLabel: "Delete", danger: true});
		if (!ok) return;
		TBStore.get().encounters = list().filter(e => e !== enc);
		S.activeId = list()[0]?.id || null;
		TBStore.changed("encounter");
		render();
	};

	const duplicateEncounter = (enc) => {
		const copy = JSON.parse(JSON.stringify(enc));
		copy.id = E().uid();
		copy.name = `${enc.name || "Encounter"} (copy)`;
		list().push(copy);
		S.activeId = copy.id;
		TBStore.changed("encounter");
		render();
	};

	const exportFile = async (enc) => {
		const data = {beldora: 1, encounter: enc};
		const name = `${(enc.name || "encounter").replace(/[\\/:*?"<>|]+/g, "_")}.beldora.json`;
		if (window.tbNative) {
			const p = await window.tbNative.exportFile(name, data);
			if (p) TBUI.toast(`Saved ${p}`);
		}
	};

	const importFile = async () => {
		const data = window.tbNative ? await window.tbNative.importFile() : null;
		if (!data) return;
		if (!data.encounter) { TBUI.toast("That file is not a Beldora CB encounter.", {error: true}); return; }
		const enc = {...E().newEncounter(), ...data.encounter, id: E().uid()};
		list().push(enc);
		S.activeId = enc.id;
		changed(enc);
		render();
		TBUI.toast(`Imported ${enc.name || "encounter"}.`);
	};
	// endregion

	// region Helpers
	const num = (value, {min = 0, max = 99, width = "56px", onChange}) => {
		const i = h("input", {type: "number", min, max, value, style: {width}});
		i.addEventListener("change", () => onChange(Math.max(min, Math.min(max, Number(i.value) || min))));
		return i;
	};
	const select = (choices, value, onChange, attrs = {}) => {
		const s = h("select", attrs, ...choices.map(([v, l]) => h("option", {value: v, selected: String(v) === String(value)}, l)));
		s.addEventListener("change", () => onChange(s.value));
		return s;
	};
	const crLabel = (n) => n === 0.125 ? "1/8" : n === 0.25 ? "1/4" : n === 0.5 ? "1/2" : String(n);
	const CR_CHOICES = [["", "any"], ...[0, 0.125, 0.25, 0.5, ...Array.from({length: 30}, (_, i) => i + 1)].map(n => [n, crLabel(n)])];
	const xpText = (n) => Number(n || 0).toLocaleString("en-US");

	const showStatBlock = async (key) => {
		const m = await E().byKey(key);
		if (!m) return;
		const frame = TBUI.fragFrame();
		Object.assign(frame.style, {width: "640px", height: "78vh", border: "0", display: "block"});
		TBUI.modal({title: m.name, body: h("div", {style: {display: "flex"}}, frame)});
		// The 5etools CR scaler is not loaded in the app; the compact stat block only asks it whether a CR is shown
		// (its scaling buttons stay hidden with isShowScalers off)
		globalThis.ScaleCreature ||= {isCrInScaleRange: (mon) => { try { return Parser.isValidCr(mon.cr ? (mon.cr.cr || mon.cr) : null); } catch (e) { return false; } }};
		let html;
		try { html = `<table class="ve-w-100 ve-stats tb-stats">${Renderer.monster.getCompactRenderedString(m.ent, {isCompact: false, isShowScalers: false})}</table>`; } catch (e) { html = `<p>${esc(e.message)}</p>`; }
		frame.setContent(TBSan.clean(html));
	};
	// endregion

	// region Builder cards
	const partyCard = (enc, rerender) => {
		const rows = h("div");
		enc.party.forEach((r, i) => rows.appendChild(h("div.row", {style: {marginBottom: "6px"}},
			num(r.count, {min: 1, max: 12, onChange: v => { r.count = v; changed(enc); rerender(); }}),
			h("span.dim", "characters of level"),
			num(r.level, {min: 1, max: 20, onChange: v => { r.level = v; changed(enc); rerender(); }}),
			enc.party.length > 1 ? h("button.btn.ghost.small", {title: "Remove row", on: {click: () => { enc.party.splice(i, 1); changed(enc); rerender(); }}}, "✕") : null,
		)));
		return h("div.card", h("div.card-h", h("h3", "Party"), h("div.spacer"),
			h("button.btn.ghost.small", {title: "Characters of another level", on: {click: () => { enc.party.push({count: 1, level: enc.party[0]?.level || 1}); changed(enc); rerender(); }}}, "+ Mixed levels")),
		h("div.card-b",
			rows,
			h("div.grid2", {style: {marginTop: "6px"}},
				h("label.field", h("span", "Rules"), select(Object.entries(E().RULES).map(([k, r]) => [k, r.label]).reverse(), enc.rules, v => {
					enc.rules = v;
					enc.target = v === "2014" ? "medium" : "moderate";
					changed(enc);
					rerender();
				})),
				h("label.field", h("span", "Loot"), select(E().GENEROSITY.map(g => [g[0], g[1]]), enc.loot.generosity, v => { enc.loot.generosity = v; changed(enc); rerender(); })),
			),
		));
	};

	const thermometer = (ev) => {
		const top = Math.max(ev.tiers[ev.tiers.length - 1].xp * 1.25, ev.effective * 1.05, 1);
		const bar = h("div.enc-thermo");
		let prev = 0;
		ev.tiers.forEach((t, i) => {
			bar.appendChild(h("div.seg", {class: `t${i}`, style: {left: `${prev / top * 100}%`, width: `${(t.xp - prev) / top * 100}%`}}, h("span", t.label)));
			prev = t.xp;
		});
		bar.appendChild(h("div.seg.over", {style: {left: `${prev / top * 100}%`, width: `${100 - prev / top * 100}%`}}));
		bar.appendChild(h("div.fill", {style: {width: `${Math.min(100, ev.effective / top * 100)}%`}}));
		return bar;
	};

	const encounterCard = (enc, rerender) => {
		const ev = E().evaluate(enc);
		const rows = h("div.enc-roster");
		(enc.creatures || []).forEach((c, i) => {
			rows.appendChild(h("div.enc-row", {class: c.ally ? "ally" : ""},
				h("button.btn.ghost.icon", {title: c.locked ? "Locked: random keeps it" : "Lock (random keeps it)", class: c.locked ? "on" : "", on: {click: () => { c.locked = !c.locked; changed(enc); rerender(); }}}, c.locked ? "🔒" : "🔓"),
				h("div.qty",
					h("button.btn.small", {on: {click: () => { if (c.count > 1) { c.count--; changed(enc); rerender(); } }}}, "−"),
					h("b", c.count),
					h("button.btn.small", {on: {click: () => { c.count++; changed(enc); rerender(); }}}, "+"),
				),
				h("div.nm.grow", h("a", {href: "#", on: {click: (e) => { e.preventDefault(); showStatBlock(c.key); }}}, c.name), h("span.src", TBData.sourceShort(c.source)), c.role ? h("span.role", c.role) : null),
				h("span.cr", `CR ${c.cr}`),
				h("span.xp", `${xpText(c.xp * c.count)} XP`),
				h("button.btn.ghost.small", {title: c.ally ? "Ally of the party (raises the budget)" : "Make it an ally of the party", class: c.ally ? "on" : "", on: {click: () => { c.ally = !c.ally; changed(enc); rerender(); }}}, c.ally ? "Ally" : "Foe"),
				h("button.btn.ghost.small", {title: "Remove", on: {click: () => { enc.creatures.splice(i, 1); changed(enc); rerender(); }}}, "✕"),
			));
		});
		if (!enc.creatures.length) rows.appendChild(h("div.pick-empty", "No monsters yet: roll a random encounter or add some from the list."));
		const tiersLine = h("div.enc-tiers", ...ev.tiers.map(t => h("span", {class: ev.difficulty.id === t.id ? "on" : ""}, h("b", t.label), ` ${xpText(t.xp)}`)));
		const share = ev.levelShare.map(s => s.pct != null ? `L${s.level}: ${s.pct}% of a level` : `L${s.level}: max level`).join(" · ");
		return h("div.card.wide", h("div.card-h", h("h3", "Encounter"), h("div.spacer"),
			h("span.enc-diff", {class: `d-${ev.difficulty.id}`}, ev.difficulty.label),
		), h("div.card-b",
			tiersLine,
			thermometer(ev),
			h("div.enc-sum",
				h("div", h("span", "Encounter XP"), h("b", xpText(ev.enemyXp)), ev.mult !== 1 ? h("i", ` ×${ev.mult} = ${xpText(ev.effective)} adjusted`) : null),
				h("div", h("span", "XP per character"), h("b", xpText(ev.perPc)), h("i", ` ${share}`)),
				ev.allyXp ? h("div", h("span", "Allies"), h("b", `+${xpText(ev.allyXp)}`), h("i", " added to the budget")) : null,
			),
			rows,
		));
	};

	const chipSet = (values, all, labelOf, onToggle) => h("div.picker-chips", ...all.map(v => h("span.chip", {class: values.includes(v) ? "on" : "", on: {click: () => onToggle(v)}}, labelOf(v))));

	const randomCard = (enc, rerender) => {
		const f = enc.filters = {...E().DEFAULT_FILTERS, ...(enc.filters || {})};
		const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); changed(enc); rerender(); };
		const tiers = E().RULES[enc.rules === "2014" ? 2014 : 2024].tiers;
		const roll = async () => {
			if (S.busy) return;
			S.busy = true;
			try {
				const r = await E().generate(enc);
				enc.creatures = r.creatures;
				enc.shapeUsed = r.shape;
				if (!enc.nameEdited) enc.name = await E().suggestName(enc);
				await rollLoot(enc);
				enc.extras = await E().generateExtras(enc);
				changed(enc);
			} catch (e) {
				console.error(e);
				TBUI.toast(e.message, {error: true});
			} finally { S.busy = false; }
			render();
		};
		const filters = h("div.enc-filters", {style: {display: S.showFilters ? "" : "none"}},
			h("div.grid2",
				h("label.field", h("span", "CR from"), select(CR_CHOICES, f.crMin ?? "", v => { f.crMin = v === "" ? null : Number(v); changed(enc); rerender(); })),
				h("label.field", h("span", "CR up to"), select(CR_CHOICES, f.crMax ?? "", v => { f.crMax = v === "" ? null : Number(v); changed(enc); rerender(); })),
				h("label.field", h("span", "Books"), select(E().SOURCE_MODES, f.sourceMode, v => { f.sourceMode = v; changed(enc); rerender(); })),
				h("label.field", h("span", "Legendary monsters"), select([["allow", "Allowed"], ["exclude", "Excluded"], ["only", "Only legendary"]], f.legendary, v => { f.legendary = v; changed(enc); rerender(); })),
			),
			h("div.field", h("span", "Habitat"), chipSet(f.envs, E().HABITATS, TBData.titleCase, v => toggle(f.envs, v))),
			h("div.field", h("span", "Creature type"), chipSet(f.types, E().TYPES, TBData.titleCase, v => toggle(f.types, v))),
			h("div.field", h("span", "Size"), chipSet(f.sizes, E().SIZES.map(s => s[0]), v => E().SIZES.find(s => s[0] === v)[1], v => toggle(f.sizes, v))),
			h("label.chk", (() => { const i = h("input", {type: "checkbox", checked: !!f.named}); i.addEventListener("change", () => { f.named = i.checked; changed(enc); rerender(); }); return i; })(), "Include unique, named creatures"),
		);
		const nFilters = ["crMin", "crMax"].filter(k => f[k] != null).length + f.envs.length + f.types.length + f.sizes.length + (f.legendary !== "allow") + (f.sourceMode !== "dedupe") + !!f.named;
		return h("div.card", h("div.card-h", h("h3", "Random encounter")), h("div.card-b",
			h("div.grid2",
				h("label.field", h("span", "Difficulty"), select(tiers, enc.target, v => { enc.target = v; changed(enc); })),
				h("label.field", h("span", "Shape"), select([["", "Any shape"], ...Object.entries(E().SHAPES).map(([k, s]) => [k, s.label])], enc.shape || "", v => { enc.shape = v; changed(enc); })),
			),
			h("div.row", {style: {flexWrap: "wrap"}},
				h("button.btn.primary", {on: {click: roll}}, "🎲 Random encounter"),
				h("button.btn", {class: S.showFilters ? "on" : "", on: {click: () => { S.showFilters = !S.showFilters; rerender(); }}}, `Filters${nFilters ? ` (${nFilters})` : ""}`),
				h("span.muted", {style: {fontSize: "12.5px"}}, "Keeps locked monsters; rolls loot and extra actions too."),
			),
			filters,
		));
	};

	const addCard = (enc, rerender) => {
		const listEl = h("div.enc-list");
		const count = h("div.pl-count");
		const input = h("input", {type: "search", placeholder: "Search monsters (name or type)…", value: S.search});
		const fill = async () => {
			const pool = await E().filterPool(enc.filters || {}, S.search);
			clear(listEl);
			const shown = pool.slice(0, 250);
			shown.forEach(m => listEl.appendChild(h("div.pl-row",
				h("span.nm", {on: {click: () => showStatBlock(m.key)}}, m.name, h("span.src", m.srcShort)),
				h("span.info", `${TBData.titleCase(m.types[0] || "")}${m.legendary ? " · Legendary" : ""}`),
				h("span.info", {style: {width: "62px", textAlign: "right"}}, `CR ${m.crText}`),
				h("button.btn.small", {on: {click: () => {
					const have = enc.creatures.find(c => c.key === m.key && !c.ally);
					if (have) have.count++;
					else enc.creatures.push(E().creatureFrom(m));
					changed(enc);
					rerender();
				}}}, "+ Add"),
			)));
			count.textContent = `${pool.length} monster${pool.length === 1 ? "" : "s"} match the filters${pool.length > shown.length ? ` (first ${shown.length} shown)` : ""}`;
		};
		input.addEventListener("input", TBUI.debounce(() => { S.search = input.value; fill(); }, 200));
		fill();
		return h("div.card", h("div.card-h", h("h3", "Add monsters")), h("div.card-b", {style: {padding: "0"}},
			h("div", {style: {padding: "10px 12px"}}, input),
			listEl,
			count,
		));
	};

	const rollLoot = async (enc) => {
		const l = await E().generateLoot(enc);
		enc.loot = {...enc.loot, ...l};
	};

	const lootCard = (enc, rerender) => {
		const opts = enc.loot?.options || [];
		const body = h("div.card-b");
		if (!opts.length) body.appendChild(h("div.pick-empty", "Roll loot once the monsters are set."));
		opts.forEach((o, i) => body.appendChild(h("div.enc-loot",
			h("div.d", i + 1),
			h("div.grow",
				h("div.t", o.title, h("span.v", `≈ ${E().gpText(o.value)}`)),
				h("div.l", o.lines.map(l => `${l.text}${l.note ? ` (${l.note})` : ""}${l.kind === "item" && l.rarity ? ` · ${l.rarity}` : ""}`).join(" + ")),
			),
			h("button.btn.ghost.small", {title: "Reroll this option", on: {click: async () => { await E().rerollLoot(enc, i); changed(enc); rerender(); }}}, "⟳"),
		)));
		return h("div.card", h("div.card-h", h("h3", "Treasure (d8)"), h("div.spacer"),
			opts.length ? h("span.muted", {style: {fontSize: "12.5px"}}, `target ≈ ${E().gpText(enc.loot.target)}`) : null,
			h("button.btn.small", {on: {click: async () => {
				if (!enc.creatures.some(c => !c.ally)) { TBUI.toast("Add some monsters first.", {error: true}); return; }
				await rollLoot(enc);
				changed(enc);
				rerender();
			}}}, opts.length ? "⟳ Reroll all" : "Roll loot"),
		), body);
	};

	const extrasCard = (enc, rerender) => {
		const body = h("div.card-b");
		if (!enc.extras?.length) body.appendChild(h("div.pick-empty", "Roll extra actions once the monsters are set."));
		(enc.extras || []).forEach((x, i) => body.appendChild(h("div.enc-loot",
			h("div.d", i + 1),
			h("div.grow", h("div.t", x.name, h("span.v", x.use)), h("div.l", x.text)),
			h("button.btn.ghost.small", {title: "Reroll this action", on: {click: async () => { await E().rerollExtra(enc, i); changed(enc); rerender(); }}}, "⟳"),
		)));
		return h("div.card", h("div.card-h", h("h3", "Extra actions (d6)"), h("div.spacer"),
			h("button.btn.small", {on: {click: async () => {
				if (!enc.creatures.some(c => !c.ally)) { TBUI.toast("Add some monsters first.", {error: true}); return; }
				enc.extras = await E().generateExtras(enc);
				changed(enc);
				rerender();
			}}}, enc.extras?.length ? "⟳ Reroll all" : "Roll actions"),
		), body);
	};

	const notesCard = (enc) => {
		const t = h("textarea", {rows: 4, style: {width: "100%"}, placeholder: "Setup, terrain, what the monsters want… (printed on the sheet)"});
		t.value = enc.notes || "";
		t.addEventListener("input", TBUI.debounce(() => { enc.notes = t.value; changed(enc); }, 300));
		return h("div.card", h("div.card-h", h("h3", "Notes")), h("div.card-b", t));
	};

	const renderBuild = (body, enc) => {
		clear(body);
		const rerender = () => { renderBuild(body, enc); renderSideList(); };
		const scroll = body.scrollTop;
		body.appendChild(h("div.enc-build",
			h("div.enc-col",
				partyCard(enc, rerender),
				randomCard(enc, rerender),
				addCard(enc, rerender),
			),
			h("div.enc-col",
				encounterCard(enc, rerender),
				lootCard(enc, rerender),
				extrasCard(enc, rerender),
				notesCard(enc),
			),
		));
		body.scrollTop = scroll;
	};
	// endregion

	// region Export
	const renderExport = (body, enc) => {
		clear(body);
		const frame = h("iframe");
		const title = h("span.grow.dim", "Preview");
		const result = h("div");
		const set = (k, v) => { enc[k] = v; changed(enc); };
		const chk = (k, label) => {
			const i = h("input", {type: "checkbox", checked: enc[k] !== false});
			i.addEventListener("change", () => set(k, i.checked));
			return h("label.chk", {style: {display: "flex", marginBottom: "6px"}}, i, label);
		};
		const preview = async () => {
			title.textContent = "Laying out…";
			try {
				window.__tbEncounterPayload = await E().printPayload(enc);
				frame.src = `tb-encounter.html?preview=1&t=${Date.now()}`;
				frame.onload = () => { title.textContent = "Encounter sheet preview"; };
			} catch (e) {
				console.error(e);
				title.textContent = `Preview failed: ${e.message}`;
			}
		};
		const doExport = async () => {
			if (!window.tbNative) { TBUI.toast("PDF export is not available here. Use the preview.", {error: true}); return; }
			clear(result);
			title.textContent = "Exporting…";
			try {
				const payload = await E().printPayload(enc);
				const res = await window.tbNative.exportPdf({kind: "encounter", title: enc.name || "Encounter", encounter: payload});
				if (res.canceled) { title.textContent = "Export canceled"; return; }
				if (res.error) throw new Error(res.error);
				result.appendChild(h("div.export-result",
					h("b", "Saved"),
					...res.saved.map(p => h("div.row", {style: {marginTop: "6px"}},
						h("span.grow", {style: {wordBreak: "break-all", fontSize: "13px"}}, p),
						window.tbNative.isWeb ? null : h("button.btn.small", {on: {click: () => window.tbNative.openPath(p)}}, "Open"),
						window.tbNative.isWeb ? null : h("button.btn.small", {on: {click: () => window.tbNative.showItem(p)}}, "Show in folder"),
					)),
				));
				title.textContent = "Export finished";
			} catch (e) {
				console.error(e);
				result.appendChild(h("div.export-result.err", `Export failed: ${e.message}`));
				title.textContent = "Export failed";
			}
		};
		body.appendChild(h("div.export",
			h("div.opts",
				h("div.card", h("div.card-h", h("h3", "Encounter sheet")), h("div.card-b",
					h("div.grid2",
						h("label.field", h("span", "Paper"), select([["A4", "A4"], ["letter", "US Letter"]], enc.paper || "A4", v => set("paper", v))),
						h("label.field", h("span", "Accent color"), select([["#7a1f1a", "Crimson"], ["#1f3a6b", "Royal blue"], ["#2f5a32", "Forest"], ["#5a2f6b", "Arcane purple"], ["#6b4a1f", "Bronze"], ["#222222", "Ink"]], enc.accent || "#7a1f1a", v => set("accent", v))),
					),
					chk("printStatBlocks", "Stat blocks for every monster (with lair actions and regional effects)"),
					chk("printItems", "Full text of the magic items on the treasure table"),
					h("p.muted", {style: {fontSize: "13px", margin: "4px 0 0"}}, "Page 1 is the table cheat sheet: budget and XP, combatants with HP boxes, the d6 extra actions and the d8 treasure table. Stat blocks and item texts follow in two columns."),
				)),
				h("div.card", {style: {marginTop: "14px"}}, h("div.card-h", h("h3", "Export")), h("div.card-b",
					h("div.row", {style: {flexWrap: "wrap"}},
						h("button.btn.primary", {on: {click: doExport}}, "⇩ Encounter PDF"),
						h("button.btn", {on: {click: preview}}, "Preview"),
					),
					result,
				)),
			),
			h("div.preview-box", h("div.bar", title), frame),
		));
		preview();
	};
	// endregion

	const render = () => {
		const root = document.getElementById("view-encounters");
		clear(root);
		if (!S.activeId || !active()) S.activeId = list()[0]?.id || null;
		sideListEl = h("div.char-list");
		root.appendChild(h("div.char-side",
			h("div.char-side-head",
				h("button.btn.primary", {on: {click: createEncounter}}, "+ New encounter"),
				h("button.btn", {title: "Import an encounter file", on: {click: importFile}}, "Import"),
			),
			sideListEl,
		));
		renderSideList();
		const enc = active();
		if (!enc) {
			root.appendChild(h("div.char-main", h("div.empty",
				h("h2", "Build an encounter"),
				h("p", "Set the party, pick a difficulty and roll: monsters from the whole bestiary are fitted to the XP budget (DMG 2024, or 2014 if you prefer)."),
				h("p", "Each encounter comes with a d8 table of balanced treasure, a d6 table of extra monster actions and a one-page cheat sheet PDF."),
				h("button.btn.primary", {on: {click: createEncounter}}, "+ New encounter"),
			)));
			return;
		}
		// Older saves may miss newer fields
		enc.loot ||= {generosity: "standard", target: 0, options: []};
		enc.extras ||= [];
		enc.party ||= [{count: 4, level: 3}];
		enc.creatures ||= [];
		const titleIn = h("input.enc-title", {type: "text", value: enc.name || ""});
		titleIn.addEventListener("input", TBUI.debounce(() => { enc.name = titleIn.value; enc.nameEdited = true; changed(enc); renderSideList(); }, 250));
		const tabBtn = (id, label) => h("button", {class: S.tab === id ? "active" : "", on: {click: () => { S.tab = id; render(); }}}, label);
		const body = h("div.char-body");
		root.appendChild(h("div.char-main",
			h("div.char-tabs",
				titleIn,
				tabBtn("build", "Builder"),
				tabBtn("export", "Export"),
				h("div.spacer"),
				h("button.btn.ghost.small", {title: "New random name", on: {click: async () => { enc.name = await E().suggestName(enc); enc.nameEdited = false; changed(enc); render(); }}}, "🎲 Name"),
				h("button.btn.ghost.small", {on: {click: () => duplicateEncounter(enc)}}, "Duplicate"),
				h("button.btn.ghost.small", {on: {click: () => exportFile(enc)}}, "Save file"),
				h("button.btn.ghost.small.danger", {on: {click: () => deleteEncounter(enc)}}, "Delete"),
			),
			body,
		));
		if (S.tab === "export") renderExport(body, enc);
		else renderBuild(body, enc);
	};

	return {render, state: S, createEncounter};
})();
