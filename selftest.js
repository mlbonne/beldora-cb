"use strict";

/**
 * Headless check of the export pipeline: builds a sample character in a hidden window,
 * lays out the booklet and cheat sheet, and writes the PDFs to outDir.
 * Run with: TOMEBINDER_SELFTEST=<dir> electron .
 */
const {BrowserWindow, ipcMain} = require("electron");
const path = require("path");
const fs = require("fs");

async function run ({baseUrl, outDir, renderPdf, imposePdf, appDir}) {
	fs.mkdirSync(outDir, {recursive: true});
	const log = (m) => fs.appendFileSync(path.join(outDir, "log.txt"), `${new Date().toISOString()} ${m}
`);
	log("start");
	const win = new BrowserWindow({show: false, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	const payload = await new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error("selftest page timed out")), 120000);
		ipcMain.once("selftest:payload", (evt, data) => { clearTimeout(t); resolve(data); });
		win.loadURL(`${baseUrl}/tb-selftest.html?theme=${process.env.TOMEBINDER_SELFTEST_THEME || "parchment"}`);
	});
	win.destroy();
	log(`payload ${payload.error ? "error" : "ok"}`);
	if (payload.error) throw new Error(payload.error);
	const t0 = Date.now();
	const bookRes = await renderPdf("/tb-print.html", {book: payload.book, options: payload.options});
	log(`booklet laid out: ${bookRes.info.pageCount} pages`);
	fs.writeFileSync(path.join(outDir, "booklet.pdf"), bookRes.pdf);
	fs.writeFileSync(path.join(outDir, "booklet-folded.pdf"), await imposePdf(bookRes.pdf, "saddle", payload.options.pageSize));
	const cheatRes = await renderPdf("/tb-cheat.html", {cheat: payload.cheat, pageMap: bookRes.info.pageMap, bookTitle: payload.book.title, options: payload.options});
	fs.writeFileSync(path.join(outDir, "cheatsheet.pdf"), cheatRes.pdf);
	const sheetRes = await renderPdf("/tb-sheet.html", {sheet: payload.sheet, pageMap: bookRes.info.pageMap, options: payload.options});
	fs.writeFileSync(path.join(outDir, "sheet.pdf"), sheetRes.pdf);
	const cardsRes = await renderPdf("/tb-cards.html", {...payload.cards, pageMap: bookRes.info.pageMap, options: payload.options});
	fs.writeFileSync(path.join(outDir, "cards.pdf"), cardsRes.pdf);
	log(`sheet ${JSON.stringify(sheetRes.info)} cards ${JSON.stringify(cardsRes.info)}`);
	fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify({ms: Date.now() - t0, pages: bookRes.info.pageCount, refs: bookRes.info.refs, stamped: bookRes.info.stamped, cheat: cheatRes.info, pageMapSample: Object.entries(bookRes.info.pageMap).slice(0, 12)}, null, 2));
	console.log(`selftest ok: ${bookRes.info.pageCount} pages in ${Date.now() - t0} ms`);
}

module.exports = {run};

/** Drives the real app page in a hidden window: store round-trip, embedded wiki, clipping. */
async function smoke ({baseUrl, outDir, appDir}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1400, height: 900, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	await win.loadURL(`${baseUrl}/tb-app.html`);
	const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
	const wait = (ms) => new Promise(r => setTimeout(r, ms));
	await wait(2500);
	const out = {};
	out.init = await js(`return {hasNative: !!window.tbNative, chars: TBStore.get().characters.length}`);
	out.create = await js(`
		const c = await TBApp.createCharacter();
		Object.assign(c, {name: "Smoke Test", classes: [{name: "Wizard", source: "XPHB", level: 3, subclass: {shortName: "Evoker", name: "Evoker", source: "XPHB"}}], species: {name: "Human", source: "XPHB"}});
		await TBApp.syncBook(c);
		TBApp.setClipTarget(c.id);
		await TBStore.flush();
		return TBStore.bookOf(c.id).chapters.map(x => x.title + ":" + x.items.length);
	`);
	out.wiki = await js(`
		TBApp.openWiki("classes.html#wizard_xphb");
		await new Promise(r => setTimeout(r, 7000));
		const w = document.querySelector(".wiki-frame").contentWindow;
		const okClip = !!w.__tbClip;
		const page = okClip && w.__tbClip.clipPage();
		const c = TBStore.get().characters.find(x => x.name === "Smoke Test");
		const annex = TBStore.bookOf(c.id).chapters.find(x => x.genKey === "annex");
		return {okClip, page, title: w.document.title, annex: annex.items.map(i => i.title + " (" + i.html.length + " chars)")};
	`);
	await js(`await TBStore.flush()`);
	const home = process.env.BELDORA_HOME || (require("electron").app.isPackaged ? path.dirname(process.execPath) : path.join(appDir, "dev-home"));
	out.saveFiles = fs.readdirSync(path.join(home, "Saves", "Characters"));
	if (process.env.TOMEBINDER_UPDATER) {
		out.files = await js(`const i = await tbNative.filesInfo(); return {root: i.root, siteVersion: i.siteVersion, usingUpdated: i.usingUpdated, siteRoot: i.siteRoot, images: i.imagesInfo.folders, saves: i.savesCount}`);
		out.check = await js(`const c = await tbNative.updaterCheck(); return {site: c.site, images: c.images && {current: c.images.current, latest: c.images.latest, categories: c.images.categories.length}, errors: c.errors}`);
		out.run = await js(`return await tbNative.updaterRun({site: !!${JSON.stringify(!!process.env.TOMEBINDER_UPDATER_SITE)}, images: ["conditionsdiseases"], skipExisting: true})`);
		out.served = await js(`
			const i = await tbNative.filesInfo();
			const r = await fetch("/img/conditionsdiseases/" + encodeURIComponent((await (await fetch("/data/conditionsdiseases.json")).json(), "")));
			return {folders: i.imagesInfo.folders, version: i.imagesInfo.version};
		`);
		await js(`TBApp.setView("files"); await new Promise(r => setTimeout(r, 800)); document.querySelector(".updater .btn.primary").click(); await new Promise(r => setTimeout(r, 6000));`);
		fs.writeFileSync(path.join(outDir, "app-files.png"), (await win.webContents.capturePage()).toPNG());
		const condDir = path.join(home, "images", "conditionsdiseases");
		const anyFile = fs.existsSync(condDir) ? fs.readdirSync(condDir).find(f => /\.webp$/i.test(f)) : null;
		if (anyFile) out.servedImage = await js(`const r = await fetch("/img/conditionsdiseases/${encodeURIComponent(anyFile)}"); return {status: r.status, type: r.headers.get("content-type")}`);
	}
	// Clean the smoke character back out of the user's store
	await js(`
		const st = TBStore.get();
		const c = st.characters.find(x => x.name === "Smoke Test");
		st.characters = st.characters.filter(x => x !== c);
		st.books = st.books.filter(b => b.ownerCharId !== c.id);
		if (st.settings.clipTarget === c.id) st.settings.clipTarget = null;
		await TBStore.flush();
	`);
	fs.writeFileSync(path.join(outDir, "smoke.json"), JSON.stringify(out, null, 2));
	win.destroy();
}

module.exports.smoke = smoke;

/** DM flow: standalone book, clips from several page types into chosen chapters, then a PDF. */
async function dm ({baseUrl, outDir, appDir, renderPdf}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1500, height: 950, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	await win.loadURL(`${baseUrl}/tb-app.html`);
	const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
	await new Promise(r => setTimeout(r, 2500));
	await js(`
		const b = await TBApp.createBook({open: false, ask: false});
		b.title = "DM Selftest";
		window.__b = b;
		TBApp.setClipTarget(b.id);
	`);
	const clipFrom = async (chapter, url, how) => js(`
		const b = window.__b;
		let chap = b.chapters.find(c => c.title === ${JSON.stringify(chapter)});
		if (!chap) { chap = {id: TBBook.uid(), title: ${JSON.stringify(chapter)}, items: []}; b.chapters.push(chap); }
		TBApp.setClipChapter(b, chap.id);
		TBApp.openWiki(${JSON.stringify(url)});
		await new Promise(r => setTimeout(r, 6500));
		const w = document.querySelector(".wiki-frame").contentWindow;
		const d = w.document;
		${how}
		return chap.items.map(i => i.title + " [" + i.clipKind + ", " + i.html.length + "]");
	`);
	const out = {};
	out.monster = await clipFrom("Monsters", "bestiary.html#goblin%20warrior_xmm", "w.__tbClip.clipPage();");
	out.item = await clipFrom("Treasure", "items.html#flame%20tongue%20longsword_xdmg", "w.__tbClip.clipPage();");
	out.table = await clipFrom("Rules", "variantrules.html#breaking%20objects_xphb", `
		const t = d.querySelector("#pagecontent table.ve-rd__table") || d.querySelector("#pagecontent table");
		w.__tbClip.setMode(true);
		const r = t.getBoundingClientRect();
		t.dispatchEvent(new w.MouseEvent("mousemove", {bubbles: true, clientX: r.left + 5, clientY: r.top + 5}));
		t.dispatchEvent(new w.MouseEvent("click", {bubbles: true, cancelable: true}));
		w.__tbClip.setMode(false);
	`);
	out.section = await clipFrom("Rules", "book.html#xdmg,1", `
		const sec = [...d.querySelectorAll("#pagecontent .ve-rd__b--1")].find(e => e.offsetHeight > 200);
		w.__tbClip.setMode(true);
		const r = sec.getBoundingClientRect();
		const p = sec.querySelector("p");
		const pr = p.getBoundingClientRect();
		p.dispatchEvent(new w.MouseEvent("mousemove", {bubbles: true, clientX: pr.left + 5, clientY: pr.top + 5}));
		w.dispatchEvent(new w.KeyboardEvent("keydown", {key: "ArrowUp"}));
		d.dispatchEvent(new w.KeyboardEvent("keydown", {key: "ArrowUp", bubbles: true}));
		p.dispatchEvent(new w.MouseEvent("click", {bubbles: true, cancelable: true}));
		w.__tbClip.setMode(false);
	`);
	const payload = await js(`
		const b = window.__b;
		b.chapters = b.chapters.filter(c => c.items.length);
		return {book: TBViewExport.printableBook(b, null), options: TBViewExport.pdfOptions(TBViewExport.optionsOf(b))};
	`);
	const res = await renderPdf("/tb-print.html", payload);
	fs.writeFileSync(path.join(outDir, "dm-book.pdf"), res.pdf);
	out.pages = res.info.pageCount;
	out.kicker = payload.book.kicker;
	await js(`
		const st = TBStore.get();
		st.books = st.books.filter(b => b !== window.__b);
		if (st.settings.clipTarget === window.__b.id) st.settings.clipTarget = null;
		await TBStore.flush();
	`);
	fs.writeFileSync(path.join(outDir, "dm.json"), JSON.stringify(out, null, 2));
	win.destroy();
}

module.exports.dm = dm;

/** Encounter builder: random encounters at several levels, UI screenshots, the PDF and the saved files. */
async function encounters ({baseUrl, outDir, appDir, renderPdf}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1500, height: 950, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	await win.loadURL(`${baseUrl}/tb-app.html`);
	const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
	const wait = (ms) => new Promise(r => setTimeout(r, ms));
	const shot = async (name) => fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG());
	await wait(2500);
	const cases = [
		{lvl: 1, size: 4, target: "moderate", shape: "", envs: []},
		{lvl: 5, size: 4, target: "high", shape: "leader", envs: ["forest"]},
		{lvl: 11, size: 5, target: "moderate", shape: "", envs: ["underdark"]},
		{lvl: 17, size: 4, target: "high", shape: "solo", envs: []},
	];
	const out = {cases: []};
	for (const [i, c] of cases.entries()) {
		const r = await js(`
			TBApp.setView("encounters");
			TBViewEncounters.createEncounter();
			const st = TBStore.get();
			const enc = st.encounters[st.encounters.length - 1];
			enc.party = [{count: ${c.size}, level: ${c.lvl}}];
			enc.target = ${JSON.stringify(c.target)};
			enc.shape = ${JSON.stringify(c.shape)};
			enc.filters.envs = ${JSON.stringify(c.envs)};
			TBViewEncounters.render();
			await new Promise(r => setTimeout(r, 300));
			[...document.querySelectorAll("#view-encounters .btn.primary")].find(b => /Random encounter/.test(b.textContent)).click();
			for (let t = 0; t < 60 && !(enc.extras || []).length; ++t) await new Promise(r => setTimeout(r, 250));
			await new Promise(r => setTimeout(r, 400));
			const ev = TBEnc.evaluate(enc);
			return {name: enc.name, mons: enc.creatures.map(c => c.count + "x " + c.name + " CR" + c.cr), xp: ev.effective, budget: ev.tiers.map(t => t.label + " " + t.xp).join(", "), diff: ev.difficulty.label, perPc: ev.perPc, loot: enc.loot.options.map(o => o.title + " ≈" + o.value), extras: enc.extras.map(x => x.name)};
		`);
		out.cases.push(r);
		await shot(`ui-builder-${i + 1}.png`);
		const payload = await js(`const st = TBStore.get(); return await TBEnc.printPayload(st.encounters[st.encounters.length - 1]);`);
		const res = await renderPdf("/tb-encounter.html", payload);
		fs.writeFileSync(path.join(outDir, `encounter-${i + 1}.pdf`), res.pdf);
		out.cases[i].pdf = res.info;
	}
	// Export tab (preview) for the last one
	await js(`[...document.querySelectorAll("#view-encounters .char-tabs button")].find(b => b.textContent === "Export").click();`);
	await wait(4000);
	await shot("ui-export.png");
	// Stat block modal
	await js(`[...document.querySelectorAll("#view-encounters .char-tabs button")].find(b => b.textContent === "Builder").click(); await new Promise(r => setTimeout(r, 400)); document.querySelector(".enc-row .nm a").click();`);
	await wait(2500);
	await shot("ui-statblock.png");
	await js(`await TBStore.flush();`);
	const home = process.env.BELDORA_HOME || path.join(appDir, "dev-home");
	out.saveFiles = fs.readdirSync(path.join(home, "Saves", "Encounters"));
	out.library = JSON.parse(fs.readFileSync(path.join(home, "Saves", "library.json"), "utf8")).encounterOrder;
	fs.writeFileSync(path.join(outDir, "encounters.json"), JSON.stringify(out, null, 2));
	win.destroy();
}

