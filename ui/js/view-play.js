"use strict";

/**
 * "Play" tab: a character as a live, clickable sheet for a session. Pick a character to start the session
 * (the character list hides until "End Session", which can add the session's XP to the character).
 * Everything the player does goes through one flow: ask first (slot, target, form, creature, option;
 * closing a menu spends nothing), then spend (slot, pool, uses, action economy), then apply (rolls,
 * healing, active effects, forms, summons). Numbers on the sheet always include what is active.
 */
globalThis.TBViewPlay = (() => {
	const {h, clear} = TBUI;
	const R = () => TBRules;
	const D = () => TBData;
	const P_ = () => TBPlay;
	const E_ = () => TBEffects;
	const S = {charId: null, session: false, actTab: "action", busy: false, again: false};
	const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);
	const fmt = (n) => Number(n || 0).toLocaleString("en-US");
	const lc = (s) => String(s ?? "").toLowerCase();

	const char = () => TBStore.char(S.charId);
	const save = (c, {derived = false} = {}) => {
		c.updatedAt = Date.now();
		if (derived) TBApp.charChanged(c); else TBStore.changed("char");
		render();
	};
	const saveDefault = (c, o) => save(c, o);

	// region Physical dice
	/** Ask the player for what their dice show. Resolves to a number (dice total), an array (d20s) or null. */
	const OUTCOMES = {attack: [["hit", "Hit"], ["crit", "Critical hit"], ["miss", "Miss"]], check: [["success", "Succeeded"], ["fail", "Failed"]]};
	/** "How did it go?" for a roll the app made (or a boosted roll): resolves to the outcome or null. */
	const askOutcome = (req) => new Promise((resolve) => {
		let done = false;
		const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
		const m = TBUI.modal({
			title: req.label || "How did it go?",
			body: h("div", {style: {padding: "14px 16px", width: "400px", display: "flex", flexDirection: "column", gap: "8px"}},
				req.text ? h("div", req.text) : req.total != null ? h("div", `Total: ${req.total}`) : null,
				h("div.muted", req.outcome === "attack" ? "Did it hit? (The DM knows the target's AC.)" : "Did it succeed? (The DM knows the DC.)")),
			footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel"), ...OUTCOMES[req.outcome || "check"].map(([v, l]) => h(`button.btn${v === "miss" || v === "fail" ? "" : ".primary"}`, {on: {click: () => finish(v)}}, l))],
			onClose: () => { if (!done) { done = true; resolve(null); } },
		});
	});
	const askDice = (req) => (req.kind === "outcome" ? askOutcome(req) : new Promise((resolve) => {
		let done = false;
		const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
		const inputs = req.kind === "d20"
			? Array.from({length: req.count}, (_, i) => h("input.pl-die", {type: "number", min: 1, max: 20, placeholder: req.count > 1 ? `d20 #${i + 1}` : "d20"}))
			: [h("input.pl-die", {type: "number", min: 0, placeholder: "total"})];
		/** The numbers typed (null when left blank and that's allowed); false when they're not valid. */
		const read = (allowBlank) => {
			if (allowBlank && inputs.every(i => i.value === "")) return null;
			const vals = inputs.map(i => Number(i.value));
			if (inputs.some(i => i.value === "") || vals.some(v => !Number.isFinite(v))) { TBUI.toast("Enter what the dice show.", {error: true}); return false; }
			if (req.kind === "d20" && vals.some(v => v < 1 || v > 20)) { TBUI.toast("A d20 shows 1 to 20.", {error: true}); return false; }
			return vals;
		};
		const ok = () => {
			const vals = read(false);
			if (vals === false) return;
			finish(req.kind === "d20" ? (req.outcome ? {vals, outcome: null} : vals) : vals[0]);
		};
		const pick = (outcome) => {
			const vals = read(!!req.optional);
			if (vals === false) return;
			finish({vals, outcome});
		};
		inputs.forEach(i => i.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); }));
		const what = req.kind === "d20"
			? `${req.count > 1 ? `Roll 2d20 (${req.mode === "adv" ? "Advantage: the higher counts" : "Disadvantage: the lower counts"}) and enter both.` : "Roll a d20 and enter it."}${req.bonus != null ? ` Your bonus: ${sg(req.bonus)}.` : ""}`
			: `Roll ${req.dice} and enter the total of the dice${req.flat ? ` (${sg(req.flat)} is added for you)` : ""}.`;
		const outs = req.kind === "d20" && req.outcome ? OUTCOMES[req.outcome] : null;
		const m = TBUI.modal({
			title: req.label || "Your roll",
			body: h("div", {style: {padding: "14px 16px", width: "420px", display: "flex", flexDirection: "column", gap: "10px"}},
				h("div", what), h("div.row", ...inputs),
				outs ? h("div.muted", {style: {fontSize: "12.5px"}}, req.optional ? "The number is optional: just say how it went." : req.decide ? "Enter the roll and say how it went (something depends on it)." : "Say how it went if you know (on a hit the damage is rolled; misses and failures can open options).") : null,
				req.notes && req.notes.length ? h("div.muted", {style: {fontSize: "12px"}}, req.notes.join(" · ")) : null),
			footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel"),
				...(outs && !req.decide ? [h("button.btn", {on: {click: ok}}, "OK")] : !outs ? [h("button.btn.primary", {on: {click: ok}}, "OK")] : []),
				...(outs || []).map(([v, l]) => h(`button.btn${v === "miss" || v === "fail" ? "" : ".primary"}`, {on: {click: () => pick(v)}}, l))],
			onClose: () => { if (!done) { done = true; resolve(null); } },
		});
		setTimeout(() => inputs[0].focus(), 30);
	}));
	P_().setDiceProvider(askDice);
	// endregion

	// region Menus used by effects (each resolves to the choice, or null when closed: nothing is spent)
	const menu = (title, options) => new Promise((resolve) => {
		let done = false;
		const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
		const m = TBUI.modal({
			title,
			body: h("div", {style: {padding: "14px 16px", width: "440px", display: "flex", flexDirection: "column", gap: "6px"}}, ...options.map(o => h("button.btn", {style: {justifyContent: "flex-start"}, on: {click: () => finish(o.value)}}, o.label))),
			footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel")],
			onClose: () => { if (!done) { done = true; resolve(null); } },
		});
	});
	const number = (title, def, min = 0, max = 9999) => new Promise((resolve) => {
		let done = false;
		const inp = h("input", {type: "number", min, max, value: def, style: {width: "120px", fontSize: "18px"}});
		const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
		const ok = () => { const n = Math.max(min, Math.min(max, Math.round(Number(inp.value) || 0))); finish(n || null); };
		inp.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); });
		const m = TBUI.modal({
			title,
			body: h("div", {style: {padding: "14px 16px", width: "380px"}}, inp),
			footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel"), h("button.btn.primary", {on: {click: ok}}, "OK")],
			onClose: () => { if (!done) { done = true; resolve(null); } },
		});
		setTimeout(() => inp.focus(), 30);
	});
	/** Pick spell slots to recover within a budget of slot levels: resolves to {level: count}. */
	const slotPicker = (title, slots, budget) => new Promise((resolve) => {
		let done = false;
		const picks = Object.fromEntries(slots.map(s => [s.level, 0]));
		const body = h("div", {style: {padding: "14px 16px", width: "420px"}});
		const used = () => Object.entries(picks).reduce((a, [lv, n]) => a + Number(lv) * n, 0);
		const fill = () => {
			clear(body);
			body.appendChild(h("div.muted", {style: {marginBottom: "8px"}}, `${used()} of ${budget} slot levels chosen`));
			slots.forEach(s => body.appendChild(h("div.row", {style: {marginBottom: "6px"}}, h("b", {style: {width: "90px"}}, `Level ${s.level}`),
				h("button.btn.small", {on: {click: () => { if (picks[s.level] > 0) { picks[s.level]--; fill(); } }}}, "−"),
				h("b", String(picks[s.level])),
				h("button.btn.small", {on: {click: () => { if (picks[s.level] < s.max && used() + s.level <= budget) { picks[s.level]++; fill(); } }}}, "+"),
				h("span.muted", `${s.max} spent`))));
		};
		const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
		fill();
		const m = TBUI.modal({title, body, footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel"), h("button.btn.primary", {on: {click: () => finish(used() ? picks : null)}}, "Recover")], onClose: () => { if (!done) { done = true; resolve(null); } }});
	});
	const ui = {menu, number, slotPicker};
	// endregion

	// region Helpers
	const pips = (max, used, onClick, {cls = ""} = {}) => h("span.pl-pips", {class: cls}, ...Array.from({length: max}, (_, i) => h("span.pip", {class: i < max - used ? "on" : "", title: i < max - used ? "Available (click to spend)" : "Spent (click to restore)", on: {click: () => onClick(i < max - used)}})));
	const rollBtn = (label, onClick, title) => h("button.btn.small.pl-roll", {title: title || `Roll ${label}`, on: {click: onClick}}, "🎲 ", label);
	const summary = (entries, n = 150) => D().summarize(entries || [], n);
	const markEconomy = (c, eco) => {
		const T = P_().stateOf(c).turn;
		if (!["action", "bonus", "reaction"].includes(eco)) return;
		if (T[eco]) TBUI.toast(`You already used your ${eco === "bonus" ? "Bonus Action" : eco === "reaction" ? "Reaction" : "Action"} this turn.`);
		T[eco] = true;
	};
	const ecoOfAct = (act) => (act === "Bonus Action" ? "bonus" : act === "Reaction" ? "reaction" : act === "Action" ? "action" : "");
	globalThis.ScaleCreature ||= {isCrInScaleRange: (mon) => { try { return Parser.isValidCr(mon.cr ? (mon.cr.cr || mon.cr) : null); } catch (e) { return false; } }};
	const blockModal = (title, mon) => {
		const frame = TBUI.fragFrame();
		Object.assign(frame.style, {width: "640px", height: "78vh", border: "0", display: "block"});
		TBUI.modal({title, body: h("div", {style: {display: "flex"}}, frame)});
		let html;
		try { html = `<table class="ve-w-100 ve-stats tb-stats">${Renderer.monster.getCompactRenderedString(mon, {isCompact: false, isShowScalers: false})}</table>`; } catch (e) { html = `<p>${e.message}</p>`; }
		frame.setContent(TBSan.clean(html));
	};
	const statBlockModal = async (key, title) => {
		const {byKey} = await P_().allMonsters();
		const mon = byKey.get(key);
		if (mon) blockModal(title || mon.name, mon);
	};
	const textModal = (title, entries) => {
		const frame = TBUI.fragFrame();
		Object.assign(frame.style, {width: "620px", height: "60vh", border: "0", display: "block"});
		TBUI.modal({title, body: h("div", {style: {display: "flex"}}, frame)});
		frame.setContent(TBSan.clean(Renderer.get().setFirstSection(true).render({type: "entries", entries: entries || []})));
	};
	const classLevelOf = (d, group) => (d.classes.find(c => c.name === group || c.subclass === group) || d.classes[0] || {}).level || d.totalLevel;
	/** What handlers get: the character, its numbers, menus, and ways to add effects and attack. */
	const ctxFor = (c, d, {slot = 0, via = null, spell = null} = {}) => ({
		char: c, d, ui, slot, spell: spell?.ent || null, cast: R().castFor(d, spell), dc: R().castFor(d, spell)?.dc ?? (8 + d.pb), derivedChanged: false,
		add: (ef) => P_().addEffect(c, ef, {via: via || ef.name}),
		attack: (a, o) => attack(c, d, a, o),
	});
	// endregion

	// region Rolling attacks (weapons, unarmed strikes, form attacks)
	const T_ = () => TBTriggers;
	/** Lets the trigger options cast, use features and ask, without spending anything when closed. */
	const triggerUi = {castSpell: (c, d, s) => castSpell(c, d, s), useFeature: (c, d, f) => useFeature(c, d, f), menu};
	/** Offer options one at a time ("Done" ends); resolves to an outcome when one of them changes it. */
	const optionsMenu = async (title, opts) => {
		const used = new Set();
		for (;;) {
			const left = opts.filter(o => !used.has(o.id));
			if (!left.length) return null;
			const pick = await menu(title, [...left.map(o => ({value: o.id, label: `${o.label}${o.desc ? ` — ${o.desc}` : ""}`})), {value: "__done", label: "Nothing more"}]);
			if (!pick || pick === "__done") return null;
			used.add(pick);
			const r = await left.find(o => o.id === pick).run(triggerUi);
			if (typeof r === "string") return r;
		}
	};
	/** Failed check or save: what can still turn it around; true when it now succeeds. */
	const afterFail = async (c, d, res, kind) => {
		const opts = T_().afterFail(c, d, res, kind);
		if (!opts.length) return false;
		const o = await optionsMenu(`${res.label || "Roll"}: failed — anything to change that?`, opts);
		return o === "success";
	};
	triggerUi.afterFail = afterFail;
	/**
	 * An attack roll: the outcome is asked for when something depends on it (smites, Sneak Attack, features that
	 * trigger on a hit or a miss, Vex…); damage is rolled on a hit (or when the outcome isn't known).
	 * Resolves to {outcome, crit} or false (canceled).
	 */
	const attack = async (c, d, a, {economy = true, spellAttack = false, damage = true} = {}) => {
		const P = P_().stateOf(c);
		const kind = `attack:${a.abil || "str"}`;
		const hitOpts = T_().afterHit(c, d, a, {spellAttack});
		const missOpts = T_().afterMiss(c, d, a, {total: null}, {spellAttack}).filter(o => o.id !== "insp");
		const decide = hitOpts.length > 0 || missOpts.length > 0 || /^vex|^graze/i.test(a.mastery || "") || !!T_().hasFeat(d, /^Studied Attacks$/i);
		const label = `${a.name} attack`;
		const r = await P_().test(c, label, a.bonus, kind, {sit: P.sit.attack || "", outcome: "attack", decide});
		if (!r) return false;
		// Effects that give Advantage on the next attack are used up by this one
		P.effects.filter(e => e.mods?.consumeOnAttack).forEach(e => P_().endEffect(c, e.id, "used on this attack"));
		let out = r.outcome;
		if (out === "miss") {
			const flipped = await optionsMenu(`${a.name}: a miss — anything to change that?`, T_().afterMiss(c, d, a, {...r, label, bonus: a.bonus}, {spellAttack}));
			if (flipped === "hit" || flipped === "crit") out = flipped;
		}
		if (economy) markEconomy(c, "action");
		if (out === "miss") { T_().applyMiss(c, d, a); return {outcome: "miss", crit: false}; }
		const crit = out === "crit" || r.nat === 20;
		const dm = /^([\dd+\- ]+)/.exec(a.damage || "");
		if (damage && dm) {
			const ex = P_().damageExtras(c, a);
			const rid = T_().hitRiders(c, d, a);
			const expr = `${dm[1]}${[...ex.dice.map(x => x.dice), ...rid.dice].map(x => (/^-/.test(x) ? x : `+${x}`)).join("")}${ex.flat + rid.flat ? sg(ex.flat + rid.flat) : ""}`;
			const dr = await P_().rollFor(c, expr, {crit, label: `${a.name} damage${crit ? " (critical: dice doubled)" : ""}`, for: "enemy"});
			if (dr) P_().log(c, `${a.name} damage: ${P_().shown(dr)}${crit ? " (critical)" : ""} ${a.damage.replace(dm[1], "").trim()}${out ? "" : " (if it hits)"}`, {notes: [...ex.names, ...rid.why].length ? [`includes ${[...ex.names, ...rid.why].join(", ")}`] : []});
		}
		if (out) {
			T_().applyHit(c, d, {...a, crit});
			const opts = T_().afterHit(c, d, {...a, crit}, {spellAttack});
			if (opts.length) await optionsMenu(`${a.name}: ${crit ? "critical hit" : "hit"}! Use something now?`, opts);
		}
		return {outcome: out, crit};
	};
	/** An action from the form's stat block: attack roll and damage, or the save it forces. */
	const formAct = async (c, d, fa) => {
		let crit = false;
		if (fa.hit != null) {
			const r = await P_().test(c, `${fa.name} (form) attack`, fa.hit, "attack:str", {outcome: "attack"});
			if (!r) return;
			crit = r.nat === 20 || r.outcome === "crit";
			if (r.outcome === "miss") { markEconomy(c, fa.eco); save(c); return; }
		}
		if (fa.dc != null) P_().log(c, `${fa.name}: DC ${fa.dc}${fa.save ? ` ${fa.save}` : ""} saving throw`);
		const ex = fa.hit != null ? P_().damageExtras(c, {abil: "str"}) : {dice: [], flat: 0, names: []};
		for (const [i, dmg] of fa.damage.entries()) {
			const expr = `${dmg.dice}${i === 0 ? ex.dice.map(x => (/^-/.test(x.dice) ? x.dice : `+${x.dice}`)).join("") + (ex.flat ? sg(ex.flat) : "") : ""}`;
			const dr = await P_().rollFor(c, expr, {crit, label: `${fa.name}: ${dmg.type || "damage"}`, for: "enemy"});
			if (!dr) return;
			P_().log(c, `${fa.name} damage: ${P_().shown(dr)} ${dmg.type}${crit ? " (critical)" : ""}`);
		}
		if (!fa.damage.length && fa.hit == null && fa.dc == null) P_().log(c, `${fa.name}`, {notes: [fa.text.slice(0, 200)]});
		markEconomy(c, fa.eco);
		save(c);
	};
	// endregion

	// region Spells, features and actions: ask, spend, apply
	const castSpell = async (c, d, s) => {
		const sp = s.ent;
		const P = P_().stateOf(c);
		// 1. Slot
		let opt = {kind: "cantrip", level: 0};
		if (sp.level) {
			opt = await new Promise((resolve) => {
				const opts = P_().castOptions(c, d, sp);
				let chosen = opts.find(o => o.ok);
				let done = false;
				const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
				const body = h("div", {style: {padding: "14px 16px", width: "460px", display: "flex", flexDirection: "column", gap: "6px"}},
					h("div.muted", {style: {marginBottom: "4px"}}, `${sp.name} is a level ${sp.level} spell${P_().isConc(sp) ? " (Concentration)" : ""}. Higher slots scale it where the spell allows.`),
					...opts.map(o => {
						const i = h("input", {type: "radio", name: "slot", checked: o === chosen, disabled: !o.ok});
						i.addEventListener("change", () => { chosen = o; });
						return h("label.chk", {style: {opacity: o.ok ? 1 : 0.5}}, i, o.label);
					}),
				);
				const m = TBUI.modal({title: `Cast ${sp.name}`, body, footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel"), h("button.btn.primary", {on: {click: () => finish(chosen)}}, "Next")], onClose: () => { if (!done) { done = true; resolve(null); } }});
			});
			if (!opt) return;
		}
		const slot = opt.level || sp.level;
		const x = ctxFor(c, d, {slot, via: sp.name, spell: s});
		// 2. Choices (closing any menu spends nothing)
		const hd = E_().handlerFor({spell: sp});
		let choice = true;
		if (hd?.prepare) { choice = await hd.prepare(x); if (choice == null) return; }
		const formSrc = P_().formSourceFor({spell: sp});
		let form = null;
		let summon = null;
		if (formSrc) { form = await pickForm(c, d, formSrc); if (!form) return; }
		else {
			const opts = await P_().summonOptions({spell: sp});
			if (opts) { summon = await pickSummon(c, d, opts, {level: slot}); if (!summon) return; }
		}
		const dice = hd?.noDice ? null : P_().spellDice(sp, slot, d.totalLevel);
		let healTarget = null;
		if (dice?.heal && !hd) { healTarget = await menu(`${sp.name}: who is healed?`, [{value: "self", label: "Yourself (applied to this sheet)"}, {value: "other", label: "Someone else (rolled and noted)"}]); if (!healTarget) return; }
		// 3. Spend
		if (opt.kind === "slot") P.slotsUsed[opt.level] = (P.slotsUsed[opt.level] || 0) + 1;
		if (opt.kind === "pact") P.pactUsed = (P.pactUsed || 0) + 1;
		markEconomy(c, P_().economyOf(sp));
		if (P_().isConc(sp)) {
			if (P.concentration && P.concentration.name !== sp.name) P_().endConcentration(c, `cast ${sp.name}`);
			P.concentration = {name: sp.name, level: slot};
		}
		P_().log(c, `Cast ${sp.name}${sp.level ? ` (${opt.kind === "slot" ? `level ${opt.level} slot` : opt.kind === "pact" ? `pact slot, level ${opt.level}` : opt.kind === "ritual" ? "ritual" : "no slot"})` : ""}`);
		// 4. Apply
		const cast = x.cast;
		let hit = null;
		if (sp.spellAttack && cast) {
			const res = await attack(c, d, {name: sp.name, bonus: cast.attack, abil: "spell", melee: (sp.spellAttack || []).includes("M"), props: ""}, {economy: false, spellAttack: true, damage: false});
			if (res) hit = res;
		}
		if (sp.savingThrow && cast) P_().log(c, `${sp.name}: targets make a DC ${cast.dc} ${sp.savingThrow.map(R().titleCase).join(" or ")} saving throw`);
		if (dice) {
			const mod = dice.addMod && cast ? cast.mod : 0;
			const self = dice.heal && healTarget === "self";
			if (hit?.outcome === "miss") {
				if (!sp.level && T_().hasFeat(d, /^Potent Cantrip$/i)) {
					const r = await P_().rollFor(c, `${dice.dice}${mod ? sg(mod) : ""}`, {label: `${sp.name}: ${dice.label} (Potent Cantrip: half)`, for: "enemy"});
					if (r) P_().log(c, `${sp.name}: Potent Cantrip — half of ${P_().shown(r)}${r.total != null ? ` = ${Math.floor(r.total / 2)}` : ""} ${dice.label.toLowerCase()}`);
				} else P_().log(c, `${sp.name}: missed, no damage`);
			} else {
				const r = await P_().rollFor(c, `${dice.dice}${mod ? sg(mod) : ""}`, {label: `${sp.name}: ${dice.label}${hit?.crit ? " (critical: dice doubled)" : ""}`, crit: !!hit?.crit, for: self ? "self" : "enemy"});
				if (r) {
					if (self) P_().heal(c, d, r.total);
					P_().log(c, `${sp.name} ${dice.label.toLowerCase()}: ${P_().shown(r)}${hit?.crit ? " (critical)" : ""}${dice.heal ? (self ? " → you" : " → target") : ""}${sp.savingThrow && !dice.heal ? " (half on a successful save, if the spell says so)" : ""}`);
				}
			}
		}
		await T_().afterCast(c, d, sp, opt, triggerUi);
		if (hd?.apply) await hd.apply(x, choice);
		if (form) P_().assumeForm(c, form.m, formSrc, form.rules);
		if (summon) P_().addSummon(c, d, summon.m, {via: sp.name, level: slot, variant: summon.variant, conc: P_().isConc(sp)});
		save(c, {derived: x.derivedChanged});
		return true;
	};

	const useFeature = async (c, d, f) => {
		const hd = E_().handlerFor({feature: f});
		const res = hd?.noPool ? null : P_().poolForFeature(d, f);
		if (res && !P_().remaining(c, res)) { TBUI.toast(`No ${res.name} left. Rest to recover.`, {error: true}); return; }
		const x = ctxFor(c, d, {via: f.name});
		// Choices first: closing a menu spends nothing
		let choice = true;
		if (hd?.prepare) { choice = await hd.prepare(x); if (choice == null) return; }
		const formSrc = P_().formSourceFor({feature: f});
		let form = null;
		let summon = null;
		let summonOpts = null;
		if (formSrc) { form = await pickForm(c, d, formSrc); if (!form) return; }
		else {
			summonOpts = await P_().summonOptions({feature: f});
			if (summonOpts) {
				const lvl = summonOpts.castSpell ? summonOpts.castSpell.level : classLevelOf(d, f.group);
				summon = await pickSummon(c, d, summonOpts, {level: lvl, classLevel: classLevelOf(d, f.group)});
				if (!summon) return;
			}
		}
		// Spend
		const cost = hd?.cost ? hd.cost(x, choice) : null;
		if (cost) {
			const pool = P_().resources(d).find(r => r.key === `pool:${cost.pool}`);
			if (!pool || !P_().spend(c, pool, cost.n)) { TBUI.toast(`Not enough ${pool ? pool.name : cost.pool}.`, {error: true}); return; }
		} else if (res) P_().spend(c, res, 1);
		markEconomy(c, hd?.eco === "free" ? "" : hd?.eco || ecoOfAct(f.act));
		P_().log(c, `Used ${f.name}${res ? ` (${P_().remaining(c, res)}/${res.max} ${res.name} left)` : ""}`, {notes: hd ? [] : [summary(f.entries, 160)]});
		// Apply
		if (hd?.apply) await hd.apply(x, choice);
		if (form) P_().assumeForm(c, form.m, formSrc, form.rules);
		if (summon) {
			const lvl = summonOpts.castSpell ? summonOpts.castSpell.level : classLevelOf(d, f.group);
			P_().addSummon(c, d, summon.m, {via: f.name, level: lvl, classLevel: classLevelOf(d, f.group), variant: summon.variant, endsOnLongRest: /Long Rest/i.test(JSON.stringify(f.entries || []))});
		}
		save(c, {derived: x.derivedChanged});
		return true;
	};

	const takeAction = async (c, d, a) => {
		const hd = E_().handlerFor({action: a});
		const x = ctxFor(c, d, {via: a.name});
		let choice = true;
		if (hd?.prepare) { choice = await hd.prepare(x); if (choice == null) return; }
		markEconomy(c, hd?.eco === "free" ? "" : "action");
		if (!hd?.prepare || !["hide", "search", "study", "influence", "escape a grapple"].includes(lc(a.name))) P_().log(c, `Took the ${a.name} action`);
		if (hd?.apply) await hd.apply(x, choice);
		save(c, {derived: x.derivedChanged});
	};

	/** Choose a form; resolves to {m, rules} or null (nothing spent). */
	const pickForm = (c, d, src) => new Promise(async (resolve) => {
		const rules = src.rules(d);
		const all = await P_().formCandidates(rules);
		let q = "";
		let done = false;
		const finish = (v) => { if (done) return; done = true; mo.close(); resolve(v); };
		const listEl = h("div.enc-list", {style: {maxHeight: "54vh"}});
		const fill = () => {
			clear(listEl);
			all.filter(m => !q || m.name.toLowerCase().includes(q)).slice(0, 300).forEach(m => listEl.appendChild(h("div.pl-row",
				h("span.nm", {on: {click: () => statBlockModal(m.key)}}, m.name, h("span.src", m.srcShort)),
				h("span.info", `CR ${m.crText}`),
				h("span.info", `HP ${m.ent.hp?.average ?? "?"} · AC ${(m.ent.ac || [])[0]?.ac ?? (m.ent.ac || [])[0] ?? "?"}`),
				h("button.btn.small.primary", {on: {click: () => finish({m, rules})}}, "Become"),
			)));
			if (!listEl.children.length) listEl.appendChild(h("div.pick-empty", {style: {padding: "10px"}}, "No creature fits these limits."));
		};
		const search = h("input", {type: "search", placeholder: "Search forms…", style: {width: "100%"}});
		search.addEventListener("input", () => { q = search.value.toLowerCase(); fill(); });
		const mo = TBUI.modal({
			title: `${src.name}: choose a form`,
			body: h("div", {style: {width: "640px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px"}}, h("div.muted", rules.note), search, listEl),
			footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel")],
			onClose: () => { if (!done) { done = true; resolve(null); } },
		});
		fill();
	});

	/** Choose the creature (and its variant) a summoning spell or feature brings; resolves to {m, variant} or null. */
	const pickSummon = (c, d, opts, {level, classLevel}) => new Promise((resolve) => {
		let q = "";
		let done = false;
		const finish = (v) => { if (done) return; done = true; mo.close(); resolve(v); };
		const listEl = h("div.enc-list", {style: {maxHeight: "50vh"}});
		const ctx = P_().summonContext(d, level, classLevel);
		const fill = () => {
			clear(listEl);
			opts.mons.filter(m => !q || m.name.toLowerCase().includes(q)).slice(0, 300).forEach(m => {
				const variants = P_().variantsOf(m);
				let variant = variants[0] || null;
				const info = h("span.info");
				const showStats = () => { const s = P_().scaleSummon(m, ctx, variant); info.textContent = `AC ${s.ac} · HP ${s.hp}`; };
				const sel = variants.length ? h("select", ...variants.map(v => h("option", {value: v}, v))) : null;
				if (sel) sel.addEventListener("change", () => { variant = sel.value; showStats(); });
				showStats();
				listEl.appendChild(h("div.pl-row",
					h("span.nm", {on: {click: () => { const s = P_().scaleSummon(m, ctx, variant); blockModal(s.mon.name, s.mon); }}}, m.name, h("span.src", D().sourceShort(m.source))),
					sel, info,
					h("button.btn.small.primary", {on: {click: () => finish({m, variant})}}, "Summon"),
				));
			});
		};
		const search = h("input", {type: "search", placeholder: "Search…", style: {width: "100%"}});
		search.addEventListener("input", () => { q = search.value.toLowerCase(); fill(); });
		const mo = TBUI.modal({
			title: `${opts.via}: summon`,
			body: h("div", {style: {width: "640px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px"}},
				h("div.muted", `Stats are worked out for ${opts.byClass && !opts.castSpell ? `class level ${ctx.classLevel}` : `spell level ${level}`}, with your spell attack ${sg(ctx.spellAttack)} and save DC ${ctx.spellDc}. Click a name for its stat block.`),
				opts.mons.length > 8 ? search : null, listEl),
			footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel")],
			onClose: () => { if (!done) { done = true; resolve(null); } },
		});
		fill();
	});

	const addItems = async (c, sv = saveDefault) => {
		const {all} = await R().loadItems();
		TBPickers.open({
			title: "Add items",
			prop: "item",
			multi: true,
			load: async () => all.filter(i => i.name),
			renderPreview: (e) => { try { return `<table class="ve-stats">${Renderer.item.getCompactRenderedString(e)}</table>`; } catch (x) { return `<h2>${TBBook.esc(e.name)}</h2>`; } },
			info: (e) => e.weapon ? "Weapon" : R().isArmorEnt(e) ? "Armor" : R().isShieldEnt(e) ? "Shield" : (e.rarity && e.rarity !== "none" ? e.rarity : ""),
			onPick: (e) => { P_().gearOf(c).items.push({name: e.name, source: e.source, qty: 1, equipped: false}); P_().log(c, `Added ${e.name} to the inventory`); },
			onClose: () => sv(c, {derived: true}),
		});
	};

	const useItem = async (c, d, it, ix) => {
		const e = it.ent;
		const healDice = P_().itemHealing(e);
		let target = "self";
		if (healDice) { target = await menu(`${e.name}: who drinks it?`, [{value: "self", label: "You"}, {value: "other", label: "Someone else"}]); if (!target) return; }
		const notes = [];
		if (healDice) {
			const r = await P_().rollFor(c, healDice, {label: `${e.name}: healing`, for: target === "self" ? "self" : "enemy"});
			if (!r) return;
			if (target === "self") P_().heal(c, d, r.total);
			notes.push(`${healDice}: ${P_().shown(r)}${target === "self" ? " → you" : " → someone else"}`);
		}
		const inv = P_().gearOf(c).items[ix];
		if (P_().isConsumableEnt(e)) {
			inv.qty = Math.max(0, (inv.qty || 1) - 1);
			if (!inv.qty) P_().gearOf(c).items.splice(ix, 1);
		}
		markEconomy(c, /^P\|?/.test(String(e.type || "")) || /^Potion/i.test(e.name) ? "bonus" : "action");
		P_().log(c, `Used ${it.name}`, {notes: [...notes, healDice ? "" : summary(e.entries, 140)].filter(Boolean)});
		save(c, {derived: true});
	};

	const endSession = async (c) => {
		const P = P_().stateOf(c);
		const xp = Number(P.sessionXp) || 0;
		const inp = h("input", {type: "number", min: 0, value: xp, style: {width: "120px"}});
		let done = false;
		const finish = (add) => {
			if (done) return;
			done = true;
			m.close();
			const n = Math.max(0, Number(inp.value) || 0);
			if (add && n) { TBLevel.addXp(c, n); P_().log(c, `Session ended: +${fmt(n)} XP`); } else P_().log(c, "Session ended");
			if (gearBox && gearBox.checked) { P_().applyGear(c); P_().log(c, `Character page updated: ${changes.lines.join("; ")}`); } else { if (changes.changed) P_().log(c, "Session inventory and coins discarded (character page unchanged)"); P_().dropGear(c); }
			P.sessionXp = 0;
			S.session = false;
			S.charId = null;
			syncNav();
			TBApp.charChanged(c);
			render();
			if (add && n) {
				const p = TBLevel.progress(c);
				TBUI.toast(`${c.name || "Character"}: ${fmt(p.xp)} XP${p.ready ? ` — ready for level ${p.level + 1}! Level up in the Characters tab.` : ""}`, {timeout: 9000});
			}
		};
		const p = TBLevel.progress(c);
		const changes = P_().gearChanges(c);
		const gearBox = changes.changed ? h("input", {type: "checkbox", checked: true}) : null;
		const m = TBUI.modal({
			title: "End session",
			body: h("div", {style: {padding: "14px 16px", width: "440px", display: "flex", flexDirection: "column", gap: "10px"}},
				h("div", `XP earned this session by ${c.name || "the character"}:`),
				h("div.row", inp, h("span.muted", "XP")),
				h("div.muted", {style: {fontSize: "13px"}}, `Now ${fmt(p.xp)} XP${p.to ? ` (level ${p.level + 1} at ${fmt(p.to)})` : ""}. Adding it updates the XP bar in the Characters tab; Level up becomes available there once the bar is full.`),
				changes.changed ? h("div.pl-gearchg",
					h("label.chk", gearBox, h("b", "Update the character page with this session's equipment and coins")),
					h("ul", ...changes.lines.map(l => h("li", l))),
					h("div.muted", {style: {fontSize: "12.5px"}}, "Unticked, the character page keeps what it had before the session."),
				) : h("div.muted", {style: {fontSize: "13px"}}, "No equipment or coin changes this session."),
			),
			footer: [h("button.btn", {on: {click: () => { done = true; m.close(); }}}, "Keep playing"), h("button.btn", {on: {click: () => finish(false)}}, "End without XP"), h("button.btn.primary", {on: {click: () => finish(true)}}, "Add XP and end")],
			onClose: () => { done = true; },
		});
	};
	// endregion

	// region Sections
	/** A stat with the player's bonus: total on top, how it is made underneath. */
	const adjBox = (c, label, key, natural, total, {suffix = "", signedV = false, onRoll = null, notes = []} = {}) => {
		const A = P_().stateOf(c).adjust;
		const bonus = Number(A[key]) || 0;
		const show = (v) => (signedV ? sg(v) : String(v)) + suffix;
		const edit = async (e) => {
			e.stopPropagation();
			const v = await TBUI.prompt(`${label}: your bonus (or penalty)`, String(bonus));
			if (v == null) return;
			A[key] = Number(String(v).replace(/[^-\d]/g, "")) || 0;
			P_().log(c, `${label} bonus set to ${sg(A[key])}`);
			save(c);
		};
		return h("div.pl-stat", {class: onRoll ? "click" : "", on: onRoll ? {click: onRoll} : {}},
			h("button.pl-edit", {title: `Change your ${label} bonus`, on: {click: edit}}, "✎"),
			h("div.v", show(total)),
			h("div.l", label + (onRoll ? " · roll" : "")),
			h("div.s", [`natural ${show(natural)}`, ...notes, bonus ? `${sg(bonus)} bonus` : ""].filter(Boolean).join(" · ")),
		);
	};

	/** Spellcasting ability box: the main ability with its DC and attack; other sources underneath. */
	const spellBox = (d) => {
		const sc = d.spellcasting;
		const others = d.spellSources || [];
		const tip = [sc ? `${sc.source}: ${sc.abilityName}, save DC ${sc.dc}, spell attack ${sg(sc.attack)}` : "No spellcasting", ...others.map(o => `${o.source}: ${o.abilityName}, save DC ${o.dc}, spell attack ${sg(o.attack)} (${o.spells.join(", ")})`)].join("\n");
		return h("div.pl-stat.pl-cast", {title: tip},
			h("div.v", sc ? sc.abbr : "—"),
			h("div.l", "Spellcasting"),
			h("div.s", sc ? `DC ${sc.dc} · attack ${sg(sc.attack)}` : "no spells"),
			...others.map(o => h("div.s.alt", `${o.abbr} DC ${o.dc} · ${o.source}`)),
		);
	};

	const header = (c, d) => {
		const P = P_().stateOf(c);
		const initRoll = async () => { await P_().test(c, "Initiative", d.initiative, "init"); save(c); };
		const DICE_MODES = [
			{value: "app", label: "🎲 The app rolls the dice", log: "The app rolls the dice"},
			{value: "all", label: "🎲 I roll my own dice (the app asks for every result)", log: "Rolling physical dice: the app asks for each result"},
			{value: "some", label: "🎲 I roll my own dice (the app only asks for some rolls)", log: "Rolling physical dice: the app asks only for rolls that change the sheet or trigger something"},
		];
		const phys = h("select.pl-phys-sel", {title: "Who rolls: with \"some rolls\", damage you deal and checks that change nothing here aren't asked for"}, ...DICE_MODES.map(o => h("option", {value: o.value, selected: o.value === (P.physical === "some" ? "some" : P.physical ? "all" : "app")}, o.label)));
		phys.addEventListener("change", () => { P.physical = phys.value === "some" ? "some" : phys.value === "all"; P_().log(c, DICE_MODES.find(o => o.value === phys.value).log); save(c); });
		return h("div.pl-head",
			h("div.grow",
				h("div.pl-name", d.name),
				h("div.pl-line", `Level ${d.totalLevel} · ${d.classes.map(x => `${x.subclass ? x.subclass + " " : ""}${x.name} ${x.level}`).join(" / ")}${d.species ? ` · ${d.species}` : ""}`),
				h("div.pl-phys", phys),
			),
			adjBox(c, "Armor Class", "ac", d.natural.ac, d.ac, {notes: d.notes.ac}),
			adjBox(c, "Initiative", "init", d.natural.initiative, d.initiative, {signedV: true, onRoll: initRoll}),
			adjBox(c, "Speed", "speed", d.natural.speed, d.speed, {suffix: " ft.", notes: [...d.notes.speed, d.fly ? `fly ${d.fly} ft.` : ""].filter(Boolean)}),
			adjBox(c, "Proficiency", "pb", d.natural.pb, d.pb, {signedV: true}),
			spellBox(d),
			h("div.pl-insp", {class: P.inspiration ? "on" : "", title: "Heroic Inspiration: reroll any die (click to toggle)", on: {click: () => { P.inspiration = !P.inspiration; P_().log(c, P.inspiration ? "Gained Heroic Inspiration" : "Heroic Inspiration removed"); save(c); }}}, h("div.v", "★"), h("div.l", "Heroic Inspiration")),
			h("div.pl-rest",
				h("button.btn", {on: {click: () => shortRestModal(c, d)}}, "☾ Short rest"),
				h("button.btn", {on: {click: async () => { if (await TBUI.confirm("Long rest", "Restore all HP, Hit Point Dice, spell slots and features, end active effects, and lower Exhaustion by 1?", {okLabel: "Long rest"})) { P_().longRest(c, d); save(c); } }}}, "☀ Long rest"),
				h("button.btn.danger", {title: "Finish the session and add its XP to the character", on: {click: () => endSession(c)}}, "⏹ End session"),
			),
		);
	};

	// region Phone layout
	const PHONE_TABS = [["act", "Act"], ["spells", "Spells"], ["stats", "Stats"], ["gear", "Gear"], ["log", "Log"]];
	const goTab = (t) => { S.mTab = t; S.mTop = true; render(); };
	/** "⋯" on the strip: who rolls, Heroic Inspiration, rests, End session. */
	const phoneMenu = async (c, d) => {
		const P = P_().stateOf(c);
		const mode = P.physical === "some" ? "some" : P.physical ? "all" : "app";
		const v = await menu("Session", [
			{value: "dice:app", label: `${mode === "app" ? "● " : ""}The app rolls the dice`},
			{value: "dice:all", label: `${mode === "all" ? "● " : ""}I roll my own dice (every result)`},
			{value: "dice:some", label: `${mode === "some" ? "● " : ""}I roll my own dice (only some rolls)`},
			{value: "insp", label: P.inspiration ? "★ Use or remove Heroic Inspiration" : "☆ Gain Heroic Inspiration"},
			{value: "short", label: "☾ Short rest"},
			{value: "long", label: "☀ Long rest"},
			{value: "end", label: "⏹ End session"},
		]);
		if (!v) return;
		if (v.startsWith("dice:")) {
			const m = v.slice(5);
			P.physical = m === "some" ? "some" : m === "all";
			P_().log(c, m === "app" ? "The app rolls the dice" : m === "all" ? "Rolling physical dice: the app asks for each result" : "Rolling physical dice: the app asks only for rolls that change the sheet or trigger something");
			save(c);
		} else if (v === "insp") { P.inspiration = !P.inspiration; P_().log(c, P.inspiration ? "Gained Heroic Inspiration" : "Heroic Inspiration removed"); save(c); }
		else if (v === "short") shortRestModal(c, d);
		else if (v === "long") { if (await TBUI.confirm("Long rest", "Restore all HP, Hit Point Dice, spell slots and features, end active effects, and lower Exhaustion by 1?", {okLabel: "Long rest"})) { P_().longRest(c, d); save(c); } }
		else if (v === "end") endSession(c);
	};
	/** Always on top: HP (tap for the HP controls), AC, Speed, Initiative, spellcasting, the turn, and what's active. */
	const phoneHead = (c, d) => {
		const P = P_().stateOf(c);
		const T = P.turn;
		const cur = P_().currentHp(c, d);
		const pct = Math.max(0, Math.min(100, cur / d.hp * 100));
		const tempPct = Math.max(0, Math.min(100 - pct, (P.temp || 0) / d.hp * 100));
		const pip = (k, l) => h("button.pm-pip", {class: T[k] ? "used" : "", title: "Tap to toggle", on: {click: () => { T[k] = !T[k]; save(c); }}}, l);
		const chips = [
			...(P.form ? [`Form: ${P.form.name}`] : []),
			...(P.concentration ? [`Conc.: ${P.concentration.name}`] : []),
			...P.effects.map(e => `${e.name}${e.rounds ? ` ${e.rounds >= 10 ? `${Math.round(e.rounds / 10)}m` : `${e.rounds}r`}` : ""}`),
			...[...P.conditions, ...(d.effectConditions || [])].map(x => R().titleCase(x)),
			...(P.exhaustion ? [`Exhaustion ${P.exhaustion}`] : []),
			...(P.inspiration ? ["★ Inspiration"] : []),
		];
		const sc = d.spellcasting;
		return h("div.pm-head",
			h("div.pm-r1", h("b.pm-name", d.name), h("span.pm-round", `Round ${T.round}`), h("button.btn.ghost.small.pm-more", {title: "Dice, rests, End session", on: {click: () => phoneMenu(c, d)}}, "⋯")),
			h("div.pm-r2",
				h("button.pm-hp", {on: {click: () => goTab("stats")}}, h("b", `${cur}`), `/${d.hp}`, P.temp ? h("span.pm-temp", ` +${P.temp}`) : null),
				h("span", h("small", "AC "), h("b", String(d.ac))),
				h("span", h("b", String(d.speed)), h("small", " ft")),
				h("button.pm-init", {on: {click: async () => { await P_().test(c, "Initiative", d.initiative, "init"); save(c); }}}, h("small", "Init "), h("b", sg(d.initiative))),
				sc ? h("span", h("b", sc.abbr), h("small", ` DC ${sc.dc}`)) : null,
			),
			h("div.pm-bar", h("i", {style: {width: `${pct}%`}}), tempPct ? h("i.t", {style: {width: `${tempPct}%`}}) : null),
			h("div.pm-eco", pip("action", "Action"), pip("bonus", "Bonus"), pip("reaction", "Reaction"), h("div.spacer"), h("button.btn.small", {on: {click: () => { P_().nextTurn(c); save(c); }}}, "Next turn ▶")),
			chips.length ? h("div.pm-chips", ...chips.map(x => h("button.pm-chip", {on: {click: () => goTab("act")}}, x))) : null,
		);
	};
	/** The phone's Stats tab: the player's bonuses on AC, Initiative, Speed and Proficiency, and spellcasting. */
	const phoneStats = (c, d) => h("div.pm-stats",
		adjBox(c, "Armor Class", "ac", d.natural.ac, d.ac, {notes: d.notes.ac}),
		adjBox(c, "Initiative", "init", d.natural.initiative, d.initiative, {signedV: true, onRoll: async () => { await P_().test(c, "Initiative", d.initiative, "init"); save(c); }}),
		adjBox(c, "Speed", "speed", d.natural.speed, d.speed, {suffix: " ft.", notes: d.notes.speed}),
		adjBox(c, "Proficiency", "pb", d.natural.pb, d.pb, {signedV: true}),
		spellBox(d),
	);
	const phonePage = async (c, d, formMon) => {
		const tab = S.mTab || "act";
		const content = {
			act: [formCard(c, d, formMon), companionsCard(c), await actionsCard(c, d, {filter: "nospells", stacked: true}), effectsCard(c, d)],
			spells: [resourcesCard(c, d), await actionsCard(c, d, {filter: "spells", stacked: true})],
			stats: [hpCard(c, d), phoneStats(c, d), abilitiesCard(c, d), conditionsCard(c)],
			gear: [inventoryCard(c, d), sessionCard(c)],
			log: [logCard(c, d)],
		}[tab];
		const body = h("div.pl-body.pm-body", h("div.pl-col", ...content.filter(Boolean)));
		// Swipe left / right to change tabs
		let sx = null;
		let sy = null;
		body.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, {passive: true});
		body.addEventListener("touchend", (e) => {
			if (sx == null) return;
			const dx = e.changedTouches[0].clientX - sx;
			const dy = e.changedTouches[0].clientY - sy;
			sx = null;
			if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
			const i = PHONE_TABS.findIndex(([k]) => k === tab);
			const n = PHONE_TABS[i + (dx < 0 ? 1 : -1)];
			if (n) goTab(n[0]);
		});
		return h("div.char-main.pm", phoneHead(c, d),
			h("div.pm-tabs", ...PHONE_TABS.map(([k, l]) => h("button", {class: k === tab ? "active" : "", on: {click: () => goTab(k)}}, l))),
			body);
	};
	// endregion

	const shortRestModal = (c, d) => {
		const body = h("div", {style: {padding: "14px 16px", width: "420px"}});
		const fill = () => {
			clear(body);
			const P = P_().stateOf(c);
			body.appendChild(h("div", {style: {marginBottom: "8px"}}, `HP ${P_().currentHp(c, d)}/${d.hp}. Spend Hit Point Dice to heal (each: die + CON ${sg(d.mods.con)}).`));
			P_().hitDice(d).forEach(hd => {
				const left = hd.n - (P.hdSpent[hd.die] || 0);
				body.appendChild(h("div.row", {style: {marginBottom: "6px"}}, h("b", {style: {width: "60px"}}, hd.die), h("span.grow", `${left}/${hd.n} left`), h("button.btn.small", {disabled: !left, on: {click: async () => { await P_().spendHitDie(c, d, hd.die); TBStore.changed("char"); fill(); }}}, "Spend one")));
			});
		};
		fill();
		const m = TBUI.modal({title: "Short rest", body, footer: [h("button.btn", {on: {click: () => { m.close(); render(); }}}, "Cancel"), h("button.btn.primary", {on: {click: () => { P_().shortRest(c, d); m.close(); save(c); }}}, "Finish short rest")]});
	};

	const hpCard = (c, d) => {
		const P = P_().stateOf(c);
		const cur = P_().currentHp(c, d);
		const amt = h("input", {type: "number", min: 0, placeholder: "0", style: {width: "70px"}});
		const typeSel = h("select", {title: "Damage type: resistances halve it automatically"}, h("option", {value: ""}, "type…"), ...E_().DMG_TYPES.map(t => h("option", {value: t}, R().titleCase(t))));
		const reactions = E_().damageReactions(d);
		const reactChecks = reactions.map(r => ({r, i: h("input", {type: "checkbox"})}));
		const val = () => Math.max(0, Number(amt.value) || 0);
		const takeDamage = async () => {
			let n = val();
			const notes = [];
			const t = typeSel.value;
			const resisted = t && d.resist.map(lc).includes(t);
			if (resisted) { n = Math.floor(n / 2); notes.push(`Resistance to ${R().titleCase(t)}: halved`); }
			for (const {r, i} of reactChecks) {
				if (!i.checked) continue;
				if (r.halve) { n = Math.floor(n / 2); notes.push(`${r.label.replace(/^½ /, "")}: halved`); }
				if (r.reduce) { const x = await P_().rollFor(c, r.reduce, {label: `${r.label}: damage reduction`}); if (x) { n = Math.max(0, n - x.total); notes.push(`${r.label}: −${x.total}`); } }
				markEconomy(c, "reaction");
			}
			notes.forEach(x => P_().log(c, x));
			const P = P_().stateOf(c);
			P_().damage(c, d, n).filter(x => !/^Concentration save/.test(x)).forEach(x => TBUI.toast(x));
			// Concentration: a Constitution save (DC 10 or half the damage); a failure ends the spell
			if (P.concentration && n > 0 && P_().currentHp(c, d) > 0) {
				const dc = Math.min(30, Math.max(10, Math.floor(n / 2)));
				const war = !!T_().hasFeat(d, /^War Caster$/i);
				const r = await P_().test(c, `Concentration on ${P.concentration.name} (Constitution save)`, d.saves.con.bonus, "save:con", {outcome: "check", dc, base: war ? "adv" : "normal"});
				if (r && !r.ok && !(await afterFail(c, d, {...r, label: "Concentration save", bonus: d.saves.con.bonus}, "save:con"))) P_().endConcentration(c, "failed the Concentration save");
			} else if (P.concentration && n > 0) P_().endConcentration(c, "dropped to 0 Hit Points");
			save(c);
		};
		const pct = Math.max(0, Math.min(100, cur / d.hp * 100));
		const death = cur === 0 ? h("div.pl-death",
			h("div", h("b", "Death saves "), "Successes ", pips(3, 3 - P.death.s, (on) => { P.death.s = Math.max(0, Math.min(3, P.death.s + (on ? 1 : -1))); save(c); }, {cls: "good"}), " Failures ", pips(3, 3 - P.death.f, (on) => { P.death.f = Math.max(0, Math.min(3, P.death.f + (on ? 1 : -1))); save(c); }, {cls: "bad"})),
			rollBtn("Death save", async () => {
				const r = await P_().d20For(c, "normal", "Death saving throw");
				if (!r) return;
				let txt;
				if (r.nat === 20) { P_().heal(c, d, 1); txt = "natural 20: back up with 1 HP!"; } else if (r.nat === 1) { P.death.f = Math.min(3, P.death.f + 2); txt = "natural 1: two failures"; } else if (r.nat >= 10) { P.death.s = Math.min(3, P.death.s + 1); txt = "success"; } else { P.death.f = Math.min(3, P.death.f + 1); txt = "failure"; }
				if (P.death.s >= 3) txt += " — stable";
				if (P.death.f >= 3) txt += " — dead";
				P_().log(c, `Death save: ${r.nat} (${txt})`);
				save(c);
			}),
		) : null;
		return h("div.card.pl-card", h("div.card-h", h("h3", "Hit Points")), h("div.card-b",
			h("div.pl-hp",
				h("div.big", h("b", String(cur)), h("span", ` / ${d.hp}`), P.temp ? h("span.temp", ` +${P.temp} temp`) : null),
				d.notes.hp.length ? h("div.muted", {style: {fontSize: "12px"}}, d.notes.hp.join(" · ")) : null,
				h("div.bar", h("div.fill", {style: {width: `${pct}%`}, class: pct <= 50 ? "bloodied" : ""}), P.temp ? h("div.tempbar", {style: {width: `${Math.min(100, P.temp / d.hp * 100)}%`}}) : null),
				pct <= 50 && cur > 0 ? h("div.muted", {style: {fontSize: "12.5px"}}, "Bloodied") : null,
			),
			h("div.row", {style: {flexWrap: "wrap", marginTop: "8px"}},
				amt, typeSel,
				h("button.btn.small.danger", {on: {click: takeDamage}}, "− Damage"),
				h("button.btn.small", {on: {click: () => { P_().heal(c, d, val()); save(c); }}}, "+ Heal"),
				h("button.btn.small", {on: {click: () => { P_().addTemp(c, val()); save(c); }}}, "+ Temp HP"),
			),
			reactChecks.length ? h("div.row", {style: {flexWrap: "wrap", marginTop: "4px", fontSize: "12.5px"}}, h("span.muted", "Reactions:"), ...reactChecks.map(({r, i}) => h("label.chk", i, r.label))) : null,
			d.resist.length ? h("div.muted", {style: {fontSize: "12px", marginTop: "4px"}}, `Resistant to ${d.resist.join(", ")}`) : null,
			death,
			h("div.pl-sub", h("b", "Hit Point Dice "), ...P_().hitDice(d).map(hd => h("span.pl-hd", `${hd.die}: `, pips(hd.n, P.hdSpent[hd.die] || 0, async (on) => {
				if (on) await P_().spendHitDie(c, d, hd.die);
				else P.hdSpent[hd.die] = Math.max(0, (P.hdSpent[hd.die] || 0) - 1);
				save(c);
			})))),
		));
	};

	const abilitiesCard = (c, d) => {
		const P = P_().stateOf(c);
		const sitIn = (key, ph) => {
			const i = h("input.pl-sit", {type: "text", placeholder: ph || "±", value: P.sit[key] || "", title: "Situational bonus for this roll: +2, -1, 1d4…"});
			i.addEventListener("change", () => { const v = i.value.trim(); if (v) P.sit[key] = v; else delete P.sit[key]; TBStore.changed("char"); });
			return i;
		};
		const formAbil = P.form ? new Set(P.form.via === "Wild Shape" || P.form.keepMental ? ["str", "dex", "con"] : R().ABILS) : new Set();
		const abil = h("div.pl-abils", ...R().ABILS.map(a => h("div.pl-abil", {class: formAbil.has(a) ? "form" : ""},
			h("div.n", a.toUpperCase()),
			h("div.m", {title: "Ability check", on: {click: async () => { await P_().test(c, `${R().ABIL_NAMES[a]} check`, d.mods[a], `check:${a}`, {sit: P.sit[`chk:${a}`] || ""}); save(c); }}}, sg(d.mods[a])),
			h("div.s", String(d.scores[a])),
			h("div.sv", {class: d.saves[a].prof ? "prof" : "", title: "Saving throw", on: {click: async () => { await P_().test(c, `${R().ABIL_NAMES[a]} save`, d.saves[a].bonus, `save:${a}`, {sit: P.sit[`save:${a}`] || P.sit.save || ""}); save(c); }}}, `Save ${sg(d.saves[a].bonus)}`),
		)));
		const skills = h("div.pl-skills", ...R().SKILL_LIST.map(s => {
			const k = d.skills[s];
			const boosts = P.effects.filter(ef => Object.keys(ef.mods?.dice || {}).some(key => P_().keyMatches(key, `check:${k.ability}:${s}`))).map(ef => ef.name);
			return h("div.pl-skill",
				h("span.dot", {class: k.exp ? "exp" : k.prof ? "prof" : ""}),
				h("span.grow.nm", {on: {click: async () => { await P_().test(c, R().titleCase(s), k.bonus, `check:${k.ability}:${s}`, {sit: P.sit[`skill:${s}`] || ""}); save(c); }}}, R().titleCase(s), h("span.muted", ` ${k.ability.toUpperCase()}`), boosts.length ? h("span.pl-boost", ` +${boosts.join(", ")}`) : null),
				h("b", sg(k.bonus)),
				sitIn(`skill:${s}`),
			);
		}));
		const advSel = h("div.pl-adv", ...[["dis", "Disadvantage"], ["normal", "Normal"], ["adv", "Advantage"]].map(([v, l]) => h("span.chip", {class: P.adv === v ? "on" : "", on: {click: () => { P.adv = v; save(c); }}}, l)));
		return h("div.card.pl-card", h("div.card-h", h("h3", "Abilities & Skills"), h("div.spacer"), advSel), h("div.card-b",
			abil,
			P.form ? h("div.muted", {style: {fontSize: "12.5px", marginTop: "4px"}}, `Highlighted scores come from the ${P.form.name} form.`) : null,
			h("div.row", {style: {margin: "6px 0", fontSize: "12.5px"}}, h("span.muted.grow", "Click a modifier, save or skill to roll; active effects (Bless, Guidance…) and conditions are applied for you. The small box adds anything else."), h("span.muted", "All saves:"), sitIn("save", "±")),
			skills,
			h("div.pl-sub", `Passive Perception ${d.passive.perception} · Insight ${d.passive.insight} · Investigation ${d.passive.investigation}`),
		));
	};

	const conditionsCard = (c) => {
		const P = P_().stateOf(c);
		const toggle = (x) => { const i = P.conditions.indexOf(x); if (i >= 0) P.conditions.splice(i, 1); else P.conditions.push(x); P_().log(c, `${R().titleCase(x)} ${i >= 0 ? "removed" : "applied"}`); save(c); };
		return h("div.card.pl-card", h("div.card-h", h("h3", "Conditions")), h("div.card-b",
			h("div.picker-chips", ...P_().CONDITIONS.map(x => h("span.chip", {class: P.conditions.includes(x) ? "on bad" : "", on: {click: () => toggle(x)}}, R().titleCase(x)))),
			h("div.row", {style: {marginTop: "8px"}}, h("b", "Exhaustion"),
				h("button.btn.small", {on: {click: () => { P.exhaustion = Math.max(0, P.exhaustion - 1); save(c); }}}, "−"),
				h("b", String(P.exhaustion)),
				h("button.btn.small", {on: {click: () => { P.exhaustion = Math.min(6, P.exhaustion + 1); save(c); }}}, "+"),
				h("span.muted", {style: {fontSize: "12.5px"}}, P.exhaustion ? `Applied: −${2 * P.exhaustion} on d20 tests, Speed −${5 * P.exhaustion} ft.${P.exhaustion >= 6 ? " — death" : ""}` : "Each level: −2 to d20 tests, −5 ft. Speed (applied for you)"),
			),
		));
	};

	const turnBar = (c) => {
		const T = P_().stateOf(c).turn;
		const pip = (k, l) => h("span.pl-eco", {class: T[k] ? "used" : "", title: "Click to toggle", on: {click: () => { T[k] = !T[k]; save(c); }}}, l);
		return h("div.pl-turn",
			h("b", `Round ${T.round}`),
			pip("action", "Action"), pip("bonus", "Bonus Action"), pip("reaction", "Reaction"),
			h("div.spacer"),
			h("button.btn.small", {title: "Start of your next turn: refreshes your actions, ends effects that last until then and counts down durations", on: {click: () => { P_().nextTurn(c); save(c); }}}, "Next turn ▶"),
			h("button.btn.ghost.small", {title: "End of combat", on: {click: () => { Object.assign(T, {action: false, bonus: false, reaction: false, round: 1}); save(c); }}}, "Reset"),
		);
	};

	/** Everything usable, grouped by the action it takes (a form's own actions first while shape-shifted). */
	const actionsCard = async (c, d, {filter = null, stacked = false} = {}) => {
		const P = P_().stateOf(c);
		const groups = {action: [], bonus: [], reaction: [], other: []};
		const spellGroups = {action: [], bonus: [], reaction: [], other: []};
		const mark = {};
		const conds = [...P.conditions, ...d.effectConditions];
		const disabled = conds.some(x => (P_().COND_FX[x] || {}).noActions);
		const summonTag = async (o) => ((await P_().summonOptions(o)) ? h("span.tag.form", "Summon") : null);
		const autoTag = (o) => (E_().handlerFor(o) ? h("span.tag.auto", {title: "Applied to the sheet for you"}, "Auto") : null);

		(d.formActions || []).forEach(fa => groups[fa.eco === "bonus" ? "bonus" : fa.eco === "reaction" ? "reaction" : "action"].push(h("div.pl-act.formact",
			h("div.grow", h("div.t", {title: fa.text}, fa.name, h("span.tag.form", P.form.name)), h("div.d", [fa.hit != null ? `${sg(fa.hit)} to hit` : "", fa.damage.map(x => `${x.dice} ${x.type}`).join(" + "), fa.dc != null ? `DC ${fa.dc}${fa.save ? ` ${fa.save}` : ""}` : "", !fa.hit && !fa.damage.length && fa.dc == null ? fa.text.slice(0, 110) : ""].filter(Boolean).join(" · "))),
			h("button.btn.small.primary", {disabled, on: {click: () => formAct(c, d, fa)}}, fa.hit != null ? "Attack" : "Use"),
		)));
		d.attacks.forEach(a => groups.action.push(h("div.pl-act",
			h("div.grow", h("div.t", a.name, h("span.tag", "Attack")), h("div.d", `${sg(a.bonus)} to hit · ${a.damage}${a.versatile ? ` (${a.versatile} two-handed)` : ""}${a.mastery ? ` · Mastery: ${a.mastery}` : ""}${P_().damageExtras(c, a).names.length ? ` · +${P_().damageExtras(c, a).names.join(", ")}` : ""}`)),
			h("button.btn.small.primary", {disabled, on: {click: async () => { await attack(c, d, a); save(c); }}}, "Attack"),
		)));
		// Sneak Attack: once per turn, rolled on demand
		const sneak = d.classes.find(x => x.name === "Rogue");
		if (sneak && !P.form) {
			const sc = (sneak.cols || []).find(x => /^Sneak Attack$/i.test(x.label));
			const dice = sc ? sc.values[sneak.level - 1] : null;
			if (dice) groups.other.unshift(h("div.pl-act", h("div.grow", h("div.t", "Sneak Attack", h("span.tag.feat", "Once per turn")), h("div.d", `${dice} extra damage on a hit with Advantage (or an ally next to the target), Finesse or ranged weapon`)), h("button.btn.small.primary", {on: {click: async () => { const r = await P_().rollFor(c, dice, {label: "Sneak Attack", for: "enemy"}); if (r) { P_().stateOf(c).turn.once.sneak = true; P_().log(c, `Sneak Attack: ${P_().shown(r)}`); save(c); } }}}, "Roll")));
		}
		Object.keys(groups).forEach(k => { mark[k] = groups[k].length; });
		if (d.canCast) {
			for (const s of d.spells) {
				const m = D().spellMeta(s.ent);
				const eco = P_().economyOf(s.ent);
				const g = eco === "long" ? "other" : eco;
				const can = !s.ent.level || P_().castOptions(c, d, s.ent).some(o => o.ok && (o.kind === "slot" || o.kind === "pact"));
				const cf = R().castFor(d, s);
				const nums = cf ? [s.ent.spellAttack ? `attack ${sg(cf.attack)}` : "", s.ent.savingThrow ? `DC ${cf.dc}` : ""].filter(Boolean).join(", ") : "";
				spellGroups[g].push(h("div.pl-act",
					h("div.grow", h("div.t", {on: {click: () => textModal(s.ent.name, [...(s.ent.entries || []), ...(s.ent.entriesHigherLevel || [])])}}, s.ent.name, h("span.tag.spell", s.ent.level ? `L${s.ent.level}` : "Cantrip"), P_().isConc(s.ent) ? h("span.tag", "C") : null, P_().formSourceFor({spell: s.ent}) ? h("span.tag.form", "Form") : await summonTag({spell: s.ent}), autoTag({spell: s.ent}), s.altAbility && cf ? h("span.tag.abil", {title: `${s.via}: cast with ${cf.abilityName}`}, `uses ${cf.abbr}`) : null),
						h("div.d", `${m.timeShort} · ${m.range} · ${m.duration}${nums ? ` · ${nums}` : ""}${can ? "" : " · no slots left"}`)),
					h("button.btn.small", {class: can ? "primary" : "", disabled, on: {click: () => castSpell(c, d, s)}}, "Cast"),
				));
			}
		} else if (d.spells.length) spellGroups.other.unshift(h("div.pick-empty", `No spellcasting in the ${P.form?.name || "current"} form.`));
		for (const f of [...R().featureList(d).filter(x => x.act !== "Passive" || x.uses || E_().handlerFor({feature: x})), ...E_().extraActions(d)]) {
			const hd = E_().handlerFor({feature: f});
			const res = hd?.noPool ? null : P_().poolForFeature(d, f);
			const left = res ? P_().remaining(c, res) : null;
			const eco = hd?.eco === "free" ? "other" : hd?.eco || ecoOfAct(f.act) || "other";
			groups[eco].push(h("div.pl-act",
				h("div.grow", h("div.t", {on: {click: () => textModal(f.name, f.entries)}}, f.name, h("span.tag.feat", f.kind), P_().formSourceFor({feature: f}) ? h("span.tag.form", "Form") : await summonTag({feature: f}), autoTag({feature: f})), h("div.d", res ? `${left}/${res.max} ${res.name}` : (f.uses || summary(f.entries, 90)))),
				h("button.btn.small", {class: !res || left ? "primary" : "", disabled: disabled || (res && !left), on: {click: () => useFeature(c, d, f)}}, "Use"),
			));
		}
		d.items.forEach((it, ix) => {
			const e = it.ent;
			if (!e || P.form) return;
			const charges = P_().itemCharges(e);
			const consumable = P_().isConsumableEnt(e);
			if (!consumable && !(charges && it.equipped)) return;
			const eco = /^P\|?/.test(String(e.type || "")) || /^Potion/i.test(e.name) ? "bonus" : "action";
			const used = P.itemCharges[`${e.name}|${e.source}`] || 0;
			groups[eco].push(h("div.pl-act",
				h("div.grow", h("div.t", {on: {click: () => textModal(e.name, e.entries)}}, e.name, h("span.tag.item", consumable ? `×${it.qty || 1}` : "Item")), h("div.d", charges ? `${charges - used}/${charges} charges` : summary(e.entries, 90))),
				charges && !consumable
					? h("button.btn.small.primary", {disabled: disabled || used >= charges, on: {click: () => { P.itemCharges[`${e.name}|${e.source}`] = used + 1; markEconomy(c, "action"); P_().log(c, `${e.name}: used a charge (${charges - used - 1} left)`); save(c); }}}, "Use charge")
					: h("button.btn.small.primary", {disabled, on: {click: () => useItem(c, d, it, ix)}}, "Use"),
			));
		});
		(await D().loadActions()).filter(a => a.source === "XPHB" && !/^(Attack|Magic|Opportunity Attack|Two-Weapon Fighting|Improvising an Action)$/.test(a.name)).forEach(a => {
			groups.other.push(h("div.pl-act.std",
				h("div.grow", h("div.t", {on: {click: () => textModal(a.name, a.entries)}}, a.name, h("span.tag", "Standard"), autoTag({action: a})), h("div.d", summary(a.entries, 90))),
				h("button.btn.small", {disabled: disabled && !/End Concentration/.test(a.name), on: {click: () => takeAction(c, d, a)}}, "Take"),
			));
		});
		// Spells sit after the attacks (or alone / left out on the phone's Act and Spells tabs)
		Object.keys(groups).forEach(k => {
			groups[k] = filter === "spells" ? spellGroups[k] : filter === "nospells" ? groups[k] : [...groups[k].slice(0, mark[k]), ...spellGroups[k], ...groups[k].slice(mark[k])];
		});
		const tabs = [["action", "Actions"], ["bonus", "Bonus Actions"], ["reaction", "Reactions"], ["other", filter === "spells" ? "Other" : "Other & Standard"]];
		if (stacked) {
			const any = tabs.some(([k]) => groups[k].length);
			return h("div.card.pl-card.pm-acts", h("div.card-h", h("h3", filter === "spells" ? "Spells" : "Actions"), h("div.spacer"), disabled ? h("span.warn-line", {style: {fontSize: "12.5px"}}, "Incapacitated: no actions") : null),
				h("div.card-b.pl-acts", ...(any ? tabs.filter(([k]) => groups[k].length).flatMap(([k, l]) => [h("div.pm-grp", l), ...groups[k]]) : [h("div.pick-empty", filter === "spells" ? "No spells." : "Nothing here.")])));
		}
		return h("div.card.pl-card", h("div.card-h", h("h3", "Actions"), h("div.spacer"), disabled ? h("span.warn-line", {style: {fontSize: "12.5px"}}, "Incapacitated: no actions") : null),
			h("div.pl-tabs", ...tabs.map(([k, l]) => h("button", {class: S.actTab === k ? "active" : "", on: {click: () => { S.actTab = k; render(); }}}, `${l} (${groups[k].length})`))),
			h("div.card-b.pl-acts", ...(groups[S.actTab].length ? groups[S.actTab] : [h("div.pick-empty", "Nothing here.")])),
		);
	};

	/** The form, on the page: its numbers, traits and what it is for; its actions are in the Actions list. */
	const formCard = (c, d, mon) => {
		const P = P_().stateOf(c);
		if (!P.form) return null;
		const fm = P.form;
		const abils = (fm.via === "Wild Shape" || fm.keepMental ? ["str", "dex", "con"] : R().ABILS);
		const traits = (mon?.trait || []).map(t => h("div.pl-ftrait", h("b", `${D().strip(t.name || "")}. `), D().summarize(t.entries || [], 160)));
		const senses = mon ? [mon.senses ? D().strip((mon.senses || []).join(", ")) : "", mon.passive ? `Passive Perception ${mon.passive}` : ""].filter(Boolean).join(" · ") : "";
		return h("div.card.pl-card.pl-form", h("div.card-h", h("h3", "Temporary Form"), h("div.spacer"),
			h("button.btn.small", {on: {click: () => statBlockModal(fm.key, `${fm.name} (your form)`)}}, "Full stat block"),
			h("button.btn.small.danger", {on: {click: () => { P_().endForm(c, "ended by choice"); save(c); }}}, "End form")), h("div.card-b",
			h("div.pl-form-n", fm.name, h("span.muted", ` · via ${fm.via}`)),
			h("div.pl-fstats",
				h("div", h("b", String(d.ac)), h("span", "AC")),
				h("div", h("b", `${P.temp || 0}`), h("span", "Temp HP")),
				h("div", h("b", `${d.speed} ft.`), h("span", (d.formSpeeds || []).join(", ") || "Speed")),
				...abils.map(a => h("div", h("b", `${d.scores[a]} (${sg(d.mods[a])})`), h("span", a.toUpperCase()))),
			),
			senses ? h("div.muted", {style: {fontSize: "12.5px", margin: "4px 0"}}, senses) : null,
			...traits,
			h("div.muted", {style: {fontSize: "12.5px", marginTop: "6px"}}, fm.endsAtZeroTemp ? "Damage comes off the form's Temporary Hit Points first; the form ends when they run out. You can't cast spells." : "You keep your own HP, Intelligence, Wisdom, Charisma, features and proficiencies; you can't cast spells. The form's attacks are in Actions."),
		));
	};

	/** Summoned creatures: each with its own HP, AC and stat block (scaled to the level it came with). */
	const companionsCard = (c) => {
		const P = P_().stateOf(c);
		if (!P.summons.length) return null;
		return h("div.card.pl-card.pl-form", h("div.card-h", h("h3", "Companions & Summons")), h("div.card-b",
			...P.summons.map(s => {
				const amt = h("input", {type: "number", min: 0, placeholder: "0", style: {width: "60px"}});
				const v = () => Math.max(0, Number(amt.value) || 0);
				const pct = Math.max(0, Math.min(100, s.hp / s.hpMax * 100));
				return h("div.pl-summon",
					h("div.row", h("b.pl-form-n", {style: {fontSize: "16px"}}, s.name), h("span.muted", ` · ${s.via}${s.conc ? " (concentration)" : ""}`), h("div.spacer"),
						h("button.btn.small", {on: {click: async () => { const mon = await P_().summonBlock(s); if (mon) blockModal(s.name, mon); }}}, "Stat block"),
						h("button.btn.ghost.small", {title: "Dismiss", on: {click: () => { P.summons = P.summons.filter(x => x !== s); P_().log(c, `${s.name} dismissed`); save(c); }}}, "✕")),
					h("div.row", {style: {fontSize: "13.5px", flexWrap: "wrap"}}, h("span", `AC ${s.ac}`), h("span", h("b", `${s.hp}`), ` / ${s.hpMax} HP`), h("div.bar.pl-sbar", h("div.fill", {class: pct <= 50 ? "bloodied" : "", style: {width: `${pct}%`}})),
						amt,
						h("button.btn.small.danger", {on: {click: () => {
							s.hp = Math.max(0, s.hp - v());
							P_().log(c, `${s.name} took ${v()} damage → ${s.hp}/${s.hpMax}`);
							if (!s.hp) { P.summons = P.summons.filter(x => x !== s); P_().log(c, `${s.name} drops to 0 HP and disappears`); }
							save(c);
						}}}, "−"),
						h("button.btn.small", {on: {click: () => { s.hp = Math.min(s.hpMax, s.hp + v()); P_().log(c, `${s.name} healed ${v()} → ${s.hp}/${s.hpMax}`); save(c); }}}, "+"),
					),
				);
			}),
		));
	};

	/** Everything active on the character right now, with what it does and how long it lasts. */
	const effectsCard = (c, d) => {
		const P = P_().stateOf(c);
		const rows = [];
		const left = (ef) => (ef.until === "turnStart" ? "until your next turn" : ef.rounds == null ? "until it ends" : ef.rounds >= 600 ? `${Math.round(ef.rounds / 60) / 10} h left` : ef.rounds >= 10 ? `${Math.round(ef.rounds / 10)} min left` : `${ef.rounds} round${ef.rounds === 1 ? "" : "s"} left`);
		const describe = (m) => [
			m.ac ? `${sg(m.ac)} AC` : "", m.acBase ? `base AC ${m.acBase} + DEX` : "", m.acMin ? `AC at least ${m.acMin}` : "",
			m.speed ? `${sg(m.speed)} ft. Speed` : "", m.speedMult ? `Speed ×${m.speedMult}` : "", m.fly ? `Fly ${m.fly} ft.` : "",
			...Object.entries(m.dice || {}).map(([k, v]) => `${v} on ${k.replace(/^skill:/, "").replace(":", " ")}`),
			...(m.adv || []).map(k => `Advantage: ${k.replace(":", " ")}`), ...(m.dis || []).map(k => `Disadvantage: ${k.replace(":", " ")}`),
			(m.resist || []).length ? `Resistance: ${m.resist.join(", ")}` : "", (m.conditions || []).length ? `${m.conditions.map(R().titleCase).join(", ")}` : "",
			...(m.damage || []).map(x => `${x.dice} ${x.type} damage on hits`), m.damageFlat ? `+${m.damageFlat.n} damage (${m.damageFlat.on === "str" ? "Strength attacks" : "attacks"})` : "",
			m.hpMax ? `+${m.hpMax} max HP` : "", m.spellDc ? `${sg(m.spellDc)} spell DC` : "", m.turnTemp ? `${m.turnTemp} temp HP each turn` : "",
		].filter(Boolean).join(" · ");
		P.effects.forEach(ef => rows.push(h("div.pl-eff",
			h("div.grow", h("div.t", ef.name, ef.conc ? h("span.tag", "C") : null, h("span.muted", ` · ${left(ef)}`)), describe(ef.mods || {}) ? h("div.d.on", describe(ef.mods || {})) : null, ef.notes ? h("div.d", ef.notes) : null),
			h("button.btn.ghost.small", {on: {click: () => { P_().endEffect(c, ef.id, "ended by choice"); save(c); }}}, "End"),
		)));
		if (P.concentration && !P.effects.some(ef => ef.conc && ef.via === P.concentration.name)) rows.push(h("div.pl-eff", h("div.grow", h("div.t", `Concentration: ${P.concentration.name}`), h("div.d", `Damage asks for a Constitution save (DC 10 or half the damage); you have ${sg(d.saves.con.bonus)}.`)), h("button.btn.ghost.small", {on: {click: () => { P_().endConcentration(c, "ended by choice"); save(c); }}}, "End")));
		if (P.form) rows.push(h("div.pl-eff", h("div.grow", h("div.t", `Form: ${P.form.name}`, h("span.muted", ` · ${P.form.via}`)), h("div.d.on", `AC ${d.ac}, Speed ${d.speed} ft., physical scores from the form`))));
		P.summons.forEach(s => rows.push(h("div.pl-eff", h("div.grow", h("div.t", `Summon: ${s.name}`), h("div.d", `${s.hp}/${s.hpMax} HP, AC ${s.ac} · ${s.via}`)))));
		[...P.conditions, ...d.effectConditions].forEach(x => { const fx = P_().COND_FX[x]; rows.push(h("div.pl-eff", h("div.grow", h("div.t", `Condition: ${R().titleCase(x)}`), h("div.d.on", fx ? Object.entries(fx).map(([k, v]) => `${k === "noActions" ? "no actions or reactions" : k === "speed0" ? "Speed 0" : `${v === "adv" ? "Advantage" : v === "dis" ? "Disadvantage" : "auto-fail"} on ${k.replace("save", "saves ").replace("StrDex", "STR/DEX").replace("Dex", "DEX").replace("attack", "attacks").replace("check", "checks").replace("init", "Initiative")}`}`).join(" · ") : "applied (no automatic number change)")))); });
		if (P.exhaustion) rows.push(h("div.pl-eff", h("div.grow", h("div.t", `Exhaustion ${P.exhaustion}`), h("div.d.on", `−${2 * P.exhaustion} on every d20 test, −${5 * P.exhaustion} ft. Speed`))));
		if (P.inspiration) rows.push(h("div.pl-eff", h("div.grow", h("div.t", "Heroic Inspiration"), h("div.d", "Reroll any die (★ Reroll in the roll log)."))));
		return h("div.card.pl-card", h("div.card-h", h("h3", "Active Effects"), h("div.spacer"), h("span.muted", `${rows.length}`)), h("div.card-b",
			...(rows.length ? rows : [h("div.pick-empty", "Nothing active. Spells, features and actions you use appear here with what they change and how long they last.")]),
		));
	};

	const resourcesCard = (c, d) => {
		const res = P_().resources(d);
		const P = P_().stateOf(c);
		const slots = P_().slotsOf(d);
		const pact = P_().pactOf(d);
		if (!res.length && !slots.length && !pact) return null;
		return h("div.card.pl-card", h("div.card-h", h("h3", "Slots & Resources")), h("div.card-b",
			...slots.map(s => h("div.pl-resrow", h("b", `Level ${s.level}`), pips(s.max, P.slotsUsed[s.level] || 0, (on) => { P.slotsUsed[s.level] = Math.max(0, Math.min(s.max, (P.slotsUsed[s.level] || 0) + (on ? 1 : -1))); save(c); }, {cls: "slot"}))),
			pact ? h("div.pl-resrow", h("b", `Pact (L${pact.level})`), pips(pact.slots, P.pactUsed || 0, (on) => { P.pactUsed = Math.max(0, Math.min(pact.slots, (P.pactUsed || 0) + (on ? 1 : -1))); save(c); }, {cls: "slot"})) : null,
			d.spellcasting ? h("div.pl-sub", [`${d.spellcasting.source}: ${d.spellcasting.abilityName}, DC ${d.spellcasting.dc}, attack ${sg(d.spellcasting.attack)}`, ...(d.spellSources || []).map(x => `${x.source}: ${x.abilityName}, DC ${x.dc}, attack ${sg(x.attack)}`)].join(" · ")) : null,
			...res.map(r => h("div.pl-resrow",
				h("b", {title: r.group}, r.name),
				r.big ? h("span", `${P_().remaining(c, r)}/${r.max}`) : pips(r.max, P.uses[r.key] || 0, (on) => { P.uses[r.key] = Math.max(0, Math.min(r.max, (P.uses[r.key] || 0) + (on ? 1 : -1))); save(c); }),
				h("span.muted.rest", r.rest === "short" ? "short rest" : r.rest === "long-1short" ? "long (1 on short)" : "long rest"),
			)),
		));
	};

	const inventoryCard = (c, d, save = saveDefault) => {
		const rows = d.items.map((it, ix) => {
			const inv = P_().gearOf(c).items[ix];
			const kind = it.equipKind;
			return h("div.pl-item", {class: it.equipped && kind ? "eq" : ""},
				h("span.grow", h("span.nm", {on: {click: () => it.ent && textModal(it.name, it.ent.entries)}}, it.name, it.notes ? h("span.muted", ` (${it.notes})`) : null), it.ent?.rarity && it.ent.rarity !== "none" ? h("span.muted", ` · ${it.ent.rarity}`) : null),
				kind ? h("label.chk", h("input", {type: "checkbox", checked: !!inv.equipped, on: {change: (e) => { inv.equipped = e.target.checked; P_().log(c, `${e.target.checked ? (kind === "attuned" ? "Attuned" : kind === "worn" ? "Put on" : "Wielded") : "Unequipped"} ${it.name}`); save(c, {derived: true}); }}}), kind) : null,
				h("button.btn.ghost.small", {on: {click: () => { inv.qty = Math.max(0, (inv.qty || 1) - 1); if (!inv.qty) P_().gearOf(c).items.splice(ix, 1); save(c, {derived: true}); }}}, "−"),
				h("b", String(inv.qty || 1)),
				h("button.btn.ghost.small", {on: {click: () => { inv.qty = (inv.qty || 1) + 1; save(c, {derived: true}); }}}, "+"),
				h("button.btn.ghost.small", {title: "Remove", on: {click: () => { P_().gearOf(c).items.splice(ix, 1); P_().log(c, `Removed ${it.name}`); save(c, {derived: true}); }}}, "✕"),
			);
		});
		const fx = d.itemEffects;
		return h("div.card.pl-card", h("div.card-h", h("h3", "Inventory"), h("div.spacer"), h("button.btn.small", {on: {click: () => addItems(c, save)}}, "+ Add items")), h("div.card-b",
			fx.sources.length ? h("div.muted", {style: {fontSize: "12.5px", marginBottom: "6px"}}, `Equipped items grant: ${fx.sources.join("; ")}`) : null,
			fx.attuned > 3 ? h("div.warn-line", {style: {fontSize: "12.5px", marginBottom: "6px"}}, `Attuned to ${fx.attuned} items: only 3 at a time.`) : null,
			...(rows.length ? rows : [h("div.pick-empty", "No items.")]),
			h("div.pl-sub", `Coins: ${((P_().gearOf(c).cp || 0) / 100).toLocaleString("en-US")} gp`),
		));
	};

	/** XP earned this session: typed in, or the per-character share of a saved encounter. */
	const sessionCard = (c) => {
		const P = P_().stateOf(c);
		const inp = h("input", {type: "number", placeholder: "XP", style: {width: "90px"}});
		const add = (n, why) => { if (!n) return; P.sessionXp = (Number(P.sessionXp) || 0) + n; P_().log(c, `+${fmt(n)} XP${why ? ` (${why})` : ""}; session total ${fmt(P.sessionXp)}`); save(c); };
		const encs = (TBStore.get().encounters || []).filter(e => (e.creatures || []).some(x => !x.ally));
		const encSel = h("select", h("option", {value: ""}, "+ XP from an encounter…"), ...encs.map(e => h("option", {value: e.id}, `${e.name || "Encounter"} (${fmt(TBEnc.evaluate(e).perPc)} XP each)`)));
		encSel.addEventListener("change", () => { const e = encs.find(x => x.id === encSel.value); if (e) add(TBEnc.evaluate(e).perPc, e.name); });
		const p = TBLevel.progress(c);
		return h("div.card.pl-card", h("div.card-h", h("h3", "Session"), h("div.spacer"), h("b", `${fmt(P.sessionXp)} XP`)), h("div.card-b",
			h("div.row", {style: {flexWrap: "wrap"}}, inp, h("button.btn.small", {on: {click: () => add(Number(inp.value) || 0, "")}}, "Add XP"), encs.length ? encSel : null),
			h("div.pl-sub", `${c.name || "Character"}: ${fmt(p.xp)} XP${p.to ? ` · level ${p.level + 1} at ${fmt(p.to)}` : ""}. Session XP is added when you end the session.`),
		));
	};

	const logCard = (c, d) => {
		const P = P_().stateOf(c);
		/** The latest check or save that didn't (knowingly) succeed: what can still turn it around. */
		const failBtn = (e) => {
			if (e.kind !== "d20" || !e.testKind || /^attack|^init/.test(e.testKind) || e.outcome === "success") return null;
			const res = {label: e.label, bonus: e.bonus, total: null, text: e.text};
			if (!T_().afterFail(c, d, res, e.testKind).length) return null;
			return h("button.btn.ghost.small", {title: "It failed: Tactical Mind, Indomitable, Stroke of Luck…", on: {click: async () => { const ok = await afterFail(c, d, res, e.testKind); if (ok) P_().log(c, `${e.label}: now a success`); save(c); }}}, "✗ It failed…");
		};
		return h("div.card.pl-card", h("div.card-h", h("h3", "Roll log"), h("div.spacer"), h("button.btn.ghost.small", {on: {click: () => { P.log = []; save(c); }}}, "Clear")), h("div.card-b.pl-log",
			...(P.log.length ? P.log.slice(0, 40).map((e, i) => h("div.pl-logrow",
				h("div", e.text, i === 0 && e.kind === "d20" && P.inspiration ? h("button.btn.ghost.small", {title: "Spend Heroic Inspiration to reroll", on: {click: async () => { P.inspiration = false; await P_().test(c, `${e.label} (rerolled with Heroic Inspiration)`, e.bonus, e.testKind, {sit: e.sit}); save(c); }}}, "★ Reroll") : null, i === 0 ? failBtn(e) : null),
				...(e.notes || []).filter(Boolean).map(n => h("div.n", n)),
			)) : [h("div.pick-empty", "Rolls and actions appear here.")]),
		));
	};
	// endregion

	// region Layout
	/** The Store tab is open only during a session. */
	const syncNav = () => {
		document.querySelectorAll("#tb-nav [data-view=store], #tb-bnav [data-view=store]").forEach(b => { b.disabled = !S.session; b.title = S.session ? "Buy, sell and barter with the session's character" : "Start a session in the Play tab to open the Store"; });
	};
	/** Start playing: the session works on a copy of the equipment and coins (kept if the last session wasn't ended). */
	const startSession = async (id) => {
		const c = TBStore.char(id);
		if (c && (c.classes || []).length) {
			if (P_().stateOf(c).gear && P_().gearChanges(c).changed) {
				const ch = P_().gearChanges(c).lines;
				const pick = await menu(`Last session wasn't ended: keep its inventory and coins? (${ch.slice(0, 4).join("; ")}${ch.length > 4 ? "…" : ""})`, [{value: "keep", label: "Keep the session's inventory and coins"}, {value: "fresh", label: "Start from the character page"}]);
				if (!pick) return;
				if (pick === "fresh") P_().beginGear(c);
			} else P_().beginGear(c);
			TBStore.changed("char");
		}
		S.charId = id; S.session = true; syncNav(); render();
	};
	/** The session character's live numbers (effects, conditions, form), for the Store. */
	const effectiveOf = async (c) => {
		const A = await R().analyze(P_().sessionChar(c));
		const P = P_().stateOf(c);
		const formMon = P.form ? (await P_().allMonsters()).byKey.get(P.form.key) : null;
		return P_().effective(c, A.derived, formMon);
	};
	/** Cast one of the character's spells with the Play flow (slot, menus, effects). true when it was cast. */
	const castByName = async (c, name) => {
		const d = await effectiveOf(c);
		const s = d.spells.find(x => lc(x.ent.name) === lc(name));
		return s ? !!(await castSpell(c, d, s)) : false;
	};

	const pickerScreen = (root) => {
		const list = h("div.char-list");
		TBStore.get().characters.forEach(ch => list.appendChild(h("div.char-card", {on: {click: () => startSession(ch.id)}},
			h("div.n", ch.name || "Unnamed"),
			h("div.s", (ch.classes || []).map(x => `${x.name} ${x.level}`).join(" / ") || "Not built yet"),
		)));
		root.appendChild(h("div.char-side", h("div.char-side-head", h("b", {style: {fontFamily: "var(--head)", color: "var(--accent2)"}}, "Choose a character")), list));
		const chars = TBStore.get().characters.filter(x => (x.classes || []).length);
		root.appendChild(h("div.char-main", h("div.empty",
			h("h2", "Load a character to play"),
			h("p", "The live sheet tracks hit points, rolls, spell slots, features, effects, conditions, shape-shifting, summons and the inventory during a session. Everything is saved with the character."),
			chars.length ? h("div.pl-pick", ...chars.map(x => h("button.btn", {on: {click: () => startSession(x.id)}}, `${x.name || "Unnamed"} · ${(x.classes || []).map(k => `${k.name} ${k.level}`).join(" / ")}`))) : h("p", "Build a character in the Characters tab first."),
		)));
	};

	const render = async () => {
		const root = document.getElementById("view-play");
		if (!root) return;
		// A redraw asked for while one is running happens right after it
		if (S.busy) { S.again = true; return; }
		S.busy = true;
		try {
			const scrolls = [...root.querySelectorAll(".pl-col")].map(e => e.scrollTop);
			const mainScroll = root.querySelector(".pl-body")?.scrollTop || 0;
			const c = char();
			if (!c || !S.session) {
				clear(root);
				pickerScreen(root);
				return;
			}
			if (!(c.classes || []).length) {
				clear(root);
				root.appendChild(h("div.char-main", h("div.empty", h("h2", "This character has no class yet"), h("button.btn.primary", {on: {click: () => { S.session = false; S.charId = null; TBApp.setView("characters"); }}}, "Open the builder"))));
				return;
			}
			const A = await R().analyze(P_().sessionChar(c));
			const P = P_().stateOf(c);
			const formMon = P.form ? (await P_().allMonsters()).byKey.get(P.form.key) : null;
			const d = P_().effective(c, A.derived, formMon);
			if (TBApp.isPhone()) {
				const keep = root.querySelector(".pm-body")?.scrollTop || 0;
				const page = await phonePage(c, d, formMon);
				clear(root);
				root.appendChild(page);
				const nb = root.querySelector(".pm-body");
				if (nb) nb.scrollTop = S.mTop ? 0 : keep;
				S.mTop = false;
				return;
			}
			const cols = [
				h("div.pl-col", hpCard(c, d), conditionsCard(c), abilitiesCard(c, d)),
				h("div.pl-col", turnBar(c), formCard(c, d, formMon), companionsCard(c), await actionsCard(c, d), effectsCard(c, d)),
				h("div.pl-col", resourcesCard(c, d), sessionCard(c), inventoryCard(c, d), logCard(c, d)),
			];
			const body = h("div.pl-body", h("div.pl-grid.session", ...cols));
			clear(root);
			root.appendChild(h("div.char-main", header(c, d), body));
			body.scrollTop = mainScroll;
			cols.forEach((el, i) => { el.scrollTop = scrolls[i] || 0; });
		} catch (e) {
			console.error(e);
			root.appendChild(h("pre", {style: {color: "#f99", padding: "12px"}}, e.stack || String(e)));
		} finally {
			S.busy = false;
			if (S.again) { S.again = false; render(); }
		}
	};
	// endregion

	return {render, state: S, startSession, syncNav, effectiveOf, castByName, char, inventoryCard};
})();
