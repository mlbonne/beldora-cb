"use strict";

/** "Book" tab: arrange chapters and items, add notes, preview each piece. */
globalThis.TBViewBook = (() => {
	const {h, clear} = TBUI;
	const esc = (s) => TBBook.esc(s);
	const ui = {selId: null, collapsed: new Set(), drag: null};

	const textToHtml = (txt) => String(txt || "").split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
	const htmlToText = (html) => {
		const d = document.createElement("div");
		d.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n");
		return d.textContent;
	};

	// Mirrors the booklet's default: generated feature pages carry their own heading
	const defaultShowTitle = (item) => {
		if (item.kind === "gen") return /^(overview|class-core:|class-table:|class-mc:|spell-list)/.test(item.key || "");
		if (item.kind === "clip") return !["Whole page", "Stat block", "Popup", "Section", "Feature", "Sidebar"].includes(item.clipKind);
		return true;
	};

	const findItem = (book, id) => {
		for (const c of book.chapters) {
			const ix = c.items.findIndex(i => i.id === id);
			if (ix >= 0) return {chapter: c, ix, item: c.items[ix]};
		}
		return null;
	};

	/**
	 * @param root
	 * @param book
	 * @param [opts.char] owning character (enables "sync")
	 * @param [opts.onChange]
	 */
	const render = (root, book, opts = {}) => {
		const changed = () => { book.updatedAt = Date.now(); TBStore.changed("book"); opts.onChange && opts.onChange(); };
		const rerender = () => render(root, book, opts);
		const prevScroll = root.querySelector(".book-tree")?.scrollTop || 0;
		// On phones the whole book page scrolls instead of the tree
		const prevPageScroll = root.querySelector(".book")?.scrollTop || 0;
		clear(root);
		book.hidden = book.hidden || [];

		// region Tools + meta
		const tools = h("div.book-tools",
			opts.char ? h("button.btn", {title: "Regenerate the character's pages from the Build tab (keeps your arrangement, clips and notes)", on: {click: async () => { await TBApp.syncBook(opts.char, {toast: true}); rerender(); }}}, "⟳ Sync with character") : null,
			h("button.btn", {on: {click: async () => {
				const t = await TBUI.prompt("New chapter title", "New Chapter");
				if (!t) return;
				const annexIx = book.chapters.findIndex(c => c.genKey === "annex");
				book.chapters.splice(annexIx >= 0 ? annexIx : book.chapters.length, 0, {id: TBBook.uid(), title: t, items: []});
				changed(); rerender();
			}}}, "+ Chapter"),
			h("button.btn", {on: {click: () => {
				const sel = ui.selId && findItem(book, ui.selId);
				const chap = sel ? sel.chapter : (book.chapters.find(c => c.genKey === "annex") || book.chapters[book.chapters.length - 1]);
				if (!chap) return;
				const item = {id: TBBook.uid(), kind: "note", title: "Note", html: "<p></p>"};
				chap.items.splice(sel ? sel.ix + 1 : chap.items.length, 0, item);
				ui.selId = item.id;
				changed(); rerender();
			}}}, "+ Note"),
			h("div.spacer"),
			book.hidden.length ? h("button.btn.ghost.small", {title: "Generated pages you removed stay hidden from syncs. Restore them all.", on: {click: async () => {
				book.hidden = [];
				if (opts.char) await TBApp.syncBook(opts.char);
				changed(); rerender();
			}}}, `Restore ${book.hidden.length} hidden`) : null,
			h("button.btn.ghost.small", {on: {click: () => { book.chapters.forEach(c => ui.collapsed.add(c.id)); rerender(); }}}, "Collapse all"),
			h("button.btn.ghost.small", {on: {click: () => { ui.collapsed.clear(); rerender(); }}}, "Expand all"),
		);
		const metaIn = (k, label, ph) => {
			const i = h("input", {type: "text", value: book[k] || "", placeholder: ph});
			i.addEventListener("input", () => { book[k] = i.value; if (k === "subtitle") book.subtitleEdited = !!i.value; changed(); });
			return h("label.field", {style: {marginBottom: 0}}, h("span", label), i);
		};
		const meta = h("div.book-meta",
			metaIn("title", "Book title", "Title on the cover"),
			metaIn("subtitle", "Subtitle", opts.char ? "Auto: species and classes" : ""),
			metaIn("kicker", "Cover kicker", opts.char ? "Player's Codex" : "Dungeon Master's Codex"),
			metaIn("byline", "Byline", opts.char ? "Auto: player name" : ""),
		);
		// endregion

		// region Tree
		const tree = h("div.book-tree");
		const dropLine = h("div.drop-line");
		const clearDrop = () => { dropLine.remove(); tree.querySelectorAll(".drag-over").forEach(e => e.classList.remove("drag-over")); };

		book.chapters.forEach((chap, cIx) => {
			const isCollapsed = ui.collapsed.has(chap.id);
			const itemsBox = h("div.ch-items");
			const chEl = h("div.ch", {class: isCollapsed ? "collapsed" : "", dataset: {cid: chap.id}});
			const head = h("div.ch-h", {draggable: true},
				h("span.caret", {on: {click: () => { isCollapsed ? ui.collapsed.delete(chap.id) : ui.collapsed.add(chap.id); rerender(); }}}, isCollapsed ? "▸" : "▾"),
				h("span.nm", {title: chap.title}, chap.title),
				h("span.cnt", String(chap.items.length)),
				h("button.btn.ghost.small.icon", {title: "Rename chapter", on: {click: async (e) => {
					e.stopPropagation();
					const t = await TBUI.prompt("Rename chapter", chap.title);
					if (!t) return;
					chap.title = t; chap.titleEdited = true; changed(); rerender();
				}}}, "✎"),
				h("button.btn.ghost.small.icon", {title: "Move up", on: {click: () => { if (cIx > 0) { book.chapters.splice(cIx - 1, 0, book.chapters.splice(cIx, 1)[0]); changed(); rerender(); } }}}, "↑"),
				h("button.btn.ghost.small.icon", {title: "Move down", on: {click: () => { if (cIx < book.chapters.length - 1) { book.chapters.splice(cIx + 1, 0, book.chapters.splice(cIx, 1)[0]); changed(); rerender(); } }}}, "↓"),
				chap.genKey === "annex" ? null : h("button.btn.ghost.small.icon", {title: "Delete chapter", on: {click: async () => {
					const own = chap.items.filter(i => i.kind !== "gen").length;
					const ok = await TBUI.confirm("Delete chapter", `Delete “${chap.title}”${own ? ` and its ${own} clip/note item${own === 1 ? "" : "s"}` : ""}?${chap.genKey ? " Generated pages in it stay hidden until you restore them." : ""}`, {okLabel: "Delete", danger: true});
					if (!ok) return;
					chap.items.filter(i => i.kind === "gen").forEach(i => book.hidden.push(i.key));
					if (chap.genKey) book.hidden.push(`ch:${chap.genKey}`);
					book.chapters.splice(cIx, 1);
					changed(); rerender();
				}}}, "🗑"),
			);
			// Chapter drag
			head.addEventListener("dragstart", (e) => { ui.drag = {type: "chapter", id: chap.id}; e.dataTransfer.effectAllowed = "move"; chEl.classList.add("dragging"); });
			head.addEventListener("dragend", () => { chEl.classList.remove("dragging"); clearDrop(); ui.drag = null; });
			chEl.addEventListener("dragover", (e) => {
				if (!ui.drag) return;
				if (ui.drag.type === "chapter") {
					e.preventDefault();
					const r = chEl.getBoundingClientRect();
					const before = e.clientY < r.top + r.height / 2;
					clearDrop();
					chEl.parentNode.insertBefore(dropLine, before ? chEl : chEl.nextSibling);
					ui.drag.target = {cid: chap.id, before};
				} else if (ui.drag.type === "item" && (e.target === chEl || e.target === head || head.contains(e.target) || (e.target === itemsBox && !chap.items.length))) {
					e.preventDefault();
					clearDrop();
					chEl.classList.add("drag-over");
					ui.drag.target = {cid: chap.id, ix: chap.items.length};
				}
			});
			chEl.addEventListener("drop", (e) => {
				if (!ui.drag || !ui.drag.target) return;
				e.preventDefault();
				applyDrop();
			});

			chap.items.forEach((item, iIx) => {
				const row = h("div.it", {class: item.id === ui.selId ? "sel" : "", draggable: true, dataset: {iid: item.id}},
					h("span.kind", {class: item.kind}, item.kind === "gen" ? "auto" : item.kind),
					h("span.nm", {title: item.title}, item.title || "(untitled)"),
					h("span.acts",
						h("button.btn.ghost.small.icon", {title: "Rename", on: {click: async (e) => {
							e.stopPropagation();
							const t = await TBUI.prompt("Rename item", item.title);
							if (t == null) return;
							item.title = t; item.titleEdited = true; changed(); rerender();
						}}}, "✎"),
						h("button.btn.ghost.small.icon", {title: item.showTitle === false ? "Show heading in the book" : "Hide heading in the book", on: {click: (e) => {
							e.stopPropagation();
							item.showTitle = !(item.showTitle ?? defaultShowTitle(item));
							changed(); rerender();
						}}}, "H"),
						h("button.btn.ghost.small.icon", {title: "Remove from book", on: {click: (e) => {
							e.stopPropagation();
							if (item.kind === "gen") book.hidden.push(item.key);
							chap.items.splice(iIx, 1);
							if (ui.selId === item.id) ui.selId = null;
							changed(); rerender();
							if (item.kind !== "gen") TBUI.toast(`Removed “${item.title}”`, {action: {label: "Undo", fn: () => { chap.items.splice(iIx, 0, item); changed(); rerender(); }}});
						}}}, "✕"),
					),
				);
				row.addEventListener("click", () => { ui.selId = item.id; rerender(); });
				row.addEventListener("dragstart", (e) => { e.stopPropagation(); ui.drag = {type: "item", id: item.id}; e.dataTransfer.effectAllowed = "move"; row.classList.add("dragging"); });
				row.addEventListener("dragend", () => { row.classList.remove("dragging"); clearDrop(); ui.drag = null; });
				row.addEventListener("dragover", (e) => {
					if (!ui.drag || ui.drag.type !== "item") return;
					e.preventDefault();
					e.stopPropagation();
					const r = row.getBoundingClientRect();
					const before = e.clientY < r.top + r.height / 2;
					clearDrop();
					itemsBox.insertBefore(dropLine, before ? row : row.nextSibling);
					ui.drag.target = {cid: chap.id, ix: before ? iIx : iIx + 1};
				});
				row.addEventListener("drop", (e) => { if (ui.drag && ui.drag.target) { e.preventDefault(); e.stopPropagation(); applyDrop(); } });
				itemsBox.appendChild(row);
			});
			if (!chap.items.length) itemsBox.appendChild(h("div.muted", {style: {fontSize: "12.5px", padding: "4px 6px"}}, chap.genKey === "annex" ? "Clips from the wiki land here." : "Empty — drag items here."));
			chEl.appendChild(head);
			chEl.appendChild(itemsBox);
			tree.appendChild(chEl);
		});

		const applyDrop = () => {
			const d = ui.drag;
			clearDrop();
			if (!d || !d.target) return;
			if (d.type === "chapter") {
				const from = book.chapters.findIndex(c => c.id === d.id);
				const [c] = book.chapters.splice(from, 1);
				let to = book.chapters.findIndex(x => x.id === d.target.cid);
				if (to < 0) to = book.chapters.length;
				book.chapters.splice(d.target.before ? to : to + 1, 0, c);
			} else {
				const src = findItem(book, d.id);
				const dest = book.chapters.find(c => c.id === d.target.cid);
				if (!src || !dest) return;
				let ix = d.target.ix;
				src.chapter.items.splice(src.ix, 1);
				if (src.chapter === dest && src.ix < ix) ix--;
				dest.items.splice(ix, 0, src.item);
			}
			ui.drag = null;
			changed(); rerender();
		};
		// endregion

		// region Preview / note editor
		const sel = ui.selId && findItem(book, ui.selId);
		const frame = TBUI.fragFrame();
		const right = h("div.book-preview",
			h("div.book-preview-h",
				h("span.t.grow", sel ? sel.item.title : "Preview"),
				sel && sel.item.src && sel.item.src.url ? h("button.btn.small", {on: {click: () => TBApp.openWiki(sel.item.src.url)}}, "Open source page") : null,
				sel ? h("select", {title: "Move to chapter", on: {change: (e) => {
					const dest = book.chapters.find(c => c.id === e.target.value);
					if (!dest || dest === sel.chapter) return;
					sel.chapter.items.splice(sel.ix, 1);
					dest.items.push(sel.item);
					changed(); rerender();
				}}}, ...book.chapters.map(c => h("option", {value: c.id, selected: c === sel.chapter}, `Chapter: ${c.title}`))) : null,
			),
		);
		if (sel && sel.item.kind === "note") {
			const titleIn = h("input", {type: "text", value: sel.item.title});
			const ta = h("textarea");
			ta.value = htmlToText(sel.item.html);
			const upd = TBUI.debounce(() => { frame.setContent(sel.item.html); }, 200);
			titleIn.addEventListener("input", () => { sel.item.title = titleIn.value; changed(); });
			titleIn.addEventListener("change", rerender);
			ta.addEventListener("input", () => { sel.item.html = textToHtml(ta.value); changed(); upd(); });
			right.appendChild(h("div.note-editor", h("label.field", {style: {margin: 0}}, h("span", "Note title"), titleIn), h("label.field", {style: {margin: 0}}, h("span", "Text (blank line = new paragraph)"), ta)));
		}
		right.appendChild(frame);
		frame.setContent(sel ? (sel.item.kind === "note" ? `<div class="tb-note">${sel.item.html}</div>` : sel.item.html) : `<div class="tb-empty">Select an item to preview it.<br><br>Drag items and chapters to reorder them. “auto” items come from the Build tab, “clip” items from the wiki.</div>`);
		// endregion

		root.appendChild(h("div.book",
			h("div.book-outline", tools, meta, tree),
			right,
		));
		tree.scrollTop = prevScroll;
		const page = root.querySelector(".book");
		if (page) page.scrollTop = prevPageScroll;
	};

	return {render, ui};
})();
