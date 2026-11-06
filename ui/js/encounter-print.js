"use strict";

/**
 * Encounter PDF. Page 1 is the at-the-table cheat sheet (shrunk to fit one face): budget and XP, combatants
 * with HP boxes, an initiative ladder, the d6 extra actions and the d8 treasure table. Stat blocks and the
 * text of the magic items follow in two flowing columns.
 */
(async () => {
	const params = new URLSearchParams(location.search);
	const jobId = params.get("job");
	const isPreview = params.has("preview");
	const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]));
	const xp = (n) => Number(n || 0).toLocaleString("en-US");
	const gp = (n) => `${Math.round(n || 0).toLocaleString("en-US")} gp`;
	const done = (result) => { window.__tbResult = result; if (jobId && window.tbNative) window.tbNative.printReady(jobId, result); };

	try {
		const payload = isPreview ? (window.parent && window.parent.__tbEncounterPayload) : await window.tbNative.getPrintPayload(jobId);
		if (!payload) throw new Error("Nothing to print.");
		const {encounter: E, ev, roster, blocks, loot, extras, items, options = {}} = payload;

		const paper = options.paper === "letter" ? {w: "8.5in", h: "11in"} : {w: "210mm", h: "297mm"};
		const pad = "8mm";
		const root = document.documentElement.style;
		root.setProperty("--page-w", paper.w);
		root.setProperty("--page-h", paper.h);
		root.setProperty("--pad", pad);
		if (options.accent) root.setProperty("--c-accent", options.accent);
		document.getElementById("tb-page-style").textContent = `
			@page { size: ${paper.w} ${paper.h}; margin: 0; }
			@media print { @page flow { size: ${paper.w} ${paper.h}; margin: ${pad} ${pad} 11mm; } .flow { page: flow; } }
		`;

		// region Page 1
		const enemies = roster.filter(r => !r.ally);
		const allies = roster.filter(r => r.ally);
		const partyLine = ev.party.rows.map(r => `${r.count} × level ${r.level}`).join(" + ");
		const head = `<div class="c-head">
			<div class="c-title">${esc(E.name)}<small>${esc([ev.difficulty.label, E.shape].filter(Boolean).join(" · "))}</small></div>
			<div class="c-who"><b>${esc(partyLine)}</b><br>${esc(E.rules)} encounter rules${E.habitats.length ? `<br>${esc(E.habitats.join(", "))}` : ""}</div>
		</div>`;

		const top = Math.max(ev.tiers[ev.tiers.length - 1].xp * 1.25, ev.effective * 1.05, 1);
		let prev = 0;
		const segs = ev.tiers.map((t, i) => {
			const s = `<div class="seg t${i}" style="left:${prev / top * 100}%;width:${(t.xp - prev) / top * 100}%"><span>${esc(t.label)} ≤ ${xp(t.xp)}</span></div>`;
			prev = t.xp;
			return s;
		}).join("");
		const at = Math.min(100, ev.effective / top * 100);
		const thermo = `<div class="thermo-w"><div class="thermo">${segs}<div class="seg over" style="left:${prev / top * 100}%;width:${100 - prev / top * 100}%"></div><div class="fill" style="width:${at}%"></div></div><div class="mark${at > 80 ? " r" : ""}" style="left:${at}%"><b>▲ ${xp(ev.effective)} XP · ${esc(ev.difficulty.label)}</b></div></div>`;

		const share = ev.levelShare.map(s => `L${s.level}: ${s.pct != null ? `${s.pct}% of a level` : "max level"}`).join(" · ");
		const band = `<div class="c-core">
			<div><b>Budget</b>${ev.tiers.map(t => `<span class="${ev.difficulty.id === t.id ? "on" : ""}">${esc(t.label)} ${xp(t.xp)}</span>`).join(" · ")}${ev.allyXp ? `<br><i>incl. +${xp(ev.allyXp)} for allies</i>` : ""}</div>
			<div><b>Encounter XP</b><span class="big">${xp(ev.enemyXp)}</span>${ev.mult !== 1 ? ` <i>×${ev.mult} = ${xp(ev.effective)} adj.</i>` : ""}<br><i>${ev.enemyCount} foe${ev.enemyCount === 1 ? "" : "s"}</i></div>
			<div><b>Difficulty</b><span class="big diff d-${esc(ev.difficulty.id)}">${esc(ev.difficulty.label)}</span></div>
			<div><b>XP per character</b><span class="big">${xp(ev.perPc)}</span><br><i>${esc(share)}</i></div>
		</div>`;

		const hpBoxes = (r) => {
			const n = Math.min(r.count, 24);
			return `<div class="hpb">${Array.from({length: n}, (_, i) => `<span class="box"><i>${r.count > 1 ? i + 1 : ""}</i>${r.hpAvg ?? ""}</span>`).join("")}</div>`;
		};
		const rosterRow = (r) => `<tr class="${r.ally ? "ally" : ""}">
			<td class="q">${r.count}×</td>
			<td class="l"><b>${esc(r.name)}</b>${r.ally ? ` <span class="tag ally">Ally</span>` : ""}${r.role ? ` <span class="tag">${esc(r.role)}</span>` : ""}${r.legendary ? ` <span class="tag leg">Legendary</span>` : ""}<br><span class="sub">${esc(r.source)}${r.notes ? ` · ${esc(r.notes)}` : ""}</span></td>
			<td>${esc(r.cr)}</td><td>${xp(r.xp * r.count)}</td><td><b>${esc(r.ac)}</b></td><td class="hp"><b>${esc(String(r.hp).replace(/\s*\(.*$/, ""))}</b><br><span class="sub">${esc((/\((.*)\)/.exec(r.hp) || [, ""])[1].replace(/\s+/g, ""))}</span></td><td>${esc(r.init)}</td><td class="l">${esc(r.speed)}</td><td>${r.passive ?? "—"}</td>
			<td class="l">${hpBoxes(r)}</td>
		</tr>`;
		const rosterTable = `<div class="c-sec">Combatants</div>
			<table class="c-roster"><thead><tr><th>Qty</th><th class="l">Creature</th><th>CR</th><th>XP</th><th>AC</th><th>HP</th><th>Init</th><th class="l">Speed</th><th>PP</th><th class="l">Hit points (cross off as they fall)</th></tr></thead>
			<tbody>${[...enemies, ...allies].map(rosterRow).join("")}</tbody></table>`;

		const extrasTable = extras.length ? `<div class="c-block"><div class="c-sec">Extra Actions <span class="die">d6</span></div>
			<table class="c-roll">${extras.map((x, i) => `<tr><td class="n">${i + 1}</td><td><b>${esc(x.name)}</b> <span class="use">${esc(x.use)}</span><br>${esc(x.text)}</td></tr>`).join("")}</table></div>` : "";

		const lootLine = (l) => {
			let s = esc(l.text);
			if (l.note) s += ` <i>(${esc(l.note)})</i>`;
			if (l.kind === "item" && l.rarity) s += ` <span class="rar">${esc(l.rarity)}${l.attune ? ", attune" : ""}</span>`;
			return s;
		};
		const lootTable = loot.options.length ? `<div class="c-block"><div class="c-sec">Treasure <span class="die">d8</span> <small>target ≈ ${gp(loot.target)} · ${esc(loot.generosity)}</small></div>
			<table class="c-roll">${loot.options.map((o, i) => `<tr><td class="n">${i + 1}</td><td><b>${esc(o.title)}</b><span class="val">≈ ${gp(o.value)}</span><br>${o.lines.map(lootLine).join(" + ")}${o.lines.filter(l => l.kind === "item" && l.summary).map(l => `<div class="sum">${esc(l.name)}: ${esc(l.summary)}</div>`).join("")}</td></tr>`).join("")}</table></div>` : "";

		const initRows = ev.party.size + enemies.length + allies.length;
		const initTable = `<div class="c-block"><div class="c-sec">Initiative</div>
			<table class="c-init"><thead><tr><th>Init</th><th class="l">Name</th><th>HP</th><th class="l">Conditions · notes</th></tr></thead><tbody>
			${[...enemies, ...allies].map(r => `<tr><td></td><td class="l">${esc(r.name)}${r.count > 1 ? ` <i>×${r.count}</i>` : ""} <span class="sub">${esc(r.init)}</span></td><td></td><td></td></tr>`).join("")}
			${Array.from({length: Math.max(ev.party.size, 1)}, () => "<tr><td></td><td></td><td></td><td></td></tr>").join("")}
			</tbody></table></div>`;

		const victory = `<div class="c-victory"><b>Victory</b> Each character earns <span class="big">${xp(ev.perPc)} XP</span> (${xp(ev.enemyXp)} XP ÷ ${ev.party.size}). ${esc(share)}. Then roll <b>1d8</b> on the treasure table.</div>`;
		const notes = E.notes ? `<div class="c-notes"><b>Notes</b> ${esc(E.notes).replace(/\n/g, "<br>")}</div>` : "";

		const page1 = `<section class="sheet" data-fit="1"><div class="sheet-inner">
			${head}${band}${thermo}${notes}${rosterTable}
			<div class="c-two"><div>${extrasTable}${initTable}</div><div>${lootTable}</div></div>
			${victory}
		</div><div class="c-foot"><span>Beldora CB · ${esc(E.name)}</span><span>${esc(E.rules)} · XP budget per character, summed over the party</span></div></section>`;
		// endregion

		// region Stat blocks + items
		const statBlock = (b) => `<div class="sb">
			<div class="sb-name">${esc(b.name)}<span class="sb-src">${esc(b.source)}${b.page ? ` p.${b.page}` : ""}</span></div>
			<div class="sb-meta">${esc(b.meta)}</div>
			<div class="sb-rule"></div>
			<div class="sb-l"><b>AC</b> ${esc(b.ac)} <span class="sp"></span><b>Initiative</b> ${esc(b.init)}</div>
			<div class="sb-l"><b>HP</b> ${esc(b.hp)}</div>
			<div class="sb-l"><b>Speed</b> ${esc(b.speed)}</div>
			<table class="sb-ab"><tr>${[0, 3].map(o => `<td><table><tr><th></th><th></th><th>MOD</th><th>SAVE</th></tr>${b.abil.slice(o, o + 3).map(a => `<tr><th>${a.ab}</th><td>${esc(a.score)}</td><td class="m">${esc(a.mod)}</td><td class="s${a.prof ? " p" : ""}">${esc(a.save)}</td></tr>`).join("")}</table></td>`).join("")}</tr></table>
			${b.lines.map(([k, v]) => `<div class="sb-l"><b>${esc(k)}</b> ${esc(v)}</div>`).join("")}
			<div class="sb-l"><b>CR</b> ${esc(b.cr)} (XP ${xp(b.xp)}${b.xpLair ? `, or ${xp(b.xpLair)} in lair` : ""}; PB ${esc(b.pb)})</div>
			${b.sections.map(s => `<div class="sb-sec${s.lair ? " lair" : ""}"><div class="sb-h">${esc(s.title)}</div>${s.intro ? `<div class="sb-intro">${s.intro}</div>` : ""}${s.items.join("")}</div>`).join("")}
		</div>`;
		const blocksHtml = options.statBlocks !== false && blocks.length ? `<div class="f-title">Stat Blocks</div><div class="f-cols">${blocks.map(statBlock).join("")}</div>` : "";
		const itemsHtml = options.itemText !== false && items.length ? `<div class="f-title">Treasure Reference</div><div class="f-cols">${items.map(it => `<div class="it"><div class="it-n"><span class="roll">d8: ${it.roll}</span>${esc(it.name)}${it.note ? ` <i>(${esc(it.note)})</i>` : ""}</div><div class="it-s">${esc(it.sub)}</div>${it.html}</div>`).join("")}</div>` : "";
		const flow = blocksHtml || itemsHtml ? `<section class="flow">${blocksHtml}${itemsHtml}</section>` : "";
		// endregion

		document.body.innerHTML = page1 + flow;
		await document.fonts.ready;

		// Shrink page 1 until it fits on one face
		const sheet = document.querySelector(".sheet");
		const inner = sheet.querySelector(".sheet-inner");
		const avail = sheet.clientHeight - 16;
		let fs = 10.6;
		inner.style.setProperty("--fs", fs + "pt");
		while (inner.scrollHeight > avail && fs > 5.2) {
			fs -= 0.15;
			inner.style.setProperty("--fs", fs.toFixed(2) + "pt");
		}
		if (inner.scrollHeight > avail) {
			// Last resort: drop the item one-liners (their full text follows anyway)
			inner.querySelectorAll(".sum").forEach(e => e.remove());
		}
		done({fontSize: fs.toFixed(2), blocks: blocks.length, items: items.length, overflow: inner.scrollHeight > avail});
	} catch (e) {
		console.error(e);
		if (jobId && window.tbNative) window.tbNative.printReady(jobId, {error: String(e && e.message || e)});
		window.__tbResult = {error: String(e && e.message || e)};
	}
})();
