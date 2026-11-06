"use strict";

/**
 * Store rules: vendors, prices and bartering (2024 rules).
 *
 * Prices: the item's own cost when it has one (Player's Handbook / DMG tables); otherwise a magic item's value
 * by rarity (DMG 2024: Common 100 GP … Legendary 200,000 GP), halved for consumables other than Spell Scrolls,
 * plus the cost of the mundane item it's built on (+1 Longsword = 400 + 15 GP). A Spell Scroll is worth double
 * what it costs to scribe. Selling: equipment fetches half its cost; gems, art objects, trade goods and coins
 * keep their full value (PHB 2024 "Selling Equipment").
 * Where it's sold (DMG 2024): common magic items in towns and cities, uncommon and rare ones in cities, rarer
 * ones only in wondrous places. Services: lifestyle, food, drink and lodging, hirelings, spellcasting.
 * Bartering is built on the Influence action: a Charisma (or Wisdom/Intelligence) check against the vendor's DC.
 */
globalThis.TBShop = (() => {
	const lc = (s) => String(s ?? "").toLowerCase();
	const R = () => TBRules;
	const D = () => TBData;

	// region Money
	const GP = 100;
	const money = (cp) => {
		cp = Math.max(0, Math.round(Number(cp) || 0));
		const g = Math.floor(cp / 100);
		const s = Math.floor((cp % 100) / 10);
		const c = cp % 10;
		const parts = [g ? `${g.toLocaleString("en-US")} gp` : "", s ? `${s} sp` : "", c ? `${c} cp` : ""].filter(Boolean);
		return parts.join(" ") || "0 gp";
	};
	// endregion

	// region Prices
	const RARITY_GP = {common: 100, uncommon: 400, rare: 4000, "very rare": 40000, legendary: 200000};
	const RARITY_ORDER = ["none", "common", "uncommon", "rare", "very rare", "legendary"];
	/** PHB 2024 "Spell Scroll Costs" (to scribe); the scroll's value is double. */
	const SCRIBE_GP = [15, 25, 100, 150, 1000, 1500, 10000, 12500, 15000, 50000];
	const scrollPrice = (level) => SCRIBE_GP[Math.max(0, Math.min(9, level))] * 2 * GP;
	const TREASURE = ["$G", "$A", "$C", "TG", "$"];
	const typeOf = (ent) => String(ent?.type || "").split("|")[0];
	const isMagic = (ent) => !!ent && !!RARITY_GP[lc(ent.rarity)];
	const isConsumable = (ent) => ["P", "SC", "A", "AF"].includes(typeOf(ent)) || !!ent?.poison || /\bconsumable\b/i.test(JSON.stringify(ent?.entries || []).slice(0, 600));
	const isTreasure = (ent) => TREASURE.includes(typeOf(ent));

	/** Value in copper, or null when it has no price (artifacts, "varies", unknown). */
	const priceOf = (ent, byKey) => {
		if (!ent) return null;
		if (Number(ent.value) > 0) return Number(ent.value);
		const r = lc(ent.rarity);
		if (!RARITY_GP[r]) return null;
		let v = RARITY_GP[r] * GP;
		if (isConsumable(ent) && typeOf(ent) !== "SC") v /= 2;
		const baseRef = ent.baseItem || (ent._baseName ? `${ent._baseName}|${ent._baseSource || ent.source}` : null);
		const base = baseRef && byKey ? byKey.get(lc(baseRef)) : null;
		if (base && Number(base.value) > 0) v += Number(base.value);
		return Math.round(v);
	};
	/** What a vendor pays: full value for treasure, half for everything else. */
	const sellPrice = (ent, byKey) => {
		const p = priceOf(ent, byKey);
		if (p == null) return null;
		return isTreasure(ent) ? p : Math.floor(p / 2);
	};
	// endregion

	// region Settlements
	const SETTLEMENTS = [
		{id: "village", label: "Village", maxRarity: "none", maxSpell: 2, note: "Mundane goods only; spellcasting services up to level 2."},
		{id: "town", label: "Town", maxRarity: "common", maxSpell: 5, note: "Common magic items; spellcasting services up to level 5."},
		{id: "city", label: "City", maxRarity: "rare", maxSpell: 9, note: "Uncommon and rare magic items; every spellcasting service."},
		{id: "wondrous", label: "Wondrous place", maxRarity: "legendary", maxSpell: 9, note: "Places like the City of Brass or Sigil: magic items up to Legendary."},
	];
	const settlementOf = (id) => SETTLEMENTS.find(s => s.id === id) || SETTLEMENTS[2];
	const availableIn = (ent, settle) => {
		const r = isMagic(ent) ? lc(ent.rarity) : "none";
		return RARITY_ORDER.indexOf(r) <= RARITY_ORDER.indexOf(settle.maxRarity);
	};
	// endregion

	// region Services (PHB 2024, chapter 6)
	const LIFESTYLE = [["Wretched", 0], ["Squalid", 10], ["Poor", 20], ["Modest", 100], ["Comfortable", 200], ["Wealthy", 400], ["Aristocratic", 1000]];
	const SERVICES = {
		inn: [
			...[["Ale (mug)", 4], ["Bread (loaf)", 2], ["Cheese (wedge)", 10], ["Wine (bottle, common)", 20], ["Wine (bottle, fine)", 1000]].map(([n, cp]) => ({name: n, group: "Food and drink", cp})),
			...[["Squalid", 7], ["Poor", 10], ["Modest", 50], ["Comfortable", 80], ["Wealthy", 200], ["Aristocratic", 400]].map(([n, cp]) => ({name: `Inn stay per day (${n})`, group: "Lodging", cp})),
			...[["Squalid", 1], ["Poor", 2], ["Modest", 10], ["Comfortable", 20], ["Wealthy", 30], ["Aristocratic", 60]].map(([n, cp]) => ({name: `Meal (${n})`, group: "Meals", cp})),
		],
		hire: [
			{name: "Skilled hireling (per day)", group: "Hirelings", cp: 200},
			{name: "Untrained hireling (per day)", group: "Hirelings", cp: 20},
			{name: "Messenger (per mile)", group: "Hirelings", cp: 2},
			...LIFESTYLE.map(([n, cp]) => ({name: `${n} lifestyle (per day)`, group: "Lifestyle", cp})),
		],
	};
	/** Spellcasting Services: [level, cost in GP]; availability comes from the settlement. */
	const SPELL_SERVICE_GP = [30, 50, 200, 300, 2000, 2000, 20000, 20000, 20000, 100000];
	// endregion

	// region Vendors
	const nm = (re) => (ent) => re.test(ent.name || "");
	const t = (...types) => (ent) => types.includes(typeOf(ent));
	const VENDORS = [
		{id: "all", name: "Everything", icon: "🏛", desc: "Every item and service, in one list.", match: () => true, services: ["inn", "hire", "spells"], scrolls: true},
		{id: "general", name: "General Store", icon: "🎒", desc: "Adventuring gear, food, rope, light, containers, trade goods.", match: (e) => !isMagic(e) && (t("G", "FD", "TG", "OTH")(e) || (!typeOf(e) && !e.wondrous && !e.weapon && !e.armor)), tool: null},
		{id: "weapons", name: "Weaponsmith", icon: "⚔", desc: "Weapons and ammunition, magic ones in bigger places.", match: (e) => !!e.weapon || t("M", "R", "A", "AF")(e), tool: /smith's tools/i, appraise: "Smith's Tools"},
		{id: "armor", name: "Armorer", icon: "🛡", desc: "Armor and shields.", match: (e) => !!e.armor || t("LA", "MA", "HA", "S")(e), tool: /smith's tools|leatherworker's tools/i, appraise: "Smith's or Leatherworker's Tools"},
		{id: "alchemist", name: "Alchemist & Apothecary", icon: "⚗", desc: "Potions, poisons, explosives, acid, antitoxin, healer's kits.", match: (e) => t("P", "EXP")(e) || !!e.poison || nm(/alchemist|acid|antitoxin|healer's kit|herbalism|holy water|oil \(|perfume|soap|poison/i)(e), tool: /alchemist's supplies|herbalism kit|poisoner's kit/i, appraise: "Alchemist's Supplies, Herbalism or Poisoner's Kit"},
		{id: "scribe", name: "Scribe & Scroll Shop", icon: "📜", desc: "Spell scrolls of every spell, paper, ink, books and maps.", match: (e) => t("SC")(e) || nm(/^(paper|parchment|ink|ink pen|book|map|scroll case|spellbook|calligrapher|cartographer)/i)(e), scrolls: true, tool: /calligrapher's supplies|cartographer's tools/i, appraise: "Calligrapher's Supplies", skill: "arcana"},
		{id: "arcane", name: "Arcane Emporium", icon: "✨", desc: "Rings, rods, staffs, wands, wondrous items and spellcasting focuses.", match: (e) => t("RG", "RD", "WD", "SCF")(e) || !!e.staff || !!e.wondrous || (isMagic(e) && !e.weapon && !e.armor && !t("P", "SC")(e)), skill: "arcana"},
		{id: "tools", name: "Tools & Instruments", icon: "🔧", desc: "Artisan's tools, kits, musical instruments and gaming sets.", match: (e) => t("AT", "T", "INS", "GS")(e), tool: /tools|supplies|kit|instrument/i, appraise: "any matching tool"},
		{id: "stable", name: "Stables & Docks", icon: "🐎", desc: "Mounts, tack, harness, vehicles and ships.", match: (e) => t("MNT", "TAH", "VEH", "SHP", "AIR", "SPC")(e), skill: "animal handling"},
		{id: "jeweler", name: "Jeweler", icon: "💎", desc: "Gemstones and art objects; buys your valuables at full value.", match: (e) => t("$G", "$A")(e), tool: /jeweler's tools/i, appraise: "Jeweler's Tools"},
		{id: "inn", name: "Inn & Tavern", icon: "🍺", desc: "Food, drink and lodging.", match: () => false, services: ["inn"]},
		{id: "temple", name: "Temple", icon: "⛪", desc: "Spellcasting services (healing, restoration…), holy water.", match: nm(/^holy water/i), services: ["spells"], skill: "religion"},
		{id: "hire", name: "Hirelings & Living", icon: "🤝", desc: "Hirelings, messengers and lifestyle expenses.", match: () => false, services: ["hire"]},
	];
	const vendorOf = (id) => VENDORS.find(v => v.id === id) || VENDORS[0];
	// endregion

	// region Catalog
	let _cat = null;
	const CORE = new Set(["xphb", "xdmg", "xmm", "phb", "dmg", "mm"]);
	/** All priced items, deduplicated: the 2024 printing wins over a reprinted older one. */
	const catalog = async () => {
		if (_cat) return _cat;
		const {all, byKey} = await R().loadItems();
		const rows = [];
		for (const ent of all) {
			if (ent.age === "futuristic" || ent.age === "modern") continue;
			if (lc(ent.rarity) === "artifact") continue;
			const cp = priceOf(ent, byKey);
			if (cp == null) continue;
			rows.push({key: R().refKey(ent), ent, name: ent.name, source: ent.source, cp, magic: isMagic(ent), rarity: isMagic(ent) ? lc(ent.rarity) : "none", reprinted: !!(ent.reprintedAs && ent.reprintedAs.length), core: CORE.has(lc(ent.source)), treasure: isTreasure(ent)});
		}
		rows.sort((a, b) => a.name.localeCompare(b.name));
		const spells = (await D().loadSpells()).filter(s => !(s.reprintedAs && s.reprintedAs.length));
		const scrolls = spells.map(s => ({key: `scroll:${R().refKey(s)}`, scroll: s, name: `Spell Scroll: ${s.name}`, source: s.source, level: s.level, cp: scrollPrice(s.level), magic: true, rarity: ["common", "common", "uncommon", "uncommon", "rare", "rare", "very rare", "very rare", "very rare", "legendary"][s.level], core: CORE.has(lc(s.source)), reprinted: false}))
			.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
		_cat = {rows, byKey, scrolls, spells};
		return _cat;
	};
	/** The inventory entry for a Spell Scroll of a given spell (the generic scroll item, with the spell noted). */
	const scrollItem = (byKey, spell) => {
		const name = spell.level === 0 ? "Spell Scroll (Cantrip)" : `Spell Scroll (Level ${spell.level})`;
		const ent = byKey.get(lc(`${name}|xdmg`));
		return {name: ent ? ent.name : name, source: ent ? ent.source : "XDMG", notes: spell.name};
	};
	// endregion

	// region Bartering (Influence, PHB 2024)
	/** The vendor's resolve: Influence DC is 15 or the creature's Intelligence, whichever is higher. */
	const PROFILES = [
		{id: "easy", label: "Easygoing", dc: 12, save: 0},
		{id: "fair", label: "Fair trader", dc: 15, save: 1},
		{id: "shrewd", label: "Shrewd", dc: 18, save: 2},
		{id: "ruthless", label: "Ruthless", dc: 20, save: 4},
	];
	const ATTITUDES = [
		{id: "friendly", label: "Friendly", mode: "adv", note: "Advantage on your barter checks"},
		{id: "indifferent", label: "Indifferent", mode: "normal", note: ""},
		{id: "hostile", label: "Hostile", mode: "dis", note: "Disadvantage on your barter checks"},
	];
	/** Discounts by result: [success, beat by 5+]; "fail5" what a failure by 5 or more does. */
	const APPROACHES = [
		{id: "persuade", name: "Persuade", skill: "persuasion", abil: "cha", desc: "Make a fair case for a better price.", gain: [10, 20], fail5: null},
		{id: "deceive", name: "Bluff", skill: "deception", abil: "cha", desc: "Claim a better offer down the street, or that you're short of coin.", gain: [15, 25], fail5: {markup: 10, end: true, text: "The vendor sees through it: prices +10% and no more haggling this visit."}},
		{id: "intimidate", name: "Intimidate", skill: "intimidation", abil: "cha", desc: "Lean on the vendor.", gain: [20, 30], fail5: {markup: 20, end: true, text: "The vendor stands firm: prices +20% and no more haggling this visit (and maybe the watch is called)."}},
		{id: "perform", name: "Charm with a performance", skill: "performance", abil: "cha", desc: "A song, a story, a trick: put them in a generous mood.", gain: [5, 10], fail5: null},
		{id: "insight", name: "Read the vendor", skill: "insight", abil: "wis", desc: "Find the lowest price they'd take: Advantage on your next barter check.", gain: [0, 0], advNext: true, fail5: null},
		{id: "appraise", name: "Appraise the goods", skill: "investigation", abil: "int", desc: "Spot flaws and wear to talk the price down (adds to the other discounts).", gain: [5, 10], stack: true, fail5: null},
	];
	const MAX_DISCOUNT = 30;
	/** Spells that help, what they do here, and whether the vendor gets a save. */
	const SPELLS = {
		"friends": {text: "Vendor makes a Wisdom save; on a failure you have Advantage on Charisma checks against them this visit (afterwards they know).", save: "wis", advCha: true},
		"charm person": {text: "Vendor makes a Wisdom save; charmed, you have Advantage on every barter check this visit.", save: "wis", advAll: true},
		"charm monster": {text: "Vendor makes a Wisdom save; charmed, you have Advantage on every barter check this visit.", save: "wis", advAll: true},
		"enhance ability": {text: "Charisma: Advantage on Charisma checks this visit.", advCha: true},
		"suggestion": {text: "Vendor makes a Wisdom save; on a failure they offer a fair discount (25%).", save: "wis", discount: 25},
		"mass suggestion": {text: "Vendor makes a Wisdom save; on a failure they offer a fair discount (25%).", save: "wis", discount: 25},
		"detect thoughts": {text: "You read their bottom line: Advantage on your next barter check.", advNext: true},
		"guidance": {text: "Add 1d4 to one ability check (choose the barter skill when you cast it).", play: true},
		"zone of truth": {text: "No lies in the zone: the vendor can't bluff you about the price (Advantage on Insight).", advNext: true},
		"command": {text: "One-word command (\"Sell!\") — the vendor makes a Wisdom save; DM decides the effect.", save: "wis"},
	};
	/** Features and traits that matter at the counter. */
	const TRAITS = [
		{re: /^Reliable Talent$/i, text: "Reliable Talent: a d20 of 9 or lower counts as 10 on proficient skill checks (applied).", min10: "proficient"},
		{re: /^Silver Tongue$/i, text: "Silver Tongue: a d20 of 9 or lower counts as 10 on Persuasion and Deception (applied).", min10: ["persuasion", "deception"]},
		{re: /^Lucky$/i, text: "Lucky: spend a Luck Point for Advantage (tick \"Advantage\" for the roll)."},
		{re: /^Luck$|Halfling/i, text: "Luck: reroll a 1 on a d20 test."},
		{re: /^Jack of All Trades$/i, text: "Jack of All Trades: half your Proficiency Bonus on checks you aren't proficient in (in the bonuses)."},
		{re: /^Expertise$/i, text: "Expertise: double Proficiency Bonus on your expert skills (in the bonuses)."},
		{re: /^Actor$/i, text: "Actor: Advantage on Deception and Performance checks while disguised."},
		{re: /^Skill Expert$|^Skilled$/i, text: null},
	];
	// endregion

	return {GP, money, priceOf, sellPrice, isMagic, isTreasure, isConsumable, typeOf, scrollPrice, RARITY_GP, RARITY_ORDER, SETTLEMENTS, settlementOf, availableIn, SERVICES, SPELL_SERVICE_GP, VENDORS, vendorOf, catalog, scrollItem, PROFILES, ATTITUDES, APPROACHES, MAX_DISCOUNT, SPELLS, TRAITS};
})();
