"use strict";

/**
 * What spells, class features and standard actions do on the live sheet (2024 rules), so the player
 * doesn't do the math. Each handler can ask its questions first ("prepare": a menu; null cancels and
 * nothing is spent), may say what it costs, and then applies itself: an active effect (AC, speed, bonus
 * dice, advantage, resistances, extra damage, temporary HP, max HP, conditions, extra Action), healing,
 * rolls, or a menu-driven resource trade (Font of Magic, Arcane Recovery, Lay on Hands…).
 *
 * Effect mods (all optional):
 *   ac, acMin, acBase ("13+dex" without armor), speed, speedMult, fly, hpMax, spellDc,
 *   dice: {"attack": "1d4", "save": "1d4", "skill:stealth": "1d4"}  added to those d20 tests
 *   adv / dis: ["save:dex", "check:str", "attack:str", "attack:spell", "save", …]
 *   resist: ["fire"], conditions: ["invisible"], damage: [{dice, type, on: "weapon"|"str"}], damageFlat: {on, n}
 *   turnTemp: n (temporary HP at the start of each turn), notes
 */
globalThis.TBEffects = (() => {
	const lc = (s) => String(s ?? "").toLowerCase();
	const P_ = () => TBPlay;
	const R = () => TBRules;
	const MIN = 10; // rounds per minute
	const HOUR = 600;
	const DMG_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
	const tc = (s) => R().titleCase(s);
	const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

	// region Small helpers for handlers
	const self = {value: "self", label: "Yourself (applied to this sheet)"};
	const other = {value: "other", label: "Someone else (noted in the log)"};
	/** "Who is the target?" for spells that can affect the caster. */
	const whoMenu = (ui, title) => ui.menu(title, [self, other]);
	/** The modifier of the spellcasting ability this spell uses (x.cast), or the main one. */
	const spellMod = (x) => (x.cast ? x.cast.mod : (R().castFor(x.d)?.mod || 0));
	/** Dice of a cantrip's scaling entry at the character's level ("" below the first step). */
	const cantripDice = (x, re) => {
		const arr = [].concat(x.spell?.scalingLevelDice || []);
		const sc = arr.find(e => re.test(e.label || "")) || null;
		if (!sc) return "";
		const lv = Object.keys(sc.scaling).map(Number).filter(l => l <= x.d.totalLevel).sort((a, b) => b - a)[0];
		return lv != null ? String(sc.scaling[lv]).replace(/\{\{spellcasting_mod\}\}/g, spellMod(x)) : "";
	};
	/** Weapon cantrips: which weapon (melee only when the spell says so). */
	const weaponMenu = (x, title, meleeOnly) => {
		const ws = (x.d.attacks || []).filter(a => a.dice && (!meleeOnly || a.melee));
		if (!ws.length) { TBUI.toast("No weapon to use: equip one in the Inventory.", {error: true}); return null; }
		return x.ui.menu(title, ws.map(a => ({value: a.name, label: `${a.name} (${a.damage})`})));
	};
	const weaponOf = (x, name) => (x.d.attacks || []).find(a => a.name === name);
	const classLevel = (d, name) => d.classes.find(c => c.name === name)?.level || 0;
	const col = (d, clsName, re) => {
		const c = d.classes.find(x => x.name === clsName);
		const cl = c && (c.cols || []).find(x => re.test(x.label));
		return cl ? cl.values[c.level - 1] : null;
	};
	const healSelf = async (x, expr, label) => {
		const r = await P_().rollFor(x.char, expr, {label});
		if (!r) return false;
		P_().heal(x.char, x.d, r.total);
		P_().log(x.char, `${label}: ${r.total} (${r.text})`);
		return true;
	};
	const effect = (name, mods, opts = {}) => ({name, mods, ...opts});
	// endregion

	// region Standard actions (2024)
	const ACTIONS = {
		"dash": {eco: "action", apply: (x) => x.add(effect("Dash", {speedMult: 2}, {until: "turnStart", notes: "Extra movement equal to your Speed this turn."}))},
		"dodge": {eco: "action", apply: (x) => x.add(effect("Dodge", {adv: ["save:dex"]}, {until: "turnStart", notes: "Attack rolls against you have Disadvantage (if you can see the attacker); Advantage on Dexterity saves."}))},
		"disengage": {eco: "action", apply: (x) => x.add(effect("Disengage", {}, {until: "turnStart", notes: "Your movement doesn't provoke Opportunity Attacks this turn."}))},
		"hide": {eco: "action", prepare: async (x) => {
			const r = await P_().test(x.char, "Hide (Stealth)", x.d.skills.stealth.bonus, "check:dex:stealth", {sit: P_().stateOf(x.char).sit["skill:stealth"] || "", outcome: "check", dc: 15});
			if (!r) return null;
			const ok = r.ok || (await x.ui.afterFail?.(r, "check:dex:stealth"));
			return {ok, total: r.total ?? "?"};
		}, apply: (x, c) => { if (c.ok) x.add(effect("Hidden", {conditions: ["invisible"]}, {notes: `Hidden (Stealth ${c.total}): you have the Invisible condition until you make noise, attack, cast a spell with a Verbal component or are found.`})); else P_().log(x.char, `Hide failed (${c.total} < 15)`); }},
		"help": {eco: "action", apply: (x) => P_().log(x.char, "Help: an ally gets Advantage on their next ability check, or on their next attack against an enemy within 5 ft. of you.")},
		"search": {eco: "action", prepare: (x) => x.ui.menu("Search with", ["insight", "medicine", "perception", "survival"].map(s => ({value: s, label: tc(s)}))), apply: (x, s) => P_().test(x.char, `Search (${tc(s)})`, x.d.skills[s].bonus, `check:wis:${s}`, {sit: P_().stateOf(x.char).sit[`skill:${s}`] || ""})},
		"study": {eco: "action", prepare: (x) => x.ui.menu("Study with", ["arcana", "history", "investigation", "nature", "religion"].map(s => ({value: s, label: tc(s)}))), apply: (x, s) => P_().test(x.char, `Study (${tc(s)})`, x.d.skills[s].bonus, `check:int:${s}`, {sit: P_().stateOf(x.char).sit[`skill:${s}`] || ""})},
		"influence": {eco: "action", prepare: (x) => x.ui.menu("Influence with", ["deception", "intimidation", "performance", "persuasion", "animal handling"].map(s => ({value: s, label: tc(s)}))), apply: (x, s) => P_().test(x.char, `Influence (${tc(s)})`, x.d.skills[s].bonus, `check:${R().SKILLS[s]}:${s}`, {sit: P_().stateOf(x.char).sit[`skill:${s}`] || ""})},
		"escape a grapple": {eco: "action", prepare: (x) => x.ui.menu("Escape with", [{value: "athletics", label: "Athletics (Strength)"}, {value: "acrobatics", label: "Acrobatics (Dexterity)"}]), apply: async (x, s) => {
			const kind = `check:${R().SKILLS[s]}:${s}`;
			const r = await P_().test(x.char, `Escape a grapple (${tc(s)})`, x.d.skills[s].bonus, kind, {outcome: "check", decide: true});
			if (!r) return;
			const ok = r.ok || (await x.ui.afterFail?.(r, kind));
			const P = P_().stateOf(x.char);
			if (ok && P.conditions.includes("grappled")) { P.conditions = P.conditions.filter(k => k !== "grappled"); P_().log(x.char, "Escaped: no longer Grappled"); }
		}},
		"end concentration": {eco: "free", apply: (x) => P_().endConcentration(x.char, "ended by choice")},
		"don or doff a shield": {eco: "action", apply: (x) => {
			const it = (P_().gearOf(x.char).items || []).find((i, ix) => x.d.items[ix]?.ent && R().isShieldEnt(x.d.items[ix].ent));
			if (!it) { P_().log(x.char, "No shield in the inventory."); return; }
			it.equipped = !it.equipped;
			x.derivedChanged = true;
			P_().log(x.char, it.equipped ? "Donned the shield" : "Doffed the shield");
		}},
		"ready": {eco: "action", apply: (x) => P_().log(x.char, "Ready: choose a trigger and the action; you use your Reaction when it happens.")},
		"utilize": {eco: "action", apply: (x) => P_().log(x.char, "Utilize: use a nonmagical object.")},
	};
	// endregion

	// region Spells
	const SPELLS = {
		"bless": {prepare: (x) => x.ui.menu("Bless: are you one of the targets?", [{value: "self", label: "Yes, include yourself"}, {value: "other", label: "No, only allies"}]), apply: (x, w) => w === "self" && x.add(effect("Bless", {dice: {attack: "1d4", save: "1d4"}}, {conc: true, rounds: MIN, notes: "+1d4 to attack rolls and saving throws (added to your rolls)."}))},
		"bane": {apply: (x) => P_().log(x.char, `Bane: targets make a Charisma save (DC ${x.dc}) or subtract 1d4 from attacks and saves.`)},
		"guidance": {prepare: async (x) => {
			const w = await whoMenu(x.ui, "Guidance: target");
			if (!w) return null;
			if (w === "other") return {w};
			const s = await x.ui.menu("Guidance: which skill?", R().SKILL_LIST.map(k => ({value: k, label: tc(k)})));
			return s ? {w, s} : null;
		}, apply: (x, c) => c.w === "self" && x.add(effect(`Guidance (${tc(c.s)})`, {dice: {[`skill:${c.s}`]: "1d4"}}, {conc: true, rounds: MIN, notes: `+1d4 to ${tc(c.s)} checks.`}))},
		"resistance": {prepare: async (x) => {
			const w = await whoMenu(x.ui, "Resistance: target");
			if (!w) return null;
			const t = w === "self" ? await x.ui.menu("Resistance: damage type", DMG_TYPES.map(k => ({value: k, label: tc(k)}))) : "any";
			return t ? {w, t} : null;
		}, apply: (x, c) => c.w === "self" && x.add(effect(`Resistance (${tc(c.t)})`, {}, {conc: true, rounds: MIN, notes: `Once per turn, reduce ${tc(c.t)} damage you take by 1d4.`}))},
		"shield": {apply: (x) => x.add(effect("Shield", {ac: 5}, {until: "turnStart", notes: "+5 AC (including against the triggering attack); no damage from Magic Missile."}))},
		"shield of faith": {prepare: (x) => whoMenu(x.ui, "Shield of Faith: target"), apply: (x, w) => w === "self" && x.add(effect("Shield of Faith", {ac: 2}, {conc: true, rounds: 10 * MIN}))},
		"mage armor": {prepare: (x) => whoMenu(x.ui, "Mage Armor: target"), apply: (x, w) => w === "self" && x.add(effect("Mage Armor", {acBase: 13}, {rounds: 8 * HOUR, notes: "Base AC 13 + Dexterity while you wear no armor."}))},
		"barkskin": {prepare: (x) => whoMenu(x.ui, "Barkskin: target"), apply: (x, w) => w === "self" && x.add(effect("Barkskin", {acMin: 17}, {rounds: HOUR, notes: "Your AC can't be lower than 17."}))},
		"haste": {prepare: (x) => whoMenu(x.ui, "Haste: target"), apply: (x, w) => {
			if (w !== "self") return;
			x.add(effect("Haste", {ac: 2, speedMult: 2, adv: ["save:dex"]}, {conc: true, rounds: MIN, extraAction: true, notes: "+2 AC, Speed doubled, Advantage on Dexterity saves, one extra action each turn (Attack with one weapon attack, Dash, Disengage, Hide or Utilize). When it ends you can't move or act until after your next turn."}));
		}},
		"longstrider": {prepare: (x) => whoMenu(x.ui, "Longstrider: target"), apply: (x, w) => w === "self" && x.add(effect("Longstrider", {speed: 10}, {rounds: HOUR}))},
		"fly": {prepare: (x) => whoMenu(x.ui, "Fly: target"), apply: (x, w) => w === "self" && x.add(effect("Fly", {fly: 60}, {conc: true, rounds: 10 * MIN, notes: "Fly Speed 60 ft."}))},
		"spider climb": {prepare: (x) => whoMenu(x.ui, "Spider Climb: target"), apply: (x, w) => w === "self" && x.add(effect("Spider Climb", {}, {conc: true, rounds: HOUR, notes: "Climb Speed equal to your Speed; climb on ceilings hands-free."}))},
		"expeditious retreat": {apply: (x) => { x.add(effect("Expeditious Retreat", {}, {conc: true, rounds: 10 * MIN, notes: "Dash as a Bonus Action on each of your turns."})); x.add(effect("Dash", {speedMult: 2}, {until: "turnStart"})); }},
		"jump": {apply: (x) => x.add(effect("Jump", {}, {rounds: MIN, notes: "Once per turn, jump up to 30 ft. by spending 10 ft. of movement."}))},
		"heroism": {prepare: (x) => whoMenu(x.ui, "Heroism: target"), apply: (x, w) => {
			if (w !== "self") return;
			const n = Math.max(1, spellMod(x));
			P_().addTemp(x.char, n);
			x.add(effect("Heroism", {condImmune: ["frightened"], turnTemp: n}, {conc: true, rounds: MIN, notes: `Immune to Frightened; ${n} Temporary Hit Points at the start of each of your turns.`}));
		}},
		"aid": {prepare: (x) => whoMenu(x.ui, "Aid: are you one of the targets?"), apply: (x, w) => {
			if (w !== "self") return;
			const n = 5 * Math.max(1, x.slot - 1);
			x.add(effect("Aid", {hpMax: n}, {rounds: 8 * HOUR, notes: `Hit Point maximum +${n}.`}));
			P_().heal(x.char, {...x.d, hp: x.d.hp + n}, n);
		}},
		"false life": {apply: async (x) => {
			const r = await P_().rollFor(x.char, `2d4+${4 + 5 * Math.max(0, x.slot - 1)}`, {label: "False Life: Temporary Hit Points"});
			if (r) P_().addTemp(x.char, r.total);
		}},
		"armor of agathys": {apply: (x) => {
			const n = 5 * Math.max(1, x.slot);
			P_().addTemp(x.char, n);
			x.add(effect("Armor of Agathys", {}, {rounds: HOUR, notes: `While you have these Temporary Hit Points, a creature that hits you with a melee attack takes ${n} Cold damage.`}));
		}},
		"blur": {apply: (x) => x.add(effect("Blur", {}, {conc: true, rounds: MIN, notes: "Attack rolls against you have Disadvantage (unless the attacker doesn't rely on sight)."}))},
		"mirror image": {apply: (x) => x.add(effect("Mirror Image (3)", {}, {rounds: MIN, notes: "When hit, roll 1d6 per remaining duplicate; any 3+ destroys a duplicate instead."}))},
		"invisibility": {prepare: (x) => whoMenu(x.ui, "Invisibility: target"), apply: (x, w) => w === "self" && x.add(effect("Invisibility", {conditions: ["invisible"]}, {conc: true, rounds: HOUR, notes: "Invisible until you attack, deal damage or cast a spell."}))},
		"greater invisibility": {prepare: (x) => whoMenu(x.ui, "Greater Invisibility: target"), apply: (x, w) => w === "self" && x.add(effect("Greater Invisibility", {conditions: ["invisible"]}, {conc: true, rounds: MIN}))},
		"divine favor": {apply: (x) => x.add(effect("Divine Favor", {damage: [{dice: "1d4", type: "Radiant", on: "weapon"}]}, {rounds: MIN, notes: "Weapon hits deal an extra 1d4 Radiant damage (added to your damage rolls)."}))},
		"hunter's mark": {apply: (x) => x.add(effect("Hunter's Mark", {damage: [{dice: "1d6", type: "Force", on: "weapon", target: true}]}, {conc: true, rounds: HOUR, notes: "+1d6 Force damage when you hit the marked target (added to your damage rolls); Advantage on Perception/Survival checks to find it."}))},
		"hex": {prepare: (x) => x.ui.menu("Hex: the target has Disadvantage on checks with", R().ABILS.map(a => ({value: a, label: R().ABIL_NAMES[a]}))), apply: (x, a) => x.add(effect("Hex", {damage: [{dice: "1d6", type: "Necrotic", on: "attack", target: true}]}, {conc: true, rounds: HOUR, notes: `+1d6 Necrotic damage when you hit the cursed target; it has Disadvantage on ${R().ABIL_NAMES[a]} checks.`}))},
		"enlarge/reduce": {prepare: async (x) => {
			const w = await whoMenu(x.ui, "Enlarge/Reduce: target");
			if (!w) return null;
			const m = w === "self" ? await x.ui.menu("Enlarge or reduce?", [{value: "enlarge", label: "Enlarge"}, {value: "reduce", label: "Reduce"}]) : "x";
			return m ? {w, m} : null;
		}, apply: (x, c) => {
			if (c.w !== "self") return;
			if (c.m === "enlarge") x.add(effect("Enlarged", {adv: ["check:str", "save:str"], damage: [{dice: "1d4", type: "", on: "weapon"}]}, {conc: true, rounds: MIN, notes: "One size larger; Advantage on Strength checks and saves; weapon hits +1d4 damage."}));
			else x.add(effect("Reduced", {dis: ["check:str", "save:str"], damage: [{dice: "-1d4", type: "", on: "weapon"}]}, {conc: true, rounds: MIN, notes: "One size smaller; Disadvantage on Strength checks and saves; weapon hits −1d4 damage."}));
		}},
		"stoneskin": {prepare: (x) => whoMenu(x.ui, "Stoneskin: target"), apply: (x, w) => w === "self" && x.add(effect("Stoneskin", {resist: ["bludgeoning", "piercing", "slashing"]}, {conc: true, rounds: HOUR}))},
		"fire shield": {prepare: (x) => x.ui.menu("Fire Shield", [{value: "warm", label: "Warm shield (Resistance to Cold)"}, {value: "chill", label: "Chill shield (Resistance to Fire)"}]), apply: (x, k) => x.add(effect(`Fire Shield (${k})`, {resist: [k === "warm" ? "cold" : "fire"]}, {rounds: 10 * MIN, notes: `A creature within 5 ft. that hits you with a melee attack takes 2d8 ${k === "warm" ? "Fire" : "Cold"} damage.`}))},
		"protection from energy": {prepare: async (x) => {
			const w = await whoMenu(x.ui, "Protection from Energy: target");
			if (!w) return null;
			const t = w === "self" ? await x.ui.menu("Damage type", ["acid", "cold", "fire", "lightning", "thunder"].map(k => ({value: k, label: tc(k)}))) : "x";
			return t ? {w, t} : null;
		}, apply: (x, c) => c.w === "self" && x.add(effect(`Protection from Energy (${tc(c.t)})`, {resist: [c.t]}, {conc: true, rounds: HOUR}))},
		"protection from evil and good": {prepare: (x) => whoMenu(x.ui, "Protection from Evil and Good: target"), apply: (x, w) => w === "self" && x.add(effect("Protection from Evil and Good", {}, {conc: true, rounds: 10 * MIN, notes: "Aberrations, Celestials, Elementals, Fey, Fiends and Undead have Disadvantage to hit you; you can't be Charmed, Frightened or possessed by them."}))},
		"holy aura": {apply: (x) => x.add(effect("Holy Aura", {adv: ["save"]}, {conc: true, rounds: MIN, notes: "Advantage on all saves; attacks against you have Disadvantage; Fiends/Undead that hit you are Blinded on a failed save."}))},
		"foresight": {prepare: (x) => whoMenu(x.ui, "Foresight: target"), apply: (x, w) => w === "self" && x.add(effect("Foresight", {adv: ["attack", "check", "save"]}, {rounds: 8 * HOUR, notes: "Advantage on d20 tests; attacks against you have Disadvantage."}))},
		"death ward": {prepare: (x) => whoMenu(x.ui, "Death Ward: target"), apply: (x, w) => w === "self" && x.add(effect("Death Ward", {}, {rounds: 8 * HOUR, notes: "The first time you'd drop to 0 HP, you drop to 1 HP instead."}))},
		"freedom of movement": {prepare: (x) => whoMenu(x.ui, "Freedom of Movement: target"), apply: (x, w) => w === "self" && x.add(effect("Freedom of Movement", {}, {rounds: HOUR, notes: "Difficult terrain doesn't slow you; magic can't reduce your Speed or make you Paralyzed or Restrained."}))},
		"darkvision": {prepare: (x) => whoMenu(x.ui, "Darkvision: target"), apply: (x, w) => w === "self" && x.add(effect("Darkvision", {}, {rounds: 8 * HOUR, notes: "Darkvision 150 ft."}))},
		"see invisibility": {apply: (x) => x.add(effect("See Invisibility", {}, {rounds: HOUR, notes: "You see Invisible creatures and objects and into the Ethereal Plane."}))},
		"sanctuary": {prepare: (x) => whoMenu(x.ui, "Sanctuary: target"), apply: (x, w) => w === "self" && x.add(effect("Sanctuary", {}, {rounds: MIN, notes: `Attackers must succeed on a Wisdom save (DC ${x.dc}) or choose a new target; ends if you attack or deal damage.`}))},
		"shillelagh": {prepare: (x) => x.ui.menu("Shillelagh: damage type", [{value: "weapon", label: "Bludgeoning (the weapon's)"}, {value: "Force", label: "Force"}]), apply: (x, type) => {
			const lvl = x.d.totalLevel;
			const die = lvl >= 17 ? "2d6" : lvl >= 11 ? "1d12" : lvl >= 5 ? "1d10" : "1d8";
			const ab = x.cast?.ability || "wis";
			const force = type === "Force";
			x.add(effect("Shillelagh", {weaponCast: {name: "Shillelagh", match: "\\b(club|quarterstaff)\\b", ability: ab, die, type: force ? "Force" : ""}}, {rounds: MIN, notes: `Club and Quarterstaff attacks use ${x.cast?.abilityName || "your spellcasting ability"} and deal ${die}${force ? " Force" : ""} damage (already in your Attacks).`}));
		}},
		"spirit guardians": {apply: (x) => x.add(effect("Spirit Guardians", {}, {conc: true, rounds: 10 * MIN, notes: `15-ft. emanation: enemies' Speed halved; Wisdom save (DC ${x.dc}) when they enter or end their turn there.`}))},
		"pass without trace": {apply: (x) => x.add(effect("Pass without Trace", {dice: {"skill:stealth": "+10"}}, {conc: true, rounds: HOUR, notes: "+10 to Stealth checks (added to your rolls)."}))},
		"blade ward": {apply: (x) => x.add(effect("Blade Ward", {}, {conc: true, rounds: MIN, notes: "Attackers subtract 1d4 from attack rolls against you."}))},
		// Weapon cantrips: pick the weapon, then the attack and damage are rolled with the right numbers
		"true strike": {noDice: true, prepare: async (x) => {
			const w = await weaponMenu(x, "True Strike: attack with", false);
			if (!w) return null;
			const a = weaponOf(x, w);
			const types = [{value: a.dmgType, label: `${a.dmgType} (the weapon's)`}, {value: "Radiant", label: "Radiant"}].filter((o, i, arr) => o.value && arr.findIndex(z => z.value === o.value) === i);
			const type = await x.ui.menu("True Strike: damage type", types);
			return type ? {w, type} : null;
		}, apply: async (x, ch) => {
			const a = weaponOf(x, ch.w);
			const m = spellMod(x);
			const extra = cantripDice(x, /radiant/i);
			const dmg = `${a.dice}${signed(m + (a.magicDmg || 0))}${extra ? `+${extra}` : ""}`;
			await x.attack({...a, name: `True Strike (${a.name})`, abil: x.cast?.ability || a.abil, bonus: m + (a.prof ? x.d.pb : 0) + (a.magicHit || 0), damage: `${dmg} ${ch.type}${extra && ch.type !== "Radiant" ? ` (${extra} of it Radiant)` : ""}`}, {economy: false});
		}},
		"booming blade": {noDice: true, prepare: (x) => weaponMenu(x, "Booming Blade: melee attack with", true), apply: async (x, w) => {
			const a = weaponOf(x, w);
			const extra = cantripDice(x, /on hit/i);
			await x.attack({...a, name: `Booming Blade (${a.name})`, damage: extra ? a.damage.replace(/^([\dd+\- ]+)/, `$1+${extra} `).replace(/\s+$/, "") + " + Thunder" : a.damage}, {economy: false});
			P_().log(x.char, `Booming Blade: if the target willingly moves 5 ft. or more before your next turn, it takes ${cantripDice(x, /moving/i) || "1d8"} Thunder damage.`);
		}},
		"green-flame blade": {noDice: true, prepare: (x) => weaponMenu(x, "Green-Flame Blade: melee attack with", true), apply: async (x, w) => {
			const a = weaponOf(x, w);
			const extra = cantripDice(x, /^fire damage( on hit)?$|target/i);
			await x.attack({...a, name: `Green-Flame Blade (${a.name})`, damage: extra ? a.damage.replace(/^([\dd+\- ]+)/, `$1+${extra} `).replace(/\s+$/, "") + " + Fire" : a.damage}, {economy: false});
			const leap = cantripDice(x, /secondary/i) || String(spellMod(x));
			const r = await P_().rollFor(x.char, leap.replace(/\s+/g, ""), {label: "Green-Flame Blade: second creature (Fire)", for: "enemy"});
			if (r) P_().log(x.char, `Green-Flame Blade: a second creature within 5 ft. of the target takes ${P_().shown(r)} Fire damage`);
		}},
	};
	// endregion

	// region Class features
	const FEATURES = {
		"rage": {eco: "bonus", prepare: (x) => {
			// Path of the Wild Heart: choose the Rage of the Wilds each time
			const sub = x.d.classes.find(c => c.name === "Barbarian")?.subclass || "";
			if (!/Wild Heart/i.test(sub)) return true;
			return x.ui.menu("Rage of the Wilds", [{value: "bear", label: "Bear: Resistance to every damage type except Force, Necrotic, Psychic and Radiant"}, {value: "eagle", label: "Eagle: Dash and Disengage as part of this Bonus Action; Dash as a Bonus Action while raging"}, {value: "wolf", label: "Wolf: allies have Advantage on attacks against enemies within 5 ft. of you"}]);
		}, apply: (x, wild) => {
			const bl = classLevel(x.d, "Barbarian");
			const dmg = Number(String(col(x.d, "Barbarian", /^Rage Damage$/i) || "+2").replace(/[^\d]/g, "")) || 2;
			const sub = x.d.classes.find(c => c.name === "Barbarian")?.subclass || "";
			if (P_().stateOf(x.char).concentration) P_().endConcentration(x.char, "Rage");
			let resist = ["bludgeoning", "piercing", "slashing"];
			const notes = [`Resistance to Bludgeoning, Piercing and Slashing; Advantage on Strength checks and saves; +${dmg} damage with Strength attacks; no spells or concentration. Extend it each turn by attacking, forcing a save or a Bonus Action.`];
			if (wild === "bear") { resist = DMG_TYPES.filter(t => !["force", "necrotic", "psychic", "radiant"].includes(t)); notes.push("Bear: Resistance to all damage but Force, Necrotic, Psychic and Radiant."); }
			if (wild === "eagle") { notes.push("Eagle: you can Dash as a Bonus Action."); x.add(effect("Dash", {speedMult: 2}, {until: "turnStart"})); x.add(effect("Disengage", {}, {until: "turnStart"})); }
			if (wild === "wolf") notes.push("Wolf: allies have Advantage on attack rolls against enemies within 5 ft. of you.");
			if (/Zealot/i.test(sub)) notes.push(`Divine Fury: the first creature you hit each turn takes an extra 1d6+${Math.floor(bl / 2)} Necrotic or Radiant damage (roll it with "Divine Fury" in Other).`);
			if (/Berserker/i.test(sub)) notes.push(`Frenzy: with Reckless Attack while raging, your first Strength hit each turn deals an extra ${dmg}d6 damage.`);
			x.add(effect("Rage", {resist, adv: ["check:str", "save:str"], damageFlat: {on: "str", n: dmg}}, {rounds: 10 * MIN, notes: notes.join(" ")}));
		}},
		"divine fury": {eco: "free", apply: async (x) => { const r = await P_().rollFor(x.char, `1d6+${Math.floor(classLevel(x.d, "Barbarian") / 2)}`, {label: "Divine Fury", for: "enemy"}); if (r) P_().log(x.char, `Divine Fury: ${P_().shown(r)} Necrotic or Radiant damage`); }},
		"frenzy": {eco: "free", apply: async (x) => { const n = Number(String(col(x.d, "Barbarian", /^Rage Damage$/i) || "+2").replace(/[^\d]/g, "")) || 2; const r = await P_().rollFor(x.char, `${n}d6`, {label: "Frenzy", for: "enemy"}); if (r) P_().log(x.char, `Frenzy: +${P_().shown(r)} damage`); }},
		"reckless attack": {eco: "free", apply: (x) => x.add(effect("Reckless Attack", {adv: ["attack:str"]}, {until: "turnStart", notes: "Advantage on Strength attack rolls this turn; attacks against you have Advantage until your next turn."}))},
		"second wind": {eco: "bonus", apply: (x) => healSelf(x, `1d10+${classLevel(x.d, "Fighter")}`, "Second Wind")},
		"action surge": {eco: "free", apply: (x) => { P_().stateOf(x.char).turn.action = false; P_().log(x.char, "Action Surge: one more action this turn (not Magic)."); }},
		"cunning action": {eco: "bonus", prepare: (x) => x.ui.menu("Cunning Action", ["dash", "disengage", "hide"].map(k => ({value: k, label: tc(k)}))), apply: async (x, k) => {
			const a = ACTIONS[k];
			const c = a.prepare ? await a.prepare(x) : true;
			if (c != null) await a.apply(x, c);
		}},
		"patient defense": {eco: "bonus", noPool: true, prepare: (x) => x.ui.menu("Patient Defense", [{value: "free", label: "Disengage"}, {value: "focus", label: "Disengage and Dodge (1 Focus Point)"}]), cost: (x, c) => (c === "focus" ? {pool: "focus points", n: 1} : null), apply: (x, c) => { ACTIONS.disengage.apply(x); if (c === "focus") ACTIONS.dodge.apply(x); }},
		"step of the wind": {eco: "bonus", noPool: true, prepare: (x) => x.ui.menu("Step of the Wind", [{value: "free", label: "Dash"}, {value: "focus", label: "Dash and Disengage, jump distance doubled (1 Focus Point)"}]), cost: (x, c) => (c === "focus" ? {pool: "focus points", n: 1} : null), apply: (x, c) => { ACTIONS.dash.apply(x); if (c === "focus") ACTIONS.disengage.apply(x); }},
		"flurry of blows": {eco: "bonus", apply: async (x) => {
			const us = x.d.attacks.find(a => a.name === "Unarmed Strike");
			const n = classLevel(x.d, "Monk") >= 10 ? 3 : 2;
			for (let i = 0; i < n && us; ++i) if (!await x.attack(us, {economy: false})) break;
		}},
		"lay on hands": {eco: "bonus", noPool: true, prepare: async (x) => {
			const res = P_().resources(x.d).find(r => r.key === "pool:lay on hands");
			const left = res ? P_().remaining(x.char, res) : 0;
			if (!left) { TBUI.toast("No Lay on Hands points left.", {error: true}); return null; }
			const w = await whoMenu(x.ui, "Lay on Hands: target");
			if (!w) return null;
			const n = await x.ui.number(`Lay on Hands: how many HP? (${left} left)`, Math.min(left, x.d.hp - P_().currentHp(x.char, x.d)) || 1, 1, left);
			return n ? {w, n} : null;
		}, cost: (x, c) => ({pool: "lay on hands", n: c.n}), apply: (x, c) => { if (c.w === "self") P_().heal(x.char, x.d, c.n); else P_().log(x.char, `Lay on Hands: healed someone for ${c.n}`); }},
		"channel divinity": {eco: "action", prepare: (x) => x.d.classes.some(c => c.name === "Cleric") ? x.ui.menu("Channel Divinity", [{value: "heal", label: "Divine Spark: heal"}, {value: "harm", label: "Divine Spark: Necrotic/Radiant damage"}, {value: "turn", label: "Turn Undead"}, {value: "other", label: "Another option (subclass)"}]) : "other", apply: async (x, k) => {
			const cl = classLevel(x.d, "Cleric");
			const dice = `${cl >= 18 ? 4 : cl >= 13 ? 3 : cl >= 7 ? 2 : 1}d8+${x.d.mods.wis}`;
			if (k === "heal") { const w = await whoMenu(x.ui, "Divine Spark: target"); if (w === "self") await healSelf(x, dice, "Divine Spark"); else if (w) { const r = await P_().rollFor(x.char, dice, {label: "Divine Spark healing", for: "enemy"}); if (r) P_().log(x.char, `Divine Spark heals ${P_().shown(r)}`); } } else if (k === "harm") { const r = await P_().rollFor(x.char, dice, {label: "Divine Spark damage", for: "enemy"}); if (r) P_().log(x.char, `Divine Spark: ${r.total} damage, Constitution save DC ${x.dc} for half`); } else if (k === "turn") P_().log(x.char, `Turn Undead: each Undead within 30 ft. makes a Wisdom save (DC ${x.dc}) or is Frightened and Incapacitated for 1 minute.`);
			else P_().log(x.char, "Channel Divinity used.");
		}},
		"font of magic": {eco: "free", noPool: true, prepare: async (x) => {
			const sp = P_().resources(x.d).find(r => r.key === "pool:sorcery points");
			if (!sp) return null;
			const left = P_().remaining(x.char, sp);
			const COST = {1: 2, 2: 3, 3: 5, 4: 6, 5: 7};
			const opts = [];
			P_().slotsOf(x.d).forEach(s => { if (P_().slotsLeft(x.char, x.d, s.level)) opts.push({value: `slot:${s.level}`, label: `Turn a level ${s.level} slot into ${s.level} Sorcery Points`}); });
			Object.entries(COST).forEach(([lv, c]) => { const s = P_().slotsOf(x.d).find(q => q.level === Number(lv)); if (s && left >= c && (P_().stateOf(x.char).slotsUsed[lv] || 0) > 0) opts.push({value: `pts:${lv}`, label: `Spend ${c} Sorcery Points for a level ${lv} slot`}); });
			if (!opts.length) { TBUI.toast("Nothing to convert.", {error: true}); return null; }
			return x.ui.menu(`Font of Magic (${left} points left)`, opts);
		}, apply: (x, k) => {
			const P = P_().stateOf(x.char);
			const sp = P_().resources(x.d).find(r => r.key === "pool:sorcery points");
			const [kind, lv] = k.split(":");
			if (kind === "slot") { P.slotsUsed[lv] = (P.slotsUsed[lv] || 0) + 1; P.uses[sp.key] = Math.max(0, (P.uses[sp.key] || 0) - Number(lv)); P_().log(x.char, `Font of Magic: level ${lv} slot → ${lv} Sorcery Points`); } else { const c = {1: 2, 2: 3, 3: 5, 4: 6, 5: 7}[lv]; P_().spend(x.char, sp, c); P.slotsUsed[lv] = Math.max(0, (P.slotsUsed[lv] || 0) - 1); P_().log(x.char, `Font of Magic: ${c} Sorcery Points → level ${lv} slot`); }
		}},
		"arcane recovery": {eco: "free", prepare: async (x) => {
			const budget = Math.ceil(classLevel(x.d, "Wizard") / 2);
			const P = P_().stateOf(x.char);
			const spent = P_().slotsOf(x.d).filter(s => s.level <= 5 && (P.slotsUsed[s.level] || 0) > 0);
			if (!spent.length) { TBUI.toast("No expended slots to recover.", {error: true}); return null; }
			return x.ui.slotPicker(`Arcane Recovery: recover slots totaling up to ${budget} levels (none above 5)`, spent.map(s => ({level: s.level, max: P.slotsUsed[s.level]})), budget);
		}, apply: (x, picks) => {
			const P = P_().stateOf(x.char);
			Object.entries(picks).forEach(([lv, n]) => { P.slotsUsed[lv] = Math.max(0, (P.slotsUsed[lv] || 0) - n); });
			P_().log(x.char, `Arcane Recovery: ${Object.entries(picks).filter(([, n]) => n).map(([lv, n]) => `${n}× level ${lv}`).join(", ")}`);
		}},
		"magical cunning": {eco: "free", apply: (x) => { const P = P_().stateOf(x.char); const p = P_().pactOf(x.d); if (p) { const n = Math.ceil(p.slots / 2); P.pactUsed = Math.max(0, (P.pactUsed || 0) - n); P_().log(x.char, `Magical Cunning: regained ${n} Pact Magic slot(s)`); } }},
		"innate sorcery": {eco: "bonus", apply: (x) => x.add(effect("Innate Sorcery", {spellDc: 1, adv: ["attack:spell"]}, {rounds: MIN, notes: "+1 spell save DC; Advantage on spell attack rolls (Sorcerer spells)."}))},
		"bardic inspiration": {eco: "bonus", apply: (x) => P_().log(x.char, `Bardic Inspiration: an ally gains a ${col(x.d, "Bard", /^Bardic Die$/i) || "d6"} to add to one failed d20 test within the next hour.`)},
		"indomitable": {eco: "free", prepare: (x) => {
			const last = P_().stateOf(x.char).log.find(l => l.kind === "d20" && /^save:/.test(l.testKind || ""));
			if (!last) { TBUI.toast("Roll the failed saving throw first; Indomitable rerolls the last one.", {error: true}); return null; }
			return last;
		}, apply: (x, last) => P_().test(x.char, `${last.label} (Indomitable reroll)`, last.bonus + classLevel(x.d, "Fighter"), last.testKind, {outcome: "check", decide: true})},
		"wild resurgence": {eco: "free", noPool: true, prepare: (x) => {
			const ws = P_().resources(x.d).find(r => r.key === "pool:wild shape");
			const P = P_().stateOf(x.char);
			const lv = P_().slotsOf(x.d).find(s => P_().slotsLeft(x.char, x.d, s.level) > 0);
			if (!ws || !lv || !(P.uses[ws.key] > 0)) { TBUI.toast("Needs a spent Wild Shape use and a spell slot.", {error: true}); return null; }
			return x.ui.menu("Wild Resurgence: spend which slot for a Wild Shape use?", P_().slotsOf(x.d).filter(s => P_().slotsLeft(x.char, x.d, s.level)).map(s => ({value: s.level, label: `Level ${s.level} slot`})));
		}, apply: (x, lv) => { const P = P_().stateOf(x.char); const ws = P_().resources(x.d).find(r => r.key === "pool:wild shape"); P.slotsUsed[lv] = (P.slotsUsed[lv] || 0) + 1; P.uses[ws.key] = Math.max(0, P.uses[ws.key] - 1); P_().log(x.char, `Wild Resurgence: level ${lv} slot → one Wild Shape use`); }},
		"favored enemy": {eco: "bonus", apply: (x) => SPELLS["hunter's mark"].apply(x)},
		// Monk (2024): the Focus options live in one feature
		"monk's focus": {eco: "bonus", noPool: true, prepare: (x) => {
			const fp = P_().resources(x.d).find(r => r.key === "pool:focus points");
			const left = fp ? P_().remaining(x.char, fp) : 0;
			return x.ui.menu(`Monk's Focus (${left} Focus Points left)`, [
				{value: "flurry", label: `Flurry of Blows: ${classLevel(x.d, "Monk") >= 10 ? "three" : "two"} Unarmed Strikes (1 Focus Point)`},
				{value: "patient", label: "Patient Defense: Disengage"},
				{value: "patient+", label: "Patient Defense: Disengage and Dodge (1 Focus Point)"},
				{value: "step", label: "Step of the Wind: Dash"},
				{value: "step+", label: "Step of the Wind: Dash and Disengage, jump doubled (1 Focus Point)"},
			]);
		}, cost: (x, c) => (["flurry", "patient+", "step+"].includes(c) ? {pool: "focus points", n: 1} : null), apply: async (x, c) => {
			if (c === "flurry") return FEATURES["flurry of blows"].apply(x);
			if (c.startsWith("patient")) return FEATURES["patient defense"].apply(x, c === "patient+" ? "focus" : "free");
			return FEATURES["step of the wind"].apply(x, c === "step+" ? "focus" : "free");
		}},
		"martial arts": {eco: "bonus", apply: (x) => { const us = x.d.attacks.find(a => a.name === "Unarmed Strike"); if (us) return x.attack(us, {economy: false}); }},
		"stunning strike": {eco: "free", noPool: true, cost: () => ({pool: "focus points", n: 1}), apply: (x) => P_().log(x.char, `Stunning Strike: the target makes a Constitution save (DC ${8 + x.d.pb + x.d.mods.wis}) or is Stunned until the start of your next turn (on a success its Speed is halved and your next attack against it has Advantage).`)},
		"uncanny metabolism": {eco: "free", apply: async (x) => {
			const fp = P_().resources(x.d).find(r => r.key === "pool:focus points");
			if (fp) P_().stateOf(x.char).uses[fp.key] = 0;
			await healSelf(x, `${col(x.d, "Monk", /^Martial Arts$/i) || "1d6"}+${classLevel(x.d, "Monk")}`, "Uncanny Metabolism (all Focus Points back)");
		}},
		"slow fall": {eco: "reaction", apply: (x) => P_().log(x.char, `Slow Fall: falling damage reduced by ${5 * classLevel(x.d, "Monk")}.`)},
		"steady aim": {eco: "bonus", apply: (x) => x.add(effect("Steady Aim", {adv: ["attack"], speedZero: true}, {until: "turnStart", notes: "Advantage on your next attack roll this turn; your Speed is 0 until the end of the turn."}))},
		"cunning strike": {eco: "free", apply: (x) => P_().log(x.char, `Cunning Strike: give up Sneak Attack dice for Poison (1d6, Con save DC ${8 + x.d.pb + x.d.mods.dex}), Trip (1d6, Dex save, Prone) or Withdraw (1d6, move half Speed).`)},
		"two extra attacks": {eco: "free", apply: (x) => P_().log(x.char, "Two Extra Attacks: the Attack action makes three attacks; use Attack for each.")},
		"three extra attacks": {eco: "free", apply: (x) => P_().log(x.char, "Three Extra Attacks: the Attack action makes four attacks; use Attack for each.")},
		// Fighter: Battle Master (Superiority Dice are tracked as a pool)
		"battle master": {eco: "free", apply: async (x) => {
			const fl = classLevel(x.d, "Fighter");
			const die = fl >= 18 ? "d12" : fl >= 10 ? "d10" : "d8";
			const r = await P_().rollFor(x.char, `1${die}`, {label: "Superiority Die", for: "enemy"});
			if (r) P_().log(x.char, `Maneuver: Superiority Die ${P_().shown(r)}`, {notes: [`Save DC for maneuvers: ${8 + x.d.pb + Math.max(x.d.mods.str, x.d.mods.dex)}`]});
		}},
		// Bard: College of Lore and Countercharm
		"college of lore": {eco: "reaction", apply: async (x) => { const die = col(x.d, "Bard", /^Bardic Die$/i) || "1d6"; const r = await P_().rollFor(x.char, die, {label: "Cutting Words", for: "enemy"}); if (r) P_().log(x.char, `Cutting Words: subtract ${P_().shown(r)} from the creature's roll`); }},
		"countercharm": {eco: "reaction", apply: (x) => P_().log(x.char, "Countercharm: a creature within 30 ft. that fails a save against Charmed or Frightened rerolls it with Advantage.")},
		"divine intervention": {eco: "action", apply: (x) => P_().log(x.char, "Divine Intervention: cast any Cleric spell of level 5 or lower that isn't a Reaction, without a slot or Material components.")},
		"extra attack": {eco: "free", apply: (x) => P_().log(x.char, "Extra Attack: when you take the Attack action you attack twice; use Attack again on a weapon for the second attack (the action is already spent).")},
		"tactical mind": {eco: "free", apply: (x) => P_().log(x.char, "Tactical Mind: after failing an ability check, spend a Second Wind use to add 1d10 (the use isn't spent if it still fails).")},
	};
	// endregion

	// region Reaction helpers used by the damage panel
	const has = (d, name) => R().featureList(d).some(f => lc(f.name) === lc(name));
	const damageReactions = (d) => [
		has(d, "Uncanny Dodge") ? {key: "uncanny", label: "½ Uncanny Dodge", halve: true} : null,
		has(d, "Deflect Attacks") || has(d, "Deflect Energy") ? {key: "deflect", label: "Deflect Attacks", reduce: `1d10+${d.mods.dex}+${classLevel(d, "Monk")}`} : null,
	].filter(Boolean);
	// endregion

	/** Passive features that always change rolls or numbers (no button needed). */
	const PASSIVES = {
		"danger sense": (d) => ({adv: ["save:dex"], why: "Danger Sense"}),
		"feral instinct": (d) => ({adv: ["init"], why: "Feral Instinct"}),
		"aura of protection": (d) => ({saveFlat: Math.max(1, d.mods.cha), why: "Aura of Protection"}),
		"reliable talent": (d) => ({note: "Reliable Talent: a d20 of 9 or lower on a proficient skill check counts as 10."}),
		"evasion": (d) => ({note: "Evasion: Dexterity saves for half damage take none on a success, half on a failure."}),
	};
	const passivesOf = (d) => R().featureList(d).map(f => PASSIVES[lc(f.name)] ? {...PASSIVES[lc(f.name)](d), feature: f.name} : null).filter(Boolean);

	/** Options nested inside a subclass feature that need their own button. */
	const extraActions = (d) => {
		const sub = (cls) => d.classes.find(c => c.name === cls)?.subclass || "";
		return [
			/Zealot/i.test(sub("Barbarian")) ? {name: "Divine Fury", kind: "Subclass", act: "Passive", entries: ["While raging, the first creature you hit on each of your turns takes extra 1d6 + half your Barbarian level Necrotic or Radiant damage."]} : null,
			/Berserker/i.test(sub("Barbarian")) ? {name: "Frenzy", kind: "Subclass", act: "Passive", entries: ["If you use Reckless Attack while raging, the first Strength-based hit on your turn deals extra damage: d6s equal to your Rage Damage bonus."]} : null,
		].filter(Boolean);
	};

	/** The handler for a spell, feature or standard action, or null (generic handling). */
	const handlerFor = ({spell, feature, action}) => {
		if (spell) return SPELLS[lc(spell.name)] || null;
		if (feature) return FEATURES[lc(feature.name)] || null;
		if (action) return ACTIONS[lc(action.name)] || null;
		return null;
	};

	return {handlerFor, damageReactions, passivesOf, extraActions, ACTIONS, SPELLS, FEATURES, PASSIVES, DMG_TYPES};
})();
