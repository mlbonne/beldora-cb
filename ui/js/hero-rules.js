"use strict";

/**
 * Character rules engine (D&D 2024 via 5etools data).
 * analyze(char) turns the character into the builder's choices (per step / level) and the derived numbers
 * the hero sheet, cards and PDFs use. Choices live in char.choices[id]; ids are stable strings.
 */
globalThis.TBRules = (() => {
	const D = () => TBData;
	const lc = (s) => String(s ?? "").toLowerCase();
	const same = (a, b) => a && b && lc(a.name) === lc(b.name) && lc(a.source) === lc(b.source);
	const refKey = (r) => `${lc(r.name)}|${lc(r.source)}`;

	const ABILS = ["str", "dex", "con", "int", "wis", "cha"];
	const ABIL_NAMES = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};
	const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
	const POINT_COST = {8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9};
	const POINT_BUDGET = 27;
	const SKILLS = {
		"acrobatics": "dex", "animal handling": "wis", "arcana": "int", "athletics": "str", "deception": "cha",
		"history": "int", "insight": "wis", "intimidation": "cha", "investigation": "int", "medicine": "wis",
		"nature": "int", "perception": "wis", "performance": "cha", "persuasion": "cha", "religion": "int",
		"sleight of hand": "dex", "stealth": "dex", "survival": "wis",
	};
	const SKILL_LIST = Object.keys(SKILLS);
	// Capitalise words, but not the letter after an apostrophe ("Calligrapher's")
	const titleCase = (s) => String(s).replace(/(^|[\s\-(/])(\w)/g, (m, a, c) => a + c.toUpperCase()).replace(/(?!^)\b(Of|And|The|In|On|To|Or)\b/g, w => w.toLowerCase());
	const mod = (score) => Math.floor((score - 10) / 2);
	const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
	const FULL_SLOTS = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]];
	const PACT = [[1, 1], [2, 1], [2, 2], [2, 2], [2, 3], [2, 3], [2, 4], [2, 4], [2, 5], [2, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 5], [4, 5], [4, 5], [4, 5]];
	const ALIGNMENTS = ["Lawful Good", "Neutral Good", "Chaotic Good", "Lawful Neutral", "Neutral", "Chaotic Neutral", "Lawful Evil", "Neutral Evil", "Chaotic Evil", "Unaligned"];
	const DMG_TYPES = {A: "Acid", B: "Bludgeoning", C: "Cold", F: "Fire", O: "Force", L: "Lightning", N: "Necrotic", P: "Piercing", I: "Poison", Y: "Psychic", R: "Radiant", S: "Slashing", T: "Thunder"};

	// region Data
	const _cache = {};
	const once = (k, fn) => (_cache[k] = _cache[k] || fn());
	const loadItems = () => once("items", async () => {
		const base = (await DataUtil.loadJSON("data/items-base.json"));
		// The merged list: base items, magic items and every specific variant (+1 Longsword, Mithral Plate…)
		let items;
		try { items = await Renderer.item.pBuildList(); } catch (e) { items = [...(base.baseitem || []), ...((await DataUtil.loadJSON("data/items.json")).item || [])]; }
		const props = {};
		(base.itemProperty || []).forEach(p => { props[`${lc(p.abbreviation)}|${lc(p.source)}`] = p; });
		const all = items.filter(i => i.name && !i._isItemGroup);
		const byKey = new Map();
		all.forEach(i => { if (!byKey.has(refKey(i))) byKey.set(refKey(i), i); });
		return {all, byKey, props, mastery: base.itemMastery || []};
	});
	const loadLanguages = () => once("langs", async () => ((await DataUtil.loadJSON("data/languages.json")).language || []));
	const ensure = () => Promise.all([D().loadClasses(), D().loadRaces(), D().loadBackgrounds(), D().loadFeats(), D().loadOptFeatures(), D().loadSpells(), loadItems(), loadLanguages()]);

	/** Base species (no lineage versions) for the option grid. */
	const baseSpecies = async () => (await D().loadRaces()).filter(r => !r._versionBase_name && !String(r.name).includes(";"));
	const versionsOf = (race) => { try { return DataUtil.proxy.getVersions("race", race) || []; } catch (e) { return []; } };
	// endregion

	// region Character normalisation (also migrates characters made before the builder)
	const normalize = (char) => {
		char.choices = char.choices || {};
		char.abilities = char.abilities || {method: "standard", base: {}};
		char.equipment = char.equipment || {items: [], cp: 0, startingApplied: {}};
		char.details = char.details || {};
		char.classes = char.classes || [];
		if (char.species && String(char.species.name).includes(";")) {
			const [base] = char.species.name.split(";");
			char.choices["species:lineage"] = [char.species.name];
			char.species = {name: base.trim(), source: char.species.source};
		}
		return char;
	};
	// endregion

	// region Helpers to read 5etools choice shapes
	const parseSpellFilter = (str) => {
		const out = {};
		String(str).split("|").forEach(part => {
			const [k, v] = part.split("=");
			if (k && v != null) out[lc(k.trim())] = v.split(";").map(x => lc(x.trim()));
		});
		return out;
	};
	const spellMatches = (sp, f) => {
		if (f.level && !f.level.includes(String(sp.level))) return false;
		if (f.class && !f.class.some(c => (sp._tbClasses || []).some(k => k.startsWith(`${c}|`)))) return false;
		if (f.school && !f.school.includes(lc(sp.school))) return false;
		return true;
	};

	const skillOptions = (from) => {
		const list = (from || []).flatMap(s => {
			if (s === "anySkill") return SKILL_LIST;
			return [lc(s)];
		});
		return [...new Set(list)].filter(s => SKILLS[s]).map(s => ({value: s, label: titleCase(s), info: ABIL_NAMES[SKILLS[s]].slice(0, 3)}));
	};

	const toolOptions = async (kind) => {
		const {all} = await loadItems();
		const typeOf = (i) => String(i.type || "").split("|")[0];
		const want = {anyGamingSet: ["GS"], anyArtisansTool: ["AT"], anyMusicalInstrument: ["INS"], anyTool: ["AT", "GS", "INS", "T"]}[kind] || ["AT", "GS", "INS", "T"];
		const items = all.filter(i => want.includes(typeOf(i)) && (i.source === "XPHB" || !D().isModern("XPHB")));
		return [...new Map(items.map(i => [lc(i.name), i])).values()].sort((a, b) => a.name.localeCompare(b.name)).map(i => ({value: lc(i.name), label: i.name}));
	};

	/** Ability choice shape from 5etools: [{choose:{from, amount, count}} | {choose:{weighted:{from, weights}}} | {str:1}] */
	const abilityRule = (abilityArr) => {
		if (!abilityArr || !abilityArr.length) return null;
		const fixed = {};
		const patterns = [];
		let from = null;
		abilityArr.forEach(a => {
			if (a.choose) {
				if (a.choose.weighted) {
					from = a.choose.weighted.from;
					patterns.push([...a.choose.weighted.weights].sort((x, y) => y - x));
				} else {
					from = a.choose.from || ABILS;
					const amount = a.choose.amount || 1;
					const count = a.choose.count || 1;
					patterns.push(Array(count).fill(amount));
				}
			} else Object.entries(a).forEach(([k, v]) => { if (ABILS.includes(k)) fixed[k] = (fixed[k] || 0) + v; });
		});
		return {fixed, from, patterns};
	};
	const abilityValid = (rule, val) => {
		if (!rule.patterns.length) return true;
		const vals = Object.entries(val || {}).filter(([k, v]) => v > 0 && (rule.from || ABILS).includes(k)).map(([, v]) => v).sort((a, b) => b - a);
		return rule.patterns.some(p => p.length === vals.length && p.every((x, i) => x === vals[i]));
	};
	// endregion

	// region Analysis
	/**
	 * @return {Promise<{choices: Array, steps: Object, derived: Object}>}
	 */
	const analyze = async (charIn) => {
		await ensure();
		await resolveItems();
		const char = normalize(charIn);
		const choices = [];
		const legacy = !!char.legacy;
		const val = (id, dflt) => char.choices[id] ?? dflt;
		const add = (c) => {
			c.value = val(c.id, c.type === "ability" ? {} : []);
			c.complete = isComplete(c);
			choices.push(c);
			return c;
		};
		const isComplete = (c) => {
			switch (c.type) {
				case "ability": return abilityValid(c.rule, c.value);
				case "equipment": return Array.isArray(c.value) && c.value.length >= 1;
				default: return Array.isArray(c.value) && c.value.length >= c.count;
			}
		};

		// Collected grants
		const G = {
			skills: new Set(), expertise: new Set(), tools: new Set(), languages: new Set(["common"]), resist: new Set(),
			abilityBonus: {}, feats: [], spells: [], optfeatures: [], saves: new Set(), armor: new Set(), weapons: new Set(),
			masteries: [], notes: [], featureOptions: [], fixedSkills: new Set(),
		};
		const bump = (abil, n) => { G.abilityBonus[abil] = (G.abilityBonus[abil] || 0) + n; };
		const applyAbility = (rule, value) => {
			Object.entries(rule.fixed).forEach(([k, v]) => bump(k, v));
			if (abilityValid(rule, value)) Object.entries(value || {}).forEach(([k, v]) => { if (v > 0) bump(k, v); });
		};

		const feats = await D().loadFeats();
		const findFeat = (r) => feats.find(f => same(f, r));

		/** Choices a feat brings (ability, skills, spells…), applied to G. */
		const featChoices = async (feat, idPrefix, step, group, variant = null) => {
			const rule = abilityRule(feat.ability);
			let increased = null;
			if (rule) {
				if (rule.patterns.length) {
					const c = add({id: `${idPrefix}:ability`, step, group, title: `${feat.name}: ability increase`, desc: rule.patterns.map(p => p.map(n => `+${n}`).join("/")).join(" or "), type: "ability", rule, count: 1});
					applyAbility(rule, c.value);
					increased = Object.keys(c.value || {}).find(k => c.value[k] > 0) || null;
				} else applyAbility(rule, {});
				if (!increased) { const fk = Object.keys(rule.fixed); if (fk.length === 1) increased = fk[0]; }
			}
			for (const sp of (feat.skillProficiencies || [])) {
				if (sp.choose) add({id: `${idPrefix}:skills`, step, group, title: `${feat.name}: skill proficiency`, type: "pick", count: sp.choose.count || 1, options: skillOptions(sp.choose.from)}).value.forEach(s => G.skills.add(s));
				else Object.keys(sp).filter(k => sp[k] === true).forEach(s => { G.skills.add(lc(s)); G.fixedSkills.add(lc(s)); });
			}
			for (const stl of (feat.skillToolLanguageProficiencies || [])) {
				for (const ch of (stl.choose || [])) {
					const opts = [...skillOptions(ch.from.includes("anySkill") ? ["anySkill"] : ch.from), ...(ch.from.includes("anyTool") ? (await toolOptions("anyTool")).map(o => ({...o, value: `tool:${o.value}`, info: "Tool"})) : [])];
					add({id: `${idPrefix}:stl`, step, group, title: `${feat.name}: skills or tools`, type: "pick", count: ch.count || 1, options: opts})
						.value.forEach(v => (v.startsWith("tool:") ? G.tools.add(v.slice(5)) : G.skills.add(v)));
				}
			}
			for (const ex of (feat.expertise || [])) {
				if (ex.anyProficientSkill) add({id: `${idPrefix}:expertise`, step, group, title: `${feat.name}: expertise`, type: "pick", count: ex.anyProficientSkill, options: "proficientSkills"}).value.forEach(s => G.expertise.add(s));
			}
			if (feat.additionalSpells && feat.additionalSpells.length) {
				let entries = feat.additionalSpells;
				if (entries.length > 1) {
					const names = entries.map(e => e.name || "Spells");
					let chosen = variant ? names.find(n => lc(n).startsWith(lc(variant))) : null;
					if (!chosen) {
						const c = add({id: `${idPrefix}:list`, step, group, title: `${feat.name}: spell list`, type: "pick", count: 1, options: names.map(n => ({value: n, label: n}))});
						chosen = c.value[0];
					}
					entries = entries.filter(e => (e.name || "Spells") === chosen);
				}
				for (const e of entries) await addSpellGrant(e, idPrefix, step, group, feat.name, 99, {inherit: increased, text: feat.entries});
			}
		};

		/** additionalSpells entry: fixed or "choose" spells, plus an optional spellcasting-ability choice. */
		const addSpellGrant = async (entry, idPrefix, step, group, via, level, {inherit = null, text = null} = {}) => {
			const ability = spellAbilityOf(entry, {inherit, text}, (list) => {
				const id = `${idPrefix}:spellAbility`;
				const c = choices.find(x => x.id === id) || add({id, step, group, title: `${via}: spellcasting ability`, desc: "Used for the attack rolls and save DCs of these spells.", type: "pick", count: 1, options: list.map(a => ({value: a, label: ABIL_NAMES[a]}))});
				return c.value[0] || null;
			});
			const spells = await D().loadSpells();
			const visit = (obj, kind) => {
				if (!obj) return;
				Object.entries(obj).forEach(([lvlKey, list]) => {
					const unlock = lvlKey === "_" ? 1 : Number(lvlKey) || 1;
					if (unlock > level) return;
					const arr = Array.isArray(list) ? list : Object.values(list).flatMap(x => Array.isArray(x) ? x : Object.values(x).flat());
					arr.forEach((sp, ix) => {
						if (typeof sp === "string") {
							const [name, src] = sp.split("#")[0].split("|");
							const ent = spells.find(s => lc(s.name) === lc(name) && lc(s.source) === lc(src || "phb"));
							if (ent) G.spells.push({ent, via, always: true, ability});
						} else if (sp && sp.choose) {
							const filter = parseSpellFilter(sp.choose);
							const c = add({id: `${idPrefix}:${kind}:${lvlKey}:${ix}`, step, group, title: `${via}: ${filter.level && filter.level[0] === "0" ? "cantrip" : "spell"}${(sp.count || 1) > 1 ? "s" : ""}`, desc: describeFilter(filter), type: "spells", count: sp.count || 1, filter});
							c.value.forEach(r => { const ent = spells.find(s => same(s, r)); if (ent) G.spells.push({ent, via, always: true, ability}); });
						}
					});
				});
			};
			visit(entry.known, "known");
			visit(entry.prepared, "prepared");
			if (entry.innate) Object.entries(entry.innate).forEach(([lvlKey, v]) => visit({[lvlKey]: v}, "innate"));
		};
		const describeFilter = (f) => [f.level ? (f.level[0] === "0" ? "Cantrip" : `Level ${f.level.join("/")}`) : null, f.class ? `${f.class.map(titleCase).join("/")} list` : null, f.school ? f.school.join("/") : null].filter(Boolean).join(" · ");

		// region Species
		let species = null;
		if (char.species) {
			const races = await D().loadRaces();
			const base = races.find(r => same(r, char.species));
			species = base;
			if (base) {
				const versions = versionsOf(base);
				if (versions.length) {
					const c = add({id: "species:lineage", step: "species", group: "Species", title: "Lineage", desc: "Your species offers a choice of lineage.", type: "pick", count: 1, options: versions.map(v => ({value: v.name, label: v.name.replace(/^[^;]+;\s*/, "")}))});
					const v = versions.find(x => x.name === c.value[0]);
					if (v) species = v;
				}
				if ((base.size || []).length > 1) add({id: "species:size", step: "species", group: "Species", title: "Size", type: "pick", count: 1, options: base.size.map(s => ({value: s, label: Parser.sizeAbvToFull(s)}))});
				for (const sp of (species.skillProficiencies || [])) {
					if (sp.choose) add({id: "species:skills", step: "species", group: "Species", title: "Skill proficiency", type: "pick", count: sp.choose.count || 1, options: skillOptions(sp.choose.from)}).value.forEach(s => G.skills.add(s));
					else if (sp.any) add({id: "species:skills", step: "species", group: "Species", title: "Skill proficiency", type: "pick", count: sp.any, options: skillOptions(["anySkill"])}).value.forEach(s => G.skills.add(s));
					else Object.keys(sp).filter(k => sp[k] === true).forEach(s => { G.skills.add(lc(s)); G.fixedSkills.add(lc(s)); });
				}
				for (const r of (species.resist || [])) {
					if (typeof r === "string") G.resist.add(r);
					else if (r.choose) add({id: "species:resist", step: "species", group: "Species", title: "Damage resistance", type: "pick", count: 1, options: r.choose.from.map(x => ({value: x, label: titleCase(x)}))}).value.forEach(x => G.resist.add(x));
				}
				// Legacy species may grant fixed ability scores
				if (species.ability && !char.legacyAbilitiesFromBackground) {
					const rule = abilityRule(species.ability);
					if (rule) {
						if (rule.patterns.length) applyAbility(rule, add({id: "species:ability", step: "species", group: "Species", title: "Ability increase", type: "ability", rule, count: 1}).value);
						else applyAbility(rule, {});
					}
				}
				for (const fo of (species.feats || [])) {
					if (fo.anyFromCategory) {
						const c = add({id: "species:feat", step: "species", group: "Species", title: "Origin feat", desc: "Choose a feat from the Origin category.", type: "feat", count: fo.anyFromCategory.count || 1, categories: fo.anyFromCategory.category});
						for (const r of c.value) { const f = findFeat(r); if (f) { G.feats.push({ent: f, via: "Species"}); await featChoices(f, "species:feat:" + refKey(f), "species", f.name); } }
					}
				}
				if (species.additionalSpells && species.additionalSpells.length) {
					// A species with lineages grants spells only once a lineage is chosen
					const entries = species === base && versionsOf(base).length ? [] : species.additionalSpells;
					for (const e of entries) await addSpellGrant(e, "species:spells", "species", "Species", species.name.replace(/^[^;]+;\s*/, ""), totalLevel(char), {text: species.entries});
				}
			}
		}
		// endregion

		// region Background
		let background = null;
		if (char.background) {
			background = (await D().loadBackgrounds()).find(b => same(b, char.background));
			if (background) {
				const rule = abilityRule(background.ability);
				if (rule && rule.patterns.length) applyAbility(rule, add({id: "bg:ability", step: "background", group: "Background", title: "Ability scores", desc: `Increase one by 2 and another by 1, or all three by 1 (${(rule.from || []).map(a => ABIL_NAMES[a]).join(", ")}).`, type: "ability", rule, count: 1}).value);
				else if (rule) applyAbility(rule, {});
				for (const sp of (background.skillProficiencies || [])) {
					if (sp.choose) add({id: "bg:skills", step: "background", group: "Background", title: "Skill proficiencies", type: "pick", count: sp.choose.count || 1, options: skillOptions(sp.choose.from)}).value.forEach(s => G.skills.add(s));
					else Object.keys(sp).filter(k => sp[k] === true).forEach(s => { G.skills.add(lc(s)); G.fixedSkills.add(lc(s)); });
				}
				for (const tp of (background.toolProficiencies || [])) {
					for (const [k, v] of Object.entries(tp)) {
						if (v === true) G.tools.add(lc(k));
						else if (typeof v === "number") add({id: `bg:tool:${k}`, step: "background", group: "Background", title: "Tool proficiency", type: "pick", count: v, options: await toolOptions(k)}).value.forEach(t => G.tools.add(t));
					}
				}
				for (const fo of (background.feats || [])) {
					for (const k of Object.keys(fo)) {
						const [rawName, src] = k.split("|");
						const [name, variant] = rawName.split(";").map(s => s.trim());
						const f = findFeat({name, source: src || "PHB"});
						if (!f) continue;
						G.feats.push({ent: f, via: "Background", variant});
						await featChoices(f, `bg:feat:${refKey(f)}`, "background", `Origin feat: ${f.name}`, variant);
					}
				}
				if (background.startingEquipment) addEquipmentChoice("bg:equipment", "equipment", background.startingEquipment, "Background");
			}
		}
		// endregion

		function addEquipmentChoice (id, step, se, label) {
			const data = Array.isArray(se) ? se[0] : (se.defaultData ? se.defaultData[0] : null);
			if (!data) return;
			const keys = Object.keys(data).filter(k => /^[A-Z]$/.test(k));
			if (!keys.length) return;
			add({id, step, group: "Starting Equipment", title: `${label} equipment`, type: "equipment", count: 1, options: keys.map(k => ({value: k, label: `Option ${k}`, items: data[k]}))});
		}

		// region Classes
		const classesRes = [];
		const formulaChoices = [];
		const spellsAll = await D().loadSpells();
		for (let ci = 0; ci < char.classes.length; ++ci) {
			const cref = char.classes[ci];
			let res;
			try { res = await D().resolveClass(cref, cref.subclass); } catch (e) { continue; }
			const cls = res.cls;
			const level = Math.max(1, Math.min(20, Number(cref.level) || 1));
			const ck = refKey(cls);
			const isFirst = ci === 0;
			const step = "class";
			const grp = (l) => (l === 0 ? `${cls.name}` : `${cls.name} · Level ${l}`);
			const core = D().getClassCore(cls, res.subclass);
			const cols = D().getClassTableColumns(cls, res.subclass);
			classesRes.push({ref: cref, cls, subclass: res.subclass, features: res.features, level, core, cols, isFirst});

			// Proficiencies
			const sp = isFirst ? (cls.startingProficiencies || {}) : (cls.multiclassing?.proficienciesGained || {});
			if (isFirst) (cls.proficiency || []).forEach(a => G.saves.add(a));
			(sp.armor || []).forEach(a => G.armor.add(typeof a === "string" ? lc(a) : lc(a.proficiency || a.full || "")));
			(sp.weapons || []).forEach(w => G.weapons.add(typeof w === "string" ? lc(w) : lc(w.proficiency || w.full || "")));
			for (const s of (sp.skills || [])) {
				if (s.choose) add({id: `class:${ck}:skills`, step, group: grp(0), title: "Skill proficiencies", type: "pick", count: s.choose.count || 1, options: skillOptions(s.choose.from)}).value.forEach(x => G.skills.add(x));
				else if (s.any) add({id: `class:${ck}:skills`, step, group: grp(0), title: "Skill proficiencies", type: "pick", count: s.any, options: skillOptions(["anySkill"])}).value.forEach(x => G.skills.add(x));
			}
			if (isFirst && cls.startingEquipment) addEquipmentChoice(`class:${ck}:equipment`, "equipment", cls.startingEquipment, cls.name);

			// Subclass
			const gate = res.features.find(f => f.isSubclassGate);
			if (gate && level >= gate.level) {
				const subs = (await D().getSubclasses(cls)).filter(s => legacy || D().isModern(s.source) || (cref.subclass && s.shortName === cref.subclass.shortName));
				const c = {id: `class:${ck}:subclass`, step, group: grp(gate.level), level: gate.level, title: cls.subclassTitle || "Subclass", type: "subclass", count: 1, classIndex: ci, options: subs.map(s => ({value: `${s.shortName}|${s.source}`, label: s.name, info: D().sourceShort(s.source)}))};
				c.value = cref.subclass ? [`${cref.subclass.shortName}|${cref.subclass.source}`] : [];
				c.complete = !!cref.subclass;
				choices.push(c);
			}

			// Feats by level (Fighting Style, ASI/General, Epic Boon)
			const featSlots = [];
			(cls.featProgression || []).forEach(fp => Object.entries(fp.progression || {}).forEach(([l, n]) => { for (let i = 0; i < n; ++i) featSlots.push({level: Number(l), categories: fp.category, name: fp.name}); }));
			res.features.filter(f => !f.isSubclass && /^Ability Score Improvement$/i.test(f.name)).forEach(f => featSlots.push({level: f.level, categories: ["G"], name: "Ability Score Improvement"}));
			for (const slot of featSlots.filter(s => s.level <= level)) {
				const id = `class:${ck}:L${slot.level}:${lc(slot.name).replace(/\W+/g, "-")}`;
				const desc = slot.categories.includes("G") ? "Take the Ability Score Improvement feat or another General feat you qualify for." : `Choose a ${slot.name} feat.`;
				const c = add({id, step, group: grp(slot.level), level: slot.level, title: slot.name, desc, type: "feat", count: 1, categories: slot.categories, maxLevel: totalLevel(char)});
				for (const r of c.value) { const f = findFeat(r); if (f) { G.feats.push({ent: f, via: `${cls.name} ${slot.level}`}); await featChoices(f, id, step, grp(slot.level)); } }
			}

			// Weapon mastery
			const prog = cls.itemMasteriesProgression;
			if (prog) {
				const n = Object.entries(prog).filter(([l]) => Number(l) <= level).map(([, v]) => v).pop() || 0;
				if (n) {
					const {all} = await loadItems();
					const weapons = all.filter(i => i.weapon && i.mastery && (legacy || i.source === "XPHB")).sort((a, b) => a.name.localeCompare(b.name));
					add({id: `class:${ck}:mastery`, step, group: grp(1), level: 1, title: "Weapon Mastery", desc: `Choose ${n} kinds of weapons whose mastery properties you can use.`, type: "pick", count: n, options: weapons.map(w => ({value: lc(w.name), label: w.name, info: (w.mastery || []).map(m => m.split("|")[0]).join(", ")}))})
						.value.forEach(w => G.masteries.push(w));
				}
			}

			// Optional features (invocations, maneuvers, metamagic…) from class and subclass
			const ofProgs = [...(cls.optionalfeatureProgression || []), ...((res.subclass && res.subclass.optionalfeatureProgression) || [])];
			for (const p of ofProgs) {
				const n = Array.isArray(p.progression) ? (p.progression[level - 1] || 0) : (Object.entries(p.progression || {}).filter(([l]) => Number(l) <= level).map(([, v]) => v).pop() || 0);
				if (!n) continue;
				const c = add({id: `class:${ck}:of:${lc(p.name).replace(/\W+/g, "-")}`, step, group: grp(0), title: p.name, desc: `Choose ${n}.`, type: "optfeature", count: n, featureTypes: p.featureType});
				const ofs = await D().loadOptFeatures();
				c.value.forEach(r => { const o = ofs.find(x => same(x, r)); if (o) G.optfeatures.push({ent: o, via: cls.name}); });
			}

			// Features that hide choices: options lists, expertise, scholar
			for (const f of res.features.filter(x => x.level <= level)) {
				const g = grp(f.level);
				const optBlock = JSON.stringify(f._raw.entries || []).includes("\"type\":\"options\"") && !/Options$/i.test(f.name) ? findOptions(f._raw.entries) : null;
				if (optBlock) {
					add({id: `feature:${f.uid}:option`, step, group: g, level: f.level, title: f.name, desc: "Choose an option.", type: "pick", count: optBlock.count, options: optBlock.names.map(n => ({value: n, label: n}))})
						.value.forEach(v => G.featureOptions.push({feature: f.name, option: v}));
				}
				// Subclass features that hand out a Fighting Style feat (e.g. the Champion's)
				if (/^Additional Fighting Style$/i.test(f.name)) {
					const id = `feature:${f.uid}:feat`;
					const fc = add({id, step, group: g, level: f.level, title: f.name, desc: "Choose another Fighting Style feat.", type: "feat", count: 1, categories: ["FS"]});
					for (const r of fc.value) { const ft = findFeat(r); if (ft) { G.feats.push({ent: ft, via: `${f.name}`}); await featChoices(ft, id, step, g); } }
				}
				if (/^Expertise$/i.test(f.name)) add({id: `feature:${f.uid}:expertise`, step, group: g, level: f.level, title: `${f.name} (${cls.name} ${f.level})`, desc: "Choose skills you are proficient in.", type: "pick", count: 2, options: "proficientSkills"}).value.forEach(s => G.expertise.add(s));
				if (/^Scholar$/i.test(f.name)) add({id: `feature:${f.uid}:expertise`, step, group: g, level: f.level, title: "Scholar", desc: "Expertise in one of these skills you are proficient in.", type: "pick", count: 1, options: skillOptions(["arcana", "history", "investigation", "medicine", "nature", "religion"])}).value.forEach(s => G.expertise.add(s));
				if (/^Deft Explorer$/i.test(f.name)) {
					add({id: `feature:${f.uid}:expertise`, step, group: g, level: f.level, title: "Deft Explorer: expertise", type: "pick", count: 1, options: "proficientSkills"}).value.forEach(s => G.expertise.add(s));
					add({id: `feature:${f.uid}:languages`, step, group: g, level: f.level, title: "Deft Explorer: languages", type: "pick", count: 2, options: "languages"}).value.forEach(l => G.languages.add(l));
				}
			}

			// Spells: cantrips and prepared spells from the class table
			const colAt = (re) => { const col = cols.find(c => re.test(c.label)); return col ? Number(col.values[level - 1]) || 0 : 0; };
			// Subclass casters (Eldritch Knight, Arcane Trickster…) carry their own progressions and use another class's list
			const sc = res.subclass;
			const scCaster = !cls.casterProgression && !cls.spellcastingAbility && sc && (sc.casterProgression || sc.cantripProgression);
			const progAt = (arr) => Array.isArray(arr) ? Number(arr[level - 1]) || 0 : 0;
			const cantrips = colAt(/^Cantrips/i) || progAt(cls.cantripProgression) || (scCaster ? progAt(sc.cantripProgression) : 0);
			const prepared = colAt(/^(Prepared Spells|Spells Prepared|Spells Known)/i) || progAt(cls.preparedSpellsProgression) || progAt(cls.spellsKnownProgression)
				|| (scCaster ? progAt(sc.preparedSpellsProgression) || progAt(sc.spellsKnownProgression) : 0);
			const maxSpellLevel = cls.casterProgression === "pact"
				? (colAt(/^Slot Level/i) || 1)
				: (() => {
					const cl = casterLevelOf(cls, res.subclass, level);
					return cl ? FULL_SLOTS[Math.min(19, cl - 1)].length : 0;
				})();
			const listName = scCaster ? subclassSpellList(sc, res.features) : lc(cls.name);
			const spTitle = scCaster ? `${sc.name} (${listName.replace(/\b\w/g, ch => ch.toUpperCase())} list)` : cls.name;
			if (cantrips) {
				add({id: `class:${ck}:cantrips`, step: "spells", group: `${cls.name} spells`, title: `${spTitle} cantrips`, type: "spells", count: cantrips, filter: {level: ["0"], class: [listName]}})
					.value.forEach(r => { const e = spellsAll.find(s => same(s, r)); if (e) G.spells.push({ent: e, via: cls.name, cls: ck}); });
			}
			// 2014 prepared casters: "level + modifier" (settled once every ability bonus is known)
			const formula = !prepared && typeof cls.preparedSpells === "string" && maxSpellLevel ? cls.preparedSpells : null;
			if ((prepared || formula) && maxSpellLevel) {
				const pc = add({id: `class:${ck}:prepared`, step: "spells", group: `${cls.name} spells`, title: `${spTitle} prepared spells`, desc: `Up to level ${maxSpellLevel}.`, type: "spells", count: prepared || 1, filter: {level: Array.from({length: maxSpellLevel}, (_, i) => String(i + 1)), class: [listName]}})
				pc.value.forEach(r => { const e = spellsAll.find(s => same(s, r)); if (e) G.spells.push({ent: e, via: cls.name, cls: ck}); });
				if (formula) formulaChoices.push({c: pc, formula, level, abil: cls.spellcastingAbility});
			}
			// Always-prepared subclass spells
			if (res.subclass && res.subclass.additionalSpells) {
				for (const e of res.subclass.additionalSpells) {
					Object.entries(e.prepared || e.known || {}).forEach(([l, list]) => {
						if (Number(l) > level) return;
						(Array.isArray(list) ? list : []).forEach(s => {
							if (typeof s !== "string") return;
							const [name, src] = s.split("#")[0].split("|");
							const ent = spellsAll.find(x => lc(x.name) === lc(name) && lc(x.source) === lc(src || "phb"));
							if (ent) G.spells.push({ent, via: res.subclass.name, always: true, cls: ck, ability: ABILS.includes(e.ability) ? e.ability : null});
						});
					});
				}
			}
		}
		for (const fc of formulaChoices) {
			const v = Number(char.abilities.base?.[fc.abil]) || 10;
			const m = Math.floor((Math.min(20, v + (G.abilityBonus[fc.abil] || 0)) - 10) / 2);
			const expr = fc.formula.replace(/<\$level\$>/g, fc.level).replace(/<\$\w+_mod\$>/g, m);
			const n = /^\s*(\d+)\s*\/\s*(\d+)\s*\+\s*(-?\d+)\s*$/.exec(expr);
			const total = n ? Math.floor(n[1] / n[2]) + Number(n[3]) : (/^\s*(\d+)\s*\+\s*(-?\d+)\s*$/.test(expr) ? expr.split("+").reduce((a, x) => a + Number(x), 0) : 1);
			fc.c.count = Math.max(1, total);
			fc.c.desc = `${fc.c.desc} ${fc.formula.includes("/ 2") ? "Half your level" : "Your level"} + your ${ABIL_NAMES[fc.abil] || fc.abil} modifier.`;
			fc.c.complete = isComplete(fc.c);
		}
		// endregion

		// region Details: languages
		const langs = (await loadLanguages()).filter(l => (legacy || l.source === "XPHB") && l.type === "standard" && lc(l.name) !== "common");
		add({id: "details:languages", step: "details", group: "Languages", title: "Languages", desc: "You know Common plus two standard languages.", type: "pick", count: 2, options: langs.map(l => ({value: lc(l.name), label: l.name}))}).value.forEach(l => G.languages.add(l));
		// endregion

		// Extras added by hand (also characters made before the builder)
		(char.feats || []).forEach(r => { const f = findFeat(r); if (f && !G.feats.some(x => same(x.ent, f))) G.feats.push({ent: f, via: "Extra"}); });
		const ofsAll = await D().loadOptFeatures();
		(char.optfeatures || []).forEach(r => { const o = ofsAll.find(x => same(x, r)); if (o && !G.optfeatures.some(x => same(x.ent, o))) G.optfeatures.push({ent: o, via: "Extra"}); });
		(char.spells || []).forEach(r => { const s = spellsAll.find(x => same(x, r)); if (s && !G.spells.some(x => same(x.ent, s))) G.spells.push({ent: s, via: "Extra"}); });

		// Resolve skill-dependent option lists now that proficiencies are known
		const langOptions = (await loadLanguages()).filter(l => legacy || l.source === "XPHB").map(l => ({value: lc(l.name), label: l.name}));
		for (const c of choices) {
			if (c.options === "proficientSkills") c.options = skillOptions([...G.skills]);
			if (c.options === "languages") c.options = langOptions;
		}
		// A skill you already have from somewhere else is not offered again (the same for expertise and languages)
		const isSkillChoice = (c) => c.type === "pick" && /:(skills|stl)$/.test(c.id);
		const isExpertiseChoice = (c) => c.type === "pick" && /:expertise$/.test(c.id);
		const isLanguageChoice = (c) => c.type === "pick" && /:languages$/.test(c.id);
		const takenBy = (pred, extra = []) => (self) => {
			const out = new Set(extra);
			choices.filter(o => o !== self && pred(o)).forEach(o => (o.value || []).forEach(v => out.add(v)));
			return out;
		};
		const takenSkill = takenBy(isSkillChoice, G.fixedSkills);
		const takenExp = takenBy(isExpertiseChoice);
		const takenLang = takenBy(isLanguageChoice, ["common"]);
		for (const c of choices) {
			let taken = null;
			if (isSkillChoice(c)) taken = takenSkill(c);
			else if (isExpertiseChoice(c)) {
				taken = takenExp(c);
				c.options = c.options.filter(o => G.skills.has(o.value));
			} else if (isLanguageChoice(c)) taken = takenLang(c);
			if (!taken) continue;
			c.options = c.options.filter(o => !taken.has(o.value) || (c.value || []).includes(o.value));
			c.complete = isComplete(c);
		}

		const derived = derive(char, {species, background, classes: classesRes, G});
		const steps = stepStates(char, choices, derived);
		const prereq = prereqContext(derived, G);
		return {choices, steps, derived, prereq, byId: Object.fromEntries(choices.map(c => [c.id, c]))};
	};

	const findOptions = (entries) => {
		let found = null;
		const walk = (e) => {
			if (found || !e || typeof e !== "object") return;
			if (Array.isArray(e)) return e.forEach(walk);
			if (e.type === "options") {
				const names = (e.entries || []).map(x => (x.classFeature || x.subclassFeature || x.optionalfeature || x.name || "").split("|")[0]).filter(Boolean);
				if (names.length) found = {count: e.count || 1, names};
				return;
			}
			walk(e.entries);
		};
		walk(entries);
		return found;
	};

	/** "Elf; Drow Lineage" -> "Drow Elf", "Elf; High Elf Lineage" -> "High Elf", "Goliath; Stone Giant" -> "Goliath (Stone Giant)" */
	const speciesLabel = (name) => {
		const m = /^(.+?); (.+?)(?: Lineage| Legacy| Ancestry)?$/.exec(String(name));
		if (!m) return name;
		const [, base, sub] = m;
		if (lc(sub).includes(lc(base))) return sub;
		return /(Lineage|Legacy|Ancestry)$/.test(name) ? `${sub} ${base}` : `${base} (${sub})`;
	};

	const totalLevel = (char) => (char.classes || []).reduce((a, c) => a + (Number(c.level) || 0), 0);

	const ABIL_KEY = {strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha"};
	/**
	 * Which ability a granted spell uses: fixed in the data, the player's choice (asked through `ask(list)`),
	 * "inherit" (the ability the feat increased), or what the feature's text says. null = the class's own.
	 */
	const spellAbilityOf = (entry, {inherit, text}, ask) => {
		const ab = entry && entry.ability;
		if (ab && ab.choose) return ask(ab.choose);
		if (ab === "inherit") return inherit;
		if (typeof ab === "string" && ABILS.includes(ab)) return ab;
		const t = text ? D().strip(JSON.stringify(text)) : "";
		if (!t) return null;
		if (/ability (?:that was |you )?increased (?:by|with) this feat/i.test(t)) return inherit;
		const m = /((?:Intelligence|Wisdom|Charisma)(?:,\s*(?:Intelligence|Wisdom|Charisma))*,?\s*or\s*(?:Intelligence|Wisdom|Charisma))\s*\(choose/i.exec(t);
		if (m) return ask(m[1].split(/,\s*|\s*or\s*/).map(x => ABIL_KEY[lc(x.trim())]).filter(Boolean));
		const f = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) is your spellcasting ability/i.exec(t);
		return f ? ABIL_KEY[lc(f[1])] : null;
	};

	/** Spell attack and save DC for one spell (or the main ability) from a derived or Play-effective character. */
	const castFor = (d, s = null) => {
		const a = s?.cast?.ability || s?.ability || d.spellcasting?.ability;
		if (!a) return null;
		const mod = d.mods[a];
		const dc = 8 + d.pb + mod + (d.itemEffects?.spellDc || 0) + (d.spellDcBonus || 0);
		return {ability: a, abilityName: ABIL_NAMES[a], abbr: a.toUpperCase(), mod, dc, attack: d.pb + mod + (d.itemEffects?.spellAttack || 0)};
	};

	/** The class list a subclass caster learns from ("…from the Wizard spell list"), Wizard if the text doesn't say. */
	const subclassSpellList = (sc, features) => {
		const txt = JSON.stringify((features || []).filter(f => f.isSubclass).map(f => f.entries || f._raw?.entries));
		const m = /\b(Artificer|Bard|Cleric|Druid|Paladin|Ranger|Sorcerer|Warlock|Wizard) spell list/i.exec(txt);
		return lc(m ? m[1] : "wizard");
	};

	const casterLevelOf = (cls, subclass, level) => {
		const p = cls.casterProgression || (subclass && subclass.casterProgression);
		switch (p) {
			case "full": return level;
			case "artificer": return Math.ceil(level / 2);
			case "1/2": return Math.floor(level / 2);
			case "1/3": return Math.floor(level / 3);
			default: return 0;
		}
	};
	// endregion

	// region Equipment effects
	const itemType = (ent) => String(ent?.type || "").split("|")[0];
	const isArmorEnt = (ent) => ["LA", "MA", "HA"].includes(itemType(ent)) || (!!ent?.armor && itemType(ent) !== "S");
	const isShieldEnt = (ent) => itemType(ent) === "S";
	/** How an item is equipped: "worn" (armor, wearables), "wielded" (weapons, shields), "attuned", or null. */
	const equipKind = (ent) => {
		if (!ent) return null;
		if (isArmorEnt(ent)) return "worn";
		if (ent.weapon || isShieldEnt(ent)) return "wielded";
		if (ent.reqAttune) return "attuned";
		if (ent.wondrous || ["RG", "RD", "WD", "ST", "SCF"].includes(itemType(ent)) || ent.bonusAc || ent.bonusSavingThrow || ent.ability || ent.bonusSpellAttack || ent.bonusSpellSaveDc || ent.modifySpeed) return "worn";
		return null;
	};
	const num = (v) => Number(String(v ?? 0).replace(/[^-\d]/g, "")) || 0;

	/** Totals of what the equipped items grant. */
	const itemEffects = (items) => {
		const eq = items.filter(i => i.equipped && i.ent && equipKind(i.ent));
		const fx = {ac: 0, save: 0, spellAttack: 0, spellDc: 0, abilityStatic: {}, abilityBonus: {}, speedBonus: 0, speedStatic: {}, speedEqual: {}, resist: [], immune: [], condImmune: [], attuned: 0, sources: []};
		eq.forEach(i => {
			const e = i.ent;
			if (e.reqAttune) fx.attuned++;
			const note = (what) => fx.sources.push(`${e.name}: ${what}`);
			if (e.bonusAc && !isArmorEnt(e) && !isShieldEnt(e)) { fx.ac += num(e.bonusAc); note(`${e.bonusAc} AC`); }
			if (e.bonusSavingThrow) { fx.save += num(e.bonusSavingThrow); note(`${e.bonusSavingThrow} saves`); }
			if (e.bonusSpellAttack) { fx.spellAttack += num(e.bonusSpellAttack); note(`${e.bonusSpellAttack} spell attacks`); }
			if (e.bonusSpellSaveDc) { fx.spellDc += num(e.bonusSpellSaveDc); note(`${e.bonusSpellSaveDc} spell save DC`); }
			const ab = e.ability || {};
			Object.entries(ab.static || {}).forEach(([a, v]) => { fx.abilityStatic[a] = Math.max(fx.abilityStatic[a] || 0, v); note(`${a.toUpperCase()} ${v}`); });
			ABILS.forEach(a => { if (typeof ab[a] === "number") { fx.abilityBonus[a] = (fx.abilityBonus[a] || 0) + ab[a]; note(`${signed(ab[a])} ${a.toUpperCase()}`); } });
			const ms = e.modifySpeed || {};
			if (ms.bonus) fx.speedBonus += num(ms.bonus["*"] ?? ms.bonus.walk);
			Object.entries(ms.static || {}).forEach(([k, v]) => { fx.speedStatic[k] = Math.max(fx.speedStatic[k] || 0, v); });
			Object.entries(ms.equal || {}).forEach(([k, v]) => { fx.speedEqual[k] = v; });
			(e.resist || []).forEach(r => typeof r === "string" && fx.resist.push(r));
			(e.immune || []).forEach(r => typeof r === "string" && fx.immune.push(r));
			(e.conditionImmune || []).forEach(r => typeof r === "string" && fx.condImmune.push(r));
		});
		return fx;
	};
	// endregion

	// region Derived numbers
	const derive = (char, ctx) => {
		const {species, background, classes, G} = ctx;
		const total = Math.max(1, totalLevel(char));
		const pb = Math.ceil(total / 4) + 1;

		// Ability scores
		const base = {};
		const method = char.abilities.method || "standard";
		ABILS.forEach(a => {
			const v = Number(char.abilities.base?.[a]);
			base[a] = Number.isFinite(v) && v > 0 ? v : (method === "pointbuy" ? 8 : 10);
		});
		// Equipped items come first: some set or raise ability scores
		const inv = char.equipment.items || [];
		const items = inv.map(it => {
			const ent = _cache.itemsResolved ? _cache.itemsResolved.get(refKey(it)) : null;
			return {...it, ent, equipKind: equipKind(ent)};
		});
		const fx = itemEffects(items);
		const scores = {};
		ABILS.forEach(a => {
			scores[a] = Math.min(20, base[a] + (G.abilityBonus[a] || 0)) + (fx.abilityBonus[a] || 0);
			if (fx.abilityStatic[a]) scores[a] = Math.max(scores[a], fx.abilityStatic[a]);
		});
		const mods = Object.fromEntries(ABILS.map(a => [a, mod(scores[a])]));

		// Saves and skills
		const saves = Object.fromEntries(ABILS.map(a => [a, {prof: G.saves.has(a), bonus: mods[a] + (G.saves.has(a) ? pb : 0) + fx.save}]));
		// Bard 2+: Jack of All Trades adds half the Proficiency Bonus to checks without proficiency
		const jack = classes.some(c => c.cls.name === "Bard" && c.level >= 2) ? Math.floor(pb / 2) : 0;
		const skills = Object.fromEntries(SKILL_LIST.map(s => {
			const prof = G.skills.has(s);
			const exp = prof && G.expertise.has(s);
			return [s, {ability: SKILLS[s], prof, exp, half: !prof && !!jack, bonus: mods[SKILLS[s]] + (exp ? 2 * pb : prof ? pb : jack)}];
		}));

		// Hit points
		const featNames = new Set(G.feats.map(f => lc(f.ent.name)));
		let hp = 0;
		classes.forEach((c, i) => {
			const hd = c.cls.hd ? c.cls.hd.faces : 8;
			for (let l = 1; l <= c.level; ++l) hp += (i === 0 && l === 1 ? hd : Math.floor(hd / 2) + 1) + mods.con;
		});
		if (featNames.has("tough")) hp += 2 * total;
		if (species && /dwarf/i.test(species.name)) hp += total;
		hp = Math.max(1, hp);
		if (Number(char.hpOverride) > 0) hp = Number(char.hpOverride);
		const hitDice = classes.map(c => `${c.level}d${c.cls.hd ? c.cls.hd.faces : 8}`).join(" + ");

		// Equipment, armor class, attacks
		const armor = items.find(i => i.equipped && i.ent && isArmorEnt(i.ent));
		const shield = items.find(i => i.equipped && i.ent && isShieldEnt(i.ent));
		const firstCls = classes[0]?.cls?.name || "";
		let ac;
		let acNote;
		if (armor) {
			const t = String(armor.ent.type).split("|")[0];
			const dexPart = t === "HA" ? 0 : t === "MA" ? Math.min(2, mods.dex) : mods.dex;
			ac = (armor.ent.ac || 10) + dexPart + num(armor.ent.bonusAc);
			acNote = armor.ent.name;
		} else if (classes.some(c => c.cls.name === "Barbarian")) { ac = 10 + mods.dex + mods.con; acNote = "Unarmored Defense"; } else if (classes.some(c => c.cls.name === "Monk") && !shield) { ac = 10 + mods.dex + mods.wis; acNote = "Unarmored Defense"; } else { ac = 10 + mods.dex; acNote = "Unarmored"; }
		if (shield) { ac += (shield.ent.ac || 2) + num(shield.ent.bonusAc); acNote += ` + ${shield.ent.name}`; }
		if (fx.ac) { ac += fx.ac; acNote += ` ${signed(fx.ac)} items`; }

		// Proficiency text can carry 5etools tags ("{@filter Finesse or Light|items|…}"): compare plain text
		const weaponProfs = new Set([...G.weapons].map(x => lc(D().strip(x))));
		const profWeapon = (w) => {
			const G = {weapons: weaponProfs};
			const cat = lc(w.weaponCategory);
			if (G.weapons.has(cat) || G.weapons.has(`${cat} weapons`)) return true;
			if (G.weapons.has(lc(w.name)) || G.weapons.has(`${lc(w.name)}s`)) return true;
			const props = (w.property || []).map(p => String(p).split("|")[0]);
			if (G.weapons.has("martial weapons that have the finesse or light property") && cat === "martial" && (props.includes("F") || props.includes("L"))) return true;
			return false;
		};
		// Wielded weapons; with none marked, every weapon carried (older characters)
		// Class table values at the character's level (Martial Arts die, Unarmored Movement…)
		const colOf = (clsName, re) => {
			const c = classes.find(x => x.cls.name === clsName);
			const col = c && (c.cols || []).find(x => re.test(x.label));
			return col ? col.values[c.level - 1] : null;
		};
		const monk = classes.find(c => c.cls.name === "Monk");
		const martialDie = monk ? colOf("Monk", /^Martial Arts$/i) : null;
		const attacks = items.filter(i => i.ent && i.ent.weapon && (i.equipped || !items.some(x => x.equipped && x.ent && x.ent.weapon))).map(i => {
			const w = i.ent;
			const props = (w.property || []).map(p => String(p).split("|")[0]);
			const ranged = String(w.type || "").split("|")[0] === "R";
			// Monk weapons (simple melee, martial melee with Light) can use Dexterity through Martial Arts
			const monkWeapon = monk && !ranged && (lc(w.weaponCategory) === "simple" || props.includes("L"));
			const useDex = ranged || ((props.includes("F") || monkWeapon) && mods.dex > mods.str);
			const m = useDex ? mods.dex : mods.str;
			const prof = profWeapon(w);
			const mastery = G.masteries.includes(lc(w.name)) ? (w.mastery || []).map(x => x.split("|")[0]).join(", ") : "";
			const magicHit = num(w.bonusWeapon) + num(w.bonusWeaponAttack);
			const dm = m + num(w.bonusWeapon) + num(w.bonusWeaponDamage);
			const dmg = w.dmg1 ? `${w.dmg1}${dm ? signed(dm) : ""} ${DMG_TYPES[w.dmgType] || ""}`.trim() : "";
			return {name: w.name, abil: useDex ? "dex" : "str", melee: !ranged, bonus: m + (prof ? pb : 0) + magicHit, damage: dmg, versatile: w.dmg2 ? `${w.dmg2}${dm ? signed(dm) : ""}` : "", dice: w.dmg1 || "", magicHit, magicDmg: num(w.bonusWeapon) + num(w.bonusWeaponDamage), dmgType: DMG_TYPES[w.dmgType] || "", range: w.range || (props.includes("T") ? "thrown" : ""), props: props.map(p => ({V: "Versatile", F: "Finesse", L: "Light", H: "Heavy", R: "Reach", T: "Thrown", "2H": "Two-Handed", A: "Ammunition", LD: "Loading"}[p] || p)).join(", "), mastery, prof};
		});
		// Unarmed strike always (Monks: Martial Arts die and the better of STR/DEX)
		if (martialDie) {
			const um = Math.max(mods.str, mods.dex);
			attacks.push({name: "Unarmed Strike", abil: mods.dex > mods.str ? "dex" : "str", melee: true, bonus: um + pb, damage: `${martialDie}${um ? signed(um) : ""} Bludgeoning`, props: "Martial Arts", mastery: "", prof: true});
		} else attacks.push({name: "Unarmed Strike", abil: "str", melee: true, bonus: mods.str + pb, damage: `${Math.max(1, 1 + mods.str)} Bludgeoning`, props: "", mastery: "", prof: true});

		// Spellcasting
		const casting = [];
		let combined = 0;
		let casterClasses = 0;
		classes.forEach(c => {
			const abilKey = c.cls.spellcastingAbility || (c.subclass && c.subclass.spellcastingAbility);
			if (!abilKey) return;
			const cl = casterLevelOf(c.cls, c.subclass, c.level);
			if (c.cls.casterProgression !== "pact") { combined += cl; if (cl) casterClasses++; }
			const viaSub = !c.cls.spellcastingAbility && c.subclass;
			casting.push({cls: c.cls.name, ck: refKey(c.cls), label: viaSub ? `${c.cls.name} (${c.subclass.name})` : c.cls.name, real: !!cl || c.cls.casterProgression === "pact", ability: abilKey, abilityName: ABIL_NAMES[abilKey], dc: 8 + pb + mods[abilKey] + fx.spellDc, attack: pb + mods[abilKey] + fx.spellAttack, pact: c.cls.casterProgression === "pact" ? {slots: PACT[c.level - 1][0], level: PACT[c.level - 1][1]} : null});
		});
		const slots = combined ? FULL_SLOTS[Math.min(19, combined - 1)] : [];

		// Spells grouped (deduped, keep the first source)
		const spellMap = new Map();
		G.spells.forEach(s => { if (!spellMap.has(refKey(s.ent))) spellMap.set(refKey(s.ent), s); });
		const spellList = [...spellMap.values()].sort((a, b) => a.ent.level - b.ent.level || a.ent.name.localeCompare(b.ent.name));
		// Spellcasting ability: the main one (a casting class, else the most used grant), and per spell
		const castNums = (a) => ({ability: a, abilityName: ABIL_NAMES[a], abbr: a.toUpperCase(), mod: mods[a], dc: 8 + pb + mods[a] + fx.spellDc, attack: pb + mods[a] + fx.spellAttack});
		const mainCast = casting.find(c => c.real) || casting[0] || null;
		const byClass = Object.fromEntries(casting.map(c => [c.ck, c.ability]));
		const grantCount = {};
		spellList.forEach(s => { if (s.ability) grantCount[s.ability] = (grantCount[s.ability] || 0) + 1; });
		const mainAbility = mainCast ? mainCast.ability : Object.keys(grantCount).sort((a, b) => grantCount[b] - grantCount[a])[0] || null;
		const spellcasting = mainAbility ? {...castNums(mainAbility), source: mainCast ? mainCast.label : spellList.find(s => s.ability === mainAbility)?.via || ""} : null;
		const otherSources = new Map();
		spellList.forEach(s => {
			const a = s.ability || (s.cls && byClass[s.cls]) || mainAbility;
			s.cast = a ? castNums(a) : null;
			s.altAbility = !!(a && mainAbility && a !== mainAbility);
			if (s.altAbility) {
				const k = `${s.via}|${a}`;
				if (!otherSources.has(k)) otherSources.set(k, {source: s.via, ...castNums(a), spells: []});
				otherSources.get(k).spells.push(s.ent.name);
			}
		});

		let speed = (species ? (typeof species.speed === "number" ? species.speed : species.speed?.walk || 30) : 30) + fx.speedBonus;
		if (fx.speedStatic.walk) speed = Math.max(speed, fx.speedStatic.walk);
		const speedNotes = [];
		// Monk: Unarmored Movement without armor or shield; Barbarian 5+: Fast Movement without heavy armor
		const um = monk ? Number(String(colOf("Monk", /^Unarmored Movement$/i) || "").replace(/[^\d]/g, "")) : 0;
		if (um && !armor && !shield) { speed += um; speedNotes.push(`+${um} Unarmored Movement`); }
		const barb = classes.find(c => c.cls.name === "Barbarian");
		if (barb && barb.level >= 5 && !(armor && itemType(armor.ent) === "HA")) { speed += 10; speedNotes.push("+10 Fast Movement"); }
		const sizeChoice = char.choices["species:size"]?.[0];
		const size = sizeChoice || (species?.size || ["M"])[0];

		return {
			name: char.name || "Unnamed",
			player: char.player || "",
			totalLevel: total,
			pb,
			species: species ? speciesLabel(species.name) : null,
			speciesEnt: species,
			background: background?.name || null,
			backgroundEnt: background,
			classes: classes.map(c => ({name: c.cls.name, level: c.level, subclass: c.subclass?.name || null, hd: c.cls.hd ? `d${c.cls.hd.faces}` : "d8", ent: c.cls, subclassEnt: c.subclass, features: c.features, core: c.core, cols: c.cols, isFirst: c.isFirst})),
			classLine: classes.map(c => `${c.cls.name} ${c.level}`).join(" / "),
			base, scores, mods, saves, skills,
			hp, hitDice, ac, acNote,
			initiative: mods.dex + (featNames.has("alert") ? pb : jack),
			speed, speedNotes, size: Parser.sizeAbvToFull ? Parser.sizeAbvToFull(size) : size,
			darkvision: species?.darkvision || 0,
			passive: {perception: 10 + skills.perception.bonus, insight: 10 + skills.insight.bonus, investigation: 10 + skills.investigation.bonus},
			armorProf: [...G.armor].map(titleCase), weaponProf: [...G.weapons].map(x => titleCase(D().strip(x))),
			tools: [...G.tools].map(titleCase), languages: [...G.languages].map(titleCase), resist: [...G.resist, ...fx.resist].map(titleCase), immune: fx.immune.map(titleCase), condImmune: fx.condImmune.map(titleCase), itemEffects: fx,
			masteries: G.masteries.map(titleCase),
			feats: G.feats, optfeatures: G.optfeatures, spells: spellList, featureOptions: G.featureOptions,
			casting, slots, multiclassCaster: casterClasses > 1, spellcasting, spellSources: [...otherSources.values()],
			attacks, items, cp: char.equipment.cp || 0,
			details: char.details || {},
			portrait: char.portrait || null,
		};
	};
	// endregion

	// region Steps
	const STEPS = [
		{id: "start", label: "Start"},
		{id: "species", label: "Species"},
		{id: "background", label: "Background"},
		{id: "class", label: "Class"},
		{id: "abilities", label: "Abilities"},
		{id: "spells", label: "Spells"},
		{id: "equipment", label: "Equipment"},
		{id: "details", label: "Details"},
	];
	const stepStates = (char, choices, derived) => {
		const st = {};
		const choiceState = (step) => {
			const cs = choices.filter(c => c.step === step);
			if (!cs.length) return "Completed";
			return cs.every(c => c.complete) ? "Completed" : "In progress";
		};
		st.start = char.name && !["New Hero", "New Character"].includes(char.name) ? "Completed" : "In progress";
		st.species = !char.species ? "Not started" : choiceState("species");
		st.background = !char.background ? "Not started" : choiceState("background");
		st.class = !char.classes.length ? "Not started" : choiceState("class");
		const m = char.abilities.method || "standard";
		const b = char.abilities.base || {};
		const filled = ABILS.every(a => Number(b[a]) > 0);
		let abilOk = filled;
		if (m === "standard") abilOk = filled && [...ABILS.map(a => Number(b[a]))].sort((x, y) => y - x).join() === STANDARD_ARRAY.join();
		if (m === "pointbuy") abilOk = filled && ABILS.reduce((s, a) => s + (POINT_COST[b[a]] ?? 99), 0) <= POINT_BUDGET;
		st.abilities = abilOk ? "Completed" : (filled ? "In progress" : "Not started");
		st.spells = choices.some(c => c.step === "spells") ? choiceState("spells") : "Optional";
		st.equipment = choices.some(c => c.step === "equipment") ? choiceState("equipment") : (derived.items.length ? "Completed" : "Optional");
		st.details = choiceState("details");
		return st;
	};
	// endregion

	// region Equipment helpers
	const resolveItems = async () => {
		const {byKey} = await loadItems();
		_cache.itemsResolved = byKey;
		return byKey;
	};

	/** Turn a starting-equipment option into inventory entries + coins (cp). */
	const equipmentFrom = async (list) => {
		const byKey = await resolveItems();
		const items = [];
		let cp = 0;
		for (const e of (list || [])) {
			if (typeof e === "string") { const [n, s] = e.split("|"); items.push({name: titleCase(n), source: (s || "XPHB").toUpperCase(), qty: 1}); continue; }
			if (e.value) { cp += e.value; continue; }
			if (e.item) {
				const [n, s] = e.item.split("|");
				const ent = byKey.get(`${lc(n)}|${lc(s || "phb")}`);
				items.push({name: ent ? ent.name : titleCase(n), source: ent ? ent.source : (s || "XPHB").toUpperCase(), qty: e.quantity || 1, equipped: !!(ent && (ent.armor || ent.weapon || isShieldEnt(ent)))});
				continue;
			}
			if (e.equipmentType) items.push({name: {setGaming: "Gaming Set (your choice)", toolArtisan: "Artisan's Tools (your choice)", instrumentMusical: "Musical Instrument (your choice)", focusSpellcastingArcane: "Arcane Focus (your choice)", focusSpellcastingHoly: "Holy Symbol (your choice)", focusSpellcastingDruidic: "Druidic Focus (your choice)", weaponSimple: "Simple Weapon (your choice)", weaponMartial: "Martial Weapon (your choice)"}[e.equipmentType] || titleCase(e.equipmentType), source: "", qty: e.quantity || 1, custom: true});
			if (e.special) items.push({name: titleCase(e.special), source: "", qty: e.quantity || 1, custom: true});
		}
		return {items, cp};
	};
	const describeEquipment = (list) => (list || []).map(e => {
		if (e.value) return `${e.value / 100} GP`;
		if (e.item) return `${e.quantity && e.quantity > 1 ? e.quantity + " × " : ""}${titleCase(e.item.split("|")[0])}`;
		if (e.equipmentType) return titleCase(e.equipmentType.replace(/([A-Z])/g, " $1"));
		if (e.special) return e.special;
		return "";
	}).filter(Boolean).join(", ");
	// endregion

	// region Prerequisites
	/** What prerequisites are checked against. */
	const prereqContext = (d, G) => {
		const classLevels = {};
		d.classes.forEach(c => { classLevels[lc(c.name)] = (classLevels[lc(c.name)] || 0) + c.level; });
		const features = new Set();
		d.classes.forEach(c => c.features.filter(f => f.level <= c.level).forEach(f => features.add(lc(f.name))));
		(d.speciesEnt?.entries || []).forEach(e => { if (e && e.name) features.add(lc(e.name)); });
		G.featureOptions.forEach(o => features.add(lc(o.option)));
		return {
			totalLevel: d.totalLevel,
			classLevels,
			subclasses: d.classes.map(c => lc(c.subclass || "")).filter(Boolean),
			scores: d.scores,
			armor: new Set([...G.armor].map(a => lc(a).replace(/ armor$/, "").replace(/^shields?$/, "shield"))),
			weapons: new Set([...G.weapons].map(lc)),
			casting: d.casting.length > 0,
			spells: d.spells.map(s => s.ent),
			feats: G.feats.map(f => f.ent),
			optfeatures: G.optfeatures.map(o => o.ent),
			features,
			species: lc(d.speciesEnt?.name || ""),
			background: lc(d.background || ""),
		};
	};

	const nameOf = (ref) => lc(String(ref).split("|")[0].split("#")[0]);

	/** One alternative (all of its keys must hold). Returns false, true, or "unverified" for things outside the app's knowledge. */
	const checkAlternative = (p, ctx) => {
		let unverified = false;
		for (const [k, v] of Object.entries(p)) {
			switch (k) {
				case "level": {
					if (typeof v === "number") { if (ctx.totalLevel < v) return false; break; }
					const need = v.level || 1;
					if (v.class) { if ((ctx.classLevels[lc(v.class.name)] || 0) < need) return false; } else if (ctx.totalLevel < need) return false;
					if (v.subclass && !ctx.subclasses.some(s => s.includes(lc(v.subclass.name)))) return false;
					break;
				}
				case "ability":
					if (!v.some(o => Object.entries(o).every(([a, min]) => (ctx.scores[a] || 0) >= min))) return false;
					break;
				case "proficiency":
					if (!v.some(o => Object.entries(o).every(([kind, what]) => {
						if (kind === "armor") return ctx.armor.has(lc(what).replace(/ armor$/, ""));
						if (kind === "weapon" || kind === "weaponGroup") return ctx.weapons.has(lc(what)) || ctx.weapons.has(`${lc(what)} weapons`);
						unverified = true;
						return true;
					}))) return false;
					break;
				case "spellcasting":
				case "spellcasting2020":
				case "spellcastingFeature":
				case "spellcastingPrepared":
					if (!ctx.casting) return false;
					break;
				case "feat":
					if (!v.some(f => ctx.feats.some(e => lc(e.name) === nameOf(f)))) return false;
					break;
				case "feature":
					if (!v.some(f => ctx.features.has(lc(f)))) return false;
					break;
				case "optionalfeature":
					if (!v.some(o => ctx.optfeatures.some(e => lc(e.name) === nameOf(o)))) return false;
					break;
				case "pact":
					if (!ctx.optfeatures.some(e => lc(e.name) === `pact of the ${lc(v)}`)) return false;
					break;
				case "patron":
					if (!ctx.subclasses.some(s => s.includes(lc(v)))) return false;
					break;
				case "spell":
					if (!v.some(sp => {
						if (typeof sp === "string") return ctx.spells.some(e => lc(e.name) === nameOf(sp));
						if (sp && sp.choose) { const f = parseSpellFilter(sp.choose); return ctx.spells.some(e => spellMatches(e, f)); }
						return true;
					})) return false;
					break;
				case "race":
					if (!v.some(r => ctx.species.includes(lc(r.name)))) return false;
					break;
				case "background":
					if (!v.some(b => ctx.background === lc(b.name))) return false;
					break;
				default:
					// campaign, item, other, otherSummary and similar can't be checked here
					unverified = true;
			}
		}
		return unverified ? "unverified" : true;
	};

	/** @return {{ok: boolean, unverified: boolean}} */
	const meetsPrereq = (ent, ctx) => {
		const alts = ent.prerequisite;
		if (!alts || !alts.length || !ctx) return {ok: true, unverified: false};
		let unverified = false;
		for (const p of alts) {
			const r = checkAlternative(p, ctx);
			if (r === true) return {ok: true, unverified: false};
			if (r === "unverified") unverified = true;
		}
		return {ok: unverified, unverified};
	};

	/**
	 * 2024 multiclassing: 13+ in the primary ability of every current class and of the new one.
	 * @return {{ok: boolean, reason: string}}
	 */
	const primaryOk = (cls, scores) => {
		const req = cls.multiclassing?.requirements;
		if (req) {
			const one = (o) => Object.entries(o).filter(([k]) => ABILS.includes(k)).every(([k, v]) => (scores[k] || 0) >= v);
			return req.or ? req.or.some(one) : one(req);
		}
		const opts = cls.primaryAbility || [];
		if (!opts.length) return true;
		return opts.some(o => Object.keys(o).filter(k => o[k]).every(k => (scores[k] || 0) >= 13));
	};
	const multiclassCheck = (newCls, currentClasses, scores) => {
		const bad = currentClasses.filter(c => !primaryOk(c, scores)).map(c => c.name);
		if (bad.length) return {ok: false, reason: `Needs 13+ in the primary ability of ${bad.join(", ")}`};
		if (!primaryOk(newCls, scores)) return {ok: false, reason: "Needs 13+ in its primary ability"};
		return {ok: true, reason: ""};
	};
	// endregion

	// region Feature list (hero view, cards)
	/** How a feature is used, read from its text: Action / Bonus Action / Reaction / Passive, plus a uses note. */
	const activationOf = (entries) => {
		const t = D().strip(JSON.stringify(entries || [])).replace(/\\"/g, "\"");
		let act = "Passive";
		if (/as a Reaction|take a Reaction|use your Reaction/i.test(t)) act = "Reaction";
		else if (/as a Bonus Action|take a Bonus Action/i.test(t)) act = "Bonus Action";
		else if (/as an? (Magic )?action|take the (Magic|Attack) action|(Magic|Utilize) action/i.test(t)) act = "Action";
		let uses = "";
		const m = /(once|twice|\w+ times) (?:per|until you finish a) (Short or Long Rest|Long Rest|Short Rest)/i.exec(t)
			|| /regain (?:all )?expended uses when you finish a (Short or Long Rest|Long Rest|Short Rest)/i.exec(t)
			|| /can't (?:use|do) (?:it|this|so) again until you finish a (Short or Long Rest|Long Rest|Short Rest)/i.exec(t);
		if (m) uses = m.length > 2 ? `${titleCase(m[1])} / ${m[2]}` : `Recharges: ${m[1]}`;
		return {act, uses};
	};

	/** Everything the hero has, in sheet order. */
	const featureList = (d) => {
		const out = [];
		const isCatalogue = (f) => /Options$/i.test(f.name);
		d.classes.forEach(c => {
			const seen = new Set();
			c.features.filter(f => f.level <= c.level && !isCatalogue(f) && !(f.isSubclassGate && /^Subclass Feature$/i.test(f.name))).forEach(f => {
				const sig = `${f.name}`;
				if (seen.has(sig) && /Ability Score Improvement|Epic Boon/i.test(f.name)) return;
				seen.add(sig);
				out.push({name: f.name, kind: f.isSubclass ? "Subclass" : "Class", group: f.isSubclass ? (c.subclass || c.name) : c.name, level: f.level, entries: f.entries, key: f.key, ...activationOf(f.entries)});
			});
		});
		if (d.speciesEnt) (d.speciesEnt.entries || []).filter(e => e && e.name).forEach(e => out.push({name: e.name, kind: "Species", group: d.species, entries: e.entries || [], key: `species:${refKey(d.speciesEnt)}`, ...activationOf(e.entries)}));
		d.feats.forEach(f => out.push({name: f.ent.name, kind: "Feat", group: f.via, entries: f.ent.entries || [], key: `feat:${refKey(f.ent)}`, ...activationOf(f.ent.entries)}));
		d.optfeatures.forEach(o => out.push({name: o.ent.name, kind: "Option", group: (o.ent.featureType || []).map(t => { try { return Parser.optFeatureTypeToFull(t); } catch (e) { return t; } }).join(", "), entries: o.ent.entries || [], key: `optfeature:${refKey(o.ent)}`, ...activationOf(o.ent.entries)}));
		return out;
	};
	// endregion

	return {
		featureList, activationOf, meetsPrereq, multiclassCheck, speciesLabel,
		ABILS, ABIL_NAMES, STANDARD_ARRAY, POINT_COST, POINT_BUDGET, SKILLS, SKILL_LIST, ALIGNMENTS, STEPS,
		ensure, analyze, normalize, castFor, equipKind, itemEffects, isArmorEnt, isShieldEnt, baseSpecies, versionsOf, loadItems, resolveItems, equipmentFrom, describeEquipment,
		spellMatches, mod, signed, titleCase, totalLevel, refKey, same,
	};
})();
