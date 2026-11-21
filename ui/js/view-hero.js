"use strict";

/** Hero view: the character at a glance, with level-up and every PDF export one click away. */
globalThis.TBViewHero = (() => {
	const {h, clear} = TBUI;
	const R = () => TBRules;
	const D = () => TBData;
	const ui = {featFilter: "All", expanded: new Set(), featTab: "features"};

	const tile = (label, value, sub) => h("div.htile", h("div.htile-v", value), h("div.htile-l", label), sub ? h("div.htile-s", sub) : null);

	const render = async (root, char) => {
		const A = await R().analyze(char);
		const d = A.derived;
		// Keep the reader's place when the page is redrawn
		const prevScroll = root.querySelector(".hero")?.scrollTop || 0;
		clear(root);
		if (!char.classes.length) {
			root.appendChild(h("div.empty", h("h2", "This character has no class yet"), h("p", "Use the builder to choose species, background and class."), h("button.btn.primary", {on: {click: () => TBApp.openCharTab("builder")}}, "Open the builder")));
			return;
		}

		// region Header
		const todo = Object.entries(A.steps).filter(([, s]) => s === "In progress" || s === "Not started");
		// Content this device doesn't have (a character file from a friend who uses other 5etools homebrew)
		const missing = [
			char.species && !d.speciesEnt ? `species ${char.species.name} (${char.species.source})` : null,
			char.background && !d.backgroundEnt ? `background ${char.background.name} (${char.background.source})` : null,
			...char.classes.filter(k => !d.classes.some(x => x.name === k.name && x.level)).map(k => `class ${k.name} (${k.source})`),
		].filter(Boolean);
		const xp = TBLevel.progress(char);
		const levelUp = () => TBLevel.levelUp(char);
		const header = h("div.hhead",
			char.portrait ? h("img.hportrait", {src: char.portrait}) : null,
			h("div.grow",
				h("div.hname", d.name),
				h("div.hline", `Level ${d.totalLevel} · ${[d.species, d.classes.map(c => `${c.subclass ? c.subclass + " " : ""}${c.hrTitle || c.name} ${c.level}`).join(" / "), d.background].filter(Boolean).join(" · ")}`),
				TBLevel.xpBar(char, () => render(root, char)),
				char.forced ? h("div.hwarn", `Forced level-up from level ${char.forced.fromLevel}. `, h("a", {href: "#", on: {click: (e) => { e.preventDefault(); TBLevel.revertForced(char); }}}, "Revert"), " · ", h("a", {href: "#", on: {click: (e) => { e.preventDefault(); TBLevel.keepForced(char); }}}, "Keep it")) : null,
				missing.length ? h("div.hwarn", `Missing on this device: ${missing.join(", ")}. Add the 5etools homebrew it comes from in Settings → `, h("a", {href: "#", on: {click: (e) => { e.preventDefault(); TBBrew.open(); }}}, "Homebrew Manager"), ".") : null,
				todo.length ? h("div.hwarn", "Unfinished: ", ...todo.map(([s]) => h("a", {href: "#", on: {click: (e) => { e.preventDefault(); TBViewBuilder.goTo(s); TBApp.openCharTab("builder"); }}}, R().STEPS.find(x => x.id === s).label)).flatMap((a, i) => i ? [", ", a] : [a])) : null,
			),
			h("div.hactions",
				h("button.btn", {on: {click: () => TBApp.openCharTab("builder")}}, "✎ Edit"),
				h("button.btn.primary", {disabled: !xp.ready, title: xp.ready ? "Raise a class by one level" : xp.to == null ? "Level 20" : `${(xp.to - xp.xp).toLocaleString("en-US")} more XP for level ${xp.level + 1} (or Force level up in the builder)`, on: {click: levelUp}}, "▲ Level up"),
				h("button.btn", {on: {click: () => TBApp.openCharTab("export")}}, "⇩ PDFs"),
			),
		);
		// endregion

		// region Stats
		const abil = h("div.habils", ...R().ABILS.map(a => h("div.habil",
			h("div.habil-n", R().ABIL_NAMES[a].slice(0, 3).toUpperCase()),
			h("div.habil-m", R().signed(d.mods[a])),
			h("div.habil-s", String(d.scores[a])),
			h("div.habil-sv", {class: d.saves[a].prof ? "prof" : ""}, `Save ${R().signed(d.saves[a].bonus)}`),
		)));
		const tiles = h("div.htiles",
			tile("Armor Class", String(d.ac), d.acNote),
			tile("Hit Points", String(d.hp), d.hitDice),
			tile("Initiative", R().signed(d.initiative)),
			tile("Speed", `${d.speed} ft.`, d.size),
			tile("Proficiency", R().signed(d.pb)),
			tile("Passive Perception", String(d.passive.perception)),
			d.spellcasting ? tile("Spellcasting", d.spellcasting.abilityName, `DC ${d.spellcasting.dc} · attack ${R().signed(d.spellcasting.attack)} · ${d.spellcasting.source}`) : null,
			...(d.spellSources || []).map(o => tile(`${o.source} spells`, o.abilityName, `DC ${o.dc} · attack ${R().signed(o.attack)}`)),
		);
		// endregion

		// region Skills
		const skills = h("div.hcard", h("h3", "Skills"), h("div.hskills", ...R().SKILL_LIST.map(s => {
			const k = d.skills[s];
			return h("div.hskill", h("span.dot", {class: k.exp ? "exp" : k.prof ? "prof" : ""}), h("span.grow", R().titleCase(s), h("span.muted", ` ${k.ability.toUpperCase()}`)), h("b", R().signed(k.bonus)));
		})));
		// endregion

		// region Attacks & spells
		/** A spell that expands in place to its full text, like features do. */
		const spellRow = (s) => {
			const m = D().spellMeta(s.ent);
			const id = `spell:${R().refKey(s.ent)}`;
			const el = h("div.hfeat.hspellrow");
			const fill = (open) => {
				el.querySelector(".hfeat-b, .hfeat-sum")?.remove();
				el.classList.toggle("open", open);
				if (!open) { el.appendChild(h("div.hfeat-sum", `${m.timeShort} · ${m.range} · ${m.duration}`)); return; }
				const body = h("div.hfeat-b");
				const entries = [...(s.ent.entries || []), ...(s.ent.entriesHigherLevel || [])];
				body.innerHTML = `<div class="hspell-meta"><i>${TBBook.esc(s.ent.level === 0 ? `${m.school} cantrip` : `Level ${s.ent.level} ${m.school}`)}${m.ritual ? " (ritual)" : ""}</i></div>
					<div class="hspell-stats">
						<div><b>Casting Time</b> ${TBBook.esc(m.time)}</div><div><b>Range</b> ${TBBook.esc(m.range)}</div>
						<div><b>Components</b> ${TBBook.esc(D().strip(m.components))}</div><div><b>Duration</b> ${TBBook.esc(m.duration)}</div>
					</div>` + TBSan.clean(Renderer.get().setFirstSection(true).render({type: "entries", entries}));
				el.appendChild(body);
			};
			el.appendChild(h("div.hfeat-h", {on: {click: () => {
				const open = !ui.expanded.has(id);
				open ? ui.expanded.add(id) : ui.expanded.delete(id);
				fill(open);
			}}},
				h("span.kindtag.spell", s.ent.level === 0 ? "Cantrip" : `Level ${s.ent.level}`),
				h("span.grow", h("b", s.ent.name), m.conc ? h("sup.hsup", "C") : null, m.ritual ? h("sup.hsup", "R") : null, h("span.muted", ` · ${s.via || ""}`), s.altAbility && s.cast ? h("span.abiltag", {title: `Cast with ${s.cast.abilityName}: DC ${s.cast.dc}, attack ${R().signed(s.cast.attack)}`}, `${s.cast.abbr} · DC ${s.cast.dc}`) : null),
				/Bonus/i.test(m.timeShort) ? h("span.acttag", "Bonus Action") : /Reaction/i.test(m.timeShort) ? h("span.acttag", "Reaction") : null,
			));
			fill(ui.expanded.has(id));
			return el;
		};

		const attacks = h("div.hcard", h("h3", "Attacks"), h("table.htable",
			h("thead", h("tr", h("th", "Weapon"), h("th", "Hit"), h("th", "Damage"), h("th", "Notes"))),
			h("tbody", ...d.attacks.map(a => h("tr", h("td", a.name), h("td", R().signed(a.bonus)), h("td", a.damage, a.versatile ? h("span.muted", ` (${a.versatile} two-handed)`) : null), h("td.muted", [a.props, a.mastery ? `Mastery: ${a.mastery}` : ""].filter(Boolean).join(" · "))))),
		));
		let spells = null;
		if (d.spells.length || d.casting.length) {
			const byLvl = {};
			d.spells.forEach(s => { (byLvl[s.ent.level] = byLvl[s.ent.level] || []).push(s); });
			spells = h("div.hcard", h("h3", "Spells"),
				d.slots.length || d.casting.some(c => c.pact) ? h("div.hslots",
					...d.slots.map((n, i) => h("span.hslot", h("b", `L${i + 1}`), " ", "●".repeat(n))),
					...d.casting.filter(c => c.pact).map(c => h("span.hslot", h("b", `Pact L${c.pact.level}`), " ", "●".repeat(c.pact.slots))),
				) : null,
				...Object.keys(byLvl).sort((a, b) => a - b).map(l => h("div.hspell-group",
					h("div.hspell-lvl", l === "0" ? "Cantrips" : `Level ${l}`),
					...byLvl[l].map(s => spellRow(s)),
				)),
			);
		}
		// endregion

		// region Features
		const feats = R().featureList(d);
		const kinds = ["All", "Action", "Bonus Action", "Reaction", "Passive"];
		const filterBar = h("div.row", {style: {gap: "4px", flexWrap: "wrap"}}, ...kinds.map(k => h("span.chip", {class: ui.featFilter === k ? "on" : "", on: {click: () => { ui.featFilter = k; render(root, char); }}}, k)));
		const shown = feats.filter(f => ui.featFilter === "All" || f.act === ui.featFilter);
		const featList = h("div.hfeats", ...shown.map(f => {
			const id = `${f.kind}:${f.name}:${f.level || ""}`;
			const fill = (el, open) => {
				el.querySelector(".hfeat-b, .hfeat-sum")?.remove();
				el.classList.toggle("open", open);
				if (open) {
					const body = h("div.hfeat-b");
					body.innerHTML = TBSan.clean(Renderer.get().setFirstSection(true).render({type: "entries", entries: f.entries}));
					el.appendChild(body);
				} else el.appendChild(h("div.hfeat-sum", D().summarize(f.entries, 170)));
			};
			// Expanding toggles this entry in place, so the page doesn't jump
			const el = h("div.hfeat",
				h("div.hfeat-h", {on: {click: () => {
					const open = !ui.expanded.has(id);
					open ? ui.expanded.add(id) : ui.expanded.delete(id);
					fill(el, open);
				}}},
					h("span.kindtag", {class: f.kind.toLowerCase()}, f.kind === "Class" || f.kind === "Subclass" ? `${f.kind} ${f.level}` : f.kind),
					h("span.grow", h("b", f.name), h("span.muted", ` · ${f.group}`), f.brew ? h("span.tag.brew", "5etools homebrew") : null),
					f.act !== "Passive" ? h("span.acttag", f.act) : null,
					f.uses ? h("span.muted", {style: {fontSize: "12px"}}, f.uses) : null,
				),
			);
			fill(el, ui.expanded.has(id));
			return el;
		}));
		// Features & traits | Notes (the notes hub: diary, important notes, HB counters, homebrew)
		const tabBtn = (k, l) => h("button", {class: ui.featTab === k ? "active" : "", on: {click: () => { ui.featTab = k; render(root, char); }}}, l);
		const tabs = h("div.hfeat-tabs.grow", tabBtn("features", "Features & traits"), tabBtn("notes", "Notes"));
		const sessionBookId = char.play && char.play.notesBookId && TBStore.book(char.play.notesBookId) ? char.play.notesBookId : null;
		const homebrewCard = () => {
			const list = (char.homebrew || []).filter(x => x && x.name);
			const add = () => TBNotes.homebrewModal({
				note: "Added to the character right away: items go into the equipment, feats, traits, actions and proficiencies show on the sheet.",
				onAdd: (hb, {qty}) => {
					if (hb.type === "item") ((char.equipment ||= {items: []}).items ||= []).push({name: hb.name, source: "", qty, custom: true, homebrew: true, desc: hb.desc, hbId: hb.id});
					(char.homebrew ||= []).push(hb);
					TBApp.charChanged(char);
					render(root, char);
				},
			});
			const remove = async (x) => {
				if (!(await TBUI.confirm("Remove homebrew", `Remove “${x.name}” from ${char.name || "the character"}?`, {okLabel: "Remove", danger: true}))) return;
				char.homebrew = (char.homebrew || []).filter(y => y.id !== x.id);
				TBApp.charChanged(char);
				render(root, char);
			};
			return h("div.card.pl-card", h("div.card-h", h("h3", "Homebrew"), h("span.muted", ` · ${list.length}`), h("div.spacer"), h("button.btn.small.primary", {on: {click: add}}, "+ Add homebrew")),
				h("div.card-b", ...(list.length ? list.map(x => {
					const id = `hb:${x.id}`;
					const el = h("div.hfeat");
					const fill = (open) => {
						el.querySelector(".hfeat-b")?.remove();
						el.classList.toggle("open", open);
						if (open) { const b = h("div.hfeat-b"); b.innerHTML = x.desc ? TBNotes.textToHtml(x.desc) : "<p><i>No description.</i></p>"; el.appendChild(b); }
					};
					el.appendChild(h("div.hfeat-h", {on: {click: (e) => { if (e.target.closest("button")) return; const open = !ui.expanded.has(id); open ? ui.expanded.add(id) : ui.expanded.delete(id); fill(open); }}},
						h("span.kindtag.homebrew", TBNotes.HB_LABEL[x.type] || x.type), h("span.grow", h("b", x.name)),
						h("button.btn.ghost.small", {title: "Remove", on: {click: () => remove(x)}}, "✕")));
					fill(ui.expanded.has(id));
					return el;
				}) : [h("div.pick-empty", "Your own items, feats, traits, actions and proficiencies.")])));
		};
		const features = ui.featTab === "notes"
			? h("div.hcard.hfeatures.hnotes-hub", h("div.row", tabs), TBNotes.hub(char, {
				sessionBook: sessionBookId ? () => TBStore.book(sessionBookId) : null,
				openBook: (id) => TBApp.openBook(id),
				onCounters: () => render(root, char),
				extras: () => [homebrewCard()],
			}))
			: h("div.hcard.hfeatures", h("div.row", tabs, filterBar), featList);
		// endregion

		// region Proficiencies & inventory
		const line = (k, v) => v && v.length ? h("div.hprof", h("b", `${k}: `), Array.isArray(v) ? v.join(", ") : v) : null;
		const profs = h("div.hcard", h("h3", "Proficiencies"),
			line("Armor", d.armorProf), line("Weapons", d.weaponProf), line("Weapon mastery", d.masteries), line("Tools", d.tools),
			line("Languages", d.languages), line("Resistances", d.resist), d.darkvision ? line("Senses", `Darkvision ${d.darkvision} ft.`) : null,
		);
		const inv = h("div.hcard", h("h3", "Equipment"),
			h("div.hprof", h("b", "Coins: "), `${(d.cp / 100).toFixed(2).replace(/\.00$/, "")} GP`),
			...d.items.map(i => h("div.hprof", `${i.qty > 1 ? i.qty + " × " : ""}${i.name}`, i.equipped ? h("span.acttag", {style: {marginLeft: "6px"}}, "equipped") : null)),
		);
		// endregion


		const page = h("div.hero",
			header,
			h("div.hstats", abil, tiles),
			TBNotes.countersCard(char, {onChange: () => render(root, char), empty: false}),
			h("div.hgrid",
				h("div.hcolA", skills, profs, inv),
				h("div.hcolB", attacks, spells, features),
			),
		);
		root.appendChild(page);
		page.scrollTop = prevScroll;
	};

	return {render};
})();
