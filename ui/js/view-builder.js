"use strict";

/**
 * Hero builder, modelled on Forgesteel's: a strip of steps with their state, an option grid to pick from,
 * then the chosen option on the left and every decision it asks for on the right, grouped by level.
 */
globalThis.TBViewBuilder = (() => {
	const {h, clear} = TBUI;
	const D = () => TBData;
	const R = () => TBRules;
	const lc = (s) => String(s ?? "").toLowerCase();
	const ui = {step: null, search: "", classIx: 0, charId: null, open: {}};

	// Same-named entries list the core 2024 book first
	const CORE = ["XPHB", "XDMG", "XMM"];
	const coreFirst = (a, b) => a.name.localeCompare(b.name) || ((CORE.includes(b.source) ? 1 : 0) - (CORE.includes(a.source) ? 1 : 0));

	const STATE_CLASS = {"Completed": "ok", "In progress": "warn", "Not started": "todo", "Optional": "opt"};

	// region Shared bits
	const panel = (title, body, {actions = null, cls = ""} = {}) => h("div.bpanel", {class: cls},
		title ? h("div.bpanel-h", h("h3", title), h("div.spacer"), actions) : null,
		h("div.bpanel-b", body),
	);

	const statusIcon = (c) => c.complete ? h("span.st.ok", {title: "Done"}, "✓") : h("span.st.warn", {title: "Needs a choice"}, "!");

	const optionCard = (ent, {title, subtitle, lines = [], onPick}) => h("div.ocard", {on: {click: onPick}},
		h("div.ocard-h", h("span.ocard-t", title || ent.name), h("span.src", D().sourceShort(ent.source))),
		subtitle ? h("div.ocard-s", subtitle) : null,
		...lines.map(l => h("div.ocard-l", l)),
	);

	const searchBar = (onInput, placeholder) => {
		const i = h("input", {type: "search", placeholder, value: ui.search});
		i.addEventListener("input", TBUI.debounce(() => { ui.search = i.value; onInput(); }, 150));
		return i;
	};
	// endregion

	// region Choice controls
	const renderChoice = (char, c, ctx) => {
		const set = (v) => { char.choices[c.id] = v; ctx.changed(); };
		const card = h("div.choice", {class: c.complete ? "done" : ""},
			h("div.choice-h", statusIcon(c), h("span.choice-t", c.title), c.count > 1 && c.type !== "ability" ? h("span.choice-n", `${(c.value || []).length}/${c.count}`) : null),
			c.desc ? h("div.choice-d", c.desc) : null,
		);
		const body = h("div.choice-b");
		card.appendChild(body);

		switch (c.type) {
			case "pick": {
				const chosen = new Set(c.value || []);
				const toggle = (v) => {
					const cur = [...(c.value || [])];
					const ix = cur.indexOf(v);
					if (ix >= 0) cur.splice(ix, 1);
					else {
						if (c.count === 1) cur.length = 0;
						else if (cur.length >= c.count) { TBUI.toast(`You can choose ${c.count}. Remove one first.`); return; }
						cur.push(v);
					}
					set(cur);
				};
				if ((c.options || []).length <= 30) {
					const wrap = h("div.taglist");
					(c.options || []).forEach(o => wrap.appendChild(h("span.chip", {class: chosen.has(o.value) ? "on" : "", title: o.info || "", on: {click: () => toggle(o.value)}}, o.label, o.info ? h("span.muted", {style: {fontSize: "11px", marginLeft: "4px"}}, o.info) : null)));
					if (!(c.options || []).length) wrap.appendChild(h("span.muted", "Nothing available yet (choose proficiencies first)."));
					body.appendChild(wrap);
				} else {
					const tags = h("div.taglist");
					(c.value || []).forEach(v => {
						const o = c.options.find(x => x.value === v);
						tags.appendChild(h("span.tag", o ? o.label : v, h("span.x", {on: {click: () => toggle(v)}}, "✕")));
					});
					const sel = h("select", h("option", {value: ""}, "Add…"), ...c.options.filter(o => !chosen.has(o.value)).map(o => h("option", {value: o.value}, `${o.label}${o.info ? ` (${o.info})` : ""}`)));
					sel.addEventListener("change", () => { if (sel.value) toggle(sel.value); });
					body.appendChild(tags);
					if ((c.value || []).length < c.count) body.appendChild(sel);
				}
				break;
			}
			case "ability": {
				const v = {...(c.value || {})};
				const from = c.rule.from || R().ABILS;
				const max = Math.max(...c.rule.patterns.flat());
				const grid = h("div.abil-pick");
				from.forEach(a => {
					const n = v[a] || 0;
					grid.appendChild(h("div.abil-cell",
						h("div.abil-name", R().ABIL_NAMES[a].slice(0, 3).toUpperCase()),
						h("div.row", {style: {justifyContent: "center", gap: "4px"}},
							h("button.btn.small.icon", {disabled: n <= 0, on: {click: () => { v[a] = n - 1; set(v); }}}, "−"),
							h("span.abil-val", n ? `+${n}` : "0"),
							h("button.btn.small.icon", {disabled: n >= max || (ctx.A && ctx.A.derived.scores[a] >= 20), title: ctx.A && ctx.A.derived.scores[a] >= 20 ? "Already 20" : "", on: {click: () => { v[a] = n + 1; set(v); }}}, "+"),
						),
					));
				});
				body.appendChild(grid);
				if (!c.complete) body.appendChild(h("div.muted", {style: {fontSize: "12.5px", marginTop: "4px"}}, `Allowed: ${c.rule.patterns.map(p => p.map(x => `+${x}`).join(" / ")).join(" or ")}`));
				break;
			}
			case "feat":
			case "optfeature":
			case "spells": {
				const tags = h("div.taglist");
				(c.value || []).forEach((r, ix) => tags.appendChild(h("span.tag", r.name, h("span.src", D().sourceShort(r.source)), h("span.x", {on: {click: () => { const cur = [...c.value]; cur.splice(ix, 1); set(cur); }}}, "✕"))));
				body.appendChild(tags);
				if ((c.value || []).length < c.count) body.appendChild(h("button.btn.small.primary", {style: {marginTop: "6px"}, on: {click: () => openChoicePicker(char, c, ctx)}}, c.type === "feat" ? "Choose feat…" : c.type === "spells" ? `Choose ${c.count - (c.value || []).length} more…` : `Choose ${c.count - (c.value || []).length} more…`));
				break;
			}
			case "subclass": {
				const list = h("div.sc-list");
				c.options.forEach(o => {
					const on = (c.value || []).includes(o.value);
					list.appendChild(h("div.sc-opt", {class: on ? "on" : "", on: {click: async () => {
						const cref = char.classes[c.classIndex];
						if (on) cref.subclass = null;
						else {
							const [shortName, source] = o.value.split("|");
							const cls = await D().getClass(cref.name, cref.source);
							const sc = await D().getSubclass(cls, shortName, source);
							cref.subclass = {shortName, source, name: sc ? sc.name : shortName};
						}
						ctx.changed();
					}}}, h("span.radio", on ? "◉" : "○"), h("span.grow", o.label), h("span.src", o.info)));
				});
				body.appendChild(list);
				break;
			}
			case "equipment": {
				c.options.forEach(o => {
					const on = (c.value || [])[0] === o.value;
					body.appendChild(h("label.eq-opt", {class: on ? "on" : ""},
						h("input", {type: "radio", name: c.id, checked: on, on: {change: () => applyEquipment(char, c, o, ctx)}}),
						h("div", h("b", o.label), h("div.muted", {style: {fontSize: "13px"}}, R().describeEquipment(o.items))),
					));
				});
				break;
			}
		}
		return card;
	};

	const applyEquipment = async (char, c, opt, ctx) => {
		const eq = char.equipment;
		// Swap out whatever this choice added before
		eq.items = (eq.items || []).filter(i => i.from !== c.id);
		eq.cp = (eq.cp || 0) - ((eq.startingApplied || {})[c.id]?.cp || 0);
		const {items, cp} = await R().equipmentFrom(opt.items);
		items.forEach(i => { i.from = c.id; eq.items.push(i); });
		eq.cp += cp;
		eq.startingApplied = {...(eq.startingApplied || {}), [c.id]: {option: opt.value, cp}};
		char.choices[c.id] = [opt.value];
		ctx.changed();
	};

	const openChoicePicker = async (char, c, ctx) => {
		const remaining = () => c.count - (char.choices[c.id] || []).length;
		const pushPick = (e) => {
			const cur = [...(char.choices[c.id] || [])];
			if (cur.some(r => R().same(r, e))) return false;
			if (cur.length >= c.count) { TBUI.toast("That choice is full."); return false; }
			cur.push({name: e.name, source: e.source});
			char.choices[c.id] = cur;
			TBStore.changed("char");
		};
		const P = ctx.A.prereq;
		const mine = (char.choices[c.id] || []);
		const isMine = (e) => mine.some(r => R().same(r, e));
		const prereqInfo = (e) => {
			if (!e.prerequisite) return "";
			const r = R().meetsPrereq(e, P);
			return r.unverified ? "check prerequisite" : "prerequisite met";
		};
		if (c.type === "feat") {
			const feats = await D().loadFeats();
			const taken = ctx.A.derived.feats.map(f => f.ent);
			const inCategory = feats.filter(f => (c.categories || []).some(cat => f.category === cat || (cat.startsWith("FS") && f.category === "FS")));
			// Qualifying feats only; a feat you already have is offered again only if it is repeatable
			const allowed = inCategory.filter(f => R().meetsPrereq(f, P).ok && (f.repeatable || isMine(f) || !taken.some(t => R().same(t, f))));
			return TBPickers.open({
				title: c.title,
				prop: "feat",
				load: async () => allowed,
				info: prereqInfo,
				note: `${inCategory.length - allowed.length} hidden: prerequisites not met or already taken.`,
				onPick: (e) => { pushPick(e); },
				onClose: () => ctx.changed(),
			});
		}
		if (c.type === "optfeature") {
			const ofs = await D().loadOptFeatures();
			const taken = ctx.A.derived.optfeatures.map(o => o.ent);
			const ofType = ofs.filter(o => (o.featureType || []).some(t => (c.featureTypes || []).includes(t)));
			const allowed = ofType.filter(o => R().meetsPrereq(o, P).ok && (o.repeatable || isMine(o) || !taken.some(t => R().same(t, o))));
			return TBPickers.open({
				title: c.title,
				prop: "optionalfeature",
				multi: c.count > 1,
				load: async () => allowed,
				note: `${ofType.length - allowed.length} hidden: prerequisites not met or already chosen.`,
				info: prereqInfo,
				isChosen: (e) => (char.choices[c.id] || []).some(r => R().same(r, e)),
				onPick: (e) => { pushPick(e); if (remaining() <= 0 && c.count > 1) TBUI.toast("All chosen."); },
				onClose: () => ctx.changed(),
			});
		}
		if (c.type === "spells") {
			const spells = await D().loadSpells();
			const levels = [...new Set(spells.filter(s => R().spellMatches(s, c.filter)).map(s => s.level))].sort((a, b) => a - b);
			return TBPickers.open({
				title: `${c.title} (${c.count})`,
				prop: "spell",
				multi: c.count > 1,
				load: async () => spells.filter(s => R().spellMatches(s, c.filter)),
				info: (e) => `${e.level === 0 ? "Cantrip" : "Lv " + e.level} · ${(() => { try { return Parser.spSchoolAbvToFull(e.school); } catch (x) { return e.school; } })()}`,
				chipGroups: levels.length > 1 ? [{label: "Level", chips: levels.map(l => ({label: l === 0 ? "Cantrip" : String(l), test: e => e.level === l}))}] : [],
				isChosen: (e) => (char.choices[c.id] || []).some(r => R().same(r, e)),
				onPick: (e) => { pushPick(e); if (remaining() <= 0 && c.count > 1) TBUI.toast("All chosen."); },
				onClose: () => ctx.changed(),
			});
		}
	};

	/** Choices grouped into collapsible sections (open while incomplete). */
	const choicesColumn = (char, choices, ctx, {title = "Choices", empty = "Nothing to choose here."} = {}) => {
		const col = h("div.bcol.choices-col", h("div.bcol-title", title));
		if (!choices.length) { col.appendChild(h("div.empty-small", empty)); return col; }
		const groups = [];
		choices.forEach(c => {
			let g = groups.find(x => x.name === c.group);
			if (!g) groups.push(g = {name: c.group, level: c.level || 0, items: []});
			g.items.push(c);
		});
		groups.sort((a, b) => (a.level || 0) - (b.level || 0));
		groups.forEach(g => {
			const done = g.items.every(c => c.complete);
			const key = `${char.id}:${g.name}`;
			const open = ui.open[key] ?? !done;
			const sec = h("div.cgroup", {class: open ? "open" : ""},
				h("div.cgroup-h", {on: {click: () => { ui.open[key] = !open; ctx.rerender(); }}},
					h("span.caret", open ? "▾" : "▸"), h("span.grow", g.name),
					done ? h("span.st.ok", "✓") : h("span.st.warn", `${g.items.filter(c => !c.complete).length} to choose`),
				),
			);
			if (open) {
				const b = h("div.cgroup-b");
				g.items.forEach(c => b.appendChild(renderChoice(char, c, ctx)));
				sec.appendChild(b);
			}
			col.appendChild(sec);
		});
		return col;
	};
	// endregion

	// region Steps
	const stepStart = (root, char, A, ctx) => {
		const nameIn = h("input", {type: "text", value: ["New Hero", "New Character"].includes(char.name) ? "" : (char.name || ""), placeholder: "Character name"});
		nameIn.addEventListener("change", () => { char.name = nameIn.value || "New Character"; ctx.changed(); });
		const playerIn = h("input", {type: "text", value: char.player || "", placeholder: "Player"});
		playerIn.addEventListener("change", () => { char.player = playerIn.value; ctx.changed(); });
		const legacy = h("input", {type: "checkbox", checked: !!char.legacy});
		legacy.addEventListener("change", () => { char.legacy = legacy.checked; ctx.changed(); });
		const stepsInfo = [
			["Species", "Your ancestry: traits, size, lineage."],
			["Background", "Ability score increases, an origin feat, skills, tools."],
			["Class", "Level, subclass, feats, weapon masteries, invocations and every choice by level. Multiclass here too."],
			["Abilities", "Standard array, point buy or rolled scores."],
			["Spells", "Cantrips and prepared spells for each class, plus spells from feats and species."],
			["Equipment", "Starting packages, inventory, armor and weapons you wield."],
			["Details", "Languages, alignment, personality, backstory and portrait."],
		];
		root.appendChild(h("div.bstart",
			panel("New character", h("div",
				h("label.field", h("span", "Name"), nameIn),
				h("label.field", h("span", "Player"), playerIn),
				h("label.chk", {style: {display: "flex", margin: "6px 0 12px"}}, legacy, "Allow legacy (2014) and older content"),
				h("button.btn.primary", {on: {click: () => ctx.go("species")}}, "Begin: choose a species →"),
			)),
			(char.classes || []).length ? panel("Level", h("div",
				h("div", {style: {marginBottom: "8px"}}, TBLevel.xpBar(char, () => ctx.changed())),
				h("p.dim", {style: {marginTop: 0}}, "Levelling up normally needs the XP. Force level up skips that check, for testing a build; the character as it is now is remembered so you can go back."),
				h("div.row", {style: {flexWrap: "wrap"}},
					h("button.btn", {on: {click: () => TBLevel.levelUp(char, {force: true})}}, "⚡ Force level up"),
					char.forced ? h("button.btn", {on: {click: () => TBLevel.revertForced(char)}}, `↶ Revert to level ${char.forced.fromLevel}${char.forced.xp != null ? ` (${Number(char.forced.xp).toLocaleString("en-US")} XP)` : ""}`) : null,
					char.forced ? h("button.btn.ghost", {on: {click: () => TBLevel.keepForced(char)}}, "Keep the new level") : null,
				),
			)) : null,
			panel("How it works", h("div",
				h("p.dim", {style: {marginTop: 0}}, "Work through the steps along the top in any order. Each step shows what is still missing; a step is complete when every choice in it is made."),
				h("ol.steps-help", ...stepsInfo.map(([t, d]) => h("li", h("b", t), " — ", d))),
				h("p.dim", "When you level up, raise the level in the Class step: new choices appear in their own “Level N” group."),
			)),
		));
	};

	const entityStep = (root, char, A, ctx, kind) => {
		const conf = {
			species: {
				ref: char.species,
				title: "Species",
				load: () => R().baseSpecies(),
				prop: "race",
				lines: (e) => [[e.size ? e.size.map(s => Parser.sizeAbvToFull(s)).join(" or ") : "", e.speed ? `Speed ${typeof e.speed === "number" ? e.speed : e.speed.walk} ft.` : "", e.darkvision ? `Darkvision ${e.darkvision} ft.` : ""].filter(Boolean).join(" · "), (e.entries || []).filter(x => x && x.name).map(x => x.name).slice(0, 5).join(", ")],
				set: (e) => { char.species = e ? {name: e.name, source: e.source} : null; Object.keys(char.choices).filter(k => k.startsWith("species:")).forEach(k => delete char.choices[k]); },
				ent: () => A.derived.speciesEnt,
			},
			background: {
				ref: char.background,
				title: "Background",
				load: () => D().loadBackgrounds(),
				prop: "background",
				lines: (e) => {
					const list = (e.entries || []).find(x => x.type === "list");
					if (!list) return [];
					return list.items.filter(i => /Ability|Feat|Skill/.test(i.name || "")).map(i => `${i.name} ${D().strip(typeof i.entry === "string" ? i.entry : "")}`);
				},
				set: (e) => { char.background = e ? {name: e.name, source: e.source} : null; Object.keys(char.choices).filter(k => k.startsWith("bg:")).forEach(k => delete char.choices[k]); },
				ent: () => A.derived.backgroundEnt,
			},
		}[kind];

		if (!conf.ref) {
			const grid = h("div.ogrid");
			const head = h("div.bhead", h("h2", `Choose a ${conf.title.toLowerCase()}`), h("div.spacer"), searchBar(() => fill(), `Search ${conf.title.toLowerCase()}…`));
			const fill = async () => {
				clear(grid);
				const all = (await conf.load()).filter(e => (char.legacy || D().isModern(e.source)) && (!ui.search || lc(e.name).includes(lc(ui.search))));
				all.sort(coreFirst).forEach(e => grid.appendChild(optionCard(e, {lines: conf.lines(e), onPick: () => { conf.set(e); ui.search = ""; ctx.changed(); }})));
				if (!all.length) grid.appendChild(h("div.empty-small", "Nothing matches."));
			};
			fill();
			root.appendChild(h("div.bstep-pick", head, grid));
			return;
		}
		const ent = conf.ent();
		const frame = TBUI.fragFrame();
		if (ent) frame.setContent(TBSan.clean(D().renderEntity(conf.prop, ent)));
		root.appendChild(h("div.bsplit",
			h("div.bcol.detail-col",
				h("div.bcol-title", conf.title, h("div.spacer"), h("button.btn.small", {on: {click: () => { conf.set(null); ctx.changed(); }}}, "Change")),
				h("div.detail-frame", frame),
			),
			choicesColumn(char, A.choices.filter(c => c.step === kind), ctx),
		));
	};

	const stepClass = async (root, char, A, ctx) => {
		if (!char.classes.length) {
			const grid = h("div.ogrid");
			const head = h("div.bhead", h("h2", "Choose a class"), h("div.spacer"), searchBar(() => fill(), "Search classes…"));
			const fill = async () => {
				clear(grid);
				const all = (await D().loadClasses()).classes.filter(e => (char.legacy || D().isModern(e.source)) && (!ui.search || lc(e.name).includes(lc(ui.search))));
				all.sort(coreFirst).forEach(e => {
					const core = D().getClassCore(e);
					grid.appendChild(optionCard(e, {subtitle: `Hit Die ${core.hd} · ${core.primary}`, lines: [`Saves: ${core.saves}`, core.spellAbility ? `Spellcasting (${core.spellAbility})` : (core.armor ? `Armor: ${core.armor}` : "")], onPick: () => { char.classes.push({name: e.name, source: e.source, level: 1, subclass: null}); ui.classIx = 0; ui.search = ""; ctx.changed(); }}));
				});
			};
			fill();
			root.appendChild(h("div.bstep-pick", head, grid));
			return;
		}
		ui.classIx = Math.min(ui.classIx, char.classes.length - 1);
		const cref = char.classes[ui.classIx];
		const dc = A.derived.classes[ui.classIx];
		const total = R().totalLevel(char);

		const currentEnts = A.derived.classes.map(c => c.ent);
		const allClasses = (await D().loadClasses()).classes.filter(x => !char.classes.some(c => R().same(c, x)) && (char.legacy || D().isModern(x.source)));
		const mcAllowed = allClasses.filter(x => R().multiclassCheck(x, currentEnts, A.derived.scores).ok);
		const blocked = currentEnts.length ? R().multiclassCheck(currentEnts[0], currentEnts, A.derived.scores) : {ok: true};
		const addMulticlass = async () => {
			if (!blocked.ok) { TBUI.toast(`Can't multiclass yet: ${blocked.reason.toLowerCase()} (set your ability scores first).`, {error: true}); return; }
			if (!mcAllowed.length) { TBUI.toast("No class qualifies: multiclassing needs 13+ in the new class's primary ability.", {error: true}); return; }
			return addMulticlassPicker();
		};
		const addMulticlassPicker = async () => TBPickers.open({
			title: "Multiclass: add a class",
			prop: "class",
			note: `${allClasses.length - mcAllowed.length} hidden: multiclassing needs 13+ in the primary ability.`,
			load: async () => mcAllowed,
			renderPreview: (cls) => {
				const core = D().getClassCore(cls);
				return `<h1 class="ve-rd__h ve-rd__h--0">${TBBook.esc(cls.name)}</h1><table class="tb-kv"><tr><th>Prerequisite</th><td>${TBBook.esc(core.multiclassReq || `${core.primary} 13+`)}</td></tr><tr><th>You gain</th><td>${TBBook.esc(core.multiclassGains || "—")}</td></tr><tr><th>Hit Die</th><td>${TBBook.esc(core.hd)}</td></tr></table>`;
			},
			onPick: (e) => { char.classes.push({name: e.name, source: e.source, level: 1, subclass: null}); ui.classIx = char.classes.length - 1; ctx.changed(); },
		});

		const tabs = h("div.cls-tabs",
			...char.classes.map((c, i) => h("button.cls-tab", {class: i === ui.classIx ? "on" : "", on: {click: () => { ui.classIx = i; ctx.rerender(); }}}, `${c.name} ${c.level}`, c.subclass ? h("span.muted", ` · ${c.subclass.name}`) : null)),
			h("button.btn.small", {disabled: total >= 20, on: {click: addMulticlass}}, "+ Multiclass"),
			h("div.spacer"),
			h("span.muted", `Character level ${total}`),
		);

		const lvl = h("div.level-spin",
			h("button.btn.icon", {disabled: cref.level <= 1, on: {click: () => { cref.level--; ctx.changed(); }}}, "−"),
			h("span.lv", String(cref.level)),
			h("button.btn.icon", {disabled: cref.level >= 20 || total >= 20, on: {click: () => { cref.level++; ui.open[`${char.id}:${cref.name} · Level ${cref.level}`] = true; ctx.changed(); TBUI.toast(`${cref.name} level ${cref.level}. New choices are in “Level ${cref.level}”.`); }}}, "+"),
		);
		const frame = TBUI.fragFrame();
		if (dc) {
			const feats = dc.features.filter(f => f.level <= cref.level && !/Options$/.test(f.name));
			const nxt = dc.features.filter(f => f.level === cref.level + 1);
			frame.setContent(TBSan.clean(`
				<h1 class="ve-rd__h ve-rd__h--0">${TBBook.esc(dc.name)}${dc.subclass ? ` <span class="tb-dim" style="font-size:.6em">${TBBook.esc(dc.subclass)}</span>` : ""}</h1>
				<table class="tb-kv">
					<tr><th>Hit Die</th><td>${TBBook.esc(dc.core.hd)}</td></tr>
					<tr><th>Primary Ability</th><td>${TBBook.esc(dc.core.primary)}</td></tr>
					<tr><th>Saving Throws</th><td>${TBBook.esc(dc.core.saves)}</td></tr>
					<tr><th>Armor / Weapons</th><td>${TBBook.esc([dc.core.armor, dc.core.weapons].filter(Boolean).join("; "))}</td></tr>
				</table>
				${nxt.length ? `<p><b>Next level (${cref.level + 1}):</b> ${nxt.map(f => TBBook.esc(f.name)).join(", ")}</p>` : ""}
				${feats.map(f => `<div class="tb-feature-meta">Level ${f.level}${f.isSubclass ? " · Subclass" : ""}</div>` + D().renderFeature(f)).join("")}
			`));
		}
		const ck = TBRules.refKey(cref);
		const mine = A.choices.filter(c => c.step === "class" && (c.id.startsWith(`class:${ck}:`) || (c.group || "").startsWith(cref.name)));
		root.appendChild(h("div.bclass", tabs, h("div.bsplit",
			h("div.bcol.detail-col",
				h("div.bcol-title", `${cref.name} level`, lvl, h("div.spacer"),
					h("button.btn.small.danger", {on: {click: async () => {
						if (!(await TBUI.confirm("Remove class", `Remove ${cref.name} and its choices?`, {okLabel: "Remove", danger: true}))) return;
						char.classes.splice(ui.classIx, 1);
						Object.keys(char.choices).filter(k => k.startsWith(`class:${ck}:`)).forEach(k => delete char.choices[k]);
						ui.classIx = 0;
						ctx.changed();
					}}}, "Remove")),
				h("div.detail-frame", frame),
			),
			choicesColumn(char, mine, ctx, {title: `${cref.name} choices`}),
		)));
	};

	const stepAbilities = (root, char, A, ctx) => {
		const ab = char.abilities;
		const method = ab.method || "standard";
		ab.base = ab.base || {};
		const setMethod = (m) => {
			ab.method = m;
			ab.base = m === "pointbuy" ? Object.fromEntries(R().ABILS.map(a => [a, 8])) : {};
			ctx.changed();
		};
		const methods = h("div.row", {style: {gap: "6px", marginBottom: "12px"}},
			...[["standard", "Standard array"], ["pointbuy", "Point buy"], ["manual", "Rolled / manual"]].map(([m, l]) => h("button.btn", {class: method === m ? "on" : "", on: {click: () => setMethod(m)}}, l)));
		const d = A.derived;
		const bonusOf = (a) => d.scores[a] - d.base[a];
		const used = R().ABILS.map(a => Number(ab.base[a])).filter(Boolean);
		const spent = R().ABILS.reduce((s, a) => s + (R().POINT_COST[ab.base[a] || 8] ?? 0), 0);
		const rows = R().ABILS.map(a => {
			let ctl;
			if (method === "standard") {
				ctl = h("select", h("option", {value: ""}, "—"), ...R().STANDARD_ARRAY.map(v => {
					const taken = used.filter(x => x === v).length >= R().STANDARD_ARRAY.filter(x => x === v).length && Number(ab.base[a]) !== v;
					return h("option", {value: v, selected: Number(ab.base[a]) === v, disabled: taken}, String(v));
				}));
				ctl.addEventListener("change", () => { ab.base[a] = Number(ctl.value) || undefined; ctx.changed(); });
			} else if (method === "pointbuy") {
				const v = Number(ab.base[a]) || 8;
				ctl = h("div.row", {style: {gap: "4px"}},
					h("button.btn.small.icon", {disabled: v <= 8, on: {click: () => { ab.base[a] = v - 1; ctx.changed(); }}}, "−"),
					h("span.abil-val", String(v)),
					h("button.btn.small.icon", {disabled: v >= 15 || spent + (R().POINT_COST[v + 1] - R().POINT_COST[v]) > R().POINT_BUDGET, on: {click: () => { ab.base[a] = v + 1; ctx.changed(); }}}, "+"),
				);
			} else {
				ctl = h("div.row", {style: {gap: "4px"}},
					h("input", {type: "number", min: 3, max: 20, value: ab.base[a] || "", style: {width: "64px"}, on: {change: (e) => { ab.base[a] = Number(e.target.value) || undefined; ctx.changed(); }}}),
					h("button.btn.small", {title: "Roll 4d6, drop the lowest", on: {click: () => { const r = [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6)).sort((x, y) => x - y).slice(1).reduce((x, y) => x + y, 0); ab.base[a] = r; ctx.changed(); TBUI.toast(`${R().ABIL_NAMES[a]}: rolled ${r}`); }}}, "🎲"),
				);
			}
			const b = bonusOf(a);
			return h("tr",
				h("th", R().ABIL_NAMES[a]),
				h("td", ctl),
				h("td.c", b ? `+${b}` : "—"),
				h("td.c.big", String(d.scores[a])),
				h("td.c.big", R().signed(d.mods[a])),
			);
		});
		const abilityChoices = A.choices.filter(c => c.type === "ability");
		root.appendChild(h("div.bsplit",
			h("div.bcol",
				h("div.bcol-title", "Ability scores"),
				panel(null, h("div",
					methods,
					method === "pointbuy" ? h("div.dim", {style: {marginBottom: "8px"}}, `Points spent: ${spent} / ${R().POINT_BUDGET}`) : null,
					method === "standard" ? h("div.dim", {style: {marginBottom: "8px"}}, "Assign 15, 14, 13, 12, 10 and 8, one to each ability.") : null,
					h("table.abil-table", h("thead", h("tr", h("th", "Ability"), h("th", "Base"), h("th.c", "Bonus"), h("th.c", "Score"), h("th.c", "Mod"))), h("tbody", ...rows)),
					h("div.muted", {style: {fontSize: "12.5px", marginTop: "8px"}}, "Bonuses come from your background and feats (ability scores cap at 20)."),
				)),
			),
			choicesColumn(char, abilityChoices, ctx, {title: "Ability increases", empty: "Choose a background to get its ability increases."}),
		));
	};

	const stepSpells = (root, char, A, ctx) => {
		const spellChoices = A.choices.filter(c => c.type === "spells" || (c.step === "spells"));
		const list = h("div.spell-groups");
		const byLvl = {};
		A.derived.spells.forEach(s => { (byLvl[s.ent.level] = byLvl[s.ent.level] || []).push(s); });
		Object.keys(byLvl).sort((a, b) => a - b).forEach(l => {
			list.appendChild(h("div.lvl", l === "0" ? "Cantrips" : `Level ${l}`));
			list.appendChild(h("div.taglist", ...byLvl[l].map(s => h("span.tag", {title: s.via}, s.ent.name, h("span.muted", {style: {fontSize: "11px", marginLeft: "4px"}}, s.via), s.via === "Extra" ? h("span.x", {on: {click: () => { char.spells = (char.spells || []).filter(r => !R().same(r, s.ent)); ctx.changed(); }}}, "✕") : h("span", {style: {width: "6px"}})))));
		});
		if (!A.derived.spells.length) list.appendChild(h("div.empty-small", "No spells yet."));
		const casting = A.derived.casting.map(c => h("div.cast-line", h("b", c.cls), ` · ${c.abilityName} · save DC ${c.dc} · attack ${R().signed(c.attack)}`, c.pact ? ` · Pact slots ${c.pact.slots} × level ${c.pact.level}` : ""));
		const slots = A.derived.slots.length ? h("div.cast-line", h("b", "Spell slots: "), A.derived.slots.map((n, i) => `L${i + 1} × ${n}`).join("   ")) : null;
		const addExtra = async () => {
			const spells = await D().loadSpells();
			TBPickers.open({
				title: "Add extra spells (scrolls, items, DM grants…)",
				prop: "spell",
				multi: true,
				load: async () => spells,
				info: (e) => `${e.level === 0 ? "Cantrip" : "Lv " + e.level}`,
				isChosen: (e) => (char.spells || []).some(r => R().same(r, e)),
				onPick: (e) => { char.spells = [...(char.spells || []), {name: e.name, source: e.source}]; TBStore.changed("char"); },
				onClose: () => ctx.changed(),
			});
		};
		root.appendChild(h("div.bsplit",
			h("div.bcol",
				h("div.bcol-title", "Your spells", h("div.spacer"), h("button.btn.small", {on: {click: addExtra}}, "+ Extra spells")),
				panel(null, h("div", ...casting, slots, h("hr.sep"), list)),
			),
			choicesColumn(char, spellChoices, ctx, {title: "Spell choices", empty: "No class or feat here grants spell choices."}),
		));
	};

	const stepEquipment = (root, char, A, ctx) => {
		const eq = char.equipment;
		const rows = (eq.items || []).map((it, ix) => {
			const kind = A.derived.items[ix]?.equipKind || null;
			return h("tr",
				h("td", it.name, it.source ? h("span.src", D().sourceShort(it.source)) : null),
				h("td.c", h("input", {type: "number", min: 0, value: it.qty || 1, style: {width: "56px"}, on: {change: (e) => { it.qty = Number(e.target.value) || 0; ctx.changed(); }}})),
				h("td.c", kind ? h("label.chk", h("input", {type: "checkbox", checked: !!it.equipped, on: {change: (e) => { it.equipped = e.target.checked; ctx.changed(); }}}), kind) : h("span.muted", "—")),
				h("td.c", h("button.btn.ghost.small", {on: {click: () => { eq.items.splice(ix, 1); ctx.changed(); }}}, "✕")),
			);
		});
		const addItem = async () => {
			const {all} = await R().loadItems();
			TBPickers.open({
				title: "Add items",
				prop: "item",
				multi: true,
				load: async () => all.filter(i => i.name),
				renderPreview: (e) => { try { return `<table class="ve-stats">${Renderer.item.getCompactRenderedString(e)}</table>`; } catch (x) { return `<h2>${TBBook.esc(e.name)}</h2>`; } },
				info: (e) => e.weapon ? "Weapon" : R().isArmorEnt(e) ? "Armor" : R().isShieldEnt(e) ? "Shield" : (e.rarity && e.rarity !== "none" ? e.rarity : ""),
				onPick: (e) => { eq.items.push({name: e.name, source: e.source, qty: 1, equipped: false}); TBStore.changed("char"); },
				onClose: () => ctx.changed(),
			});
		};
		const gp = h("input", {type: "number", min: 0, step: "0.01", value: ((eq.cp || 0) / 100).toFixed(2), style: {width: "110px"}});
		gp.addEventListener("change", () => { eq.cp = Math.round((Number(gp.value) || 0) * 100); ctx.changed(); });
		root.appendChild(h("div.bsplit",
			h("div.bcol",
				h("div.bcol-title", "Inventory", h("div.spacer"), h("button.btn.small", {on: {click: addItem}}, "+ Add items")),
				panel(null, h("div",
					h("div.row", {style: {marginBottom: "10px"}}, h("b", "Coins (GP)"), gp, h("span.muted", `AC ${A.derived.ac} (${A.derived.acNote})`)),
				A.derived.itemEffects.attuned ? h("div", {class: A.derived.itemEffects.attuned > 3 ? "warn-line" : "muted", style: {fontSize: "13px", marginBottom: "6px"}}, `Attuned to ${A.derived.itemEffects.attuned} of 3 items${A.derived.itemEffects.attuned > 3 ? ": only 3 can be attuned at once" : ""}.`) : null,
				A.derived.itemEffects.sources.length ? h("div.muted", {style: {fontSize: "13px", marginBottom: "8px"}}, `Equipped items grant: ${A.derived.itemEffects.sources.join("; ")}.`) : null,
					rows.length ? h("table.inv-table", h("thead", h("tr", h("th", "Item"), h("th.c", "Qty"), h("th.c", "Equipped"), h("th"))), h("tbody", ...rows)) : h("div.empty-small", "Pick a starting package on the right, or add items."),
				)),
			),
			choicesColumn(char, A.choices.filter(c => c.step === "equipment"), ctx, {title: "Starting equipment", empty: "Choose a class and a background for their starting packages."}),
		));
	};

	const stepDetails = (root, char, A, ctx) => {
		const d = char.details;
		const txt = (k, label, rows = 2, ph = "") => {
			const t = h("textarea", {rows, placeholder: ph});
			t.value = d[k] || "";
			t.addEventListener("change", () => { d[k] = t.value; ctx.changed(); });
			return h("label.field", h("span", label), t);
		};
		const align = h("select", h("option", {value: ""}, "—"), ...R().ALIGNMENTS.map(a => h("option", {value: a, selected: d.alignment === a}, a)));
		align.addEventListener("change", () => { d.alignment = align.value; ctx.changed(); });
		const portrait = h("div.portrait", {title: "Click to choose a portrait"}, char.portrait ? h("img", {src: char.portrait}) : "Portrait");
		const fileIn = h("input", {type: "file", accept: "image/*", style: {display: "none"}});
		portrait.addEventListener("click", () => fileIn.click());
		fileIn.addEventListener("change", async () => { if (fileIn.files[0]) { char.portrait = await TBUI.fileToDataUrl(fileIn.files[0]); ctx.changed(); } });
		const small = (k, label) => h("label.field", h("span", label), h("input", {type: "text", value: d[k] || "", on: {change: (e) => { d[k] = e.target.value; ctx.changed(); }}}));
		root.appendChild(h("div.bsplit",
			h("div.bcol",
				h("div.bcol-title", "Details"),
				panel(null, h("div",
					h("div.row", {style: {alignItems: "flex-start", gap: "14px"}}, portrait, fileIn,
						h("div.grow", h("label.field", h("span", "Alignment"), align), h("div.grid2", small("age", "Age"), small("height", "Height"), small("weight", "Weight"), small("eyes", "Eyes")))),
					txt("appearance", "Appearance", 2),
					txt("personality", "Personality traits", 2),
					h("div.grid2", txt("ideals", "Ideals", 2), txt("bonds", "Bonds", 2)),
					txt("flaws", "Flaws", 2),
					txt("backstory", "Backstory", 5),
					txt("notes", "Notes for the booklet", 3),
				)),
			),
			choicesColumn(char, A.choices.filter(c => c.step === "details"), ctx),
		));
	};
	// endregion

	const ancestorsOf = (el) => {
		const out = [];
		for (let p = el.parentElement; p; p = p.parentElement) out.push(p);
		out.push(document.scrollingElement || document.documentElement);
		return out;
	};

	const render = async (root, char, opts = {}) => {
		R().normalize(char);
		if (ui.charId !== char.id) { ui.charId = char.id; ui.step = null; ui.classIx = 0; ui.search = ""; }
		const A = await R().analyze(char);
		if (!ui.step) ui.step = !char.species ? "start" : (Object.entries(A.steps).find(([, s]) => s === "In progress" || s === "Not started")?.[0] || "class");
		// Remember where every scrolled area was (desktop: the choices column; phones: the whole step), keyed by
		// class name + position, plus the page itself, so a re-render after a choice leaves the view where it was
		const scrollKey = (el) => {
			const same = [...root.querySelectorAll(el.tagName + (el.className ? "." + [...el.classList].join(".") : ""))];
			return `${el.tagName}.${el.className}#${same.indexOf(el)}`;
		};
		const keepScroll = ui.lastStep === ui.step && ui.lastChar === char.id;
		// Vertical positions only while staying on the same step; horizontal ones (the step strip) always
		const scrolled = [...root.querySelectorAll("*")].filter(el => (keepScroll && el.scrollTop > 0) || el.scrollLeft > 0).map(el => [scrollKey(el), {top: keepScroll ? el.scrollTop : 0, left: el.scrollLeft}]);
		const scrolledOuter = keepScroll ? [root, ...ancestorsOf(root)].map(el => [el, el.scrollTop]).filter(([, t]) => t > 0) : [];
		ui.lastStep = ui.step;
		ui.lastChar = char.id;
		const ctx = {
			A,
			changed: () => { TBApp.charChanged(char); render(root, char, opts); },
			rerender: () => render(root, char, opts),
			go: (s) => { ui.step = s; ui.search = ""; render(root, char, opts); },
		};
		clear(root);
		const strip = h("div.bsteps",
			...R().STEPS.map(s => h("button.bstep", {class: `${ui.step === s.id ? "on" : ""} ${STATE_CLASS[A.steps[s.id]] || ""}`, on: {click: () => ctx.go(s.id)}},
				h("div.bstep-t", s.label),
				h("div.bstep-s", A.steps[s.id]),
			)),
			h("div.spacer"),
			h("button.btn.primary", {on: {click: () => TBApp.openCharTab("hero")}}, "View character →"),
		);
		const body = h("div.bbody");
		root.appendChild(h("div.builder", strip, body));
		switch (ui.step) {
			case "start": stepStart(body, char, A, ctx); break;
			case "species": entityStep(body, char, A, ctx, "species"); break;
			case "background": entityStep(body, char, A, ctx, "background"); break;
			case "class": await stepClass(body, char, A, ctx); break;
			case "abilities": stepAbilities(body, char, A, ctx); break;
			case "spells": stepSpells(body, char, A, ctx); break;
			case "equipment": stepEquipment(body, char, A, ctx); break;
			case "details": stepDetails(body, char, A, ctx); break;
		}
		const byKey = new Map(scrolled);
		root.querySelectorAll("*").forEach(el => {
			const t = byKey.get(scrollKey(el));
			if (!t) return;
			if (t.top) el.scrollTop = t.top;
			if (t.left) el.scrollLeft = t.left;
		});
		scrolledOuter.forEach(([el, t]) => { el.scrollTop = t; });
	};

	const goTo = (step) => { ui.step = step; };

	return {render, goTo, ui};
})();
