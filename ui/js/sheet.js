"use strict";

/**
 * Filled character sheet. Page 1 is the at-the-table sheet; following pages carry features,
 * spells and the character's story. Booklet page numbers appear when a page map is supplied.
 */
(async () => {
	const params = new URLSearchParams(location.search);
	const jobId = params.get("job");
	const isPreview = params.has("preview");
	const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[c]));
	const sg = (n) => (n >= 0 ? `+${n}` : `${n}`);
	const ABILS = ["str", "dex", "con", "int", "wis", "cha"];
	const NAMES = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};
	const done = (result) => { window.__tbResult = result; if (jobId && window.tbNative) window.tbNative.printReady(jobId, result); };

	try {
		const payload = isPreview ? (window.parent && window.parent.__tbSheetPayload) : await window.tbNative.getPrintPayload(jobId);
		if (!payload) throw new Error("Nothing to print.");
		const {sheet: S, pageMap = {}, options = {}} = payload;
		const paper = (options.sheetPaper || (["letter", "half-letter"].includes(options.pageSize) ? "letter" : "A4")) === "letter" ? {w: "8.5in", h: "11in"} : {w: "210mm", h: "297mm"};
		const pad = "8mm";
		document.documentElement.style.setProperty("--page-w", paper.w);
		document.documentElement.style.setProperty("--page-h", paper.h);
		document.documentElement.style.setProperty("--pad", pad);
		if (options.accent) document.documentElement.style.setProperty("--s-accent", options.accent);
		document.getElementById("tb-page-style").textContent = `@page { size: ${paper.w} ${paper.h}; margin: ${pad}; }`;
		const pg = (key) => key && pageMap[key] != null ? `<span class="pg">p.${pageMap[key]}</span>` : "";
		const actTag = (a) => a && a !== "Passive" ? `<span class="tag ${a === "Bonus Action" ? "bonus" : a === "Reaction" ? "reaction" : "action"}">${esc(a === "Bonus Action" ? "Bonus" : a)}</span>` : "";
		const usesBoxes = (uses) => {
			if (!uses) return "";
			const n = /^Twice/i.test(uses) ? 2 : /^Three/i.test(uses) ? 3 : 1;
			return `<span class="uses">${esc(uses.replace(/^Recharges: /, ""))}${"<span class=\"box\"></span>".repeat(n)}</span>`;
		};

		// region Page 1
		const field = (label, value) => `<div class="s-field"><b>${esc(value || "")}</b><span>${esc(label)}</span></div>`;
		const head = `<div class="s-head">
			<div class="s-name">${esc(S.name)}<small>Character name</small></div>
			<div class="s-fields">
				${field("Class & level", S.classLine)}${field("Species", S.species)}${field("Background", S.background)}${field("Alignment", S.alignment)}${field("Player", S.player)}
			</div>
		</div>`;
		const abils = `<div class="s-abils">${ABILS.map(a => `<div class="s-abil">
			<div class="s-abil-n">${NAMES[a].toUpperCase()}</div>
			<div class="s-abil-m">${sg(S.mods[a])}</div>
			<div class="s-abil-s">${S.scores[a]}</div>
			<div class="s-abil-sv"><span class="dot ${S.saves[a].prof ? "on" : ""}"></span>Save ${sg(S.saves[a].bonus)}</div>
		</div>`).join("")}</div>`;
		const box = (label, v, note, cls = "") => `<div class="s-box ${cls}"><div class="v">${esc(v)}</div><div class="l">${esc(label)}</div>${note ? `<div class="n">${esc(note)}</div>` : ""}</div>`;
		const vitals = `<div class="s-vitals">
			${box("Armor Class", S.ac, S.acNote, "shield")}
			${box("Initiative", sg(S.initiative))}
			${box("Speed", `${S.speed} ft.`, S.size)}
			${box("Proficiency", sg(S.pb))}
			${box("Spellcasting", S.spellcasting ? S.spellcasting.abbr : "—", S.spellcasting ? `DC ${S.spellcasting.dc} · ${sg(S.spellcasting.attack)}` : "", "cast")}
			${box("Passive Perc.", S.passive.perception, `Ins ${S.passive.insight} · Inv ${S.passive.investigation}`)}
			${box("Heroic Insp.", "", "")}
			<div class="s-box s-hp"><div class="l">Hit Points</div><div class="row3"><div class="cell"><i>max</i>${S.hp}</div><div class="cell"><i>current</i></div><div class="cell"><i>temp</i></div></div></div>
			<div class="s-box s-death"><div><span class="l">Hit dice</span> <b>${esc(S.hitDice)}</b></div><div>Successes<span class="circles">${"<span class=\"circle\"></span>".repeat(3)}</span></div><div>Failures<span class="circles">${"<span class=\"circle\"></span>".repeat(3)}</span></div></div>
		</div>`;
		const skills = `<div class="s-sec"><h3>Skills <small>● proficient · ◉ expertise</small></h3>${S.skills.map(k => `<div class="s-skill"><span class="dot ${k.exp ? "exp" : k.prof ? "on" : ""}"></span><span class="nm">${esc(k.name)} <span class="ab">${k.ability.toUpperCase()}</span></span><span class="bn">${sg(k.bonus)}</span></div>`).join("")}</div>`;
		const kv = (k, v) => v && (Array.isArray(v) ? v.length : true) ? `<div class="s-kv"><b>${esc(k)}:</b> ${esc(Array.isArray(v) ? v.join(", ") : v)}</div>` : "";
		const profs = `<div class="s-sec"><h3>Proficiencies & Training</h3>
			${kv("Armor", S.armorProf)}${kv("Weapons", S.weaponProf)}${kv("Mastery", S.masteries)}${kv("Tools", S.tools)}${kv("Languages", S.languages)}${kv("Resistances", S.resist)}${S.darkvision ? kv("Senses", `Darkvision ${S.darkvision} ft.`) : ""}
		</div>`;
		const attacks = `<div class="s-sec"><h3>Weapons & Damage Cantrips</h3><table class="s-t"><thead><tr><th>Name</th><th class="c">Atk / DC</th><th>Damage & type</th><th>Notes</th></tr></thead><tbody>
			${S.attacks.map(a => `<tr><td><b>${esc(a.name)}</b></td><td class="c">${sg(a.bonus)}</td><td>${esc(a.damage)}${a.versatile ? ` <span class="ab">(${esc(a.versatile)} 2H)</span>` : ""}</td><td>${esc([a.props, a.mastery ? "Mastery: " + a.mastery : ""].filter(Boolean).join(" · "))}</td></tr>`).join("")}
			${"<tr class=\"blank\"><td></td><td></td><td></td><td></td></tr>".repeat(Math.max(1, 5 - S.attacks.length))}
		</tbody></table></div>`;
		const sources = S.spellSources || [];
		const casting = S.casting.length || S.spellcasting ? `<div class="s-sec"><h3>Spellcasting ${pg("spell-list")}</h3>
			${S.casting.map(c => `<div class="s-kv"><b>${esc(c.label || c.cls)}:</b> ${esc(c.abilityName)} · save DC <b>${c.dc}</b> · attack <b>${sg(c.attack)}</b>${c.pact ? ` · Pact slots ${c.pact.slots} × level ${c.pact.level}` : ""}</div>`).join("")}
			${!S.casting.length && S.spellcasting ? `<div class="s-kv"><b>${esc(S.spellcasting.source)}:</b> ${esc(S.spellcasting.abilityName)} · save DC <b>${S.spellcasting.dc}</b> · attack <b>${sg(S.spellcasting.attack)}</b></div>` : ""}
			${sources.filter(o => !S.casting.some(c => (c.label || c.cls) === o.source)).map(o => `<div class="s-kv"><b>${esc(o.source)}:</b> ${esc(o.abilityName)} · save DC <b>${o.dc}</b> · attack <b>${sg(o.attack)}</b> <span class="ab">(${esc(o.spells.join(", "))})</span></div>`).join("")}
			<div class="slots">${S.slots.map((n, i) => `<span class="slot"><b>L${i + 1}</b>${"<span class=\"box\"></span>".repeat(n)}</span>`).join("")}${S.casting.filter(c => c.pact).map(c => `<span class="slot"><b>Pact L${c.pact.level}</b>${"<span class=\"box\"></span>".repeat(c.pact.slots)}</span>`).join("")}</div>
		</div>` : "";
		const quick = S.features.filter(f => f.act !== "Passive" || f.uses);
		const quickHtml = `<div class="s-sec"><h3>Actions & limited features <small>full text on page 2${Object.keys(pageMap).length ? " and in the booklet" : ""}</small></h3>
			${quick.map(f => `<div class="feat-q">${actTag(f.act)}<span class="grow"><span class="nm">${esc(f.name)}</span> <span class="gp">${esc(f.kind === "Class" || f.kind === "Subclass" ? `${f.group} ${f.level}` : f.kind)}</span></span>${usesBoxes(f.uses)}${pg(f.key)}</div>`).join("") || "<div class=\"ab\">None.</div>"}
		</div>`;
		const passiveNames = S.features.filter(f => f.act === "Passive" && !f.uses).map(f => esc(f.name)).join(" · ");
		const page1 = `<section class="page p1">${head}${abils}${vitals}
			<div class="s-cols">
				<div class="s-colflex">${skills}${profs}<div class="s-sec s-fill"><h3>Notes</h3><div class="ruled"></div></div></div>
				<div class="s-colflex">${attacks}${casting}${quickHtml}${passiveNames ? `<div class="s-sec"><h3>Traits & passive features</h3><div>${passiveNames}</div></div>` : ""}<div class="s-sec s-fill"><h3>Conditions, effects & reminders</h3><div class="ruled"></div></div></div>
			</div>
		</section>`;
		// endregion

		// region Page 2: features
		const groups = {};
		S.features.forEach(f => { (groups[f.kind] = groups[f.kind] || []).push(f); });
		const order = ["Class", "Subclass", "Species", "Feat", "Option"];
		const page2 = `<section class="page"><div class="s-title">Features & Traits <small>${esc(S.name)} · level ${S.totalLevel}</small></div>
			<div class="two">${order.filter(k => groups[k]).map(k => groups[k].map(f => `<div class="feat-full"><div class="h">${actTag(f.act)}<span class="nm">${esc(f.name)}</span><span class="gp">${esc(k === "Class" || k === "Subclass" ? `${f.group} ${f.level}` : `${k} · ${f.group}`)}</span><span style="flex:1"></span>${usesBoxes(f.uses)}${pg(f.key)}</div><div class="s">${esc(f.summary)}</div></div>`).join("")).join("")}</div>
		</section>`;
		// endregion

		// region Page 3: spells
		let page3 = "";
		if (S.spells.length) {
			const byLvl = {};
			S.spells.forEach(s => { (byLvl[s.level] = byLvl[s.level] || []).push(s); });
			page3 = `<section class="page"><div class="s-title">Spells <small>${S.spellcasting ? `${esc(S.spellcasting.abilityName)} · DC ${S.spellcasting.dc} · ${sg(S.spellcasting.attack)}` : ""}${sources.map(o => ` · ${esc(o.source)}: ${esc(o.abbr)} DC ${o.dc} · ${sg(o.attack)}`).join("")}</small></div>
				<table class="s-t"><thead><tr><th class="c">Prep</th><th>Spell</th><th>Casting</th><th>Range</th><th>Duration</th><th>Comp.</th><th class="c">C/R</th><th>Source</th><th>Pg</th></tr></thead><tbody>
				${Object.keys(byLvl).sort((a, b) => a - b).map(l => `<tr class="spell-lvl"><td colspan="9">${l === "0" ? "Cantrips" : `Level ${l}`}${l !== "0" && S.slots[l - 1] ? ` — slots ${"<span class=\"box\"></span>".repeat(S.slots[l - 1])}` : ""}</td></tr>${byLvl[l].map(s => `<tr><td class="c">${s.level === 0 || s.always ? "◆" : "<span class=\"box\"></span>"}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.time)}</td><td>${esc(s.range)}</td><td>${esc(s.duration)}</td><td>${esc(s.components)}</td><td class="c">${[s.conc ? "C" : "", s.ritual ? "R" : ""].filter(Boolean).join("/")}</td><td class="ab">${esc(s.via || "")}${s.abil ? ` · <b>${esc(s.abil)}</b>` : ""}</td><td>${pg(s.key)}</td></tr>`).join("")}`).join("")}
				</tbody></table>
				<div class="s-foot">◆ always prepared or cantrip · ☐ prepared today</div>
			</section>`;
		}
		// endregion

		// region Page 4: equipment and story
		const d = S.details || {};
		const gp = Math.floor((S.cp || 0) / 100);
		const rest = (S.cp || 0) % 100;
		const story = (label, v, min = 1) => `<div class="s-sec"><h3>${esc(label)}</h3><div class="lines" style="min-height:${min * 14}px">${esc(v || "")}</div></div>`;
		const page4 = `<section class="page"><div class="s-title">Equipment & Story <small>${esc(S.name)}</small></div>
			<div class="s-cols">
				<div>
					<div class="s-sec"><h3>Coins</h3><div class="coins"><div class="coin"><b>${rest % 10 || ""}</b><span>CP</span></div><div class="coin"><b>${Math.floor(rest / 10) || ""}</b><span>SP</span></div><div class="coin"><b></b><span>EP</span></div><div class="coin"><b>${gp || ""}</b><span>GP</span></div><div class="coin"><b></b><span>PP</span></div></div></div>
					<div class="s-sec"><h3>Equipment</h3><table class="s-t"><tbody>${S.items.map(i => `<tr><td>${esc(i.name)}${i.equipped ? " <span class=\"tag\">equipped</span>" : ""}</td><td class="c">${i.qty}</td></tr>`).join("")}${"<tr class=\"blank\"><td></td><td></td></tr>".repeat(Math.max(4, 22 - S.items.length))}</tbody></table></div>
				</div>
				<div>
					${S.portrait ? `<img class="p-portrait" src="${S.portrait}">` : ""}
					<div class="s-sec"><h3>Appearance</h3><div class="lines">${esc([d.age && `Age ${d.age}`, d.height && `Height ${d.height}`, d.weight && `Weight ${d.weight}`, d.eyes && `Eyes ${d.eyes}`].filter(Boolean).join(" · "))}${d.appearance ? "\n" + esc(d.appearance) : ""}</div></div>
					${story("Personality traits", d.personality, 2)}${story("Ideals", d.ideals, 1)}${story("Bonds", d.bonds, 1)}${story("Flaws", d.flaws, 1)}
					${story("Backstory", d.backstory, 8)}${story("Notes", d.notes, 5)}
				</div>
			</div>
		</section>`;
		// endregion

		document.body.innerHTML = page1 + page2 + page3 + page4;
		await document.fonts.ready;
		await Promise.all([...document.images].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));

		// Page 1 must stay one face: shrink its text until it fits
		const p1 = document.querySelector(".page.p1");
		// Start generous; the ruled note boxes absorb whatever space is left
		let fs = 9.6;
		p1.style.fontSize = `${fs}pt`;
		const fills = [...p1.querySelectorAll(".s-fill")];
		fills.forEach(f => { f.style.display = "none"; });
		const fits = () => p1.scrollHeight <= p1.clientHeight + 1;
		while (!fits() && fs > 6) { fs -= 0.2; p1.style.fontSize = `${fs.toFixed(2)}pt`; }
		fills.forEach(f => { f.style.display = ""; });
		// Real ruled lines (gradients rasterise unevenly in PDFs)
		p1.querySelectorAll(".s-fill .ruled").forEach(r => { r.innerHTML = "<div class=\"rl\"></div>".repeat(Math.max(0, Math.floor(r.clientHeight / 15.6))); });
		done({pages: document.querySelectorAll(".page").length, p1Font: fs});
	} catch (e) {
		console.error(e);
		if (jobId && window.tbNative) window.tbNative.printReady(jobId, {error: String(e && e.message || e)});
	}
})();
