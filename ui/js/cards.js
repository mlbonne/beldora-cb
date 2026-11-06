"use strict";

/**
 * Cards: 63.5 × 88.9 mm (poker size), nine per page with cut guides. Text shrinks to fit; anything still
 * too long continues on a follow-up card.
 */
(async () => {
	const params = new URLSearchParams(location.search);
	const jobId = params.get("job");
	const isPreview = params.has("preview");
	const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]));
	const MAX_FS = 7.4;
	const MIN_FS = 5.6;

	try {
		const payload = isPreview ? (window.parent && window.parent.__tbCardsPayload) : await window.tbNative.getPrintPayload(jobId);
		if (!payload) throw new Error("Nothing to print.");
		const {cards, pageMap = {}, options = {}, name} = payload;
		const paper = (options.sheetPaper || (["letter", "half-letter"].includes(options.pageSize) ? "letter" : "A4")) === "letter" ? {w: "8.5in", h: "11in"} : {w: "210mm", h: "297mm"};
		document.documentElement.style.setProperty("--page-w", paper.w);
		document.documentElement.style.setProperty("--page-h", paper.h);
		document.getElementById("tb-page-style").textContent = `@page { size: ${paper.w} ${paper.h}; margin: 0; }`;

		const cardEl = (c, {cont = false} = {}) => {
			const el = document.createElement("div");
			el.className = `card ${c.type}`;
			const pg = c.key && pageMap[c.key] != null ? `<span class="pg">Booklet p.${pageMap[c.key]}</span>` : "";
			el.innerHTML = `<div class="card-in">
				<div class="k-head"><div class="k-title">${esc(c.title)}${cont ? " <span style=\"font-size:.7em\">(cont.)</span>" : ""}</div><div class="k-sub">${esc(c.subtitle || "")}</div></div>
				${!cont && c.tags && c.tags.length ? `<div class="k-tags">${c.tags.map(t => `<span class="k-tag">${esc(t)}</span>`).join("")}</div>` : ""}
				${!cont && c.stats && c.stats.length ? `<div class="k-stats">${c.stats.map(([k, v]) => `<div class="k-stat"><b>${esc(k)}</b>${esc(v)}</div>`).join("")}</div>` : ""}
				<div class="k-body"></div>
				<div class="k-foot"><span>${esc(c.footer || "")}${name ? ` · ${esc(name)}` : ""}</span>${pg}</div>
			</div>`;
			return el;
		};

		// Lay cards out one at a time in a measuring page, splitting overflow onto continuation cards
		const measure = document.createElement("div");
		measure.className = "sheetpage";
		measure.style.position = "absolute";
		measure.style.left = "-9999px";
		document.body.appendChild(measure);
		await document.fonts.ready;

		const finished = [];
		const overflows = (body) => body.scrollHeight > body.clientHeight + 0.5;
		for (const c of cards) {
			let nodes = (() => { const t = document.createElement("template"); t.innerHTML = c.html || ""; return [...t.content.childNodes]; })();
			let cont = false;
			let guard = 0;
			while (guard++ < 6) {
				const el = cardEl(c, {cont});
				measure.appendChild(el);
				const body = el.querySelector(".k-body");
				nodes.forEach(n => body.appendChild(n));
				let fs = MAX_FS;
				body.style.setProperty("--fs", `${fs}pt`);
				while (overflows(body) && fs > MIN_FS) { fs -= 0.2; body.style.setProperty("--fs", `${fs.toFixed(2)}pt`); }
				const rest = [];
				if (overflows(body)) {
					// Move trailing blocks to a continuation card until this one fits
					const marker = document.createElement("p");
					marker.className = "k-cont";
					marker.textContent = "Continued on the next card…";
					while (overflows(body) && body.childNodes.length > 1) rest.unshift(body.lastChild), body.removeChild(body.lastChild);
					body.appendChild(marker);
					while (overflows(body) && body.childNodes.length > 2) { rest.unshift(body.childNodes[body.childNodes.length - 2]); body.removeChild(body.childNodes[body.childNodes.length - 2]); }
				}
				measure.removeChild(el);
				finished.push(el);
				if (!rest.length) break;
				nodes = rest;
				cont = true;
			}
		}
		measure.remove();

		for (let i = 0; i < finished.length; i += 9) {
			const page = document.createElement("div");
			page.className = "sheetpage";
			finished.slice(i, i + 9).forEach(el => page.appendChild(el));
			document.body.appendChild(page);
		}
		const result = {cards: finished.length, pages: Math.ceil(finished.length / 9)};
		window.__tbResult = result;
		if (jobId && window.tbNative) window.tbNative.printReady(jobId, result);
	} catch (e) {
		console.error(e);
		if (jobId && window.tbNative) window.tbNative.printReady(jobId, {error: String(e && e.message || e)});
	}
})();