module.exports.encounters = encounters;

/** Live sheet, equipment fix, level-up plan and the in-app updater (with BELDORA_UPDATE_URL pointing at a test server). */
async function play ({baseUrl, outDir, appDir, renderPdf}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1500, height: 950, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	// Page errors go to console.txt
	win.webContents.on("console-message", (e, level, message, line, sourceId) => { if (level >= 2) fs.appendFileSync(path.join(outDir, "console.txt"), `${message} (${sourceId}:${line})
`); });
	await win.loadURL(`${baseUrl}/tb-app.html`);
	const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
	const wait = (ms) => new Promise(r => setTimeout(r, ms));
	const shot = async (name) => fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG());
	await wait(3000);
	const out = {};
	out.info = await js(`return {title: document.title, update: await tbNative.appUpdateInfo()}`);
	if (process.env.BELDORA_UPDATE_URL && !out.info.update.usingUpdate) {
		out.check = await js(`return await TBAppUpdate.check()`);
		out.install = await js(`return await TBAppUpdate.installAny()`);
		await js(`TBApp.setView("files"); await new Promise(r => setTimeout(r, 9000)); document.querySelector(".fcard.updater .btn.primary")?.click(); await new Promise(r => setTimeout(r, 4000));`);
		await shot("app-files-update.png");
		fs.writeFileSync(path.join(outDir, "play.json"), JSON.stringify(out, null, 2));
		win.destroy();
		return;
	}
	out.chars = await js(`
		const st = TBStore.get();
		const mk = (c) => { st.characters.push(c); return c; };
		const fighter = mk({id: "st-fighter", name: "Selftest Fighter", player: "", classes: [{name: "Fighter", source: "XPHB", level: 5}], species: {name: "Human", source: "XPHB"}, background: {name: "Soldier", source: "XPHB"}, abilities: {method: "manual", base: {str: 15, dex: 12, con: 14, int: 10, wis: 10, cha: 8}}, equipment: {items: [{name: "+1 Plate Armor", source: "XDMG", qty: 1, equipped: true}, {name: "Shield", source: "XPHB", qty: 1, equipped: true}, {name: "Ring of Protection", source: "XDMG", qty: 1, equipped: true}, {name: "Gauntlets of Ogre Power", source: "XDMG", qty: 1, equipped: true}, {name: "+1 Longsword", source: "XDMG", qty: 1, equipped: true}, {name: "Potion of Healing", source: "XDMG", qty: 3}], cp: 5000}, choices: {}, feats: [], spells: [], optfeatures: [], settings: {plan: {subclasses: {"fighter|xphb": {name: "Battle Master", shortName: "Battle Master", source: "XPHB"}}, classes: [{name: "Rogue", source: "XPHB", subclass: {name: "Thief", shortName: "Thief", source: "XPHB"}}]}}, createdAt: Date.now()});
		const druid = mk({id: "st-druid", name: "Selftest Druid", player: "", classes: [{name: "Druid", source: "XPHB", level: 8, subclass: {name: "Circle of the Moon", shortName: "Moon", source: "XPHB"}}], species: {name: "Human", source: "XPHB"}, background: {name: "Sage", source: "XPHB"}, abilities: {method: "manual", base: {str: 10, dex: 14, con: 14, int: 10, wis: 17, cha: 8}}, equipment: {items: [{name: "Leather Armor", source: "XPHB", qty: 1, equipped: true}, {name: "Shield", source: "XPHB", qty: 1, equipped: true}], cp: 1000}, choices: {}, feats: [], spells: [{name: "Polymorph", source: "XPHB"}, {name: "Summon Beast", source: "XPHB"}], optfeatures: [], settings: {}, xp: 34000, createdAt: Date.now()});
		for (const c of [fighter, druid]) await TBApp.syncBook(c);
		const A = await TBRules.analyze(fighter);
		return {fighterAc: A.derived.ac, acNote: A.derived.acNote, str: A.derived.scores.str, attacks: A.derived.attacks.map(a => a.name + " " + a.bonus + " " + a.damage)};
	`);
	// Builder equipment step (fighter)
	await js(`TBApp.state.activeCharId = "st-fighter"; TBApp.state.charTab = "builder"; TBApp.setView("characters"); await new Promise(r => setTimeout(r, 2000)); TBViewBuilder.goTo("equipment"); TBApp.renderCharacters(); await new Promise(r => setTimeout(r, 2500));`);
	await shot("builder-equipment.png");
	// Export tab, level-up plan
	await js(`TBApp.openCharTab("export"); await new Promise(r => setTimeout(r, 2500)); [...document.querySelectorAll(".card-h h3")].find(e => e.textContent === "Level-up plan").scrollIntoView(); await new Promise(r => setTimeout(r, 500));`);
	await shot("export-plan.png");
	// Cheat sheet with the plan
	const payload = await js(`
		const c = TBStore.char("st-fighter");
		const book = TBStore.bookOf(c.id);
		await TBApp.syncBook(c);
		return {book: TBViewExport.printableBook(book, c), cheat: await TBBook.buildCheat(c), options: TBViewExport.pdfOptions(TBViewExport.optionsOf(book))};
	`);
	const bookRes = await renderPdf("/tb-print.html", {book: payload.book, options: payload.options});
	const cheatRes = await renderPdf("/tb-cheat.html", {cheat: payload.cheat, pageMap: bookRes.info.pageMap, bookTitle: payload.book.title, options: payload.options});
	fs.writeFileSync(path.join(outDir, "cheat-plan.pdf"), cheatRes.pdf);
	out.cheat = {sheets: cheatRes.info.sheets, booklet: bookRes.info.pageCount, classes: payload.cheat.classes.map(k => `${k.name} ${k.plannedClass ? "(planned)" : k.level} ${k.subclass || ""}${k.plannedSubclass ? " (planned)" : ""}`), chapters: payload.book.chapters.map(c => c.title)};
	// Play tab: druid casts Polymorph and becomes a Giant Ape
	out.play = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		TBApp.setView("play"); TBViewPlay.startSession("st-druid"); await wait(2500);
		const row = (n) => [...document.querySelectorAll(".pl-act")].find(r => r.querySelector(".t")?.firstChild?.textContent === n);
		row("Polymorph").querySelector("button").click(); await wait(500);
		[...document.querySelectorAll(".modal .btn.primary")].find(b => ["Cast", "Next"].includes(b.textContent)).click(); await wait(1800);
		[...document.querySelectorAll(".modal .pl-row")].find(r => /^Giant Ape/.test(r.querySelector(".nm").textContent)).querySelector(".btn.primary").click(); await wait(1500);
		const c = TBStore.char("st-druid");
		const inp = document.querySelector(".pl-card .row input[type=number]"); inp.value = "25";
		[...document.querySelectorAll(".btn")].find(b => /Damage$/.test(b.textContent)).click(); await wait(1500);
		[...document.querySelectorAll(".pl-skill .nm")].find(e => /^Perception/.test(e.textContent)).click(); await wait(1200);
		// A summon too: Summon Beast (Land) from a level 3 slot
		const rowS = row("Summon Beast");
		let summon = null;
		if (rowS) {
			rowS.querySelector("button").click(); await wait(500);
			[...document.querySelectorAll(".modal .btn.primary")].find(b => ["Cast", "Next"].includes(b.textContent)).click(); await wait(2000);
			const sel = document.querySelector(".modal .pl-row select"); if (sel) { sel.value = "Land"; sel.dispatchEvent(new Event("change")); }
			document.querySelector(".modal .pl-row .btn.primary")?.click(); await wait(1500);
			summon = c.play.summons.map(s => s.name + " AC " + s.ac + " HP " + s.hpMax);
		}
		return {form: c.play.form?.name, temp: c.play.temp, conc: c.play.concentration?.name, slots: c.play.slotsUsed, summon, log: c.play.log.slice(0, 4).map(l => l.text)};
	`);
	await shot("play-druid.png");
	out.playFighter = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		TBViewPlay.startSession("st-fighter"); await wait(2500);
		[...document.querySelectorAll(".pl-act")].find(r => /Longsword/.test(r.textContent))?.querySelector("button").click(); await wait(1200);
		document.querySelectorAll(".pl-tabs button")[1].click(); await wait(1000);
		const c = TBStore.char("st-fighter");
		return {bonusActs: [...document.querySelectorAll(".pl-acts .pl-act .t")].map(e => e.firstChild.textContent), res: TBPlay.resources((await TBRules.analyze(c)).derived).map(r => r.name + " " + r.max), log: c.play.log.slice(0, 3).map(l => l.text)};
	`);
	await shot("play-fighter.png");
	await js(`
		const st = TBStore.get();
		st.characters = st.characters.filter(c => !/^st-/.test(c.id));
		st.books = st.books.filter(b => !/^st-/.test(b.ownerCharId || ""));
		await TBStore.flush();
	`);
	fs.writeFileSync(path.join(outDir, "play.json"), JSON.stringify(out, null, 2));
	win.destroy();
}

module.exports.play = play;

/** Writes docs/play-coverage.md: what the Play tab does with every 2024 class feature and spell. */
async function coverage ({baseUrl, outDir, appDir}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1200, height: 800, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	await win.loadURL(`${baseUrl}/tb-app.html`);
	await new Promise(r => setTimeout(r, 3000));
	const res = await win.webContents.executeJavaScript("TBPlayCoverage.report()");
	const docs = path.join(appDir, "docs");
	fs.mkdirSync(docs, {recursive: true});
	fs.writeFileSync(path.join(docs, "play-coverage.md"), res.md);
	fs.writeFileSync(path.join(outDir, "coverage.json"), JSON.stringify({features: res.features, byStatus: res.byStatus, spells: res.spells, spellsBy: res.spellsBy, triggers: res.triggers, triggersBy: res.triggersBy}, null, 2));
	win.destroy();
}

module.exports.coverage = coverage;

/** Builds every class × subclass at several levels in the builder and reports errors, spell prompts and empty choices. */
async function subclasses ({baseUrl, outDir, appDir}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1200, height: 800, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	await win.loadURL(`${baseUrl}/tb-app.html`);
	await new Promise(r => setTimeout(r, 3000));
	const res = await win.webContents.executeJavaScript(`(async () => {
		const out = [];
		const {classes} = await TBData.loadClasses();
		for (const cls of classes) {
			const scs = await TBData.getSubclasses(cls);
			for (const sc of [null, ...scs]) {
				for (const level of [1, 3, 5, 11, 20]) {
					if (sc && level < 3) continue;
					const char = {name: "t", legacy: cls.source !== "XPHB", classes: [{name: cls.name, source: cls.source, level, subclass: sc ? {shortName: sc.shortName, source: sc.source} : null}]};
					const row = {cls: cls.name, clsSrc: cls.source, sub: sc ? sc.name : "", subSrc: sc ? sc.source : "", level};
					try {
						const A = await TBRules.analyze(char);
						const sp = A.choices.filter(c => c.type === "spells");
						row.cantrips = sp.filter(c => /cantrips$/.test(c.title)).reduce((a, c) => a + c.count, 0);
						row.prepared = sp.filter(c => /prepared spells$/.test(c.title)).reduce((a, c) => a + c.count, 0);
						row.spellTitles = sp.map(c => c.title + " x" + c.count);
						row.casting = (A.derived.casting || []).map(c => c.cls + ":" + c.ability);
						row.slots = (A.derived.slots || []).join("/");
						row.empty = A.choices.filter(c => Array.isArray(c.options) && c.options.length < (c.count || 1)).map(c => c.title + " (" + c.options.length + "/" + c.count + ")");
						row.sc = sc ? {cp: sc.casterProgression || "", sa: sc.spellcastingAbility || ""} : null;
					} catch (e) { row.error = String(e && e.stack || e); }
					out.push(row);
				}
			}
		}
		return out;
	})()`);
	fs.writeFileSync(path.join(outDir, "subclasses.json"), JSON.stringify(res, null, 1));
	// The builder's Spells step for a level 3 Eldritch Knight
	await win.webContents.executeJavaScript(`(async () => {
		const c = {id: "st-ek", name: "Selftest Eldritch Knight", player: "", classes: [{name: "Fighter", source: "XPHB", level: 3, subclass: {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "XPHB"}}], species: {name: "Human", source: "XPHB"}, background: {name: "Soldier", source: "XPHB"}, abilities: {method: "manual", base: {str: 15, dex: 12, con: 14, int: 13, wis: 10, cha: 8}}, equipment: {items: [], cp: 0}, choices: {}, feats: [], spells: [], optfeatures: [], settings: {}, createdAt: Date.now()};
		TBStore.get().characters.push(c);
		await TBApp.syncBook(c);
		TBApp.state.activeCharId = c.id; TBApp.state.charTab = "builder";
		TBApp.setView("characters");
		await new Promise(r => setTimeout(r, 800));
		TBViewBuilder.goTo("spells"); TBApp.renderCharacters();
		await new Promise(r => setTimeout(r, 1500));
	})()`);
	fs.writeFileSync(path.join(outDir, "ek-spells.png"), (await win.webContents.capturePage()).toPNG());
	await win.webContents.executeJavaScript(`(async () => { [...document.querySelectorAll("button")].find(b => /^Choose \\d+ more/.test(b.textContent))?.click(); await new Promise(r => setTimeout(r, 1500)); })()`);
	fs.writeFileSync(path.join(outDir, "ek-picker.png"), (await win.webContents.capturePage()).toPNG());
	await win.webContents.executeJavaScript(`(async () => { const st = TBStore.get(); st.characters = st.characters.filter(c => c.id !== "st-ek"); TBStore.changed("char"); await TBStore.flush(); })()`);
	win.destroy();
}

