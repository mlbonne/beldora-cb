"use strict";

/**
 * Cheat sheet layout. One fixed face per class (shrunk to fit), plus a flowing overview
 * for species, background, feats, options and spells. Every entry points at its booklet page.
 */
(async () => {
	const params = new URLSearchParams(location.search);
	const jobId = params.get("job");
	const isPreview = params.has("preview");
	const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]));

	const fail = (e) => {
		console.error(e);
		if (jobId && window.tbNative) window.tbNative.printReady(jobId, {error: String(e && e.message || e)});
	};

	try {
		const payload = isPreview
			? (window.parent && window.parent.__tbCheatPayload)
			: await window.tbNative.getPrintPayload(jobId);
		if (!payload) throw new Error("Nothing to print.");
		const {cheat, pageMap = {}, bookTitle, options = {}} = payload;

		const PAPER = {
			"A4": {w: "210mm", h: "297mm"},
			"letter": {w: "8.5in", h: "11in"},
		};
		const paper = PAPER[options.cheatPaper] || (["letter", "half-letter"].includes(options.pageSize) ? PAPER.letter : PAPER.A4);
		const pad = "8mm";
		document.documentElement.style.setProperty("--page-w", paper.w);
		document.documentElement.style.setProperty("--page-h", paper.h);
		document.documentElement.style.setProperty("--pad", pad);
		if (options.accent) document.documentElement.style.setProperty("--c-accent", options.accent);
		document.getElementById("tb-page-style").textContent = `
			@page { size: ${paper.w} ${paper.h}; margin: 0; }
			.flow { box-sizing: border-box; width: ${paper.w}; padding: ${pad} ${pad} 10mm; background: #fff; margin: 12px auto; }
			@media print { .flow { margin: 0; padding: 0; width: auto; } @page flow { size: ${paper.w} ${paper.h}; margin: ${pad}; } .flow { page: flow; } }
		`;

		const pg = (key, {bare = false} = {}) => {
			const n = pageMap[key];
			if (n == null) return "";
			return bare ? `<span class="pgb">p.${n}</span>` : `<span class="pg">${n}</span>`;
		};
		const C = cheat.character;
		const who = `<div class="c-who"><b>${esc(C.name)}</b><br>${esc([C.species, C.background].filter(Boolean).join(" · "))}<br>${esc(C.classLine)}</div>`;
		const foot = (label) => `<div class="c-foot"><span>${esc(label)}</span><span>Superscript numbers are pages in “${esc(bookTitle || "the booklet")}”</span></div>`;

		// region Class sheets
		const classSheet = (k) => {
			const slotCols = k.columns.filter(c => c.isSlots).length;
			const otherCols = k.columns.length - slotCols;
			const grp = slotCols ? `<tr class="grp"><th colspan="${3 + otherCols}"></th><th colspan="${slotCols}">Spell slots per spell level</th></tr>` : "";
			const rows = k.levels.map(l => {
				const cls = l.level === k.level ? "cur" : (l.level < k.level ? "past" : "");
				const feats = l.features.length
					? l.features.map(f => `<span class="c-f${f.isSub ? " sub" : ""}">${esc(f.name)}${pg(f.key)}</span>`).join(", ")
					: "—";
				return `<tr class="${cls}"><td>${l.level}</td><td>+${l.pb}</td><td class="l">${feats}</td>${l.cols.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`;
			}).join("");
			const core = k.core;
			const coreGrid = `<div class="c-core">
				<div><b>Hit Die</b>${esc(core.hd)} · ${esc(core.hpLater.replace(" per level", "/lvl"))}</div>
				<div><b>Saving Throws</b>${esc(core.saves || "—")}</div>
				<div><b>Primary Ability</b>${esc(core.primary || "—")}</div>
				<div><b>${core.spellAbility ? "Spellcasting" : "Multiclass Req."}</b>${esc(core.spellAbility || core.multiclassReq || `${core.primary} 13+`)}</div>
				<div class="c-span2"><b>Armor / Weapons</b>${esc([core.armor, core.weapons].filter(Boolean).join("; ") || "—")}</div>
				<div class="c-span2"><b>Skills</b>${esc(core.skills || "—")}</div>
				${core.tools ? `<div class="c-span2"><b>Tools</b>${esc(core.tools)}</div>` : ""}
				<div class="c-span2"><b>Multiclassing</b>Req. ${esc(core.multiclassReq || `${core.primary} 13+`)}${core.multiclassGains ? `; gain ${esc(core.multiclassGains)}` : ""}</div>
				${core.optFeatureTypes.length ? `<div class="c-span4"><b>Options known by level</b>${core.optFeatureTypes.map(o => `${esc(o.name)}: ${o.progression.map((n, i) => (i === 0 || n !== o.progression[i - 1]) ? `L${i + 1}→${n}` : null).filter(Boolean).join(", ")}`).join(" · ")}</div>` : ""}
			</div>`;
			const digest = k.digest.map(d => `<div class="d${d.isSub ? " sub" : ""}"><span class="lv">${d.levels.join("·")}</span><span class="n">${esc(d.name)}</span> ${pg(d.key, {bare: true})} <span class="s">— ${esc(d.summary)}</span></div>`).join("");
			const scNote = k.subclassOptions && k.subclassOptions.length
				? `<div class="c-note"><b>${esc(k.subclassTitle)} choice (level ${k.levels.find(l => l.features.some(f => /subclass/i.test(f.name)))?.level || 3}):</b> ${k.subclassOptions.map(esc).join(" · ")}</div>`
				: "";
			return `<section class="sheet" data-fit="1"><div class="sheet-inner">
				<div class="c-head"><div class="c-title">${esc(k.name)}${k.subclass ? `<small>${esc(k.subclass)}${k.plannedSubclass ? " (planned)" : ""}</small>` : ""}<small>${k.plannedClass ? "Planned multiclass" : `Level ${k.level}`}</small></div>${who}</div>
				${coreGrid}
				<table class="c-prog"><thead>${grp}<tr><th>Lvl</th><th>PB</th><th class="l">Features ${pg(k.tableKey)}</th>${k.columns.map(c => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
				<div class="c-sec">Feature Digest ${pg(k.coreKey, {bare: true})}</div>
				<div class="c-digest">${digest}</div>
				${scNote}
			</div>${foot(`${k.name} · ${k.source}`)}</section>`;
		};
		// endregion

		// region Overview
		const block = (title, inner, key) => inner ? `<div class="c-block"><div class="c-sec">${esc(title)} ${key ? pg(key, {bare: true}) : ""}</div>${inner}</div>` : "";
		const rowsOf = (arr, {group = false} = {}) => arr.map(r => `<div class="c-row">${group && r.group ? `<span class="g">${esc(r.group)}</span> ` : ""}<span class="n">${esc(r.name)}</span> ${r.key ? pg(r.key, {bare: true}) : ""}${r.summary ? ` — ${esc(r.summary)}` : ""}</div>`).join("");

		const overviewBlocks = [
			cheat.species ? block(`Species: ${cheat.species.name}`, rowsOf(cheat.species.traits), cheat.species.key) : "",
			cheat.background ? block(`Background: ${cheat.background.name}`, rowsOf(cheat.background.traits), cheat.background.key) : "",
			cheat.feats.length ? block("Feats", rowsOf(cheat.feats.map(f => ({...f, group: f.fromBackground ? "Origin" : f.category}))), null) : "",
			cheat.optfeatures.length ? block("Class Options", rowsOf(cheat.optfeatures, {group: true}), null) : "",
		].filter(Boolean).join("");

		const sgn = (n) => (n >= 0 ? `+${n}` : `${n}`);
		const castInfo = cheat.spellcasting ? ` <span class="c-cast">${esc(cheat.spellcasting.abilityName)} · DC ${cheat.spellcasting.dc} · attack ${sgn(cheat.spellcasting.attack)}${(cheat.spellSources || []).map(o => ` · ${esc(o.source)}: ${esc(o.abbr)} DC ${o.dc}, ${sgn(o.attack)}`).join("")}</span>` : "";
		const spellsTable = cheat.spells.length ? `<div class="c-sec" style="margin-top:0.6em">Spells${castInfo} ${pg("spell-list", {bare: true})}</div>
			<table class="c-spells"><colgroup><col style="width:3%"><col style="width:16%"><col style="width:8%"><col style="width:9%"><col style="width:11%"><col style="width:6%"><col><col style="width:4.5%"></colgroup>
			<thead><tr><th>Lvl</th><th>Spell</th><th>Casting</th><th>Range</th><th>Duration</th><th>Comp.</th><th>Effect</th><th>Pg</th></tr></thead><tbody>
			${cheat.spells.map(s => `<tr><td class="lv">${s.level === 0 ? "C" : s.level}</td><td><b>${esc(s.name)}</b>${s.abil ? `<span class="tag ab">${esc(s.abil)}</span>` : ""}${s.conc ? `<span class="tag">C</span>` : ""}${s.ritual ? `<span class="tag">R</span>` : ""}</td><td>${esc(s.timeShort || s.time)}</td><td>${esc(s.range)}</td><td>${esc(s.duration)}</td><td>${esc(s.components)}</td><td>${esc(s.summary)}</td><td>${pg(s.key, {bare: true})}</td></tr>`).join("")}
			</tbody></table>` : "";

		const overview = (overviewBlocks || spellsTable) ? `<section class="flow"><div class="sheet-inner" style="padding:0;font-size:${options.cheatFont || 7.6}pt">
			<div class="c-head"><div class="c-title">${esc(C.name)}<small>${esc(C.classLine)}</small></div><div class="c-who">${C.player ? `Player: <b>${esc(C.player)}</b><br>` : ""}${esc([C.species, C.background].filter(Boolean).join(" · "))}<br>Total level ${C.totalLevel}</div></div>
			<div class="c-cols">${overviewBlocks}</div>
			${spellsTable}
		</div></section>` : "";
		// endregion

		document.body.innerHTML = overview + cheat.classes.map(classSheet).join("");

		await document.fonts.ready;

		// Shrink each class sheet until it fits on one face
		for (const sheet of document.querySelectorAll(".sheet[data-fit]")) {
			const inner = sheet.querySelector(".sheet-inner");
			const avail = sheet.clientHeight - 14; // keep the footer clear
			let fs = 9;
			inner.style.setProperty("--fs", fs + "pt");
			while (inner.scrollHeight > avail && fs > 5.4) {
				fs -= 0.2;
				inner.style.setProperty("--fs", fs.toFixed(2) + "pt");
			}
			if (inner.scrollHeight > avail) {
				// Last resort: keep the names and page numbers, drop the summaries
				inner.querySelector(".c-digest")?.classList.add("no-sum");
				fs = 8;
				inner.style.setProperty("--fs", fs + "pt");
				while (inner.scrollHeight > avail && fs > 5) {
					fs -= 0.2;
					inner.style.setProperty("--fs", fs.toFixed(2) + "pt");
				}
			}
			sheet.dataset.fontSize = fs.toFixed(2);
		}

		const result = {sheets: document.querySelectorAll(".sheet").length, fonts: [...document.querySelectorAll(".sheet")].map(s => s.dataset.fontSize)};
		window.__tbResult = result;
		if (jobId && window.tbNative) window.tbNative.printReady(jobId, result);
	} catch (e) {
		fail(e);
	}
})();
