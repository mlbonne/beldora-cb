"use strict";

/** Wiki browser: the 5etools site in a frame, with clipping tools around it. */
globalThis.TBViewWiki = (() => {
	const {h, clear} = TBUI;
	let frame = null;
	let titleEl = null;
	let tray = null;
	let trayList = null;
	let targetSel = null;
	let clipBtn = null;
	let chapterSel = null;

	const LINKS = [
		["Classes", "classes.html"],
		["Species", "races.html"],
		["Backgrounds", "backgrounds.html"],
		["Feats", "feats.html"],
		["Options", "optionalfeatures.html"],
		["Spells", "spells.html"],
		["Items", "items.html"],
		["Rules", "variantrules.html"],
		["Conditions", "conditionsdiseases.html"],
		["Actions", "actions.html"],
		["Bestiary", "bestiary.html"],
		["Books", "books.html"],
	];

	const inject = () => {
		try {
			const doc = frame.contentDocument;
			if (!doc || !doc.body || doc.getElementById("tb-clip-script")) return;
			const s = doc.createElement("script");
			s.id = "tb-clip-script";
			s.src = new URL("__tb/js/clip.js", location.href).href;
			doc.head.appendChild(s);
		} catch (e) { console.warn("Could not prepare the wiki page for clipping", e); }
	};

	const updateTitle = () => {
		try {
			const t = frame.contentDocument.title.replace(/\s*-\s*5etools\s*$/i, "");
			titleEl.textContent = t;
			titleEl.title = frame.contentWindow.location.href;
		} catch (e) { /* cross-origin */ }
	};

	const init = (root) => {
		frame = h("iframe.wiki-frame", {src: "index.html"});
		frame.addEventListener("load", () => {
			inject();
			updateTitle();
			try { frame.contentWindow.addEventListener("hashchange", () => setTimeout(updateTitle, 300)); } catch (e) { /* ignore */ }
			// Some pages build their content after load
			setTimeout(updateTitle, 800);
		});
		titleEl = h("span.wiki-title");
		targetSel = h("select", {title: "Where clips go"});
		targetSel.addEventListener("change", () => { TBApp.setClipTarget(targetSel.value || null); });
		chapterSel = h("select.grow", {title: "Chapter that new clips go into"});
		chapterSel.addEventListener("change", async () => {
			const t = TBApp.clipTarget();
			if (!t) return;
			if (chapterSel.value === "__new") {
				const title = await TBUI.prompt("New chapter title", "New Chapter");
				if (!title) { refresh(); return; }
				const chap = {id: TBBook.uid(), title, items: []};
				// Character codexes keep the Annex last; standalone books just append
				const annexIx = t.book.chapters.findIndex(c => c.genKey === "annex");
				t.book.chapters.splice(annexIx >= 0 ? annexIx : t.book.chapters.length, 0, chap);
				TBApp.setClipChapter(t.book, chap.id);
			} else TBApp.setClipChapter(t.book, chapterSel.value);
		});
		clipBtn = h("button.btn", {title: "Clip mode (Alt+C): hover any paragraph, table, section or page, then click to add it", on: {click: () => TBApp.toggleClipMode()}}, "✂ Clip mode");
		const go = (url) => () => navigate(url);
		const back = h("button.btn.icon", {title: "Back", on: {click: () => { try { frame.contentWindow.history.back(); } catch (e) { /* ignore */ } }}}, "◀");
		const fwd = h("button.btn.icon", {title: "Forward", on: {click: () => { try { frame.contentWindow.history.forward(); } catch (e) { /* ignore */ } }}}, "▶");
		const home = h("button.btn.icon", {title: "Home", on: {click: go("index.html")}}, "⌂");

		trayList = h("div.tray-list");
		tray = h("div.wiki-tray",
			h("div.tray-head",
				h("h3", "Clipping to"),
				h("div.clip-target", targetSel),
				h("div.clip-target", {style: {marginTop: "6px"}}, h("span.muted", {style: {fontSize: "12px"}}, "Chapter"), chapterSel),
				h("div.row", {style: {marginTop: "8px", flexWrap: "wrap"}},
					h("button.btn.small", {on: {click: () => TBApp.newBookFromWiki()}}, "+ New book"),
					h("button.btn.small", {on: {click: () => TBApp.newCharacterFromWiki()}}, "+ New character"),
					h("button.btn.small", {on: {click: () => TBApp.openTargetBook()}}, "Open"),
				),
			),
			trayList,
			h("div.tray-help",
				h("div", h("b", "Clip mode"), " (", h("span.kbd", "Alt+C"), "): hover anything, press ", h("span.kbd", "↑"), "/", h("span.kbd", "↓"), " or Shift+wheel to widen or narrow, click to add."),
				h("div", {style: {marginTop: "6px"}}, h("b", "Clip page"), " adds the whole entry you are viewing; ", h("b", "Clip selection"), " adds highlighted text."),
			),
		);

		root.appendChild(h("div.wiki-bar",
			back, fwd, home,
			h("div.sep"),
			...LINKS.map(([l, u]) => h("button.btn.ghost.small", {on: {click: go(u)}}, l)),
			h("div.sep"),
			clipBtn,
			h("button.btn", {title: "Add the whole entry on screen", on: {click: () => {
				const ok = frame.contentWindow.__tbClip && frame.contentWindow.__tbClip.clipPage();
				if (!ok) TBUI.toast("This page has no single entry to clip. Use clip mode instead.", {error: true});
			}}}, "Clip page"),
			h("button.btn", {title: "Add the text you highlighted", on: {click: () => {
				const ok = frame.contentWindow.__tbClip && frame.contentWindow.__tbClip.clipSelection();
				if (!ok) TBUI.toast("Highlight some text in the page first.", {error: true});
			}}}, "Clip selection"),
			h("div.spacer"),
			titleEl,
			h("button.btn.ghost.small", {title: "Show or hide the clip tray", on: {click: () => tray.classList.toggle("hidden")}}, "☰"),
		));
		// Phones: the tray starts closed (☰ opens it)
		if (window.matchMedia && window.matchMedia("(max-width: 860px)").matches) tray.classList.add("hidden");
		root.appendChild(h("div.wiki-body", frame, tray));
		refresh();
	};

	const navigate = (url) => {
		if (!frame) return;
		frame.src = url;
	};

	const setClipMode = (on) => {
		clipBtn && clipBtn.classList.toggle("on", on);
		try { frame.contentWindow.__tbClip && frame.contentWindow.__tbClip.setMode(on); } catch (e) { /* ignore */ }
	};

	/** Re-render target and chapter selects and the tray list. */
	const refresh = () => {
		if (!targetSel) return;
		const st = TBStore.get();
		const cur = st.settings.clipTarget;
		const books = st.books.filter(b => !b.ownerCharId);
		clear(targetSel);
		targetSel.appendChild(h("option", {value: ""}, st.characters.length || books.length ? "— choose a book —" : "— create a book or character —"));
		if (books.length) targetSel.appendChild(h("optgroup", {label: "Books"}, ...books.map(b => h("option", {value: b.id, selected: b.id === cur}, b.title || "Untitled"))));
		if (st.characters.length) targetSel.appendChild(h("optgroup", {label: "Character codexes"}, ...st.characters.map(c => h("option", {value: c.id, selected: c.id === cur}, c.name || "Unnamed"))));

		const t = TBApp.clipTarget();
		clear(chapterSel);
		chapterSel.disabled = !t;
		clear(trayList);
		if (!t) {
			trayList.appendChild(h("div.muted", {style: {padding: "8px", fontSize: "13px"}}, "Choose or create a book above. Clips go into the chosen chapter; you can rearrange them later."));
			return;
		}
		const book = t.book;
		const target = TBApp.clipChapter(book);
		book.chapters.forEach(c => chapterSel.appendChild(h("option", {value: c.id, selected: target && c.id === target.id}, c.title)));
		if (!book.chapters.length) chapterSel.appendChild(h("option", {value: "", selected: true}, "Unsorted (created on first clip)"));
		chapterSel.appendChild(h("option", {value: "__new"}, "+ New chapter…"));

		const clips = [];
		book.chapters.forEach(c => c.items.forEach(i => { if (i.kind === "clip") clips.push({c, i}); }));
		if (!clips.length) trayList.appendChild(h("div.muted", {style: {padding: "8px", fontSize: "13px"}}, "No clips yet. Turn on clip mode and click something in the page."));
		clips.sort((a, b) => (b.i.addedAt || 0) - (a.i.addedAt || 0)).slice(0, 60).forEach(({c, i}) => trayList.appendChild(h("div.tray-item",
			h("div.row", h("span.t.grow", i.title), h("button.btn.ghost.small", {title: "Remove", on: {click: () => {
				c.items.splice(c.items.indexOf(i), 1);
				TBStore.changed("book");
				refresh();
			}}}, "✕")),
			h("div.s", `${i.src?.label || ""} · in “${c.title}”`),
		)));
	};

	return {init, navigate, setClipMode, refresh};
})();
