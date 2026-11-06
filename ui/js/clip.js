"use strict";

/**
 * Injected into every wiki page. In clip mode, hovering highlights the piece under the cursor
 * (paragraph → section → table → whole page) and clicking sends it to Beldora CB.
 */
(() => {
	if (window.__tbClip) return;
	const app = window.parent && window.parent !== window ? window.parent : null;
	if (!app || !app.TBApp) return;

	const CANDIDATES = [
		"p", "li", "ul.ve-rd__list", "ol.ve-rd__list", "table", "tr",
		".ve-rd__b", ".ve-rd__b-inset", ".ve-rd__b-inset--readaloud", ".ve-rd__wrp-image",
		".ve-rd__wrp-centered-ability", "#pagecontent", ".hwin__wrp-table",
	].join(",");
	const CONTENT_ROOTS = "#pagecontent, .hwin, #wrp-pagecontent, .ve-rd__b";

	let mode = false;
	let chain = [];
	let level = 0;
	let lastTarget = null;

	// region Overlay
	const style = document.createElement("style");
	style.textContent = `
		.tb-clip-ui { font-family: "Segoe UI", sans-serif !important; }
		#tb-clip-box { position: fixed; z-index: 2147483646; pointer-events: none; border: 2px solid #c9a25e; background: rgba(201, 162, 94, 0.12); border-radius: 3px; box-shadow: 0 0 0 9999px rgba(20, 15, 10, 0.08); display: none; transition: all 60ms ease-out; }
		#tb-clip-label { position: fixed; z-index: 2147483647; pointer-events: none; background: #221c15; color: #f0e3c8; font-size: 12px; padding: 4px 8px; border-radius: 4px; border: 1px solid #c9a25e; display: none; max-width: 520px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 3px 12px rgba(0,0,0,.4); }
		#tb-clip-label b { color: #e2c48a; }
		#tb-clip-label span { color: #a8977d; }
		body.tb-clip-on, body.tb-clip-on * { cursor: copy !important; }
		.tb-clip-flash { animation: tb-clip-flash 0.6s ease-out; }
		@keyframes tb-clip-flash { 0% { background-color: rgba(201, 162, 94, 0.55); } 100% { background-color: transparent; } }
	`;
	document.head.appendChild(style);
	const box = document.createElement("div");
	box.id = "tb-clip-box";
	box.className = "tb-clip-ui";
	const label = document.createElement("div");
	label.id = "tb-clip-label";
	label.className = "tb-clip-ui";
	document.body.appendChild(box);
	document.body.appendChild(label);
	// endregion

	// region Describe candidates
	const textOf = (el) => (el ? el.textContent : "").replace(/\s+/g, " ").trim();
	const headingOf = (el) => {
		const hdr = el.querySelector(":scope > .ve-rd__h .entry-title-inner, :scope > .ve-rd__h, :scope > h1, :scope > h2, :scope > h3, :scope > h4");
		// Sourcebook headings end with a page tag such as "p21"
		return hdr ? textOf(hdr).replace(/\s*\[[−+]\]$/, "").replace(/\s*p\d+$/, "").replace(/[.:]$/, "").trim() : "";
	};
	const nearestSectionTitle = (el) => {
		let cur = el.parentElement;
		while (cur && cur !== document.body) {
			if (cur.matches(".ve-rd__b")) {
				const t = headingOf(cur);
				if (t) return t;
			}
			cur = cur.parentElement;
		}
		return "";
	};
	const pageTitle = () => {
		const nm = document.querySelector("#pagecontent .ve-stats__h-name, #pagecontent .stats-name");
		const t = document.title.replace(/\s*-\s*5etools\s*$/i, "").trim();
		return nm && textOf(nm) && !t.includes(textOf(nm)) ? `${t} — ${textOf(nm)}` : t;
	};

	const describe = (el) => {
		if (el.matches("#pagecontent")) return {kind: "Whole page", title: pageTitle()};
		if (el.closest(".hwin") && el.matches(".hwin__wrp-table")) {
			const nm = el.querySelector(".ve-stats__h-name");
			return {kind: "Popup", title: nm ? textOf(nm) : "Popup"};
		}
		if (el.matches("table.ve-stats")) {
			const nm = el.querySelector(".ve-stats__h-name");
			return {kind: "Stat block", title: nm ? textOf(nm) : pageTitle()};
		}
		if (el.matches("table")) {
			const cap = el.querySelector("caption");
			return {kind: "Table", title: cap ? textOf(cap) : (nearestSectionTitle(el) ? `${nearestSectionTitle(el)} (table)` : "Table")};
		}
		if (el.matches("tr")) {
			const hd = el.querySelector(".ve-rd__h .entry-title-inner, .ve-stats__sect-header-inner");
			const first = el.querySelector("th, td");
			return {kind: hd ? "Feature" : "Row", title: (hd ? textOf(hd) : textOf(first).slice(0, 60)) || "Row"};
		}
		if (el.matches(".ve-rd__b-inset, .ve-rd__b-inset--readaloud")) return {kind: "Sidebar", title: headingOf(el) || nearestSectionTitle(el) || "Sidebar"};
		if (el.matches(".ve-rd__b")) {
			const t = headingOf(el);
			return {kind: "Section", title: t || nearestSectionTitle(el) || pageTitle()};
		}
		if (el.matches("ul, ol")) return {kind: "List", title: nearestSectionTitle(el) || "List"};
		if (el.matches("li")) return {kind: "List item", title: textOf(el).slice(0, 60)};
		if (el.matches(".ve-rd__wrp-image")) return {kind: "Image", title: textOf(el) || "Image"};
		const sec = nearestSectionTitle(el) || pageTitle();
		return {kind: "Paragraph", title: sec ? `${sec} (excerpt)` : textOf(el).slice(0, 60)};
	};
	// endregion

	// region Chain building
	const visible = (el) => {
		const r = el.getBoundingClientRect();
		return r.width > 4 && r.height > 4;
	};
	const buildChain = (target) => {
		const out = [];
		let el = target && target.nodeType === 1 ? target : target?.parentElement;
		while (el && el !== document.body && el !== document.documentElement) {
			if (el.matches(CANDIDATES) && el.closest(CONTENT_ROOTS) && !el.closest(".tb-clip-ui") && visible(el)) {
				const skipRow = el.matches("tr") && !el.closest("table.ve-stats, .ve-rd__table");
				const rowInDataTable = el.matches("tr") && el.closest(".ve-rd__table");
				const layoutCell = el.matches("table") && el.closest("#pagecontent") === el;
				if (!skipRow && !rowInDataTable && !layoutCell) {
					const prev = out[out.length - 1];
					const r = el.getBoundingClientRect();
					const same = prev && (() => {
						const p = prev.getBoundingClientRect();
						return Math.abs(p.top - r.top) < 3 && Math.abs(p.bottom - r.bottom) < 3 && Math.abs(p.left - r.left) < 6 && Math.abs(p.right - r.right) < 6;
					})();
					if (same) out[out.length - 1] = el;
					else out.push(el);
				}
			}
			el = el.parentElement;
		}
		const pc = document.getElementById("pagecontent");
		if (pc && target && pc.contains(target) && !out.includes(pc)) out.push(pc);
		return out;
	};
	// endregion

	const show = () => {
		const el = chain[level];
		if (!mode || !el) { box.style.display = "none"; label.style.display = "none"; return; }
		const r = el.getBoundingClientRect();
		Object.assign(box.style, {display: "block", left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px`});
		const d = describe(el);
		const target = app.TBApp.clipTargetLabel();
		label.innerHTML = "";
		const b = document.createElement("b");
		b.textContent = `${d.kind}: `;
		label.appendChild(b);
		label.appendChild(document.createTextNode(d.title || ""));
		const hint = document.createElement("span");
		hint.textContent = `  ·  ${level + 1}/${chain.length} (↑↓ or Shift+wheel)  ·  click → ${target}`;
		label.appendChild(hint);
		label.style.display = "block";
		const top = r.top > 30 ? r.top - 28 : Math.min(window.innerHeight - 28, r.bottom + 6);
		label.style.top = `${top}px`;
		label.style.left = `${Math.max(4, Math.min(window.innerWidth - 530, r.left))}px`;
	};

	// region Capture
	const wrapFragment = (el, html) => {
		if (el.matches("tr")) {
			const t = el.closest("table");
			return `<table class="${t ? t.className : ""}"><tbody>${html}</tbody></table>`;
		}
		if (el.matches("li")) {
			const l = el.closest("ul, ol");
			const tag = l ? l.tagName.toLowerCase() : "ul";
			return `<${tag} class="${l ? l.className : ""}">${html}</${tag}>`;
		}
		return html;
	};

	const capture = (el) => {
		const clone = app.TBSan.cloneVisible(el, window);
		if (!clone) return null;
		// Absolute image URLs keep working when the clip is shown elsewhere in the app
		clone.querySelectorAll?.("img").forEach(img => { try { img.setAttribute("src", new URL(img.getAttribute("src"), location.href).pathname); } catch (e) { /* ignore */ } });
		let html = clone.outerHTML;
		if (el.matches("#pagecontent")) {
			const wrapClass = el.tagName === "TABLE" ? "" : el.className;
			html = el.tagName === "TABLE" ? html.replace(/^<table([^>]*) id="pagecontent"/, "<table$1") : `<div class="${wrapClass}">${clone.innerHTML}</div>`;
		}
		const d = describe(el);
		return {kind: d.kind, title: d.title, html: wrapFragment(el, html), url: location.pathname.replace(/^\//, "") + location.search + location.hash, pageTitle: pageTitle()};
	};

	const flash = (el) => {
		el.classList.add("tb-clip-flash");
		setTimeout(() => el.classList.remove("tb-clip-flash"), 650);
	};

	const sendEl = (el) => {
		const clip = capture(el);
		if (!clip) return;
		flash(el);
		app.TBApp.addClip(clip);
	};
	// endregion

	// region Events
	document.addEventListener("mousemove", (e) => {
		if (!mode) return;
		if (e.target === lastTarget) return;
		lastTarget = e.target;
		const prevEl = chain[level];
		chain = buildChain(e.target);
		const keep = prevEl ? chain.indexOf(prevEl) : -1;
		level = keep >= 0 ? keep : 0;
		show();
	}, true);
	document.addEventListener("scroll", () => { if (mode) show(); }, true);
	document.addEventListener("wheel", (e) => {
		if (!mode || !e.shiftKey || !chain.length) return;
		e.preventDefault();
		level = Math.max(0, Math.min(chain.length - 1, level + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1)));
		show();
	}, {capture: true, passive: false});
	const swallow = (e) => {
		if (!mode) return;
		if (e.target.closest && e.target.closest(".tb-clip-ui")) return;
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
	};
	["mousedown", "mouseup", "dblclick", "auxclick"].forEach(t => document.addEventListener(t, swallow, true));
	document.addEventListener("click", (e) => {
		if (!mode) return;
		swallow(e);
		const el = chain[level];
		if (el) sendEl(el);
	}, true);
	document.addEventListener("keydown", (e) => {
		if (e.altKey && (e.key === "c" || e.key === "C")) { e.preventDefault(); app.TBApp.toggleClipMode(); return; }
		if (!mode) return;
		if (e.key === "Escape") { app.TBApp.toggleClipMode(false); return; }
		if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			e.preventDefault();
			level = Math.max(0, Math.min(chain.length - 1, level + (e.key === "ArrowUp" ? 1 : -1)));
			show();
		}
	}, true);
	// endregion

	window.__tbClip = {
		setMode (on) {
			mode = !!on;
			document.body.classList.toggle("tb-clip-on", mode);
			if (!mode) { chain = []; lastTarget = null; }
			show();
		},
		clipPage () {
			const pc = document.getElementById("pagecontent");
			if (!pc) return false;
			sendEl(pc);
			return true;
		},
		clipSelection () {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
			const range = sel.getRangeAt(0);
			const div = document.createElement("div");
			div.appendChild(range.cloneContents());
			const text = sel.toString().replace(/\s+/g, " ").trim();
			const anc = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
			const sec = anc ? (anc.matches(".ve-rd__b") ? headingOf(anc) : "") || nearestSectionTitle(anc) : "";
			app.TBApp.addClip({
				kind: "Selection",
				title: sec ? `${sec} (excerpt)` : text.slice(0, 60),
				html: div.innerHTML,
				url: location.pathname.replace(/^\//, "") + location.search + location.hash,
				pageTitle: pageTitle(),
			});
			sel.removeAllRanges();
			return true;
		},
		pageTitle,
	};
	window.__tbClip.setMode(app.TBApp.isClipMode());
})();
