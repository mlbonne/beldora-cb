"use strict";

/**
 * Encounter builder rules and generators, on top of the 5etools bestiary and treasure tables:
 *  - XP budgets (DMG 2024: Low / Moderate / High; DMG 2014: Easy…Deadly with the group multiplier)
 *  - a lean index of every monster, with filters (CR, type, habitat, size, source, legendary)
 *  - a random encounter generator that spends the budget in a chosen shape (solo, leader + minions, horde…)
 *  - eight balanced loot options for a d8 (one of them coins), priced with the 2024 DMG
 *  - a d6 table of extra actions scaled to the encounter's CR
 *  - the payload for the encounter PDF (stat blocks rendered to plain, print-friendly HTML)
 */
globalThis.TBEnc = (() => {
	const D = () => TBData;
	const _cache = {};
	const once = (key, fn) => (_cache[key] = _cache[key] || fn());
	const lc = (s) => String(s ?? "").toLowerCase();
	const keyOf = (name, source) => `${lc(name)}|${lc(source)}`;

	// region Random helpers
	const rnd = (a, b) => a + Math.random() * (b - a);
	const rint = (a, b) => Math.floor(rnd(Math.ceil(a), Math.floor(b) + 1));
	const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
	const pickWeighted = (arr, w) => {
		const total = arr.reduce((a, x) => a + w(x), 0);
		let r = Math.random() * total;
		for (const x of arr) { r -= w(x); if (r <= 0) return x; }
		return arr[arr.length - 1];
	};
	const shuffle = (arr) => {
		const a = [...arr];
		for (let i = a.length - 1; i > 0; --i) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
		return a;
	};
	const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
	// endregion

	// region Rules
	const XP_2024 = {
		low: [0, 50, 100, 150, 250, 500, 600, 750, 1000, 1300, 1600, 1900, 2200, 2600, 2900, 3300, 3800, 4500, 5000, 5500, 6400],
		moderate: [0, 75, 150, 225, 375, 750, 1000, 1300, 1700, 2000, 2300, 2900, 3700, 4200, 4900, 5400, 6100, 7200, 8700, 10700, 13200],
		high: [0, 100, 200, 400, 500, 1100, 1400, 1700, 2100, 2600, 3100, 4100, 4700, 5400, 6200, 7800, 9800, 11700, 14200, 17200, 22000],
	};
	const XP_2014 = {
		easy: [0, 25, 50, 75, 125, 250, 300, 350, 450, 550, 600, 800, 1000, 1100, 1250, 1400, 1600, 2000, 2100, 2400, 2800],
		medium: [0, 50, 100, 150, 250, 500, 600, 750, 900, 1100, 1200, 1600, 2000, 2200, 2500, 2800, 3200, 3900, 4100, 4900, 5700],
		hard: [0, 75, 150, 225, 375, 750, 900, 1100, 1400, 1600, 1900, 2400, 3000, 3400, 3800, 4300, 4800, 5900, 6300, 7300, 8500],
		deadly: [0, 100, 200, 400, 500, 1100, 1400, 1700, 2100, 2400, 2800, 3600, 4500, 5100, 5700, 6400, 7200, 8800, 9500, 10900, 12700],
	};
	/** XP needed to reach each level (index = level). */
	const LEVEL_XP = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

	const RULES = {
		2024: {label: "DMG 2024", table: XP_2024, tiers: [["low", "Low"], ["moderate", "Moderate"], ["high", "High"]]},
		2014: {label: "DMG 2014", table: XP_2014, tiers: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["deadly", "Deadly"]]},
	};
	const rulesOf = (enc) => RULES[enc.rules] || RULES[2024];

	/** DMG 2014 encounter multiplier; small parties count one step higher, large ones one step lower. */
	const MULT_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
	const multiplier = (count, partySize) => {
		if (!count) return 1;
		let ix = count === 1 ? 1 : count === 2 ? 2 : count <= 6 ? 3 : count <= 10 ? 4 : count <= 14 ? 5 : 6;
		if (partySize < 3) ix++;
		else if (partySize >= 6) ix--;
		return MULT_STEPS[Math.max(0, Math.min(MULT_STEPS.length - 1, ix))];
	};

	const party = (enc) => {
		const rows = (enc.party || []).filter(r => r.count > 0).map(r => ({count: Math.max(1, Math.min(12, r.count | 0)), level: Math.max(1, Math.min(20, r.level | 0))}));
		const size = rows.reduce((a, r) => a + r.count, 0) || 1;
		const avgLevel = rows.length ? rows.reduce((a, r) => a + r.count * r.level, 0) / size : 1;
		return {rows, size, avgLevel, level: Math.max(1, Math.round(avgLevel))};
	};

	/** Budgets, the encounter's XP and its difficulty. */
	const evaluate = (enc, creatures = enc.creatures || []) => {
		const P = party(enc);
		const R = rulesOf(enc);
		let enemyXp = 0;
		let enemyCount = 0;
		let allyXp = 0;
		creatures.forEach(c => {
			const xp = (c.xp || 0) * (c.count || 1);
			if (c.ally) allyXp += xp;
			else { enemyXp += xp; enemyCount += c.count || 1; }
		});
		const tiers = R.tiers.map(([id, label]) => ({id, label, xp: P.rows.reduce((a, r) => a + r.count * R.table[id][r.level], 0) + allyXp}));
		const mult = enc.rules === "2014" ? multiplier(enemyCount, P.size) : 1;
		const effective = Math.round(enemyXp * mult);
		let ix = -1;
		tiers.forEach((t, i) => { if (enc.rules === "2014" ? effective >= t.xp : effective > (tiers[i - 1]?.xp ?? 0)) ix = i; });
		let difficulty;
		if (!enemyXp) difficulty = {id: "none", label: "No enemies", ix: -1};
		else if (enc.rules === "2014") difficulty = ix < 0 ? {id: "trivial", label: "Trivial", ix: -1} : {...tiers[ix], ix};
		else if (effective > tiers[tiers.length - 1].xp) difficulty = {id: "beyond", label: "Beyond High", ix: tiers.length};
		else if (effective < tiers[0].xp * 0.5) difficulty = {id: "trivial", label: "Trivial", ix: -1};
		else difficulty = {...tiers[Math.max(0, ix)], ix: Math.max(0, ix)};
		const perPc = Math.floor(enemyXp / P.size);
		const levelShare = P.rows.map(r => {
			const need = r.level >= 20 ? 0 : LEVEL_XP[r.level + 1] - LEVEL_XP[r.level];
			return {level: r.level, count: r.count, need, pct: need ? Math.round(perPc / need * 100) : null};
		});
		return {party: P, rules: R, tiers, enemyXp, allyXp, enemyCount, mult, effective, difficulty, perPc, levelShare};
	};

	const tierBudget = (enc, tierId) => {
		const ev = evaluate(enc, []);
		const ix = ev.tiers.findIndex(t => t.id === tierId);
		const t = ev.tiers[ix < 0 ? 1 : ix];
		const prev = ev.tiers[(ix < 0 ? 1 : ix) - 1];
		return {max: t.xp, min: prev ? prev.xp : Math.round(t.xp * 0.55), ev};
	};
	// endregion

	// region Monster index
	const HABITATS = ["arctic", "coastal", "desert", "forest", "grassland", "hill", "mountain", "swamp", "underdark", "underwater", "urban", "planar"];
	const TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"];
	const SIZES = [["T", "Tiny"], ["S", "Small"], ["M", "Medium"], ["L", "Large"], ["H", "Huge"], ["G", "Gargantuan"]];

	const crValue = (cr) => (cr && typeof cr === "object" ? cr.cr : cr);

	const loadMonsters = () => once("monsters", async () => {
		const [json] = await Promise.all([DataUtil.monster.loadJSON(), DataUtil.monster.pPreloadLegendaryGroupsSite()]);
		// Installed 5etools homebrew creatures join the index
		const all = [...(json.monster || []), ...(globalThis.TBBrew ? await TBBrew.get("monster") : [])];
		const present = new Set(all.map(m => keyOf(m.name, m.source)));
		const out = [];
		for (const m of all) {
			if (m.summonedBySpell || m.summonedByClass || m.summonedBySpellLevel != null) continue;
			const crRaw = crValue(m.cr);
			if (crRaw == null) continue;
			let cr;
			try { cr = Parser.crToNumber(crRaw); } catch (e) { continue; }
			if (!(cr >= 0) || cr > 30) continue;
			let typeObj = {types: [], asText: ""};
			try { typeObj = Parser.monTypeToFullObj(m.type); } catch (e) { /* odd type */ }
			const reprinted = (m.reprintedAs || []).some(r => {
				const [n, s] = String(typeof r === "string" ? r : r.uid || "").split("|");
				return present.has(keyOf(n, s || m.source));
			});
			out.push({
				key: keyOf(m.name, m.source),
				name: m.name,
				source: m.source,
				srcShort: D().sourceShort(m.source),
				cr,
				crText: String(crRaw),
				xp: Parser.crToXpNumber(crRaw) || 0,
				types: (typeObj.types || []).map(lc),
				typeText: typeObj.asText || "",
				sizes: m.size || [],
				envs: [...new Set((m.environment || []).map(e => lc(e).replace(/^planar.*/, "planar")))],
				legendary: !!(m.legendary || m.mythic),
				named: !!m.isNamedCreature,
				reprinted,
				modern: D().isModern(m.source),
				treasure: m.treasure || [],
				ent: m,
			});
		}
		out.sort((a, b) => a.name.localeCompare(b.name) || (a.modern === b.modern ? 0 : a.modern ? -1 : 1));
		return out;
	});

	const byKey = async (key) => (await loadMonsters()).find(m => m.key === key);

	const DEFAULT_FILTERS = {crMin: null, crMax: null, types: [], envs: [], sizes: [], sourceMode: "dedupe", sources: [], legendary: "allow", named: false};

	const SOURCE_MODES = [
		["dedupe", "All books, newest version of each monster"],
		["modern", "2024-era books only"],
		["xmm", "Monster Manual 2024 only"],
		["all", "Everything (2014 versions too)"],
	];

	const matches = (m, f = {}) => {
		f = {...DEFAULT_FILTERS, ...f};
		if (f.crMin != null && f.crMin !== "" && m.cr < Number(f.crMin)) return false;
		if (f.crMax != null && f.crMax !== "" && m.cr > Number(f.crMax)) return false;
		if (f.types.length && !m.types.some(t => f.types.includes(t))) return false;
		if (f.envs.length && !m.envs.some(e => e === "any" || f.envs.includes(e))) return false;
		if (f.sizes.length && !m.sizes.some(s => f.sizes.includes(s))) return false;
		if (f.legendary === "exclude" && m.legendary) return false;
		if (f.legendary === "only" && !m.legendary) return false;
		if (!f.named && m.named) return false;
		if (f.sources.length) return f.sources.includes(m.source);
		if (f.sourceMode === "xmm") return m.source === "XMM";
		if (f.sourceMode === "modern") return m.modern;
		if (f.sourceMode === "dedupe") return !m.reprinted;
		return true;
	};

	const filterPool = async (filters, search = "") => {
		const s = lc(search).trim();
		return (await loadMonsters()).filter(m => matches(m, filters) && (!s || lc(m.name).includes(s) || m.types.some(t => t.startsWith(s))));
	};

	const creatureFrom = (m, count = 1) => ({id: uid(), key: m.key, name: m.name, source: m.source, cr: m.crText, xp: m.xp, count, locked: false, ally: false});
	// endregion

	// region Random encounters
	const SHAPES = {
		solo: {label: "Solo monster", groups: () => [{count: 1, share: 1, role: "Solo"}]},
		leader: {label: "Leader + minions", groups: (P) => { const s = rnd(0.42, 0.6); return [{count: 1, share: s, role: "Leader"}, {count: rint(Math.max(2, P.size - 1), P.size * 2), share: 1 - s, role: "Minions"}]; }},
		elite: {label: "Leader, lieutenants & minions", groups: (P) => [{count: 1, share: 0.4, role: "Leader"}, {count: 2, share: 0.32, role: "Lieutenants"}, {count: rint(P.size, P.size + 3), share: 0.28, role: "Minions"}]},
		duo: {label: "Duo", groups: () => { const s = rnd(0.4, 0.6); return [{count: 1, share: s}, {count: 1, share: 1 - s}]; }},
		trio: {label: "Trio", groups: () => [{count: 1, share: 0.4}, {count: 1, share: 0.3}, {count: 1, share: 0.3}]},
		squad: {label: "Squad (one kind)", groups: (P) => [{count: rint(Math.max(2, P.size - 1), P.size + 2), share: 1}]},
		mixed: {label: "Mixed group", groups: (P) => [{count: rint(1, 2), share: 0.5}, {count: rint(2, Math.max(3, P.size)), share: 0.5}]},
		horde: {label: "Horde", groups: (P) => [{count: Math.min(12, rint(P.size * 2, P.size * 4)), share: 0.75, role: "Horde"}, {count: rint(1, 2), share: 0.25, role: "Boss"}]},
	};
	const SHAPE_WEIGHTS = {solo: 1, leader: 3, elite: 1.5, duo: 1.5, trio: 1.2, squad: 2, mixed: 2.5, horde: 1};

	/** Fill the encounter with random monsters (locked ones stay) aiming just under the chosen difficulty. */
	const generate = async (enc) => {
		const pool = await filterPool(enc.filters || {});
		if (!pool.length) throw new Error("No monsters match the filters.");
		const {min, max} = tierBudget(enc, enc.target || (enc.rules === "2014" ? "medium" : "moderate"));
		const P = party(enc);
		const locked = (enc.creatures || []).filter(c => c.locked);
		const aim = max * 0.9;
		const effOf = (list) => evaluate(enc, list).effective;
		const lockedEff = effOf(locked);
		if (lockedEff >= max) return {creatures: locked, shape: null};

		// Theme: share a habitat or a type with what is already there
		const filterEnvs = enc.filters?.envs || [];
		const themeOf = (m) => ({envs: filterEnvs.length ? filterEnvs : m.envs.filter(e => e !== "any"), types: m.types});
		// Same habitat when the first monster has one (or the filters pick one), otherwise the same creature type
		const fits = (m, th) => !th || (th.envs.length ? m.envs.some(e => th.envs.includes(e)) : m.types.some(t => th.types.includes(t)));
		const lockedMons = (await loadMonsters()).filter(m => locked.some(c => c.key === m.key));
		const baseTheme = lockedMons[0] ? themeOf(lockedMons[0]) : null;

		let best = null;
		for (let attempt = 0; attempt < 80; ++attempt) {
			const shapeId = enc.shape && SHAPES[enc.shape] ? enc.shape : pickWeighted(Object.keys(SHAPES), k => SHAPE_WEIGHTS[k]);
			const groups = SHAPES[shapeId].groups(P);
			const rem = enc.rules === "2014" ? (max - lockedEff) / multiplier(groups.reduce((a, g) => a + g.count, 0) + locked.reduce((a, c) => a + (c.ally ? 0 : c.count), 0), P.size) : max - lockedEff;
			let theme = baseTheme;
			const picks = [];
			const used = new Set(locked.map(c => c.key));
			for (const g of groups) {
				const per = rem * g.share / g.count;
				let cands = pool.filter(m => !used.has(m.key) && m.xp <= per * 1.08 && m.xp >= per * 0.35);
				if (!cands.length) cands = pool.filter(m => !used.has(m.key) && m.xp <= per * 1.08 && m.xp > 0);
				if (!cands.length) continue;
				if (theme && Math.random() < 0.92) {
					const themed = cands.filter(m => fits(m, theme));
					if (themed.length) cands = themed;
				}
				// Close to the per-creature budget; monsters with habitat data and current books are favoured
				const m = pickWeighted(cands, x => (Math.pow(x.xp / per, 3) + 0.02) * (x.envs.length ? 1.5 : 1) * (x.source === "XMM" ? 1.6 : x.modern ? 1.2 : 1));
				used.add(m.key);
				picks.push({...creatureFrom(m, g.count), role: g.role || null});
				if (!theme) theme = themeOf(m);
			}
			if (!picks.length) continue;
			// Trim or grow the counts until the total sits inside the band
			for (let i = 0; i < 30; ++i) {
				const eff = effOf([...locked, ...picks]);
				if (eff > max) {
					const multi = picks.filter(p => p.count > 1).sort((a, b) => b.count - a.count)[0];
					if (multi) multi.count--;
					else if (picks.length > 1) picks.splice(picks.indexOf([...picks].sort((a, b) => a.xp - b.xp)[0]), 1);
					else break;
				} else if (eff < aim * 0.92) {
					const grow = [...picks].sort((a, b) => a.xp - b.xp).find(p => effOf([...locked, ...picks.map(q => (q === p ? {...q, count: q.count + 1} : q))]) <= max);
					if (!grow || grow.count >= 12) break;
					grow.count++;
				} else break;
			}
			const eff = effOf([...locked, ...picks]);
			const score = (eff > max ? 10 + (eff - max) / max : Math.abs(eff - aim) / max + (eff < min ? 1 : 0)) + Math.random() * 0.03;
			if (!best || score < best.score) best = {score, picks, shapeId};
			if (score < 0.05) break;
		}
		if (!best) throw new Error("Could not fit any monster from the filters into this budget. Widen the CR range or the filters.");
		return {creatures: [...locked, ...best.picks], shape: best.shapeId};
	};

	const NAME_A = ["Ambush", "Clash", "Skirmish", "Stand", "Trouble", "Encounter", "Fight", "Assault", "Siege", "Reckoning"];
	const NAME_ENV = {arctic: "on the Ice", coastal: "on the Shore", desert: "in the Dunes", forest: "in the Woods", grassland: "on the Plains", hill: "in the Hills", mountain: "on the Pass", swamp: "in the Mire", underdark: "in the Deep", underwater: "beneath the Waves", urban: "in the Streets", planar: "beyond the Veil"};
	const suggestName = async (enc) => {
		const mons = await loadMonsters();
		const enemies = (enc.creatures || []).filter(c => !c.ally);
		if (!enemies.length) return "New Encounter";
		const top = [...enemies].sort((a, b) => b.xp * b.count - a.xp * a.count)[0];
		const m = mons.find(x => x.key === top.key);
		const env = (enc.filters?.envs || [])[0] || m?.envs.find(e => e !== "any");
		const short = top.name.replace(/\s*\(.*\)$/, "");
		const plural = top.count > 1 && !/(s|Swarm .*| of .*)$/i.test(short) ? "s" : "";
		return `${pick(NAME_A)}: ${short}${plural}${env && NAME_ENV[env] ? ` ${NAME_ENV[env]}` : ""}`;
	};
	// endregion

	// region Loot
	const RARITIES = ["common", "uncommon", "rare", "very rare", "legendary"];
	/** 2024 DMG magic item prices; consumables cost half. */
	const RARITY_GP = {common: 100, uncommon: 400, rare: 4000, "very rare": 40000, legendary: 200000};
	const LEVEL_RARITIES = (lvl) => lvl <= 4 ? ["common", "uncommon", "rare"] : lvl <= 10 ? ["common", "uncommon", "rare", "very rare"] : lvl <= 16 ? ["common", "uncommon", "rare", "very rare", "legendary"] : ["uncommon", "rare", "very rare", "legendary"];
	const THEMES = [["arcana", "Arcana"], ["armaments", "Armaments"], ["implements", "Implements"], ["relics", "Relics"]];
	const GENEROSITY = [["stingy", "Stingy (×½)", 0.5], ["standard", "Standard", 1], ["generous", "Generous (×2)", 2], ["hoard", "Treasure hoard", null]];
	const HOARD_AVG = [[4, 500], [10, 4400], [16, 36000], [99, 330000]];
	/** XDMG individual treasure, averaged per creature. */
	const indivAvg = (cr) => cr <= 4 ? 10.5 : cr <= 10 ? 90 : cr <= 16 ? 1100 : 9000;

	const loadLoot = () => once("loot", async () => {
		const [loot, items, spells] = await Promise.all([DataUtil.loadJSON("data/loot.json"), Renderer.item.pBuildList(), D().loadSpells()]);
		const itemsByKey = new Map(items.map(i => [keyOf(i.name, i.source), i]));
		const tagRef = (s) => {
			const m = /\{@item ([^|}]+)\|?([^|}]*)/.exec(s || "");
			return m ? keyOf(m[1], m[2] || "DMG") : null;
		};
		const tables = {};
		loot.magicItems.filter(t => t.source === "XDMG" && / - /.test(t.name)).forEach(t => {
			const [theme, rar] = t.name.split(" - ").map(lc);
			(tables[theme] ||= {})[rar] = t.table.map(r => ({w: r.max - r.min + 1, row: r}));
		});
		const gems = {};
		loot.gems.filter(g => g.source === "XDMG").forEach(g => { gems[g.type] = g.table; });
		const art = {};
		loot.artObjects.filter(g => g.source === "XDMG").forEach(g => { art[g.type] = g.table; });
		const gear = items.filter(i => i.source === "XPHB" && /^(G|AT|INS|TG|T|GS)\|/.test(i.type || "") && i.value > 0 && !i.rarity?.match(/rare|legendary/) && !/(Pack|Spellbook|Book)$/.test(i.name));
		return {itemsByKey, tagRef, tables, gems, art, gear, spells: spells.filter(s => s.source === "XPHB")};
	});

	const isConsumable = (it) => /^(P|SC|A|EXP|AF)\|/.test(it.type || "") || /^(Potion|Oil|Dust|Elixir|Philter|Bead|Elemental Gem|Quaal's Feather|Keoghtom|Marvelous Pigments|Universal Solvent|Sovereign Glue|Spell Scroll|Necklace of Fireballs|Ammunition)/i.test(it.name);
	const itemValue = (it) => it.value ? it.value / 100 : Math.round((RARITY_GP[it.rarity] || 50) * (isConsumable(it) ? 0.5 : 1));
	const gpText = (gp) => gp >= 1 ? `${Math.round(gp).toLocaleString("en-US")} gp` : gp >= 0.1 ? `${Math.round(gp * 10)} sp` : `${Math.max(1, Math.round(gp * 100))} cp`;
	const niceGp = (gp) => gp < 20 ? Math.max(1, Math.round(gp)) : gp < 200 ? Math.round(gp / 5) * 5 : gp < 2000 ? Math.round(gp / 10) * 10 : Math.round(gp / 100) * 100;

	const lootTarget = (enc, ev) => {
		const enemies = (enc.creatures || []).filter(c => !c.ally);
		const gen = GENEROSITY.find(g => g[0] === (enc.loot?.generosity || "standard")) || GENEROSITY[1];
		if (gen[2] == null) {
			const maxCr = Math.max(0, ...enemies.map(c => Parser.crToNumber(c.cr)));
			return HOARD_AVG.find(([c]) => maxCr <= c)[1];
		}
		const indiv = enemies.reduce((a, c) => a + indivAvg(Parser.crToNumber(c.cr)) * c.count, 0);
		return Math.max(5, Math.round(Math.max(indiv, ev.enemyXp / 10) * gen[2]));
	};

	/** An item from an XDMG theme table, resolved to its entity (choices and spell scrolls filled in). */
	const rollTableItem = (L, theme, rarity, filter = () => true) => {
		const rows = (L.tables[theme] || {})[rarity] || [];
		const cands = rows.map(r => {
			let refs = [];
			if (r.row.choose?.fromItems) refs = r.row.choose.fromItems.map(s => keyOf(...s.split("|")));
			else if (r.row.item) refs = [L.tagRef(r.row.item)];
			const ents = refs.map(k => L.itemsByKey.get(k)).filter(Boolean);
			return {w: r.w, ents, text: D().strip(r.row.item || "")};
		}).filter(c => c.ents.length && c.ents.some(filter));
		if (!cands.length) return null;
		const c = pickWeighted(cands, x => x.w);
		const ent = pick(c.ents.filter(filter));
		let name = ent.name;
		let note = "";
		const sc = /^Spell Scroll \((Cantrip|Level (\d))\)$/.exec(ent.name);
		if (sc) {
			const lvl = sc[2] ? Number(sc[2]) : 0;
			const sp = L.spells.filter(s => s.level === lvl);
			if (sp.length) note = pick(sp).name;
		}
		return {name, source: ent.source, rarity: ent.rarity, attune: !!ent.reqAttune, consumable: isConsumable(ent), gp: itemValue(ent), note, summary: D().summarize(ent.entries || [], 150), key: keyOf(ent.name, ent.source), theme};
	};

	const themeFor = (enc, mons, exclude = []) => {
		const tags = mons.flatMap(m => m.treasure || []).filter(t => THEMES.some(([k]) => k === t) && !exclude.includes(t));
		if (tags.length && Math.random() < 0.8) return pick(tags);
		return pick(THEMES.map(t => t[0]).filter(t => !exclude.includes(t)));
	};

	/** Best rarity for a value: the priciest allowed one that does not overshoot the target too much. */
	const rarityFor = (target, lvl, {consumable = false} = {}) => {
		const allowed = LEVEL_RARITIES(lvl);
		const k = consumable ? 0.5 : 1;
		const fit = allowed.filter(r => RARITY_GP[r] * k <= target * 1.35);
		return fit.length ? fit[fit.length - 1] : allowed[0];
	};

	const coinsLine = (gp) => ({kind: "coins", text: gpText(gp), gp});

	const fillCoins = (opt, target) => {
		const rest = niceGp(target - opt.value);
		if (rest >= Math.max(5, target * 0.12)) { opt.lines.push(coinsLine(rest)); opt.value += rest; }
		return opt;
	};

	const gemLines = (L, target, table, labelOf) => {
		const denoms = Object.keys(table).map(Number).sort((a, b) => b - a);
		const lines = [];
		let left = target;
		let guard = 0;
		while (left >= denoms[denoms.length - 1] * 0.8 && guard++ < 12) {
			const d = denoms.find(x => x <= left) || denoms[denoms.length - 1];
			const n = Math.max(1, Math.min(6, Math.floor(left / d)));
			const name = D().strip(pick(table[d])).replace(/\s*\(.*\)$/, "");
			const same = lines.find(l => l.text.endsWith(`${name} (${labelOf(d)})`));
			if (same) { same.qty += n; same.gp += n * d; same.text = `${same.qty} × ${name} (${labelOf(d)})`; } else lines.push({kind: "valuable", qty: n, text: `${n > 1 ? `${n} × ` : ""}${name} (${labelOf(d)})`, gp: n * d});
			left -= n * d;
		}
		if (!lines.length) {
			const d = denoms[denoms.length - 1];
			lines.push({kind: "valuable", qty: 1, text: `${D().strip(pick(table[d])).replace(/\s*\(.*\)$/, "")} (${labelOf(d)})`, gp: d});
		}
		return lines;
	};

	const LOOT_BUILDERS = {
		coins: (ctx) => {
			const gp = niceGp(ctx.target);
			return {kind: "coins", title: "Coin purse", lines: [coinsLine(gp)], value: gp};
		},
		gems: (ctx) => {
			const lines = gemLines(ctx.L, ctx.target, ctx.L.gems, d => `${d} gp`);
			return {kind: "gems", title: "Gemstones", lines, value: lines.reduce((a, l) => a + l.gp, 0)};
		},
		art: (ctx) => {
			const lines = gemLines(ctx.L, ctx.target * 0.85, ctx.L.art, d => `${d} gp`);
			return fillCoins({kind: "art", title: "Art object", lines, value: lines.reduce((a, l) => a + l.gp, 0)}, ctx.target);
		},
		consumables: (ctx) => {
			const lines = [];
			let value = 0;
			for (let i = 0; i < 4 && value < ctx.target * 0.75; ++i) {
				const left = ctx.target - value;
				const rar = rarityFor(left, ctx.level, {consumable: true});
				const it = rollTableItem(ctx.L, pick(["arcana", "implements", "armaments", "relics"]), rar, e => isConsumable(e) && itemValue(e) <= Math.max(left * 1.35, 60));
				if (!it) break;
				const same = lines.find(l => l.key === it.key && l.note === it.note);
				if (same) { same.qty++; same.gp += it.gp; } else lines.push({kind: "item", qty: 1, ...it, text: it.name});
				value += it.gp;
			}
			if (!lines.length) return null;
			lines.forEach(l => { if (l.qty > 1) l.text = `${l.qty} × ${l.name}`; });
			return fillCoins({kind: "consumables", title: "Consumables", lines, value}, ctx.target);
		},
		item: (ctx, {wild = false} = {}) => {
			const theme = wild ? themeFor(ctx.enc, [], ctx.usedThemes) : themeFor(ctx.enc, ctx.mons, ctx.usedThemes);
			const rar = rarityFor(ctx.target, ctx.level);
			let it = rollTableItem(ctx.L, theme, rar, e => !isConsumable(e));
			if (!it) it = rollTableItem(ctx.L, theme, rar);
			if (!it) return null;
			ctx.usedThemes.push(theme);
			const opt = {kind: "magic", title: `Magic item · ${THEMES.find(t => t[0] === theme)[1]}`, lines: [{kind: "item", qty: 1, ...it, text: it.name}], value: it.gp};
			return fillCoins(opt, ctx.target);
		},
		spoils: (ctx) => {
			const lines = [];
			let value = 0;
			for (const c of ctx.enemies) {
				const m = ctx.mons.find(x => x.key === c.key);
				for (const g of (m?.ent.gear || [])) {
					const ref = typeof g === "string" ? g : g.item;
					const qty = (typeof g === "object" && g.quantity) || 1;
					const [n, s] = String(ref).split("|");
					const it = ctx.L.itemsByKey.get(keyOf(n, s || "XPHB"));
					if (!it || !it.value) continue;
					const gp = it.value / 100 * qty * c.count;
					const same = lines.find(l => l.key === it.name);
					if (same) { same.qty += qty * c.count; same.gp += gp; } else lines.push({kind: "gear", key: it.name, name: it.name, qty: qty * c.count, gp});
					value += gp;
				}
			}
			for (let i = 0; i < 3 && value < ctx.target * 0.5 && ctx.L.gear.length; ++i) {
				const it = pick(ctx.L.gear.filter(g => g.value / 100 <= Math.max(ctx.target - value, 10)) || []);
				if (!it) break;
				const same = lines.find(l => l.key === it.name);
				if (same) { same.qty++; same.gp += it.value / 100; } else lines.push({kind: "gear", key: it.name, name: it.name, qty: 1, gp: it.value / 100});
				value += it.value / 100;
			}
			lines.forEach(l => { l.text = `${l.qty > 1 ? `${l.qty} × ` : ""}${l.name}`; });
			if (!lines.length) return null;
			return fillCoins({kind: "spoils", title: "Spoils & gear", lines, value}, ctx.target);
		},
		bundle: (ctx) => {
			const opt = {kind: "bundle", title: "Mixed bundle", lines: [], value: 0};
			const gem = gemLines(ctx.L, ctx.target * 0.3, ctx.L.gems, d => `${d} gp`).slice(0, 1);
			opt.lines.push(...gem);
			opt.value += gem.reduce((a, l) => a + l.gp, 0);
			const it = rollTableItem(ctx.L, pick(["arcana", "implements"]), rarityFor(ctx.target * 0.4, ctx.level, {consumable: true}), e => isConsumable(e) && itemValue(e) <= Math.max(ctx.target * 0.6, 60));
			if (it) { opt.lines.push({kind: "item", qty: 1, ...it, text: it.name}); opt.value += it.gp; }
			const gp = Math.max(0, ctx.target - opt.value);
			if (gp >= 1) {
				const pp = gp >= 500 ? Math.floor(gp * 0.4 / 10) : 0;
				const sp = gp < 100 ? Math.round(gp * 0.3 * 10) : 0;
				const g = Math.round(gp - pp * 10 - sp / 10);
				const parts = [pp ? `${pp} pp` : "", g ? `${g} gp` : "", sp ? `${sp} sp` : ""].filter(Boolean);
				opt.lines.unshift({kind: "coins", text: parts.join(", "), gp});
				opt.value += gp;
			}
			return opt;
		},
	};

	/** Slot plan for the d8: 1 is always coins. */
	const LOOT_SLOTS = ["coins", "gems", "art", "consumables", "item", "item-wild", "spoils", "bundle"];

	const lootSlot = (ctx, slot) => {
		const fn = slot === "item-wild" ? (c) => LOOT_BUILDERS.item(c, {wild: true}) : LOOT_BUILDERS[slot];
		let opt = null;
		try { opt = fn(ctx); } catch (e) { console.warn("loot", slot, e); }
		if (!opt) opt = LOOT_BUILDERS[slot === "spoils" ? "gems" : "bundle"](ctx);
		opt.slot = slot;
		opt.value = Math.round(opt.value);
		return opt;
	};

	const lootContext = async (enc) => {
		const L = await loadLoot();
		const mons = await loadMonsters();
		const ev = evaluate(enc);
		const enemies = (enc.creatures || []).filter(c => !c.ally);
		return {L, enc, ev, enemies, mons: mons.filter(m => enemies.some(c => c.key === m.key)), target: lootTarget(enc, ev), level: ev.party.level, usedThemes: []};
	};

	const generateLoot = async (enc) => {
		const ctx = await lootContext(enc);
		return {target: ctx.target, options: LOOT_SLOTS.map(s => lootSlot(ctx, s))};
	};

	const rerollLoot = async (enc, ix) => {
		const ctx = await lootContext(enc);
		ctx.usedThemes = (enc.loot.options || []).filter((o, i) => i !== ix && o.kind === "magic").map(o => o.lines.find(l => l.theme)?.theme).filter(Boolean);
		enc.loot.options[ix] = lootSlot(ctx, enc.loot.options[ix]?.slot || LOOT_SLOTS[ix]);
		enc.loot.target = ctx.target;
	};
	// endregion

	// region Extra actions
	const saveDcFor = (cr) => cr < 4 ? 13 : cr < 5 ? 14 : cr < 8 ? 15 : cr < 11 ? 16 : cr < 13 ? 17 : cr < 17 ? 18 : cr < 21 ? 19 : cr < 24 ? 20 : cr < 27 ? 21 : cr < 30 ? 22 : 23;
	const dmgFor = (cr, frac = 0.42) => {
		const avg = Math.max(3, (6 * Math.max(cr, 0.25) + 5) * frac);
		const die = cr < 1 ? 6 : cr < 5 ? 8 : 10;
		const n = Math.max(1, Math.round(avg / ((die + 1) / 2)));
		return `${Math.floor(n * (die + 1) / 2)} (${n}d${die})`;
	};

	/** Extra options for the monsters. Tags: "any", a creature type, or a habitat. */
	const EXTRA_POOL = [
		{tags: ["any"], name: "Rally Cry", use: "Bonus Action · 1/fight", text: "When an ally is Bloodied, a creature shouts; each ally within 30 ft. that can hear it gains {th} Temporary Hit Points and Advantage on its next attack roll."},
		{tags: ["any"], name: "Focus Fire", use: "Bonus Action", text: "The creature points out a foe it can see within 60 ft. Until the start of its next turn, attack rolls by its allies against that foe have Advantage."},
		{tags: ["any"], name: "Shove and Pin", use: "Action", text: "Target within 5 ft.: Strength save DC {dc} or pushed 10 ft. and Prone; if another enemy is adjacent, it is also Grappled (escape DC {dc})."},
		{tags: ["any"], name: "Thrown Debris", use: "Action", text: "Range 30/60 ft., one target: Dexterity save DC {dc}, taking {dmg} Bludgeoning damage on a failure or half on a success."},
		{tags: ["any"], name: "Dying Strike", use: "Reaction", text: "When the creature drops to 0 Hit Points, it makes one melee attack (+{atk} to hit) against a creature within reach before it falls."},
		{tags: ["any"], name: "Call for Help", use: "Action · 1/fight", text: "The creature calls for aid. At the end of round 1d4 + 1, {reinf} arrive at the nearest entrance."},
		{tags: ["any"], name: "Fighting Retreat", use: "Bonus Action", text: "The creature takes the Disengage action and moves up to half its Speed; the next attack roll against it before its next turn has Disadvantage."},
		{tags: ["any"], name: "Dirty Trick", use: "Action", text: "Sand, spit or a flash of light: one creature within 5 ft. makes a Constitution save DC {dc} or has the Blinded condition until the end of its next turn."},
		{tags: ["any"], name: "Bodyguard", use: "Reaction", text: "When an ally within 5 ft. is hit by an attack, the creature swaps places with it and becomes the target of that attack instead."},
		{tags: ["any"], name: "Coordinated Strike", use: "Reaction", text: "When an ally hits a creature within 5 ft. of this creature, this creature makes one melee attack (+{atk}) against the same target."},
		{tags: ["any"], name: "Second Wind", use: "Bonus Action · 1/fight", text: "A Bloodied creature regains {heal} Hit Points and ends one condition affecting it."},
		{tags: ["any"], name: "Morale Break", use: "Trigger", text: "When the leader falls or half the group is down, each remaining enemy makes a Wisdom save DC 10: on a failure it flees, surrenders or begs for terms."},
		{tags: ["humanoid"], name: "Alchemist's Fire", use: "Action · 1/fight", text: "Range 20 ft.: Dexterity save DC {dc} or take {dmg} Fire damage and start Burning (1d4 Fire at the start of each turn; an action ends it)."},
		{tags: ["humanoid"], name: "Net Toss", use: "Action", text: "Range 15 ft., one Large or smaller creature: Dexterity save DC {dc} or Restrained until a creature uses an action to make a DC {dc} Strength (Athletics) check to free it."},
		{tags: ["humanoid"], name: "Smoke Bomb", use: "Bonus Action · 1/fight", text: "A 10-ft.-radius Sphere of smoke is Heavily Obscured until the end of the creature's next turn; the creature can then take the Hide action."},
		{tags: ["humanoid"], name: "Scatter Caltrops", use: "Action", text: "A 5-ft. square becomes Difficult Terrain; a creature entering it makes a Dexterity save DC {dc} or takes 1 Piercing damage and its Speed is 0 until the end of the turn."},
		{tags: ["humanoid"], name: "Parley", use: "Free · 1/fight", text: "Once Bloodied, the leader offers terms: safe passage for coin, a hostage swap, or information. A DC {dc} Persuasion or Intimidation check ends the fight."},
		{tags: ["beast", "monstrosity"], name: "Pounce", use: "Bonus Action · Recharge 5–6", text: "The creature moves up to its Speed straight at a foe; the foe makes a Strength save DC {dc} or is knocked Prone and takes {dmgS} damage."},
		{tags: ["beast", "monstrosity"], name: "Drag Away", use: "Action", text: "The creature drags a Grappled foe up to its Speed without Opportunity Attacks; the foe takes {dmgS} damage."},
		{tags: ["beast"], name: "Pack Howl", use: "Action · 1/fight", text: "Each foe within 30 ft. that can hear the pack makes a Wisdom save DC {dc} or has the Frightened condition until the end of its next turn."},
		{tags: ["undead"], name: "Grave Chill", use: "Action", text: "One creature within 5 ft.: Constitution save DC {dc}, taking {dmg} Necrotic damage on a failure (half on a success) and it can't regain Hit Points until the start of its next turn."},
		{tags: ["undead"], name: "Refuse to Die", use: "Trigger · 1/fight", text: "When reduced to 0 Hit Points by damage other than Radiant or a critical hit, the creature makes a Constitution save DC 5 + the damage taken; on a success it drops to 1 Hit Point instead."},
		{tags: ["undead", "fiend"], name: "Death Throes", use: "Trigger", text: "When the creature dies it bursts: each creature within 10 ft. makes a Dexterity save DC {dc}, taking {dmgS} Necrotic or Fire damage (half on a success)."},
		{tags: ["fiend"], name: "Hellish Taunt", use: "Bonus Action", text: "One foe within 30 ft. makes a Wisdom save DC {dc}; on a failure it has Disadvantage on attack rolls against creatures other than this fiend until the end of its next turn."},
		{tags: ["fiend", "celestial"], name: "Searing Brand", use: "Action · Recharge 5–6", text: "One creature within 60 ft.: Constitution save DC {dc} or take {dmg} Fire (fiend) or Radiant (celestial) damage and shed bright light, unable to benefit from being Invisible, for 1 minute."},
		{tags: ["dragon"], name: "Tail Sweep", use: "Action · Recharge 5–6", text: "Each creature within 10 ft. makes a Dexterity save DC {dc}, taking {dmg} Bludgeoning damage and falling Prone on a failure (half damage only on a success)."},
		{tags: ["dragon"], name: "Wing Buffet", use: "Reaction", text: "When a foe moves within 10 ft., each creature within 10 ft. makes a Strength save DC {dc} or is pushed 15 ft. and knocked Prone; the dragon may fly up to half its Speed."},
		{tags: ["dragon", "giant"], name: "Terrifying Roar", use: "Action · 1/fight", text: "Each foe within 60 ft. makes a Wisdom save DC {dc} or has the Frightened condition for 1 minute (save again at the end of each of its turns)."},
		{tags: ["giant"], name: "Boulder Toss", use: "Action", text: "Ranged attack +{atk}, range 60/240 ft.: {dmg} Bludgeoning damage, and a Large or smaller target is knocked Prone."},
		{tags: ["giant", "construct"], name: "Ground Stomp", use: "Action · Recharge 5–6", text: "Each creature within 15 ft. on the ground makes a Dexterity save DC {dc}, taking {dmgS} Bludgeoning damage and falling Prone on a failure."},
		{tags: ["aberration"], name: "Psychic Static", use: "Action", text: "Each foe within 20 ft. makes an Intelligence save DC {dc}, taking {dmgS} Psychic damage and being unable to take Reactions until the start of its next turn on a failure."},
		{tags: ["aberration", "fey"], name: "Warp Step", use: "Bonus Action", text: "The creature teleports up to 30 ft. to an unoccupied space it can see; the next attack it makes this turn has Advantage."},
		{tags: ["fey"], name: "Bewitching Laughter", use: "Action · 1/fight", text: "One creature within 30 ft. makes a Wisdom save DC {dc} or has the Charmed condition (and Incapacitated by laughter) until the end of its next turn."},
		{tags: ["elemental"], name: "Elemental Surge", use: "Action · Recharge 5–6", text: "A 10-ft. Emanation of the creature's element: Dexterity save DC {dc}, {dmg} damage of its type on a failure, half on a success; the area is Difficult Terrain until the end of its next turn."},
		{tags: ["construct"], name: "Overclock", use: "Bonus Action · 1/fight", text: "The construct makes one extra attack this turn; afterwards its Speed is halved until the end of its next turn."},
		{tags: ["celestial"], name: "Radiant Flare", use: "Action · 1/fight", text: "Each foe within 15 ft. makes a Constitution save DC {dc} or has the Blinded condition until the end of its next turn."},
		{tags: ["ooze"], name: "Split", use: "Reaction", text: "When hit by Slashing damage while above 10 Hit Points, the ooze splits into two, each with half the remaining Hit Points."},
		{tags: ["plant", "forest", "swamp"], name: "Grasping Roots", use: "Action", text: "A 15-ft. square within 60 ft. becomes Difficult Terrain; creatures in it make a Strength save DC {dc} or are Restrained until they escape (DC {dc})."},
		{tags: ["forest", "grassland"], name: "Under Cover", use: "Bonus Action", text: "Tall grass or underbrush: the creature takes the Hide action if it is at least Lightly Obscured, even while being watched."},
		{tags: ["underdark"], name: "Douse the Light", use: "Action", text: "The creature snuffs a torch or lantern within 30 ft.; that area becomes Darkness for creatures without Darkvision."},
		{tags: ["underdark", "mountain", "hill"], name: "Rockfall", use: "Action · 1/fight", text: "The creature brings down loose rock: each creature in a 10-ft. square makes a Dexterity save DC {dc}, taking {dmg} Bludgeoning damage and becoming Restrained (escape DC {dc}) on a failure."},
		{tags: ["urban"], name: "Through the Crowd", use: "Bonus Action", text: "The creature slips into a crowd or behind carts: it moves up to half its Speed and has Half Cover until the start of its next turn."},
		{tags: ["swamp", "coastal"], name: "Sucking Mud", use: "Action", text: "One foe within 30 ft. standing on soft ground makes a Strength save DC {dc} or its Speed is 0 until the end of its next turn."},
		{tags: ["coastal", "underwater"], name: "Undertow", use: "Action", text: "A foe in water within 15 ft. makes a Strength save DC {dc} or is pulled 15 ft. toward the creature and pulled under (can't breathe until it surfaces)."},
		{tags: ["arctic"], name: "Thin Ice", use: "Action · 1/fight", text: "The creature cracks the ice: each creature in a 10-ft. square makes a Dexterity save DC {dc} or falls into freezing water ({dmgS} Cold damage, Speed halved)."},
		{tags: ["desert"], name: "Sand Blast", use: "Action", text: "A 15-ft. Cone of sand: Constitution save DC {dc} or Blinded until the end of the target's next turn."},
		{tags: ["planar"], name: "Planar Rift", use: "Action · 1/fight", text: "A rift opens for 1 round: each creature within 10 ft. of a point makes a Charisma save DC {dc} or is shunted to an unoccupied space 30 ft. away and takes {dmgS} Force damage."},
	];

	const extraContext = async (enc) => {
		const mons = await loadMonsters();
		const enemies = (enc.creatures || []).filter(c => !c.ally);
		const ents = enemies.map(c => mons.find(m => m.key === c.key)).filter(Boolean);
		const crs = enemies.map(c => Parser.crToNumber(c.cr));
		const topCr = crs.length ? Math.max(...crs) : 1;
		const mean = crs.length ? enemies.reduce((a, c) => a + Parser.crToNumber(c.cr) * c.count * c.xp, 0) / Math.max(1, enemies.reduce((a, c) => a + c.count * c.xp, 0)) : 1;
		const cr = Math.max(mean, topCr * 0.7);
		const weakest = [...enemies].sort((a, b) => a.xp - b.xp)[0];
		// Terrain actions follow the chosen habitat, or one most of the foes share
		let envs = enc.filters?.envs || [];
		if (!envs.length && ents.length) {
			const counts = {};
			ents.forEach(m => m.envs.filter(e => e !== "any").forEach(e => { counts[e] = (counts[e] || 0) + 1; }));
			envs = Object.keys(counts).filter(e => counts[e] >= Math.max(1, Math.ceil(ents.length * 0.6)));
		}
		const tags = new Set(["any", ...ents.flatMap(m => m.types), ...envs]);
		const dc = saveDcFor(cr);
		const vars = {
			dc, atk: `${dc - 8}`, dmg: dmgFor(cr), dmgS: dmgFor(cr, 0.25),
			th: Math.max(2, Math.round(2 + cr * 1.5)), heal: dmgFor(cr, 0.5),
			reinf: weakest ? `${Math.max(1, Math.round(weakest.count / 2) || 2)} more ${weakest.name}${Math.round(weakest.count / 2) > 1 ? "s" : ""}` : "1d4 allies",
		};
		return {tags, vars};
	};

	const fillExtra = (x, vars) => ({name: x.name, use: x.use, tag: x.tags[0], text: x.text.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m)});

	const generateExtras = async (enc) => {
		const {tags, vars} = await extraContext(enc);
		const specific = shuffle(EXTRA_POOL.filter(x => !x.tags.includes("any") && x.tags.some(t => tags.has(t))));
		const generic = shuffle(EXTRA_POOL.filter(x => x.tags.includes("any")));
		const chosen = [...specific.slice(0, 3), ...generic].slice(0, 6);
		return shuffle(chosen).map(x => fillExtra(x, vars));
	};

	const rerollExtra = async (enc, ix) => {
		const {tags, vars} = await extraContext(enc);
		const have = new Set(enc.extras.map(e => e.name));
		const cands = EXTRA_POOL.filter(x => !have.has(x.name) && x.tags.some(t => tags.has(t)));
		if (cands.length) enc.extras[ix] = fillExtra(pick(cands), vars);
	};
	// endregion

	// region Print payload
	/** 5etools HTML reduced to plain print markup: b/i/p/lists/tables only. */
	const KEEP = new Set(["B", "STRONG", "I", "EM", "P", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BR"]);
	const simplify = (html) => {
		const tpl = document.createElement("template");
		tpl.innerHTML = html;
		tpl.content.querySelectorAll(".ve-rd__h-toggle, [data-rd-h-toggle-button], script, style, button").forEach(e => e.remove());
		tpl.content.querySelectorAll(".entry-title-inner").forEach(e => { const b = document.createElement("b"); b.innerHTML = e.innerHTML; e.replaceWith(b); });
		const walk = (node) => {
			[...node.childNodes].forEach(ch => {
				if (ch.nodeType !== Node.ELEMENT_NODE) return;
				walk(ch);
				if (KEEP.has(ch.tagName)) {
					[...ch.attributes].forEach(a => ch.removeAttribute(a.name));
				} else ch.replaceWith(...ch.childNodes);
			});
		};
		walk(tpl.content);
		return tpl.innerHTML.replace(/\s+/g, " ").replace(/<p>\s*<\/p>/g, "").trim();
	};

	const renderNamed = (ent) => {
		if (ent.rendered) return simplify(ent.rendered);
		const body = simplify(Renderer.get().setFirstSection(true).render({type: "entries", entries: ent.entries || []}));
		if (!ent.name) return body;
		const name = `<b><i>${D().strip(ent.name)}.</i></b> `;
		return body.startsWith("<p>") ? `<p>${name}${body.slice(3)}` : `<p>${name}${body}</p>`;
	};

	const plain = (html) => D().htmlToText(html);

	const statBlock = (m, {lair = false} = {}) => {
		const mon = m.ent;
		const R = Renderer.monster;
		const mod = (s) => (typeof s === "number" ? Parser.getAbilityModNumber(s) : 0);
		const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);
		const abil = Parser.ABIL_ABVS.map(ab => {
			const score = typeof mon[ab] === "number" ? mon[ab] : null;
			const sv = mon.save?.[ab];
			return {ab: ab.toUpperCase(), score: score ?? "—", mod: score == null ? "—" : sg(mod(score)), save: sv ? plain(Renderer.get().render(String(sv))).replace(/^\+?/, "+").replace(/^\+-/, "-") : (score == null ? "—" : sg(mod(score))), prof: !!sv};
		});
		const lines = [];
		const add = (label, val) => { if (val && String(val).trim()) lines.push([label, val]); };
		try { add("Skills", plain(R.getSkillsString(Renderer.get(), mon))); } catch (e) { /* none */ }
		try { add("Vulnerabilities", Parser.getFullImmRes(mon.vulnerable, {isPlainText: true})); } catch (e) { /* none */ }
		try { add("Resistances", Parser.getFullImmRes(mon.resist, {isPlainText: true})); } catch (e) { /* none */ }
		try {
			const imm = [Parser.getFullImmRes(mon.immune, {isPlainText: true}), Parser.getFullCondImm(mon.conditionImmune, {isPlainText: true})].filter(Boolean).join("; ");
			add("Immunities", imm);
		} catch (e) { /* none */ }
		if (mon.gear) add("Gear", mon.gear.map(g => D().strip(`{@item ${typeof g === "string" ? g : g.item}}`) + (g.quantity > 1 ? ` (${g.quantity})` : "")).join(", "));
		add("Senses", plain(R.getSensesPart(mon)));
		add("Languages", plain(R.getRenderedLanguages(mon.languages)) || "—");
		const sub = R.getSubEntries(mon);
		const sections = [];
		const sec = (title, ents, intro) => { if (ents && ents.length) sections.push({title, intro: intro || "", items: ents.map(renderNamed)}); };
		sec("Traits", sub.entsTrait);
		sec("Actions", sub.entsAction);
		sec("Bonus Actions", sub.entsBonusAction);
		sec("Reactions", sub.entsReaction, mon.reactionHeader ? simplify(Renderer.get().render({type: "entries", entries: mon.reactionHeader})) : "");
		if (sub.entsLegendaryAction) sec("Legendary Actions", sub.entsLegendaryAction, simplify(R.getLegendaryActionIntro(mon)));
		if (sub.entsMythicAction) sec("Mythic Actions", sub.entsMythicAction, mon.mythicHeader ? simplify(Renderer.get().render({type: "entries", entries: mon.mythicHeader})) : "");
		const lg = sub.legGroup;
		if (lg) {
			const blk = (title, entries) => { if (entries?.length) sections.push({title, intro: "", items: [simplify(Renderer.get().setFirstSection(true).render({type: "entries", entries}))], lair: true}); };
			blk("Lair Actions", lg.lairActions);
			blk("Regional Effects", lg.regionalEffects);
			blk("Mythic Encounter", lg.mythicEncounter);
		}
		const crObj = mon.cr && typeof mon.cr === "object" ? mon.cr : null;
		let size = "";
		try { size = (mon.size || []).map(s => Parser.sizeAbvToFull(s)).join(" or "); } catch (e) { /* ignore */ }
		let align = "";
		try { align = Parser.alignmentListToFull(mon.alignment); } catch (e) { /* ignore */ }
		let ac = "";
		try { ac = plain(Renderer.get().render(Parser.acToFull(mon.ac))); } catch (e) { ac = String(mon.ac?.[0]?.ac ?? mon.ac?.[0] ?? "—"); }
		return {
			key: m.key,
			name: mon.name,
			source: D().sourceShort(mon.source),
			page: mon.page || null,
			meta: [[size, m.typeText].filter(Boolean).join(" "), D().titleCase(align || "")].filter(Boolean).join(", "),
			ac,
			init: R.getInitiativePart(mon, {isPlainText: true}),
			hp: plain(String(R.getRenderedHp(mon.hp, {isPlainText: true}))),
			hpAvg: mon.hp?.average ?? null,
			speed: Parser.getSpeedString(mon),
			abil,
			pb: `+${Parser.crToPb(crValue(mon.cr))}`,
			cr: m.crText,
			xp: m.xp,
			xpLair: crObj?.xpLair || null,
			lines,
			sections,
			passive: mon.passive ?? null,
		};
	};

	/** Everything the encounter PDF needs, prepared here (where the 5etools renderer lives). */
	const printPayload = async (enc) => {
		const mons = await loadMonsters();
		const L = await loadLoot();
		const ev = evaluate(enc);
		const seen = new Set();
		const blocks = [];
		const roster = (enc.creatures || []).map(c => {
			const m = mons.find(x => x.key === c.key);
			const sb = m ? statBlock(m) : null;
			if (sb && !seen.has(c.key)) { seen.add(c.key); blocks.push(sb); }
			return {
				name: c.name, source: D().sourceShort(c.source), count: c.count, ally: !!c.ally, role: c.role || null, cr: c.cr, xp: c.xp,
				ac: sb ? sb.ac.replace(/\s*\(.*\)/, "") : "", hp: sb ? sb.hp : "", hpAvg: sb?.hpAvg, init: sb ? sb.init : "", speed: sb ? sb.speed : "",
				passive: sb?.passive, notes: sb ? sb.lines.filter(l => /^(Resistances|Immunities|Vulnerabilities)$/.test(l[0])).map(l => `${l[0].slice(0, 3)}. ${l[1]}`).join("; ") : "",
				legendary: sb ? sb.sections.some(s => /Legendary|Lair|Mythic/.test(s.title)) : false,
			};
		});
		// Full text of the magic items on the loot table
		const itemRefs = [];
		const seenItems = new Set();
		(enc.loot?.options || []).forEach((o, i) => o.lines.filter(l => l.kind === "item" && l.key).forEach(l => {
			if (seenItems.has(l.key)) return;
			seenItems.add(l.key);
			const ent = L.itemsByKey.get(l.key);
			if (!ent) return;
			let typeLine = "";
			try { typeLine = plain(Renderer.item.getTypeRarityAndAttunementText(ent).join?.(", ") || ""); } catch (e) { /* ignore */ }
			itemRefs.push({roll: i + 1, name: ent.name, note: l.note || "", sub: [D().titleCase(ent.rarity || ""), l.consumable ? "consumable" : "", ent.reqAttune ? "requires attunement" : ""].filter(Boolean).join(", ") || typeLine, html: simplify(Renderer.get().setFirstSection(true).render({type: "entries", entries: ent.entries || []}))});
		}));
		return {
			encounter: {
				name: enc.name || "Encounter",
				notes: enc.notes || "",
				rules: ev.rules.label,
				target: enc.target,
				shape: enc.shapeUsed && SHAPES[enc.shapeUsed] ? SHAPES[enc.shapeUsed].label : null,
				habitats: (enc.filters?.envs || []).map(D().titleCase),
			},
			ev: {
				party: ev.party, tiers: ev.tiers, enemyXp: ev.enemyXp, allyXp: ev.allyXp, effective: ev.effective, mult: ev.mult,
				difficulty: ev.difficulty, perPc: ev.perPc, levelShare: ev.levelShare, enemyCount: ev.enemyCount,
			},
			roster,
			blocks,
			loot: {target: enc.loot?.target || 0, generosity: (GENEROSITY.find(g => g[0] === enc.loot?.generosity) || GENEROSITY[1])[1], options: enc.loot?.options || []},
			extras: enc.extras || [],
			items: itemRefs,
			options: {paper: enc.paper || "A4", accent: enc.accent || "#7a1f1a", statBlocks: enc.printStatBlocks !== false, itemText: enc.printItems !== false},
		};
	};
	// endregion

	const newEncounter = () => ({
		id: uid(),
		name: "New Encounter",
		party: [{count: 4, level: 3}],
		rules: "2024",
		target: "moderate",
		shape: "",
		filters: {...DEFAULT_FILTERS},
		creatures: [],
		loot: {generosity: "standard", target: 0, options: []},
		extras: [],
		notes: "",
		paper: "A4",
		createdAt: Date.now(),
	});

	return {
		RULES, XP_2024, XP_2014, LEVEL_XP, HABITATS, TYPES, SIZES, SHAPES, SOURCE_MODES, GENEROSITY, THEMES, DEFAULT_FILTERS,
		party, evaluate, tierBudget, multiplier, loadMonsters, byKey, filterPool, matches, creatureFrom, generate, suggestName,
		loadLoot, generateLoot, rerollLoot, lootTarget, gpText, generateExtras, rerollExtra, statBlock, printPayload, newEncounter, uid,
	};
})();
