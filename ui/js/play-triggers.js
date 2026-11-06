"use strict";

/**
 * What happens on a hit, a miss, a success or a failure (2024 rules), for the Play tab.
 *
 * After an attack the player says (or the dice say) whether it hit. A hit adds the automatic riders to the damage
 * (Radiant Strikes, Great Weapon Master, weapon mastery) and offers what can be used now: smite spells cast
 * "immediately after hitting" (the slot is spent only then), Sneak Attack, and every feature whose text triggers
 * on a hit (Stunning Strike, Divine Fury, Hunter's Prey…). A miss offers what can still turn it into a hit (Guided
 * Strike, Peerless Aim, Stroke of Luck, Heroic Inspiration…) and applies Graze and Studied Attacks. A failed check
 * or save offers Tactical Mind, Indomitable, Peerless Skill, Stroke of Luck and Heroic Inspiration; pools that the
 * rules don't spend on a failure (Tactical Mind, Peerless Skill, Homing Strikes) are spent only on a success.
 */
globalThis.TBTriggers = (() => {
	const P_ = () => TBPlay;
	const R = () => TBRules;
	const lc = (s) => String(s ?? "").toLowerCase();
	const strip = (e) => TBData.strip(JSON.stringify(e || []));
	const HIT_RE = /\b(when|if|after|once per turn when|once on each of your turns when) you hit\b|\bon a hit\b|immediately after hitting|if the attack hits|you hit with/i;
	const ONCE_RE = /once (?:per|on each of your) turns?/i;
	const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);

	// region Helpers
	/**
	 * Every feature as a unit, including the sections nested inside another feature (a subclass's level 3
	 * features often sit inside its introduction: Guided Strike in War Domain, Psychic Blades in Soulknife…).
	 * A subclass introduction itself only counts for its own text.
	 */
	const feats = (d) => {
		const out = [];
		R().featureList(d).forEach(f => {
			const intro = f.kind === "Subclass" && f.name === f.group;
			const subs = (f.entries || []).filter(e => e && typeof e === "object" && e.name && Array.isArray(e.entries));
			if (!intro || subs.length < (f.entries || []).length) out.push({...f, entries: subs.length ? (f.entries || []).filter(e => !subs.includes(e)) : f.entries});
			subs.forEach(e => out.push({...f, name: e.name, entries: e.entries, nested: f.name, ...R().activationOf(e.entries)}));
		});
		return out.filter(f => !(f.kind === "Subclass" && f.name === f.group && !f.nested));
	};
	const hasFeat = (d, re) => feats(d).find(f => re.test(f.name));
	const lvl = (d, cls) => d.classes.find(c => c.name === cls)?.level || 0;
	const pool = (c, d, name) => {
		const r = P_().resources(d).find(x => lc(x.name).startsWith(lc(name)) || x.key === `pool:${lc(name)}`);
		return r && P_().remaining(c, r) > 0 ? r : null;
	};
	const usesOf = (c, d, f) => {
		const r = P_().poolForFeature(d, f);
		return r && P_().remaining(c, r) > 0 ? r : null;
	};
	const onceDone = (c, k) => !!P_().stateOf(c).turn.once?.[k];
	const markOnce = (c, k) => { const t = P_().stateOf(c).turn; (t.once ||= {})[k] = true; };
	const firstDice = (f) => { const m = /\{@(?:damage|dice) ([^}|]+)/.exec(JSON.stringify(f.entries || [])); return m ? m[1].trim() : null; };
	const bardDie = (d) => { const c = d.classes.find(x => x.name === "Bard"); const col = c && (c.cols || []).find(x => /^Bardic Die$/i.test(x.label)); return col ? col.values[c.level - 1] : "1d6"; };
	const psiDie = (d) => { const l = Math.max(lvl(d, "Fighter"), lvl(d, "Rogue")); return l >= 17 ? "1d12" : l >= 11 ? "1d10" : l >= 5 ? "1d8" : "1d6"; };
	const supDie = (d) => { const l = lvl(d, "Fighter"); return l >= 18 ? "1d12" : l >= 10 ? "1d10" : "1d8"; };
	/** Roll a die that decides something (asked for in every physical mode), then ask whether it now succeeds. */
	const boostAndAsk = async (c, res, expr, label, outcome) => {
		const r = await P_().rollFor(c, expr, {label});
		if (!r) return null;
		const total = res.total != null ? res.total + r.total : null;
		const out = await P_().askOutcome(c, {label: `${label}: ${total != null ? `now ${total}` : `+${r.total}`}`, outcome, total, text: `${res.text || ""} ${sg(r.total)} (${label})`});
		P_().log(c, `${label}: +${r.total}${total != null ? ` → ${total}` : ""}${out ? ` — ${P_().OUTCOME_LABEL[out]}` : ""}`);
		return out;
	};
	// endregion

	// region Automatic riders on a hit / miss
	/** Extra damage that applies by itself on a hit: [{dice, type, why}] and a flat bonus. */
	const hitRiders = (c, d, a) => {
		const dice = [];
		let flat = 0;
		const why = [];
		if (a.melee && hasFeat(d, /^Radiant Strikes$/i)) { dice.push("1d8"); why.push("Radiant Strikes +1d8 Radiant"); }
		if (/Heavy/.test(a.props || "") && hasFeat(d, /^Great Weapon Master$/i)) { flat += d.pb; why.push(`Great Weapon Master ${sg(d.pb)}`); }
		return {dice, flat, why};
	};
	const MASTERY_HIT = {
		sap: () => "Sap: the target has Disadvantage on its next attack roll before the start of your next turn.",
		slow: () => "Slow: the target's Speed drops by 10 ft. until the start of your next turn.",
		push: () => "Push: you can push the target up to 10 ft. away (Large or smaller).",
		topple: (d, a) => `Topple: the target makes a Constitution save (DC ${8 + (d.mods[a.abil] || 0) + d.pb}) or falls Prone.`,
		cleave: () => "Cleave: you can make one more attack against a second creature within 5 ft. of the first (once per turn, no ability modifier to its damage unless negative).",
		nick: () => "Nick: the extra Light-weapon attack is part of the Attack action.",
	};
	const masteryOf = (a) => lc(String(a.mastery || "").split(",")[0].trim());
	/** Things that happen by themselves after a hit (logged, effects added). */
	const applyHit = (c, d, a) => {
		const m = masteryOf(a);
		if (m === "vex") P_().addEffect(c, {name: "Vex", mods: {adv: ["attack"], consumeOnAttack: true}, rounds: 2, notes: "Advantage on your next attack roll against that creature."});
		else if (MASTERY_HIT[m]) P_().log(c, MASTERY_HIT[m](d, a));
		if (a.crit && /Heavy/.test(a.props || "") && a.melee && hasFeat(d, /^Great Weapon Master$/i)) P_().log(c, "Hew: you can make one attack with the same weapon as a Bonus Action.");
	};
	/** Things that happen by themselves after a miss. */
	const applyMiss = (c, d, a) => {
		if (masteryOf(a) === "graze") { const n = Math.max(0, d.mods[a.abil] || 0); P_().log(c, `Graze: the target still takes ${n} damage (your ability modifier).`); }
		if (hasFeat(d, /^Studied Attacks$/i)) P_().addEffect(c, {name: "Studied Attacks", mods: {adv: ["attack"], consumeOnAttack: true}, rounds: 2, notes: "Advantage on your next attack roll against the creature you missed."});
	};
	// endregion

	// region Options after a hit
	/** What can be used now that the attack hit: [{id, label, run(ui)}]. */
	const afterHit = (c, d, a, {spellAttack = false} = {}) => {
		const out = [];
		if (!spellAttack) {
			// Spells cast "immediately after hitting" (smites, Ensnaring Strike, Hail of Thorns…): the slot is spent only now
			d.spells.forEach(s => {
				const t = (s.ent.time || []).find(x => /after hitting/i.test(x.condition || ""));
				if (!t) return;
				const cond = t.condition;
				const fits = /Melee weapon|Unarmed Strike/i.test(cond) ? a.melee : /Ranged weapon|ranged attack/i.test(cond) ? !a.melee : true;
				if (!fits) return;
				if (!P_().castOptions(c, d, s.ent).some(o => o.ok)) return;
				out.push({id: `spell:${s.ent.name}`, label: `Cast ${s.ent.name}`, desc: "spends the slot only now that you hit", run: (ui) => ui.castSpell(c, d, s)});
			});
			// Sneak Attack: once per turn, Finesse or ranged weapon
			const rl = lvl(d, "Rogue");
			if (rl && (/Finesse/.test(a.props || "") || !a.melee) && !onceDone(c, "sneak")) {
				const dice = `${Math.ceil(rl / 2)}d6`;
				out.push({id: "sneak", label: `Sneak Attack (${dice})`, desc: "once per turn, with Advantage or an ally next to the target", run: async () => {
					const r = await P_().rollFor(c, dice, {label: "Sneak Attack", crit: !!a.crit, for: "enemy"});
					if (!r) return;
					markOnce(c, "sneak");
					P_().log(c, `Sneak Attack: ${P_().shown(r)} extra damage`);
				}});
			}
		}
		// Features and feats that trigger on a hit
		feats(d).forEach(f => {
			if (/^(Sneak Attack|Radiant Strikes|Great Weapon Master|Thrown Weapon Fighting|Unarmed Fighting|Sacred Weapon|Combat Inspiration|Lunar Form|Improved Circle Forms|Archer|Elemental Attunement)$/i.test(f.name)) return;
			if (f.kind === "Subclass" && f.name === f.group) return; // the subclass's introduction
			const t = strip(f.entries);
			if (!HIT_RE.test(t)) return;
			const once = ONCE_RE.test(t);
			if (/^Savage Attacker$/i.test(f.name)) {
				if (!a.dice || onceDone(c, f.name)) return;
				out.push({id: "savage", label: `Savage Attacker: roll ${a.dice} again`, desc: "once per turn, use either roll", run: async () => {
					const r = await P_().rollFor(c, a.dice, {label: "Savage Attacker: the weapon's damage dice again", crit: !!a.crit, for: "enemy"});
					if (!r) return;
					markOnce(c, f.name);
					P_().log(c, `Savage Attacker: second roll of the weapon dice ${P_().shown(r)} — use the higher`);
				}});
				return;
			}
			if (once && onceDone(c, f.name)) return;
			const hd = TBEffects.handlerFor({feature: f});
			const res = P_().poolForFeature(d, f);
			if (res && !P_().remaining(c, res)) return;
			if (/\bRage\b/.test(t) && /while (?:your )?Rage is active|while raging/i.test(t) && !P_().stateOf(c).effects.some(e => e.name === "Rage")) return;
			const dice = !hd ? firstDice(f) : null;
			out.push({id: `feat:${f.name}`, label: `${f.name}${dice ? ` (${dice})` : ""}`, desc: [once ? "once per turn" : "", res ? `${P_().remaining(c, res)}/${res.max} ${res.name}` : ""].filter(Boolean).join(", "), run: async (ui) => {
				if (hd || res) { const ok = await ui.useFeature(c, d, f); if (ok && once) markOnce(c, f.name); return; }
				if (dice) {
					const r = await P_().rollFor(c, dice, {label: f.name, crit: !!a.crit, for: "enemy"});
					if (!r) return;
					P_().log(c, `${f.name}: ${P_().shown(r)}`, {notes: [TBData.summarize(f.entries, 160)]});
				} else P_().log(c, `${f.name}`, {notes: [TBData.summarize(f.entries, 200)]});
				if (once) markOnce(c, f.name);
			}});
		});
		return out;
	};
	// endregion

	// region Options after a miss: ways to still hit
	const afterMiss = (c, d, a, res, {spellAttack = false} = {}) => {
		const out = [];
		const P = P_().stateOf(c);
		const flip = (o) => out.push(o);
		const gs = hasFeat(d, /^Guided Strike$/i);
		const cd = gs && pool(c, d, "channel divinity");
		if (cd) flip({id: "guided", label: "Guided Strike (+10)", desc: "spend a Channel Divinity", run: async () => {
			P_().spend(c, cd, 1);
			const o = await P_().askOutcome(c, {label: "Guided Strike: +10 to the attack", outcome: "attack", total: res.total != null ? res.total + 10 : null});
			P_().log(c, `Guided Strike: +10${res.total != null ? ` → ${res.total + 10}` : ""} — ${o ? P_().OUTCOME_LABEL[o] : "?"}`);
			return o;
		}});
		const boon = hasFeat(d, /^Boon of Combat Prowess$/i);
		if (boon && !onceDone(c, "peerless aim")) flip({id: "aim", label: "Peerless Aim: hit instead", desc: "Boon of Combat Prowess, once per turn", run: async () => { markOnce(c, "peerless aim"); P_().log(c, "Peerless Aim: the miss becomes a hit"); return "hit"; }});
		const homing = hasFeat(d, /^Homing Strikes$/i);
		const psi = homing && /psychic blade/i.test(a.name) && pool(c, d, "psionic energy");
		if (psi) flip({id: "homing", label: `Homing Strikes (+${psiDie(d)})`, desc: "the die is spent only if it hits", run: async () => {
			const o = await boostAndAsk(c, res, psiDie(d), "Homing Strikes", "attack");
			if (o === "hit" || o === "crit") P_().spend(c, psi, 1);
			return o;
		}});
		const precision = d.optfeatures.find(o => /^Precision Attack$/i.test(o.ent.name));
		const sup = precision && pool(c, d, "superiority dice");
		if (sup) flip({id: "precision", label: `Precision Attack (+${supDie(d)})`, desc: "spend a Superiority Die", run: async () => { P_().spend(c, sup, 1); return boostAndAsk(c, res, supDie(d), "Precision Attack", "attack"); }});
		commonFail(c, d, res, `attack:${a.abil || "str"}`, "attack").forEach(flip);
		if (!spellAttack) d.spells.forEach(s => {
			if (!(s.ent.time || []).some(x => /hitting or missing/i.test(x.condition || ""))) return;
			if (!P_().castOptions(c, d, s.ent).some(o => o.ok)) return;
			flip({id: `spell:${s.ent.name}`, label: `Cast ${s.ent.name}`, desc: "works on a hit or a miss", run: (ui) => ui.castSpell(c, d, s)});
		});
		return out;
	};
	// endregion

	// region Options after a failed check or save
	/** Shared by misses and failures: Peerless Skill, Stroke of Luck, Heroic Inspiration. */
	const commonFail = (c, d, res, kind, outcome) => {
		const out = [];
		const P = P_().stateOf(c);
		const isCheck = /^check/.test(kind) || kind === "init";
		const peer = hasFeat(d, /^Peerless Skill$/i);
		const bi = peer && (isCheck || /^attack/.test(kind)) && pool(c, d, "bardic inspiration");
		if (bi) out.push({id: "peerless", label: `Peerless Skill (+${bardDie(d)})`, desc: "Bardic Inspiration, spent only on a success", run: async () => {
			const o = await boostAndAsk(c, res, bardDie(d), "Peerless Skill", outcome);
			if (["hit", "crit", "success"].includes(o)) P_().spend(c, bi, 1); else P_().log(c, "Peerless Skill: still a failure, Bardic Inspiration isn't expended");
			return o;
		}});
		const luck = hasFeat(d, /^Stroke of Luck$/i);
		const lr = luck && usesOf(c, d, luck);
		if (lr) out.push({id: "luck", label: "Stroke of Luck: the roll becomes a 20", desc: `${P_().remaining(c, lr)}/${lr.max} left`, run: async () => { P_().spend(c, lr, 1); P_().log(c, "Stroke of Luck: the d20 counts as 20"); return outcome === "attack" ? "crit" : "success"; }});
		if (P.inspiration && res.label !== undefined) out.push({id: "insp", label: "Heroic Inspiration: reroll", desc: "", run: async () => {
			P.inspiration = false;
			const r2 = await P_().test(c, `${res.label} (rerolled with Heroic Inspiration)`, res.bonus, kind, {outcome, decide: true});
			return r2 ? r2.outcome : null;
		}});
		return out;
	};
	const afterFail = (c, d, res, kind) => {
		const out = [];
		const isCheck = /^check/.test(kind);
		const tm = isCheck && hasFeat(d, /^Tactical Mind$/i);
		const sw = tm && pool(c, d, "second wind");
		if (sw) out.push({id: "tactical", label: "Tactical Mind (+1d10)", desc: "Second Wind, spent only if it now succeeds", run: async () => {
			const o = await boostAndAsk(c, res, "1d10", "Tactical Mind", "check");
			if (o === "success") P_().spend(c, sw, 1); else P_().log(c, "Tactical Mind: still a failure, Second Wind isn't expended");
			return o;
		}});
		const ind = /^save/.test(kind) && hasFeat(d, /^Indomitable$/i);
		const ir = ind && usesOf(c, d, ind);
		if (ir) out.push({id: "indomitable", label: `Indomitable: reroll ${sg(lvl(d, "Fighter"))}`, desc: `${P_().remaining(c, ir)}/${ir.max} left`, run: async () => {
			P_().spend(c, ir, 1);
			const r2 = await P_().test(c, `${res.label} (Indomitable reroll)`, res.bonus + lvl(d, "Fighter"), kind, {outcome: "check", decide: true});
			return r2 ? r2.outcome : null;
		}});
		return [...out, ...commonFail(c, d, res, kind, "check")];
	};
	// endregion

	// region Spells: slots the rules give back
	/** After casting: Spell Breaker (no slot spent if the spell fails to stop a spell) and Boon of Spell Recall. */
	const afterCast = async (c, d, sp, opt, ui) => {
		if (opt.kind !== "slot") return;
		const P = P_().stateOf(c);
		const refund = (why) => { P.slotsUsed[opt.level] = Math.max(0, (P.slotsUsed[opt.level] || 0) - 1); P_().log(c, `${why}: the level ${opt.level} slot isn't expended`); };
		if (/^(Counterspell|Dispel Magic)$/i.test(sp.name) && hasFeat(d, /^Spell Breaker$/i)) {
			const o = await P_().askOutcome(c, {label: `${sp.name}: did it stop the spell?`, outcome: "check"});
			if (o === "fail") refund("Spell Breaker");
		}
		if (opt.level <= 4 && hasFeat(d, /^Boon of Spell Recall$/i)) {
			const r = await P_().rollFor(c, "1d4", {label: "Boon of Spell Recall (1d4)"});
			if (r && r.total === opt.level) refund(`Boon of Spell Recall (${r.total})`);
			else if (r) P_().log(c, `Boon of Spell Recall: ${r.total} (slot level ${opt.level}): the slot is spent`);
		}
	};
	// endregion

	/** For the coverage report: the trigger-based rules this module handles. */
	const HANDLED = {
		hit: ["Smite spells and others cast \"immediately after hitting\" (slot spent only on a hit)", "Sneak Attack (once per turn)", "Radiant Strikes (+1d8, automatic)", "Great Weapon Master (+PB on Heavy, automatic; Hew on a critical hit)", "Weapon mastery: Vex (Advantage next attack), Sap, Slow, Push, Topple (DC shown), Cleave, Nick", "Every feature or feat whose text triggers on a hit (uses or pools spent, once per turn tracked, dice rolled)"],
		miss: ["Guided Strike (+10, Channel Divinity)", "Peerless Aim (Boon of Combat Prowess)", "Homing Strikes (die spent only if it hits)", "Precision Attack", "Lightning Arrow (hit or miss)", "Graze (damage on a miss)", "Studied Attacks (Advantage next attack)", "Peerless Skill (spent only on a success)", "Stroke of Luck", "Heroic Inspiration reroll"],
		fail: ["Tactical Mind (Second Wind spent only on a success)", "Indomitable", "Peerless Skill", "Stroke of Luck", "Heroic Inspiration reroll", "Hide (Invisible on a success, DC 15)", "Escape a Grapple (Grappled ends on a success)", "Concentration saves after damage (concentration ends on a failure)"],
		slots: ["Spell Breaker (Counterspell / Dispel Magic slot back if it fails)", "Boon of Spell Recall (1d4 = slot level: slot back)", "Smites: no slot is spent unless the attack hits"],
	};

	return {afterHit, afterMiss, afterFail, afterCast, hitRiders, applyHit, applyMiss, hasFeat, HIT_RE, HANDLED};
})();