module.exports.subclasses = subclasses;

/** Spellcasting abilities: prompts, per-spell numbers, the Play header, True Strike and Shillelagh, and the PDFs. */
async function spellability ({baseUrl, outDir, appDir, renderPdf}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1400, height: 900, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
	const shot = async (name) => fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG());
	const wait = (ms) => new Promise(r => setTimeout(r, ms));
	await win.loadURL(`${baseUrl}/tb-app.html`);
	await wait(3000);
	const out = {};
	out.build = await js(`
		const st = TBStore.get();
		const ek = {id: "st-ek2", name: "Selftest Spellblade", player: "", classes: [{name: "Fighter", source: "XPHB", level: 5, subclass: {name: "Eldritch Knight", shortName: "Eldritch Knight", source: "XPHB"}}], species: {name: "Elf; High Elf Lineage", source: "XPHB"}, background: {name: "Sage", source: "XPHB"}, abilities: {method: "manual", base: {str: 15, dex: 12, con: 14, int: 14, wis: 16, cha: 8}}, equipment: {items: [{name: "Longsword", source: "XPHB", qty: 1, equipped: true}], cp: 0}, choices: {}, feats: [], spells: [], optfeatures: [], settings: {}, createdAt: Date.now()};
		const dr = {id: "st-dr2", name: "Selftest Shillelagh", player: "", classes: [{name: "Druid", source: "XPHB", level: 5}], species: {name: "Human", source: "XPHB"}, background: {name: "Sage", source: "XPHB"}, abilities: {method: "manual", base: {str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 8}}, equipment: {items: [{name: "Quarterstaff", source: "XPHB", qty: 1, equipped: true}], cp: 0}, choices: {}, feats: [], spells: [{name: "Shillelagh", source: "XPHB"}], optfeatures: [], settings: {}, createdAt: Date.now()};
		st.characters.push(ek, dr);
		let A = await TBRules.analyze(ek);
		const prompts = A.choices.filter(c => /spellAbility$/.test(c.id)).map(c => c.id + " → " + c.title + " [" + c.options.map(o => o.value).join(",") + "]");
		// Answer them: the elf's lineage spells with Wisdom, Magic Initiate with Charisma; EK cantrips
		A.choices.filter(c => /spellAbility$/.test(c.id)).forEach(c => { ek.choices[c.id] = [/^species/.test(c.id) ? "wis" : "cha"]; });
		const cantrips = A.choices.find(c => /:cantrips$/.test(c.id));
		ek.choices[cantrips.id] = [{name: "True Strike", source: "XPHB"}, {name: "Shocking Grasp", source: "XPHB"}];
		const mi = A.choices.filter(c => /^bg:feat/.test(c.id) && c.type === "spells");
		mi.forEach(c => { ek.choices[c.id] = c.filter.level[0] === "0" ? [{name: "Sacred Flame", source: "XPHB"}, {name: "Guidance", source: "XPHB"}] : [{name: "Bless", source: "XPHB"}]; });
		const lin = A.choices.filter(c => /^species/.test(c.id) && c.type === "spells");
		lin.forEach(c => { ek.choices[c.id] = [{name: "Fire Bolt", source: "XPHB"}]; });
		A = await TBRules.analyze(ek);
		const d = A.derived;
		for (const c of [ek, dr]) await TBApp.syncBook(c);
		return {
			prompts, miIds: mi.map(c => c.id + ":" + c.title), linIds: lin.map(c => c.id + ":" + c.title),
			spellcasting: d.spellcasting, sources: d.spellSources,
			spells: d.spells.map(s => s.ent.name + " via " + s.via + " → " + (s.cast ? s.cast.abbr + " DC " + s.cast.dc + " atk " + s.cast.attack : "none") + (s.altAbility ? " (alt)" : "")),
			core: (await TBBook.buildCheat(ek)).classes.map(k => k.name + ": " + k.core?.spellAbility),
		};
	`);
	// Play: header and True Strike through the real menus
	out.play = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		TBApp.setView("play"); TBViewPlay.startSession("st-ek2"); await wait(2500);
		const header = document.querySelector(".pl-cast")?.innerText;
		const row = (n) => [...document.querySelectorAll(".pl-act")].find(r => r.querySelector(".t")?.firstChild?.textContent === n);
		const rows = ["True Strike", "Fire Bolt", "Sacred Flame", "Shocking Grasp"].map(n => n + ": " + (row(n)?.innerText.replace(/\s+/g, " ") || "missing"));
		row("True Strike").querySelector("button").click(); await wait(800);
		const opts1 = [...document.querySelectorAll(".modal .btn")].map(b => b.textContent);
		[...document.querySelectorAll(".modal .btn")].find(b => /^Longsword/.test(b.textContent)).click(); await wait(800);
		const opts2 = [...document.querySelectorAll(".modal .btn")].map(b => b.textContent);
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "Radiant").click(); await wait(1500);
		const c = TBStore.char("st-ek2");
		return {header, rows, opts1, opts2, log: c.play.log.slice(0, 4).map(l => l.text)};
	`);
	await shot("play-ek.png");
	out.shillelagh = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		TBViewPlay.startSession("st-dr2"); await wait(2500);
		const row = (n) => [...document.querySelectorAll(".pl-act")].find(r => r.querySelector(".t")?.firstChild?.textContent === n);
		const before = row("Quarterstaff")?.innerText.replace(/\s+/g, " ");
		document.querySelectorAll(".pl-tabs button")[1].click(); await wait(800);
		row("Shillelagh").querySelector("button").click(); await wait(800);
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "Force").click(); await wait(1500);
		document.querySelectorAll(".pl-tabs button")[0].click(); await wait(800);
		const after = [...document.querySelectorAll(".pl-act")].find(r => /Quarterstaff/.test(r.innerText))?.innerText.replace(/\s+/g, " ");
		return {before, after, header: document.querySelector(".pl-cast")?.innerText};
	`);
	// Character page
	await js(`TBApp.state.activeCharId = "st-ek2"; TBApp.state.charTab = "hero"; TBApp.setView("characters"); await new Promise(r => setTimeout(r, 2500));`);
	await shot("hero-ek.png");
	// PDFs: booklet, cheat sheet, character sheet
	const payload = await js(`
		const c = TBStore.char("st-ek2");
		const book = TBStore.bookOf(c.id);
		await TBApp.syncBook(c);
		return {book: TBViewExport.printableBook(book, c), cheat: await TBBook.buildCheat(c), sheet: TBExportData.sheetData(await TBRules.analyze(c)), options: TBViewExport.pdfOptions(TBViewExport.optionsOf(book))};
	`);
	const bookRes = await renderPdf("/tb-print.html", {book: payload.book, options: payload.options});
	fs.writeFileSync(path.join(outDir, "booklet.pdf"), bookRes.pdf);
	const cheatRes = await renderPdf("/tb-cheat.html", {cheat: payload.cheat, pageMap: bookRes.info.pageMap, bookTitle: payload.book.title, options: payload.options});
	fs.writeFileSync(path.join(outDir, "cheat.pdf"), cheatRes.pdf);
	const sheetRes = await renderPdf("/tb-sheet.html", {sheet: payload.sheet, pageMap: bookRes.info.pageMap, options: payload.options});
	fs.writeFileSync(path.join(outDir, "sheet.pdf"), sheetRes.pdf);
	await js(`
		const st = TBStore.get();
		st.characters = st.characters.filter(c => !/^st-/.test(c.id));
		st.books = st.books.filter(b => !/^st-/.test(b.ownerCharId || ""));
		await TBStore.flush();
	`);
	fs.writeFileSync(path.join(outDir, "spellability.json"), JSON.stringify(out, null, 2));
	win.destroy();
}

module.exports.spellability = spellability;


