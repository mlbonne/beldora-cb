"use strict";

/**
 * House-rule kinds beyond species: background, spell, item (equipment), feat and language.
 * Each kind: an editor (form → record.data), a compiler (record → 5etools-shaped entity the loaders append)
 * and a reader that pre-fills the form when an existing entity is reworked. See house-rules.js.
 */
(() => {
	const H = TBHouse;
	const U = H.util;
	const {h, field, chipsSelect, textEntries, sourceOf, esc, lc, editorModal, visible} = U;
	const R = () => TBRules;
	const D = () => TBData;
	const ABILS = ["str", "dex", "con", "int", "wis", "cha"];
	const ABIL_FULL = {str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma"};
	const tagOf = (r, owner, kind) => ({id: r.id, owner: owner.id, shared: !!r.shared, kind});
	const refStr = (r) => `${lc(r.name)}|${lc(r.source)}`;
	const parseRef = (s) => { const [name, source] = String(s).split("#")[0].split("|"); return {name, source: source || "PHB"}; };
	const num = (el) => (el.value === "" ? null : Number(el.value));
	const sel = (opts, cur) => h("select", ...opts.map(([v, l]) => h("option", {value: v, selected: String(cur ?? "") === String(v)}, l)));
	const text = (v, ph = "") => h("input", {type: "text", value: v || "", placeholder: ph});
	const area = (v, rows, ph = "") => { const t = h("textarea", {rows, placeholder: ph}); t.value = v || ""; return t; };
	const row = (...els) => h("div.row", {style: {gap: "10px", flexWrap: "wrap", alignItems: "flex-end"}}, ...els);
	const sharedBox = (rec) => h("input", {type: "checkbox", checked: !!rec.shared});
	/** 5etools entries back to editable text: strings keep their {@tags}; named blocks become "Name. text". */
	const entriesToText = (entries) => (entries || []).map(e => {
		if (typeof e === "string") return e;
		if (e && e.type === "list") return (e.items || []).map(i => (typeof i === "string" ? `• ${i}` : `• ${i.name ? i.name + " " : ""}${i.entry || entriesToText(i.entries)}`)).join("\n");
		if (e && e.entries) return `${e.name ? e.name + ". " : ""}${entriesToText(e.entries)}`;
		return "";
	}).filter(Boolean).join("\n\n");
	const basedLine = (rec) => (rec.basedOn ? h("div.hr-based", `Reworking ${rec.basedOn.name} (${D().sourceShort(rec.basedOn.source)}). The original stays as it is; this house rule is separate.`) : null);
	/** A list of {name, source, qty?} chosen with the item picker. */
	const itemList = (char, list, {qty = false, label = "+ Item"} = {}) => {
		const el = h("div.hr-chips");
		const draw = () => {
			TBUI.clear(el);
			list.forEach((it, i) => el.appendChild(h("span.chip.on", `${qty && it.qty > 1 ? it.qty + " × " : ""}${it.name} `, h("b", {style: {cursor: "pointer"}, on: {click: () => { list.splice(i, 1); draw(); }}}, "✕"))));
			el.appendChild(h("button.btn.small", {type: "button", on: {click: async () => {
				const {all} = await R().loadItems();
				TBPickers.open({title: "Choose items", prop: "item", multi: true, load: async () => all.filter(i => i.name && visible(i, char)), onPick: (e) => {
					const have = list.find(x => x.name === e.name && x.source === e.source);
					if (have) have.qty = (have.qty || 1) + 1; else list.push({name: e.name, source: e.source, qty: 1});
					draw();
				}});
			}}}, label));
		};
		draw();
		return el;
	};

	// region Background
	const TOOL_ANY = [["anyArtisansTool", "Any Artisan's Tools (player chooses)"], ["anyGamingSet", "Any Gaming Set (player chooses)"], ["anyMusicalInstrument", "Any Musical Instrument (player chooses)"], ["anyTool", "Any tool (player chooses)"]];
	const compileBackground = (r, owner) => {
		const d = r.data || {};
		const abil = (d.abilities || []).filter(a => ABILS.includes(a));
		const skills = d.skills || [];
		const feat = d.feat || null;
		const items = d.items || [];
		const ent = {name: d.name || r.title || "House rule background", source: sourceOf(r), edition: "one", _tbHR: tagOf(r, owner, "background")};
		if (abil.length) ent.ability = [{choose: {weighted: {from: abil, weights: [2, 1]}}}, ...(abil.length >= 3 ? [{choose: {weighted: {from: abil, weights: [1, 1, 1]}}}] : [])];
		if (feat) ent.feats = [{[refStr(feat)]: true}];
		if (skills.length) ent.skillProficiencies = [Object.fromEntries(skills.map(s => [s, true]))];
		if (d.tool) ent.toolProficiencies = [/^any/.test(d.tool) ? {[d.tool]: 1} : {[lc(d.tool)]: true}];
		const gold = Math.max(0, Number(d.gold) || 0);
		const alt = Math.max(0, Number(d.altGold ?? 50) || 0);
		if (items.length || gold || alt) ent.startingEquipment = [{A: [...items.map(i => ({item: refStr(i), ...((i.qty || 1) > 1 ? {quantity: i.qty} : {})})), ...(gold ? [{value: Math.round(gold * 100)}] : [])], B: [{value: Math.round(alt * 100)}]}];
		const toolLabel = d.tool ? (TOOL_ANY.find(([v]) => v === d.tool) || [null, R().titleCase(d.tool)])[1] : "";
		ent.entries = [...textEntries(d.description), {type: "list", style: "list-hang-notitle", items: [
			abil.length ? {type: "item", name: "Ability Scores:", entry: abil.map(a => R().ABIL_NAMES[a]).join(", ")} : null,
			feat ? {type: "item", name: "Feat:", entry: `{@feat ${feat.name}|${feat.source}}`} : null,
			skills.length ? {type: "item", name: "Skill Proficiencies:", entry: skills.map(s => R().titleCase(s)).join(", ")} : null,
			toolLabel ? {type: "item", name: "Tool Proficiency:", entry: toolLabel} : null,
			ent.startingEquipment ? {type: "item", name: "Equipment:", entry: `Choose A or B: (A) ${[...items.map(i => `${(i.qty || 1) > 1 ? i.qty + " " : ""}${i.name}`), gold ? `${gold} GP` : ""].filter(Boolean).join(", ") || "nothing"}; or (B) ${alt} GP`} : null,
		].filter(Boolean)}];
		return ent;
	};
	const backgroundFrom = (ent) => {
		const w = ((ent.ability || [])[0] || {}).choose;
		const tp = (ent.toolProficiencies || [])[0] || {};
		const tk = Object.keys(tp)[0] || "";
		const fk = Object.keys((ent.feats || [])[0] || {})[0] || "";
		const se = Array.isArray(ent.startingEquipment) ? ent.startingEquipment[0] : null;
		const A = (se && se.A) || [];
		const items = A.filter(x => x && x.item).map(x => ({...parseRef(x.item), name: R().titleCase(parseRef(x.item).name), qty: x.quantity || 1}));
		const gold = (A.find(x => x && x.value) || {}).value || 0;
		const alt = ((se && se.B) || []).find(x => x && x.value);
		return {
			name: `${ent.name} (house rule)`, description: entriesToText((ent.entries || []).filter(e => typeof e === "string")),
			abilities: (w && w.weighted && w.weighted.from) || (w && w.from) || [], skills: Object.keys((ent.skillProficiencies || [])[0] || {}).filter(k => (ent.skillProficiencies[0])[k] === true),
			tool: tk, feat: fk ? {name: R().titleCase(fk.split("|")[0].split(";")[0]), source: fk.split("|")[1] || "PHB"} : null,
			items, gold: gold / 100, altGold: alt ? alt.value / 100 : 50,
		};
	};
	const backgroundEditor = async (char, rec, {onSaved} = {}) => {
		const d = rec.data;
		const name = text(d.name, "e.g. Shipwright");
		const desc = area(d.description, 3, "Who you were before adventuring.");
		const abil = chipsSelect(ABILS.map(a => [a, R().ABIL_NAMES[a]]), d.abilities);
		const skills = chipsSelect(R().SKILL_LIST.map(s => [s, R().titleCase(s)]), d.skills);
		const {all} = await R().loadItems();
		const tools = [...new Map(all.filter(i => /^(AT|GS|INS|T)\|/.test(i.type || "") && (i.source === "XPHB" || i._tbBrew || i._tbHR)).map(i => [lc(i.name), i.name])).values()].sort();
		const tool = sel([["", "None"], ...TOOL_ANY, ...tools.map(t => [lc(t), t])], d.tool || "");
		const feats = (await D().loadFeats()).filter(f => f.category === "O" && visible(f, char) && (D().isModern(f.source) || f._tbBrew || f._tbHR));
		const featSel = sel([["", "None"], ...feats.map(f => [refStr(f), `${f.name}${f._tbHR ? " (house rule)" : f._tbBrew ? " (homebrew)" : ""}`])], d.feat ? refStr(d.feat) : "");
		const items = (d.items || []).map(i => ({...i}));
		const gold = h("input", {type: "number", min: 0, value: d.gold ?? 0, style: {width: "90px"}});
		const alt = h("input", {type: "number", min: 0, value: d.altGold ?? 50, style: {width: "90px"}});
		const shared = sharedBox(rec);
		const body = h("div.hr-form", basedLine(rec), field("Name", name), field("Description", desc),
			field("Ability scores (three: +2/+1 or +1/+1/+1 among them)", abil),
			field("Skill proficiencies (usually two)", skills),
			row(field("Tool proficiency", tool), field("Origin feat", featSel)),
			field("Equipment, option A", itemList(char, items, {qty: true})),
			row(field("Option A also gives (GP)", gold), field("Option B: gold instead (GP)", alt)),
			h("label.chk", shared, "Available to every character (not only this one)"));
		editorModal(char, rec, {title: "New house rule: background", body, onSaved, collect: () => {
			if (!name.value.trim()) return "Give the background a name.";
			const a = abil.value();
			if (a.length && a.length !== 3) return "Choose exactly three ability scores (or none).";
			const f = featSel.value ? feats.find(x => refStr(x) === featSel.value) : null;
			Object.assign(d, {name: name.value.trim(), description: desc.value, abilities: a, skills: skills.value(), tool: tool.value, feat: f ? {name: f.name, source: f.source} : null, items, gold: Number(gold.value) || 0, altGold: Number(alt.value) || 0});
			rec.title = d.name;
			rec.shared = shared.checked;
			return null;
		}});
	};
	H.register("background", {label: "Background", prop: "background", compile: compileBackground, editor: backgroundEditor, fromEntity: backgroundFrom});
	// endregion

	// region Spell
	const SCHOOLS = [["A", "Abjuration"], ["C", "Conjuration"], ["D", "Divination"], ["E", "Enchantment"], ["V", "Evocation"], ["I", "Illusion"], ["N", "Necromancy"], ["T", "Transmutation"]];
	const UNITS = [["action", "Action"], ["bonus", "Bonus Action"], ["reaction", "Reaction"], ["minute", "Minute(s)"], ["hour", "Hour(s)"]];
	const RANGES = [["feet", "Feet"], ["self", "Self"], ["touch", "Touch"], ["sight", "Sight"], ["unlimited", "Unlimited"]];
	const DURS = [["instant", "Instantaneous"], ["round", "Round(s)"], ["minute", "Minute(s)"], ["hour", "Hour(s)"], ["day", "Day(s)"], ["permanent", "Until dispelled"]];
	const DMG_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
	const diceRe = /^\s*(\d+)d(\d+)\s*$/i;
	const compileSpell = (r, owner) => {
		const d = r.data || {};
		const level = Math.max(0, Math.min(9, Number(d.level) || 0));
		const ent = {
			name: d.name || r.title || "House rule spell", source: sourceOf(r), level, school: d.school || "V",
			time: [{number: Math.max(1, Number(d.timeN) || 1), unit: d.timeUnit || "action"}],
			range: d.range === "feet" ? {type: "point", distance: {type: "feet", amount: Number(d.rangeFt) || 30}} : {type: "point", distance: {type: d.range || "self"}},
			components: {...(d.v ? {v: true} : {}), ...(d.s ? {s: true} : {}), ...(d.m ? {m: d.material ? d.material : true} : {})},
			duration: [d.dur && d.dur !== "instant" ? (d.dur === "permanent" ? {type: "permanent", ends: ["dispel"]} : {type: "timed", duration: {type: d.dur, amount: Math.max(1, Number(d.durN) || 1)}, ...(d.conc ? {concentration: true} : {})}) : {type: "instant"}],
			entries: textEntries(d.description),
			_tbHR: tagOf(r, owner, "spell"),
		};
		if (d.ritual) ent.meta = {ritual: true};
		const dice = String(d.dice || "").trim();
		const type = d.dmgType || "";
		if (dice && type === "healing") {
			ent.entries.push(`A creature of your choice that you can see within range regains a number of Hit Points equal to {@dice ${dice}} plus your spellcasting ability modifier.`);
			ent.miscTags = ["HL"];
		} else if (dice) {
			const t = R().titleCase(type || "force");
			ent.damageInflict = [type || "force"];
			if (d.attack) ent.entries.push(`On a hit, the target takes {@damage ${dice}} ${t} damage.`);
			else if (d.save) ent.entries.push(`The target makes a ${R().titleCase(ABIL_FULL[d.save])} saving throw, taking {@damage ${dice}} ${t} damage on a failed save or half as much damage on a successful one.`);
			else ent.entries.push(`The target takes {@damage ${dice}} ${t} damage.`);
		}
		// A reworked spell keeps its dice in the text: the type, scaling and higher-level text still apply
		if (!dice && type && type !== "healing") ent.damageInflict = [type];
		if (!dice && type === "healing") ent.miscTags = ["HL"];
		if (!dice && d.scaling && level === 0) ent.scalingLevelDice = d.scaling;
		if (d.attack) ent.spellAttack = [d.attack];
		if (d.save) ent.savingThrow = [ABIL_FULL[d.save]];
		const m = diceRe.exec(dice);
		if (m && level === 0 && type !== "healing") {
			const n = Number(m[1]);
			ent.scalingLevelDice = {label: `${R().titleCase(type || "force")} damage`, scaling: {1: `${n}d${m[2]}`, 5: `${2 * n}d${m[2]}`, 11: `${3 * n}d${m[2]}`, 17: `${4 * n}d${m[2]}`}};
			ent.entriesHigherLevel = [{type: "entries", name: "Cantrip Upgrade", entries: [`The damage increases by {@damage ${n}d${m[2]}} when you reach levels 5 ({@damage ${2 * n}d${m[2]}}), 11 ({@damage ${3 * n}d${m[2]}}), and 17 ({@damage ${4 * n}d${m[2]}}).`]}];
		} else if (m && level === 0 && type === "healing") {
			/* no cantrip scaling for healing */
		} else if (level > 0 && String(d.higher || "").trim() && dice) ent.entriesHigherLevel = [{type: "entries", name: "Using a Higher-Level Spell Slot", entries: [`The ${type === "healing" ? "healing" : "damage"} increases by {@scale${type === "healing" ? "dice" : "damage"} ${dice}|${level}-9|${String(d.higher).trim()}} for each spell slot level above ${level}.`]}];
		else if (String(d.higherText || "").trim()) ent.entriesHigherLevel = [{type: "entries", name: "Using a Higher-Level Spell Slot", entries: textEntries(d.higherText)}];
		const classes = (d.classes || []).map(c => (typeof c === "string" ? parseRef(c) : {name: c.name, source: c.source || "PHB"}));
		ent.classes = {fromClassList: classes.map(c => ({name: R().titleCase(c.name), source: /^[a-z]+$/.test(c.source) ? c.source.toUpperCase() : c.source}))};
		ent._tbClasses = classes.map(c => refStr(c));
		return ent;
	};
	const spellFrom = (ent) => {
		const t = (ent.time || [])[0] || {};
		const dist = (ent.range && ent.range.distance) || {};
		const du = (ent.duration || [])[0] || {};
		const strs = JSON.stringify(ent.entries || []);
		const dm = /\{@(?:damage|dice) ([^}|]+)/.exec(strs);
		return {
			name: `${ent.name} (house rule)`, level: ent.level, school: ent.school, timeN: t.number || 1, timeUnit: t.unit || "action", ritual: !!(ent.meta && ent.meta.ritual),
			range: dist.type === "feet" ? "feet" : dist.type === "miles" ? "feet" : (dist.type || "self"), rangeFt: dist.type === "miles" ? (dist.amount || 1) * 5280 : dist.amount || 30,
			v: !!(ent.components && ent.components.v), s: !!(ent.components && ent.components.s), m: !!(ent.components && ent.components.m), material: ent.components && typeof ent.components.m === "string" ? ent.components.m : (ent.components && ent.components.m && ent.components.m.text) || "",
			dur: du.type === "timed" ? (du.duration && du.duration.type) || "minute" : du.type === "permanent" ? "permanent" : "instant", durN: (du.duration && du.duration.amount) || 1, conc: !!du.concentration,
			// The original text keeps its dice tags, so damage isn't added a second time
			description: entriesToText(ent.entries), dice: "", keptDice: dm ? dm[1] : "",
			dmgType: (ent.damageInflict || [])[0] || ((ent.miscTags || []).includes("HL") ? "healing" : ""), attack: (ent.spellAttack || [])[0] || "", save: ((ent.savingThrow || [])[0] ? Object.keys(ABIL_FULL).find(k => ABIL_FULL[k] === lc(ent.savingThrow[0])) : "") || "",
			higherText: entriesToText((ent.entriesHigherLevel || []).flatMap(e => e.entries || [])), scaling: ent.scalingLevelDice ? JSON.parse(JSON.stringify(ent.scalingLevelDice)) : null,
			classes: (ent._tbClasses || []).map(k => ({name: k.split("|")[0], source: k.split("|")[1]})),
		};
	};
	const spellEditor = async (char, rec, {onSaved} = {}) => {
		const d = rec.data;
		const name = text(d.name, "e.g. Chimeric Gore");
		const level = sel([[0, "Cantrip"], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => [l, `Level ${l}`])], d.level ?? 1);
		const school = sel(SCHOOLS, d.school || "V");
		const timeN = h("input", {type: "number", min: 1, value: d.timeN || 1, style: {width: "64px"}});
		const timeUnit = sel(UNITS, d.timeUnit || "action");
		const ritual = h("input", {type: "checkbox", checked: !!d.ritual});
		const range = sel(RANGES, d.range || "feet");
		const rangeFt = h("input", {type: "number", min: 0, step: 5, value: d.rangeFt ?? 60, style: {width: "80px"}});
		const v = h("input", {type: "checkbox", checked: d.v ?? true});
		const s = h("input", {type: "checkbox", checked: d.s ?? true});
		const m = h("input", {type: "checkbox", checked: !!d.m});
		const material = text(d.material, "Material component (optional)");
		const dur = sel(DURS, d.dur || "instant");
		const durN = h("input", {type: "number", min: 1, value: d.durN || 1, style: {width: "64px"}});
		const conc = h("input", {type: "checkbox", checked: !!d.conc});
		const desc = area(d.description, 5, "What the spell does. 5etools tags like {@condition Prone|XPHB} work.");
		const dice = text(d.dice, d.keptDice ? `${d.keptDice} (in the text)` : "e.g. 2d8");
		const dmgType = sel([["", "—"], ["healing", "Healing"], ...DMG_TYPES.map(t => [t, R().titleCase(t)])], d.dmgType || "");
		const attack = sel([["", "No attack roll"], ["M", "Melee spell attack"], ["R", "Ranged spell attack"]], d.attack || "");
		const save = sel([["", "No saving throw"], ...ABILS.map(a => [a, `${R().ABIL_NAMES[a]} save`])], d.save || "");
		const higher = text(d.higher, "e.g. 1d8 per slot level");
		const higherText = area(d.higherText, 2, "Or describe it in words.");
		const cls = (await D().loadClasses()).classes.filter(c => visible(c, char) && (D().isModern(c.source) || c._tbBrew || c._tbHR) && (c.casterProgression || c.spellcastingAbility || /^(Fighter|Rogue)$/.test(c.name)));
		const classes = chipsSelect([...new Map(cls.map(c => [refStr(c), `${c.name}${c._tbBrew ? " (homebrew)" : ""}`])).entries()], (d.classes || []).map(refStr));
		// Feet only for a range in feet; a count only for a timed duration
		const syncSpell = () => { rangeFt.style.display = range.value === "feet" ? "" : "none"; durN.style.display = ["instant", "permanent"].includes(dur.value) ? "none" : ""; };
		range.addEventListener("change", syncSpell);
		dur.addEventListener("change", syncSpell);
		syncSpell();
		const shared = sharedBox(rec);
		const body = h("div.hr-form", basedLine(rec), row(field("Name", name), field("Level", level), field("School", school)),
			row(field("Casting time", h("div.row", {style: {gap: "4px"}}, timeN, timeUnit)), h("label.chk", ritual, "Ritual"), field("Range", h("div.row", {style: {gap: "4px"}}, range, rangeFt))),
			row(h("label.chk", v, "V"), h("label.chk", s, "S"), h("label.chk", m, "M"), material),
			row(field("Duration", h("div.row", {style: {gap: "4px"}}, durN, dur)), h("label.chk", conc, "Concentration")),
			field("Description", desc),
			h("div.hr-sec", h("b", "Numbers the Play tab uses")),
			row(field("Damage or healing dice", dice, d.keptDice ? "Leave empty: the dice are already in the text." : "Added to the text as a roll."), field("Type", dmgType), field("Attack", attack), field("Saving throw", save)),
			row(field("At higher slot levels, add", higher), field("…or in words", higherText)),
			field("Spell lists (classes that can learn it)", classes),
			h("label.chk", shared, "Available to every character (not only this one)"));
		editorModal(char, rec, {title: "New house rule: spell", body, onSaved, collect: () => {
			if (!name.value.trim()) return "Give the spell a name.";
			if (dice.value.trim() && !/^\s*\d+d\d+(\s*[+-]\s*\d+)?\s*$/i.test(dice.value)) return "Dice look like 2d8 or 1d10+2.";
			Object.assign(d, {name: name.value.trim(), level: Number(level.value), school: school.value, timeN: Number(timeN.value) || 1, timeUnit: timeUnit.value, ritual: ritual.checked, range: range.value, rangeFt: Number(rangeFt.value) || 0,
				v: v.checked, s: s.checked, m: m.checked, material: material.value.trim(), dur: dur.value, durN: Number(durN.value) || 1, conc: conc.checked, description: desc.value,
				dice: dice.value.trim(), dmgType: dmgType.value, attack: attack.value, save: save.value, higher: higher.value.trim(), higherText: higherText.value,
				classes: classes.value().map(k => ({name: k.split("|")[0], source: k.split("|")[1]}))});
			rec.title = d.name;
			rec.shared = shared.checked;
			return null;
		}});
	};
	H.register("spell", {label: "Spell", prop: "spell", compile: compileSpell, editor: spellEditor, fromEntity: spellFrom});
	// endregion

	// region Item (equipment)
	const PROPS = [["F", "Finesse"], ["L", "Light"], ["H", "Heavy"], ["2H", "Two-Handed"], ["T", "Thrown"], ["V", "Versatile"], ["R", "Reach"], ["A", "Ammunition"], ["LD", "Loading"]];
	const DMG_ABV = {acid: "A", bludgeoning: "B", cold: "C", fire: "F", force: "O", lightning: "L", necrotic: "N", piercing: "P", poison: "I", psychic: "Y", radiant: "R", slashing: "S", thunder: "T"};
	const RARITIES = ["none", "common", "uncommon", "rare", "very rare", "legendary"];
	const compileItem = (r, owner) => {
		const d = r.data || {};
		const ent = {name: d.name || r.title || "House rule item", source: sourceOf(r), edition: "one", rarity: d.rarity || "none", entries: textEntries(d.description), _tbHR: tagOf(r, owner, "item")};
		if (Number(d.value) > 0) ent.value = Math.round(Number(d.value) * 100);
		if (Number(d.weight) > 0) ent.weight = Number(d.weight);
		if (d.attune) ent.reqAttune = d.attuneText || true;
		const bonus = Number(d.bonus) || 0;
		switch (d.category) {
			case "weapon": {
				Object.assign(ent, {type: `${d.ranged ? "R" : "M"}|XPHB`, weapon: true, weaponCategory: d.martial ? "martial" : "simple", dmg1: d.dice || "1d6", dmgType: DMG_ABV[d.dmgType] || "S", property: (d.props || []).map(p => `${p}|XPHB`)});
				if ((d.props || []).includes("V") && d.dice2) ent.dmg2 = d.dice2;
				if (d.range) ent.range = d.range;
				if (d.mastery) ent.mastery = [`${d.mastery}|XPHB`];
				if (bonus) ent.bonusWeapon = `+${bonus}`;
				break;
			}
			case "armor": {
				Object.assign(ent, {type: `${d.armorType || "LA"}|XPHB`, armor: true, ac: Number(d.ac) || 11});
				if (Number(d.strength)) ent.strength = String(d.strength);
				if (d.stealth) ent.stealth = true;
				if (bonus) ent.bonusAc = `+${bonus}`;
				break;
			}
			case "shield": Object.assign(ent, {type: "S|XPHB", ac: Number(d.ac) || 2}); if (bonus) ent.bonusAc = `+${bonus}`; break;
			case "wondrous": ent.wondrous = true; if (bonus) ent.bonusAc = `+${bonus}`; break;
			default: ent.type = "G|XPHB";
		}
		return ent;
	};
	const itemFrom = (ent) => {
		const t = String(ent.type || "").split("|")[0];
		const abvToType = Object.fromEntries(Object.entries(DMG_ABV).map(([k, v]) => [v, k]));
		const n = (s) => Number(String(s || "").replace(/[^\d-]/g, "")) || 0;
		return {
			name: `${ent.name} (house rule)`, category: ent.weapon || t === "M" || t === "R" ? "weapon" : ["LA", "MA", "HA"].includes(t) ? "armor" : t === "S" ? "shield" : ent.wondrous ? "wondrous" : "gear",
			ranged: t === "R", martial: lc(ent.weaponCategory) === "martial", dice: ent.dmg1 || "", dice2: ent.dmg2 || "", dmgType: abvToType[ent.dmgType] || "slashing",
			props: (ent.property || []).map(p => String(p).split("|")[0]).filter(p => PROPS.some(([k]) => k === p)), range: ent.range || "", mastery: ((ent.mastery || [])[0] || "").split("|")[0],
			armorType: ["LA", "MA", "HA"].includes(t) ? t : "LA", ac: ent.ac || "", strength: ent.strength || "", stealth: !!ent.stealth,
			bonus: n(ent.bonusWeapon) || n(ent.bonusAc), rarity: ent.rarity && ent.rarity !== "unknown" ? ent.rarity : "none", attune: !!ent.reqAttune, attuneText: typeof ent.reqAttune === "string" ? ent.reqAttune : "",
			value: (ent.value || 0) / 100, weight: ent.weight || "", description: entriesToText(ent.entries),
		};
	};
	const itemEditor = async (char, rec, {onSaved} = {}) => {
		const d = rec.data;
		const name = text(d.name, "e.g. Gore Gauntlet");
		const category = sel([["weapon", "Weapon"], ["armor", "Armor"], ["shield", "Shield"], ["wondrous", "Wondrous item (worn)"], ["gear", "Gear or other"]], d.category || "weapon");
		const desc = area(d.description, 4, "What it is and what it does.");
		// Weapon
		const ranged = sel([["", "Melee"], ["1", "Ranged"]], d.ranged ? "1" : "");
		const martial = sel([["", "Simple"], ["1", "Martial"]], d.martial ? "1" : "");
		const dice = text(d.dice || "1d8", "1d8");
		const dice2 = text(d.dice2, "1d10 (Versatile)");
		const dmgType = sel(DMG_TYPES.map(t => [t, R().titleCase(t)]), d.dmgType || "slashing");
		const props = chipsSelect(PROPS, d.props);
		const range = text(d.range, "e.g. 80/320");
		const {mastery: masteries} = await R().loadItems();
		const mastery = sel([["", "None"], ...[...new Set((masteries || []).filter(x => x.source === "XPHB").map(x => x.name))].sort().map(x => [x, x])], d.mastery || "");
		// Armor
		const armorType = sel([["LA", "Light"], ["MA", "Medium"], ["HA", "Heavy"]], d.armorType || "LA");
		const ac = h("input", {type: "number", min: 0, value: d.ac || (d.category === "shield" ? 2 : 11), style: {width: "70px"}});
		const strength = h("input", {type: "number", min: 0, value: d.strength || "", style: {width: "70px"}});
		const stealth = h("input", {type: "checkbox", checked: !!d.stealth});
		// Magic and price
		const bonus = sel([[0, "—"], [1, "+1"], [2, "+2"], [3, "+3"]], d.bonus || 0);
		const rarity = sel(RARITIES.map(x => [x, x === "none" ? "Mundane" : R().titleCase(x)]), d.rarity || "none");
		const attune = h("input", {type: "checkbox", checked: !!d.attune});
		const value = h("input", {type: "number", min: 0, step: "0.01", value: d.value || 0, style: {width: "90px"}});
		const weight = h("input", {type: "number", min: 0, step: "0.1", value: d.weight || "", style: {width: "80px"}});
		const wBox = h("div.hr-sub", row(field("Kind", ranged), field("Category", martial), field("Damage", dice), field("Type", dmgType)), field("Properties", props), row(field("Versatile damage", dice2), field("Range (ft.)", range), field("Mastery", mastery)));
		const aBox = h("div.hr-sub", row(field("Armor", armorType), field("AC (base)", ac), field("Strength needed", strength), h("label.chk", stealth, "Stealth Disadvantage")));
		const sBox = h("div.hr-sub", row(field("AC bonus", ac)));
		const sync = () => { wBox.style.display = category.value === "weapon" ? "" : "none"; aBox.style.display = category.value === "armor" ? "" : "none"; sBox.style.display = category.value === "shield" ? "" : "none"; if (category.value === "shield" && !d.ac) ac.value = 2; };
		category.addEventListener("change", sync);
		const shared = sharedBox(rec);
		const body = h("div.hr-form", basedLine(rec), row(field("Name", name), field("What is it?", category)), wBox, aBox, sBox,
			row(field("Magic bonus", bonus), field("Rarity", rarity), h("label.chk", attune, "Requires attunement")),
			row(field("Price (GP)", value, "The Store sells it to this character at this price."), field("Weight (lb.)", weight)),
			field("Description", desc),
			h("label.chk", shared, "Available to every character (not only this one)"));
		sync();
		editorModal(char, rec, {title: "New house rule: equipment", body, onSaved, collect: () => {
			if (!name.value.trim()) return "Give the item a name.";
			if (category.value === "weapon" && !/^\s*\d+d\d+\s*$/i.test(dice.value)) return "Weapon damage looks like 1d8.";
			Object.assign(d, {name: name.value.trim(), category: category.value, description: desc.value, ranged: !!ranged.value, martial: !!martial.value, dice: dice.value.trim(), dice2: dice2.value.trim(), dmgType: dmgType.value,
				props: props.value(), range: range.value.trim(), mastery: mastery.value, armorType: armorType.value, ac: Number(ac.value) || 0, strength: Number(strength.value) || 0, stealth: stealth.checked,
				bonus: Number(bonus.value) || 0, rarity: rarity.value, attune: attune.checked, value: Number(value.value) || 0, weight: Number(weight.value) || 0});
			rec.title = d.name;
			rec.shared = shared.checked;
			return null;
		}});
	};
	H.register("item", {label: "Equipment", prop: "item", compile: compileItem, editor: itemEditor, fromEntity: itemFrom});
	// endregion

	// region Feat
	const CATS = [["O", "Origin"], ["G", "General"], ["FS", "Fighting Style"], ["EB", "Epic Boon"]];
	const compileFeat = (r, owner) => {
		const d = r.data || {};
		const ent = {name: d.name || r.title || "House rule feat", source: sourceOf(r), edition: "one", category: d.category || "G", entries: textEntries(d.description), _tbHR: tagOf(r, owner, "feat")};
		const pre = {};
		if (Number(d.preLevel) > 1) pre.level = Number(d.preLevel);
		if (d.preAbil && Number(d.preMin)) pre.ability = [{[d.preAbil]: Number(d.preMin)}];
		if (String(d.preOther || "").trim()) pre.other = String(d.preOther).trim();
		if (Object.keys(pre).length) ent.prerequisite = [pre];
		if (d.repeatable) ent.repeatable = true;
		const ab = (d.abilities || []).filter(a => ABILS.includes(a));
		if (ab.length === 1) ent.ability = [{[ab[0]]: 1}];
		else if (ab.length > 1) ent.ability = [{choose: {from: ab, amount: 1}}];
		if (Number(d.skills) > 0) ent.skillProficiencies = [{any: Number(d.skills)}];
		return ent;
	};
	const featFrom = (ent) => {
		const p = (ent.prerequisite || [])[0] || {};
		const pa = (p.ability || [])[0] || {};
		const a = (ent.ability || [])[0] || {};
		return {
			name: `${ent.name} (house rule)`, category: ent.category || "G", description: entriesToText(ent.entries), repeatable: !!ent.repeatable,
			preLevel: p.level || "", preAbil: Object.keys(pa)[0] || "", preMin: Object.values(pa)[0] || "", preOther: typeof p.other === "string" ? p.other : "",
			abilities: a.choose ? (a.choose.from || []) : Object.keys(a).filter(k => ABILS.includes(k)), skills: ((ent.skillProficiencies || [])[0] || {}).any || 0,
		};
	};
	const featEditor = async (char, rec, {onSaved} = {}) => {
		const d = rec.data;
		const name = text(d.name, "e.g. Horned Charge");
		const cat = sel(CATS, d.category || "G");
		const preLevel = h("input", {type: "number", min: 0, max: 20, value: d.preLevel || "", style: {width: "70px"}});
		const preAbil = sel([["", "—"], ...ABILS.map(a => [a, R().ABIL_NAMES[a]])], d.preAbil || "");
		const preMin = h("input", {type: "number", min: 0, max: 30, value: d.preMin || "", style: {width: "70px"}});
		const preOther = text(d.preOther, "Other prerequisite (text)");
		const repeatable = h("input", {type: "checkbox", checked: !!d.repeatable});
		const abil = chipsSelect(ABILS.map(a => [a, R().ABIL_NAMES[a]]), d.abilities);
		const skills = h("input", {type: "number", min: 0, max: 4, value: d.skills || 0, style: {width: "70px"}});
		const desc = area(d.description, 6, "Benefits, as the book would write them.");
		const shared = sharedBox(rec);
		const body = h("div.hr-form", basedLine(rec), row(field("Name", name), field("Category", cat), h("label.chk", repeatable, "Repeatable")),
			row(field("Minimum level", preLevel), field("Ability prerequisite", preAbil), field("of at least", preMin), field("Other", preOther)),
			field("Ability Score Increase: +1 to one of", abil, "None for no increase. Choose several and the player picks one."),
			field("Skill proficiencies of the player's choice", skills),
			field("Description", desc),
			h("label.chk", shared, "Available to every character (not only this one)"));
		editorModal(char, rec, {title: "New house rule: feat", body, onSaved, collect: () => {
			if (!name.value.trim()) return "Give the feat a name.";
			Object.assign(d, {name: name.value.trim(), category: cat.value, preLevel: Number(preLevel.value) || "", preAbil: preAbil.value, preMin: Number(preMin.value) || "", preOther: preOther.value, repeatable: repeatable.checked, abilities: abil.value(), skills: Number(skills.value) || 0, description: desc.value});
			rec.title = d.name;
			rec.shared = shared.checked;
			return null;
		}});
	};
	H.register("feat", {label: "Feat", prop: "feat", compile: compileFeat, editor: featEditor, fromEntity: featFrom});
	// endregion

	// region Language
	const compileLanguage = (r, owner) => {
		const d = r.data || {};
		const ent = {name: d.name || r.title || "House rule language", source: sourceOf(r), type: d.type || "standard", entries: textEntries(d.description), _tbHR: tagOf(r, owner, "language")};
		if (d.script) ent.script = d.script;
		if (d.speakers) ent.typicalSpeakers = [d.speakers];
		return ent;
	};
	const languageEditor = async (char, rec, {onSaved} = {}) => {
		const d = rec.data;
		const name = text(d.name, "e.g. Old Hornish");
		const type = sel([["standard", "Standard (anyone may learn it)"], ["rare", "Rare"]], d.type || "standard");
		const script = text(d.script, "e.g. Dwarvish");
		const speakers = text(d.speakers, "e.g. Horned folk of the Ash Hills");
		const desc = area(d.description, 3, "Optional notes.");
		const shared = sharedBox(rec);
		const body = h("div.hr-form", row(field("Name", name), field("Type", type)), row(field("Script", script), field("Typical speakers", speakers)), field("Notes", desc),
			h("div.muted.hr-hint", "The language joins the Languages choice in Details."),
			h("label.chk", shared, "Available to every character (not only this one)"));
		editorModal(char, rec, {title: "New house rule: language", body, onSaved, collect: () => {
			if (!name.value.trim()) return "Give the language a name.";
			Object.assign(d, {name: name.value.trim(), type: type.value, script: script.value.trim(), speakers: speakers.value.trim(), description: desc.value});
			rec.title = d.name;
			rec.shared = shared.checked;
			return null;
		}});
	};
	H.register("language", {label: "Language", prop: "language", compile: compileLanguage, editor: languageEditor, fromEntity: (ent) => ({name: `${ent.name} (house rule)`, type: ent.type === "rare" || ent.type === "exotic" ? "rare" : "standard", script: ent.script || "", speakers: (ent.typicalSpeakers || []).map(s => D().strip(s)).join(", "), description: entriesToText(ent.entries)})});
	// endregion

	// region Class (a layer on the character's class: it keeps the class's name, so choices and plans stay valid)
	const ARMOR = [["light", "Light armor"], ["medium", "Medium armor"], ["heavy", "Heavy armor"], ["shield", "Shields"]];
	const WEAPONS = [["simple", "Simple weapons"], ["martial", "Martial weapons"]];
	const featureText = (f) => entriesToText(f.entries || []);
	/** Apply a class house rule to a resolved class (TBData.resolveClass calls this when the class entry has `hr`). */
	const applyClass = (id, res) => {
		const r = H.recordById(id);
		if (!r || r.kind !== "class" || !res || !res.cls) return res;
		const d = r.data || {};
		const cls = {...res.cls, _hrTitle: d.title || r.title || null, _tbHRClass: id};
		if (Number(d.hdFaces)) cls.hd = {number: 1, faces: Number(d.hdFaces)};
		if ((d.saves || []).length) cls.proficiency = d.saves.slice();
		const sp = {...(res.cls.startingProficiencies || {})};
		if (d.skillsCount != null && d.skillsCount !== "") sp.skills = Number(d.skillsCount) ? [{choose: {from: (d.skillsFrom || []).length ? d.skillsFrom.slice() : R().SKILL_LIST.slice(), count: Number(d.skillsCount)}}] : [];
		if (d.armor) sp.armor = d.armor.slice();
		if (d.weapons) sp.weapons = d.weapons.slice();
		cls.startingProficiencies = sp;
		const removed = new Set(d.remove || []);
		const added = (d.add || []).map(f => {
			const uid = `hr:${id}:${f.id}`;
			const entries = f.entries && f.entries.length ? f.entries : textEntries(f.text);
			return {uid, key: `hrf:${uid}`, name: f.name || "Feature", level: Math.max(1, Math.min(20, Number(f.level) || 1)), isSubclass: false, isSubclassGate: false, entries, source: sourceOf(r), page: 0, _raw: {name: f.name, entries}, _tbHR: true};
		});
		const features = [...res.features.filter(f => !removed.has(f.uid)), ...added].sort((a, b) => a.level - b.level);
		return {...res, cls, features};
	};
	H.applyClass = applyClass;
	const compileClass = (r, owner) => {
		const d = r.data || {};
		const base = d.base || r.basedOn || {};
		const items = [
			d.hdFaces ? `Hit Die: d${d.hdFaces}` : null,
			(d.saves || []).length ? `Saving Throws: ${d.saves.map(a => R().ABIL_NAMES[a]).join(", ")}` : null,
			d.skillsCount != null && d.skillsCount !== "" ? `Skills: choose ${d.skillsCount}${(d.skillsFrom || []).length ? ` from ${d.skillsFrom.map(s => R().titleCase(s)).join(", ")}` : " (any)"}` : null,
			d.armor ? `Armor: ${d.armor.length ? d.armor.map(a => R().titleCase(a)).join(", ") : "none"}` : null,
			d.weapons ? `Weapons: ${d.weapons.length ? d.weapons.map(a => R().titleCase(a)).join(", ") : "none"}` : null,
			(d.removeNames || []).length ? `Removed features: ${d.removeNames.join(", ")}` : null,
		].filter(Boolean);
		return {
			name: d.title || r.title || "Class house rule", source: sourceOf(r), _tbHR: tagOf(r, owner, "class"),
			entries: [`A house rule on the ${base.name || "class"} (${D().sourceShort(base.source || "")}); the class keeps its name, levels and subclasses.`, ...textEntries(d.description),
				...(items.length ? [{type: "list", items}] : []),
				...(d.add || []).map(f => ({type: "entries", name: `Level ${f.level}: ${f.name}${f.from ? ` (from ${f.from})` : ""}`, entries: f.entries && f.entries.length ? f.entries : textEntries(f.text)}))],
		};
	};
	const classFrom = (ent) => ({
		base: {name: ent.name, source: ent.source}, title: `${ent.name} (house rule)`, description: "",
		hdFaces: ent.hd ? ent.hd.faces : 8, saves: (ent.proficiency || []).slice(), add: [], remove: [],
	});
	const classEditor = async (char, rec, {onSaved} = {}) => {
		const d = rec.data;
		const base = d.base || rec.basedOn;
		if (!base) { TBUI.toast("Choose the class on the character first, then rework it.", {error: true}); return; }
		const res = await D().resolveClass({name: base.name, source: base.source}, null);
		const core = D().getClassCore(res.cls);
		const sp = res.cls.startingProficiencies || {};
		const title = text(d.title, `e.g. Ironhorn ${base.name}`);
		const desc = area(d.description, 2, "What this version of the class is about.");
		const hd = sel([6, 8, 10, 12].map(n => [n, `d${n}`]), d.hdFaces || (res.cls.hd && res.cls.hd.faces) || 8);
		const saves = chipsSelect(ABILS.map(a => [a, R().ABIL_NAMES[a]]), d.saves || res.cls.proficiency || []);
		const baseSkill = ((sp.skills || [])[0] || {}).choose || {};
		const skillsCount = h("input", {type: "number", min: 0, max: 6, value: d.skillsCount ?? (baseSkill.count || 2), style: {width: "70px"}});
		const skillsFrom = chipsSelect(R().SKILL_LIST.map(k => [k, R().titleCase(k)]), d.skillsFrom || (baseSkill.from || []).map(lc));
		const armorNow = d.armor || (sp.armor || []).map(a => lc(typeof a === "string" ? a : a.proficiency || a.full || "")).map(a => (/shield/.test(a) ? "shield" : a.replace(/\s*armor.*$/, ""))).filter(a => ARMOR.some(([k]) => k === a));
		const weaponsNow = d.weapons || (sp.weapons || []).map(w => lc(typeof w === "string" ? w : w.proficiency || "")).filter(w => WEAPONS.some(([k]) => k === w));
		// Lines the chips can't express (the Rogue's "Martial weapons that have the Finesse or Light property") stay unless martial is ticked
		const weaponsExtra = (sp.weapons || []).filter(w => typeof w === "string" && !WEAPONS.some(([k]) => k === lc(w)));
		const armor = chipsSelect(ARMOR, armorNow);
		const weapons = chipsSelect(WEAPONS, weaponsNow);
		const removed = new Set(d.remove || []);
		const baseFeats = res.features.filter(f => !f.isSubclass);
		const keepList = h("div.hr-keep", ...baseFeats.map(f => {
			const cb = h("input", {type: "checkbox", checked: !removed.has(f.uid)});
			cb.addEventListener("change", () => { cb.checked ? removed.delete(f.uid) : removed.add(f.uid); });
			return h("label.chk", cb, h("span.muted", `L${f.level} `), f.name);
		}));
		const added = (d.add || []).map(f => ({...f}));
		const addEl = h("div.hr-traits");
		const drawAdded = () => {
			TBUI.clear(addEl);
			if (!added.length) addEl.appendChild(h("div.pick-empty", "No new features. Borrow one from any class or subclass, or write your own."));
			added.sort((a, b) => a.level - b.level).forEach((f, i) => {
				const nm = h("input", {type: "text", value: f.name || "", placeholder: "Feature name"});
				nm.addEventListener("input", () => { f.name = nm.value; });
				const lv = h("input", {type: "number", min: 1, max: 20, value: f.level || 1, style: {width: "64px"}, title: "Class level that grants it"});
				lv.addEventListener("change", () => { f.level = Number(lv.value) || 1; });
				const tx = h("textarea", {rows: 3});
				tx.value = f.text != null ? f.text : featureText(f);
				tx.addEventListener("input", () => { f.text = tx.value; f.entries = null; });
				addEl.appendChild(h("div.hr-trait", h("div.hr-trait-h", h("span.muted", "Level"), lv, nm, f.from ? h("span.muted", {style: {fontSize: "12px"}}, `from ${f.from}`) : h("span.tag.hr", "New"), h("div.spacer"),
					h("button.btn.ghost.small", {type: "button", title: "Remove", on: {click: () => { added.splice(i, 1); drawAdded(); }}}, "✕")), tx));
			});
		};
		drawAdded();
		const borrow = async () => {
			const cdata = await D().loadClasses();
			const visibleCls = new Set(cdata.classes.filter(c => visible(c, char)).map(c => `${lc(c.name)}|${lc(c.source)}`));
			const list = [];
			cdata.cf.forEach(f => { if (visibleCls.has(`${lc(f.className)}|${lc(f.classSource)}`) && !/Subclass$|Options$|^Ability Score Improvement$/i.test(f.name)) list.push({name: f.name, source: f.source, level: f.level, from: `${f.className} ${f.level}`, entries: f.entries, _tbBrew: f._tbBrew}); });
			cdata.scf.forEach(f => { if (visibleCls.has(`${lc(f.className)}|${lc(f.classSource)}`)) list.push({name: f.name, source: f.source, level: f.level, from: `${f.subclassShortName} (${f.className}) ${f.level}`, entries: f.entries, _tbBrew: f._tbBrew}); });
			TBPickers.open({
				title: "Borrow a feature from another class or subclass",
				prop: "classFeature",
				multi: true,
				legacyDefault: true,
				load: async () => list,
				info: (e) => e.from,
				renderPreview: (e) => `<h3>${esc(e.name)}</h3><p><i>${esc(e.from)}</i></p>${Renderer.get().setFirstSection(true).render({type: "entries", entries: e.entries || []})}`,
				onPick: async (e) => {
					added.push({id: U.uid(), level: e.level, name: e.name, entries: await D().resolveRefs(JSON.parse(JSON.stringify(e.entries || []))), text: null, from: e.from});
					drawAdded();
					TBUI.toast(`Added ${e.name} at level ${e.level} (change the level if you like)`);
				},
			});
		};
		const body = h("div.hr-form",
			h("div.hr-based", `Reworking ${base.name} (${D().sourceShort(base.source)}). The class keeps its name, so the character's choices, subclass and level-up plan stay as they are.`),
			field("Name of this version", title), field("Description", desc),
			row(field("Hit Die", hd), field("Saving throws", saves)),
			row(field("Skills to choose", skillsCount), field("from (none ticked: any skill)", skillsFrom)),
			row(field("Armor training", armor), field("Weapon proficiencies", weapons)),
			h("div.hr-sec", h("b", `${base.name} features`), h("span.muted", {style: {fontSize: "12px"}}, "Untick to remove (subclass features stay with the subclass).")),
			keepList,
			h("div.hr-sec", h("b", "New features"), h("div.spacer"),
				h("button.btn.small.primary", {type: "button", on: {click: borrow}}, "+ From another class"),
				h("button.btn.small", {type: "button", on: {click: () => { added.push({id: U.uid(), level: 1, name: "", text: "", from: null}); drawAdded(); }}}, "+ New feature")),
			h("div.muted.hr-hint", "A borrowed feature brings its text; Play recognises many by name (Second Wind, Rage, Sneak Attack dice come from class tables and don't move)."),
			addEl,
		);
		editorModal(char, rec, {title: `House rule: ${base.name}`, body, onSaved, collect: () => {
			if (!title.value.trim()) return "Give this version of the class a name.";
			if (saves.value().length > 3) return "Choose at most three saving throws.";
			Object.assign(d, {base, title: title.value.trim(), description: desc.value, hdFaces: Number(hd.value), saves: saves.value(), skillsCount: Number(skillsCount.value), skillsFrom: skillsFrom.value(),
				armor: armor.value(), weapons: [...weapons.value(), ...(weapons.value().includes("martial") ? [] : weaponsExtra)], remove: [...removed], removeNames: baseFeats.filter(f => removed.has(f.uid)).map(f => f.name),
				add: added.map(f => ({...f, name: (f.name || "").trim() || "Feature", entries: f.text != null ? textEntries(f.text) : f.entries}))});
			rec.title = d.title;
			return null;
		}});
	};
	H.register("class", {label: "Class", prop: "classhr", compile: compileClass, editor: classEditor, fromEntity: classFrom});
	// endregion
})();
