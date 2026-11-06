"use strict";

/**
 * Platform layer for the browser and Android builds. The desktop app gets window.tbNative from Electron's
 * preload; here the same API is provided with web technology:
 *  - saves: IndexedDB (via localforage)
 *  - character files: download / file picker (Android: share sheet)
 *  - PDFs: each document is laid out in a hidden frame, then printed with the browser's "Save as PDF"
 *    (Android: the system print service, through the BeldoraPrint plugin)
 */
(() => {
	if (window.tbNative) return; // Electron

	const cap = window.Capacitor;
	const isAndroid = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
	const platform = isAndroid ? "android" : "web";
	document.documentElement.classList.add(`tb-platform-${platform}`);

	const STORE_KEY = "beldora-store";
	// Native plugins (no bundler: look them up on the Capacitor global)
	const plugin = (name) => (cap.Plugins && cap.Plugins[name]) || cap.registerPlugin(name);
	const db = () => window.localforage;

	const download = (name, blob) => {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
	};

	/** Android: write to the app cache and open the share sheet (save to Files/Drive, send to a friend…). */
	const shareFile = async (name, text) => {
		const Filesystem = plugin("Filesystem");
		const Share = plugin("Share");
		const res = await Filesystem.writeFile({path: name, data: text, directory: "CACHE", encoding: "utf8"});
		await Share.share({title: name, url: res.uri, dialogTitle: `Share ${name}`});
		return name;
	};

	const pickFile = (accept) => new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.style.display = "none";
		input.addEventListener("change", () => {
			const f = input.files && input.files[0];
			input.remove();
			if (!f) return resolve(null);
			const r = new FileReader();
			r.onload = () => { try { resolve(JSON.parse(r.result)); } catch (e) { resolve({__error: "That file is not valid JSON."}); } };
			r.readAsText(f);
		});
		document.body.appendChild(input);
		input.click();
	});

	// region PDF printing
	const PAGES = {
		book: {page: "tb-print.html", global: "__tbPreviewPayload", label: "Booklet"},
		cheat: {page: "tb-cheat.html", global: "__tbCheatPayload", label: "Cheat Sheet"},
		sheet: {page: "tb-sheet.html", global: "__tbSheetPayload", label: "Character Sheet"},
		cards: {page: "tb-cards.html", global: "__tbCardsPayload", label: "Cards"},
		encounter: {page: "tb-encounter.html", global: "__tbEncounterPayload", label: "Encounter"},
	};

	/** Lay a print page out in an off-screen frame and wait until it reports it is ready. */
	const layoutInFrame = (kind, payload) => new Promise((resolve, reject) => {
		const conf = PAGES[kind];
		window[conf.global] = payload;
		const f = document.createElement("iframe");
		Object.assign(f.style, {position: "fixed", left: "-12000px", top: "0", width: "1000px", height: "1400px", border: "0"});
		f.src = `${conf.page}?preview=1&t=${Date.now()}`;
		document.body.appendChild(f);
		const started = Date.now();
		const poll = setInterval(() => {
			const r = f.contentWindow && f.contentWindow.__tbResult;
			if (r) { clearInterval(poll); resolve({frame: f, result: r}); } else if (Date.now() - started > 240000) {
				clearInterval(poll);
				f.remove();
				reject(new Error("Timed out while laying out the document."));
			}
		}, 250);
	});

	/** The laid-out document as standalone HTML (scripts removed so nothing re-runs). */
	const snapshot = (frame) => {
		const doc = frame.contentDocument;
		const clone = doc.documentElement.cloneNode(true);
		clone.querySelectorAll("script").forEach(s => s.remove());
		return `<!doctype html>\n${clone.outerHTML}`;
	};

	const printFrame = async (frame, title) => {
		const w = frame.contentWindow;
		const prevTitle = document.title;
		w.document.title = title;
		document.title = title;
		try {
			if (window.__tbTestPrint) {
				// Automated tests capture what would be printed instead of opening a dialog
				window.__tbTestPrint.push({title, html: snapshot(frame).length, pages: frame.contentDocument.querySelectorAll(".pagedjs_page, .sheet, .page, .sheetpage, .flow").length});
			} else if (isAndroid) {
				await plugin("BeldoraPrint").printHtml({html: snapshot(frame), name: title});
			} else {
				w.focus();
				w.print(); // returns when the print dialog closes
			}
		} finally {
			document.title = prevTitle;
		}
	};

	/** Encounter sheet: a single document, no booklet to lay out first. */
	const exportEncounter = async ({title, encounter}) => {
		const name = `${(title || "Encounter").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Encounter"} - Encounter`;
		const notice = window.TBUI && TBUI.toast(isAndroid ? "Preparing… choose “Save as PDF” in the print screen." : "Preparing… in the print dialog choose “Save as PDF”.", {timeout: 6000});
		const lay = await layoutInFrame("encounter", encounter);
		try {
			if (lay.result.error) throw new Error(lay.result.error);
			await printFrame(lay.frame, name);
		} finally {
			lay.frame.remove();
			if (notice) notice.remove();
		}
		return {saved: [`${name}.pdf`], printed: true};
	};

	const exportPdf = async ({kind, title, book, cheat, sheet, cards, options, encounter}) => {
		try {
			if (kind === "encounter") return await exportEncounter({title, encounter});
			const safe = (title || "Beldora CB").replace(/[\\/:*?"<>|]+/g, "_").trim() || "Beldora CB";
			const parts = kind === "all" ? ["sheet", "cards", "book", "cheat"].filter(k => (k !== "cheat" || cheat) && (k !== "sheet" || sheet) && (k !== "cards" || cards))
				: kind === "both" ? ["book", "cheat"] : [kind];
			const notice = window.TBUI && TBUI.toast(isAndroid ? "Preparing… choose “Save as PDF” in the print screen." : "Preparing… in the print dialog choose “Save as PDF”.", {timeout: 6000});
			// The booklet is laid out first so every other document can point at its pages
			const bookLay = await layoutInFrame("book", {book, options});
			const pageMap = bookLay.result.pageMap || {};
			const saved = [];
			for (const k of parts) {
				const name = `${safe}${k === "book" ? "" : ` - ${PAGES[k].label}`}`;
				let lay = bookLay;
				if (k === "cheat") lay = await layoutInFrame("cheat", {cheat, pageMap, bookTitle: book.title, options});
				if (k === "sheet") lay = await layoutInFrame("sheet", {sheet, pageMap, options});
				if (k === "cards") lay = await layoutInFrame("cards", {...cards, pageMap, options});
				await printFrame(lay.frame, name);
				if (lay !== bookLay) lay.frame.remove();
				saved.push(`${name}.pdf`);
			}
			bookLay.frame.remove();
			if (notice) notice.remove();
			return {saved, pages: bookLay.result.pageCount, printed: true};
		} catch (e) {
			console.error(e);
			return {error: e.message || String(e)};
		}
	};
	// endregion

	window.tbNative = {
		isWeb: true,
		platform,
		readStore: async () => {
			try { return await db().getItem(STORE_KEY); } catch (e) { return null; }
		},
		writeStore: async (data) => { await db().setItem(STORE_KEY, data); return true; },
		exportFile: async (defaultName, data) => {
			const text = JSON.stringify(data, null, "\t");
			if (isAndroid) return shareFile(defaultName, text);
			download(defaultName, new Blob([text], {type: "application/json"}));
			return defaultName;
		},
		importFile: async () => {
			const data = await pickFile(".json,application/json");
			if (data && data.__error) { window.TBUI && TBUI.toast(data.__error, {error: true}); return null; }
			return data;
		},
		exportPdf,
		openPath: async () => false,
		showItem: async () => false,
	};
})();