/** Store tab: gated by the Play session, prices per vendor, bartering, buying and selling. */
async function store ({baseUrl, outDir, appDir}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1500, height: 950, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
	const shot = async (name) => fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG());
	await win.loadURL(`${baseUrl}/tb-app.html`);
	await new Promise(r => setTimeout(r, 3000));
	const out = {};
	out.gate = await js(`
		const st = TBStore.get();
		st.characters.push({id: "st-bard", name: "Selftest Bard", player: "", classes: [{name: "Bard", source: "XPHB", level: 5, subclass: {name: "College of Lore", shortName: "Lore", source: "XPHB"}}], species: {name: "Human", source: "XPHB"}, background: {name: "Entertainer", source: "XPHB"}, abilities: {method: "manual", base: {str: 8, dex: 14, con: 12, int: 10, wis: 12, cha: 17}}, equipment: {items: [{name: "Diamond", source: "XDMG", qty: 1}, {name: "Ruby", source: "XDMG", qty: 2}, {name: "Rapier", source: "XPHB", qty: 1, equipped: true}, {name: "Lute", source: "XPHB", qty: 1}], cp: 50000}, choices: {}, feats: [], spells: [{name: "Friends", source: "XPHB"}, {name: "Charm Person", source: "XPHB"}, {name: "Suggestion", source: "XPHB"}], optfeatures: [], settings: {}, createdAt: Date.now()});
		await TBApp.syncBook(st.characters.at(-1));
		const btn = document.querySelector("#tb-nav [data-view=store]");
		const before = btn.disabled;
		TBApp.setView("play"); TBViewPlay.startSession("st-bard"); await new Promise(r => setTimeout(r, 2500));
		return {disabledBefore: before, disabledAfter: btn.disabled};
	`);
	out.prices = await js(`
		const cat = await TBShop.catalog();
		const find = (n, s) => cat.rows.find(r => r.name === n && r.source === s);
		const p = (n, s) => { const r = find(n, s); return r ? n + " " + TBShop.money(r.cp) + " (sells " + TBShop.money(TBShop.sellPrice(r.ent, cat.byKey)) + ")" : n + " missing"; };
		const scroll = cat.scrolls.find(r => r.name === "Spell Scroll: Fireball" && r.source === "XPHB");
		const counts = {};
		for (const v of TBShop.VENDORS) for (const s of ["village", "city", "wondrous"]) {
			const settle = TBShop.settlementOf(s);
			counts[v.id + "@" + s] = cat.rows.filter(r => v.match(r.ent) && TBShop.availableIn(r.ent, settle) && r.core && !r.reprinted).length;
		}
		return {rows: cat.rows.length, scrolls: cat.scrolls.length, list: [p("Longsword", "XPHB"), p("Plate Armor", "XPHB"), p("Potion of Healing", "XDMG"), p("+1 Longsword", "XDMG"), p("Bag of Holding", "XDMG"), p("Diamond", "XDMG"), p("Rope", "XPHB"), p("Ring of Protection", "XDMG")], fireball: scroll && TBShop.money(scroll.cp), counts};
	`);
	out.pages = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		try {
		TBApp.setView("store"); await wait(3500);
		const info = () => ({rows: document.querySelectorAll("#view-store .st-row").length, pager: document.querySelector("#view-store .st-pager")?.innerText.replace(/\\n+/g, " "), first: document.querySelector("#view-store .st-row .t")?.firstChild?.textContent});
		const p1 = info();
		[...document.querySelectorAll("#view-store .st-pager .btn")].find(b => /Next/.test(b.textContent)).click(); await wait(2500);
		const p2 = info();
		const i = document.querySelector(".st-cat input[type=search]"); i.value = "potion"; i.dispatchEvent(new Event("input")); await wait(2500);
		const search = info();
		i.value = ""; i.dispatchEvent(new Event("input")); await wait(2500);
		return {p1, p2, search};
		} catch (e) { return {error: String(e && e.stack || e), html: document.querySelector("#view-store")?.innerText.slice(0, 600)}; }
	`);
	await shot("store-pages.png");
	out.barter = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		TBApp.setView("store"); await wait(3000);
		const c = TBStore.char("st-bard");
		const vend = (n) => [...document.querySelectorAll(".st-vendor")].find(e => e.querySelector(".t").textContent === n).click();
		vend("Weaponsmith"); await wait(2500);
		const ap = (n) => [...document.querySelectorAll(".st-ap")].find(e => e.querySelector(".t").firstChild.textContent === n);
		const lines = [...document.querySelectorAll(".st-ap")].map(e => e.innerText.replace(/\\n+/g, " | "));
		ap("Friends")?.querySelector("button").click(); await wait(2500);
		ap("Suggestion")?.querySelector("button").click(); await wait(1200);
		document.querySelector(".modal .btn.primary")?.click(); await wait(2500);
		ap("Persuade").querySelector("button").click(); await wait(2500);
		const st = TBViewStore.storeOf(c);
		return {lines, visit: st.visit, discount: TBViewStore.discountOf(st), log: c.play.log.slice(0, 5).map(l => l.text + (l.notes && l.notes.length ? " [" + l.notes.join("; ") + "]" : ""))};
	`);
	await js(`const i = document.querySelector(".st-cat input[type=search]"); i.value = "longsword"; i.dispatchEvent(new Event("input")); await new Promise(r => setTimeout(r, 2000));`);
	await shot("store-weaponsmith.png");
	out.buy = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const c = TBStore.char("st-bard");
		const row = [...document.querySelectorAll(".st-row")].find(e => e.querySelector(".t").firstChild.textContent === "Longsword");
		const shown = row.innerText.replace(/\\n+/g, " | ");
		row.querySelector("button").click(); await wait(1500);
		const before = c.equipment.cp;
		[...document.querySelectorAll(".btn.primary")].find(b => /^Pay /.test(b.textContent)).click(); await wait(2500);
		return {shown, before, after: c.equipment.cp, inv: c.equipment.items.map(i => i.name + " x" + i.qty)};
	`);
	out.sell = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const c = TBStore.char("st-bard");
		[...document.querySelectorAll(".st-vendor")].find(e => e.querySelector(".t").textContent === "Jeweler").click(); await wait(2500);
		const rows = [...document.querySelectorAll("#view-store .pl-item")].filter(e => e.querySelector(".nm")).map(e => e.innerText.replace(/\\n+/g, " | "));
		const before = c.equipment.cp;
		const sellCard = [...document.querySelectorAll("#view-store .pl-card")].find(e => e.querySelector("h3")?.textContent === "Sell & valuables");
		[...sellCard.querySelectorAll(".pl-item")].find(e => e.querySelector(".nm")?.textContent === "Diamond").querySelector("button").click(); await wait(2000);
		const coinsAfterSell = TBPlay.gearOf(c).cp;
		return {rows, before: TBPlay.gearOf(c).cp, coinsAfterSell, charPage: c.equipment.cp, log: c.play.log.slice(0, 2).map(l => l.text)};
	`);
	await shot("store-jeweler.png");
	out.scribe = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const c = TBStore.char("st-bard");
		[...document.querySelectorAll(".st-vendor")].find(e => e.querySelector(".t").textContent === "Scribe & Scroll Shop").click(); await wait(2500);
		const i = document.querySelector(".st-cat input[type=search]"); i.value = "fireball"; i.dispatchEvent(new Event("input")); await wait(2000);
		const row = [...document.querySelectorAll(".st-row")].find(e => /Fireball/.test(e.innerText));
		const shown = row ? row.innerText.replace(/\\n+/g, " | ") : "missing";
		row.querySelector("button").click(); await wait(1200);
		[...document.querySelectorAll(".btn.primary")].find(b => /^Pay /.test(b.textContent)).click(); await wait(2500);
		return {shown, inv: c.equipment.items.map(i => i.name + (i.notes ? " (" + i.notes + ")" : "") + " x" + i.qty), coins: TBShop.money(c.equipment.cp)};
	`);
	await shot("store-scribe.png");
	out.ended = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const c = TBStore.char("st-bard");
		// The Store's inventory card: wield the new Longsword there, then look at Play
		const storeInv = [...document.querySelectorAll("#view-store .pl-card")].find(e => e.querySelector("h3")?.textContent === "Inventory");
		[...storeInv.querySelectorAll(".pl-item")].find(e => e.querySelector(".nm")?.firstChild?.textContent === "Longsword").querySelector("input[type=checkbox]").click(); await wait(1500);
		TBViewPlay.state.mainTab = "equipment"; TBApp.setView("play"); await wait(2000);
		const playEq = [...document.querySelectorAll("#view-play .pl-item")].filter(e => e.querySelector("input[type=checkbox]")?.checked).map(e => e.querySelector(".nm").textContent);
		const charPageMid = {cp: c.equipment.cp, items: c.equipment.items.map(i => i.name + " x" + (i.qty || 1) + (i.equipped ? " (eq)" : ""))};
		[...document.querySelectorAll(".btn")].find(b => /End session/.test(b.textContent)).click(); await wait(800);
		const summary = document.querySelector(".pl-gearchg")?.innerText;
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "End without XP").click(); await wait(1500);
		const charPageAfter = {cp: c.equipment.cp, items: c.equipment.items.map(i => i.name + (i.notes ? " (" + i.notes + ")" : "") + " x" + (i.qty || 1) + (i.equipped ? " (eq)" : ""))};
		const dis = document.querySelector("#tb-nav [data-view=store]").disabled;
		// Second session: buy rope, then end without updating
		await TBViewPlay.startSession("st-bard"); await wait(2000);
		TBApp.setView("store"); await wait(2500);
		[...document.querySelectorAll(".st-vendor")].find(e => e.querySelector(".t").textContent === "General Store").click(); await wait(2500);
		const i = document.querySelector(".st-cat input[type=search]"); i.value = "rope"; i.dispatchEvent(new Event("input")); await wait(2000);
		[...document.querySelectorAll(".st-row")].find(e => e.querySelector(".t").firstChild.textContent === "Rope").querySelector("button").click(); await wait(1200);
		[...document.querySelectorAll(".btn.primary")].find(b => /^Pay /.test(b.textContent)).click(); await wait(2000);
		TBApp.setView("play"); await wait(1500);
		[...document.querySelectorAll(".btn")].find(b => /End session/.test(b.textContent)).click(); await wait(800);
		const summary2 = document.querySelector(".pl-gearchg")?.innerText;
		document.querySelector(".pl-gearchg input[type=checkbox]").click();
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "End without XP").click(); await wait(1500);
		const discarded = {cp: c.equipment.cp, rope: c.equipment.items.some(x => x.name === "Rope"), gearLeft: !!c.play.gear};
		const st = TBStore.get();
		st.characters = st.characters.filter(x => !/^st-/.test(x.id));
		st.books = st.books.filter(b => !/^st-/.test(b.ownerCharId || ""));
		await TBStore.flush();
		return {playEq, charPageMid, summary, charPageAfter, storeDisabledAfterEnd: dis, summary2, discarded};
	`);
	fs.writeFileSync(path.join(outDir, "store.json"), JSON.stringify(out, null, 2));
	win.destroy();
}

module.exports.store = store;


/** Dice modes and outcomes: hit/miss menus, smites, Sneak Attack, failed checks, Concentration. */
async function dice ({baseUrl, outDir, appDir}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1500, height: 950, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	const js = (code) => win.webContents.executeJavaScript(`(async () => { const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const btn = (re) => [...document.querySelectorAll(".modal .btn")].find(b => re.test(b.textContent.trim()));
		const click = async (re, ms = 900) => { const b = btn(re); if (!b) throw new Error("no modal button " + re + " in: " + [...document.querySelectorAll(".modal .btn")].map(x => x.textContent).join(" | ")); b.click(); await wait(ms); };
		const row = (n) => [...document.querySelectorAll("#view-play .pl-act")].find(r => r.querySelector(".t")?.firstChild?.textContent === n);
		const typeDie = (v) => { const i = document.querySelector(".modal input.pl-die"); i.value = String(v); };
		const logTop = (c, n = 6) => TBStore.char(c).play.log.slice(0, n).map(l => l.text);
		${code} })()`);
	const shot = async (name) => fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG());
	await win.loadURL(`${baseUrl}/tb-app.html`);
	await new Promise(r => setTimeout(r, 3000));
	const out = {};
	await js(`
		const st = TBStore.get();
		const base = (id, name, cls, sub, abil, items, spells, level = 5) => ({id, name, player: "", classes: [{name: cls, source: "XPHB", level, subclass: sub}], species: {name: "Human", source: "XPHB"}, background: {name: "Soldier", source: "XPHB"}, abilities: {method: "manual", base: abil}, equipment: {items, cp: 0}, choices: {}, feats: [], spells, optfeatures: [], settings: {}, createdAt: Date.now()});
		st.characters.push(base("st-pal", "Selftest Paladin", "Paladin", {name: "Oath of Devotion", shortName: "Devotion", source: "XPHB"}, {str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 16}, [{name: "Longsword", source: "XPHB", qty: 1, equipped: true}], [{name: "Divine Smite", source: "XPHB"}, {name: "Searing Smite", source: "XPHB"}]));
		st.characters.push(base("st-rog", "Selftest Rogue", "Rogue", {name: "Thief", shortName: "Thief", source: "XPHB"}, {str: 10, dex: 16, con: 14, int: 12, wis: 12, cha: 10}, [{name: "Rapier", source: "XPHB", qty: 1, equipped: true}], []));
		st.characters.push(base("st-fig", "Selftest Veteran", "Fighter", {name: "Champion", shortName: "Champion", source: "XPHB"}, {str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8}, [{name: "Greatsword", source: "XPHB", qty: 1, equipped: true}], [], 13));
		for (const c of st.characters.filter(x => /^st-/.test(x.id))) await TBApp.syncBook(c);
		TBApp.setView("play");
	`);
	// A. "Some rolls": the Paladin hits (no number), damage isn't asked, Divine Smite is offered and spends its slot only now
	out.paladin = await js(`
		await TBViewPlay.startSession("st-pal"); await wait(2500);
		const P = TBPlay.stateOf(TBStore.char("st-pal"));
		P.physical = "some";
		TBViewPlay.render(); await wait(1500);
		const slotsBefore = JSON.stringify(P.slotsUsed);
		row("Longsword").querySelector("button").click(); await wait(1000);
		const dialog = document.querySelector(".modal")?.innerText.replace(/\\n+/g, " | ");
		await click(/^Hit$/, 1500);
		const hitMenu = [...document.querySelectorAll(".modal .btn")].map(b => b.textContent);
		await click(/^Cast Divine Smite/, 1200);
		await click(/^(Next|Cast)$/, 1800);
		await click(/^Nothing more/, 1000);
		return {dialog, hitMenu, slotsBefore, slotsAfter: JSON.stringify(P.slotsUsed), log: logTop("st-pal", 7)};
	`);
	await shot("dice-paladin.png");
	// A2. Concentration (Searing Smite) in app mode: damage → save against DC 10, worked out
	out.conc = await js(`
		const c = TBStore.char("st-pal");
		const P = TBPlay.stateOf(c);
		P.concentration = {name: "Searing Smite", level: 1};
		P.physical = false; TBViewPlay.render(); await wait(1500);
		const inp = document.querySelector("#view-play .pl-card .row input[type=number]"); inp.value = "12";
		[...document.querySelectorAll("#view-play .btn")].find(b => /Damage$/.test(b.textContent)).click(); await wait(2000);
		return {log: logTop("st-pal", 4), conc: P.concentration?.name || null};
	`);
	// B. "Some rolls": a skill check that changes nothing isn't asked for
	out.someCheck = await js(`
		await TBViewPlay.startSession("st-rog"); await wait(2500);
		const P = TBPlay.stateOf(TBStore.char("st-rog"));
		P.physical = "some"; TBViewPlay.render(); await wait(1500);
		[...document.querySelectorAll("#view-play .pl-skill .nm")].find(e => /^Perception/.test(e.textContent)).click(); await wait(1200);
		return {modalOpen: !!document.querySelector(".modal"), log: logTop("st-rog", 1)};
	`);
	// C. "Every result": a miss (no damage), then a hit with Sneak Attack
	out.rogue = await js(`
		const P = TBPlay.stateOf(TBStore.char("st-rog"));
		P.physical = true; TBViewPlay.render(); await wait(1500);
		row("Rapier").querySelector("button").click(); await wait(1000);
		const dialog = document.querySelector(".modal")?.innerText.replace(/\\n+/g, " | ");
		typeDie(7); await click(/^Miss$/, 1500);
		if (btn(/^Nothing more/)) await click(/^Nothing more/);
		P.turn.action = false; TBViewPlay.render(); await wait(1200);
		row("Rapier").querySelector("button").click(); await wait(1000);
		typeDie(15); await click(/^Hit$/, 1200);
		typeDie(6); await click(/^OK$/, 1500);
		const hitMenu = [...document.querySelectorAll(".modal .btn")].map(b => b.textContent);
		await click(/^Sneak Attack/, 1000);
		typeDie(8); await click(/^OK$/, 1200);
		if (btn(/^Nothing more/)) await click(/^Nothing more/);
		return {dialog, hitMenu, sneakUsed: !!P.turn.once?.sneak, log: logTop("st-rog", 8)};
	`);
	await shot("dice-rogue.png");
	// D. App dice: a failed check turned around with Tactical Mind; a miss gives Studied Attacks
	out.fighter = await js(`
		await TBViewPlay.startSession("st-fig"); await wait(2500);
		const c = TBStore.char("st-fig");
		const P = TBPlay.stateOf(c);
		P.physical = false; TBViewPlay.render(); await wait(1500);
		[...document.querySelectorAll("#view-play .pl-skill .nm")].find(e => /^Athletics/.test(e.textContent)).click(); await wait(1200);
		const failBtn = [...document.querySelectorAll("#view-play .pl-logrow button")].find(b => /It failed/.test(b.textContent));
		let tactical = null;
		if (failBtn) {
			failBtn.click(); await wait(1000);
			const menu = [...document.querySelectorAll(".modal .btn")].map(b => b.textContent);
			await click(/^Tactical Mind/, 1200);
			await click(/^Succeeded$/, 1500);
			const sw = TBPlay.resources((await TBRules.analyze(TBPlay.sessionChar(c))).derived).find(r => /Second Wind/.test(r.name));
			tactical = {menu, secondWindLeft: sw ? TBPlay.remaining(c, sw) + "/" + sw.max : "?"};
		}
		P.turn.action = false; TBViewPlay.render(); await wait(1200);
		row("Greatsword").querySelector("button").click(); await wait(1200);
		const outcomeAsk = document.querySelector(".modal")?.innerText.replace(/\\n+/g, " | ");
		if (btn(/^Miss$/)) await click(/^Miss$/, 1200);
		if (btn(/^Nothing more/)) await click(/^Nothing more/);
		return {failBtn: !!failBtn, tactical, outcomeAsk, effects: P.effects.map(e => e.name), log: logTop("st-fig", 6)};
	`);
	await js(`
		const st = TBStore.get();
		st.characters = st.characters.filter(x => !/^st-/.test(x.id));
		st.books = st.books.filter(b => !/^st-/.test(b.ownerCharId || ""));
		await TBStore.flush();
	`);
	fs.writeFileSync(path.join(outDir, "dice.json"), JSON.stringify(out, null, 2));
	win.destroy();
}

