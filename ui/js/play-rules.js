"use strict";

/**
 * Live sheet ("Play" tab) rules: what a character can do at the table and what it costs.
 * Session state lives on the character (char.play) so it is saved with the character file:
 *   hit points, temporary HP, spent hit dice, Heroic Inspiration, spell slots and resource uses,
 *   item charges, conditions, exhaustion, concentration, a temporary form, summoned creatures,
 *   situational bonuses, the player's own bonuses to AC/initiative/speed/proficiency, the turn's
 *   action economy, the session's XP and a roll log.
 * Rolls go through one dice source: the app's own dice, or the player's physical dice (asked for).
 */
globalThis.TBPlay = (() => {
	const R = () => TBRules;
	const D = () => TBData;
	const lc = (s) => String(s ?? "").toLowerCase();
	const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
	const strip = (s) => D().strip(String(s ?? ""));
	const _cache = {};
	const once = (k, fn) => (_cache[k] ||= fn());

	// region State
	const blank = () => ({
		hp: null, temp: 0, hdSpent: {}, inspiration: false,
		slotsUsed: {}, pactUsed: 0, uses: {}, itemCharges: {},
		conditions: [], exhaustion: 0, death: {s: 0, f: 0},
		concentration: null, form: null, summons: [], effects: [], sit: {}, adv: "normal",
		adjust: {ac: 0, init: 0, speed: 0, pb: 0}, physical: false, sessionXp: 0,
		turn: {action: false, bonus: false, reaction: false, round: 1, once: {}},
		log: [],
	});
	/** The character's session state, filled in place (callers keep references to it). */
	const stateOf = (char) => {
		const P = (char.play ||= {});
		const b = blank();
		Object.keys(b).forEach(k => { if (P[k] === undefined || (P[k] === null && typeof b[k] === "object" && b[k] !== null)) P[k] = b[k]; });
		["turn", "death", "adjust"].forEach(g => Object.keys(b[g]).forEach(k => { if (P[g][k] === undefined) P[g][k] = b[g][k]; }));
		return P;
	};
	const log = (char, text, extra = {}) => {
		const P = stateOf(char);
		P.log.unshift({t: Date.now(), text, ...extra});
		if (P.log.length > 60) P.log.length = 60;
	};
	// endregion

	// region Player bonuses
	/**
	 * The derived numbers with the player's own bonuses (Play tab): AC, initiative, speed and proficiency.
	 * A proficiency bonus change reaches proficient saves and skills, attacks and spell DCs too.
	 */
	/** Always-on features per character (Danger Sense…), refreshed whenever the sheet's numbers are worked out. */
	const passiveMap = new Map();
	/** Every active effect's mods of one kind, flattened. */
	const effectMods = (char) => stateOf(char).effects.map(e => e.mods || {});
	const hasArmorOn = (d) => d.items.some(i => i.equipped && i.ent && R().isArmorEnt(i.ent));

	/**
	 * The numbers the sheet shows and rolls with: the derived character plus the player's own bonuses,
	 * active effects (Haste, Shield, Rage, Mage Armor…), Exhaustion and conditions, and a temporary form.
	 * `formMon` is the form's stat block (when shape-shifted).
	 */
	const effective = (char, d, formMon = null) => {
		const P = stateOf(char);
		const A = P.adjust;
		const fx = effectMods(char);
		const pbB = Number(A.pb) || 0;
		const e = {...d, mods: {...d.mods}, scores: {...d.scores}};
		e.natural = {ac: d.ac, initiative: d.initiative, speed: d.speed, pb: d.pb};
		e.notes = {ac: [], speed: [...(d.speedNotes || [])], hp: []};
		e.pb = d.pb + pbB;
		let saves = Object.fromEntries(Object.entries(d.saves).map(([k, v]) => [k, {...v, bonus: v.bonus + (v.prof ? pbB : 0)}]));
		let skills = Object.fromEntries(Object.entries(d.skills).map(([k, v]) => [k, {...v, bonus: v.bonus + (v.exp ? 2 * pbB : v.prof ? pbB : 0)}]));
		let ac = d.ac;
		let speed = d.speed;
		e.canCast = true;
		e.formActions = null;

		// Shape-shifted: the form's AC, Speed and physical abilities (all six for Polymorph/True Polymorph)
		if (formMon && P.form) {
			const keepMental = P.form.via === "Wild Shape" || P.form.keepMental;
			const replace = keepMental ? ["str", "dex", "con"] : ["str", "dex", "con", "int", "wis", "cha"];
			replace.forEach(a => { if (typeof formMon[a] === "number") { e.scores[a] = formMon[a]; e.mods[a] = Parser.getAbilityModNumber(formMon[a]); } });
			const num = (v) => Number(String(v ?? "").replace(/[^-\d]/g, "")) || 0;
			const listed = (obj, k) => (obj && obj[k] != null ? num(obj[k]) : null);
			saves = Object.fromEntries(Object.entries(saves).map(([k, v]) => {
				if (!replace.includes(k)) return [k, v];
				const own = e.mods[k] + (v.prof ? e.pb : 0);
				const theirs = listed(formMon.save, k);
				return [k, {...v, bonus: theirs != null ? Math.max(own, theirs) : own}];
			}));
			skills = Object.fromEntries(Object.entries(skills).map(([k, v]) => {
				if (!replace.includes(v.ability)) return [k, v];
				const own = e.mods[v.ability] + (v.exp ? 2 * e.pb : v.prof ? e.pb : 0);
				const theirs = listed(formMon.skill, k);
				return [k, {...v, bonus: theirs != null ? Math.max(own, theirs) : own}];
			}));
			const fac = (formMon.ac || [])[0];
			ac = Number(fac?.ac ?? fac) || ac;
			e.notes.ac.push(`${P.form.name}'s AC`);
			const sp = formMon.speed || {};
			speed = Number(typeof sp.walk === "object" ? sp.walk.number : sp.walk) || 0;
			e.formSpeeds = Object.entries(sp).filter(([k]) => k !== "walk" && k !== "canHover").map(([k, v]) => `${k} ${typeof v === "object" ? v.number : v} ft.`);
			e.notes.speed = [`${P.form.name}'s Speed`];
			e.canCast = !!P.form.keepMental && P.form.via !== "Wild Shape";
			e.formActions = formActionsOf(formMon);
		}

		// Active effects
		let acBase = null;
		let acMin = 0;
		let speedMult = 1;
		fx.forEach(m => {
			if (m.acBase && !hasArmorOn(d) && !formMon) acBase = Math.max(acBase || 0, m.acBase);
			if (m.acMin) acMin = Math.max(acMin, m.acMin);
			if (m.speed) speed += m.speed;
			if (m.speedMult) speedMult = Math.max(speedMult, m.speedMult);
		});
		// A new base AC (Mage Armor) first, then bonuses on top (Haste, Shield…)
		if (acBase != null) {
			const shield = d.items.find(i => i.equipped && i.ent && R().isShieldEnt(i.ent));
			const candidate = acBase + e.mods.dex + (shield ? (shield.ent.ac || 2) : 0) + (d.itemEffects?.ac || 0);
			if (candidate > ac) { e.notes.ac.push(`Mage Armor ${acBase} + DEX`); ac = candidate; }
		}
		fx.forEach(m => { if (m.ac) ac += m.ac; });
		P.effects.forEach(ef => { if (ef.mods?.ac) e.notes.ac.push(`${ef.mods.ac > 0 ? "+" : ""}${ef.mods.ac} ${ef.name}`); });
		if (acMin && ac < acMin) { ac = acMin; e.notes.ac.push(`at least ${acMin}`); }
		e.ac = ac + (Number(A.ac) || 0);

		// Speed: effects, Exhaustion (−5 ft. per level), then conditions that stop movement
		P.effects.forEach(ef => { if (ef.mods?.speed) e.notes.speed.push(`+${ef.mods.speed} ${ef.name}`); });
		speed = Math.max(0, speed + (Number(A.speed) || 0) - 5 * (P.exhaustion || 0));
		if (P.exhaustion) e.notes.speed.push(`−${5 * P.exhaustion} Exhaustion`);
		if (speedMult > 1) { speed *= speedMult; e.notes.speed.push(`×${speedMult} ${P.effects.filter(ef => ef.mods?.speedMult).map(ef => ef.name).join(", ")}`); }
		const stop = [...P.conditions.filter(c => ["grappled", "restrained", "paralyzed", "petrified", "stunned", "unconscious"].includes(c)).map(c => R().titleCase(c)), ...P.effects.filter(ef => ef.mods?.speedZero).map(ef => ef.name)];
		if (stop.length) { speed = 0; e.notes.speed.push(`0: ${stop.join(", ")}`); }
		e.speed = speed;
		e.fly = Math.max(0, ...fx.map(m => m.fly || 0));
		e.initiative = (formMon && P.form ? e.mods.dex : d.initiative) + (Number(A.init) || 0);
		// Always-on features (Aura of Protection…)
		e.passives = globalThis.TBEffects ? TBEffects.passivesOf(d) : [];
		passiveMap.set(char.id, e.passives);
		const saveFlat = e.passives.reduce((t, x) => t + (x.saveFlat || 0), 0);
		if (saveFlat) saves = Object.fromEntries(Object.entries(saves).map(([k, v]) => [k, {...v, bonus: v.bonus + saveFlat}]));
		e.saves = saves;
		e.skills = skills;
		e.passive = {perception: 10 + skills.perception.bonus, insight: 10 + skills.insight.bonus, investigation: 10 + skills.investigation.bonus};
		e.attacks = formMon && P.form ? [] : d.attacks.map(a => ({...a, bonus: a.bonus + (a.prof ? pbB : 0)}));
		// Shillelagh and the like: some weapons attack with the spellcasting ability and a bigger die
		for (const wc of fx.map(m => m.weaponCast).filter(Boolean)) {
			const re = new RegExp(wc.match, "i");
			e.attacks = e.attacks.map(a => {
				if (!a.dice || !re.test(a.name)) return a;
				const m = e.mods[wc.ability];
				return {...a, abil: wc.ability, bonus: m + (a.prof ? e.pb : 0) + (a.magicHit || 0), damage: `${wc.die}${signed(m + (a.magicDmg || 0))} ${wc.type || a.dmgType}`, versatile: "", props: [a.props, wc.name].filter(Boolean).join(", ")};
			});
		}
		const dcB = fx.reduce((t, m) => t + (m.spellDc || 0), 0);
		e.casting = d.casting.map(c => ({...c, dc: c.dc + pbB + dcB, attack: c.attack + pbB}));
		e.spellDcBonus = dcB;
		e.spellcasting = d.spellcasting ? {...TBRules.castFor(e), source: d.spellcasting.source} : null;
		e.spellSources = (d.spellSources || []).map(x => ({...x, ...TBRules.castFor(e, {ability: x.ability})}));
		const hpMax = fx.reduce((t, m) => t + (m.hpMax || 0), 0);
		e.hp = d.hp + hpMax;
		if (hpMax) e.notes.hp.push(`+${hpMax} max (${P.effects.filter(ef => ef.mods?.hpMax).map(ef => ef.name).join(", ")})`);
		e.resist = [...new Set([...(d.resist || []), ...fx.flatMap(m => (m.resist || []).map(R().titleCase))])];
		e.effectConditions = [...new Set(fx.flatMap(m => m.conditions || []))];
		return e;
	};

	/** A form's actions with what they roll: {name, eco, text, hit, damage: [{dice, type}], dc, save}. */
	const formActionsOf = (mon) => {
		const out = [];
		[["action", "action"], ["bonus", "bonus"], ["reaction", "reaction"]].forEach(([prop, eco]) => (mon[prop] || []).forEach(a => {
			const raw = JSON.stringify(a.entries || []);
			const dmg = [...raw.matchAll(/\{@damage ([^}|]+)\}\)?\s*([A-Z][a-z]+)?/g)].map(m => ({dice: m[1].trim(), type: m[2] || ""}));
			const hit = /\{@hit (-?\d+)/.exec(raw);
			const dc = /\{@dc (\d+)/.exec(raw);
			const save = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) Saving Throw/i.exec(strip(raw));
			out.push({name: strip(a.name || ""), eco, text: strip(raw).replace(/^\["?|"?\]$/g, "").replace(/","/g, " "), hit: hit ? Number(hit[1]) : null, damage: dmg, dc: dc ? Number(dc[1]) : null, save: save ? save[1] : null});
		}));
		return out;
	};

	/** Extra damage active effects add to a hit: dice (Hunter's Mark, Divine Favor…) and flat (Rage). */
	const damageExtras = (char, attack, {spell = false} = {}) => {
		const dice = [];
		let flat = 0;
		const names = [];
		stateOf(char).effects.forEach(ef => {
			const m = ef.mods || {};
			(m.damage || []).forEach(x => {
				if (x.on === "weapon" && spell) return;
				dice.push(x);
				names.push(`${ef.name}${x.target ? " (marked target)" : ""}`);
			});
			if (m.damageFlat && !spell && attack && (m.damageFlat.on !== "str" || attack.abil === "str")) { flat += m.damageFlat.n; names.push(ef.name); }
		});
		return {dice, flat, names};
	};

	/** Add an active effect (replacing one with the same name). */
	const addEffect = (char, ef, {via = null} = {}) => {
		const P = stateOf(char);
		P.effects = P.effects.filter(x => x.name !== ef.name);
		const item = {id: Math.random().toString(36).slice(2, 9), name: ef.name, mods: ef.mods || {}, notes: ef.notes || "", rounds: ef.rounds ?? null, until: ef.until || null, conc: !!ef.conc, via: via || ef.name, at: Date.now()};
		P.effects.push(item);
		if (ef.extraAction) P.turn.action = false;
		log(char, `${ef.name}: active${item.rounds ? ` for ${item.rounds >= 600 ? `${Math.round(item.rounds / 600)} h` : item.rounds >= 10 ? `${Math.round(item.rounds / 10)} min` : `${item.rounds} rounds`}` : ""}`, {notes: [item.notes].filter(Boolean)});
		return item;
	};
	const endEffect = (char, id, why = "") => {
		const P = stateOf(char);
		const ef = P.effects.find(x => x.id === id);
		if (!ef) return;
		P.effects = P.effects.filter(x => x !== ef);
		log(char, `${ef.name} ended${why ? ` (${why})` : ""}`);
		if (ef.name === "Haste") log(char, "Haste ended: you can't move or take actions until after your next turn.");
		if (ef.conc && P.concentration && P.concentration.name === ef.via && !P.effects.some(x => x.conc && x.via === ef.via)) P.concentration = null;
	};

	/** Start of the character's turn: effects "until the start of your next turn" end, timers tick, Heroism refreshes. */
	const nextTurn = (char) => {
		const P = stateOf(char);
		P.turn.action = false; P.turn.bonus = false; P.turn.reaction = false; P.turn.round++; P.turn.once = {};
		log(char, `Round ${P.turn.round}: your turn`);
		[...P.effects].forEach(ef => {
			if (ef.until === "turnStart") { endEffect(char, ef.id, "start of your turn"); return; }
			if (ef.mods?.turnTemp) addTemp(char, ef.mods.turnTemp);
			if (ef.rounds != null) { ef.rounds--; if (ef.rounds <= 0) endEffect(char, ef.id, "duration over"); }
		});
	};

	const currentHp = (char, d) => {
		const P = stateOf(char);
		return P.hp == null ? d.hp : Math.max(0, Math.min(d.hp, P.hp));
	};
	// endregion

	// region Dice
	/** The app's dice: "2d8+3", "1d4", "8d6 + 1d6", "+2". Returns {total, text}. */
	const roll = (expr, {crit = false} = {}) => {
		const src = String(expr ?? "0").replace(/\s+/g, "").replace(/−/g, "-");
		let total = 0;
		const parts = [];
		const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/gi;
		let m;
		while ((m = re.exec(src))) {
			if (m[3]) {
				const sign = m[1] === "-" ? -1 : 1;
				const n = (Number(m[2]) || 1) * (crit ? 2 : 1);
				const f = Number(m[3]);
				const rs = Array.from({length: n}, () => 1 + Math.floor(Math.random() * f));
				total += rs.reduce((a, b) => a + b, 0) * sign;
				parts.push(`${sign < 0 ? "-" : ""}${n}d${f}[${rs.join(",")}]`);
			} else if (m[5]) {
				const v = Number(m[5]) * (m[4] === "-" ? -1 : 1);
				total += v;
				parts.push(signed(v));
			}
		}
		return {total, text: parts.join(" ").replace(/^\+/, "")};
	};
	/** Split "2d8+1d6+3" into its dice ("2d8+1d6", doubled on a crit) and its flat part (3). */
	const splitDice = (expr, crit) => {
		const src = String(expr ?? "0").replace(/\s+/g, "");
		const dice = [];
		let flat = 0;
		const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/gi;
		let m;
		while ((m = re.exec(src))) {
			if (m[3]) dice.push(`${m[1] === "-" ? "-" : ""}${(Number(m[2]) || 1) * (crit ? 2 : 1)}d${m[3]}`);
			else if (m[5]) flat += Number(m[5]) * (m[4] === "-" ? -1 : 1);
		}
		return {dice: dice.join(" + ").replace(/\+ -/g, "- "), flat};
	};

	/**
	 * The player's dice: set by the Play view. It asks for physical dice results ({kind: "dice"|"d20"}) and for
	 * outcomes ({kind: "outcome"}: hit / miss, success / failure); resolves to the answer, or null when canceled.
	 */
	let provider = null;
	const setDiceProvider = (fn) => { provider = fn; };
	/** "app" (the app rolls), "all" (the player rolls everything), "some" (the player rolls; the app asks only what the sheet needs). */
	const diceMode = (char) => {
		const v = char && stateOf(char).physical;
		return !v || !provider ? "app" : v === "some" ? "some" : "all";
	};
	const physical = (char) => diceMode(char) !== "app";
	/** Ask the player how something turned out: "hit" | "crit" | "miss" | "success" | "fail" (null when closed). */
	const askOutcome = (char, req) => (provider ? provider({kind: "outcome", ...req}) : Promise.resolve(null));
	const OUTCOME_LABEL = {hit: "hit", crit: "critical hit", miss: "miss", success: "success", fail: "failure"};
	/** How a roll is shown in the log: "12 (2d6 [9] +3)", or the dice to roll when the app didn't ask. */
	const shown = (r) => (r.skipped ? `${r.text} (your roll)` : `${r.total} (${r.text})`);

	/**
	 * Roll an expression with the character's dice source. Resolves to {total, text} or null (canceled).
	 * for: "self" (changes this sheet: healing, temporary HP…) or "enemy" (damage to others: not asked for
	 * when the player rolls their own dice and only some rolls are asked; {skipped: true, total: null}).
	 */
	const rollFor = async (char, expr, {crit = false, label = "", for: target = "self"} = {}) => {
		const mode = diceMode(char);
		if (mode === "some" && target === "enemy") {
			const {dice, flat} = splitDice(expr, crit);
			return {total: null, skipped: true, text: `${dice || ""}${flat ? (dice ? ` ${signed(flat)}` : String(flat)) : ""}`.trim() || String(expr)};
		}
		if (mode === "app") return roll(expr, {crit});
		const {dice, flat} = splitDice(expr, crit);
		if (!dice) return {total: flat, text: signed(flat)};
		const v = await provider({kind: "dice", label, dice, flat});
		if (v == null) return null;
		return {total: v + flat, text: `${dice} [${v} rolled]${flat ? ` ${signed(flat)}` : ""}`};
	};
	const pickNat = (vals, mode) => (mode === "adv" ? Math.max(...vals) : mode === "dis" ? Math.min(...vals) : vals[0]);
	/** A d20 whose number matters (death saves…). Resolves to {nat, dice} or null. */
	const d20For = async (char, mode = "normal", label = "") => {
		if (physical(char)) {
			const v = await provider({kind: "d20", label, count: mode === "normal" ? 1 : 2, mode});
			const vals = Array.isArray(v) ? v : v?.vals;
			if (!vals) return null;
			return {nat: pickNat(vals, mode), dice: vals};
		}
		const a = 1 + Math.floor(Math.random() * 20);
		if (mode === "normal") return {nat: a, dice: [a]};
		const b = 1 + Math.floor(Math.random() * 20);
		return {nat: mode === "adv" ? Math.max(a, b) : Math.min(a, b), dice: [a, b]};
	};
	// endregion

	// region Conditions
	/** What a condition does to the character's own d20 tests (2024 rules). */
	const COND_FX = {
		blinded: {attack: "dis"},
		frightened: {attack: "dis", check: "dis"},
		poisoned: {attack: "dis", check: "dis"},
		prone: {attack: "dis"},
		restrained: {attack: "dis", saveDex: "dis"},
		invisible: {attack: "adv", init: "adv"},
		incapacitated: {noActions: true, init: "dis"},
		paralyzed: {noActions: true, saveStrDex: "fail"},
		stunned: {noActions: true, saveStrDex: "fail"},
		unconscious: {noActions: true, saveStrDex: "fail"},
		petrified: {noActions: true, saveStrDex: "fail"},
		grappled: {speed0: true},
	};
	const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"];

	/** Does an effect key ("save", "save:dex", "attack:str", "skill:stealth") apply to a test kind ("save:dex", "check:dex:stealth")? */
	const keyMatches = (key, kind) => kind === key || kind.startsWith(`${key}:`) || (key.startsWith("skill:") && kind.endsWith(`:${key.slice(6)}`));

	/** Advantage mode and notes for a test kind: "attack:<abil|spell>" | "check:<abil>[:<skill>]" | "save:<abil>" | "init". */
	const testMode = (char, kind, base = "normal") => {
		const P = stateOf(char);
		let adv = base === "adv";
		let dis = base === "dis";
		const notes = [];
		(passiveMap.get(char.id) || []).forEach(x => (x.adv || []).forEach(k => { if (keyMatches(k, kind)) { adv = true; notes.push(`${x.why}: Advantage`); } }));
		P.effects.forEach(ef => {
			(ef.mods?.adv || []).forEach(k => { if (keyMatches(k, kind)) { adv = true; notes.push(`${ef.name}: Advantage`); } });
			(ef.mods?.dis || []).forEach(k => { if (keyMatches(k, kind)) { dis = true; notes.push(`${ef.name}: Disadvantage`); } });
		});
		const conds = [...new Set([...P.conditions, ...effectMods(char).flatMap(m => m.conditions || [])])];
		conds.forEach(c => {
			const fx = COND_FX[c] || {};
			const hit = (v) => { if (v === "adv") adv = true; if (v === "dis") dis = true; notes.push(`${R().titleCase(c)}: ${v === "adv" ? "Advantage" : "Disadvantage"}`); };
			if (kind.startsWith("attack") && fx.attack) hit(fx.attack);
			if (kind.startsWith("check") && fx.check) hit(fx.check);
			if (kind === "init" && fx.init) hit(fx.init);
			if (kind === "save:dex" && fx.saveDex) hit(fx.saveDex);
			if ((kind === "save:str" || kind === "save:dex") && fx.saveStrDex === "fail") notes.push(`${R().titleCase(c)}: automatically fails`);
		});
		if (P.exhaustion) notes.push(`Exhaustion ${P.exhaustion}: −${P.exhaustion * 2}`);
		const mode = adv && !dis ? "adv" : dis && !adv ? "dis" : "normal";
		return {mode, notes, penalty: P.exhaustion * 2};
	};

	/**
	 * Roll a d20 test, log it and return {total, nat, text, notes, outcome, ok, crit} (null when canceled).
	 * outcome: null, "attack" (hit / critical / miss) or "check" (success / failure). decide: the outcome must be
	 * known (something triggers on it); otherwise physical dice get it as an option next to the result.
	 * dc: when known the outcome is worked out. need: the number itself matters (always asked).
	 * With "some" rolls asked, a test that changes nothing on the sheet isn't asked for: it's logged with its bonus.
	 */
	const test = async (char, label, bonus, kind, {sit = "", base = "normal", outcome = null, decide = false, dc = null, need = false} = {}) => {
		const P = stateOf(char);
		const tm = testMode(char, kind, base === "normal" ? P.adv : base);
		const mode = diceMode(char);
		const modeTxt = tm.mode === "adv" ? " with Advantage" : tm.mode === "dis" ? " with Disadvantage" : "";
		const mustKnow = decide || dc != null;
		if (mode === "some" && !mustKnow && !need) {
			const effDice = P.effects.flatMap(ef => Object.entries(ef.mods?.dice || {}).filter(([k]) => keyMatches(k, kind)).map(([, v]) => `${/^[+-]/.test(v) ? "" : "+"}${v} ${ef.name}`));
			const text = `${label}: roll d20${modeTxt} ${signed(bonus - tm.penalty)}${effDice.length ? ` ${effDice.join(" ")}` : ""}${sit ? ` ${/^[+-]/.test(sit) ? "" : "+"}${sit}` : ""}`;
			log(char, text, {notes: tm.notes, kind: "d20", label, bonus, testKind: kind, sit, skipped: true});
			return {skipped: true, total: null, nat: null, text, notes: tm.notes, outcome: null, ok: null};
		}
		let r = null;
		let picked = null;
		if (mode === "app") {
			r = await d20For(char, tm.mode, label);
		} else {
			// Physical dice: the result, with the outcome buttons next to it when an outcome is wanted
			const optional = mode === "some" && outcome && dc == null && !need;
			const v = await provider({kind: "d20", label, count: tm.mode === "normal" ? 1 : 2, mode: tm.mode, outcome: outcome && dc == null ? outcome : null, decide: mustKnow && dc == null, optional, bonus, notes: tm.notes});
			if (v == null) return null;
			const vals = Array.isArray(v) ? v : v.vals;
			picked = Array.isArray(v) ? null : v.outcome || null;
			if (vals) r = {nat: pickNat(vals, tm.mode), dice: vals};
		}
		if (!r && !picked) return null;
		if (!r) {
			const text = `${label}: ${OUTCOME_LABEL[picked]} (d20${modeTxt} ${signed(bonus - tm.penalty)})`;
			log(char, text, {notes: tm.notes, kind: "d20", label, bonus, testKind: kind, sit, outcome: picked});
			return {total: null, nat: null, text, notes: tm.notes, outcome: picked, ok: ["hit", "crit", "success"].includes(picked), crit: picked === "crit"};
		}
		// Bonus dice from effects (Bless, Guidance, Pass without Trace…) and the situational box
		const adds = [];
		P.effects.forEach(ef => Object.entries(ef.mods?.dice || {}).forEach(([k, v]) => { if (keyMatches(k, kind)) adds.push({label: ef.name, expr: v}); }));
		if (sit) adds.push({label: "situational", expr: sit});
		let extraTotal = 0;
		const extraText = [];
		for (const a of adds) {
			const x = await rollFor(char, a.expr, {label: `${label}: ${a.label} ${a.expr}`});
			if (!x) return null;
			extraTotal += x.total;
			extraText.push(`${/^[+-]/.test(a.expr) ? "" : "+"}${a.expr}[${x.total}] ${a.label}`);
		}
		const total = r.nat + bonus + extraTotal - tm.penalty;
		// The outcome: natural 20 / 1 on attacks, the DC when known, else the player's answer
		let out = picked;
		if (outcome === "attack" && r.nat === 20) out = "crit";
		else if (outcome === "attack" && r.nat === 1) out = "miss";
		else if (!out && outcome && dc != null) out = total >= dc ? "success" : "fail";
		const pre = `${label}: ${total} (d20${tm.mode === "normal" ? "" : tm.mode === "adv" ? " adv" : " dis"} [${r.dice.join(", ")}] ${signed(bonus)}${extraText.length ? ` ${extraText.join(" ")}` : ""}${tm.penalty ? ` −${tm.penalty}` : ""})${r.nat === 20 ? " — natural 20!" : r.nat === 1 ? " — natural 1" : ""}`;
		if (!out && outcome && decide) {
			out = await provider({kind: "outcome", label, outcome, total, text: pre, nat: r.nat});
			if (!out) return null;
		}
		const text = `${pre}${out ? ` — ${OUTCOME_LABEL[out]}${dc != null ? ` (DC ${dc})` : ""}` : ""}`;
		log(char, text, {notes: tm.notes, kind: "d20", label, bonus, testKind: kind, sit, outcome: out});
		return {total, nat: r.nat, text, notes: tm.notes, outcome: out, ok: out ? ["hit", "crit", "success"].includes(out) : null, crit: out === "crit"};
	};
	// endregion

	// region Resources
	/** Class-table columns that are pools spent at the table (not counts like Cantrips or Prepared Spells). */
	const POOL_RE = /^(Rages|Wild Shape|Channel Divinity|Sorcery Points|Focus Points|Ki Points|Superiority Dice|Bardic Inspiration|Lay on Hands|Psionic Energy Dice|Psi Points|Infusions|Divine Sense|Arcane Shots|Second Wind|Indomitable|Action Surge)$/i;
	const RECHARGE = {
		"rages": "long-1short", "wild shape": "long-1short", "channel divinity": "long-1short",
		"sorcery points": "long", "focus points": "short", "ki points": "short", "superiority dice": "short",
		"bardic inspiration": "long", "psionic energy dice": "long-1short", "second wind": "long-1short",
	};
	/** Features that spend a pool instead of having uses of their own. */
	const POOL_OF_FEATURE = [
		[/^Rage$/i, "rages"], [/^(Wild Shape|Wild Companion)$/i, "wild shape"], [/^Channel Divinity/i, "channel divinity"],
		[/^(Font of Magic|Metamagic)/i, "sorcery points"], [/^(Monk's Focus|Flurry of Blows|Patient Defense|Step of the Wind)/i, "focus points"],
		[/^Combat Superiority|^Maneuvers?|^Battle Master$/i, "superiority dice"],
		[/^College of Lore$|^Cutting Words$/i, "bardic inspiration"],
	];
	const WORD_N = {once: 1, twice: 2, "three times": 3, "four times": 4, "five times": 5};

	/** Uses per rest read from a feature's text. */
	const usesFromText = (entries, d) => {
		const t = strip(JSON.stringify(entries || []));
		let n = null;
		let rest = /Short or Long Rest|Short Rest/i.test(t) && !/finish a Long Rest/i.test(t) ? "short" : "long";
		// Per rest only: "once per turn" limits are not a resource
		const m1 = /(once|twice|three times|four times|five times) (?:per (?:Short or Long Rest|Long Rest|Short Rest|day)|until you finish a)/i.exec(t);
		if (m1) n = WORD_N[lc(m1[1])];
		const m2 = /(?:number of times equal to|uses equal to) your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier/i.exec(t);
		if (m2) n = Math.max(1, d.mods[lc(m2[1]).slice(0, 3)]);
		if (/(?:number of times equal to|uses equal to) your Proficiency Bonus/i.test(t)) n = d.pb;
		if (n == null && /can't (?:use|do) (?:it|this|so) again until you finish a/i.test(t)) n = 1;
		if (n == null) return null;
		const m3 = /finish a (Short or Long Rest|Long Rest|Short Rest)/i.exec(t);
		if (m3) rest = /Short/i.test(m3[1]) ? "short" : "long";
		return {max: n, rest};
	};

	/** Every pool and limited-use feature: [{key, name, max, rest, group}] */
	const resources = (d) => {
		const out = [];
		d.classes.forEach(c => {
			(c.cols || []).forEach(col => {
				if (!POOL_RE.test(col.label)) return;
				const v = Number(String(col.values[c.level - 1]).replace(/[^\d]/g, ""));
				if (!v) return;
				out.push({key: `pool:${lc(col.label)}`, name: col.label, max: v, rest: RECHARGE[lc(col.label)] || "long", group: c.name, pool: true});
			});
			if (c.name === "Fighter" && /Battle Master/i.test(c.subclass || "") && c.level >= 3) out.push({key: "pool:superiority dice", name: `Superiority Dice (${c.level >= 18 ? "d12" : c.level >= 10 ? "d10" : "d8"})`, max: c.level >= 15 ? 6 : c.level >= 7 ? 5 : 4, rest: "short", group: c.subclass, pool: true});
			if (c.name === "Paladin") out.push({key: "pool:lay on hands", name: "Lay on Hands (HP)", max: 5 * c.level, rest: "long", group: c.name, pool: true, big: true});
		});
		const pools = new Set(out.map(o => o.key));
		R().featureList(d).forEach(f => {
			const poolOf = POOL_OF_FEATURE.find(([re]) => re.test(f.name));
			if (poolOf && pools.has(`pool:${poolOf[1]}`)) return;
			const u = usesFromText(f.entries, d);
			if (!u) return;
			const key = `feat:${lc(f.name)}`;
			if (out.some(o => o.key === key)) return;
			out.push({key, name: f.name, max: u.max, rest: u.rest, group: f.group, feature: f});
		});
		return out;
	};
	const poolForFeature = (d, f) => {
		const p = POOL_OF_FEATURE.find(([re]) => re.test(f.name));
		const res = resources(d);
		return (p && res.find(r => r.key === `pool:${p[1]}`)) || res.find(r => r.key === `feat:${lc(f.name)}`) || null;
	};
	const remaining = (char, r) => Math.max(0, r.max - (stateOf(char).uses[r.key] || 0));
	const spend = (char, r, n = 1) => {
		const P = stateOf(char);
		if (remaining(char, r) < n) return false;
		P.uses[r.key] = (P.uses[r.key] || 0) + n;
		return true;
	};
	// endregion

	// region Spells
	const slotsOf = (d) => d.slots.map((n, i) => ({level: i + 1, max: n})).filter(s => s.max);
	const pactOf = (d) => d.casting.find(c => c.pact)?.pact || null;
	const slotsLeft = (char, d, level) => {
		const s = slotsOf(d).find(x => x.level === level);
		return s ? Math.max(0, s.max - (stateOf(char).slotsUsed[level] || 0)) : 0;
	};
	const pactLeft = (char, d) => { const p = pactOf(d); return p ? Math.max(0, p.slots - (stateOf(char).pactUsed || 0)) : 0; };

	/** Slot options for a spell: [{label, level, kind}] (pact slots cast at their own level). */
	const castOptions = (char, d, spell) => {
		const opts = [];
		slotsOf(d).filter(s => s.level >= spell.level).forEach(s => opts.push({label: `Level ${s.level} slot (${slotsLeft(char, d, s.level)}/${s.max} left)`, level: s.level, kind: "slot", ok: slotsLeft(char, d, s.level) > 0}));
		const p = pactOf(d);
		if (p && p.level >= spell.level) opts.push({label: `Pact slot, level ${p.level} (${pactLeft(char, d)}/${p.slots} left)`, level: p.level, kind: "pact", ok: pactLeft(char, d) > 0});
		if (spell.meta?.ritual) opts.push({label: "As a ritual (no slot, +10 minutes)", level: spell.level, kind: "ritual", ok: true});
		opts.push({label: "Without a slot (feature, item or free cast)", level: spell.level, kind: "free", ok: true});
		return opts;
	};

	const firstTag = (entries, tags) => {
		const t = JSON.stringify(entries || []);
		const m = new RegExp(`\\{@(${tags.join("|")}) ([^}|]+)`).exec(t);
		return m ? m[2] : null;
	};
	/** Dice for a spell cast at a slot level (cantrips scale with character level). */
	const spellDice = (spell, slotLevel, totalLevel) => {
		if (spell.scalingLevelDice) {
			const sc = Array.isArray(spell.scalingLevelDice) ? spell.scalingLevelDice[0] : spell.scalingLevelDice;
			const lv = Object.keys(sc.scaling).map(Number).filter(l => l <= totalLevel).sort((a, b) => b - a)[0];
			if (lv == null || !sc.scaling[lv] || /\{\{/.test(sc.scaling[lv])) return null;
			return {dice: sc.scaling[lv], label: sc.label || "Damage"};
		}
		const base = firstTag(spell.entries, ["damage", "dice"]);
		if (!base) return null;
		let dice = base;
		const hl = JSON.stringify(spell.entriesHigherLevel || []);
		const m = /\{@scale(?:damage|dice) ([^|}]+)\|[^|}]+\|([^}]+)\}/.exec(hl);
		if (m && slotLevel > spell.level) {
			const add = slotLevel - spell.level;
			const bm = /^(\d+)d(\d+)(.*)$/.exec(m[1].trim());
			const sm = /^(\d+)d(\d+)$/.exec(m[2].trim());
			if (bm && sm && bm[2] === sm[2]) dice = `${Number(bm[1]) + add * Number(sm[1])}d${bm[2]}${bm[3]}`;
			else if (sm) dice = `${m[1]} + ${add * Number(sm[1])}d${sm[2]}`;
		}
		const heal = (spell.miscTags || []).includes("HL") || /regains? (?:a number of )?Hit Points/i.test(strip(JSON.stringify(spell.entries)));
		return {dice, label: heal ? "Healing" : (spell.damageInflict || []).map(R().titleCase).join("/") || "Damage", heal, addMod: heal && /plus your spellcasting ability modifier/i.test(strip(JSON.stringify(spell.entries)))};
	};
	const isConc = (spell) => (spell.duration || []).some(x => x.concentration);
	const economyOf = (spell) => {
		const t = (spell.time || [])[0] || {};
		return t.unit === "bonus" ? "bonus" : t.unit === "reaction" ? "reaction" : t.unit === "action" ? "action" : "long";
	};

	/** Concentration ends: spell forms and creatures summoned by that spell go with it. */
	const endConcentration = (char, why = "") => {
		const P = stateOf(char);
		if (!P.concentration) return;
		const name = P.concentration.name;
		P.concentration = null;
		if (P.form && P.form.via === name) endForm(char, why || "concentration ended");
		P.effects.filter(ef => ef.conc && ef.via === name).forEach(ef => endEffect(char, ef.id, "concentration ended"));
		const gone = P.summons.filter(s => s.conc && s.via === name);
		if (gone.length) { P.summons = P.summons.filter(s => !gone.includes(s)); log(char, `${gone.map(s => s.name).join(", ")} vanished (concentration on ${name} ended)`); }
	};
	// endregion

	// region Temporary forms
	/** Spells and features that turn the character into a creature, with the 2024 limits. */
	const FORM_SOURCES = [
		{name: "Wild Shape", feature: /^Wild Shape$/i, rules: (d) => {
			const dl = d.classes.find(c => c.name === "Druid")?.level || 0;
			const moon = d.classes.some(c => c.name === "Druid" && /Moon/i.test(c.subclass || ""));
			const maxCr = moon ? Math.max(1, Math.floor(dl / 3)) : dl >= 8 ? 1 : dl >= 4 ? 0.5 : 0.25;
			return {types: ["beast"], maxCr, noFly: dl < 8, tempHp: moon ? 3 * dl : dl, keepFormHp: false, note: `Druid ${dl}${moon ? " (Circle of the Moon)" : ""}: Beasts up to CR ${maxCr}${dl < 8 ? ", no Fly Speed" : ""}; you gain ${moon ? 3 * dl : dl} Temporary Hit Points and keep your own HP, INT, WIS and CHA.`};
		}},
		{name: "Polymorph", spell: /^Polymorph$/i, rules: (d) => ({types: ["beast"], maxCr: d.totalLevel, tempFromForm: true, noSwarm: true, note: `Beast with CR up to ${d.totalLevel}; you gain Temporary Hit Points equal to its HP and the spell ends when they run out.`})},
		{name: "True Polymorph", spell: /^True Polymorph$/i, rules: (d) => ({types: null, maxCr: d.totalLevel, tempFromForm: true, note: `Any creature with CR up to ${d.totalLevel}; you gain Temporary Hit Points equal to its HP.`})},
		{name: "Shapechange", spell: /^Shapechange$/i, rules: (d) => ({types: null, notTypes: ["construct", "undead"], maxCr: d.totalLevel, tempFromForm: true, keepMental: true, note: `A creature (not Construct or Undead) with CR up to ${d.totalLevel} that you have seen; you gain Temporary Hit Points equal to the first form's HP and keep INT, WIS, CHA and spellcasting.`})},
		{name: "Animal Shapes", spell: /^Animal Shapes$/i, rules: () => ({types: ["beast"], maxCr: 4, maxSize: "L", tempFromForm: true, note: "Large or smaller Beast of CR 4 or lower; Temporary Hit Points equal to its HP."})},
	];
	const formSourceFor = ({spell, feature}) => FORM_SOURCES.find(s => (spell && s.spell && s.spell.test(spell.name)) || (feature && s.feature && s.feature.test(feature.name))) || null;
	const SIZE_ORDER = ["T", "S", "M", "L", "H", "G"];

	/** Monsters that satisfy a form's limits. */
	const formCandidates = async (rules) => {
		const mons = await TBEnc.loadMonsters();
		return mons.filter(m => {
			if (m.reprinted || m.named) return false;
			if (rules.types && !m.types.some(t => rules.types.includes(t))) return false;
			if (rules.notTypes && m.types.some(t => rules.notTypes.includes(t))) return false;
			if (m.cr > rules.maxCr) return false;
			if (rules.noFly && m.ent.speed && m.ent.speed.fly) return false;
			if (rules.noSwarm && /^Swarm/i.test(m.name)) return false;
			if (rules.maxSize && !(m.sizes || []).some(s => SIZE_ORDER.indexOf(s) <= SIZE_ORDER.indexOf(rules.maxSize))) return false;
			return true;
		}).sort((a, b) => b.cr - a.cr || a.name.localeCompare(b.name));
	};

	const assumeForm = (char, m, src, rules) => {
		const P = stateOf(char);
		const formHp = m.ent.hp?.average || 1;
		const temp = rules.tempFromForm ? formHp : (rules.tempHp || 0);
		P.temp = Math.max(P.temp || 0, temp);
		P.form = {key: m.key, name: m.name, source: m.source, via: src.name, tempGiven: temp, endsAtZeroTemp: !!rules.tempFromForm, keepMental: !!rules.keepMental, since: Date.now()};
		log(char, `${src.name}: became a ${m.name} (CR ${m.crText}); +${temp} temporary HP`);
	};
	const endForm = (char, why = "") => {
		const P = stateOf(char);
		if (!P.form) return;
		const f = P.form;
		P.form = null;
		log(char, `${f.name} form ends${why ? ` (${why})` : ""}`);
		// The form's Temporary Hit Points go with it (a higher amount from another source stays)
		if (f.endsAtZeroTemp || (P.temp || 0) <= (f.tempGiven || 0)) P.temp = 0;
		if (P.concentration && f.via === P.concentration.name) endConcentration(char, "the form ended");
	};
	// endregion

	// region Summons
	/** Every monster in the bestiary, summoned ones included (the encounter index leaves those out). */
	const allMonsters = () => once("mons", async () => {
		const j = await DataUtil.monster.loadJSON();
		await DataUtil.monster.pPreloadLegendaryGroupsSite();
		const byKey = new Map();
		(j.monster || []).forEach(m => byKey.set(`${lc(m.name)}|${lc(m.source)}`, m));
		return {list: j.monster || [], byKey};
	});
	const creatureTags = (entries) => {
		const out = [];
		const re = /\{@creature ([^|}]+)\|?([^|}]*)/g;
		const t = JSON.stringify(entries || []);
		let m;
		while ((m = re.exec(t))) out.push(`${lc(m[1])}|${lc(m[2] || "mm")}`);
		return [...new Set(out)];
	};
	/**
	 * Forms a summon comes in: "(Air only)", "(Land and Water only)", "Radiant Bow (Avenger Only)" → Air, Land, Water…;
	 * or sizes priced in its HP: "10 (Medium or smaller), 20 (Large), 40 (Huge)".
	 */
	const variantsOf = (mon) => {
		const t = JSON.stringify([mon.hp, mon.ac, mon.speed, mon.trait, mon.action, mon.bonus, mon.reaction]);
		const out = [];
		const re = /\(([^()]*?) only\)/gi;
		let m;
		// "(hover; Beholderkin only)" → Beholderkin; "(Air, and Water only)" → Air, Water
		while ((m = re.exec(t))) m[1].split(";").pop().split(/,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+/).map(s => s.trim()).filter(Boolean).forEach(v => { if (!out.includes(v)) out.push(v); });
		if (!out.length && mon.hp?.special) [...String(mon.hp.special).matchAll(/\d+\s*\(([^()]+)\)/g)].forEach(x => { if (!out.includes(x[1].trim())) out.push(x[1].trim()); });
		return out.length > 1 ? out : out.length === 1 ? ["Other", out[0]] : [];
	};

	/**
	 * Creatures a spell or feature can bring: the ones it names, the bestiary's own summons of that spell,
	 * any CR 0 Beast for Find Familiar, and, for features that cast a spell (Wild Companion), that spell's.
	 */
	const summonOptions = async ({spell, feature}) => {
		const {list, byKey} = await allMonsters();
		const ent = spell || feature;
		if (!ent) return null;
		if (spell && formSourceFor({spell})) return null;
		const keys = creatureTags(ent.entries);
		let via = ent.name;
		// The bestiary's own summons of this very spell (same name and book)
		if (spell) list.filter(m => m.summonedBySpell && lc(m.summonedBySpell) === lc(`${spell.name}|${spell.source}`)).forEach(m => keys.push(`${lc(m.name)}|${lc(m.source)}`));
		let viaSpell = spell || null;
		if (feature && !keys.length) {
			const m = /\{@spell ([^|}]+)\|?([^|}]*)\}/.exec(JSON.stringify(feature.entries || []));
			if (m && /cast (?:the )?\{@spell/i.test(JSON.stringify(feature.entries || []))) {
				const sp = (await D().loadSpells()).find(s => lc(s.name) === lc(m[1]) && lc(s.source) === lc(m[2] || "phb"));
				if (sp) { const o = await summonOptions({spell: sp}); if (o) return {...o, via: feature.name, castSpell: sp}; }
			}
		}
		const text = strip(JSON.stringify(ent.entries || []));
		let mons = [...new Set(keys)].map(k => byKey.get(k)).filter(Boolean);
		if (/Beast that has a Challenge Rating of 0/i.test(text)) {
			list.filter(m => !m.summonedBySpell && !m.isNamedCreature && String(m.cr?.cr ?? m.cr) === "0" && (Parser.monTypeToFullObj(m.type).types || []).includes("beast") && !/^Swarm/i.test(m.name) && D().isModern(m.source))
				.forEach(m => { if (!mons.includes(m)) mons.push(m); });
		}
		// Skip passing mentions: a summoning text says it summons, calls forth, conjures, animates or uses a stat block
		if (!mons.length || !/(summon|call forth|conjure|familiar|steed|stat block|becomes an Undead|animate)/i.test(text)) return null;
		return {mons, via, viaSpell, byClass: !spell};
	};

	/** Evaluate an AC/HP formula such as "20 (Air only) or 30 (Land and Water only) + 5 for each spell level above 2". */
	const evalFormula = (txt, ctx, variant) => {
		let s = String(txt);
		// Numbers that depend on the form: "20 (Air only) or 30 (Land only)", "10 (Medium or smaller), 20 (Large)", "+ 2 (Defender only)"
		const pairs = [...s.matchAll(/(\d+)\s*\(([^()]*?)\)/g)].filter(p => / only$/i.test(p[2]) || (variant && p[2].includes(variant)) || /^(Tiny|Small|Medium|Large|Huge|Gargantuan)/i.test(p[2]));
		if (pairs.length) {
			const pick = pairs.find(p => variant && p[2].includes(variant));
			const value = pick ? pick[1] : pairs.length === 1 ? "0" : pairs[0][1];
			s = s.slice(0, pairs[0].index) + value + s.slice(pairs[pairs.length - 1].index + pairs[pairs.length - 1][0].length);
		}
		const words = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twice: 2};
		// Remarks in parentheses ("(the beast has … Hit Dice)") are not part of the number
		s = s.replace(/\([^)]*\)/g, " ").replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "-");
		s = s.replace(/(\d+) for each spell level above (\d+)/gi, (m, k, n) => String(Number(k) * Math.max(0, ctx.level - Number(n))))
			.replace(/(\d+) (?:per|for each) spell level/gi, (m, k) => String(Number(k) * ctx.level))
			.replace(/(\w+) times your (?:\w+ )?level/gi, (m, w) => String((words[lc(w)] || Number(w) || 1) * ctx.classLevel))
			.replace(/the spell's level|the level of the spell|spell's level/gi, String(ctx.level))
			.replace(/your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier/gi, (m, a) => String(ctx.mods[lc(a).slice(0, 3)] ?? 0))
			.replace(/your spellcasting ability modifier/gi, String(ctx.spellMod))
			.replace(/your Proficiency Bonus/gi, String(ctx.pb))
			.replace(/your (?:\w+ )?level/gi, String(ctx.classLevel));
		const expr = (s.match(/[\d+\-×* ]+/g) || []).join(" ").replace(/×/g, "*");
		let total = 0;
		expr.replace(/\s+/g, "").split(/(?=[+-])/).forEach(term => {
			if (!term) return;
			const sign = term.startsWith("-") ? -1 : 1;
			const prod = term.replace(/^[+-]/, "").split("*").filter(Boolean).reduce((a, b) => a * (Number(b) || 0), 1);
			total += sign * prod;
		});
		return Math.max(1, total);
	};

	/** The creature's stat block at the level it was summoned with, using the caster's numbers. */
	const scaleSummon = (mon, ctx, variant) => {
		const m = JSON.parse(JSON.stringify(mon));
		const fix = (v) => {
			if (typeof v === "string") {
				return v.replace(/\{@damage ([^}]+)\} plus your (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier/gi, (m, dice, a) => `{@damage ${dice} ${signed(ctx.mods[lc(a).slice(0, 3)] ?? 0)}}`)
					.replace(/summonSpellLevel/g, String(ctx.level))
					.replace(/summonClassLevel/g, String(ctx.classLevel))
					.replace(/\{@hitYourSpellAttack[^}]*\}/g, `{@hit ${ctx.spellAttack}}`)
					.replace(/your spell save DC/gi, `your spell save DC (${ctx.spellDc})`)
					.replace(/your spell attack modifier/gi, `your spell attack modifier (${signed(ctx.spellAttack)})`);
			}
			if (Array.isArray(v)) return v.map(fix);
			if (v && typeof v === "object") { Object.keys(v).forEach(k => { v[k] = fix(v[k]); }); return v; }
			return v;
		};
		["trait", "action", "bonus", "reaction", "legendary", "entries"].forEach(k => { if (m[k]) m[k] = fix(m[k]); });
		const acSpecial = (m.ac || []).find(a => a && a.special)?.special;
		const ac = acSpecial ? evalFormula(acSpecial, ctx, variant) : Number((m.ac || [])[0]?.ac ?? (m.ac || [])[0]) || 10;
		const hp = m.hp?.special ? evalFormula(m.hp.special, ctx, variant) : (m.hp?.average || 1);
		m.ac = [ac];
		m.hp = {average: hp, formula: `${hp}d1`};
		if (variant) m.name = `${m.name} (${variant})`;
		delete m.summonedBySpellLevel;
		return {mon: m, ac, hp};
	};

	const summonContext = (d, level, classLevel) => {
		const cast = TBRules.castFor(d);
		return {
			level, classLevel: classLevel || d.totalLevel, pb: d.pb, mods: d.mods,
			spellAttack: cast ? cast.attack : d.pb + Math.max(...Object.values(d.mods)),
			spellDc: cast ? cast.dc : 8 + d.pb + Math.max(...Object.values(d.mods)),
			spellMod: cast ? cast.mod : 0,
		};
	};

	const addSummon = (char, d, mon, {via, level, classLevel, variant, conc, endsOnLongRest}) => {
		const P = stateOf(char);
		const ctx = summonContext(d, level, classLevel);
		const s = scaleSummon(mon, ctx, variant);
		const id = Math.random().toString(36).slice(2, 9);
		P.summons.push({id, key: `${lc(mon.name)}|${lc(mon.source)}`, name: s.mon.name, via, level, classLevel: ctx.classLevel, variant: variant || null, ac: s.ac, hpMax: s.hp, hp: s.hp, conc: !!conc, endsOnLongRest: !!endsOnLongRest, ctx});
		log(char, `${via}: ${s.mon.name} appears (AC ${s.ac}, ${s.hp} HP)`);
		return id;
	};
	const summonBlock = async (s) => {
		const {byKey} = await allMonsters();
		const mon = byKey.get(s.key);
		return mon ? scaleSummon(mon, s.ctx, s.variant).mon : null;
	};
	// endregion

	// region Hit points
	const damage = (char, d, n) => {
		const P = stateOf(char);
		let left = Math.max(0, Math.round(n));
		const fromTemp = Math.min(P.temp || 0, left);
		P.temp -= fromTemp;
		left -= fromTemp;
		const before = currentHp(char, d);
		P.hp = Math.max(0, before - left);
		const notes = [];
		if (P.form && P.form.endsAtZeroTemp && P.temp <= 0) { endForm(char, "no Temporary Hit Points left"); notes.push("form ended"); }
		if (P.concentration && n > 0) notes.push(`Concentration save: DC ${Math.min(30, Math.max(10, Math.floor(n / 2)))} (Constitution ${signed(d.saves.con.bonus)})`);
		if (P.hp === 0 && before > 0) notes.push("Down! Death saving throws start");
		// Damage left over after dropping to 0 that equals the HP maximum kills outright
		if (P.hp === 0 && left - before >= d.hp) notes.push("Massive damage: instant death");
		log(char, `Took ${n} damage${fromTemp ? ` (${fromTemp} from temporary HP)` : ""} → ${P.hp}/${d.hp} HP`, {notes});
		return notes;
	};
	const heal = (char, d, n) => {
		const P = stateOf(char);
		const before = currentHp(char, d);
		P.hp = Math.min(d.hp, before + Math.max(0, Math.round(n)));
		if (P.hp > 0) P.death = {s: 0, f: 0};
		log(char, `Healed ${n} → ${P.hp}/${d.hp} HP`);
	};
	const addTemp = (char, n) => {
		const P = stateOf(char);
		// Temporary Hit Points don't stack: keep the higher
		P.temp = Math.max(P.temp || 0, Math.max(0, Math.round(n)));
		log(char, `Temporary HP: ${P.temp}`);
	};
	const hitDice = (d) => {
		const out = {};
		d.classes.forEach(c => { out[c.hd] = (out[c.hd] || 0) + c.level; });
		return Object.entries(out).map(([die, n]) => ({die, n}));
	};
	const spendHitDie = async (char, d, die) => {
		const P = stateOf(char);
		const hd = hitDice(d).find(x => x.die === die);
		if (!hd || (P.hdSpent[die] || 0) >= hd.n) return null;
		const r = await rollFor(char, `1${die}${signed(d.mods.con)}`, {label: `Hit Point Die (${die})`});
		if (!r) return null;
		P.hdSpent[die] = (P.hdSpent[die] || 0) + 1;
		const amount = Math.max(0, r.total);
		heal(char, d, amount);
		log(char, `Hit Die ${die}: ${r.text} = ${amount}`);
		return amount;
	};
	// endregion

	// region Rests
	const shortRest = (char, d) => {
		const P = stateOf(char);
		resources(d).forEach(r => {
			if (r.rest === "short") P.uses[r.key] = 0;
			else if (r.rest === "long-1short") P.uses[r.key] = Math.max(0, (P.uses[r.key] || 0) - 1);
		});
		P.pactUsed = 0;
		P.turn = {...blank().turn};
		// A Short Rest is an hour: shorter effects are over
		[...P.effects].forEach(ef => { if (ef.rounds != null && ef.rounds <= 600) endEffect(char, ef.id, "short rest"); else if (ef.rounds != null) ef.rounds -= 600; if (ef.until) endEffect(char, ef.id, "short rest"); });
		log(char, "Short Rest: short-rest features and Pact Magic slots restored");
	};
	const longRest = (char, d) => {
		const P = stateOf(char);
		Object.assign(P, {hp: d.hp, temp: 0, hdSpent: {}, slotsUsed: {}, pactUsed: 0, uses: {}, itemCharges: {}, death: {s: 0, f: 0}});
		endConcentration(char, "long rest");
		if (P.form) endForm(char, "long rest");
		P.summons = P.summons.filter(s => !s.endsOnLongRest);
		P.effects = [];
		P.exhaustion = Math.max(0, (P.exhaustion || 0) - 1);
		P.turn = {...blank().turn};
		log(char, "Long Rest: all HP, Hit Point Dice, spell slots and features restored; Exhaustion −1");
	};
	// endregion

	// region Items
	const isConsumableEnt = (e) => /^(P|SC|A|EXP)\|?/.test(String(e?.type || "")) || /^(Potion|Oil|Elixir|Philter|Dust|Bead|Spell Scroll)/i.test(e?.name || "");
	const itemHealing = (e) => {
		const t = strip(JSON.stringify(e?.entries || []));
		if (!/regains?/i.test(t)) return null;
		return firstTag(e.entries, ["dice"]);
	};
	const itemCharges = (e) => {
		const n = Number(e?.charges);
		return n > 0 ? n : 0;
	};
	// endregion

	// region Session gear: Play and Store work on a copy of the equipment and coins; End Session can write it back
	const gearOf = (c) => stateOf(c).gear || c.equipment;
	/** The character as the session sees it (its equipment is the session copy). */
	const sessionChar = (c) => { const g = stateOf(c).gear; return g ? {...c, equipment: g} : c; };
	const beginGear = (c) => { stateOf(c).gear = JSON.parse(JSON.stringify(c.equipment || {items: [], cp: 0})); };
	const dropGear = (c) => { delete stateOf(c).gear; };
	const applyGear = (c) => {
		const g = stateOf(c).gear;
		if (!g) return;
		c.equipment = {...c.equipment, items: JSON.parse(JSON.stringify(g.items || [])), cp: Number(g.cp) || 0};
		delete stateOf(c).gear;
	};
	/** What the session changed: items gained or lost, equipped or unequipped, and coins. */
	const gearChanges = (c) => {
		const g = stateOf(c).gear;
		if (!g) return {lines: [], changed: false};
		const key = (i) => `${lc(i.name)}|${lc(i.source)}|${i.notes || ""}`;
		const sum = (items) => {
			const m = new Map();
			(items || []).forEach(i => { const k = key(i); const o = m.get(k) || {name: i.name, notes: i.notes || "", qty: 0, eq: false}; o.qty += Number(i.qty) || 1; o.eq = o.eq || !!i.equipped; m.set(k, o); });
			return m;
		};
		const a = sum(c.equipment?.items);
		const b = sum(g.items);
		const lines = [];
		new Set([...a.keys(), ...b.keys()]).forEach(k => {
			const x = a.get(k);
			const y = b.get(k);
			const n = (y || x).name + ((y || x).notes ? ` (${(y || x).notes})` : "");
			const dq = (y?.qty || 0) - (x?.qty || 0);
			if (dq) lines.push(`${dq > 0 ? "+" : "−"}${Math.abs(dq)} ${n}`);
			if (x && y && x.eq !== y.eq) lines.push(`${n}: ${y.eq ? "equipped" : "unequipped"}`);
			else if (!x && y?.eq) lines.push(`${n}: equipped`);
		});
		const c0 = Number(c.equipment?.cp) || 0;
		const c1 = Number(g.cp) || 0;
		if (c0 !== c1) lines.push(`Coins: ${globalThis.TBShop ? `${TBShop.money(c0)} → ${TBShop.money(c1)}` : `${c0 / 100} → ${c1 / 100} gp`}`);
		return {lines, changed: lines.length > 0};
	};
	// endregion

	return {
		gearOf, sessionChar, beginGear, dropGear, applyGear, gearChanges,
		stateOf, effective, formActionsOf, damageExtras, addEffect, endEffect, nextTurn, keyMatches, currentHp, log, roll, rollFor, d20For, setDiceProvider, physical, diceMode, shown, askOutcome, test, testMode, CONDITIONS, COND_FX, OUTCOME_LABEL,
		resources, poolForFeature, remaining, spend, usesFromText,
		slotsOf, pactOf, slotsLeft, pactLeft, castOptions, spellDice, isConc, economyOf, endConcentration,
		FORM_SOURCES, formSourceFor, formCandidates, assumeForm, endForm,
		allMonsters, summonOptions, variantsOf, scaleSummon, addSummon, summonBlock, summonContext, evalFormula,
		damage, heal, addTemp, hitDice, spendHitDie, shortRest, longRest,
		isConsumableEnt, itemHealing, itemCharges, signed,
	};
})();
