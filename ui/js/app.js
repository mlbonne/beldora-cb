"use strict";

globalThis.TBApp = (() => {
	const {h, clear} = TBUI;
	const S = {view: "wiki", activeCharId: null, charTab: "hero", activeBookId: null, bookTab: "book", clipMode: false};
	const syncTimers = new Map();

	// region Characters & books
	const newCharacter = (name = "New Character") => ({
		id: TBBook.uid(),
		name,
		player: "",
		species: null,
		background: null,
		classes: [],
		feats: [],
		optfeatures: [],
		spells: [],
		notes: "",
		portrait: null,
		settings: {},
		createdAt: Date.now(),
	});

	const ensureBook = (char) => {
		let book = TBStore.bookOf(char.id);
		if (!book) {
			book = {id: TBBook.uid(), ownerCharId: char.id, title: "", subtitle: "", kicker: "Player's Codex", byline: "", chapters: [], hidden: [], createdAt: Date.now()};
			TBStore.get().books.push(book);
		}
		return book;
	};

	const syncBook = async (char, {toast = false} = {}) => {
		const book = ensureBook(char);
		try {
			await TBBook.syncBook(book, char);
			TBStore.changed("book");
			if (toast) TBUI.toast("Book synced with the character.");
		} catch (e) {
			console.error(e);
			TBUI.toast(`Could not build the book: ${e.message}`, {error: true});
		}
		return book;
	};

	const scheduleSync = (char) => {
		clearTimeout(syncTimers.get(char.id));
		syncTimers.set(char.id, setTimeout(() => syncBook(char), 700));
	};

	const createCharacter = async ({open = true} = {}) => {
		const char = newCharacter();
		TBStore.get().characters.push(char);
		ensureBook(char);
		await syncBook(char);
		if (!TBStore.get().settings.clipTarget) TBStore.get().settings.clipTarget = char.id;
		TBStore.changed("char");
		if (open) {
			S.activeCharId = char.id;
			S.charTab = "builder";
			TBViewBuilder.goTo("start");
			setView("characters");
		}
		return char;
	};

	const deleteCharacter = async (char) => {
		const ok = await TBUI.confirm("Delete character", `Delete “${char.name || "Unnamed"}” and their book? This cannot be undone.`, {okLabel: "Delete", danger: true});
		if (!ok) return;
		const st = TBStore.get();
		st.characters = st.characters.filter(c => c.id !== char.id);
		st.books = st.books.filter(b => b.ownerCharId !== char.id && b.notesOf !== char.id);
		const tgt = st.settings.clipTarget;
		if (tgt && !st.characters.some(c => c.id === tgt) && !st.books.some(b => b.id === tgt)) st.settings.clipTarget = null;
		if (S.activeCharId === char.id) S.activeCharId = st.characters[0]?.id || null;
		TBStore.changed("char");
		renderCharacters();
	};

	const duplicateCharacter = (char) => {
		const st = TBStore.get();
		const copy = JSON.parse(JSON.stringify(char));
		copy.id = TBBook.uid();
		copy.name = `${char.name || "Unnamed"} (copy)`;
		st.characters.push(copy);
		const book = TBStore.bookOf(char.id);
		if (book) {
			const b = JSON.parse(JSON.stringify(book));
			b.id = TBBook.uid();
			b.ownerCharId = copy.id;
			st.books.push(b);
		}
		S.activeCharId = copy.id;
		TBStore.changed("char");
		renderCharacters();
	};

	const exportCharacter = async (char) => {
		const data = {beldora: 1, character: char, book: TBStore.bookOf(char.id) || null};
		const name = `${(char.name || "character").replace(/[\\/:*?"<>|]+/g, "_")}.beldora.json`;
		if (window.tbNative) {
			const p = await window.tbNative.exportFile(name, data);
			if (p) TBUI.toast(`Saved ${p}`);
		} else {
			const a = h("a", {href: URL.createObjectURL(new Blob([JSON.stringify(data, null, "\t")], {type: "application/json"})), download: name});
			a.click();
		}
	};

	const importCharacter = async () => {
		let data = null;
		if (window.tbNative) data = await window.tbNative.importFile();
		if (!data) return;
		if (!data.character && data.book) return importBookData(data);
		return importCharacterData(data);
	};

	const importBookData = (data) => {
		const book = data.book;
		book.id = TBBook.uid();
		book.ownerCharId = null;
		TBStore.get().books.push(book);
		S.activeBookId = book.id;
		TBStore.changed("book");
		setView("books");
		TBUI.toast(`Imported ${book.title || "book"}.`);
	};

	const importCharacterData = async (data) => {
		if (!data.character) { TBUI.toast("That file is not a Beldora CB character.", {error: true}); return; }
		const st = TBStore.get();
		const char = data.character;
		char.id = TBBook.uid();
		st.characters.push(char);
		if (data.book) {
			data.book.id = TBBook.uid();
			data.book.ownerCharId = char.id;
			st.books.push(data.book);
		}
		await syncBook(char);
		S.activeCharId = char.id;
		TBStore.changed("char");
		renderCharacters();
		TBUI.toast(`Imported ${char.name || "character"}.`);
	};

	const charChanged = (char) => {
		char.updatedAt = Date.now();
		TBStore.changed("char");
		scheduleSync(char);
		renderSideList();
	};
	// endregion

	// region Clipping
	/** Clip target: a character (its codex) or a standalone book. Returns {char, book, name} or null. */
	const clipTarget = () => {
		const id = TBStore.get().settings.clipTarget;
		if (!id) return null;
		const char = TBStore.char(id);
		if (char) return {char, book: ensureBook(char), name: `${char.name || "Unnamed"}'s codex`};
		const book = TBStore.book(id);
		if (book && !book.ownerCharId) return {char: null, book, name: book.title || "Untitled book"};
		return null;
	};

	const setClipTarget = (id) => {
		TBStore.get().settings.clipTarget = id;
		TBStore.changed("settings");
		TBViewWiki.refresh();
	};

	/** Chapter clips land in: the one picked in the tray, else the Annex (characters) or the last chapter (books). */
	const clipChapter = (book, {create = false} = {}) => {
		let chap = book.chapters.find(c => c.id === book.clipChapterId);
		if (!chap) chap = book.ownerCharId ? book.chapters.find(c => c.genKey === "annex") : book.chapters[book.chapters.length - 1];
		if (!chap && create) {
			chap = book.ownerCharId ? {id: TBBook.uid(), genKey: "annex", title: "Annex", items: []} : {id: TBBook.uid(), title: "Unsorted", items: []};
			book.chapters.push(chap);
		}
		return chap;
	};

	const setClipChapter = (book, chapterId) => {
		book.clipChapterId = chapterId;
		TBStore.changed("book");
		TBViewWiki.refresh();
	};

	const clipTargetLabel = () => {
		const t = clipTarget();
		if (!t) return "choose a book first";
		const chap = clipChapter(t.book);
		return `${t.name}${chap ? ` › ${chap.title}` : ""}`;
	};

	const addClip = (clip) => {
		let t = clipTarget();
		const st = TBStore.get();
		const standalone = st.books.filter(b => !b.ownerCharId);
		if (!t && st.characters.length + standalone.length === 1) {
			setClipTarget((st.characters[0] || standalone[0]).id);
			t = clipTarget();
		}
		if (!t) {
			TBUI.toast("Choose the book to clip into (right-hand tray), or create one.", {error: true});
			return;
		}
		const chap = clipChapter(t.book, {create: true});
		const item = {
			id: TBBook.uid(),
			kind: "clip",
			title: clip.title || clip.kind || "Clip",
			html: TBSan.clean(clip.html),
			src: {url: clip.url, label: clip.pageTitle ? `${clip.pageTitle}` : ""},
			clipKind: clip.kind,
			addedAt: Date.now(),
		};
		chap.items.push(item);
		t.book.updatedAt = Date.now();
		TBStore.changed("book");
		TBViewWiki.refresh();
		TBUI.toast(`Added “${item.title}” to ${t.name} › ${chap.title}`, {
			action: {label: "Undo", fn: () => {
				const ix = chap.items.indexOf(item);
				if (ix >= 0) chap.items.splice(ix, 1);
				TBStore.changed("book");
				TBViewWiki.refresh();
			}},
		});
	};

	const toggleClipMode = (force) => {
		S.clipMode = typeof force === "boolean" ? force : !S.clipMode;
		TBViewWiki.setClipMode(S.clipMode);
		const st = TBStore.get();
		if (S.clipMode && !clipTarget() && st.characters.length + st.books.filter(b => !b.ownerCharId).length !== 1) TBUI.toast("Clip mode on. Pick a book in the tray so clips have somewhere to go.");
	};
	// endregion

	// region Standalone books (DM)
	const newBook = (title = "New Book") => ({
		id: TBBook.uid(),
		ownerCharId: null,
		title,
		subtitle: "",
		kicker: "Dungeon Master's Codex",
		byline: "",
		chapters: [{id: TBBook.uid(), title: "Unsorted", items: []}],
		hidden: [],
		createdAt: Date.now(),
	});

	const createBook = async ({open = true, ask = true} = {}) => {
		const title = ask ? await TBUI.prompt("Book title", "New Book") : "New Book";
		if (title == null) return null;
		const book = newBook(title || "New Book");
		TBStore.get().books.push(book);
		if (!clipTarget()) TBStore.get().settings.clipTarget = book.id;
		TBStore.changed("book");
		if (open) {
			S.activeBookId = book.id;
			S.bookTab = "book";
			setView("books");
		}
		return book;
	};

	const deleteBook = async (book) => {
		const n = book.chapters.reduce((a, c) => a + c.items.length, 0);
		const ok = await TBUI.confirm("Delete book", `Delete “${book.title || "Untitled"}” and its ${n} item${n === 1 ? "" : "s"}? This cannot be undone.`, {okLabel: "Delete", danger: true});
		if (!ok) return;
		const st = TBStore.get();
		st.books = st.books.filter(b => b !== book);
		if (st.settings.clipTarget === book.id) st.settings.clipTarget = null;
		if (S.activeBookId === book.id) S.activeBookId = null;
		TBStore.changed("book");
		renderBooks();
	};

	const duplicateBook = (book) => {
		const copy = JSON.parse(JSON.stringify(book));
		copy.id = TBBook.uid();
		copy.title = `${book.title || "Untitled"} (copy)`;
		copy.chapters.forEach(c => { c.id = TBBook.uid(); c.items.forEach(i => { i.id = TBBook.uid(); }); });
		delete copy.clipChapterId;
		TBStore.get().books.push(copy);
		S.activeBookId = copy.id;
		TBStore.changed("book");
		renderBooks();
	};

	const exportBookFile = async (book) => {
		const data = {beldora: 1, book};
		const name = `${(book.title || "book").replace(/[\\/:*?"<>|]+/g, "_")}.beldora.json`;
		if (window.tbNative) {
			const p = await window.tbNative.exportFile(name, data);
			if (p) TBUI.toast(`Saved ${p}`);
		} else {
			h("a", {href: URL.createObjectURL(new Blob([JSON.stringify(data, null, "\t")], {type: "application/json"})), download: name}).click();
		}
	};

	const openBookTab = (tab) => {
		S.bookTab = tab;
		renderBooks();
	};

	let bookListEl = null;
	const renderBookList = () => {
		if (!bookListEl) return;
		clear(bookListEl);
		const books = TBStore.get().books.filter(b => !b.ownerCharId);
		books.forEach(b => {
			const n = b.chapters.reduce((a, c) => a + c.items.length, 0);
			bookListEl.appendChild(h("div.char-card", {class: b.id === S.activeBookId ? "active" : "", on: {click: () => { S.activeBookId = b.id; renderBooks(); }}},
				h("div.n", b.title || "Untitled"),
				h("div.s", `${b.chapters.length} chapter${b.chapters.length === 1 ? "" : "s"} · ${n} item${n === 1 ? "" : "s"}`),
			));
		});
		if (!books.length) bookListEl.appendChild(h("div.muted", {style: {padding: "10px", fontSize: "13px"}}, "No books yet."));
	};

	const renderBooks = () => {
		const root = document.getElementById("view-books");
		clear(root);
		const books = TBStore.get().books.filter(b => !b.ownerCharId);
		if (!S.activeBookId || !books.some(b => b.id === S.activeBookId)) S.activeBookId = books[0]?.id || null;

		bookListEl = h("div.char-list");
		root.appendChild(h("div.char-side",
			h("div.char-side-head",
				h("button.btn.primary", {on: {click: () => createBook()}}, "+ New book"),
				h("button.btn", {title: "Import a book or character file", on: {click: importCharacter}}, "Import"),
			),
			bookListEl,
		));
		renderBookList();

		const book = TBStore.book(S.activeBookId);
		if (!book) {
			root.appendChild(h("div.char-main", h("div.empty",
				h("h2", "Bind your own book"),
				h("p", "Collect anything from the wiki (stat blocks, tables, rules, adventure sections) into chapters you arrange yourself."),
				h("p", "Export it as an elegant PDF for consulting at the table."),
				h("button.btn.primary", {on: {click: () => createBook()}}, "+ New book"),
			)));
			return;
		}
		const body = h("div.char-body");
		const titleEl = h("span.ttl", book.title || "Untitled");
		const tabBtn = (id, label) => h("button", {class: S.bookTab === id ? "active" : "", on: {click: () => openBookTab(id)}}, label);
		root.appendChild(h("div.char-main",
			h("div.char-tabs",
				titleEl,
				tabBtn("book", "Book"),
				tabBtn("export", "Export"),
				h("div.spacer"),
				h("button.btn.ghost.small", {on: {click: () => { setClipTarget(book.id); setView("wiki"); }}}, "Clip from wiki"),
				h("button.btn.ghost.small", {on: {click: () => duplicateBook(book)}}, "Duplicate"),
				h("button.btn.ghost.small", {on: {click: () => exportBookFile(book)}}, "Save file"),
				h("button.btn.ghost.small.danger", {on: {click: () => deleteBook(book)}}, "Delete"),
			),
			body,
		));
		if (S.bookTab === "export") TBViewExport.render(body, null, book);
		else {
			body.style.overflow = "hidden";
			TBViewBook.render(body, book, {onChange: () => { renderBookList(); titleEl.textContent = book.title || "Untitled"; }});
		}
	};
	// endregion

	// region Navigation
	const isMobile = () => !!(window.tbNative && window.tbNative.platform === "android");
	/** Phone layout: the Android app, the web version on a narrow screen, or "?phone" in the address (testing). */
	/**
	 * The phone layout: the Android app, `?phone`, or the web on a phone. Tablets (short side 600+ px, either
	 * orientation) get the full app; `?full` forces it. Very narrow windows still switch to the phone layout.
	 */
	const isPhone = () => {
		if (isMobile() || /[?&]phone\b/.test(location.search)) return true;
		if (!window.tbNative?.isWeb || /[?&]full\b/.test(location.search)) return false;
		const short = Math.min(window.screen?.width || 9999, window.screen?.height || 9999);
		return short < 600 || window.innerWidth < 520;
	};
	/** Bottom tab bar on phones: Build · Play · Store · More. */
	const buildBottomNav = () => {
		const nav = document.getElementById("tb-bnav");
		if (!nav) return;
		clear(nav);
		const tab = (view, icon, label) => h("button", {"data-view": view, on: {click: () => setView(view)}}, h("span.ic", icon), h("span.lb", label));
		const more = () => {
			const items = isMobile()
				? [["encounters", "⚔ Encounters"], ["updates", "⬆ App updates"], ["settings", "⚙ Settings"]]
				: [["wiki", "📖 Wiki"], ["books", "📚 Books"], ["encounters", "⚔ Encounters"], ["settings", "⚙ Settings"]];
			const m = TBUI.modal({
				title: "More",
				body: h("div", {style: {padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px"}}, ...items.map(([v, l]) => h("button.btn", {style: {justifyContent: "flex-start"}, on: {click: () => {
					m.close();
					if (v === "updates") TBUI.modal({title: "App updates", body: h("div.files", {style: {padding: "12px"}}, TBAppUpdate.card())});
					else if (v === "settings") openSettings();
					else setView(v);
				}}}, l))),
			});
		};
		nav.append(tab("characters", "🛡", "Build"), tab("play", "🎲", "Play"), tab("store", "🪙", "Store"),
			h("button", {"data-view": "more", on: {click: more}}, h("span.ic", "⋯"), h("span.lb", "More")));
		TBViewPlay.syncNav();
	};
	let phoneOn = null;
	const syncPhone = () => {
		const on = isPhone();
		if (on === phoneOn) return false;
		phoneOn = on;
		document.body.classList.toggle("tb-phone", on);
		if (on) buildBottomNav();
		return true;
	};

	const setView = (v) => {
		S.view = v;
		document.querySelectorAll("#tb-nav button, #tb-bnav button").forEach(b => b.classList.toggle("active", b.dataset.view === v || (v === "encounters" || v === "wiki" || v === "books" ? b.dataset.view === "more" && isPhone() : false)));
		document.querySelectorAll(".tb-view").forEach(el => el.classList.toggle("active", el.id === `view-${v}`));
		document.getElementById("tb-files-btn")?.classList.toggle("on", v === "files");
		if (v === "characters") renderCharacters();
		if (v === "books") renderBooks();
		if (v === "encounters") TBViewEncounters.render();
		if (v === "play") TBViewPlay.render();
		if (v === "store") TBViewStore.render();
		if (v === "files") TBViewFiles.render(document.getElementById("view-files"));
		if (v === "wiki") TBViewWiki.refresh();
	};

	const browseFor = (charId) => {
		setClipTarget(charId);
		setView("wiki");
	};

	const openWiki = (url) => {
		setView("wiki");
		TBViewWiki.navigate(url);
	};

	const openCharTab = (tab) => {
		S.charTab = tab;
		renderCharacters();
	};

	/** Show one book in the Books tab (session notes open from Play and the character page). */
	const openBook = (id) => {
		S.activeBookId = id;
		setView("books");
	};

	const openTargetBook = () => {
		const t = clipTarget();
		if (!t) { TBUI.toast("Choose a book first.", {error: true}); return; }
		if (t.char) {
			S.activeCharId = t.char.id;
			S.charTab = "book";
			setView("characters");
		} else {
			S.activeBookId = t.book.id;
			S.bookTab = "book";
			setView("books");
		}
	};

	const newCharacterFromWiki = async () => {
		const c = await createCharacter({open: false});
		setClipTarget(c.id);
		const name = await TBUI.prompt("Name your character", c.name);
		if (name) { c.name = name; TBStore.changed("char"); TBViewWiki.refresh(); }
	};

	const newBookFromWiki = async () => {
		const b = await createBook({open: false});
		if (b) setClipTarget(b.id);
	};
	// endregion

	// region Characters view
	const charSummary = (c) => [
		c.species ? c.species.name.replace(/;.*/, "") : null,
		(c.classes || []).map(x => `${x.name} ${x.level}`).join(" / ") || null,
	].filter(Boolean).join(" · ") || "Not built yet";

	let sideListEl = null;
	const renderSideList = () => {
		if (!sideListEl) return;
		clear(sideListEl);
		const st = TBStore.get();
		st.characters.forEach(c => sideListEl.appendChild(h("div.char-card", {class: c.id === S.activeCharId ? "active" : "", on: {click: () => { S.activeCharId = c.id; renderCharacters(); }}},
			h("div.n", c.name || "Unnamed"),
			h("div.s", charSummary(c)),
		)));
		if (!st.characters.length) sideListEl.appendChild(h("div.muted", {style: {padding: "10px", fontSize: "13px"}}, "No characters yet."));
	};

	let headerTitleEl = null;
	const renderCharHeader = () => {
		const c = TBStore.char(S.activeCharId);
		if (headerTitleEl && c) headerTitleEl.textContent = c.name || "Unnamed";
		renderSideList();
	};

	const renderCharacters = () => {
		const root = document.getElementById("view-characters");
		clear(root);
		const st = TBStore.get();
		if (!S.activeCharId || !TBStore.char(S.activeCharId)) S.activeCharId = st.characters[0]?.id || null;

		sideListEl = h("div.char-list");
		root.appendChild(h("div.char-side",
			h("div.char-side-head",
				h("button.btn.primary", {on: {click: () => createCharacter()}}, "+ New character"),
				h("button.btn", {title: "Import a character file", on: {click: importCharacter}}, "Import"),
			),
			sideListEl,
		));
		renderSideList();

		const char = TBStore.char(S.activeCharId);
		if (!char) {
			root.appendChild(h("div.char-main", h("div.empty",
				h("h2", "Build a character"),
				h("p", "Step through species, background, class, abilities, spells, equipment and details. Every choice the rules ask for is listed, level by level."),
				h("p", "Then download the filled character sheet, the cards, the booklet and the cheat sheet as PDFs."),
				h("button.btn.primary", {on: {click: () => createCharacter()}}, "+ New character"),
			)));
			return;
		}
		const book = ensureBook(char);
		headerTitleEl = h("span.ttl", char.name || "Unnamed");
		const tabBtn = (id, label) => h("button", {class: S.charTab === id ? "active" : "", on: {click: () => openCharTab(id)}}, label);
		const body = h("div.char-body");
		root.appendChild(h("div.char-main",
			h("div.char-tabs",
				headerTitleEl,
				tabBtn("hero", "Character"),
				tabBtn("builder", "Builder"),
				tabBtn("book", "Book"),
				tabBtn("export", "Export"),
				h("div.spacer"),
				isMobile() ? null : h("button.btn.ghost.small", {on: {click: () => browseFor(char.id)}}, "Clip from wiki"),
				h("button.btn.ghost.small", {on: {click: () => duplicateCharacter(char)}}, "Duplicate"),
				h("button.btn.ghost.small", {on: {click: () => exportCharacter(char)}}, "Save file"),
				h("button.btn.ghost.small.danger", {on: {click: () => deleteCharacter(char)}}, "Delete"),
			),
			body,
		));
		if (S.charTab === "build") S.charTab = "builder";
		if (S.charTab === "hero" && !(char.classes || []).length) S.charTab = "builder";
		if (S.charTab === "hero" || S.charTab === "builder") {
			body.style.overflow = "hidden";
			(S.charTab === "hero" ? TBViewHero : TBViewBuilder).render(body, char).catch(e => { console.error(e); body.appendChild(h("pre", {style: {color: "#f99", padding: "12px"}}, e.stack || String(e))); });
		} else if (S.charTab === "book") {
			body.style.overflow = "hidden";
			const pending = syncTimers.get(char.id);
			// Make sure the book reflects the latest build before arranging it
			if (pending) { clearTimeout(pending); syncTimers.delete(char.id); syncBook(char).then(() => TBViewBook.render(body, book, {char})); }
			else TBViewBook.render(body, book, {char});
		} else TBViewExport.render(body, char, book);
	};
	// endregion

	// region Settings: theme, and on desktop the 5etools folder and App Files
	const THEMES = [
		{id: "albion", name: "Albion", desc: "Dark brown and gold", sw: ["#16130f", "#27221b", "#c9a25e"]},
		{id: "alpino", name: "Alpino", desc: "Black with red details", sw: ["#0c0c0d", "#1c1c1e", "#c8372d"]},
	];
	const isDesktop = () => !!(window.tbNative && !window.tbNative.isWeb);
	const themeOf = () => THEMES.find(t => t.id === TBStore.get().settings.theme) || THEMES[0];
	const applyTheme = () => {
		const t = themeOf();
		if (t.id === "albion") delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = t.id;
		document.querySelectorAll("meta[name=theme-color]").forEach(m => m.setAttribute("content", t.sw[0]));
	};
	const setTheme = (id) => {
		TBStore.get().settings.theme = id;
		TBStore.changed("settings");
		applyTheme();
	};
	const siteFolder = async () => {
		const info = await window.tbNative.siteInfo();
		const m = TBUI.modal({
			title: "5etools folder",
			body: h("div", {style: {padding: "16px", width: "520px", lineHeight: "1.45"}},
				h("p", {style: {marginTop: 0}}, info.custom ? "Beldora CB reads the wiki from a folder you chose:" : info.usingUpdated ? "Beldora CB uses the copy of 5etools installed by the updater." : "Beldora CB uses its built-in copy of 5etools."),
				info.custom ? h("p", h("code", info.siteRoot)) : null,
				h("p.muted", "Artwork goes in the images folder (see App Files). You can also point Beldora CB at another 5etools folder."),
			),
			footer: [
				info.custom ? h("button.btn", {on: {click: () => { m.close(); window.tbNative.resetSite(); }}}, "Use the app's own copy") : null,
				h("button.btn", {on: {click: () => m.close()}}, "Close"),
				h("button.btn.primary", {on: {click: () => { m.close(); window.tbNative.changeSite(); }}}, "Choose folder…"),
			],
		});
	};
	const openSettings = () => {
		const themes = h("div.set-themes");
		const fillThemes = () => {
			clear(themes);
			THEMES.forEach(t => themes.appendChild(h("button.set-theme", {class: themeOf().id === t.id ? "on" : "", on: {click: () => { setTheme(t.id); fillThemes(); }}},
				h("span.set-sw", ...t.sw.map(c => h("i", {style: {background: c}}))),
				h("span.set-tn", h("b", t.name), h("small", t.desc)),
				themeOf().id === t.id ? h("span.set-on", "✓") : null,
			)));
		};
		fillThemes();
		const m = TBUI.modal({
			title: "Settings",
			body: h("div.set-body",
				h("div.set-h", "Theme"), themes,
				isDesktop() ? h("div.set-h", "App") : null,
				isDesktop() ? h("div.set-app",
					h("button.btn", {title: "Which 5etools folder Beldora CB reads", on: {click: () => { m.close(); siteFolder(); }}}, "⚙ Site folder…"),
					h("button.btn", {title: "Character saves, PDF exports, images and the 5etools updater", on: {click: () => { m.close(); setView("files"); }}}, "📁 App Files"),
				) : null,
			),
			footer: [h("button.btn", {on: {click: () => m.close()}}, "Close")],
		});
	};
	// endregion

	const init = async () => {
		await TBStore.load();
		applyTheme();
		document.querySelectorAll("#tb-nav button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
		if (isMobile()) {
			// Android: builder, Play, Store and encounters (no wiki or DM books)
			document.body.classList.add("tb-mobile");
			document.querySelectorAll("#tb-nav button").forEach(b => { if (!["characters", "encounters", "play", "store"].includes(b.dataset.view)) b.remove(); });
		} else TBViewWiki.init(document.getElementById("view-wiki"));
		syncPhone();
		if (isMobile() || isPhone()) setView("characters");
		// Crossing the phone width (web) switches layouts
		window.addEventListener("resize", TBUI.debounce(() => { if (syncPhone()) setView(S.view); }, 250));
		document.getElementById("tb-top-right").appendChild(h("button.btn.ghost.small", {id: "tb-files-btn", title: isDesktop() ? "Theme, 5etools folder and App Files" : "Theme", on: {click: openSettings}}, "⚙ Settings"));
		document.addEventListener("keydown", (e) => {
			if (e.altKey && (e.key === "c" || e.key === "C")) { e.preventDefault(); if (S.view === "wiki") toggleClipMode(); }
		});
		TBStore.on((what) => { if (what === "book" && S.view === "wiki") TBViewWiki.refresh(); });
		TBAppUpdate.startupCheck();
		// Android: the interface started, so the boot page's crash guard resets
		if (isMobile()) TBAndroidUpdate.started();
		// Warm the data caches in the background so pickers open instantly
		setTimeout(() => { TBData.loadClasses(); TBData.loadRaces(); TBData.loadFeats(); TBData.loadSpells(); }, 1200);
	};

	return {
		init, setView, createCharacter, charChanged, syncBook, renderCharHeader, renderCharacters,
		addClip, toggleClipMode, isClipMode: () => S.clipMode, clipTargetLabel, setClipTarget,
		browseFor, openWiki, openCharTab, openTargetBook, openBook, newCharacterFromWiki, state: S,
		clipTarget, clipChapter, setClipChapter, createBook, newBookFromWiki, renderBooks, isMobile, isPhone,
		openSettings, setTheme, THEMES,
	};
})();

window.addEventListener("load", () => {
	TBApp.init().catch(e => {
		console.error(e);
		document.body.innerHTML = `<pre style="color:#f88;padding:20px">Beldora CB failed to start:\n${e.stack || e}</pre>`;
	});
});
