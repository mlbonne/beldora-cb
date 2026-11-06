"use strict";

/**
 * Coverage of the Play tab against the 2024 rules: what happens with every class/subclass feature and every
 * spell (automated, picker, rolled, pool, log only…). Written to docs/play-coverage.md by `TOMEBINDER_COVERAGE=1`.
 */
globalThis.TBPlayCoverage = (() => {
	const lc = (s) => String(s).toLowerCase();
	const STATUS = {
		"automated": "Automated (menu/effect/roll)", "form": "Shape-shift picker", "summon": "Summon picker + companion",
		"passive-auto": "Always applied", "damage-panel": "Damage panel option", "pool": "Spends its pool/uses + logs",
		"log": "Logs the text (no numbers to change)", "passive": "Passive (built into the sheet or text only)",
	};
	const count = (arr, f) => arr.reduce((o, r) => (o[f(r)] = (o[f(r)] || 0) + 1, o), {});

	const features = async () => {
		const {classes} = await TBData.loadClasses();
		const rows = [];
		for (const cls of classes.filter(c => c.source === "XPHB")) {
			const scs = (await TBData.getSubclasses(cls)).filter(s => s.source === "XPHB");
			const seen = new Set();
			for (const sc of [null, ...scs]) {
				const res = await TBData.resolveClass({name: cls.name, source: cls.source}, sc ? {shortName: sc.shortName, source: sc.source} : null);
				for (const f of res.features) {
					if (sc && !f.isSubclass) continue;
					const k = `${f.name}|${f.isSubclass ? sc.name : ""}`;
					if (seen.has(k) || /Ability Score Improvement|Epic Boon|Subclass$|Options$/.test(f.name) || f.isSubclassGate) continue;
					seen.add(k);
					const a = TBRules.activationOf(f.entries);
					const uses = TBPlay.usesFromText(f.entries, {mods: {str: 2, dex: 2, con: 2, int: 2, wis: 2, cha: 2}, pb: 2});
					let st;
					if (TBEffects.handlerFor({feature: f})) st = "automated";
					else if (TBPlay.formSourceFor({feature: f})) st = "form";
					else if (await TBPlay.summonOptions({feature: f})) st = "summon";
					else if (TBEffects.PASSIVES[lc(f.name)]) st = "passive-auto";
					else if (/^(Uncanny Dodge|Deflect Attacks|Deflect Energy)$/.test(f.name)) st = "damage-panel";
					else if (a.act !== "Passive" || a.uses || uses) st = (uses || a.uses) ? "pool" : "log";
					else st = "passive";
					rows.push({cls: cls.name, sub: f.isSubclass ? sc.name : "", lvl: f.level, name: f.name, act: a.act, st});
				}
			}
		}
		return rows;
	};

	const spells = async () => {
		const out = [];
		for (const s of (await TBData.loadSpells()).filter(x => x.source === "XPHB")) {
			const dice = TBPlay.spellDice(s, Math.max(1, s.level), 5);
			const kinds = [
				TBEffects.handlerFor({spell: s}) ? "effect" : "", TBPlay.formSourceFor({spell: s}) ? "form" : "", (await TBPlay.summonOptions({spell: s})) ? "summon" : "",
				s.spellAttack ? "attack roll" : "", s.savingThrow ? "save DC" : "", dice ? (dice.heal ? "healing" : "damage dice") : "",
			].filter(Boolean);
			out.push({name: s.name, level: s.level, kinds, conc: TBPlay.isConc(s)});
		}
		return out;
	};

	/** Everything in the 2024 rules that depends on a hit, a miss, a success or a failure, and what the sheet does with it. */
	const MISS_NAMES = /^(Guided Strike|Homing Strikes|Studied Attacks|Boon of Combat Prowess|Peerless Skill|Stroke of Luck|Potent Cantrip|Precision Attack)$/i;
	const FAIL_NAMES = /^(Tactical Mind|Indomitable|Peerless Skill|Stroke of Luck|Spell Breaker|Boon of Spell Recall|War Caster)$/i;
	const MISS_RE = /\bmiss(?:es|ed)?\b/i;
	const FAIL_RE = /isn.t expended|is not expended|still fails|turn(?:ing)? a failure into a success|if you fail (?:a|an|the)/i;
	const triggers = async () => {
		const rows = [];
		const strip = (e) => TBData.strip(JSON.stringify(e || []));
		const handle = (name, t, isFeat) => {
			if (/^Studied Attacks$/i.test(name)) return "After a miss: Advantage on your next attack (effect added)";
			if (/^Potent Cantrip$/i.test(name)) return "After a cantrip misses: half damage rolled";
			if (MISS_NAMES.test(name) && MISS_RE.test(t)) return "Offered after a miss (can turn it into a hit; pools the rules don't spend on a failure aren't spent)";
			if (FAIL_NAMES.test(name)) return "Offered after a failed roll / slot given back by the rules";
			if (/^(Radiant Strikes|Great Weapon Master)$/i.test(name)) return "Added to the damage automatically on a hit";
			if (TBTriggers.HIT_RE.test(t)) return isFeat ? "Offered after a hit (uses/pools spent then; once per turn tracked; dice rolled)" : "Applied on a hit";
			if (MISS_RE.test(t)) return "Logged (affects other creatures)";
			return "Logged (the other creature's roll; the DM resolves it)";
		};
		const {classes} = await TBData.loadClasses();
		for (const cls of classes.filter(c => c.source === "XPHB")) {
			const scs = (await TBData.getSubclasses(cls)).filter(x => x.source === "XPHB");
			const seen = new Set();
			for (const sc of [null, ...scs]) {
				const res = await TBData.resolveClass({name: cls.name, source: cls.source}, sc ? {shortName: sc.shortName, source: sc.source} : null);
				// Sections nested in a feature (a subclass's level 3 features sit in its introduction) count on their own
				const units = res.features.filter(f => !sc || f.isSubclass).flatMap(f => {
					const subs = (f.entries || []).filter(e => e && typeof e === "object" && e.name && Array.isArray(e.entries));
					return [{...f, entries: (f.entries || []).filter(e => !subs.includes(e))}, ...subs.map(e => ({...f, name: e.name, entries: e.entries}))];
				});
				for (const f of units) {
					const k = `${f.name}|${sc ? sc.name : ""}`;
					if (seen.has(k)) continue;
					seen.add(k);
					const t = strip(f.entries);
					if (!(TBTriggers.HIT_RE.test(t) || MISS_RE.test(t) || FAIL_RE.test(t))) continue;
					rows.push({what: "Feature", name: f.name, src: `${cls.name}${f.isSubclass ? ` (${sc.name})` : ""} ${f.level}`, how: handle(f.name, t, true)});
				}
			}
		}
		for (const ft of (await TBData.loadFeats()).filter(x => x.source === "XPHB")) {
			const t = strip(ft.entries);
			if (TBTriggers.HIT_RE.test(t) || MISS_RE.test(t) || FAIL_RE.test(t)) rows.push({what: "Feat", name: ft.name, src: "Feat", how: handle(ft.name, t, true)});
		}
		const masteryHow = {vex: "On a hit: Advantage on your next attack (effect added)", graze: "On a miss: the damage is logged", sap: "On a hit: logged", slow: "On a hit: logged", push: "On a hit: logged", topple: "On a hit: logged with the save DC", cleave: "On a hit: logged", nick: "Logged"};
		Object.entries(masteryHow).forEach(([m, how]) => rows.push({what: "Weapon mastery", name: R_().titleCase(m), src: "Mastery", how}));
		for (const sp of (await TBData.loadSpells()).filter(x => x.source === "XPHB")) {
			const cond = (sp.time || []).map(x => x.condition || "").join(" ");
			if (/after hitting or missing/i.test(cond)) rows.push({what: "Spell", name: sp.name, src: `Level ${sp.level}`, how: "Offered after a hit or a miss (slot spent only then)"});
			else if (/after hitting/i.test(cond)) rows.push({what: "Spell", name: sp.name, src: `Level ${sp.level}`, how: "Offered after a hit (slot spent only on a hit)"});
			else if (sp.spellAttack) rows.push({what: "Spell", name: sp.name, src: sp.level ? `Level ${sp.level}` : "Cantrip", how: "Spell attack: damage rolled only on a hit (crit doubles dice; Potent Cantrip half on a miss)"});
			else if (/^(Counterspell|Dispel Magic)$/.test(sp.name)) rows.push({what: "Spell", name: sp.name, src: `Level ${sp.level}`, how: "Spell Breaker: the slot comes back if it fails"});
		}
		return rows;
	};
	const R_ = () => TBRules;

	const report = async () => {
		const rows = await features();
		const srows = await spells();
		const fc = count(rows, r => r.st);
		const classes = [...new Set(rows.map(r => r.cls))];
		let md = `# Play sheet coverage (2024 rules)\n\nGenerated ${new Date().toISOString().slice(0, 10)} from the 5etools data: what the Play tab does with each class feature and spell.\n\n`;
		md += `## Class and subclass features (${rows.length})\n\n| Handling | Count |\n|---|---|\n${Object.entries(STATUS).map(([k, l]) => `| ${l} | ${fc[k] || 0} |`).join("\n")}\n\n`;
		md += "Every feature can be opened and read; every Action/Bonus Action/Reaction feature has a Use button that marks the action economy and spends its uses. \"Logs the text\" means the feature acts on other creatures or the story (nothing to change on this sheet) or isn't modelled yet.\n\n";
		classes.forEach(cls => {
			md += `### ${cls}\n\n| Lvl | Feature | Subclass | Uses | Handling |\n|---|---|---|---|---|\n`;
			rows.filter(r => r.cls === cls).sort((a, b) => a.lvl - b.lvl || a.sub.localeCompare(b.sub)).forEach(r => { md += `| ${r.lvl} | ${r.name} | ${r.sub} | ${r.act} | ${STATUS[r.st]} |\n`; });
			md += "\n";
		});
		const sc = count(srows, r => r.kinds.length ? (r.kinds.some(k => ["effect", "form", "summon"].includes(k)) ? "applied" : "rolled") : "slot");
		md += `## Spells (${srows.length})\n\nEvery spell: slot choice (upcasting, pact slots, rituals), action economy and concentration (a new concentration spell ends the old one, with its effects, forms and summons).\n\n| Handling | Count |\n|---|---|\n| Applied to the sheet (effect, form or summon) | ${sc.applied || 0} |\n| Rolled for you (attack roll, damage/healing dice, save DC) | ${sc.rolled || 0} |\n| Slot and concentration only (utility, no numbers) | ${sc.slot || 0} |\n\n| Spell | Level | Conc. | What the sheet does |\n|---|---|---|---|\n`;
		srows.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)).forEach(r => { md += `| ${r.name} | ${r.level || "C"} | ${r.conc ? "yes" : ""} | ${r.kinds.join(", ") || "slot and concentration"} |\n`; });
		const trig = await triggers();
		const tc = count(trig, r => r.how);
		md += `\n## Hits, misses, successes and failures (${trig.length})\n\nAttack rolls ask "hit or miss?" when something depends on it (physical dice: next to the result; app dice: after the roll), and only damage on a hit is rolled. Checks and saves whose result changes the sheet (Hide, Escape a Grapple, Concentration, bartering) are worked out against the DC; any failed roll can be turned around from the log ("✗ It failed…"). With \"I roll my own dice (the app only asks for some rolls)\", damage to other creatures and rolls that change nothing on the sheet aren't asked for.\n\n| Handling | Count |\n|---|---|\n${Object.entries(tc).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}\n\n| Kind | Name | From | Handling |\n|---|---|---|---|\n${trig.map(r => `| ${r.what} | ${r.name} | ${r.src} | ${r.how} |`).join("\n")}\n`;
		md += "\n## Standard actions\n\nDash (Speed doubled this turn), Dodge (Advantage on Dexterity saves, attackers at Disadvantage), Disengage, Hide (rolls Stealth against DC 15 and applies Invisible), Help, Search/Study/Influence (pick the skill, rolled), Escape a Grapple (Athletics or Acrobatics), Don or Doff a Shield (AC updates), End Concentration, Ready, Utilize.\n\n";
		md += "## Always applied\n\nExhaustion (−2 per level on d20 tests, −5 ft. Speed per level), conditions (Grappled/Restrained/Paralyzed/Stunned/Unconscious set Speed to 0; Advantage/Disadvantage from Poisoned, Frightened, Prone, Blinded, Restrained, Invisible; no actions while Incapacitated), equipped items (AC, ability scores, saves, magic weapons, spell DC, speed, resistances), resistances halving damage of that type, temporary forms (AC, Speed, physical scores, saves and skills, the form's own attacks), passive features (Danger Sense, Feral Instinct, Aura of Protection), and the player's own bonuses on AC, Initiative, Speed and Proficiency.\n";
		return {md, features: rows.length, byStatus: fc, spells: srows.length, spellsBy: sc, triggers: trig.length, triggersBy: tc};
	};

	return {report};
})();
