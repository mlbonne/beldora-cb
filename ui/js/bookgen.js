"use strict";

/**
 * Turns a character into book chapters (generated items) and a cheat-sheet model.
 * Generated items carry a stable `key` so the book can be re-synced without losing the user's arrangement.
 */
globalThis.TBBook = (() => {
	const D = () => TBData;
	const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]));
	const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
	const refKey = (r) => `${D().lc(r.name)}|${D().lc(r.source)}`;


	const isCatalogue = (f) => /\bOptions$/i.test(f.name);
	const isEmptyGate = (f, hasSubclass) => hasSubclass && f.isSubclassGate && /^Subclass Feature$/i.test(f.name);

	const totalLevel = (char) => (char.classes || []).reduce((a, c) => a + (Number(c.level) || 0), 0);

	const lc = (s) => String(s ?? "").toLowerCase();
	/** {subclasses: {"class|source": {name, shortName, source}}, classes: [{name, source, subclass}]} */
	const planOf = (char) => ({subclasses: {}, classes: [], ...((char.settings || {}).plan || {})});
	const settingsOf = (char) => ({levels: "all", catalogues: false, conditions: false, actions: false, ...(char.settings || {})});
	const maxLevelFor = (S, classLevel) => {
		const l = Number(classLevel) || 1;
		switch (S.levels) {
			case "current": return l;
			case "next1": return Math.min(20, l + 1);
			case "next3": return Math.min(20, l + 3);
			default: return 20;
		}
	};

	// region Resolution
	/** Everything the character has, as decided in the builder (lineage, chosen feats, spells and options). */
	const resolveCharacter = async (char) => {
		const A = await TBRules.analyze(char);
		const d = A.derived;
		const out = {
			analysis: A,
			species: d.speciesEnt || null,
			background: d.backgroundEnt || null,
			classes: [],
			feats: d.feats.map(f => ({ent: f.ent, fromBackground: f.via === "Background"})),
			optfeatures: d.optfeatures.map(o => o.ent),
			spells: d.spells.map(s => s.ent),
			spellcasting: d.spellcasting, spellSources: d.spellSources || [],
			spellAbil: new Map(d.spells.filter(s => s.altAbility && s.cast).map(s => [refKey(s.ent), s.cast.abbr])),
		};
		// The level-up plan (Export tab): subclasses picked ahead of time and future multiclass classes
		const plan = planOf(char);
		const refs = [
			...(char.classes || []).map(c => {
				const planned = !c.subclass ? plan.subclasses[lc(`${c.name}|${c.source}`)] : null;
				return {ref: c, sc: c.subclass || planned || null, plannedSubclass: !!planned, plannedClass: false};
			}),
			...plan.classes.filter(p => !(char.classes || []).some(c => lc(c.name) === lc(p.name))).map(p => ({ref: {name: p.name, source: p.source, level: 0}, sc: p.subclass || null, plannedSubclass: !!p.subclass, plannedClass: true})),
		];
		for (const r of refs) {
			try {
				const res = await D().resolveClass(r.ref, r.sc);
				out.classes.push({ref: r.ref, ...res, plannedSubclass: r.plannedSubclass, plannedClass: r.plannedClass, core: D().getClassCore(res.cls, res.subclass), columns: D().getClassTableColumns(res.cls, res.subclass)});
			} catch (e) { console.warn(e); }
		}
		return out;
	};
	// endregion

	// region HTML builders
	const kvTable = (rows) => `<table class="tb-kv">${rows.filter(r => r[1]).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("")}</table>`;

	const overviewHtml = (char, R) => {
		const classLine = R.classes.filter(c => !c.plannedClass).map(c => `${esc(c.cls.name)} ${c.ref.level}${c.subclass ? ` <span class="tb-dim">(${esc(c.subclass.name)}${c.plannedSubclass ? ", planned" : ""})</span>` : ""}`).join(" / ")
			+ (R.classes.some(c => c.plannedClass) ? ` <span class="tb-dim">· planned multiclass: ${R.classes.filter(c => c.plannedClass).map(c => esc(c.cls.name + (c.subclass ? ` (${c.subclass.name})` : ""))).join(", ")}</span>` : "");
		const first = R.classes[0];
		const rows = [
			["Character", esc(char.name || "Unnamed")],
			["Player", esc(char.player || "")],
			["Species", R.species ? esc(R.species.name) : ""],
			["Background", R.background ? esc(R.background.name) : ""],
			["Class", classLine],
			["Total Level", R.classes.length ? String(totalLevel(char)) : ""],
			["Proficiency Bonus", R.classes.length ? `+${D().profBonus(Math.max(1, totalLevel(char)))}` : ""],
			["Spellcasting Ability", R.spellcasting ? [`${esc(R.spellcasting.abilityName)} (save DC ${R.spellcasting.dc}, spell attack ${R.spellcasting.attack >= 0 ? "+" : ""}${R.spellcasting.attack})`, ...(R.spellSources || []).map(o => `${esc(o.abilityName)} for ${esc(o.source)} spells (DC ${o.dc})`)].join("; ") : ""],
		];
		if (first) {
			rows.push(["Saving Throws", esc(first.core.saves)]);
			rows.push(["Armor Training", esc(first.core.armor)]);
			rows.push(["Weapons", esc(first.core.weapons)]);
			R.classes.slice(1).forEach(c => rows.push([`From ${c.cls.name} (${c.plannedClass ? "planned " : ""}multiclass)`, esc(c.core.multiclassGains)]));
		}
		const hp = R.classes.map((c, i) => i === 0
			? `${esc(c.cls.name)}: ${esc(c.core.hpFirst)} at 1st level; ${esc(c.core.hpLater)}`
			: `${esc(c.cls.name)}: ${esc(c.core.hpLater)}`).join("<br>");
		rows.push(["Hit Points", hp]);
		const notes = char.notes ? `<div class="tb-notes">${esc(char.notes).replace(/\n/g, "<br>")}</div>` : "";
		return `<div class="tb-overview">${kvTable(rows)}${notes}</div>`;
	};

	const classCoreHtml = (c) => {
		const k = c.core;
		return kvTable([
			["Primary Ability", esc(k.primary)],
			["Hit Point Die", `${esc(k.hd)} per ${esc(c.cls.name)} level`],
			["Hit Points at Level 1", esc(k.hpFirst)],
			["Hit Points per Level", esc(k.hpLater)],
			["Saving Throws", esc(k.saves)],
			["Skill Proficiencies", esc(k.skills)],
			["Weapon Proficiencies", esc(k.weapons)],
			["Armor Training", esc(k.armor)],
			["Tool Proficiencies", esc(k.tools)],
			["Spellcasting Ability", esc(k.spellAbility || "")],
		]);
	};

	const multiclassHtml = (c) => kvTable([
		["Prerequisite", esc(c.core.multiclassReq || `${c.core.primary} 13 or higher`)],
		["Proficiencies Gained", esc(c.core.multiclassGains || "None")],
		["Hit Points per Level", esc(c.core.hpLater)],
	]);

	/** Progression table; feature names link to their item so print can resolve page numbers. */
	const classTableHtml = (c, featureFilter) => {
		const cols = c.columns;
		const byLevel = new Map();
		c.features.filter(featureFilter).forEach(f => {
			if (!byLevel.has(f.level)) byLevel.set(f.level, []);
			byLevel.get(f.level).push(f);
		});
		const head = `<tr><th>Lvl</th><th>PB</th><th class="tb-left">Features</th>${cols.map(col => `<th>${esc(col.label)}</th>`).join("")}</tr>`;
		const body = Array.from({length: 20}, (_, i) => {
			const lvl = i + 1;
			const feats = (byLevel.get(lvl) || []).map(f => `<a class="tb-xref${f.isSubclass ? " tb-sub" : ""}" href="#k:${esc(f.key)}">${esc(f.name)}</a>`).join(", ");
			const cur = lvl === Number(c.ref.level) ? " class=\"tb-cur\"" : "";
			return `<tr${cur}><td>${lvl}</td><td>+${D().profBonus(lvl)}</td><td class="tb-left">${feats || "—"}</td>${cols.map(col => `<td>${esc(col.values[i] === "0" ? "—" : col.values[i])}</td>`).join("")}</tr>`;
		}).join("");
		const groupRow = cols.some(c2 => c2.isSlots) ? (() => {
			const nonSlots = cols.filter(c2 => !c2.isSlots).length;
			const slots = cols.filter(c2 => c2.isSlots).length;
			return `<tr class="tb-grouprow"><th colspan="${3 + nonSlots}"></th><th colspan="${slots}">Spell Slots per Spell Level</th></tr>`;
		})() : "";
		return `<table class="tb-progression${cols.length > 6 ? " tb-progression--wide" : ""}"><thead>${groupRow}${head}</thead><tbody>${body}</tbody></table>`;
	};

	// The level sits as a small badge in the feature heading (no extra line)
	const featureHtml = (f) => {
		const tpl = document.createElement("template");
		tpl.innerHTML = D().renderFeature(f);
		const hd = tpl.content.querySelector(".ve-rd__h .entry-title-inner") || tpl.content.querySelector(".ve-rd__h");
		if (hd) hd.insertAdjacentHTML("afterend", `<span class="tb-lv">${f.isSubclass ? "Subclass · " : ""}Lv ${f.level}</span>`);
		return tpl.innerHTML;
	};

	/** "Spellcasting ability: Intelligence (save DC 13, spell attack +5)" and the spells that use another ability. */
	const castingLine = (R) => {
		const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);
		const sc = R.spellcasting;
		if (!sc) return "";
		const rows = [[`Spellcasting Ability${sc.source ? ` (${sc.source})` : ""}`, `${esc(sc.abilityName)}: save DC ${sc.dc}, spell attack ${sg(sc.attack)}`],
			...(R.spellSources || []).map(o => [o.source, `${esc(o.abilityName)}: save DC ${o.dc}, spell attack ${sg(o.attack)} (${esc(o.spells.join(", "))})`])];
		return kvTable(rows);
	};
	const spellListHtml = (spells, abil = new Map()) => {
		const rows = spells.map(sp => {
			const m = D().spellMeta(sp);
			const flags = [m.conc ? "C" : "", m.ritual ? "R" : ""].filter(Boolean).join(", ");
			const ab = abil.get(refKey(sp));
			return `<tr><td class="tb-left"><a class="tb-xref" href="#k:spell:${esc(refKey(sp))}">${esc(sp.name)}</a>${ab ? ` <small>(${esc(ab)})</small>` : ""}</td><td>${m.level === 0 ? "C" : m.level}</td><td>${esc(m.school)}</td><td>${esc(m.timeShort || m.time)}</td><td>${esc(m.range)}</td><td>${flags}</td><td class="tb-pageref"><a class="tb-pref" href="#k:spell:${esc(refKey(sp))}"></a></td></tr>`;
		}).join("");
		return `<table class="tb-spelllist"><thead><tr><th class="tb-left">Spell</th><th>Lvl</th><th>School</th><th>Casting</th><th>Range</th><th>C/R</th><th>Page</th></tr></thead><tbody>${rows}</tbody></table>`;
	};
	// endregion

	// region Desired structure
	/** @return {Promise<Array<{genKey, title, items: Array<{key, title, html}>}>>} */
	const generateChapters = async (char) => {
		const R = await resolveCharacter(char);
		const S = settingsOf(char);
		const chapters = [];
		const aliases = {};
		const ch = (genKey, title) => {
			const c = {genKey, title, items: []};
			chapters.push(c);
			return c;
		};
		const item = (c, key, title, html) => c.items.push({key, title, html: TBSan.clean(html)});

		const ov = ch("overview", "The Character");
		item(ov, "overview", char.name || "Character Summary", overviewHtml(char, R));

		if (R.species) {
			const c = ch("species", `Species: ${R.species.name}`);
			item(c, `species:${refKey(R.species)}`, R.species.name, D().renderEntity("race", R.species));
		}
		if (R.background) {
			const c = ch("background", `Background: ${R.background.name}`);
			item(c, `background:${refKey(R.background)}`, R.background.name, D().renderEntity("background", R.background));
		}

		for (const c of R.classes) {
			const hasSc = !!c.subclass;
			// Planned classes are a guide to the whole class
			const maxLevel = c.plannedClass ? 20 : maxLevelFor(S, c.ref.level);
			const seen = new Map();
			const filterFeat = (f) => {
				if (f.level > maxLevel || (!S.catalogues && isCatalogue(f)) || isEmptyGate(f, hasSc)) return false;
				// Identical repeats (e.g. Ability Score Improvement) are printed once; later levels point at the first
				const sig = `${f.name}::${JSON.stringify(f.entries)}`.toLowerCase();
				if (seen.has(sig)) { aliases[f.key] = seen.get(sig); return false; }
				seen.set(sig, f.key);
				return true;
			};
			const ck = refKey(c.cls);
			const chap = ch(`class:${ck}`, `Class: ${c.cls.name}${c.plannedClass ? " (planned multiclass)" : ""}`);
			item(chap, `class-core:${ck}`, `${c.cls.name} Core Traits`, classCoreHtml(c));
			item(chap, `class-table:${ck}`, `${c.cls.name} Features`, classTableHtml(c, f => (S.catalogues || !isCatalogue(f)) && !isEmptyGate(f, hasSc)));
			if (R.classes.length > 1) item(chap, `class-mc:${ck}`, `Multiclassing: ${c.cls.name}`, multiclassHtml(c));
			c.features.filter(f => !f.isSubclass && filterFeat(f)).forEach(f => item(chap, f.key, f.name, featureHtml(f)));
			if (hasSc) {
				const sChap = ch(`subclass:${ck}`, `${c.cls.subclassTitle || "Subclass"}: ${c.subclass.name}${c.plannedSubclass ? " (planned)" : ""}`);
				c.features.filter(f => f.isSubclass && filterFeat(f)).forEach(f => item(sChap, f.key, f.name, featureHtml(f)));
			}
		}

		if (R.feats.length) {
			const c = ch("feats", "Feats");
			R.feats.forEach(({ent}) => item(c, `feat:${refKey(ent)}`, ent.name, D().renderEntity("feat", ent)));
		}

		if (R.optfeatures.length) {
			const c = ch("optfeatures", "Class Options");
			[...R.optfeatures].sort((a, b) => String(a.featureType).localeCompare(String(b.featureType)) || a.name.localeCompare(b.name))
				.forEach(of => item(c, `optfeature:${refKey(of)}`, of.name, D().renderEntity("optionalfeature", of)));
		}

		if (R.spells.length) {
			const c = ch("spells", "Spells");
			const sorted = [...R.spells].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
			item(c, "spell-list", "Spell List", castingLine(R) + spellListHtml(sorted, R.spellAbil));
			sorted.forEach(sp => item(c, `spell:${refKey(sp)}`, sp.name, D().renderEntity("spell", sp)));
		}

		if (S.conditions || S.actions) {
			const c = ch("rules", "Rules Reference");
			if (S.actions) {
				const actions = (await D().loadActions()).filter(a => a.source === "XPHB").sort((a, b) => a.name.localeCompare(b.name));
				actions.forEach(a => item(c, `action:${refKey(a)}`, a.name, D().renderEntity("action", a)));
			}
			if (S.conditions) {
				const conds = (await D().loadConditions()).filter(a => a.source === "XPHB").sort((a, b) => a.name.localeCompare(b.name));
				conds.forEach(a => item(c, `condition:${refKey(a)}`, a.name, D().renderEntity("condition", a)));
			}
		}

		return {chapters, aliases, resolved: R};
	};

	/** Merge generated content into an existing book, keeping user arrangement, clips and notes. */
	const syncBook = async (book, char) => {
		const {chapters: generated, aliases} = await generateChapters(char);
		book.aliases = aliases;
		// Pages and chapters the user removed stay out until restored
		const hidden = new Set(book.hidden || []);
		const desired = generated
			.filter(c => !hidden.has(`ch:${c.genKey}`))
			.map(c => ({...c, items: c.items.filter(i => !hidden.has(i.key))}));
		book.chapters = book.chapters || [];
		if (!book.chapters.some(c => c.genKey === "annex")) book.chapters.push({id: uid(), genKey: "annex", title: "Annex", items: []});

		const desiredKeys = new Set(desired.flatMap(c => c.items.map(i => i.key)));
		const desiredChapterKeys = new Set(desired.map(c => c.genKey));

		// Drop generated items that no longer apply
		book.chapters.forEach(c => { c.items = c.items.filter(i => i.kind !== "gen" || desiredKeys.has(i.key)); });

		const existingByKey = new Map();
		book.chapters.forEach(c => c.items.forEach(i => { if (i.kind === "gen") existingByKey.set(i.key, i); }));

		desired.forEach((dc, dIx) => {
			let chap = book.chapters.find(c => c.genKey === dc.genKey);
			if (!chap) {
				chap = {id: uid(), genKey: dc.genKey, title: dc.title, items: []};
				// Insert after the closest preceding generated chapter, else before the annex
				let pos = -1;
				for (let j = dIx - 1; j >= 0 && pos < 0; --j) pos = book.chapters.findIndex(c => c.genKey === desired[j].genKey);
				if (pos >= 0) book.chapters.splice(pos + 1, 0, chap);
				else {
					const annexIx = book.chapters.findIndex(c => c.genKey === "annex");
					book.chapters.splice(annexIx < 0 ? book.chapters.length : (dIx === 0 ? 0 : annexIx), 0, chap);
				}
			} else if (!chap.titleEdited) chap.title = dc.title;

			dc.items.forEach((di, iIx) => {
				const ex = existingByKey.get(di.key);
				if (ex) {
					ex.html = di.html;
					if (!ex.titleEdited) ex.title = di.title;
					return;
				}
				const neu = {id: uid(), kind: "gen", key: di.key, title: di.title, html: di.html};
				let pos = -1;
				for (let j = iIx - 1; j >= 0 && pos < 0; --j) pos = chap.items.findIndex(i => i.key === dc.items[j].key);
				chap.items.splice(pos + 1, 0, neu);
			});
		});

		// Remove generated chapters that are gone and hold nothing of the user's
		book.chapters = book.chapters.filter(c => !c.genKey || c.genKey === "annex" || desiredChapterKeys.has(c.genKey) || c.items.length);
		book.updatedAt = Date.now();
		return book;
	};
	// endregion

	// region Cheat sheet model
	const buildCheat = async (char) => {
		const R = await resolveCharacter(char);
		const sum = (e, n) => D().summarize(e, n);

		const classes = R.classes.map(c => {
			const hasSc = !!c.subclass;
			const feats = c.features.filter(f => !isCatalogue(f) && !isEmptyGate(f, hasSc));
			const levels = Array.from({length: 20}, (_, i) => ({
				level: i + 1,
				pb: D().profBonus(i + 1),
				features: feats.filter(f => f.level === i + 1).map(f => ({name: f.name, key: f.key, isSub: f.isSubclass})),
				cols: c.columns.map(col => col.values[i] === "0" ? "—" : col.values[i]),
			}));
			const subclassOptions = hasSc ? null : [];
			// Digest: subclass intros list their real sub-features; repeated features merge into one line
			const digest = [];
			for (const f of feats) {
				const kids = f.isSubclassIntro ? (f.entries || []).filter(e => e && typeof e === "object" && e.type === "entries" && e.name) : [];
				if (kids.length) {
					kids.forEach(k => digest.push({name: k.name, key: f.key, levels: [f.level], isSub: true, summary: sum(k.entries, 150)}));
					continue;
				}
				const prev = digest.find(d => d.name === f.name && d.isSub === f.isSubclass);
				if (prev) { prev.levels.push(f.level); continue; }
				digest.push({name: f.name, key: f.key, levels: [f.level], isSub: f.isSubclass, summary: sum(f.entries, 150)});
			}
			return {
				key: refKey(c.cls),
				name: c.cls.name,
				source: D().sourceShort(c.cls.source),
				level: c.plannedClass ? 0 : (Number(c.ref.level) || 1),
				subclass: c.subclass ? c.subclass.name : null,
				plannedSubclass: !!c.plannedSubclass,
				plannedClass: !!c.plannedClass,
				subclassTitle: c.cls.subclassTitle || "Subclass",
				core: c.core,
				coreKey: `class-core:${refKey(c.cls)}`,
				tableKey: `class-table:${refKey(c.cls)}`,
				columns: c.columns.map(col => ({label: col.label, isSlots: col.isSlots})),
				levels,
				digest,
				subclassOptions,
			};
		});
		// List subclass choices for classes without one, so the sheet still guides the level-3 decision
		for (const c of classes) {
			if (c.subclassOptions) {
				const ref = R.classes.find(x => refKey(x.cls) === c.key);
				const scs = await D().getSubclasses(ref.cls);
				const modern = scs.filter(s => D().isModern(s.source));
				c.subclassOptions = (modern.length ? modern : scs).map(s => s.name);
			}
		}

		const traitDigest = (entries) => (entries || []).filter(e => e && typeof e === "object" && e.name).map(e => ({name: e.name, summary: sum(e.entries || e.entry || [], 120)}));

		return {
			character: {
				name: char.name || "Unnamed",
				player: char.player || "",
				portrait: char.portrait || null,
				species: R.species?.name || null,
				background: R.background?.name || null,
				totalLevel: totalLevel(char),
				classLine: R.classes.filter(c => !c.plannedClass).map(c => `${c.cls.name} ${c.ref.level}`).join(" / "),
			},
			classes,
			species: R.species ? {name: R.species.name, key: `species:${refKey(R.species)}`, traits: traitDigest(R.species.entries)} : null,
			background: R.background ? {
				name: R.background.name,
				key: `background:${refKey(R.background)}`,
				traits: (() => {
					const list = (R.background.entries || []).find(e => e.type === "list");
					if (list) return list.items.filter(it => it.name).map(it => ({name: it.name.replace(/:$/, ""), summary: D().strip(typeof it.entry === "string" ? it.entry : sum(it.entries || it.entry, 120))}));
					return traitDigest(R.background.entries);
				})(),
			} : null,
			feats: R.feats.map(({ent, fromBackground}) => ({
				name: ent.name,
				key: `feat:${refKey(ent)}`,
				category: ent.category ? (Parser.featCategoryToFull ? Parser.featCategoryToFull(ent.category) : ent.category) : "",
				fromBackground,
				summary: sum(ent.entries, 160),
			})),
			optfeatures: R.optfeatures.map(of => ({
				name: of.name,
				key: `optfeature:${refKey(of)}`,
				group: (of.featureType || []).map(ft => { try { return Parser.optFeatureTypeToFull(ft); } catch (e) { return ft; } }).join(", "),
				summary: sum(of.entries, 140),
			})),
			spellcasting: R.spellcasting, spellSources: R.spellSources,
			spells: [...R.spells].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)).map(sp => ({
				name: sp.name,
				abil: R.spellAbil.get(refKey(sp)) || "",
				key: `spell:${refKey(sp)}`,
				...D().spellMeta(sp),
				summary: sum(sp.entries, 110),
			})),
		};
	};
	// endregion

	return {resolveCharacter, generateChapters, syncBook, buildCheat, uid, esc, totalLevel, settingsOf, planOf, refKey};
})();