module.exports.dice = dice;

/**
 * SHEET (1.8): the Play sheet's tabbed menu. Features & Traits, Equipment, Notes (session book, quick add,
 * homebrew of every kind), About (edits held until End session), then End session: notes reach the character page.
 */
async function sheet ({baseUrl, outDir, appDir, renderPdf}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1600, height: 1000, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	win.webContents.on("console-message", (e, level, message, line, sourceId) => { if (level >= 2) fs.appendFileSync(path.join(outDir, "console.txt"), `${message} (${sourceId}:${line})\n`); });
	await win.loadURL(`${baseUrl}/tb-app.html`);
	const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
	const wait = (ms) => new Promise(r => setTimeout(r, ms));
	const shot = async (name) => fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG());
	await wait(3000);
	const out = {};
	out.setup = await js(`
		const st = TBStore.get();
		st.characters.push({id: "st-rogue", name: "Rome", player: "", classes: [{name: "Rogue", source: "XPHB", level: 5}], species: {name: "Human", source: "XPHB"}, background: {name: "Criminal", source: "XPHB"}, abilities: {method: "manual", base: {str: 10, dex: 16, con: 14, int: 12, wis: 10, cha: 14}}, equipment: {items: [{name: "Leather Armor", source: "XPHB", qty: 1, equipped: true}, {name: "Dagger", source: "XPHB", qty: 2, equipped: true}, {name: "Shortbow", source: "XPHB", qty: 1}], cp: 2500}, choices: {}, feats: [], spells: [], optfeatures: [], details: {alignment: "Chaotic Good", age: "24", backstory: "Grew up on the docks."}, settings: {}, xp: 6500, createdAt: Date.now()});
		await TBApp.syncBook(TBStore.char("st-rogue"));
		st.settings.clipTarget = "st-rogue";
		TBApp.setView("play"); await TBViewPlay.startSession("st-rogue"); await new Promise(r => setTimeout(r, 2500));
		const b = TBStore.get().books.find(x => x.notesOf === "st-rogue");
		return {notesBook: !!b, clipTarget: st.settings.clipTarget === b?.id, tabs: [...document.querySelectorAll(".pl-mtabs button")].map(x => x.textContent)};
	`);
	await shot("sheet-actions.png");
	// Undo / redo: damage, a condition, then back and forward again (buttons and Ctrl+Z / Ctrl+Y)
	out.undo = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const c = TBStore.char("st-rogue");
		const hp = () => TBPlay.currentHp(c, null) ?? TBPlay.stateOf(c).hp;
		const P = () => TBPlay.stateOf(c);
		const inp = document.querySelector("#view-play .pl-hpctl input[type=number]"); inp.value = "7";
		[...document.querySelectorAll("#view-play .btn")].find(b => /Damage$/.test(b.textContent)).click(); await wait(1500);
		const afterDmg = P().hp;
		[...document.querySelectorAll("#view-play .chip")].find(b => b.textContent === "Prone").click(); await wait(1200);
		const conds1 = P().conditions.slice();
		const undoTitle = document.querySelector(".pl-undo button").title;
		document.querySelector(".pl-undo button").click(); await wait(1200);
		const conds2 = P().conditions.slice();
		document.dispatchEvent(new KeyboardEvent("keydown", {key: "z", ctrlKey: true, bubbles: true})); await wait(1200);
		const hpUndone = P().hp;
		document.dispatchEvent(new KeyboardEvent("keydown", {key: "y", ctrlKey: true, bubbles: true})); await wait(1200);
		const hpRedone = P().hp;
		document.querySelectorAll(".pl-undo button")[1].click(); await wait(1200);
		const conds3 = P().conditions.slice();
		return {afterDmg, conds1, undoTitle, conds2, hpUndone, hpRedone, conds3, undoLeft: TBViewPlay.history.undo.length, redoLeft: TBViewPlay.history.redo.length, log0: P().log[0]?.text};
	`);
	// Themes: Alpino on the sheet and in the Settings menu, then back to Albion
	out.themes = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		TBApp.setTheme("alpino"); await wait(500);
		const bg = getComputedStyle(document.body).backgroundColor;
		const abil = getComputedStyle(document.querySelector("button.pl-abil")).borderTopColor;
		return {theme: document.documentElement.dataset.theme, bg, abil, saved: TBStore.get().settings.theme};
	`);
	await shot("theme-alpino.png");
	await js(`TBApp.openSettings(); await new Promise(r => setTimeout(r, 600));`);
	await shot("settings-alpino.png");
	out.themes.back = await js(`document.querySelector(".modal .modal-f .btn")?.click(); TBApp.setTheme("albion"); await new Promise(r => setTimeout(r, 400)); return {theme: document.documentElement.dataset.theme || "albion", bg: getComputedStyle(document.body).backgroundColor}`);
	await shot("theme-albion.png");
	const tab = (k) => js(`TBViewPlay.state.mainTab = "${k}"; await TBViewPlay.render(); await new Promise(r => setTimeout(r, 900)); document.querySelector(".pl-menu")?.scrollIntoView(); document.querySelector(".pl-body").scrollTop -= 60; return [...document.querySelectorAll(".pl-mtabs button.active")].map(x => x.textContent)`);
	out.features = await tab("features");
	out.featureRows = await js(`
		const rows = [...document.querySelectorAll(".pl-menu .pl-xp-row")];
		rows.find(r => /Sneak Attack/.test(r.textContent))?.querySelector(".pl-xp-h").click();
		await new Promise(r => setTimeout(r, 400));
		return {count: rows.length, open: !!document.querySelector(".pl-menu .pl-xp-row.open .hfeat-b"), names: rows.slice(0, 8).map(r => r.querySelector("b").textContent)};
	`);
	await shot("sheet-features.png");
	out.equipment = await tab("equipment");
	out.equipmentRows = await js(`return [...document.querySelectorAll("#view-play .pl-menu .pl-item .nm")].map(e => e.textContent)`);
	// Notes: write, quick-add a spell (as the picker would), add one homebrew of each kind
	out.notes = await tab("notes");
	out.notesWork = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		// Chat-style lines: Enter sends each one; one of them highlighted and bold
		const send = async (txt, fmt) => {
			const ed = document.querySelector(".pl-notes .tbn-compose .tbn-ed");
			ed.focus(); document.execCommand("insertText", false, txt);
			if (fmt) {
				const r = document.createRange(); r.setStart(ed.firstChild, fmt[0]); r.setEnd(ed.firstChild, fmt[1]);
				getSelection().removeAllRanges(); getSelection().addRange(r);
				const tb = ed.closest(".tbn-edw").querySelector(".tbn-toolbar");
				tb.querySelector(".tbn-sw-hl-yellow").closest("button").click();
				tb.querySelector("button[title^='Bold']").click();
			}
			ed.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true})); await wait(500);
		};
		await send("Met Captain Vex at the harbor.");
		await send("She owes us 50 gp.", [12, 17]);
		const chat = [...document.querySelectorAll(".pl-notes .tbn-composer .tbn-line-t")].map(e => e.innerHTML);
		const c = TBStore.char("st-rogue");
		const b = TBStore.get().books.find(x => x.notesOf === c.id);
		// Clip mode lands in the session book's wiki chapter
		TBApp.addClip({title: "Fireball", html: "<p>A bright streak…</p>", url: "spells.html#fireball_xphb", pageTitle: "Spells", kind: "Popup"});
		const kinds = [
			{type: "item", name: "Vex's Signet Ring", desc: "A ring with a kraken seal."},
			{type: "feat", name: "Harbor Rat", desc: "You have Advantage on checks to find your way around docks."},
			{type: "feature", name: "Dockside Contacts", desc: "You know someone at every pier."},
			{type: "action", name: "Cheap Shot", eco: "bonus", uses: "1 / Short Rest", desc: "As a Bonus Action, you can make one dagger attack against a creature within 5 feet."},
			{type: "skill", skill: "athletics"},
			{type: "tool", name: "Navigator's Tools"},
			{type: "language", name: "Thieves' Cant"},
		];
		for (const k of kinds) {
			[...document.querySelectorAll(".pl-notes .btn")].find(x => /Add homebrew/.test(x.textContent)).click(); await wait(400);
			const m = document.querySelector(".modal:last-of-type") || document;
			const sels = [...document.querySelectorAll(".pl-hbform select")];
			sels[0].value = k.type; sels[0].dispatchEvent(new Event("change"));
			if (k.skill) { sels[1].value = k.skill; }
			if (k.eco) { sels[2].value = k.eco; }
			const ins = [...document.querySelectorAll(".pl-hbform input[type=text]")];
			if (k.name) ins[0].value = k.name;
			if (k.uses) ins[1].value = k.uses;
			if (k.desc) document.querySelector(".pl-hbform textarea").value = k.desc;
			[...document.querySelectorAll(".modal .btn.primary")].find(x => x.textContent === "Add").click(); await wait(1200);
		}
		const A = await TBRules.analyze(TBPlay.sessionChar(c));
		const d = A.derived;
		return {
			chat, noteHtml: b.chapters[0].items[0].html, clips: b.chapters.flatMap(ch => ch.items.filter(i => i.kind === "clip").map(i => i.title)),
			homebrewRows: [...document.querySelectorAll(".pl-notes .pl-xp-row b")].map(e => e.textContent),
			athletics: d.skills.athletics, tools: d.tools, languages: d.languages,
			homebrewFeatures: TBRules.featureList(d).filter(f => f.homebrew).map(f => f.name + " [" + f.act + "]"),
			inventory: TBPlay.gearOf(c).items.map(i => i.name),
			saved: (c.homebrew || []).length,
		};
	`);
	await shot("sheet-notes.png");
	// Diary: a day without notes asks first, then takes notes; ticked lines go to Important notes; a counter
	out.diary = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const c = TBStore.char("st-rogue");
		const t = new Date(); t.setDate(t.getDate() - 3);
		const iso = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
		document.querySelector(".pl-notes button.tbn-day[data-iso='" + iso + "']").click(); await wait(500);
		const ask = document.querySelector(".modal")?.innerText || "";
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "Add a note").click(); await wait(600);
		let card = document.querySelector(".pl-notes .tbn-daycard");
		const ed = card.querySelector(".tbn-ed.multi");
		ed.innerHTML = "<p>Ambushed on the coast road</p><p>The map shows <b>three</b> islands</p>";
		[...card.querySelectorAll("button")].find(b => b.textContent === "Save").click(); await wait(600);
		card = document.querySelector(".pl-notes .tbn-daycard");
		const lines = [...card.querySelectorAll(".tbn-line-t")].map(e => e.innerHTML);
		const cb = card.querySelectorAll(".tbn-line input[type=checkbox]")[1]; cb.checked = true; cb.dispatchEvent(new Event("change", {bubbles: true})); await wait(300);
		[...document.querySelector(".pl-notes .tbn-daycard").querySelectorAll("button")].find(b => b.textContent.startsWith("★")).click(); await wait(500);
		const cell = document.querySelector(".pl-notes button.tbn-day[data-iso='" + iso + "']").className;
		// Edit one line on its own
		document.querySelector(".pl-notes .tbn-daycard .tbn-line button[title='Edit this line']").click(); await wait(300);
		const led = document.querySelector(".pl-notes .tbn-daycard .tbn-line.editing .tbn-ed");
		led.innerHTML = "Ambushed on the <i>north</i> coast road"; led.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true})); await wait(400);
		const edited = document.querySelector(".pl-notes .tbn-daycard .tbn-line-t").innerHTML;
		[...document.querySelector(".pl-notes .tbn-daycard").querySelectorAll("button")].find(b => /Close/.test(b.textContent)).click(); await wait(400);
		// A counter, from the main sheet: +1 twice, capped at its maximum
		[...document.querySelectorAll("#view-play .pl-topR .tbn-ccard button")].find(b => /Counter/.test(b.textContent)).click(); await wait(400);
		const ins = document.querySelectorAll(".modal input"); ins[0].value = "Favors owed"; ins[1].value = "2"; ins[3].value = "3";
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "Create").click(); await wait(1000);
		for (let i = 0; i < 2; ++i) { document.querySelector("#view-play .pl-topR .tbn-counter button[title='Add 1']").click(); await wait(800); }
		return {ask, lines, edited, cell, closed: !document.querySelector(".pl-notes .tbn-daycard"), important: (c.importantNotes || []).map(n => n.html + " @" + n.date),
			counters: c.counters, topCounter: document.querySelector("#view-play .pl-topR .tbn-counter")?.innerText, diaryDays: document.querySelector(".pl-notes .tbn-calcard .card-h")?.innerText};
	`);
	// Notes from before 1.8.3: two books on one day (one per session), paragraphs with line breaks
	out.legacyNotes = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const c = TBStore.char("st-rogue");
		const iso = "2026-10-03";
		const mk = (html, at) => ({id: TBBook.uid(), ownerCharId: null, notesOf: c.id, sessionDate: iso, title: "old", chapters: [{id: TBBook.uid(), genKey: "session-notes", title: "Notes", items: [{id: TBBook.uid(), kind: "note", title: "Session notes", html}]}], hidden: [], createdAt: at, endedAt: at});
		TBStore.get().books.push(mk("<p>First session<br>still the first line</p><p>Second paragraph</p>", 1000), mk("<p>Later that day <script>x()</script>we rested</p>", 2000));
		TBStore.changed("book");
		await TBViewPlay.render(); await wait(800);
		const cell = document.querySelector(".pl-notes button.tbn-day[data-iso='" + iso + "']");
		const cls = cell ? cell.className : "missing";
		cell?.click(); await wait(600);
		const lines = [...document.querySelectorAll(".pl-notes .tbn-daycard .tbn-line-t")].map(e => e.innerHTML);
		// Tick the line from the second book and pin it
		const boxes = document.querySelectorAll(".pl-notes .tbn-daycard .tbn-line input[type=checkbox]");
		boxes[boxes.length - 1].checked = true; boxes[boxes.length - 1].dispatchEvent(new Event("change", {bubbles: true})); await wait(300);
		[...document.querySelector(".pl-notes .tbn-daycard").querySelectorAll("button")].find(b => b.textContent.startsWith("★")).click(); await wait(400);
		const pinned = (c.importantNotes || []).map(n => n.html);
		[...document.querySelector(".pl-notes .tbn-daycard").querySelectorAll("button")].find(b => /Close/.test(b.textContent)).click(); await wait(300);
		return {cls, lines, pinned};
	`);
	await js(`document.querySelector(".pl-notes .tbn-calcard")?.scrollIntoView();`);
	await shot("sheet-diary.png");
	out.actionsHasHomebrew = await js(`TBViewPlay.state.mainTab = "actions"; TBViewPlay.state.actTab = "bonus"; await TBViewPlay.render(); await new Promise(r => setTimeout(r, 900)); return [...document.querySelectorAll(".pl-act .t")].map(e => e.firstChild.textContent)`);
	// About: change a few details (held in the session)
	out.about = await tab("about");
	out.aboutWork = await js(`
		const f = (label) => [...document.querySelectorAll(".pl-about label.field")].find(l => l.querySelector("span").textContent === label).querySelector("input, textarea, select");
		const set = (label, v) => { const el = f(label); el.value = v; el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input")); };
		set("Age", "25"); set("Backstory", "Grew up on the docks. Now sails with Captain Vex."); set("Alignment", "Neutral Good");
		await new Promise(r => setTimeout(r, 400));
		const c = TBStore.char("st-rogue");
		return {pending: document.querySelector(".pl-pending").textContent, charAgeStill: c.details.age, sessionAge: TBPlay.stateOf(c).about.age};
	`);
	await shot("sheet-about.png");
	// End session: keep everything
	out.end = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		[...document.querySelectorAll("#view-play .btn")].find(b => /End session/.test(b.textContent)).click(); await wait(900);
		const dialog = document.querySelector(".modal")?.innerText;
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "End without XP").click(); await wait(1500);
		const c = TBStore.char("st-rogue");
		const b = TBStore.get().books.find(x => x.notesOf === c.id);
		return {
			dialog, details: {age: c.details.age, alignment: c.details.alignment, backstory: c.details.backstory},
			homebrew: (c.homebrew || []).map(x => x.type + ":" + x.name), items: c.equipment.items.map(i => i.name),
			book: b ? {ended: !!b.endedAt, date: b.sessionDate, chapters: b.chapters.map(ch => ch.title + " (" + ch.items.length + ")")} : null,
			clipTarget: TBStore.get().settings.clipTarget, play: {homebrew: TBPlay.stateOf(c).homebrew, about: TBPlay.stateOf(c).about},
		};
	`);
	// Character page: Features & traits, then the Notes tab (diary, important notes, counters, homebrew)
	out.charPage = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		TBApp.state.activeCharId = "st-rogue"; TBApp.state.charTab = "hero"; TBApp.setView("characters"); await wait(2500);
		const feats = [...document.querySelectorAll(".hfeatures .hfeat-h b")].map(e => e.textContent).filter(n => /Harbor|Dockside|Cheap/.test(n));
		const tabs = [...document.querySelectorAll(".hfeat-tabs button")].map(b => b.textContent);
		const topCounters = document.querySelector(".hero > .tbn-ccard")?.innerText;
		[...document.querySelectorAll(".hfeat-tabs button")].find(b => b.textContent === "Notes").click(); await wait(1200);
		const hub = document.querySelector(".hero .tbn-hub");
		// Today's notes from the character page (no session running)
		const ed = hub.querySelector(".tbn-compose .tbn-ed"); ed.focus(); document.execCommand("insertText", false, "Bought rope in town");
		ed.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true})); await wait(500);
		const today = new Date(); const iso = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
		document.querySelector(".hero .tbn-hub button.tbn-day[data-iso='" + iso + "']").click(); await wait(600);
		document.querySelector(".hero .tbn-daycard")?.scrollIntoView();
		return {tabs, homebrewOnPage: feats, topCounters, cards: [...document.querySelectorAll(".hero .tbn-hub > .card .card-h h3")].map(e => e.textContent),
			todayLines: [...document.querySelectorAll(".hero .tbn-daycard .tbn-line-t")].map(e => e.innerHTML), oldNotesCard: !!document.querySelector(".hnotes"),
			booksToday: TBStore.get().books.filter(b => b.notesOf === "st-rogue" && b.sessionDate === iso).length};
	`);
	await shot("char-notes.png");
	// A second session with nothing written: no empty book is kept
	out.second = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		TBApp.setView("play"); await TBViewPlay.startSession("st-rogue"); await wait(1500);
		[...document.querySelectorAll("#view-play .btn")].find(b => /End session/.test(b.textContent)).click(); await wait(900);
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "End without XP").click(); await wait(1200);
		return {notesBooks: TBStore.get().books.filter(x => x.notesOf === "st-rogue").length};
	`);
	// Warlock 2: invocations in the builder, the spell list and the Actions list (Agonizing Blast, Armor of Shadows, Pact of the Tome)
	out.warlock = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const X = "XPHB";
		const c = {id: "st-warlock", name: "Selftest Warlock", player: "", classes: [{name: "Warlock", source: X, level: 2}], species: {name: "Human", source: X}, background: {name: "Sage", source: X},
			abilities: {method: "manual", base: {str: 8, dex: 14, con: 14, int: 10, wis: 12, cha: 16}}, equipment: {items: [], cp: 0}, feats: [], spells: [], optfeatures: [], settings: {}, createdAt: Date.now(),
			choices: {"class:warlock|xphb:of:eldritch-invocations": [{name: "Agonizing Blast", source: X}, {name: "Armor of Shadows", source: X}, {name: "Pact of the Tome", source: X}],
				"class:warlock|xphb:cantrips": [{name: "Eldritch Blast", source: X}, {name: "Minor Illusion", source: X}], "class:warlock|xphb:prepared": [{name: "Hex", source: X}, {name: "Charm Person", source: X}, {name: "Armor of Agathys", source: X}],
				"class:warlock|xphb:of:pact of the tome|xphb:known:_:0": [{name: "Guidance", source: X}, {name: "Fire Bolt", source: X}, {name: "Light", source: X}],
				"class:warlock|xphb:of:pact of the tome|xphb:prepared:_:0": [{name: "Find Familiar", source: X}, {name: "Detect Magic", source: X}]}};
		TBStore.get().characters.push(c); TBStore.changed("char");
		const A = await TBRules.analyze(c);
		const d = A.derived;
		TBApp.setView("play"); await TBViewPlay.startSession("st-warlock"); await wait(1500);
		TBViewPlay.state.mainTab = "actions"; TBViewPlay.state.actTab = "action"; await TBViewPlay.render(); await wait(900);
		const rows = () => [...document.querySelectorAll("#view-play .pl-act")].map(r => r.querySelector(".t").textContent + " — " + r.querySelector(".d").textContent);
		const actionRows = rows().filter(t => /Eldritch Blast|Mage Armor|Armor of Shadows/.test(t));
		TBViewPlay.state.actTab = "other"; await TBViewPlay.render(); await wait(900);
		const otherRows = rows().filter(t => /Agonizing|Pact of the Tome/.test(t));
		TBPlay.stateOf(c).physical = false;
		TBViewPlay.state.actTab = "action"; await TBViewPlay.render(); await wait(900);
		const row = (re) => [...document.querySelectorAll("#view-play .pl-act")].find(r => re.test(r.querySelector(".t").textContent));
		row(/^Eldritch Blast/).querySelector("button").click(); await wait(2500);
		const ebLog = TBPlay.stateOf(c).log.slice(0, 3).map(l => l.text);
		row(/^Armor of Shadows/).querySelector("button").click(); await wait(700);
		const slotMenu = document.querySelector(".modal")?.innerText || "";
		[...document.querySelectorAll(".modal button")].find(b => b.textContent === "Next").click(); await wait(700);
		[...document.querySelectorAll(".modal button")].find(b => b.textContent.startsWith("Yourself")).click(); await wait(1500);
		const P = TBPlay.stateOf(c);
		return {
			incomplete: A.choices.filter(x => !x.complete && /warlock/.test(x.id)).map(x => x.title),
			pickedCantrip: A.choices.find(x => /agonizing blast.*:cantrip/.test(x.id))?.value,
			spells: d.spells.map(s => s.ent.name + (s.free ? " (free: " + s.free.via + ")" : "")), boosts: d.cantripBoosts,
			actionRows, otherRows, ebLog, slotMenu, pactUsed: P.pactUsed, effects: P.effects.map(e => e.name),
			ac: document.querySelector("#view-play").innerText.match(/(\\d+)\\s*\\n\\s*Armor Class/i)?.[1],
		};
	`);
	await shot("warlock-actions.png");
	await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		[...document.querySelectorAll("#view-play .btn")].find(b => /End session/.test(b.textContent)).click(); await wait(900);
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "End without XP").click(); await wait(1200);
	`);
	// Tablets in portrait: the full three-column sheet scaled to fit, with touch sizing
	out.tablet = {};
	await js(`TBApp.setView("play"); await TBViewPlay.startSession("st-rogue"); await new Promise(r => setTimeout(r, 2000));`);
	for (const [w, hgt] of [[820, 1180], [768, 1024], [1024, 1366]]) {
		win.setContentSize(w, hgt);
		await wait(900);
		out.tablet[w] = await js(`
			TBViewPlay.state.mainTab = "actions"; await TBViewPlay.render(); await new Promise(r => setTimeout(r, 900));
			const s = document.querySelector(".pl-sheet"); s.classList.add("pl-touch");
			const cols = [...document.querySelectorAll(".pl-grid.session > .pl-col")].map(e => Math.round(e.getBoundingClientRect().width));
			return {zoom: s.style.zoom, tablet: s.classList.contains("pl-tablet"), phone: document.body.classList.contains("tb-phone"), cols, overflowX: document.querySelector(".pl-body").scrollWidth > document.querySelector(".pl-body").clientWidth + 2};
		`);
		await wait(700); win.webContents.invalidate(); await wait(500);
		await shot(`tablet-${w}.png`);
	}
	await js(`TBViewPlay.state.mainTab = "notes"; await TBViewPlay.render(); await new Promise(r => setTimeout(r, 900)); document.querySelector(".pl-sheet").classList.add("pl-touch"); document.querySelector(".pl-menu").scrollIntoView();`);
	await shot("tablet-1024-notes.png");
	// Phone layout: the new tabs
	win.setSize(400, 860);
	await js(`TBStore.flush && await TBStore.flush();`);
	await win.loadURL(`${baseUrl}/tb-app.html?phone`);
	await wait(3500);
	await js(`TBApp.setView("play"); await TBViewPlay.startSession("st-rogue"); await new Promise(r => setTimeout(r, 2500));`);
	out.phoneTabs = await js(`return [...document.querySelectorAll(".pm-tabs button")].map(b => b.textContent)`);
	await js(`[...document.querySelectorAll(".pm-tabs button")].find(b => b.textContent === "Notes")?.click(); await new Promise(r => setTimeout(r, 1200));`);
	await shot("phone-notes.png");
	// A sideways drag on the diary calendar scrolls it; it must not switch the phone tab
	out.phoneSwipe = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const fire = async (el) => {
			const r = el.getBoundingClientRect();
			const t0 = new Touch({identifier: 1, target: el, clientX: r.x + r.width * 0.8, clientY: r.y + 20});
			const t1 = new Touch({identifier: 1, target: el, clientX: r.x + r.width * 0.1, clientY: r.y + 22});
			el.dispatchEvent(new TouchEvent("touchstart", {touches: [t0], changedTouches: [t0], bubbles: true}));
			el.dispatchEvent(new TouchEvent("touchend", {touches: [], changedTouches: [t1], bubbles: true}));
			await wait(900);
			return document.querySelector(".pm-tabs button.active")?.textContent;
		};
		const cal = document.querySelector(".tbn-cal-scroll");
		const onCalendar = cal ? await fire(cal) : "no calendar";
		const onCard = await fire(document.querySelector(".tbn-composer .card-h"));
		return {onCalendar, onCard};
	`);
	await js(`[...document.querySelectorAll(".pm-tabs button")].find(b => b.textContent === "Stats")?.click(); await new Promise(r => setTimeout(r, 1200));`);
	await shot("phone-stats.png");
	// House rules: Erasmelix reworks Human (Versatile out, Minotaur horns in) through the builder's rework button
	win.setSize(1600, 1000);
	await win.loadURL(`${baseUrl}/tb-app.html`);
	await wait(3500);
	out.houseRules = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const c = {id: "st-hr", name: "Erasmelix", player: "", classes: [{name: "Fighter", source: "XPHB", level: 3, subclass: {name: "Champion", shortName: "Champion", source: "XPHB"}}], species: {name: "Human", source: "XPHB"}, background: {name: "Soldier", source: "XPHB"},
			abilities: {method: "manual", base: {str: 15, dex: 12, con: 14, int: 10, wis: 10, cha: 8}}, equipment: {items: [{name: "Longsword", source: "XPHB", qty: 1, equipped: true}], cp: 0}, choices: {"species:skills": ["perception"], "species:size": ["M"]}, feats: [], spells: [], optfeatures: [], settings: {}, createdAt: Date.now()};
		TBStore.get().characters.push(c); TBStore.changed("char");
		const before = (await TBRules.analyze(c)).choices.filter(x => x.step === "species").map(x => x.title);
		TBApp.state.activeCharId = "st-hr"; TBViewBuilder.goTo("species"); TBApp.openCharTab("builder"); TBApp.setView("characters"); await wait(1800);
		document.querySelector(".hr-btn").click(); await wait(500);
		const menu = [...document.querySelectorAll(".choose-opt")].map(b => b.textContent);
		[...document.querySelectorAll(".choose-opt")][0].click(); await wait(900);
		[...document.querySelectorAll(".hr-trait")].find(t => t.querySelector("input").value === "Versatile").querySelector("button[title^='Remove']").click(); await wait(200);
		[...document.querySelectorAll(".hr-modal button")].find(b => /From another species/.test(b.textContent)).click(); await wait(1800);
		const pk = [...document.querySelectorAll(".modal")].pop();
		const search = pk.querySelector("input[type=search]"); search.value = "horns"; search.dispatchEvent(new Event("input", {bubbles: true})); await wait(900);
		const row = [...pk.querySelectorAll(".pl-row")].find(r => /^Horns/.test(r.textContent)) || pk.querySelector(".pl-row");
		row.dispatchEvent(new MouseEvent("dblclick", {bubbles: true})); await wait(400);
		[...pk.querySelectorAll("button")].find(b => b.textContent === "Done").click(); await wait(400);
		// A trait that carries mechanics: Darkvision from the Tiefling
		[...document.querySelectorAll(".hr-modal button")].find(b => /From another species/.test(b.textContent)).click(); await wait(1800);
		const pk2 = [...document.querySelectorAll(".modal")].pop();
		const s2 = pk2.querySelector("input[type=search]"); s2.value = "darkvision"; s2.dispatchEvent(new Event("input", {bubbles: true})); await wait(900);
		const r2 = [...pk2.querySelectorAll(".pl-row")].find(r => /Tiefling/.test(r.textContent) && /^Darkvision/.test(r.textContent));
		r2.dispatchEvent(new MouseEvent("dblclick", {bubbles: true})); await wait(400);
		[...pk2.querySelectorAll("button")].find(b => b.textContent === "Done").click(); await wait(400);
		const nm = document.querySelector(".hr-form input[type=text]"); nm.value = "Horned Human";
		const traits = [...document.querySelectorAll(".hr-trait")].map(t => t.querySelector("input").value + (t.querySelector(".hr-mech") ? " [" + t.querySelector(".hr-mech").textContent + "]" : ""));
		[...document.querySelectorAll(".hr-modal button")].find(b => b.textContent === "Save house rule").click(); await wait(2000);
		const A = await TBRules.analyze(c);
		const d = A.derived;
		const book = TBStore.get().books.find(b => b.hrOf === c.id);
		// Another character doesn't see Erasmelix's house rule
		const other = {id: "st-hr-other", name: "Other", classes: [], choices: {}};
		const visibleToOther = (await TBData.loadRaces()).filter(r => r._tbHR && TBHouse.visible(r, other)).length;
		return {before, menu, traits, species: c.species, after: A.choices.filter(x => x.step === "species").map(x => x.title + "=" + JSON.stringify(x.value)),
			darkvision: d.darkvision, features: TBRules.featureList(d).filter(f => f.kind === "Species").map(f => f.name),
			book: book && {title: book.title, chapters: book.chapters.map(ch => ch.title + ": " + ch.items.map(i => i.title).join(", ")), html: book.chapters[0].items[0].html.length},
			visibleToOther, records: (c.houseRules || []).length};
	`);
	await shot("hr-species.png");
	// The other kinds: background rework, a new spell, weapon, feat and language through each step's button
	out.houseRules2 = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const c = TBStore.char("st-hr");
		const step = async (re) => { [...document.querySelectorAll(".bstep")].find(b => re.test(b.textContent)).click(); await wait(1500); };
		const make = async (optRe, fill) => {
			document.querySelector(".hr-btn").click(); await wait(500);
			[...document.querySelectorAll(".choose-opt")].find(b => optRe.test(b.textContent)).click(); await wait(1500);
			const m = document.querySelector(".hr-modal");
			const lbl = (txt) => [...m.querySelectorAll("label.field")].find(l => l.querySelector("span").textContent.startsWith(txt));
			fill(m, lbl);
			[...m.querySelectorAll("button")].find(b => b.textContent === "Save house rule").click(); await wait(1800);
		};
		await step(/Background/);
		await make(/Rework Soldier/, (m, lbl) => {
			lbl("Name").querySelector("input").value = "Horn-Guard Soldier";
			const sk = lbl("Skill proficiencies");
			[...sk.querySelectorAll(".chip")].find(b => b.textContent === "Intimidation").click();
			[...sk.querySelectorAll(".chip")].find(b => b.textContent === "Survival").click();
		});
		await step(/Spells/);
		await make(/New spell/, (m, lbl) => {
			lbl("Name").querySelector("input").value = "Chimeric Gore";
			lbl("Level").querySelector("select").value = "0";
			lbl("Description").querySelector("textarea").value = "Spectral horns gore a creature within reach.";
			lbl("Damage or healing dice").querySelector("input").value = "1d10";
			lbl("Type").querySelector("select").value = "piercing";
			lbl("Attack").querySelector("select").value = "M";
			[...lbl("Spell lists").querySelectorAll(".chip")].find(b => b.textContent === "Wizard").click();
		});
		await step(/Equipment/);
		await make(/New equipment/, (m, lbl) => {
			lbl("Name").querySelector("input").value = "Gore Gauntlet";
			lbl("Category").querySelector("select").value = "1";
			lbl("Damage").querySelector("input").value = "1d8";
			lbl("Type").querySelector("select").value = "piercing";
			[...lbl("Properties").querySelectorAll(".chip")].find(b => b.textContent === "Light").click();
			lbl("Magic bonus").querySelector("select").value = "1";
			lbl("Rarity").querySelector("select").value = "uncommon";
			lbl("Price (GP)").querySelector("input").value = "450";
		});
		c.equipment.items.find(i => i.name === "Gore Gauntlet").equipped = true;
		await step(/Details/);
		await make(/New feat/, (m, lbl) => {
			lbl("Name").querySelector("input").value = "Horned Charge";
			[...lbl("Ability Score Increase").querySelectorAll(".chip")].filter(b => /Strength|Constitution/.test(b.textContent)).forEach(b => b.click());
			lbl("Description").querySelector("textarea").value = "After moving 20 feet straight toward a creature, your horn hit deals an extra {@damage 1d6} Piercing damage.";
		});
		await make(/New language/, (m, lbl) => { lbl("Name").querySelector("input").value = "Old Hornish"; });
		const A = await TBRules.analyze(c);
		const d = A.derived;
		const cat = await TBShop.catalog();
		const row = cat.rows.find(r => r.name === "Gore Gauntlet");
		const gore = d.spells.find(s => s.ent.name === "Chimeric Gore");
		return {
			background: c.background.name, skills: Object.entries(d.skills).filter(([, v]) => v.prof).map(([k]) => k), bgFeat: d.feats.map(f => f.ent.name + "/" + f.via),
			spell: gore && {via: gore.via, classes: gore.ent._tbClasses, dice: TBPlay.spellDice(gore.ent, 0, 5)},
			attack: d.attacks.find(a => a.name === "Gore Gauntlet"), store: row && {cp: row.cp, owner: TBHouse.visible(row.ent, c), other: TBHouse.visible(row.ent, {id: "nobody"})},
			featChoice: A.choices.filter(x => x.id.startsWith("extra:feat")).map(x => x.title), language: A.choices.find(x => x.id === "details:languages").options.some(o => o.label === "Old Hornish"),
			book: TBStore.get().books.find(b => b.hrOf === c.id).chapters.map(ch => ch.title + ": " + ch.items.map(i => i.title).join(", ")),
			records: c.houseRules.map(r => r.kind + ":" + r.title),
		};
	`);
	await shot("hr-details.png");
	// Class: Erasmelix's Fighter 3 (Champion, choices made) becomes an "Ironhorn Fighter": d12, no Second Wind, Rage borrowed
	out.houseRulesClass = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const c = TBStore.char("st-hr");
		Object.assign(c.choices, {"class:fighter|xphb:skills": ["athletics", "survival"], "class:fighter|xphb:L1:fighting-style": [{name: "Defense", source: "XPHB"}], "class:fighter|xphb:mastery": ["longsword", "greataxe", "spear"]});
		TBStore.changed("char");
		const A0 = await TBRules.analyze(c);
		const before = {hp: A0.derived.hp, features: A0.derived.classes[0].features.filter(f => f.level <= 3).map(f => f.name)};
		[...document.querySelectorAll(".bstep")].find(b => /Class/.test(b.textContent)).click(); await wait(1500);
		document.querySelector(".bclass .hr-btn").click(); await wait(500);
		const menu = [...document.querySelectorAll(".choose-opt")].map(b => b.textContent);
		[...document.querySelectorAll(".choose-opt")][0].click(); await wait(2000);
		const m = document.querySelector(".hr-modal");
		const lbl = (txt) => [...m.querySelectorAll("label.field")].find(l => l.querySelector("span").textContent.startsWith(txt));
		lbl("Name of this version").querySelector("input").value = "Ironhorn Fighter";
		lbl("Hit Die").querySelector("select").value = "12";
		[...m.querySelectorAll(".hr-keep label")].find(l => /Second Wind/.test(l.textContent)).querySelector("input").click();
		[...m.querySelectorAll("button")].find(b => /From another class/.test(b.textContent)).click(); await wait(2200);
		const pk = [...document.querySelectorAll(".modal")].pop();
		const se = pk.querySelector("input[type=search]"); se.value = "rage"; se.dispatchEvent(new Event("input", {bubbles: true})); await wait(900);
		[...pk.querySelectorAll(".pl-row")].find(x => /^Rage/.test(x.textContent) && /Barbarian 1/.test(x.textContent)).dispatchEvent(new MouseEvent("dblclick", {bubbles: true})); await wait(900);
		[...pk.querySelectorAll("button")].find(b => b.textContent === "Done").click(); await wait(400);
		[...m.querySelectorAll("button")].find(b => b.textContent === "Save house rule").click(); await wait(2200);
		const A = await TBRules.analyze(c);
		const d = A.derived;
		return {
			menu, before, hp: d.hp, hd: d.classes[0].hd, title: d.classes[0].hrTitle, hr: !!c.classes[0].hr,
			features: d.classes[0].features.filter(f => f.level <= 3).map(f => f.name),
			choicesKept: ["class:fighter|xphb:skills", "class:fighter|xphb:L1:fighting-style", "class:fighter|xphb:mastery"].map(k => !!A.choices.find(x => x.id === k && x.complete)),
			rage: TBRules.featureList(d).filter(f => f.name === "Rage").map(f => f.act + " / " + f.uses),
			tab: document.querySelector(".cls-tab.on")?.textContent,
		};
	`);
	await shot("hr-class.png");
	// Play: cast the house-rule cantrip and attack with the house-rule weapon
	out.houseRulesPlay = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		TBApp.setView("play"); await TBViewPlay.startSession("st-hr"); await wait(2000);
		const c = TBStore.char("st-hr");
		TBPlay.stateOf(c).physical = false;
		TBViewPlay.state.mainTab = "actions"; TBViewPlay.state.actTab = "action"; await TBViewPlay.render(); await wait(900);
		const rows = [...document.querySelectorAll("#view-play .pl-act")].map(r => r.querySelector(".t").textContent).filter(t => /Gore|Horn/.test(t));
		const gore = [...document.querySelectorAll("#view-play .pl-act")].find(r => /^Chimeric Gore/.test(r.querySelector(".t").textContent));
		gore.querySelector("button").click(); await wait(1500);
		// The app rolled the attack: say it hit
		const hit = [...document.querySelectorAll(".modal button")].find(b => b.textContent === "Hit");
		const asked = !!hit;
		if (hit) { hit.click(); await wait(1500); }
		[...document.querySelectorAll(".modal button")].find(b => /Nothing more/.test(b.textContent))?.click(); await wait(800);
		const log = [asked ? "(asked: did it hit?)" : "(not asked)", ...TBPlay.stateOf(c).log.slice(0, 3).map(l => l.text)];
		[...document.querySelectorAll("#view-play .btn")].find(b => /End session/.test(b.textContent)).click(); await wait(900);
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "End without XP").click(); await wait(1200);
		return {rows, log};
	`);

	// Exports of the house-ruled character: booklet, cheat sheet, sheet and cards
	const hrPayload = await js(`
		const c = TBStore.char("st-hr");
		await TBApp.syncBook(c);
		const book = TBStore.bookOf(c.id);
		const A = await TBRules.analyze(c);
		return {book: TBViewExport.printableBook(book, c), cheat: await TBBook.buildCheat(c), sheet: TBExportData.sheetData(A), cards: TBExportData.cardsData(A), options: TBViewExport.pdfOptions(TBViewExport.optionsOf(book))};
	`);
	const hrBook = await renderPdf("/tb-print.html", {book: hrPayload.book, options: hrPayload.options});
	const hrCheat = await renderPdf("/tb-cheat.html", {cheat: hrPayload.cheat, pageMap: hrBook.info.pageMap, bookTitle: hrPayload.book.title, options: hrPayload.options});
	const hrSheet = await renderPdf("/tb-sheet.html", {sheet: hrPayload.sheet, pageMap: hrBook.info.pageMap, options: hrPayload.options});
	const hrCards = await renderPdf("/tb-cards.html", {...hrPayload.cards, pageMap: hrBook.info.pageMap, options: hrPayload.options});
	fs.writeFileSync(path.join(outDir, "hr-booklet.pdf"), hrBook.pdf);
	fs.writeFileSync(path.join(outDir, "hr-cheat.pdf"), hrCheat.pdf);
	fs.writeFileSync(path.join(outDir, "hr-sheet.pdf"), hrSheet.pdf);
	fs.writeFileSync(path.join(outDir, "hr-cards.pdf"), hrCards.pdf);
	out.hrExports = {booklet: hrBook.info.pageCount, cheat: hrCheat.info && hrCheat.info.sheets, hornsInBook: JSON.stringify(hrPayload.book).includes("Horns"), hornsInSheet: JSON.stringify(hrPayload.sheet).includes("Horns")};
	// 5etools homebrew: a fixture file through the site's engine, then every list that should see it
	const fixture = fs.readFileSync(path.join(appDir, "test-fixtures", "brew-fixture.json"), "utf8");
	win.setSize(1600, 1000);
	await win.loadURL(`${baseUrl}/tb-app.html`);
	await wait(3500);
	out.brewAdd = await js(`await BrewUtil2.pAddBrewsFromFiles([{json: ${fixture}, name: "Beldora; Fixture.json"}]); return (await BrewUtil2.pGetBrew()).length;`);
	win.reload();
	await wait(4500);
	out.brew = await js(`
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const races = await TBData.loadRaces();
		const cls = await TBData.loadClasses();
		const barb = cls.classes.find(c => c.name === "Barbarian" && c.source === "XPHB");
		const subs = (await TBData.getSubclasses(barb)).filter(x => x._tbBrew).map(x => x.name);
		const copied = races.find(r => r.name === "Copied Human");
		const spell = (await TBData.loadSpells()).find(x => x.name === "Fixture Bolt");
		const cat = await TBShop.catalog();
		const mons = await TBPlay.allMonsters();
		const c = {id: "st-brew", name: "Selftest Brew", player: "", classes: [{name: "Barbarian", source: "XPHB", level: 3, subclass: {name: "Path of the Fixture", shortName: "Fixture", source: "BeldoraFixture"}}], species: {name: "Hornkin", source: "BeldoraFixture"}, background: {name: "Soldier", source: "XPHB"},
			abilities: {method: "manual", base: {str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 10}}, equipment: {items: [{name: "Fixture Blade", source: "BeldoraFixture", qty: 1, equipped: true}], cp: 0}, choices: {}, feats: [], spells: [], optfeatures: [], settings: {}, createdAt: Date.now()};
		TBStore.get().characters.push(c); TBStore.changed("char");
		const A = await TBRules.analyze(c);
		const d = A.derived;
		TBApp.state.activeCharId = "st-brew"; TBApp.state.charTab = "hero"; TBApp.setView("characters"); await wait(2000);
		const tags = document.querySelectorAll(".hero .tag.brew").length;
		TBBrew.open(); await wait(1500);
		const manager = document.querySelector(".hb-modal")?.innerText || "";
		return {
			brewSpecies: races.filter(r => r._tbBrew).map(r => r.name), copiedSpeed: copied && copied.speed, copiedTraits: copied && (copied.entries || []).filter(e => e.name).map(e => e.name),
			subs, spellClasses: spell && spell._tbClasses,
			store: cat.rows.filter(r => r.brew).map(r => r.name + " " + r.cp), beast: !!mons.byKey.get("fixture beast|beldorafixture"),
			features: TBRules.featureList(d).filter(f => f.brew).map(f => f.kind + ":" + f.name), darkvision: d.darkvision, attacks: d.attacks.map(a => a.name + " " + a.damage),
			tags, manager: manager.slice(0, 600),
		};
	`);
	await shot("brew-manager.png");
	out.brewClean = await js(`document.querySelector(".hb-modal .btn.primary")?.click(); const all = await BrewUtil2.pGetBrew(); await BrewUtil2.pDeleteBrews(all); return (await BrewUtil2.pGetBrew()).length;`);
	fs.writeFileSync(path.join(outDir, "sheet.json"), JSON.stringify(out, null, 2));
	win.destroy();
}

module.exports.sheet = sheet;

/**
 * FORMS: the Temporary Form and Companions & Summons cards inside the 1.8 sheet. A Moon Druid takes a Wild
 * Shape and summons a beast; a Wizard brings a familiar and a fey. Screens at desktop, tablet and phone sizes.
 */
async function forms ({baseUrl, outDir, appDir}) {
	fs.mkdirSync(outDir, {recursive: true});
	const win = new BrowserWindow({show: false, width: 1600, height: 1000, webPreferences: {preload: path.join(appDir, "preload.js"), contextIsolation: true, sandbox: false}});
	win.webContents.on("console-message", (e, level, message, line, sourceId) => { if (level >= 2) fs.appendFileSync(path.join(outDir, "console.txt"), `${message} (${sourceId}:${line})\n`); });
	await win.loadURL(`${baseUrl}/tb-app.html`);
	const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
	const wait = (ms) => new Promise(r => setTimeout(r, ms));
	const shot = async (name) => { await wait(600); win.webContents.invalidate(); await wait(400); fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG()); };
	await wait(3000);
	const out = {};
	const helpers = `
		const wait = (ms) => new Promise(r => setTimeout(r, ms));
		const row = (n) => [...document.querySelectorAll("#view-play .pl-act")].find(r => r.querySelector(".t")?.firstChild?.textContent === n);
		const tabOf = async (k) => { TBViewPlay.state.actTab = k; await TBViewPlay.render(); await wait(700); };
		const next = async () => { const b = [...document.querySelectorAll(".modal .btn.primary")].find(x => ["Cast", "Next"].includes(x.textContent)); if (b) { b.click(); await wait(1800); } };
		const pickIn = async (re, variant) => {
			const r = [...document.querySelectorAll(".modal .pl-row")].find(x => re.test(x.querySelector(".nm").textContent));
			if (!r) return false;
			const sel = r.querySelector("select"); if (sel && variant) { sel.value = variant; sel.dispatchEvent(new Event("change")); }
			r.querySelector(".btn.primary").click(); await wait(1500); return true;
		};
		const use = async (name, re, variant, tab) => {
			if (tab) await tabOf(tab);
			const r = row(name); if (!r) return "no row " + name;
			r.querySelector("button").click(); await wait(600);
			await next();
			const opt = [...document.querySelectorAll(".modal .btn")].find(b => /^(Yourself|Use|Wild Shape)/.test(b.textContent)); if (opt && !document.querySelector(".modal .pl-row")) { opt.click(); await wait(1200); }
			return await pickIn(re, variant);
		};
		const sheetInfo = (id) => { const c = TBStore.char(id); const P = c.play; return {form: P.form?.name, via: P.form?.via, summons: P.summons.map(s => s.name + " (" + s.via + ") AC " + s.ac + " HP " + s.hp + "/" + s.hpMax), cards: [...document.querySelectorAll("#view-play .pl-form .card-h h3")].map(e => e.textContent)}; };
	`;
	out.druid = await js(`${helpers}
		const st = TBStore.get();
		st.characters.push({id: "fx-druid", name: "Moon Druid", classes: [{name: "Druid", source: "XPHB", level: 8, subclass: {name: "Circle of the Moon", shortName: "Moon", source: "XPHB"}}], species: {name: "Human", source: "XPHB"}, background: {name: "Sage", source: "XPHB"}, abilities: {method: "manual", base: {str: 10, dex: 14, con: 14, int: 10, wis: 17, cha: 8}}, equipment: {items: [{name: "Leather Armor", source: "XPHB", qty: 1, equipped: true}], cp: 1000}, choices: {}, feats: [], spells: [{name: "Summon Beast", source: "XPHB"}], optfeatures: [], settings: {}, xp: 34000, createdAt: Date.now()});
		TBApp.setView("play"); await TBViewPlay.startSession("fx-druid"); await wait(2500);
		const sb = await use("Summon Beast", /^Bestial Spirit/, "Land", "action");
		const ws = await use("Wild Shape", /^Brown Bear|^Dire Wolf|^Giant Spider|^Black Bear/, null, "bonus");
		await tabOf("action");
		document.querySelector("#view-play .pl-form")?.scrollIntoView(); document.querySelector(".pl-body").scrollTop -= 70;
		return {ws, sb, ...sheetInfo("fx-druid")};
	`);
	await shot("forms-druid-desktop.png");
	out.druidCompanions = await js(`document.querySelectorAll("#view-play .pl-form")[1]?.scrollIntoView(); document.querySelector(".pl-body").scrollTop -= 70; await new Promise(r => setTimeout(r, 300)); return [...document.querySelectorAll("#view-play .pl-summon")].map(e => e.innerText.replace(/\\n+/g, " | "))`);
	await shot("forms-druid-summons.png");
	out.wizard = await js(`${helpers}
		const st = TBStore.get();
		[...document.querySelectorAll("#view-play .btn")].find(b => /End session/.test(b.textContent)).click(); await wait(800);
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "End without XP").click(); await wait(1200);
		st.characters.push({id: "fx-wiz", name: "Familiar Wizard", classes: [{name: "Wizard", source: "XPHB", level: 9}], species: {name: "Human", source: "XPHB"}, background: {name: "Sage", source: "XPHB"}, abilities: {method: "manual", base: {str: 8, dex: 14, con: 14, int: 17, wis: 12, cha: 10}}, equipment: {items: [], cp: 1000}, choices: {}, feats: [], spells: [{name: "Find Familiar", source: "XPHB"}, {name: "Summon Fey", source: "XPHB"}], optfeatures: [], settings: {}, xp: 48000, createdAt: Date.now()});
		await TBViewPlay.startSession("fx-wiz"); await wait(2500);
		const ff = await use("Find Familiar", /^Owl|^Cat|^Raven/, null, "other");
		const sf = await use("Summon Fey", /^Fey Spirit/, "Mirthful", "action");
		await tabOf("action");
		document.querySelector("#view-play .pl-form")?.scrollIntoView(); document.querySelector(".pl-body").scrollTop -= 70;
		return {ff, sf, ...sheetInfo("fx-wiz"), rows: [...document.querySelectorAll("#view-play .pl-summon")].map(e => e.innerText.replace(/\\n+/g, " | "))};
	`);
	await shot("forms-wizard-desktop.png");
	// Back to the druid (form + summon) at tablet sizes and on the phone
	await js(`${helpers}
		[...document.querySelectorAll("#view-play .btn")].find(b => /End session/.test(b.textContent)).click(); await wait(800);
		[...document.querySelectorAll(".modal .btn")].find(b => b.textContent === "End without XP").click(); await wait(1200);
		await TBViewPlay.startSession("fx-druid"); await wait(2000);`);
	out.tablet = {};
	for (const [w, hgt] of [[820, 1180], [768, 1024]]) {
		win.setContentSize(w, hgt);
		await wait(900);
		out.tablet[w] = await js(`
			TBViewPlay.state.mainTab = "actions"; TBViewPlay.state.actTab = "action"; await TBViewPlay.render(); await new Promise(r => setTimeout(r, 900));
			document.querySelector(".pl-sheet").classList.add("pl-touch");
			document.querySelector("#view-play .pl-form")?.scrollIntoView(); document.querySelector(".pl-body").scrollTop -= 60;
			const over = [...document.querySelectorAll("#view-play .pl-form, #view-play .pl-fstats, #view-play .pl-summon")].filter(e => e.scrollWidth > e.clientWidth + 2).map(e => e.className);
			return {zoom: document.querySelector(".pl-sheet").style.zoom, overflowing: over, form: !!document.querySelector("#view-play .pl-form"), summons: document.querySelectorAll("#view-play .pl-summon").length};
		`);
		await shot(`forms-tablet-${w}.png`);
	}
	win.setSize(400, 860);
	await js(`TBStore.flush && await TBStore.flush();`);
	await win.loadURL(`${baseUrl}/tb-app.html?phone`);
	await wait(3500);
	out.phone = await js(`
		TBApp.setView("play"); await TBViewPlay.startSession("fx-druid"); await new Promise(r => setTimeout(r, 2500));
		const over = [...document.querySelectorAll("#view-play .pl-form, #view-play .pl-fstats, #view-play .pl-summon")].filter(e => e.scrollWidth > e.clientWidth + 2).map(e => e.className);
		const r1 = document.querySelector(".pm-r1");
		return {form: !!document.querySelector("#view-play .pl-form"), summons: document.querySelectorAll("#view-play .pl-summon").length, overflowing: over, chips: [...document.querySelectorAll(".pm-chip")].map(e => e.textContent),
			strip: r1 ? {html: r1.outerHTML.slice(0, 700), kids: [...r1.children].map(k => k.className + " " + Math.round(k.getBoundingClientRect().width) + "x" + Math.round(k.getBoundingClientRect().height) + " @" + Math.round(k.getBoundingClientRect().left))} : null};
	`);
	await shot("forms-phone-act.png");
	await js(`const s = document.querySelectorAll("#view-play .pl-form")[1]; if (s) { s.scrollIntoView(); } await new Promise(r => setTimeout(r, 400));`);
	await shot("forms-phone-summons.png");
	fs.writeFileSync(path.join(outDir, "forms.json"), JSON.stringify(out, null, 2));
	win.destroy();
}

module.exports.forms = forms;
