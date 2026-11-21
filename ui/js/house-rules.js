"use strict";

/**
 * House rules: content a player reworks or invents for one character (flagged "House rule").
 *
 * Records live on the character (`char.houseRules`), so they travel inside a shared character file:
 *   {id, kind, title, shared, basedOn: {name, source} | null, data: {...form fields}, createdAt, updatedAt}
 * Each record compiles into a 5etools-shaped entity (source `HR-<id>`, flagged `_tbHR`) that the data loaders
 * append to their lists, so the builder, the rules engine, Play, the Store and the exports use it like any
 * other content. Pickers show a character only its own house rules (and the ones shared by other characters).
 * Every change also rewrites the character's "<Name>'s HRs" book.
 *
 * Kinds: race (species) here; background, spell, item, feat and language in house-rules-kinds.js (TBHouse.register).
 */
globalThis.TBHouse = (() => {
	const lc = (s) => String(s ?? "").toLowerCase();
	const uid = () => Math.random().toString(36).slice(2, 10);
	const esc = (s) => String(s ?? "").replace(/[&<>"]/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[ch]));
	const KIND_LABEL = {race: "Species"};

	// The site's renderer names sources itself (stat block corners, tooltips): house rules read "HR" / "House rule"
	try {
		const wrap = (fn, val) => function (src, ...rest) { return /^HR-/.test(src || "") ? val : fn.call(this, src, ...rest); };
		Parser.sourceJsonToAbv = wrap(Parser.sourceJsonToAbv, "HR");
		Parser.sourceJsonToFull = wrap(Parser.sourceJsonToFull, "House rule");
	} catch (e) { /* parser not loaded: raw source codes show */ }
	const PROP = {race: "race"};

	// region Records and compiled entities
	const recordsOf = (char) => (char && Array.isArray(char.houseRules) ? char.houseRules : []);
	const allRecords = () => (TBStore.get().characters || []).flatMap(c => recordsOf(c).map(r => ({r, owner: c})));
	const sourceOf = (r) => `HR-${r.id}`;
	const isHR = (ent) => !!(ent && (ent._tbHR || /^HR-/.test(ent.source || "")));
	/** Plain text from a player goes into entries as text (5etools tags are allowed, markup isn't). */
	const textEntries = (txt) => String(txt || "").split(/\n{2,}/).map(p => p.replace(/[<>]/g, "").trim()).filter(Boolean);

	/** Union of species mechanics; duplicates (same JSON) only once. */
	const mergeArr = (a, b) => {
		const out = [...(a || [])];
		(b || []).forEach(x => { const j = JSON.stringify(x); if (!out.some(y => JSON.stringify(y) === j)) out.push(x); });
		return out;
	};

	const compileRace = (r, owner) => {
		const d = r.data || {};
		const ent = {
			name: d.name || r.title || "House rule species", source: sourceOf(r), edition: "one",
			size: d.size && d.size.length ? d.size : ["M"], speed: Number(d.speed) || 30,
			creatureTypes: [lc(d.creatureType || "humanoid")],
			entries: [...textEntries(d.description), ...(d.traits || []).map(t => ({type: "entries", name: t.name || "Trait", entries: t.entries && t.entries.length ? t.entries : textEntries(t.text)}))],
			_tbHR: {id: r.id, owner: owner.id, shared: !!r.shared, kind: "race"},
		};
		if (Number(d.darkvision)) ent.darkvision = Number(d.darkvision);
		// Mechanics the traits brought from their species, plus the ones set by hand
		(d.traits || []).forEach(t => {
			const m = t.mech || {};
			if (m.darkvision) ent.darkvision = Math.max(ent.darkvision || 0, Number(m.darkvision) || 0);
			["resist", "skillProficiencies", "feats", "additionalSpells", "toolProficiencies", "languageProficiencies", "weaponProficiencies", "armorProficiencies"].forEach(k => { if (m[k]) ent[k] = mergeArr(ent[k], m[k]); });
		});
		const x = d.extra || {};
		if ((x.resist || []).length) ent.resist = mergeArr(ent.resist, x.resist);
		if ((x.skills || []).length) ent.skillProficiencies = mergeArr(ent.skillProficiencies, [Object.fromEntries(x.skills.map(s => [s, true]))]);
		if (x.skillChoice) ent.skillProficiencies = mergeArr(ent.skillProficiencies, [{any: Number(x.skillChoice) || 1}]);
		if (x.originFeat) ent.feats = mergeArr(ent.feats, [{anyFromCategory: {category: ["O"], count: 1}}]);
		if ((x.spells || []).length) ent.additionalSpells = mergeArr(ent.additionalSpells, [{ability: x.spellAbility ? (x.spellAbility === "choose" ? {choose: ["int", "wis", "cha"]} : x.spellAbility) : {choose: ["int", "wis", "cha"]}, innate: {_: {daily: {"1": x.spells.filter(s => s.level > 0).map(s => `${lc(s.name)}|${lc(s.source)}`)}}}, known: {_: x.spells.filter(s => !s.level).map(s => `${lc(s.name)}|${lc(s.source)}`)}}]);
		return ent;
	};
	const COMPILE = {race: compileRace};
	const _compiled = new Map();
	/** Every house-rule entity of a kind, from every character (pickers filter by owner). */
	const list = (kind) => allRecords().filter(({r}) => r.kind === kind && COMPILE[kind]).map(({r, owner}) => {
		const key = `${owner.id}:${r.id}:${r.updatedAt || 0}:${r.shared ? 1 : 0}`;
		if (!_compiled.has(key)) _compiled.set(key, COMPILE[kind](r, owner));
		return _compiled.get(key);
	});
	/** Can this character pick this entity? Official and homebrew content: yes; house rules: its own or shared ones. */
	const visible = (ent, char) => !isHR(ent) || !ent._tbHR || ent._tbHR.owner === (char && char.id) || ent._tbHR.shared;
	const recordOf = (char, ent) => (ent && ent._tbHR ? recordsOf(char).find(r => r.id === ent._tbHR.id) : null);
	/** A record from any character, by id (class house rules are looked up from the class entry). */
	const recordById = (id) => { const hit = allRecords().find(({r}) => r.id === id); return hit ? hit.r : null; };
	// endregion

	// region Trait mechanics: which of a species' fields a trait carries
	const MECH_RULES = [
		["darkvision", (t) => /darkvision/i.test(t.name), (sp) => sp.darkvision ? Number(sp.darkvision) : null],
		["resist", (t, txt) => /resistance/i.test(txt), (sp) => sp.resist || null],
		["skillProficiencies", (t, txt) => /proficiency in .*skill|skill proficiency|proficiency in the (\w+ )?skill|perception skill|of your choice/i.test(txt) && /skill/i.test(txt), (sp) => sp.skillProficiencies || null],
		["feats", (t, txt) => /\bfeat\b/i.test(txt), (sp) => sp.feats || null],
		["additionalSpells", (t, txt) => /\bspells?\b|\bcantrips?\b/i.test(txt), (sp) => sp.additionalSpells || null],
		["toolProficiencies", (t, txt) => /proficiency with .*tools?|tool proficiency/i.test(txt), (sp) => sp.toolProficiencies || null],
		["weaponProficiencies", (t, txt) => /proficiency with .*weapons?/i.test(txt), (sp) => sp.weaponProficiencies || null],
		["armorProficiencies", (t, txt) => /proficiency with .*armor/i.test(txt), (sp) => sp.armorProficiencies || null],
	];
	const mechOf = (trait, sp) => {
		const txt = JSON.stringify(trait.entries || []);
		const m = {};
		MECH_RULES.forEach(([k, test, get]) => { if (test(trait, txt)) { const v = get(sp); if (v != null && (!Array.isArray(v) || v.length)) m[k] = JSON.parse(JSON.stringify(v)); } });
		return m;
	};
	const MECH_LABEL = {darkvision: "Darkvision", resist: "Resistances", skillProficiencies: "Skill proficiency", feats: "Feat", additionalSpells: "Spells", toolProficiencies: "Tools", weaponProficiencies: "Weapons", armorProficiencies: "Armor"};
	const mechChips = (m) => Object.keys(m || {}).map(k => MECH_LABEL[k] + (k === "darkvision" ? ` ${m[k]} ft.` : ""));
	/** Every trait of every species this character can see: [{name, entries, mech, species}] */
	const allTraits = async (char) => {
		const races = (await TBData.loadRaces()).filter(r => visible(r, char));
		const out = [];
		const seen = new Set();
		races.forEach(sp => (sp.entries || []).filter(e => e && e.name && Array.isArray(e.entries)).forEach(e => {
			const spName = String(sp.name).replace(/^([^;]+);\s*(.+)$/, "$1 ($2)");
			const k = `${lc(e.name)}|${lc(spName)}|${JSON.stringify(e.entries).length}`;
			if (seen.has(k)) return;
			seen.add(k);
			out.push({name: e.name, source: sp.source, species: spName, entries: e.entries, mech: mechOf(e, sp), _tbBrew: sp._tbBrew, _tbHR: sp._tbHR});
		}));
		return out.sort((a, b) => a.name.localeCompare(b.name) || a.species.localeCompare(b.species));
	};
	// endregion

	// region Saving and the HRs book
	const save = async (char, rec) => {
		char.houseRules ||= [];
		const i = char.houseRules.findIndex(r => r.id === rec.id);
		rec.updatedAt = Date.now();
		if (i >= 0) char.houseRules[i] = rec; else char.houseRules.push(rec);
		await syncBook(char);
		TBApp.charChanged(char);
	};
	const remove = async (char, rec) => {
		char.houseRules = recordsOf(char).filter(r => r.id !== rec.id);
		await syncBook(char);
		TBApp.charChanged(char);
	};
	/** "<Name>'s HRs": one chapter per kind, each house rule rendered like the book would. */
	const syncBook = async (char) => {
		const st = TBStore.get();
		let b = st.books.find(x => x.hrOf === char.id);
		const recs = recordsOf(char);
		if (!recs.length) {
			if (b) { st.books = st.books.filter(x => x !== b); TBStore.changed("book"); }
			return null;
		}
		const title = `${char.name || "Character"}'s HRs`;
		if (!b) {
			b = {id: TBBook.uid(), ownerCharId: null, hrOf: char.id, title, subtitle: "House rules", kicker: "House Rules", byline: char.player || "", chapters: [], hidden: [], createdAt: Date.now()};
			st.books.push(b);
		}
		b.title = title;
		b.chapters = Object.keys(KIND_LABEL).filter(k => recs.some(r => r.kind === k)).map(k => ({
			id: `hr-${k}`, genKey: `hr:${k}`, title: KIND_LABEL[k],
			items: recs.filter(r => r.kind === k).map(r => {
				const ent = COMPILE[k] ? COMPILE[k](r, char) : null;
				let html = "";
				try { html = ent ? TBSan.clean(TBData.renderEntity(PROP[k], ent)) : ""; } catch (e) { html = `<p>${esc(r.title)}</p>`; }
				const based = r.basedOn ? `<p><i>House rule based on ${esc(r.basedOn.name)} (${esc(TBData.sourceShort(r.basedOn.source))}).</i></p>` : "<p><i>A new house rule.</i></p>";
				return {id: `hr-item-${r.id}`, kind: "gen", key: `hr:${r.id}`, title: ent ? ent.name : r.title, html: based + html};
			}),
		}));
		b.updatedAt = Date.now();
		TBStore.changed("book");
		return b;
	};
	// endregion

	// region Editors
	const {h} = (() => ({h: (...a) => TBUI.h(...a)}))();
	const field = (label, el, hint) => h("label.field", h("span", label), el, hint ? h("div.muted.hr-hint", hint) : null);
	const DMG = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
	const chipsSelect = (opts, chosen) => {
		const set = new Set(chosen || []);
		const el = h("div.hr-chips", ...opts.map(([v, l]) => {
			const b = h("button.chip", {type: "button", class: set.has(v) ? "on" : "", on: {click: () => { set.has(v) ? set.delete(v) : set.add(v); b.classList.toggle("on"); }}}, l);
			return b;
		}));
		el.value = () => [...set];
		return el;
	};

	/** Species: name, description, size, speed, darkvision, the traits (borrowed or new) and extra mechanics. */
	const raceEditor = async (char, rec, {onSaved} = {}) => {
		const d = rec.data;
		d.traits ||= [];
		d.extra ||= {};
		const name = h("input", {type: "text", value: d.name || "", placeholder: "e.g. Horned Human"});
		const desc = h("textarea", {rows: 3, placeholder: "What sets this people (or this one character) apart."});
		desc.value = d.description || "";
		const size = h("select", ...[["M", "Medium"], ["S", "Small"], ["SM", "Small or Medium"], ["L", "Large"]].map(([v, l]) => h("option", {value: v, selected: (d.size || ["M"]).join("") === v}, l)));
		const speed = h("input", {type: "number", min: 0, step: 5, value: d.speed ?? 30, style: {width: "90px"}});
		const dv = h("input", {type: "number", min: 0, step: 30, value: d.darkvision || 0, style: {width: "90px"}});
		const ctype = h("input", {type: "text", value: d.creatureType || "Humanoid", style: {width: "140px"}});
		const traitsEl = h("div.hr-traits");
		const drawTraits = () => {
			TBUI.clear(traitsEl);
			if (!d.traits.length) traitsEl.appendChild(h("div.pick-empty", "No traits yet. Add one from any species, or write your own."));
			d.traits.forEach((t, i) => {
				const nm = h("input", {type: "text", value: t.name || "", placeholder: "Trait name"});
				nm.addEventListener("input", () => { t.name = nm.value; });
				const txt = h("textarea", {rows: 3, placeholder: "What the trait does."});
				txt.value = t.text != null ? t.text : TBData.strip(JSON.stringify(t.entries || []).replace(/^\["|"\]$/g, "")).replace(/","/g, "\n\n");
				txt.addEventListener("input", () => { t.text = txt.value; t.entries = null; });
				const chips = mechChips(t.mech);
				traitsEl.appendChild(h("div.hr-trait",
					h("div.hr-trait-h", nm,
						t.from ? h("span.muted", {style: {fontSize: "12px"}}, `from ${t.from}`) : h("span.tag.hr", "New"),
						h("div.spacer"),
						h("button.btn.ghost.small", {type: "button", title: "Move up", disabled: i === 0, on: {click: () => { d.traits.splice(i - 1, 0, d.traits.splice(i, 1)[0]); drawTraits(); }}}, "↑"),
						h("button.btn.ghost.small", {type: "button", title: "Remove this trait (and what it grants)", on: {click: () => { d.traits.splice(i, 1); drawTraits(); }}}, "✕")),
					txt,
					chips.length ? h("div.hr-mech", "Brings: ", ...chips.map(c => h("span.hb-chip", c))) : null));
			});
		};
		drawTraits();
		const addBorrowed = async () => {
			const traits = await allTraits(char);
			TBPickers.open({
				title: "Add a trait from another species",
				prop: "race",
				multi: true,
				// Every book: a trait from a 2014 species is as good as any
				legacyDefault: true,
				load: async () => traits.map(t => ({...t, name: t.name, source: t.source, _label: t.species})),
				info: (e) => e.species,
				renderPreview: (e) => `<h3>${esc(e.name)}</h3><p><i>${esc(e.species)}</i></p>${Renderer.get().setFirstSection(true).render({type: "entries", entries: e.entries})}${Object.keys(e.mech).length ? `<p><b>Brings:</b> ${esc(mechChips(e.mech).join(", "))}</p>` : ""}`,
				onPick: (e) => {
					if (d.traits.some(t => t.name === e.name && t.from === e.species)) { TBUI.toast(`${e.name} is already there.`); return; }
					d.traits.push({name: e.name, entries: JSON.parse(JSON.stringify(e.entries)), text: null, mech: e.mech, from: e.species});
					drawTraits();
					TBUI.toast(`Added ${e.name}`);
				},
			});
		};
		const x = d.extra;
		const resist = chipsSelect(DMG.map(t => [t, TBRules.titleCase(t)]), x.resist);
		const skills = chipsSelect(TBRules.SKILL_LIST.map(s => [s, TBRules.titleCase(s)]), x.skills);
		const skillChoice = h("input", {type: "number", min: 0, max: 4, value: x.skillChoice || 0, style: {width: "70px"}});
		const originFeat = h("input", {type: "checkbox", checked: !!x.originFeat});
		const spellsEl = h("div.hr-chips");
		const spells = [...(x.spells || [])];
		const drawSpells = () => {
			TBUI.clear(spellsEl);
			spells.forEach((s, i) => spellsEl.appendChild(h("span.chip.on", `${s.name}${s.level ? ` (1/LR)` : " (cantrip)"} `, h("b", {style: {cursor: "pointer"}, on: {click: () => { spells.splice(i, 1); drawSpells(); }}}, "✕"))));
			spellsEl.appendChild(h("button.btn.small", {type: "button", on: {click: async () => {
				const all = await TBData.loadSpells();
				TBPickers.open({title: "Spells this species knows", prop: "spell", multi: true, load: async () => all.filter(s => s.level <= 3 && visible(s, char)), info: (e) => (e.level ? `Lv ${e.level}` : "Cantrip"), onPick: (e) => { if (!spells.some(s => s.name === e.name && s.source === e.source)) spells.push({name: e.name, source: e.source, level: e.level}); drawSpells(); }});
			}}}, "+ Spell"));
		};
		drawSpells();
		const spellAbility = h("select", h("option", {value: "choose"}, "Int, Wis or Cha (player chooses)"), ...["int", "wis", "cha"].map(a => h("option", {value: a, selected: x.spellAbility === a}, TBRules.ABIL_NAMES[a])));
		const shared = h("input", {type: "checkbox", checked: !!rec.shared});
		const body = h("div.hr-form",
			rec.basedOn ? h("div.hr-based", `Reworking ${rec.basedOn.name} (${TBData.sourceShort(rec.basedOn.source)}). The original stays as it is; this house rule is a separate species.`) : null,
			field("Name", name),
			field("Description", desc),
			h("div.row", {style: {gap: "10px", flexWrap: "wrap"}}, field("Size", size), field("Speed (ft.)", speed), field("Darkvision (ft.)", dv, "0 for none"), field("Creature type", ctype)),
			h("div.hr-sec", h("b", "Traits"), h("div.spacer"),
				h("button.btn.small.primary", {type: "button", on: {click: addBorrowed}}, "+ From another species"),
				h("button.btn.small", {type: "button", on: {click: () => { d.traits.push({name: "", text: "", mech: {}, from: null}); drawTraits(); }}}, "+ New trait")),
			h("div.muted.hr-hint", "A trait borrowed from a species brings what it grants there (Darkvision, resistances, a feat, spells…). Removing a trait removes that too."),
			traitsEl,
			h("details.hr-extra", {open: !!(x.resist?.length || x.skills?.length || x.skillChoice || x.originFeat || spells.length)},
				h("summary", "Extra mechanics for new traits"),
				field("Damage resistances", resist),
				field("Skill proficiencies", skills),
				h("div.row", {style: {gap: "10px", flexWrap: "wrap", alignItems: "center"}}, field("Skills of the player's choice", skillChoice), h("label.chk", originFeat, "An Origin feat of the player's choice (like Versatile)")),
				field("Spells (cantrips at will, leveled spells once per Long Rest)", spellsEl),
				field("Spellcasting ability for these spells", spellAbility)),
			h("label.chk", shared, "Available to every character (not only this one)"),
		);
		const ok = async () => {
			if (!name.value.trim()) { TBUI.toast("Give the species a name.", {error: true}); return; }
			Object.assign(d, {name: name.value.trim(), description: desc.value, size: size.value === "SM" ? ["S", "M"] : [size.value], speed: Number(speed.value) || 0, darkvision: Number(dv.value) || 0, creatureType: ctype.value.trim() || "Humanoid"});
			d.traits = d.traits.filter(t => (t.name || "").trim() || (t.text || "").trim() || (t.entries || []).length).map(t => ({...t, name: (t.name || "").trim() || "Trait", entries: t.text != null ? textEntries(t.text) : t.entries}));
			d.extra = {resist: resist.value(), skills: skills.value(), skillChoice: Number(skillChoice.value) || 0, originFeat: originFeat.checked, spells, spellAbility: spellAbility.value};
			rec.title = d.name;
			rec.shared = shared.checked;
			m.close();
			await save(char, rec);
			onSaved && onSaved(rec, COMPILE.race(rec, char));
		};
		const m = TBUI.modal({
			title: rec.createdAt && recordsOf(char).some(r => r.id === rec.id) ? `House rule: ${rec.title}` : "New house rule: species",
			className: "hr-modal",
			body,
			footer: [
				recordsOf(char).some(r => r.id === rec.id) ? h("button.btn.danger", {on: {click: async () => { if (!(await TBUI.confirm("Delete house rule", `Delete “${rec.title}”? A character using it will need another species.`, {okLabel: "Delete", danger: true}))) return; m.close(); await remove(char, rec); onSaved && onSaved(null, null); }}}, "Delete") : null,
				h("div.spacer"),
				h("button.btn", {on: {click: () => m.close()}}, "Cancel"), h("button.btn.primary", {on: {click: ok}}, "Save house rule")],
		});
	};
	const EDITORS = {race: raceEditor};

	/** A new record from an existing entity (reworking it) or from scratch. */
	const FROM = {};
	const fromEntity = (kind, ent) => {
		if (FROM[kind]) return FROM[kind](ent);
		if (kind === "race") {
			const traits = (ent.entries || []).filter(e => e && e.name && Array.isArray(e.entries)).map(e => ({name: e.name, entries: JSON.parse(JSON.stringify(e.entries)), text: null, mech: mechOf(e, ent), from: String(ent.name).replace(/^([^;]+);\s*(.+)$/, "$1 ($2)")}));
			const intro = (ent.entries || []).filter(e => typeof e === "string").map(e => TBData.strip(e)).join("\n\n");
			return {name: `${String(ent.name).replace(/^([^;]+);\s*(.+)$/, "$1 ($2)")} (house rule)`, description: intro, size: ent.size || ["M"], speed: typeof ent.speed === "number" ? ent.speed : (ent.speed && ent.speed.walk) || 30, darkvision: 0, creatureType: TBRules.titleCase((ent.creatureTypes || ["humanoid"])[0]), traits, extra: {}};
		}
		return {};
	};

	const nameOf = (ent) => String(ent.name).replace(/^([^;]+);\s*(.+)$/, "$1 ($2)");
	/**
	 * The "House Rules Rework" button of a builder step.
	 * - kinds: the kinds this step can make ("race", or ["feat", "language"])
	 * - currents: [{kind, ent}] what the character has now (each can be reworked, or edited if it's a house rule)
	 * - onUse(kind, ent, {replacing, base}): make the character use the saved house rule
	 */
	const buttonFor = (char, kinds, {currents = [], onUse = null, onChanged = null, noNew = false} = {}) => h("button.btn.small.hr-btn", {title: "Rework this with house rules, or make a new one", on: {click: async () => {
		kinds = [].concat(kinds);
		const opts = [];
		const used = new Set();
		currents.filter(c => c && c.ent && kinds.includes(c.kind)).forEach(({kind, ent}, i) => {
			const rec = ent._tbHR ? recordOf(char, ent) : null;
			if (rec) { used.add(rec.id); opts.push({value: `cur:${i}`, label: `Edit “${rec.title}”`, hint: KIND_LABEL[kind]}); } else opts.push({value: `cur:${i}`, label: `Rework ${nameOf(ent)}`, hint: `${KIND_LABEL[kind]} · ${TBData.sourceShort(ent.source)}`});
		});
		if (!noNew) kinds.forEach(k => opts.push({value: `new:${k}`, label: `New ${KIND_LABEL[k].toLowerCase()} from scratch`}));
		recordsOf(char).filter(r => kinds.includes(r.kind) && !used.has(r.id)).forEach(r => opts.push({value: `rec:${r.id}`, label: `Edit “${r.title}”`, hint: KIND_LABEL[r.kind]}));
		const pick = await TBUI.choose(`House Rules Rework: ${kinds.map(k => KIND_LABEL[k]).join(", ")}`, opts);
		if (!pick) return;
		let rec;
		let base = null;
		let replacing = false;
		if (pick.startsWith("cur:")) {
			const {kind, ent} = currents.filter(c => c && c.ent && kinds.includes(c.kind))[Number(pick.slice(4))];
			const own = ent._tbHR ? recordOf(char, ent) : null;
			replacing = true;
			if (own) rec = JSON.parse(JSON.stringify(own));
			else {
				base = ent;
				rec = {id: uid(), kind, title: "", shared: false, basedOn: {name: ent.name, source: ent.source}, data: fromEntity(kind, ent), createdAt: Date.now()};
			}
		} else if (pick.startsWith("rec:")) rec = JSON.parse(JSON.stringify(recordsOf(char).find(r => r.id === pick.slice(4))));
		else rec = {id: uid(), kind: pick.slice(4), title: "", shared: false, basedOn: null, data: {}, createdAt: Date.now()};
		const isNew = pick.startsWith("new:");
		await EDITORS[rec.kind](char, rec, {onSaved: (saved, ent) => {
			if (saved && ent && onUse && (replacing || isNew)) onUse(rec.kind, ent, {replacing, base});
			onChanged && onChanged();
		}});
	}}}, "🛠 House Rules Rework");
	/** Species step (one kind, one current entity). */
	const button = (char, kind, {current = null, onUse = null, onChanged = null} = {}) => buttonFor(char, kind, {currents: current ? [{kind, ent: current}] : [], onUse: onUse ? (k, e, o) => onUse(e, o) : null, onChanged});

	/** Point everything the character has from `base` (choices, extra spells and feats, inventory) to `ent`. */
	const replaceRef = (char, base, ent) => {
		const same = (r) => r && typeof r === "object" && lc(r.name) === lc(base.name) && lc(r.source) === lc(base.source);
		const to = {name: ent.name, source: ent.source};
		Object.values(char.choices || {}).forEach(v => { if (Array.isArray(v)) v.forEach((r, i) => { if (same(r)) v[i] = {...to}; }); });
		["spells", "feats", "optfeatures"].forEach(k => (char[k] || []).forEach((r, i) => { if (same(r)) char[k][i] = {...to}; }));
		((char.equipment && char.equipment.items) || []).forEach(it => { if (same(it)) Object.assign(it, to); });
	};

	/** Kinds added from other files: {label, prop, compile(rec, owner), editor(char, rec, {onSaved}), fromEntity(ent)} */
	const register = (kind, def) => {
		KIND_LABEL[kind] = def.label;
		PROP[kind] = def.prop;
		COMPILE[kind] = def.compile;
		EDITORS[kind] = def.editor;
		if (def.fromEntity) FROM[kind] = def.fromEntity;
	};
	/** The editor window every kind uses: body, Save (validate → save → onSaved), Delete for existing records. */
	const editorModal = (char, rec, {title, body, className = "hr-modal", collect, onSaved}) => {
		const exists = recordsOf(char).some(r => r.id === rec.id);
		const ok = async () => {
			const err = await collect();
			if (err) { TBUI.toast(err, {error: true}); return; }
			m.close();
			await save(char, rec);
			onSaved && onSaved(rec, COMPILE[rec.kind](rec, char));
		};
		const m = TBUI.modal({
			title: exists ? `House rule: ${rec.title}` : title,
			className,
			body,
			footer: [
				exists ? h("button.btn.danger", {on: {click: async () => { if (!(await TBUI.confirm("Delete house rule", `Delete “${rec.title}”? Whatever uses it on the character goes missing.`, {okLabel: "Delete", danger: true}))) return; m.close(); await remove(char, rec); onSaved && onSaved(null, null); }}}, "Delete") : null,
				h("div.spacer"),
				h("button.btn", {on: {click: () => m.close()}}, "Cancel"), h("button.btn.primary", {on: {click: ok}}, "Save house rule")],
		});
		return m;
	};
	// endregion

	return {
		list, visible, isHR, recordsOf, recordOf, recordById, syncBook, button, buttonFor, replaceRef, register, allTraits, mechOf, KIND_LABEL,
		compile: (r, owner) => COMPILE[r.kind] && COMPILE[r.kind](r, owner),
		util: {h, field, chipsSelect, textEntries, sourceOf, uid, esc, lc, mergeArr, DMG, editorModal, visible},
	};
})();
