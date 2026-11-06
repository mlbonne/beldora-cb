"use strict";

/** Lean, serialisable payloads for the character sheet and card PDFs (built from TBRules.analyze). */
globalThis.TBExportData = (() => {
	const R = () => TBRules;
	const D = () => TBData;
	const refKey = (e) => R().refKey(e);

	const spellRow = (s) => {
		const m = D().spellMeta(s.ent);
		let school = m.school;
		return {name: s.ent.name, level: s.ent.level, school, time: m.timeShort || m.time, range: m.range, duration: m.duration, components: m.components, conc: m.conc, ritual: m.ritual, via: s.via, always: !!s.always, abil: s.altAbility && s.cast ? s.cast.abbr : "", key: `spell:${refKey(s.ent)}`};
	};

	const sheetData = (A) => {
		const d = A.derived;
		return {
			name: d.name,
			player: d.player,
			classLine: d.classes.map(c => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass})` : ""}`).join(" / "),
			totalLevel: d.totalLevel,
			species: d.species,
			background: d.background,
			alignment: d.details.alignment || "",
			pb: d.pb,
			scores: d.scores,
			mods: d.mods,
			saves: d.saves,
			skills: R().SKILL_LIST.map(s => ({name: R().titleCase(s), ...d.skills[s]})),
			ac: d.ac, acNote: d.acNote, hp: d.hp, hitDice: d.hitDice, initiative: d.initiative, speed: d.speed, size: d.size,
			passive: d.passive, darkvision: d.darkvision,
			armorProf: d.armorProf, weaponProf: d.weaponProf, tools: d.tools, languages: d.languages, resist: d.resist, masteries: d.masteries,
			attacks: d.attacks,
			casting: d.casting,
			spellcasting: d.spellcasting, spellSources: d.spellSources || [],
			slots: d.slots,
			spells: d.spells.map(spellRow),
			features: R().featureList(d).map(f => ({name: f.name, kind: f.kind, group: f.group, level: f.level || null, act: f.act, uses: f.uses, key: f.key, summary: D().summarize(f.entries, 110)})),
			items: d.items.map(i => ({name: i.name, qty: i.qty || 1, equipped: !!i.equipped})),
			cp: d.cp,
			details: d.details,
			portrait: d.portrait,
		};
	};

	/**
	 * Cards for everything you use at the table. Spells, active features and attacks always;
	 * passive features and feats when opts.passives is on.
	 */
	const cardsData = (A, {passives = true, spells = true} = {}) => {
		const d = A.derived;
		const cards = [];
		const render = (entries) => TBSan.clean(Renderer.get().setFirstSection(true).render({type: "entries", entries}));
		if (spells) {
			d.spells.forEach(s => {
				const m = D().spellMeta(s.ent);
				const sub = s.ent.level === 0 ? `${m.school} cantrip` : `Level ${s.ent.level} ${m.school}`;
				const entries = [...(s.ent.entries || [])];
				if (s.ent.entriesHigherLevel) entries.push(...s.ent.entriesHigherLevel);
				cards.push({
					type: "spell",
					title: s.ent.name,
					subtitle: `${sub}${m.ritual ? " (ritual)" : ""}`,
					tags: [m.conc ? "Concentration" : null, s.always ? "Always prepared" : null].filter(Boolean),
					stats: [["Casting Time", m.time], ["Range", m.range], ["Components", m.components], ["Duration", m.duration]],
					html: render(entries),
					footer: `${s.via || ""}`,
					key: `spell:${refKey(s.ent)}`,
				});
			});
		}
		R().featureList(d).forEach(f => {
			const active = f.act !== "Passive" || f.uses;
			if (!active && !passives) return;
			if (/^(Ability Score Improvement|Epic Boon|.* Subclass|Subclass Feature)$/i.test(f.name)) return;
			cards.push({
				type: f.act === "Passive" ? "passive" : f.act === "Bonus Action" ? "bonus" : f.act === "Reaction" ? "reaction" : "action",
				title: f.name,
				subtitle: f.kind === "Class" || f.kind === "Subclass" ? `${f.group} · Level ${f.level}` : `${f.kind} · ${f.group}`,
				tags: [f.act !== "Passive" ? f.act : null, f.uses || null].filter(Boolean),
				stats: [],
				html: render(f.entries),
				footer: f.kind,
				key: f.key,
			});
		});
		d.attacks.forEach(a => {
			cards.push({
				type: "attack",
				title: a.name,
				subtitle: "Weapon attack",
				tags: [a.mastery ? `Mastery: ${a.mastery}` : null].filter(Boolean),
				stats: [["To hit", R().signed(a.bonus)], ["Damage", a.damage], a.versatile ? ["Two-handed", a.versatile] : null, a.range ? ["Range", String(a.range)] : null, a.props ? ["Properties", a.props] : null].filter(Boolean),
				html: a.mastery ? `<p>You can use this weapon's mastery property: <b>${TBBook.esc(a.mastery)}</b>.</p>` : "",
				footer: "Attack",
				key: null,
			});
		});
		return {cards, name: d.name};
	};

	return {sheetData, cardsData};
})();
