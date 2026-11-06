"use strict";

/**
 * Data access on top of the 5etools site data and renderer.
 * Everything here runs in a page that has loaded the site's parser/utils/render scripts.
 */
globalThis.TBData = (() => {
	const _cache = {};
	const once = (key, fn) => (_cache[key] = _cache[key] || fn());

	const lc = s => String(s ?? "").toLowerCase();
	const keyOf = (name, source) => `${lc(name)}|${lc(source)}`;

	// region Sources
	const isModern = (source) => {
		try { return !SourceUtil.isClassicSource(source); } catch (e) { return true; }
	};
	const sourceShort = (source) => {
		try { return Parser.sourceJsonToAbv(source); } catch (e) { return source; }
	};
	const sourceFull = (source) => {
		try { return Parser.sourceJsonToFull(source); } catch (e) { return source; }
	};
	// endregion

	// region Text helpers
	const strip = (s) => {
		try { return Renderer.stripTags(String(s)); } catch (e) { return String(s).replace(/\{@\w+ ([^|}]+)[^}]*\}/g, "$1"); }
	};

	const renderInline = (entry) => {
		if (entry == null) return "";
		if (typeof entry === "string" || typeof entry === "number") return Renderer.get().render(String(entry));
		return Renderer.get().render(entry);
	};

	const htmlToText = (html) => {
		const d = document.createElement("div");
		d.innerHTML = html;
		return d.textContent.replace(/\s+/g, " ").trim();
	};

	/** First readable sentence(s) of a list of entries, trimmed to roughly maxLen characters. */
	const summarize = (entries, maxLen = 170) => {
		const strs = [];
		const walk = (e, depth) => {
			if (strs.join(" ").length > maxLen * 2 || depth > 6) return;
			if (e == null) return;
			if (typeof e === "string") {
				const s = strip(e).trim();
				// Skip the italic tagline that opens many subclass features
				if (s && !(depth <= 1 && /^\{@i [^}]+\}$/.test(e.trim()))) strs.push(s);
				return;
			}
			if (Array.isArray(e)) return e.forEach(x => walk(x, depth));
			if (e.type === "table" || e.type === "image" || e.type === "gallery") return;
			if (e.entries) walk(e.entries, depth + 1);
			else if (e.items) walk(e.items, depth + 1);
			else if (e.entry) walk(e.entry, depth + 1);
		};
		walk(entries, 0);
		let text = strs.join(" ").replace(/\s+/g, " ").trim()
			.replace(/^You gain the following benefits?\.?\s*/i, "");
		if (text.length <= maxLen) return text;
		const cut = text.slice(0, maxLen + 40);
		const m = /^(.{40,}?[.!?])(\s|$)/.exec(cut);
		if (m && m[1].length <= maxLen + 30) return m[1];
		return text.slice(0, maxLen).replace(/\s+\S*$/, "") + "…";
	};
	// endregion

	// region Loading
	const loadClasses = () => once("classes", async () => {
		const raw = await DataUtil.class.loadRawJSON();
		const cf = new Map();
		raw.classFeature.forEach(f => cf.set(lc(`${f.name}|${f.className}|${f.classSource}|${f.level}|${f.source}`), f));
		const scf = new Map();
		raw.subclassFeature.forEach(f => scf.set(lc(`${f.name}|${f.className}|${f.classSource}|${f.subclassShortName}|${f.subclassSource}|${f.level}|${f.source}`), f));
		const classes = raw.class.filter(c => !c.isSidekick && c.name !== "Sidekick");
		return {classes, subclasses: raw.subclass, cf, scf};
	});

	const loadRaces = () => once("races", async () => {
		const json = await DataUtil.race.loadJSON();
		const out = [];
		json.race.forEach(r => {
			out.push(r);
			try {
				DataUtil.proxy.getVersions("race", r).forEach(v => out.push(v));
			} catch (e) { /* no versions */ }
		});
		return out;
	});

	const loadSimple = (path, prop) => once(`simple:${path}`, async () => (await DataUtil.loadJSON(path))[prop] || []);
	const loadBackgrounds = () => loadSimple("data/backgrounds.json", "background");
	const loadFeats = () => loadSimple("data/feats.json", "feat");
	const loadOptFeatures = () => loadSimple("data/optionalfeatures.json", "optionalfeature");
	const loadConditions = () => once("conditions", async () => {
		const j = await DataUtil.loadJSON("data/conditionsdiseases.json");
		return [...(j.condition || []), ...(j.status || [])];
	});
	const loadActions = () => loadSimple("data/actions.json", "action");

	const loadSpells = () => once("spells", async () => {
		const index = await DataUtil.loadJSON("data/spells/index.json");
		const all = (await Promise.all(Object.values(index).map(f => DataUtil.loadJSON(`data/spells/${f}`)))).map(j => j.spell || []).flat();
		const sources = await DataUtil.loadJSON("data/spells/sources.json");
		all.forEach(sp => {
			const meta = sources?.[sp.source]?.[sp.name];
			sp._tbClasses = [...(meta?.class || []), ...(meta?.classVariant || [])].map(c => keyOf(c.name, c.source));
		});
		return all;
	});
	// endregion

	// region Class resolution
	const DEFAULT_SRC = "PHB";

	const unpackCf = (uid) => {
		let [name, className, classSource, level, source] = uid.split("|").map(s => s.trim());
		classSource = classSource || DEFAULT_SRC;
		source = source || classSource;
		return {name, className, classSource, level: Number(level), source};
	};
	const unpackScf = (uid) => {
		let [name, className, classSource, subclassShortName, subclassSource, level, source] = uid.split("|").map(s => s.trim());
		classSource = classSource || DEFAULT_SRC;
		subclassSource = subclassSource || DEFAULT_SRC;
		source = source || subclassSource;
		return {name, className, classSource, subclassShortName, subclassSource, level: Number(level), source};
	};

	/** Inline refClassFeature / refSubclassFeature / refOptionalfeature entries so the feature renders standalone. */
	const resolveRefs = async (entries, ctx, depth = 0) => {
		if (depth > 8 || entries == null) return entries;
		if (Array.isArray(entries)) return Promise.all(entries.map(e => resolveRefs(e, ctx, depth)));
		if (typeof entries !== "object") return entries;
		if (entries.type === "refClassFeature") {
			const u = unpackCf(entries.classFeature);
			const f = ctx.cf.get(lc(`${u.name}|${u.className}|${u.classSource}|${u.level}|${u.source}`));
			if (!f) return `{@b ${u.name}}`;
			return {type: "entries", name: f.name, entries: await resolveRefs(f.entries, ctx, depth + 1)};
		}
		if (entries.type === "refSubclassFeature") {
			const u = unpackScf(entries.subclassFeature);
			const f = ctx.scf.get(lc(`${u.name}|${u.className}|${u.classSource}|${u.subclassShortName}|${u.subclassSource}|${u.level}|${u.source}`));
			if (!f) return `{@b ${u.name}}`;
			return {type: "entries", name: f.name, entries: await resolveRefs(f.entries, ctx, depth + 1)};
		}
		if (entries.type === "refOptionalfeature") {
			const [name, source] = entries.optionalfeature.split("|");
			const ofs = await loadOptFeatures();
			const f = ofs.find(o => lc(o.name) === lc(name) && lc(o.source) === lc(source || "PHB"));
			if (!f) return `{@optfeature ${entries.optionalfeature}}`;
			return {type: "entries", name: f.name, entries: await resolveRefs(f.entries, ctx, depth + 1)};
		}
		const out = {...entries};
		for (const k of ["entries", "items", "entry"]) if (out[k] != null) out[k] = await resolveRefs(out[k], ctx, depth + 1);
		return out;
	};

	const getClass = async (name, source) => {
		const d = await loadClasses();
		return d.classes.find(c => lc(c.name) === lc(name) && lc(c.source) === lc(source));
	};
	const getSubclasses = async (cls) => {
		const d = await loadClasses();
		return d.subclasses.filter(sc => lc(sc.className) === lc(cls.name) && lc(sc.classSource) === lc(cls.source));
	};
	const getSubclass = async (cls, shortName, source) => {
		return (await getSubclasses(cls)).find(sc => lc(sc.shortName) === lc(shortName) && lc(sc.source) === lc(source));
	};

	/**
	 * Resolve a class (and optional subclass) into an ordered list of features with their entries.
	 * @return {Promise<{cls, subclass, features: Array<{uid, key, name, level, isSubclass, isSubclassGate, entries, source, page}>}>}
	 */
	const resolveClass = async (clsRef, scRef) => {
		const d = await loadClasses();
		const cls = await getClass(clsRef.name, clsRef.source);
		if (!cls) throw new Error(`Class not found: ${clsRef.name} (${clsRef.source})`);
		const subclass = scRef ? await getSubclass(cls, scRef.shortName, scRef.source) : null;
		const features = [];
		const scFeaturesByLevel = new Map();
		if (subclass) {
			for (const uid of (subclass.subclassFeatures || [])) {
				const u = unpackScf(typeof uid === "string" ? uid : uid.subclassFeature);
				const f = d.scf.get(lc(`${u.name}|${u.className}|${u.classSource}|${u.subclassShortName}|${u.subclassSource}|${u.level}|${u.source}`));
				if (!f) continue;
				if (!scFeaturesByLevel.has(f.level)) scFeaturesByLevel.set(f.level, []);
				scFeaturesByLevel.get(f.level).push(f);
			}
		}
		for (const ref of (cls.classFeatures || [])) {
			const uid = typeof ref === "string" ? ref : ref.classFeature;
			const u = unpackCf(uid);
			const f = d.cf.get(lc(`${u.name}|${u.className}|${u.classSource}|${u.level}|${u.source}`));
			if (!f) continue;
			const isGate = typeof ref === "object" && ref.gainSubclassFeature;
			features.push({
				uid: lc(uid),
				key: `cf:${lc(uid)}`,
				name: f.name,
				level: f.level,
				isSubclass: false,
				isSubclassGate: !!isGate,
				entries: await resolveRefs(f.entries, d),
				source: f.source,
				page: f.page,
				_raw: f,
			});
			if (isGate && subclass) {
				for (const sf of (scFeaturesByLevel.get(f.level) || [])) {
					const suid = lc(`${sf.name}|${sf.className}|${sf.classSource}|${sf.subclassShortName}|${sf.subclassSource}|${sf.level}|${sf.source}`);
					features.push({
						uid: suid,
						key: `scf:${suid}`,
						name: sf.name,
						level: sf.level,
						isSubclass: true,
						isSubclassGate: false,
						isSubclassIntro: sf.name === subclass.name || sf.name === subclass.shortName,
						entries: await resolveRefs(sf.entries, d),
						source: sf.source,
						page: sf.page,
						_raw: sf,
					});
				}
				scFeaturesByLevel.delete(f.level);
			}
		}
		// Subclass features at levels without a matching gate (rare) are appended by level
		for (const [lvl, arr] of scFeaturesByLevel) {
			for (const sf of arr) {
				const suid = lc(`${sf.name}|${sf.className}|${sf.classSource}|${sf.subclassShortName}|${sf.subclassSource}|${sf.level}|${sf.source}`);
				features.push({uid: suid, key: `scf:${suid}`, name: sf.name, level: lvl, isSubclass: true, entries: await resolveRefs(sf.entries, d), source: sf.source, page: sf.page, _raw: sf});
			}
		}
		features.sort((a, b) => a.level - b.level);
		return {cls, subclass, features};
	};

	const cellToText = (cell) => {
		if (cell == null) return "";
		if (typeof cell === "number") return String(cell);
		if (typeof cell === "string") return strip(cell);
		if (cell.type === "bonus") return `+${cell.value}`;
		if (cell.type === "bonusSpeed") return `+${cell.value} ft.`;
		if (cell.type === "dice") return (cell.toRoll || []).map(r => `${r.number}d${r.faces}`).join("+");
		try { return htmlToText(renderInline(cell)); } catch (e) { return ""; }
	};

	/** Class table as plain columns: [{label, group, values[20]}] */
	const getClassTableColumns = (cls, subclass) => {
		const out = [];
		const groups = [...(cls.classTableGroups || []), ...((subclass && subclass.subclassTableGroups) || [])];
		for (const g of groups) {
			const rows = g.rows || g.rowsSpellProgression;
			if (!rows) continue;
			const groupTitle = g.title ? strip(g.title) : null;
			(g.colLabels || []).forEach((lbl, i) => {
				let label = strip(lbl);
				if (g.rowsSpellProgression && /^\d/.test(label)) label = label.replace(/(st|nd|rd|th)$/, "");
				out.push({label, group: groupTitle, isSlots: !!g.rowsSpellProgression, values: rows.map(r => cellToText(r[i]))});
			});
		}
		return out;
	};

	const profBonus = (lvl) => Math.ceil(lvl / 4) + 1;
	// endregion

	// region Proficiencies text
	const ABIL = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};
	const abil = (a) => ABIL[a] || a;
	const titleCase = s => String(s).replace(/\b\w/g, c => c.toUpperCase());

	const armorText = (arr) => (arr || []).map(a => typeof a === "string" ? strip(a.replace(/^(light|medium|heavy)$/, "$1 armor").replace(/^shield$/, "Shields")) : strip(a.full || a.proficiency || "")).map(titleCase).join(", ");
	const weaponText = (arr) => (arr || []).map(w => typeof w === "string" ? strip(w.replace(/^(simple|martial)$/, "$1 weapons")) : strip(w.full || w.proficiency || "")).map(titleCase).join(", ");
	const toolText = (arr) => (arr || []).map(t => typeof t === "string" ? strip(t) : strip(t.full || t.proficiency || JSON.stringify(t))).join(", ");
	const skillsText = (arr) => (arr || []).map(s => {
		if (s.choose) return `Choose ${s.choose.count || 1}: ${s.choose.from.map(titleCase).join(", ")}`;
		if (s.any) return `Any ${s.any}`;
		return Object.keys(s).filter(k => s[k] === true).map(titleCase).join(", ");
	}).join("; ");

	const getClassCore = (cls, subclass = null) => {
		const sp = cls.startingProficiencies || {};
		const primary = (cls.primaryAbility || []).map(o => Object.keys(o).filter(k => o[k]).map(abil).join(" and ")).join(" or ");
		const hd = cls.hd ? `d${cls.hd.faces}` : "—";
		return {
			primary,
			hd,
			hpFirst: cls.hd ? `${cls.hd.faces} + Con. modifier` : "",
			hpLater: cls.hd ? `${cls.hd.faces / 2 + 1} (or 1${hd}) + Con. modifier per level` : "",
			saves: (cls.proficiency || []).map(abil).join(", "),
			skills: skillsText(sp.skills),
			weapons: weaponText(sp.weapons),
			armor: armorText(sp.armor),
			tools: toolText(sp.tools),
			multiclassReq: (() => {
				const r = cls.multiclassing?.requirements;
				if (!r) return "";
				const one = (o) => Object.entries(o).filter(([k]) => ABIL[k]).map(([k, v]) => `${abil(k)} ${v}`).join(", ");
				if (r.or) return r.or.map(one).join(" or ");
				return one(r);
			})(),
			multiclassGains: (() => {
				const g = cls.multiclassing?.proficienciesGained;
				if (!g) return "";
				return [armorText(g.armor), weaponText(g.weapons), toolText(g.tools), skillsText(g.skills)].filter(Boolean).join("; ");
			})(),
			casterProgression: cls.casterProgression || null,
			spellAbility: cls.spellcastingAbility ? abil(cls.spellcastingAbility)
				: subclass && subclass.spellcastingAbility && (subclass.casterProgression || subclass.cantripProgression) ? `${abil(subclass.spellcastingAbility)} (${subclass.name})` : null,
			optFeatureTypes: (cls.optionalfeatureProgression || []).map(p => ({name: p.name, featureType: p.featureType, progression: p.progression})),
		};
	};
	// endregion

	// region Entity rendering
	const wrapStats = (rowsHtml) => `<table class="ve-w-100 ve-stats tb-stats">${rowsHtml}</table>`;

	const renderEntity = (prop, ent) => {
		try {
			switch (prop) {
				case "spell": return wrapStats(Renderer.spell.getCompactRenderedString(ent));
				case "feat": return wrapStats(Renderer.feat.getCompactRenderedString(ent));
				case "race": return wrapStats(Renderer.race.getCompactRenderedString(ent));
				case "background": return wrapStats(Renderer.background.getCompactRenderedString(ent));
				case "optionalfeature": return wrapStats(Renderer.optionalfeature.getCompactRenderedString(ent));
				case "condition":
				case "status": return wrapStats(Renderer.condition.getCompactRenderedString(ent));
				case "action": return wrapStats(Renderer.action.getCompactRenderedString(ent));
				default: return Renderer.get().render({type: "entries", name: ent.name, entries: ent.entries || []});
			}
		} catch (e) {
			console.warn("Compact render failed", prop, ent, e);
			return Renderer.get().render({type: "entries", name: ent.name, entries: ent.entries || []});
		}
	};

	const renderFeature = (feat, {headerLevel = 1} = {}) => {
		const r = Renderer.get().setFirstSection(true);
		const entry = {type: "entries", name: feat.name, entries: feat.entries};
		const prevDepth = headerLevel;
		return r.render(entry, prevDepth);
	};
	// endregion

	// region Spells helpers
	const spellMeta = (sp) => {
		const lvl = sp.level;
		const conc = (sp.duration || []).some(d => d.concentration);
		const ritual = !!sp.meta?.ritual;
		let school = "";
		try { school = Parser.spSchoolAbvToFull(sp.school); } catch (e) { school = sp.school; }
		const safe = (fn) => { try { return htmlToText(strip(fn())); } catch (e) { return ""; } };
		const t0 = (sp.time || [])[0] || {};
		const UNIT = {action: "Action", bonus: "Bonus", reaction: "Reaction", minute: "min", hour: "hr", round: "round"};
		const timeShort = t0.unit ? (["action", "bonus", "reaction"].includes(t0.unit) ? `${t0.number > 1 ? t0.number + " " : ""}${UNIT[t0.unit]}` : `${t0.number || 1} ${UNIT[t0.unit] || t0.unit}`) + (sp.meta?.ritual ? " (R)" : "") : "";
		return {
			level: lvl,
			levelText: lvl === 0 ? "Cantrip" : `${Parser.getOrdinalForm ? Parser.getOrdinalForm(lvl) : lvl}`,
			school,
			time: safe(() => Parser.spTimeListToFull(sp.time)),
			timeShort,
			range: safe(() => Parser.spRangeToFull(sp.range)).replace(/(\d+) feet/g, "$1 ft.").replace(/(\d+) miles?/g, "$1 mi."),
			components: safe(() => Parser.spComponentsToFull(sp.components, sp.level, {isPlainText: true})).replace(/\s*\(.*\)$/, ""),
			duration: safe(() => Parser.spDurationToFull(sp.duration)).replace(/Concentration, up to /i, "Conc., "),
			conc,
			ritual,
		};
	};
	// endregion

	return {
		lc, keyOf, isModern, sourceShort, sourceFull, strip, summarize, renderInline, htmlToText,
		loadClasses, loadRaces, loadBackgrounds, loadFeats, loadOptFeatures, loadSpells, loadConditions, loadActions,
		getClass, getSubclasses, getSubclass, resolveClass, getClassTableColumns, getClassCore, profBonus,
		renderEntity, renderFeature, spellMeta, abil, titleCase,
	};
})();
