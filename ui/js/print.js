"use strict";

/**
 * Booklet layout. Receives {book, options} and paginates it with Paged.js,
 * then reports the page every item landed on (used by the cheat sheet).
 */
(async () => {
	const params = new URLSearchParams(location.search);
	const jobId = params.get("job");
	const isPreview = params.has("preview");

	const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]));
	const hashKey = (s) => {
		let h = 2166136261;
		for (let i = 0; i < s.length; ++i) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
		return "k" + (h >>> 0).toString(36);
	};

	const fail = (e) => {
		console.error(e);
		if (jobId && window.tbNative) window.tbNative.printReady(jobId, {error: String(e && e.message || e)});
	};

	try {
		const payload = isPreview
			? (window.parent && window.parent.__tbPreviewPayload)
			: await window.tbNative.getPrintPayload(jobId);
		if (!payload) throw new Error("No book to print.");
		const {book, options = {}} = payload;

		const PAGE_SIZES = {
			"A5": {css: "148mm 210mm", margin: "11mm 10mm 12mm 10mm", base: 9.2},
			"half-letter": {css: "5.5in 8.5in", margin: "0.45in 0.4in 0.5in 0.4in", base: 9.2},
			"A4": {css: "210mm 297mm", margin: "13mm 15mm 14mm 15mm", base: 10},
			"letter": {css: "8.5in 11in", margin: "0.55in 0.6in 0.6in 0.6in", base: 10},
		};
		const size = PAGE_SIZES[options.pageSize] || PAGE_SIZES.A5;
		const scale = ({small: 0.92, normal: 1, large: 1.1})[options.fontScale] || 1;
		document.documentElement.style.setProperty("--tb-base", `${(size.base * scale).toFixed(2)}pt`);
		document.body.classList.add(`tb-theme-${options.theme || "parchment"}`);
		if (options.accent) document.documentElement.style.setProperty("--tb-accent", options.accent);

		// region Build content
		const chapters = (book.chapters || []).filter(c => c.items && c.items.length);
		const keyToId = new Map();
		chapters.forEach(c => c.items.forEach(i => {
			i._domId = "i" + i.id;
			if (i.key) keyToId.set(i.key, i._domId);
			keyToId.set("id:" + i.id, i._domId);
		}));

		Object.entries(book.aliases || {}).forEach(([alias, target]) => { if (keyToId.has(target)) keyToId.set(alias, keyToId.get(target)); });

		const SHOW_TITLE_GEN = /^(overview|class-core:|class-table:|class-mc:|spell-list)/;
		// Whole entries and named sections already open with their own heading
		const SELF_TITLED_CLIPS = new Set(["Whole page", "Stat block", "Popup", "Section", "Feature", "Sidebar"]);
		const defaultShowTitle = (i) => {
			if (i.kind === "gen") return SHOW_TITLE_GEN.test(i.key || "");
			if (i.kind === "clip") return !SELF_TITLED_CLIPS.has(i.clipKind);
			return true;
		};
		const itemHtml = (i) => {
			const showTitle = i.showTitle ?? defaultShowTitle(i);
			// The source is a small caption on the title line; clips that carry their own header skip both
			const src = showTitle && i.kind === "clip" && i.src && i.src.label && i.src.label !== i.title && options.showClipSources !== false ? `<span class="tb-clip-src">${esc(i.src.label)}</span>` : "";
			const body = i.kind === "note" ? `<div class="tb-note">${i.html || ""}</div>` : (i.html || "");
			return `<article class="tb-item tb-item--${i.kind}" id="${i._domId}" data-key="${esc(i.key || "id:" + i.id)}">
				${showTitle ? `<h2 class="tb-item-title">${esc(i.title)}${src}</h2>` : ""}
				<div class="tb-item-body">${body}</div>
			</article>`;
		};

		const cover = options.cover === false ? "" : `<section class="tb-cover">
			<div class="tb-cover-frame">
				<div class="tb-cover-kicker">${esc(book.kicker || "Player's Codex")}</div>
				<h1 class="tb-cover-title">${esc(book.title || "Untitled")}</h1>
				${book.subtitle ? `<div class="tb-cover-sub">${esc(book.subtitle)}</div>` : ""}
				<div class="tb-cover-orn">❦</div>
				${book.portrait ? `<div class="tb-cover-portrait"><img src="${book.portrait}" alt=""></div>` : ""}
				${book.byline ? `<div class="tb-cover-by">${esc(book.byline)}</div>` : ""}
			</div>
		</section>`;

		// Compact contents: one line per chapter, its items run inline with their page numbers
		const toc = options.toc === false ? "" : `<section class="tb-toc">
			<h1 class="tb-toc-title">Contents</h1>
			<ol class="tb-toc-list">
				${chapters.map(c => `<li class="tb-toc-ch"><a href="#ch${esc(c.id)}"><span class="tb-toc-name">${esc(c.title)}</span></a>
					${options.tocItems === false ? "" : `<div class="tb-toc-items">${c.items.filter(i => i.title).map(i => `<a href="#${i._domId}"><span class="tb-toc-name">${esc(i.title)}</span></a>`).join("<span class=\"tb-toc-sep\"> · </span>")}</div>`}
				</li>`).join("")}
			</ol>
		</section>`;

		document.body.classList.toggle("tb-flow", !(options.chapterBreak === "page" || options.chapterBreak === "right"));
		const body = chapters.map(c => `<section class="tb-chapter" id="ch${esc(c.id)}">
			<h1 class="tb-chapter-title">${esc(c.title)}</h1>
			${c.items.map(itemHtml).join("")}
		</section>`).join("");

		const tpl = document.createElement("template");
		tpl.innerHTML = cover + toc + body;
		const content = tpl.content;

		// Cross references: "#k:<key>" -> real ids; unresolved ones become plain text
		content.querySelectorAll("a.tb-xref, a.tb-pref").forEach(a => {
			const href = a.getAttribute("href") || "";
			const key = href.startsWith("#k:") ? href.slice(3) : null;
			const id = key ? keyToId.get(key) : null;
			if (id) a.setAttribute("href", "#" + id);
			else if (a.classList.contains("tb-pref")) a.remove();
			else {
				const s = document.createElement("span");
				s.className = a.className.replace("tb-xref", "tb-xref-dead");
				s.innerHTML = a.innerHTML;
				a.replaceWith(s);
			}
		});

		// Page numbers go only where a page is asked for: the contents and Page columns. Name links in tables
		// (spell list, class features) stay plain names; they still jump to their page in the PDF.
		const PAGE_REFS = ".tb-toc-list a[href^='#'], a.tb-pref[href^='#']";
		// Reserve room for the numbers so filling them in after layout does not reflow anything
		content.querySelectorAll(PAGE_REFS).forEach(a => {
			const num = document.createElement("span");
			num.className = "tb-pnum";
			num.textContent = "00";
			a.appendChild(num);
		});

		// Layout tables (5etools stat blocks) do not fragment well across pages; flatten them into flowing blocks.
		// Data tables (.ve-rd__table and our own tables) stay tables.
		const detable = (table) => {
			const wrap = document.createElement("div");
			wrap.className = table.className.replace(/\bve-w-100\b/, "") + " tb-detabled";
			const rows = [...table.rows];
			for (const tr of rows) {
				const cells = [...tr.cells];
				if (!cells.length || !tr.textContent.trim() && !tr.querySelector("img, table, hr, .ve-divider")) continue;
				const row = document.createElement("div");
				row.className = `tb-srow ${tr.className}`.trim();
				for (const td of cells) {
					const cell = document.createElement("div");
					cell.className = `tb-scell ${td.className}`.trim();
					if (td.tagName === "TH") cell.classList.add("tb-scell--th");
					cell.style.flex = `${Number(td.getAttribute("colspan")) || 1} 1 0`;
					while (td.firstChild) cell.appendChild(td.firstChild);
					row.appendChild(cell);
				}
				wrap.appendChild(row);
			}
			table.replaceWith(wrap);
		};
		const layoutTables = () => [...content.querySelectorAll("table.ve-stats, table.cls__stats")]
			.filter(t => !t.closest(".ve-rd__table"));
		// Outermost first so nested layout tables get handled on the next pass
		for (let guard = 0; guard < 6; ++guard) {
			const tables = layoutTables();
			if (!tables.length) break;
			tables.filter(t => !tables.some(o => o !== t && o.contains(t))).forEach(detable);
		}

		// Many-column tables shrink so they fit narrow pages
		content.querySelectorAll("table").forEach(t => {
			const cols = Math.max(0, ...[...t.rows].slice(0, 3).map(r => [...r.cells].reduce((a, c) => a + (Number(c.getAttribute("colspan")) || 1), 0)));
			if (cols >= 7) t.classList.add("tb-wide");
		});

		// Drop images that cannot load (the site ships without most artwork)
		await Promise.all([...content.querySelectorAll("img")].map(img => new Promise(resolve => {
			const probe = new Image();
			const t = setTimeout(() => { done(false); }, 4000);
			const done = (ok) => {
				clearTimeout(t);
				if (!ok) (img.closest(".ve-rd__wrp-image, .ve-rd__wrp-gallery-image, .tb-cover-portrait") || img).remove();
				resolve();
			};
			probe.onload = () => done(true);
			probe.onerror = () => done(false);
			probe.src = img.getAttribute("src");
		})));
		// endregion

		// region Page CSS (needs Paged.js processing)
		const pageCss = `
			@page {
				size: ${size.css};
				margin: ${size.margin};
				@top-center { content: string(chapter); }
				@bottom-center { content: counter(page); }
			}
			@page :blank { @top-center { content: none; } @bottom-center { content: none; } }
			@page cover { margin: 0; @top-center { content: none; } @bottom-center { content: none; } }
			@page toc { @top-center { content: "Contents"; } }
			@page chapter-first { @top-center { content: none; } }
			.tb-cover { page: cover; break-after: page; }
			${options.chapterBreak === "page" || options.chapterBreak === "right" ? ".tb-toc { page: toc; break-after: page; }" : ".tb-toc { margin-bottom: 1.2em; }"}
			${options.chapterBreak === "page" || options.chapterBreak === "right" ? `.tb-chapter { break-before: ${options.chapterBreak}; }` : ".tb-chapter + .tb-chapter { margin-top: 1.1em; }"}
			.tb-chapter-title { string-set: chapter content(text); }
		`;
		// endregion

		await document.fonts.ready;
		const previewer = new PagedModule.Previewer();
		const flow = await previewer.preview(content, [{[location.origin + "/__tb/css/page-dyn.css"]: pageCss}], document.body);

		// Page references are stamped after layout (Paged.js target-counter rules do not survive printToPDF)
		let stamped = 0;
		let refs = 0;
		document.querySelectorAll(PAGE_REFS.split(", ").map(sel => `.pagedjs_pages ${sel}`).join(", ")).forEach(a => {
			refs++;
			const target = document.getElementById(a.getAttribute("href").slice(1));
			const pg = target && target.closest(".pagedjs_page");
			// Real text, not ::after: the site's print stylesheet blanks link pseudo-content
			const num = a.querySelector(".tb-pnum");
			if (!num) return;
			if (!pg) { num.remove(); return; }
			num.textContent = pg.dataset.pageNumber;
			stamped++;
		});

		// Where did each item land?
		const pageMap = {};
		document.querySelectorAll(".pagedjs_page").forEach(pg => {
			const n = Number(pg.dataset.pageNumber) || 0;
			pg.querySelectorAll("[data-key]").forEach(el => {
				const k = el.dataset.key;
				if (k && pageMap[k] == null) pageMap[k] = n;
			});
		});
		Object.entries(book.aliases || {}).forEach(([alias, target]) => { if (pageMap[target] != null) pageMap[alias] = pageMap[target]; });
		const result = {pageMap, pageCount: flow.total, refs, stamped};
		window.__tbResult = result;
		if (jobId && window.tbNative) window.tbNative.printReady(jobId, result);
		if (isPreview) document.body.classList.add("tb-is-preview");
	} catch (e) {
		fail(e);
	}
})();
