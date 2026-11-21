"use strict";

/**
 * "Store" tab: the Play session's character goes shopping. Pick a vendor (or Everything), see prices
 * for the settlement, barter with Influence-style checks (the same rolls, effects and conditions as the
 * Play tab), fill a cart and pay from the character's coins; sell gear and valuables back.
 * Rules and prices: store-data.js (TBShop).
 */
globalThis.TBViewStore = (() => {
	const {h, clear} = TBUI;
	const P_ = () => TBPlay;
	const R = () => TBRules;
	const D = () => TBData;
	const S_ = () => TBShop;
	const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);
	const lc = (s) => String(s ?? "").toLowerCase();
	const tc = (s) => R().titleCase(s);
	const PER_PAGE = 25;
	const ui = {search: "", rarity: "all", core: true, legacy: false, sort: "name", tab: "buy", page: 0, busy: false, again: false};

	// region State (kept with the character's Play state)
	const storeOf = (c) => {
		const P = P_().stateOf(c);
		if (!P.store) P.store = {};
		const st = P.store;
		st.vendor = st.vendor || "all";
		st.settle = st.settle || "city";
		st.profile = st.profile || "fair";
		st.attitude = st.attitude || "indifferent";
		st.cart = st.cart || [];
		if (!st.visit) st.visit = newVisit();
		return st;
	};
	const newVisit = () => ({used: {}, social: 0, appraise: 0, spell: 0, markup: 0, ended: false, advNext: false, advAll: false, advCha: false, notes: []});
	const discountOf = (st) => Math.min(S_().MAX_DISCOUNT, Math.max(st.visit.social, st.visit.spell) + st.visit.appraise);
	/** Price after bartering (buying) and what the vendor pays (selling). */
	const buyCp = (st, cp) => Math.round(cp * (100 - discountOf(st) + st.visit.markup) / 100);
	const sellCp = (st, cp) => Math.round(cp * Math.max(0, 100 + discountOf(st) - st.visit.markup) / 100);
	const save = (c, {derived = false} = {}) => {
		c.updatedAt = Date.now();
		if (derived) TBApp.charChanged(c); else TBStore.changed("char");
		render();
	};
	// endregion

	// region Small UI helpers
	const select = (value, opts, onChange, title = "") => {
		const el = h("select", {title}, ...opts.map(o => h("option", {value: o.value, selected: o.value === value}, o.label)));
		el.addEventListener("change", () => onChange(el.value));
		return el;
	};
	const menu = (title, options) => new Promise((resolve) => {
		let done = false;
		const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
		const m = TBUI.modal({
			title,
			body: h("div", {style: {padding: "14px 16px", width: "460px", display: "flex", flexDirection: "column", gap: "6px", maxHeight: "60vh", overflow: "auto"}}, ...options.map(o => h("button.btn", {style: {justifyContent: "flex-start"}, on: {click: () => finish(o.value)}}, o.label))),
			footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel")],
			onClose: () => { if (!done) { done = true; resolve(null); } },
		});
	});
	const infoModal = (title, html) => {
		const frame = TBUI.fragFrame();
		Object.assign(frame.style, {width: "640px", height: "64vh", border: "0", display: "block"});
		TBUI.modal({title, body: h("div", {style: {display: "flex"}}, frame)});
		frame.setContent(TBSan.clean(html));
	};
	const showItem = (row) => {
		if (row.scroll) return infoModal(row.name, D().renderEntity("spell", row.scroll));
		let html;
		try { html = `<table class="ve-w-100 ve-stats tb-stats">${Renderer.item.getCompactRenderedString(row.ent)}</table>`; } catch (e) { html = Renderer.get().render({type: "entries", entries: row.ent.entries || []}); }
		infoModal(row.name, html);
	};
	const rarityTag = (r) => (r && r !== "none" ? h(`span.tag.r-${r.replace(/\s/g, "")}`, tc(r)) : null);
	// endregion

	// region Bartering
	const toolProf = (d, re) => !!re && (d.tools || []).some(t => re.test(t));
	const skillLine = (d, sk) => {
		const s = d.skills[sk];
		return `${tc(sk)} ${sg(s.bonus)}${s.exp ? " (expertise)" : s.prof ? " (proficient)" : ""}`;
	};
	/** The skill an approach rolls: Appraise uses the best of Investigation and the vendor's own skill (Arcana at magic shops…). */
	const skillFor = (d, v, a) => {
		if (a.id !== "appraise") return a.skill;
		const opts = ["investigation", v.skill].filter(Boolean);
		return opts.sort((x, y) => d.skills[y].bonus - d.skills[x].bonus)[0];
	};
	const traitsOf = (d) => {
		const names = [...R().featureList(d).map(f => f.name), ...d.feats.map(f => f.ent.name)];
		return S_().TRAITS.map(t => ({...t, has: names.find(n => t.re.test(n))})).filter(t => t.has && t.text);
	};
	/** Advantage / Disadvantage for a barter check, with the reasons. */
	const modeFor = (c, d, st, v, a) => {
		const sk = skillFor(d, v, a);
		const adv = [];
		const dis = [];
		const att = S_().ATTITUDES.find(x => x.id === st.attitude);
		if (att.mode === "adv") adv.push(`${att.label} vendor`);
		if (att.mode === "dis") dis.push(`${att.label} vendor`);
		if (st.visit.advNext) adv.push("you read the vendor");
		if (st.visit.advAll) adv.push("vendor charmed");
		if (st.visit.advCha && a.abil === "cha") adv.push("magic on your side");
		const tool = toolProf(d, v.tool);
		if (tool && d.skills[sk].prof && (a.id === "appraise" || a.id === "persuade")) adv.push(`${v.appraise || "tool"} and ${tc(sk)}`);
		const tm = P_().testMode(c, `check:${a.abil}:${sk}`, adv.length && !dis.length ? "adv" : dis.length && !adv.length ? "dis" : "normal");
		return {sk, tool, adv, dis, mode: tm.mode, notes: tm.notes, pbFromTool: tool && !d.skills[sk].prof && (a.id === "appraise" || a.id === "persuade") ? d.pb : 0};
	};
	const approach = async (c, a) => {
		const st = storeOf(c);
		const v = S_().vendorOf(st.vendor);
		const d = await TBViewPlay.effectiveOf(c);
		const m = modeFor(c, d, st, v, a);
		const prof = S_().PROFILES.find(p => p.id === st.profile);
		const bonus = d.skills[m.sk].bonus + m.pbFromTool;
		const r = await P_().test(c, `Barter: ${a.name} (${tc(m.sk)}, DC ${prof.dc})`, bonus, `check:${a.abil}:${m.sk}`, {base: m.mode, sit: P_().stateOf(c).sit[`skill:${m.sk}`] || "", outcome: "check", dc: prof.dc, need: true});
		if (!r) return;
		let total = r.total;
		for (const t of traitsOf(d).filter(x => x.min10)) {
			const ok = t.min10 === "proficient" ? d.skills[m.sk].prof : t.min10.includes(m.sk);
			if (ok && r.nat < 10) { total += 10 - r.nat; P_().log(c, `${t.has}: the d20 counts as 10 → ${total}`); }
		}
		const margin = total - prof.dc;
		st.visit.used[a.id] = {total, margin};
		if (st.visit.advNext) st.visit.advNext = false;
		let msg;
		if (margin >= 0) {
			const got = a.gain[margin >= 5 ? 1 : 0];
			if (a.advNext) { st.visit.advNext = true; msg = `${a.name}: success — you know their bottom line (Advantage on your next barter check).`; }
			else if (a.stack) { st.visit.appraise = Math.max(st.visit.appraise, got); msg = `${a.name}: success — ${got}% off for the flaws you found.`; }
			else { st.visit.social = Math.max(st.visit.social, got); msg = `${a.name}: success${margin >= 5 ? " by 5 or more" : ""} — ${got}% off.`; }
		} else if (margin <= -5 && a.fail5) {
			st.visit.markup = Math.max(st.visit.markup, a.fail5.markup);
			if (a.fail5.end) st.visit.ended = true;
			msg = `${a.name}: failed badly. ${a.fail5.text}`;
		} else msg = `${a.name}: no deal (missed DC ${prof.dc} by ${-margin}).`;
		P_().log(c, `Barter — ${msg} Discount now ${discountOf(st)}%${st.visit.markup ? `, markup ${st.visit.markup}%` : ""}.`);
		save(c);
	};
	/** A spell from the character's list, cast with the Play flow, then its effect on the vendor. */
	const castAt = async (c, name, info) => {
		const st = storeOf(c);
		const ok = await TBViewPlay.castByName(c, name);
		if (!ok) return;
		const d = await TBViewPlay.effectiveOf(c);
		if (info.save) {
			const prof = S_().PROFILES.find(p => p.id === st.profile);
			const dc = R().castFor(d, d.spells.find(s => lc(s.ent.name) === lc(name)))?.dc ?? 13;
			const roll = 1 + Math.floor(Math.random() * 20);
			const tot = roll + prof.save;
			const saved = tot >= dc;
			P_().log(c, `Vendor's Wisdom save against ${tc(name)}: ${tot} (d20 [${roll}] ${sg(prof.save)}) vs DC ${dc} — ${saved ? "saved, no effect" : "failed"}`);
			if (saved) { save(c); return; }
		}
		if (info.advAll) st.visit.advAll = true;
		if (info.advCha) st.visit.advCha = true;
		if (info.advNext) st.visit.advNext = true;
		if (info.discount) st.visit.spell = Math.max(st.visit.spell, info.discount);
		st.visit.notes.push(tc(name));
		P_().log(c, `Barter — ${tc(name)}: ${info.text} Discount now ${discountOf(st)}%.`);
		save(c);
	};

	const barterCard = (c, d, st, v) => {
		const prof = S_().PROFILES.find(p => p.id === st.profile);
		const disc = discountOf(st);
		const rows = S_().APPROACHES.map(a => {
			const m = modeFor(c, d, st, v, a);
			const used = st.visit.used[a.id];
			const gain = a.advNext ? "Advantage on the next check" : `−${a.gain[0]}%${a.gain[1] !== a.gain[0] ? ` (−${a.gain[1]}% by 5+)` : ""}${a.stack ? ", adds up" : ""}`;
			return h("div.st-ap", {class: used ? "used" : ""},
				h("div.grow",
					h("div.t", a.name, h("span.tag", a.abil.toUpperCase()), m.mode === "adv" ? h("span.tag.adv", "Advantage") : m.mode === "dis" ? h("span.tag.dis", "Disadvantage") : null),
					h("div.d", `${skillLine(d, m.sk)}${m.pbFromTool ? ` ${sg(m.pbFromTool)} ${v.appraise}` : ""} · ${gain}${a.fail5 ? ` · fail by 5+: ${a.fail5.markup ? `+${a.fail5.markup}%` : ""}${a.fail5.end ? ", haggling ends" : ""}` : ""}`),
					h("div.d.muted", a.desc),
					[...m.adv.map(x => `Advantage: ${x}`), ...m.dis.map(x => `Disadvantage: ${x}`), ...m.notes].length ? h("div.d.why", [...m.adv.map(x => `▲ ${x}`), ...m.dis.map(x => `▼ ${x}`), ...m.notes].join(" · ")) : null,
					used ? h("div.d.res", `Rolled ${used.total} vs DC ${prof.dc} (${used.margin >= 0 ? `+${used.margin}` : used.margin})`) : null,
				),
				h("button.btn.small", {class: used || st.visit.ended ? "" : "primary", disabled: !!used || st.visit.ended, on: {click: () => approach(c, a)}}, used ? "Done" : "Try"),
			);
		});
		const spellRows = d.spells.filter(s => S_().SPELLS[lc(s.ent.name)]).map(s => {
			const info = S_().SPELLS[lc(s.ent.name)];
			return h("div.st-ap",
				h("div.grow", h("div.t", s.ent.name, h("span.tag.spell", s.ent.level ? `L${s.ent.level}` : "Cantrip")), h("div.d", info.text)),
				h("button.btn.small.primary", {disabled: st.visit.ended && !info.discount, on: {click: () => castAt(c, s.ent.name, info)}}, "Cast"),
			);
		});
		const traits = traitsOf(d);
		const P = P_().stateOf(c);
		const active = P.effects.filter(ef => ef.mods && (Object.keys(ef.mods.dice || {}).some(k => /^(check|skill)/.test(k)) || (ef.mods.adv || []).some(k => /^check/.test(k))));
		return h("div.card.pl-card",
			h("div.card-h", h("h3", "Barter"), h("span.grow"), h("span.st-disc", {class: disc ? "on" : ""}, disc ? `−${disc}%` : "no discount"), st.visit.markup ? h("span.st-disc.bad", `+${st.visit.markup}%`) : null),
			h("div.card-b",
				h("div.pl-sub", `Vendor: ${prof.label} (DC ${prof.dc}) · ${S_().ATTITUDES.find(a => a.id === st.attitude).label}. Each approach once per visit; discounts don't stack except Appraise; at most ${S_().MAX_DISCOUNT}% off.`),
				st.visit.ended ? h("div.warn-line", "The vendor won't haggle any more this visit. Start a new visit (or try another vendor).") : null,
				...rows,
				spellRows.length ? h("div.st-h", "Your spells") : null, ...spellRows,
				traits.length || active.length || st.visit.notes.length ? h("div.st-h", "Working for you") : null,
				...traits.map(t => h("div.d.st-trait", t.text)),
				...active.map(ef => h("div.d.st-trait", `${ef.name} (active): ${ef.notes || "bonus on checks"}`)),
				...st.visit.notes.map(n => h("div.d.st-trait", `${n}: in effect this visit`)),
				h("div.pl-sub", h("span.muted", "Charisma"), h("b", sg(d.mods.cha)), h("span.muted", "Wisdom"), h("b", sg(d.mods.wis)), h("span.muted", "Intelligence"), h("b", sg(d.mods.int)), d.tools.length ? h("span.muted", `Tools: ${d.tools.join(", ")}`) : null),
				h("div.row", {style: {gap: "6px", marginTop: "8px"}},
					h("button.btn.small", {on: {click: async () => { const v2 = await TBUI.prompt("Discount the DM grants (%)", String(st.visit.social)); if (v2 == null) return; st.visit.social = Math.max(0, Math.min(90, Number(v2) || 0)); P_().log(c, `Barter — DM sets the discount to ${discountOf(st)}%`); save(c); }}}, "DM discount…"),
					h("button.btn.small", {on: {click: () => { st.visit = newVisit(); P_().log(c, "Store: new visit (haggling starts over)"); save(c); }}}, "New visit"),
				),
			),
		);
	};
	// endregion

	// region Catalog
	const rowsFor = async (st, v) => {
		const cat = await S_().catalog();
		const settle = S_().settlementOf(st.settle);
		const q = lc(ui.search).trim();
		const who = TBViewPlay.char && TBViewPlay.char();
		// House-rule items: only the shopping character's own (or shared ones)
		const keep = (r) => (!r.hr || TBHouse.visible(r.ent, who)) && (!ui.core || r.core) && (ui.legacy || !r.reprinted) && (ui.rarity === "all" || r.rarity === ui.rarity) && (!q || lc(r.name).includes(q));
		let rows = cat.rows.filter(r => v.match(r.ent) && S_().availableIn(r.ent, settle) && keep(r));
		if (v.scrolls) rows = rows.concat(cat.scrolls.filter(r => S_().RARITY_ORDER.indexOf(r.rarity) <= S_().RARITY_ORDER.indexOf(settle.maxRarity) && keep(r)));
		const services = [];
		(v.services || []).forEach(k => {
			if (k === "spells") {
				for (let l = 0; l <= settle.maxSpell; l++) services.push({key: `svc:spell:${l}`, name: `Spellcasting service: ${l ? `level ${l}` : "cantrip"} spell`, group: "Spellcasting", cp: S_().SPELL_SERVICE_GP[l] * 100, service: true, spellLevel: l});
			} else S_().SERVICES[k].forEach(s => services.push({key: `svc:${k}:${s.name}`, ...s, service: true}));
		});
		const svc = services.filter(s => !q || lc(s.name).includes(q));
		if (ui.sort === "price") rows.sort((a, b) => a.cp - b.cp);
		else if (ui.sort === "priceDesc") rows.sort((a, b) => b.cp - a.cp);
		else rows.sort((a, b) => a.name.localeCompare(b.name));
		return {rows, svc, settle};
	};
	const addToCart = async (c, row) => {
		const st = storeOf(c);
		let note = "";
		if (row.spellLevel != null) {
			const spells = (await S_().catalog()).spells.filter(s => s.level === row.spellLevel && ["XPHB"].includes(s.source));
			const pick = await menu(`Which ${row.spellLevel ? `level ${row.spellLevel}` : "cantrip"} spell?`, spells.map(s => ({value: s.name, label: s.name})));
			if (!pick) return;
			note = pick;
		}
		const key = `${row.key}${note ? `|${note}` : ""}`;
		const have = st.cart.find(x => x.key === key);
		if (have) have.qty += 1;
		else st.cart.push({key, name: row.name, cp: row.cp, qty: 1, note, service: !!row.service, spellLevel: row.spellLevel ?? null, ref: row.ent ? {name: row.ent.name, source: row.ent.source} : null, scroll: row.scroll ? {name: row.scroll.name, source: row.scroll.source} : null});
		save(c);
	};
	const catalogCard = async (c, st, v) => {
		const {rows, svc, settle} = await rowsFor(st, v);
		const search = h("input", {type: "search", placeholder: `Search ${v.name}…`, value: ui.search, style: {flex: "1"}});
		search.addEventListener("input", TBUI.debounce(() => { ui.search = search.value; ui.page = 0; ui.focus = true; render(); }, 250));
		const rarities = ["all", ...S_().RARITY_ORDER.slice(0, S_().RARITY_ORDER.indexOf(settle.maxRarity) + 1)];
		// Services first, then the goods: 25 per page
		const all = [...svc, ...rows];
		const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
		ui.page = Math.max(0, Math.min(ui.page, pages - 1));
		const shown = all.slice(ui.page * PER_PAGE, (ui.page + 1) * PER_PAGE);
		const go = (n) => { ui.page = Math.max(0, Math.min(pages - 1, n)); ui.toTop = true; render(); };
		const pager = () => {
			if (pages <= 1) return null;
			const nums = [...new Set([0, ui.page - 2, ui.page - 1, ui.page, ui.page + 1, ui.page + 2, pages - 1])].filter(n => n >= 0 && n < pages).sort((x, y) => x - y);
			const btns = [];
			nums.forEach((n, i) => {
				if (i && n - nums[i - 1] > 1) btns.push(h("span.muted", "…"));
				btns.push(h("button.btn.small", {class: n === ui.page ? "primary" : "", on: {click: () => go(n)}}, String(n + 1)));
			});
			return h("div.st-pager",
				h("button.btn.small", {disabled: ui.page === 0, on: {click: () => go(ui.page - 1)}}, "‹ Prev"),
				...btns,
				h("button.btn.small", {disabled: ui.page >= pages - 1, on: {click: () => go(ui.page + 1)}}, "Next ›"),
				h("span.muted", `${ui.page * PER_PAGE + 1}–${Math.min(all.length, (ui.page + 1) * PER_PAGE)} of ${all.length}`),
			);
		};
		const line = (row) => h("div.pl-act.st-row",
			h("div.grow",
				h("div.t", {on: {click: () => (row.service ? null : showItem(row))}}, row.name, rarityTag(row.rarity), row.treasure ? h("span.tag.item", "Treasure") : null, row.brew ? h("span.tag.brew", "5etools homebrew") : null, row.hr ? h("span.tag.hr", "House rule") : null),
				h("div.d", row.service ? row.group : [row.ent ? (S_().typeOf(row.ent) ? (Parser.itemTypeToFull ? (() => { try { return Parser.itemTypeToFull(S_().typeOf(row.ent)); } catch (e) { return ""; } })() : "") : row.ent.wondrous ? "Wondrous item" : "") : `Level ${row.level || "cantrip"} spell`, Parser.sourceJsonToAbv ? Parser.sourceJsonToAbv(row.source) : row.source].filter(Boolean).join(" · ")),
			),
			h("div.st-price", discountOf(st) || st.visit.markup ? [h("s.muted", S_().money(row.cp)), h("b", S_().money(buyCp(st, row.cp)))] : h("b", S_().money(row.cp))),
			h("button.btn.small.primary", {on: {click: () => addToCart(c, row)}}, "Add"),
		);
		return h("div.card.pl-card.st-cat",
			h("div.card-h", h("h3", `${v.icon} ${v.name}`), h("span.grow"), h("span.muted", `${rows.length + svc.length} for sale · ${settle.label}`)),
			h("div.card-b",
				h("div.pl-sub", v.desc, " ", h("span.muted", settle.note)),
				h("div.row", {style: {gap: "6px", margin: "8px 0", flexWrap: "wrap"}}, search,
					select(ui.sort, [{value: "name", label: "A → Z"}, {value: "price", label: "Cheapest first"}, {value: "priceDesc", label: "Priciest first"}], (x) => { ui.sort = x; ui.page = 0; render(); }),
					h("label.chk", {title: "Only the core rulebooks (PHB, DMG, MM) and your installed 5etools homebrew"}, (() => { const i = h("input", {type: "checkbox", checked: ui.core}); i.addEventListener("change", () => { ui.core = i.checked; ui.page = 0; render(); }); return i; })(), "Core books"),
					h("label.chk", {title: "Also show 2014 printings that have a 2024 version"}, (() => { const i = h("input", {type: "checkbox", checked: ui.legacy}); i.addEventListener("change", () => { ui.legacy = i.checked; ui.page = 0; render(); }); return i; })(), "Legacy"),
				),
				rarities.length > 2 ? h("div.row", {style: {gap: "4px", flexWrap: "wrap", marginBottom: "6px"}}, ...rarities.map(r => h("span.chip", {class: ui.rarity === r ? "on" : "", on: {click: () => { ui.rarity = r; ui.page = 0; render(); }}}, r === "all" ? "All" : r === "none" ? "Mundane" : tc(r)))) : null,
				pager(),
				...shown.map(line),
				pager(),
				!rows.length && !svc.length ? h("div.pick-empty", "Nothing here for this search, settlement or filter.") : null,
			),
		);
	};
	// endregion

	// region Cart, paying and selling
	const pay = async (c, d) => {
		const st = storeOf(c);
		const total = st.cart.reduce((t, x) => t + buyCp(st, x.cp) * x.qty, 0);
		const coins = Number(P_().gearOf(c).cp) || 0;
		if (total > coins) { TBUI.toast(`Not enough coin: ${S_().money(total)} needed, you have ${S_().money(coins)}.`, {error: true}); return; }
		const cat = await S_().catalog();
		P_().gearOf(c).cp = coins - total;
		const items = P_().gearOf(c).items;
		const put = (ref, qty, notes) => {
			const have = items.find(i => lc(i.name) === lc(ref.name) && lc(i.source) === lc(ref.source) && (i.notes || "") === (notes || ""));
			if (have) have.qty = (have.qty || 1) + qty;
			else items.push({name: ref.name, source: ref.source, qty, ...(notes ? {notes} : {})});
		};
		const bought = [];
		for (const x of st.cart) {
			if (x.ref) put(x.ref, x.qty);
			else if (x.scroll) { const sp = cat.spells.find(s => s.name === x.scroll.name && s.source === x.scroll.source); if (sp) { const it = S_().scrollItem(cat.byKey, sp); put(it, x.qty, it.notes); } }
			bought.push(`${x.qty > 1 ? `${x.qty}× ` : ""}${x.name}${x.note ? ` (${x.note})` : ""}`);
			// Spellcasting services that heal are applied to the sheet
			if (x.spellLevel != null && x.note) {
				const sp = cat.spells.find(s => s.name === x.note && s.source === "XPHB");
				const dice = sp && P_().spellDice(sp, Math.max(1, sp.level), d.totalLevel);
				if (dice?.heal) {
					const r = await P_().rollFor(c, `${dice.dice}${dice.addMod ? "+3" : ""}`, {label: `${sp.name} (the priest's casting)`});
					if (r) { P_().heal(c, d, r.total); P_().log(c, `${sp.name}: healed ${r.total} (${r.text})`); }
				} else if (sp) P_().log(c, `${sp.name} is cast for you`, {notes: [D().summarize(sp.entries, 160)]});
			}
		}
		const disc = discountOf(st);
		P_().log(c, `Bought ${bought.join(", ")} for ${S_().money(total)}${disc ? ` (−${disc}% bartered)` : ""}${st.visit.markup ? ` (+${st.visit.markup}% markup)` : ""}. Coins left: ${S_().money(P_().gearOf(c).cp)}`);
		st.cart = [];
		TBUI.toast(`Paid ${S_().money(total)}. The items are in your inventory.`);
		save(c, {derived: true});
	};
	const cartCard = (c, st) => {
		const total = st.cart.reduce((t, x) => t + buyCp(st, x.cp) * x.qty, 0);
		const list = st.cart.reduce((t, x) => t + x.cp * x.qty, 0);
		const coins = Number(P_().gearOf(c).cp) || 0;
		return h("div.card.pl-card",
			h("div.card-h", h("h3", "Cart"), h("span.grow"), h("span.muted", `${st.cart.reduce((t, x) => t + x.qty, 0)} item(s)`)),
			h("div.card-b",
				!st.cart.length ? h("div.pick-empty", "Add items from the vendor's list.") : null,
				...st.cart.map((x, i) => h("div.pl-item",
					h("span.grow", x.name, x.note ? h("span.muted", ` (${x.note})`) : null),
					h("button.btn.ghost.small", {on: {click: () => { x.qty -= 1; if (x.qty <= 0) st.cart.splice(i, 1); save(c); }}}, "−"),
					h("b", String(x.qty)),
					h("button.btn.ghost.small", {on: {click: () => { x.qty += 1; save(c); }}}, "+"),
					h("span.st-price", S_().money(buyCp(st, x.cp) * x.qty)),
				)),
				st.cart.length ? h("div.st-total",
					h("div", "Total", list !== total ? h("s.muted", ` ${S_().money(list)}`) : null, h("b", ` ${S_().money(total)}`)),
					h("div.muted", `You have ${S_().money(coins)}${total > coins ? ` — ${S_().money(total - coins)} short` : ` — ${S_().money(coins - total)} left after`}`),
				) : null,
				st.cart.length ? h("div.row", {style: {gap: "6px", marginTop: "8px"}},
					h("button.btn.primary", {disabled: total > coins, on: {click: async () => pay(c, await TBViewPlay.effectiveOf(c))}}, `Pay ${S_().money(total)}`),
					h("button.btn", {on: {click: () => { st.cart = []; save(c); }}}, "Empty cart"),
				) : null,
			),
		);
	};
	/** The character's valuables (gems, art, trade goods) and what this vendor pays for what they carry. */
	const sellCard = (c, d, st, v) => {
		const cat = S_();
		const inv = P_().gearOf(c).items || [];
		const rows = d.items.map((it, ix) => ({it, inv: inv[ix], ix, value: cat.priceOf(it.ent, null), offer: cat.sellPrice(it.ent, null)}));
		const treasure = rows.filter(r => r.it.ent && cat.isTreasure(r.it.ent));
		const tTotal = treasure.reduce((t, r) => t + (r.value || 0) * (r.inv.qty || 1), 0);
		const buys = (r) => !!r.it.ent && r.offer != null && (v.id === "all" || v.match(r.it.ent) || (v.id === "jeweler" && cat.isTreasure(r.it.ent)) || (v.id === "general" && cat.typeOf(r.it.ent) === "TG"));
		const sell = (r) => {
			const each = sellCp(st, r.offer);
			r.inv.qty = (r.inv.qty || 1) - 1;
			if (r.inv.qty <= 0) inv.splice(r.ix, 1);
			P_().gearOf(c).cp = (Number(P_().gearOf(c).cp) || 0) + each;
			P_().log(c, `Sold ${r.it.name} for ${cat.money(each)}${discountOf(st) ? ` (+${discountOf(st)}% bartered)` : ""}. Coins: ${cat.money(P_().gearOf(c).cp)}`);
			save(c, {derived: true});
		};
		return h("div.card.pl-card",
			h("div.card-h", h("h3", "Sell & valuables"), h("span.grow"), tTotal ? h("span.muted", `treasure worth ${cat.money(tTotal)}`) : null),
			h("div.card-b",
				h("div.pl-sub", "Gems, art objects and trade goods sell at full value; other gear at half its cost (magic items: half their value)."),
				...rows.filter(r => r.it.ent).sort((a, b) => (cat.isTreasure(b.it.ent) - cat.isTreasure(a.it.ent)) || ((b.value || 0) - (a.value || 0))).map(r => h("div.pl-item", {class: cat.isTreasure(r.it.ent) ? "eq" : ""},
					h("span.grow", h("span.nm", r.it.name), r.inv.notes ? h("span.muted", ` (${r.inv.notes})`) : null, h("span.muted", ` ×${r.inv.qty || 1}`),
						h("div.d.muted", r.value != null ? `worth ${cat.money(r.value)} each${cat.isTreasure(r.it.ent) ? " · treasure" : ""}` : "no listed price: ask the DM")),
					r.offer != null ? h("span.st-price", cat.money(sellCp(st, r.offer))) : null,
					h("button.btn.small", {class: buys(r) && !r.inv.equipped ? "primary" : "", disabled: !buys(r) || !!r.inv.equipped, title: r.inv.equipped ? "Unequip it first" : buys(r) ? "Sell one" : "This vendor doesn't buy it", on: {click: () => sell(r)}}, "Sell"),
				)),
				!rows.some(r => r.it.ent) ? h("div.pick-empty", "Nothing to sell.") : null,
			),
		);
	};
	/** The session's roll log (shared with the Play tab), with the Heroic Inspiration reroll. */
	const logCard = (c) => {
		const P = P_().stateOf(c);
		return h("div.card.pl-card", h("div.card-h", h("h3", "Roll log")), h("div.card-b.pl-log",
			...(P.log.length ? P.log.slice(0, 15).map((e, i) => h("div.pl-logrow",
				h("div", e.text, i === 0 && e.kind === "d20" && P.inspiration ? h("button.btn.ghost.small", {title: "Spend Heroic Inspiration to reroll", on: {click: async () => { P.inspiration = false; await P_().test(c, `${e.label} (rerolled with Heroic Inspiration)`, e.bonus, e.testKind, {sit: e.sit}); save(c); }}}, "★ Reroll") : null),
				...(e.notes || []).filter(Boolean).map(n => h("div.n", n)),
			)) : [h("div.pick-empty", "Rolls and purchases appear here.")]),
		));
	};
	// endregion

	// region Render
	const header = (c, st) => {
		const coins = Number(P_().gearOf(c).cp) || 0;
		return h("div.pl-head",
			h("div.grow",
				h("div.pl-name", `${c.name || "Character"} goes shopping`),
				h("div.pl-line", "Prices from the 2024 rules. Pick a vendor, barter, fill the cart and pay; it all goes to the character's inventory and coins."),
			),
			h("div.pl-stat.click", {title: "Change the character's coins", on: {click: async () => {
				const v = await TBUI.prompt("Coins (in gp; 12.5 = 12 gp 5 sp)", String(coins / 100));
				if (v == null) return;
				P_().gearOf(c).cp = Math.max(0, Math.round((Number(String(v).replace(",", ".")) || 0) * 100));
				P_().log(c, `Store: coins set to ${S_().money(P_().gearOf(c).cp)}`);
				save(c, {derived: true});
			}}}, h("div.v.st-coins", S_().money(coins)), h("div.l", "Coins · edit")),
			h("div.st-sel", h("div.l", "Settlement"), select(st.settle, S_().SETTLEMENTS.map(s => ({value: s.id, label: s.label})), (x) => { st.settle = x; save(c); })),
			h("div.st-sel", h("div.l", "Vendor"), select(st.profile, S_().PROFILES.map(p => ({value: p.id, label: `${p.label} (DC ${p.dc})`})), (x) => { st.profile = x; save(c); }, "How hard the vendor bargains")),
			h("div.st-sel", h("div.l", "Attitude"), select(st.attitude, S_().ATTITUDES.map(a => ({value: a.id, label: a.label})), (x) => { st.attitude = x; save(c); }, "Friendly: Advantage; Hostile: Disadvantage")),
		);
	};
	const vendorsCard = (c, st) => h("div.card.pl-card",
		h("div.card-h", h("h3", "Vendors")),
		h("div.card-b.st-vendors", ...S_().VENDORS.map(v => h("div.st-vendor", {class: v.id === st.vendor ? "on" : "", on: {click: () => {
			if (v.id === st.vendor) return;
			st.vendor = v.id;
			st.visit = newVisit();
			ui.search = ""; ui.rarity = "all"; ui.page = 0;
			P_().log(c, `Store: visiting ${v.name}`);
			save(c);
		}}}, h("span.ic", v.icon), h("div.grow", h("div.t", v.name), h("div.d", v.desc))))),
	);

	// region Phone layout: vendor grid, then Buy / Sell / Barter / Cart inside a vendor
	const enterVendor = (c, st, v) => {
		if (v.id !== st.vendor) {
			st.vendor = v.id;
			st.visit = newVisit();
			ui.search = ""; ui.rarity = "all"; ui.page = 0;
			P_().log(c, `Store: visiting ${v.name}`);
		}
		ui.mIn = true;
		ui.mTab = "buy";
		ui.toTop = true;
		save(c);
	};
	const editCoins = async (c) => {
		const coins = Number(P_().gearOf(c).cp) || 0;
		const v = await TBUI.prompt("Coins (in gp; 12.5 = 12 gp 5 sp)", String(coins / 100));
		if (v == null) return;
		P_().gearOf(c).cp = Math.max(0, Math.round((Number(String(v).replace(",", ".")) || 0) * 100));
		P_().log(c, `Store: coins set to ${S_().money(P_().gearOf(c).cp)}`);
		save(c, {derived: true});
	};
	const phonePage = async (c, d, st) => {
		const v = S_().vendorOf(st.vendor);
		const coins = h("button.pm-coins", {title: "Change the coins", on: {click: () => editCoins(c)}}, S_().money(P_().gearOf(c).cp));
		if (!ui.mIn) {
			return h("div.char-main.pm",
				h("div.pm-head",
					h("div.pm-r1", h("b.pm-name", "Store"), h("span.pm-round", c.name || ""), coins),
					h("div.pm-sels",
						select(st.settle, S_().SETTLEMENTS.map(x => ({value: x.id, label: x.label})), (x) => { st.settle = x; save(c); }, "Settlement"),
						select(st.profile, S_().PROFILES.map(x => ({value: x.id, label: `${x.label.split(" ")[0]} · DC ${x.dc}`})), (x) => { st.profile = x; save(c); }, "How hard the vendor bargains"),
						select(st.attitude, S_().ATTITUDES.map(x => ({value: x.id, label: x.label})), (x) => { st.attitude = x; save(c); }, "Vendor's attitude")),
				),
				h("div.pl-body.pm-body", h("div.pm-vgrid", ...S_().VENDORS.map(x => h("button.pm-vendor", {class: x.id === st.vendor ? "on" : "", on: {click: () => enterVendor(c, st, x)}}, h("span.ic", x.icon), h("b", x.name), h("small", x.desc))))),
			);
		}
		const tab = ui.mTab || "buy";
		const disc = discountOf(st);
		const prof = S_().PROFILES.find(x => x.id === st.profile);
		const n = st.cart.reduce((t, x) => t + x.qty, 0);
		const total = st.cart.reduce((t, x) => t + buyCp(st, x.cp) * x.qty, 0);
		const go = (t) => { ui.mTab = t; ui.toTop = true; render(); };
		const content = {
			buy: [await catalogCard(c, st, v)],
			sell: [sellCard(c, d, st, v), TBViewPlay.inventoryCard(c, d, save)],
			barter: [barterCard(c, d, st, v), logCard(c)],
			cart: [cartCard(c, st)],
		}[tab];
		return h("div.char-main.pm",
			h("div.pm-head",
				h("div.pm-r1", h("button.btn.ghost.small", {title: "All vendors", on: {click: () => { ui.mIn = false; render(); }}}, "‹"), h("b.pm-name", `${v.icon} ${v.name}`), coins),
				h("div.pm-chips",
					h("span.pm-chip", S_().settlementOf(st.settle).label),
					h("span.pm-chip", `${prof.label} · DC ${prof.dc}`),
					h("button.pm-chip", {class: disc ? "good" : "", on: {click: () => go("barter")}}, disc ? `Haggled −${disc}%` : "Haggle"),
					st.visit.markup ? h("span.pm-chip.bad", `+${st.visit.markup}%`) : null),
			),
			h("div.pm-tabs", ...[["buy", "Buy"], ["sell", "Sell"], ["barter", "Barter"], ["cart", `Cart${n ? ` (${n})` : ""}`]].map(([k, l]) => h("button", {class: k === tab ? "active" : "", on: {click: () => go(k)}}, l))),
			h("div.pl-body.pm-body", h("div.pl-col", ...content)),
			n && tab !== "cart" ? h("button.pm-cartbar", {on: {click: () => go("cart")}}, h("span", `Cart · ${n} item${n > 1 ? "s" : ""}`), h("b", `${S_().money(total)} · Pay`)) : null,
		);
	};
	// endregion

	const render = async () => {
		const root = document.getElementById("view-store");
		if (!root) return;
		if (ui.busy) { ui.again = true; return; }
		ui.busy = true;
		try {
			const sess = TBViewPlay.state;
			const c = sess.session ? TBStore.char(sess.charId) : null;
			if (!c) {
				clear(root);
				root.appendChild(h("div.char-main", h("div.empty", h("h2", "The Store opens during a session"), h("p", "Start a session with a character in the Play tab; the Store then buys and sells for that character."), h("button.btn.primary", {on: {click: () => TBApp.setView("play")}}, "Go to Play"))));
				return;
			}
			const st = storeOf(c);
			const v = S_().vendorOf(st.vendor);
			const d = await TBViewPlay.effectiveOf(c);
			const body = root.querySelector(".pl-body");
			const scroll = body ? body.scrollTop : 0;
			if (TBApp.isPhone()) {
				const page = await phonePage(c, d, st);
				clear(root);
				root.appendChild(page);
				const nb = root.querySelector(".pm-body");
				if (nb) nb.scrollTop = ui.toTop ? 0 : scroll;
				ui.toTop = false;
				if (ui.focus) {
					ui.focus = false;
					const inp = root.querySelector(".st-cat input[type=search]");
					if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
				}
				return;
			}
			const cols = [
				h("div.pl-col", vendorsCard(c, st)),
				h("div.pl-col", await catalogCard(c, st, v)),
				h("div.pl-col", cartCard(c, st), TBViewPlay.inventoryCard(c, d, save), barterCard(c, d, st, v), sellCard(c, d, st, v), logCard(c)),
			];
			const nb = h("div.pl-body", h("div.pl-grid.st-grid", ...cols));
			clear(root);
			root.appendChild(h("div.char-main", header(c, st), nb));
			nb.scrollTop = scroll;
			if (ui.toTop) { ui.toTop = false; root.querySelector(".st-cat")?.scrollIntoView({block: "start"}); }
			if (ui.focus) {
				ui.focus = false;
				const inp = root.querySelector(".st-cat input[type=search]");
				if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
			}
		} catch (e) {
			console.error(e);
			root.appendChild(h("pre", {style: {color: "#f99", padding: "12px"}}, e.stack || String(e)));
		} finally {
			ui.busy = false;
			if (ui.again) { ui.again = false; render(); }
		}
	};
	// endregion

	return {render, ui, storeOf, discountOf, approach};
})();
