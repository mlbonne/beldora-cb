"use strict";

/**
 * The Notes hub, shared by the Play sheet and the character page:
 * - the current session's (or today's) notes, written like a chat: Enter sends a line, each line edits on its own;
 * - a GitHub-style calendar of every day with notes; a day opens below it (edit, close, add lines to Important notes);
 * - Important notes pinned on the character;
 * - HB Counters (homebrew counters) shown on the Play sheet and the character page too.
 *
 * Notes live in the same dated books as before (one per character per day, `notesOf` + `sessionDate`), so the
 * Books tab, wiki clipping and End session keep working. Each line is a top-level <p class="tbn-line"> of the
 * book's "Session notes" item; formatting is kept as classes (tbn-hl-*, tbn-c-*, tbn-sz-*), never inline styles.
 */
globalThis.TBNotes = (() => {
	const {h, clear} = TBUI;
	const esc = (s) => String(s ?? "").replace(/[&<>"]/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[ch]));
	const NOTE_KEY = "session-notes";
	const CLIP_KEY = "session-clips";
	const HB_KEY = "session-homebrew";

	// region Dates
	const pad = (n) => String(n).padStart(2, "0");
	const isoOf = (t) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
	const dayIso = () => isoOf(new Date());
	const dateOf = (iso) => new Date(`${iso}T12:00:00`);
	const dayLabel = (iso) => { try { return dateOf(iso).toLocaleDateString("en-US", {weekday: "short", day: "numeric", month: "long", year: "numeric"}); } catch (e) { return iso || ""; } };
	const shortLabel = (iso) => { try { return dateOf(iso).toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"}); } catch (e) { return iso || ""; } };
	// endregion

	// region Books and lines
	const booksOf = (c) => TBStore.get().books.filter(b => b.notesOf === c.id);
	const newDayBook = (c, iso) => {
		const b = {
			id: TBBook.uid(), ownerCharId: null, notesOf: c.id, sessionDate: iso,
			title: `${c.name || "Character"}: session notes`, subtitle: dayLabel(iso), kicker: "Session Notes", byline: "",
			chapters: [{id: TBBook.uid(), genKey: NOTE_KEY, title: "Notes", items: [{id: TBBook.uid(), kind: "note", title: "Session notes", html: ""}]}, {id: TBBook.uid(), genKey: CLIP_KEY, title: "From the wiki", items: []}],
			hidden: [], createdAt: Date.now(),
		};
		b.clipChapterId = b.chapters[1].id;
		TBStore.get().books.push(b);
		TBStore.changed("book");
		return b;
	};
	/** The notes book of a day (one per character per day; the oldest wins if old data has several). */
	const dayBook = (c, iso, {create = false} = {}) => {
		const found = booksOf(c).filter(b => b.sessionDate === iso).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
		return found || (create ? newDayBook(c, iso) : null);
	};
	const noteItemOf = (b) => {
		let ch = b.chapters.find(x => x.genKey === NOTE_KEY);
		if (!ch) { ch = {id: TBBook.uid(), genKey: NOTE_KEY, title: "Notes", items: []}; b.chapters.unshift(ch); }
		let it = ch.items.find(i => i.kind === "note");
		if (!it) { it = {id: TBBook.uid(), kind: "note", title: "Session notes", html: ""}; ch.items.unshift(it); }
		return it;
	};
	const textOf = (html) => { const d = document.createElement("div"); d.innerHTML = String(html || ""); return d.textContent || ""; };

	/** Only bold, italic, underline, line breaks and our own classes survive. */
	const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "BR", "SPAN", "MARK"]);
	const cleanLine = (html) => {
		const tpl = document.createElement("template");
		tpl.innerHTML = String(html || "");
		const walk = (node) => {
			[...node.childNodes].forEach(n => {
				if (n.nodeType === Node.TEXT_NODE) return;
				if (n.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) { n.remove(); return; }
				walk(n);
				if (!ALLOWED.has(n.tagName)) {
					// Blocks inside a line become line breaks; anything else keeps only its content
					const block = /^(DIV|P|LI|H\d)$/.test(n.tagName);
					const frag = document.createDocumentFragment();
					while (n.firstChild) frag.appendChild(n.firstChild);
					if (block && n.previousSibling) frag.insertBefore(document.createElement("br"), frag.firstChild);
					n.replaceWith(frag);
					return;
				}
				const keep = [...n.classList].filter(k => /^tbn-[a-z]+-[a-z]+$/.test(k));
				[...n.attributes].forEach(a => n.removeAttribute(a.name));
				if (keep.length) n.className = keep.join(" ");
				if ((n.tagName === "SPAN" || n.tagName === "MARK") && !keep.length) {
					const frag = document.createDocumentFragment();
					while (n.firstChild) frag.appendChild(n.firstChild);
					n.replaceWith(frag);
				}
			});
		};
		walk(tpl.content);
		return tpl.innerHTML.replace(/(<br>\s*)+$/i, "").trim();
	};

	/** The book's lines: its top-level paragraphs (old notes' paragraphs count as one line each). */
	const linesOf = (b) => {
		if (!b) return [];
		const tpl = document.createElement("template");
		tpl.innerHTML = noteItemOf(b).html || "";
		const out = [];
		let loose = "";
		const flush = () => { if (textOf(loose).trim()) out.push(cleanLine(loose)); loose = ""; };
		[...tpl.content.childNodes].forEach(n => {
			if (n.nodeType === Node.ELEMENT_NODE && /^(P|DIV|H\d|BLOCKQUOTE)$/.test(n.tagName)) { flush(); if (textOf(n.innerHTML).trim()) out.push(cleanLine(n.innerHTML)); } else if (n.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test(n.tagName)) { flush(); [...n.children].forEach(li => { if (textOf(li.innerHTML).trim()) out.push(cleanLine(li.innerHTML)); }); } else loose += n.nodeType === Node.TEXT_NODE ? esc(n.textContent) : (n.outerHTML || "");
		});
		flush();
		return out;
	};
	const setLines = (b, lines) => {
		noteItemOf(b).html = lines.filter(l => textOf(l).trim()).map(l => `<p class="tbn-line">${l}</p>`).join("");
		b.updatedAt = Date.now();
		TBStore.changed("book");
	};
	/** Split an editor's content into lines (its block children; loose text and <br> runs are one line). */
	const editorLines = (ed) => {
		const out = [];
		let loose = "";
		const flush = () => { const l = cleanLine(loose); if (textOf(l).trim()) out.push(l); loose = ""; };
		[...ed.childNodes].forEach(n => {
			if (n.nodeType === Node.ELEMENT_NODE && /^(P|DIV|H\d|LI|BLOCKQUOTE)$/.test(n.tagName)) { flush(); const l = cleanLine(n.innerHTML); if (textOf(l).trim()) out.push(l); } else loose += n.nodeType === Node.TEXT_NODE ? esc(n.textContent) : (n.outerHTML || "");
		});
		flush();
		return out;
	};
	const clipsOfBook = (b) => b.chapters.filter(x => x.genKey !== NOTE_KEY && x.genKey !== HB_KEY).flatMap(ch => ch.items.filter(i => i.kind === "clip"));
	const homebrewHtmlOf = (b) => b.chapters.filter(x => x.genKey === HB_KEY).flatMap(ch => ch.items.map(i => i.html)).join("");
	/** iso -> {lines, clips, hb, books} for every day this character has notes. */
	const daysOf = (c) => {
		const out = new Map();
		booksOf(c).forEach(b => {
			if (!b.sessionDate) return;
			const e = out.get(b.sessionDate) || {lines: 0, clips: 0, hb: false, books: []};
			e.lines += linesOf(b).length;
			e.clips += clipsOfBook(b).length;
			e.hb = e.hb || !!homebrewHtmlOf(b);
			e.books.push(b);
			out.set(b.sessionDate, e);
		});
		// Days without anything written, clipped or brewed stay out of the diary
		[...out.keys()].forEach(k => { const e = out.get(k); if (!e.lines && !e.clips && !e.hb) out.delete(k); });
		return out;
	};
	// endregion

	// region Rich text editing
	const HIGHLIGHTS = [["yellow", "Yellow"], ["green", "Green"], ["blue", "Blue"], ["pink", "Pink"], ["orange", "Orange"]];
	const COLORS = [["red", "Red"], ["gold", "Gold"], ["green", "Green"], ["blue", "Blue"], ["purple", "Purple"], ["gray", "Gray"]];
	const SIZES = [["s", "Small"], ["", "Normal"], ["l", "Large"]];

	let lastRange = null;
	document.addEventListener("selectionchange", () => {
		const s = window.getSelection();
		if (s && s.rangeCount && s.anchorNode && s.anchorNode.parentElement?.closest?.(".tbn-ed")) lastRange = s.getRangeAt(0).cloneRange();
	});
	const rangeIn = (ed) => {
		const s = window.getSelection();
		let r = s && s.rangeCount ? s.getRangeAt(0) : null;
		if (!r || !ed.contains(r.commonAncestorContainer)) r = lastRange && ed.contains(lastRange.commonAncestorContainer) ? lastRange : null;
		if (!r) return null;
		s.removeAllRanges();
		s.addRange(r);
		return r;
	};
	/** Remove one formatting group (hl / c / sz) from everything inside a fragment. */
	const stripGroup = (root, group) => {
		root.querySelectorAll(`[class*="tbn-${group}-"]`).forEach(el => {
			[...el.classList].filter(k => k.startsWith(`tbn-${group}-`)).forEach(k => el.classList.remove(k));
			if (!el.classList.length && (el.tagName === "SPAN" || el.tagName === "MARK")) {
				const frag = document.createDocumentFragment();
				while (el.firstChild) frag.appendChild(el.firstChild);
				el.replaceWith(frag);
			}
		});
	};
	/** Apply a class (or clear its group when value is empty) to the selected text. */
	const applyClass = (ed, group, value) => {
		const r = rangeIn(ed);
		if (!r || r.collapsed) { TBUI.toast("Select some text first."); return; }
		const frag = r.extractContents();
		stripGroup(frag, group);
		let node = frag;
		if (value) {
			const el = document.createElement(group === "hl" ? "mark" : "span");
			el.className = `tbn-${group}-${value}`;
			el.appendChild(frag);
			node = el;
		}
		const first = node.firstChild;
		const last = node.lastChild;
		r.insertNode(node);
		const s = window.getSelection();
		const nr = document.createRange();
		if (value) nr.selectNodeContents(node); else if (first && last) { nr.setStartBefore(first); nr.setEndAfter(last); }
		s.removeAllRanges();
		s.addRange(nr);
		ed.dispatchEvent(new Event("input", {bubbles: true}));
	};
	const clearFormat = (ed) => {
		const r = rangeIn(ed);
		if (!r || r.collapsed) { TBUI.toast("Select some text first."); return; }
		const txt = r.toString();
		r.deleteContents();
		r.insertNode(document.createTextNode(txt));
		ed.dispatchEvent(new Event("input", {bubbles: true}));
	};
	/** Toolbar for an editor: bold, italic, three sizes, highlight and text colours, clear. */
	const toolbar = (ed) => {
		// mousedown would move the focus out of the editor and lose the selection
		const btn = (label, title, fn, cls = "") => h("button.tbn-tb", {type: "button", class: cls, title, on: {mousedown: (e) => e.preventDefault(), click: (e) => { e.preventDefault(); ed.focus(); rangeIn(ed); fn(); }}}, label);
		const pop = (label, title, items) => {
			const menu = h("div.tbn-pop", ...items);
			const wrap = h("span.tbn-popw", btn(label, title, () => { document.querySelectorAll(".tbn-pop.open").forEach(x => { if (x !== menu) x.classList.remove("open"); }); menu.classList.toggle("open"); }), menu);
			return wrap;
		};
		const swatch = (group, value, label) => btn(h("i", {class: value ? `tbn-sw tbn-sw-${group}-${value}` : "tbn-sw tbn-sw-none"}), label, () => { applyClass(ed, group, value); ed.closest(".tbn-edw")?.querySelectorAll(".tbn-pop.open").forEach(x => x.classList.remove("open")); });
		return h("div.tbn-toolbar",
			btn(h("b", "B"), "Bold (Ctrl+B)", () => document.execCommand("bold")),
			btn(h("i", "I"), "Italic (Ctrl+I)", () => document.execCommand("italic")),
			h("span.tbn-sep"),
			...SIZES.map(([v, l]) => btn(h("span", {class: `tbn-tbsz-${v || "m"}`}, "A"), `${l} text`, () => applyClass(ed, "sz", v))),
			h("span.tbn-sep"),
			pop(h("span.tbn-ic-hl", "🖍"), "Highlight", [...HIGHLIGHTS.map(([v, l]) => swatch("hl", v, `${l} highlight`)), swatch("hl", "", "No highlight")]),
			pop(h("span.tbn-ic-c", "A"), "Text colour", [...COLORS.map(([v, l]) => swatch("c", v, `${l} text`)), swatch("c", "", "Default colour")]),
			h("span.tbn-sep"),
			btn("⌫", "Clear formatting of the selection", () => clearFormat(ed)),
		);
	};
	/** A small rich-text box. Single-line boxes send on Enter (Shift+Enter breaks the line). */
	const editor = ({html = "", placeholder = "", multi = false, onEnter = null, onEscape = null, onInput = null} = {}) => {
		const ed = h("div.tbn-ed", {contenteditable: "true", spellcheck: "true", "data-ph": placeholder, class: multi ? "multi" : ""});
		ed.innerHTML = html;
		ed.addEventListener("paste", (e) => {
			e.preventDefault();
			const t = (e.clipboardData || window.clipboardData)?.getData("text/plain") || "";
			if (multi) document.execCommand("insertHTML", false, t.split(/\r?\n/).map(l => `<p>${esc(l) || "<br>"}</p>`).join(""));
			else document.execCommand("insertText", false, t.replace(/\r?\n+/g, " "));
		});
		ed.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && onEscape) { e.preventDefault(); onEscape(); return; }
			if (e.key !== "Enter" || e.isComposing) return;
			if (multi) return;
			if (e.shiftKey) return;
			e.preventDefault();
			onEnter && onEnter();
		});
		ed.addEventListener("input", () => {
			ed.classList.toggle("empty", !ed.textContent.trim());
			onInput && onInput(ed.innerHTML);
		});
		ed.classList.toggle("empty", !ed.textContent.trim());
		return ed;
	};
	const placeCaretEnd = (ed) => {
		ed.focus();
		const r = document.createRange();
		r.selectNodeContents(ed);
		r.collapse(false);
		const s = window.getSelection();
		s.removeAllRanges();
		s.addRange(r);
	};
	document.addEventListener("click", (e) => { if (!e.target.closest?.(".tbn-popw")) document.querySelectorAll(".tbn-pop.open").forEach(x => x.classList.remove("open")); });
	// endregion

	// region Counters (HB Counters): on the character, shown on the Play sheet and the character page
	const countersOf = (c) => (c.counters ||= []);
	const setCounter = (c, k, v, onChange) => {
		const n = Math.round(Number(v));
		if (!Number.isFinite(n)) return;
		k.value = k.max != null && k.max !== "" ? Math.min(Number(k.max), n) : n;
		if (k.min != null && k.min !== "") k.value = Math.max(Number(k.min), k.value);
		c.updatedAt = Date.now();
		TBStore.changed("char");
		onChange && onChange();
	};
	const counterModal = (c, k, onChange) => {
		const isNew = !k;
		const name = h("input", {type: "text", placeholder: "e.g. Ki points, Sanity, Favors owed", value: k?.name || ""});
		const val = h("input", {type: "number", value: k ? k.value : 0, style: {width: "110px"}});
		const min = h("input", {type: "number", placeholder: "none", value: k?.min ?? "", style: {width: "110px"}});
		const max = h("input", {type: "number", placeholder: "none", value: k?.max ?? "", style: {width: "110px"}});
		const field = (l, el) => h("label.field", h("span", l), el);
		const ok = () => {
			const nm = name.value.trim();
			if (!nm) { TBUI.toast("Give the counter a name.", {error: true}); return; }
			const num = (el) => (el.value === "" ? null : Math.round(Number(el.value)));
			const obj = k || {id: TBBook.uid(), createdAt: Date.now()};
			Object.assign(obj, {name: nm, min: num(min), max: num(max)});
			if (isNew) countersOf(c).push(obj);
			m.close();
			setCounter(c, obj, num(val) ?? 0, onChange);
		};
		const m = TBUI.modal({
			title: isNew ? "New HB counter" : `Edit “${k.name}”`,
			body: h("div.tbn-cform", field("Name", name), h("div.row", {style: {gap: "10px", flexWrap: "wrap"}}, field("Value", val), field("Minimum", min), field("Maximum", max)),
				h("div.muted", {style: {fontSize: "12.5px"}}, "A counter of your own for anything the sheet doesn't track. It shows on the Play sheet and the character page, and keeps its value between sessions.")),
			footer: [h("button.btn", {on: {click: () => m.close()}}, "Cancel"), h("button.btn.primary", {on: {click: ok}}, isNew ? "Create" : "Save")],
		});
		name.addEventListener("keydown", (e) => { if (e.key === "Enter") ok(); });
		setTimeout(() => name.focus(), 30);
	};
	const removeCounter = async (c, k, onChange) => {
		if (!(await TBUI.confirm("Remove counter", `Remove the counter “${k.name}”?`, {okLabel: "Remove", danger: true}))) return;
		c.counters = countersOf(c).filter(x => x.id !== k.id);
		c.updatedAt = Date.now();
		TBStore.changed("char");
		onChange && onChange();
	};
	/** One counter: − value / max + (the number can be typed in). */
	const counterChip = (c, k, onChange, {manage = false} = {}) => {
		const at = (dir) => setCounter(c, k, (Number(k.value) || 0) + dir, onChange);
		const num = h("input.tbn-cnum", {type: "number", value: k.value, title: "Type a value", on: {change: (e) => setCounter(c, k, e.target.value, onChange), keydown: (e) => { if (e.key === "Enter") e.target.blur(); }}});
		const atMin = k.min != null && Number(k.value) <= Number(k.min);
		const atMax = k.max != null && Number(k.value) >= Number(k.max);
		return h("div.tbn-counter", {dataset: {id: k.id}},
			h("span.tbn-cname", {title: k.name}, k.name),
			h("div.tbn-cctl",
				h("button.tbn-cbtn", {title: "Subtract 1", disabled: atMin, on: {click: () => at(-1)}}, "−"),
				num,
				k.max != null ? h("span.tbn-cmax", `/ ${k.max}`) : null,
				h("button.tbn-cbtn", {title: "Add 1", disabled: atMax, on: {click: () => at(1)}}, "+"),
			),
			manage ? h("span.tbn-cman",
				h("button.btn.ghost.small", {title: "Edit", on: {click: () => counterModal(c, k, onChange)}}, "✎"),
				h("button.btn.ghost.small", {title: "Remove", on: {click: () => removeCounter(c, k, onChange)}}, "✕")) : null,
		);
	};
	/** The counters card for a main page (Play sheet, character page). */
	const countersCard = (c, {onChange, empty = true, title = "HB Counters"} = {}) => {
		const list = countersOf(c);
		if (!list.length && !empty) return null;
		return h("div.card.pl-card.tbn-ccard", h("div.card-h", h("h3", title), h("div.spacer"),
			h("button.btn.small", {title: "Create a counter of your own", on: {click: () => counterModal(c, null, onChange)}}, "+ Counter")),
		h("div.card-b.tbn-counters", ...(list.length ? list.map(k => counterChip(c, k, onChange, {manage: true})) : [h("div.pick-empty", "No counters yet. Make one for anything you want to keep count of: ammunition, favors, a curse's stacks…")])));
	};
	// endregion

	// region Homebrew (shared form; Play adds to the session, the character page straight to the character)
	const HB_TYPES = [["item", "Item (goes in the inventory)"], ["feat", "Feat"], ["feature", "Feature or trait"], ["action", "Action, Bonus Action or Reaction"], ["skill", "Skill proficiency"], ["tool", "Tool proficiency"], ["language", "Language"]];
	const HB_LABEL = {item: "Item", feat: "Feat", feature: "Feature or trait", action: "Action", skill: "Skill proficiency", tool: "Tool proficiency", language: "Language"};
	const textToHtml = (txt) => String(txt || "").split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
	/** Make something up; onAdd(hb, {qty}) stores it. */
	const homebrewModal = ({onAdd, note = ""} = {}) => {
		const typeSel = h("select", ...HB_TYPES.map(([v, l]) => h("option", {value: v}, l)));
		const name = h("input", {type: "text", placeholder: "Name"});
		const skillSel = h("select", ...TBRules.SKILL_LIST.map(s => h("option", {value: s}, TBRules.titleCase(s))));
		const ecoSel = h("select", h("option", {value: "action"}, "Action"), h("option", {value: "bonus"}, "Bonus Action"), h("option", {value: "reaction"}, "Reaction"), h("option", {value: "free"}, "No action (free)"));
		const qty = h("input", {type: "number", min: 1, value: 1, style: {width: "80px"}});
		const uses = h("input", {type: "text", placeholder: "e.g. 1 / Long Rest (optional)"});
		const desc = h("textarea", {rows: 6, placeholder: "What it is and what it does. Write it like the book would: \"Once per Short Rest, you can…\""});
		const field = (label, el) => h("label.field", h("span", label), el);
		const fName = field("Name", name);
		const fSkill = field("Skill", skillSel);
		const fEco = field("Takes", ecoSel);
		const fQty = field("Quantity", qty);
		const fUses = field("Uses", uses);
		const fDesc = field("Description", desc);
		const sync = () => {
			const t = typeSel.value;
			fName.style.display = t === "skill" ? "none" : "";
			fSkill.style.display = t === "skill" ? "" : "none";
			fEco.style.display = t === "action" ? "" : "none";
			fQty.style.display = t === "item" ? "" : "none";
			fUses.style.display = ["feat", "feature", "action"].includes(t) ? "" : "none";
			name.placeholder = t === "language" ? "e.g. Thieves' Cant" : t === "tool" ? "e.g. Alchemist's Supplies" : "Name";
		};
		typeSel.addEventListener("change", sync);
		sync();
		const add = () => {
			const type = typeSel.value;
			const nm = type === "skill" ? TBRules.titleCase(skillSel.value) : name.value.trim();
			if (!nm) { TBUI.toast("Give it a name.", {error: true}); return; }
			const hb = {id: TBBook.uid(), type, name: nm, desc: desc.value.trim(), addedAt: Date.now(), session: dayIso()};
			if (type === "skill") hb.skill = skillSel.value;
			if (type === "action") hb.eco = ecoSel.value;
			if (["feat", "feature", "action"].includes(type) && uses.value.trim()) hb.uses = uses.value.trim();
			m.close();
			onAdd && onAdd(hb, {qty: Math.max(1, Number(qty.value) || 1)});
		};
		const m = TBUI.modal({
			title: "Add homebrew",
			body: h("div.pl-hbform", field("What is it?", typeSel), fName, fSkill, fEco, fQty, fUses, fDesc,
				h("div.muted", {style: {fontSize: "12.5px"}}, note || "Items go into the inventory; feats, traits, actions and proficiencies show on the sheet right away.")),
			footer: [h("button.btn", {on: {click: () => m.close()}}, "Cancel"), h("button.btn.primary", {on: {click: add}}, "Add")],
		});
	};
	// endregion

	// region The hub
	/** Per character: the open day, the calendar's year, what is being edited, ticked lines, drafts. */
	const UI = new Map();
	const uiOf = (c) => {
		if (!UI.has(c.id)) UI.set(c.id, {selected: null, year: null, edit: null, checked: new Set(), draft: "", scrollLeft: null});
		return UI.get(c.id);
	};

	/** A line as shown in the diary or the chat, with its own edit and remove buttons. */
	const lineRow = (c, ctx, {iso, index, html, book, checkable = false}) => {
		const ui = uiOf(c);
		const key = `${iso}:${book ? book.id : "-"}:${index}`;
		if (ui.edit && ui.edit.kind === "line" && ui.edit.key === key) {
			let ed = null;
			const save = () => {
				const lines = linesOf(book);
				const l = cleanLine(ed.innerHTML);
				if (textOf(l).trim()) lines[index] = l; else lines.splice(index, 1);
				setLines(book, lines);
				ui.edit = null;
				ctx.refresh();
			};
			ed = editor({html, onEnter: save, onEscape: () => { ui.edit = null; ctx.refresh(); }});
			setTimeout(() => placeCaretEnd(ed), 20);
			return h("div.tbn-line.editing", h("div.tbn-edw", toolbar(ed), ed),
				h("div.tbn-line-act", h("button.btn.small", {on: {click: () => { ui.edit = null; ctx.refresh(); }}}, "Cancel"), h("button.btn.small.primary", {on: {click: save}}, "Save")));
		}
		const body = h("div.tbn-line-t");
		body.innerHTML = cleanLine(html);
		const tick = checkable ? h("input", {type: "checkbox", checked: ui.checked.has(key), title: "Select for Important notes", on: {change: (e) => { e.target.checked ? ui.checked.add(key) : ui.checked.delete(key); ctx.refresh(); }}}) : null;
		return h("div.tbn-line", tick, body,
			h("span.tbn-line-btns",
				h("button.btn.ghost.small", {title: "Edit this line", on: {click: () => { ui.edit = {kind: "line", key}; ctx.refresh(); }}}, "✎"),
				h("button.btn.ghost.small", {title: "Delete this line", on: {click: () => { const lines = linesOf(book); lines.splice(index, 1); setLines(book, lines); ui.checked.clear(); ctx.refresh(); }}}, "✕")));
	};

	/** Edit a whole day at once: every line is a paragraph; saving splits it back into lines. */
	const wholeEditor = (c, ctx, iso, books) => {
		const ui = uiOf(c);
		const book = books[0] || null;
		const lines = books.flatMap(linesOf);
		const ed = editor({html: lines.map(l => `<p>${l}</p>`).join("") || "<p><br></p>", multi: true, placeholder: "Write the day's notes. Each paragraph is one line."});
		try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) { /* older engines */ }
		setTimeout(() => placeCaretEnd(ed), 20);
		const save = () => {
			const out = editorLines(ed);
			const b = book || (out.length ? dayBook(c, iso, {create: true}) : null);
			if (b) setLines(b, out);
			books.slice(1).forEach(x => setLines(x, []));
			ui.edit = null;
			ui.checked.clear();
			ctx.refresh();
		};
		return h("div.tbn-whole", h("div.tbn-edw", toolbar(ed), ed),
			h("div.tbn-line-act", h("span.muted", {style: {fontSize: "12px"}}, "Enter starts a new line."), h("div.spacer"),
				h("button.btn.small", {on: {click: () => { ui.edit = null; ctx.refresh(); }}}, "Cancel"), h("button.btn.small.primary", {on: {click: save}}, "Save")));
	};

	/** The current session (Play) or today (character page): its lines like a chat, and the box to write the next. */
	const composerCard = (c, ctx) => {
		const ui = uiOf(c);
		const iso = ctx.sessionBook ? (ctx.sessionBook().sessionDate || dayIso()) : dayIso();
		const book = ctx.sessionBook ? ctx.sessionBook() : dayBook(c, iso);
		const lines = linesOf(book);
		const editingAll = ui.edit && ui.edit.kind === "whole" && ui.edit.iso === iso && ui.edit.where === "composer";
		const send = (ed) => {
			const l = cleanLine(ed.innerHTML);
			if (!textOf(l).trim()) return;
			const b = book || (ctx.sessionBook ? ctx.sessionBook({create: true}) : dayBook(c, iso, {create: true}));
			setLines(b, [...linesOf(b), l]);
			ui.draft = "";
			ui.refocus = true;
			ctx.refresh();
		};
		let body;
		if (editingAll) body = [wholeEditor(c, ctx, iso, [book].filter(Boolean))];
		else {
			const ed = editor({html: ui.draft || "", placeholder: "Write a note and press Enter. Shift+Enter for a new line in the same note.", onEnter: () => send(ed), onInput: (v) => { ui.draft = v; }});
			if (ui.refocus) { ui.refocus = false; setTimeout(() => placeCaretEnd(ed), 20); }
			body = [
				h("div.tbn-chat", ...(lines.length ? lines.map((html, index) => lineRow(c, ctx, {iso, index, html, book})) : [h("div.tbn-none", ctx.sessionBook ? "Nothing written this session yet." : "Nothing written today yet.")])),
				h("div.tbn-edw.tbn-compose", toolbar(ed), h("div.tbn-sendrow", ed, h("button.btn.primary.tbn-send", {title: "Add this note (Enter)", on: {mousedown: (e) => e.preventDefault(), click: () => send(ed)}}, "Send"))),
			];
		}
		return h("div.card.pl-card.tbn-composer", h("div.card-h",
			h("h3", ctx.sessionBook ? "This session" : "Today"), h("span.muted", ` · ${dayLabel(iso)}`), h("div.spacer"),
			lines.length && !editingAll ? h("button.btn.small", {title: "Edit every line of this day together", on: {click: () => { ui.edit = {kind: "whole", iso, where: "composer"}; ctx.refresh(); }}}, "✎ Edit") : null,
			book && ctx.openBook ? h("button.btn.small", {title: "Open this day's notes book in the Books tab", on: {click: () => ctx.openBook(book.id)}}, "📖") : null),
		h("div.card-b", ...body));
	};

	/** GitHub-style year of days; darker squares mean more lines written that day. */
	const calendarCard = (c, ctx) => {
		const ui = uiOf(c);
		const days = daysOf(c);
		const today = new Date();
		today.setHours(12, 0, 0, 0);
		const years = [...new Set([today.getFullYear(), ...[...days.keys()].map(k => Number(k.slice(0, 4)))])].sort((a, b) => b - a);
		const year = ui.year && years.includes(ui.year) ? ui.year : null;
		// Range: the last 53 weeks, or one calendar year
		const end = year && year !== today.getFullYear() ? new Date(year, 11, 31, 12) : today;
		const start = year ? new Date(year, 0, 1, 12) : new Date(end.getFullYear(), end.getMonth(), end.getDate() - 364, 12);
		const first = new Date(start);
		first.setDate(first.getDate() - first.getDay());
		const weeks = [];
		for (let w = new Date(first); w <= end; w.setDate(w.getDate() + 7)) weeks.push(new Date(w));
		const level = (n) => (n >= 10 ? 4 : n >= 6 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0);
		let count = 0;
		const monthsRow = h("div.tbn-cal-months");
		let lastMonth = -1;
		const cols = weeks.map((w, wi) => {
			const cells = [];
			for (let i = 0; i < 7; ++i) {
				const t = new Date(w);
				t.setDate(w.getDate() + i);
				const iso = isoOf(t);
				if (t < start || t > end) { cells.push(h("i.tbn-day.out")); continue; }
				const e = days.get(iso);
				const n = e ? Math.max(e.lines, e.clips || e.hb ? 1 : 0) : 0;
				if (e) count++;
				cells.push(h("button.tbn-day", {
					type: "button",
					class: [`l${level(n)}`, ui.selected === iso ? "sel" : "", iso === dayIso() ? "today" : ""].filter(Boolean).join(" "),
					title: e ? `${e.lines} line${e.lines === 1 ? "" : "s"}${e.clips ? `, ${e.clips} clip${e.clips === 1 ? "" : "s"}` : ""} on ${shortLabel(iso)}` : `No notes on ${shortLabel(iso)}`,
					dataset: {iso},
					on: {click: () => pickDay(c, ctx, iso, !!e)},
				}));
			}
			// A month's name over the first week that starts in it
			const ref = w < start ? start : w;
			const mo = ref.getMonth();
			const lbl = mo !== lastMonth && (wi === 0 || ref.getDate() <= 7) ? ref.toLocaleDateString("en-US", {month: "short"}) : "";
			if (lbl) lastMonth = mo;
			monthsRow.appendChild(h("span", lbl));
			return h("div.tbn-week", ...cells);
		});
		const scroller = h("div.tbn-cal-scroll", h("div.tbn-cal-in", monthsRow, h("div.tbn-cal-grid",
			h("div.tbn-cal-wd", ...["", "Mon", "", "Wed", "", "Fri", ""].map(x => h("span", x))), ...cols)));
		// Remember where the reader scrolled (a calendar taken off the page resets to 0: ignore that)
		scroller.addEventListener("scroll", () => {
			if (!scroller.isConnected || !scroller.clientWidth || scroller.scrollWidth <= scroller.clientWidth) return;
			ui.scrollLeft = scroller.scrollLeft;
			ui.atEnd = scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 4;
		}, {passive: true});
		// Newest days are on the right: start there (or where the reader left it)
		let tries = 0;
		const toEnd = () => {
			// The calendar may be built before its page is on screen: wait until it has a size
			if ((!scroller.isConnected || !scroller.clientWidth) && tries++ < 60) { setTimeout(toEnd, 25); return; }
			scroller.scrollLeft = ui.scrollLeft == null || ui.atEnd ? scroller.scrollWidth : ui.scrollLeft;
		};
		setTimeout(toEnd, 0);
		return h("div.card.pl-card.tbn-calcard", h("div.card-h", h("h3", "Diary"), h("span.muted", ` · ${count} day${count === 1 ? "" : "s"} with notes ${year ? `in ${year}` : "in the last year"}`)),
			h("div.card-b",
				h("div.tbn-cal-wrap", scroller,
					h("div.tbn-years", h("button", {class: !year ? "on" : "", on: {click: () => { ui.year = null; ui.scrollLeft = null; ctx.refresh(); }}}, "Last year"),
						...years.map(y => h("button", {class: year === y ? "on" : "", on: {click: () => { ui.year = y; ui.scrollLeft = null; ctx.refresh(); }}}, String(y))))),
				h("div.tbn-legend", h("span.muted", "Click a day to read it, or to add a note to a day without one."), h("div.spacer"), h("span.muted", "Less"), ...[0, 1, 2, 3, 4].map(l => h("i.tbn-day", {class: `l${l}`})), h("span.muted", "More"))));
	};
	const pickDay = async (c, ctx, iso, has) => {
		const ui = uiOf(c);
		if (!has && ui.selected !== iso) {
			if (!(await TBUI.confirm("Add a note", `There are no notes on ${dayLabel(iso)}. Add a note to that day?`, {okLabel: "Add a note"}))) return;
			ui.edit = {kind: "whole", iso, where: "day"};
		} else if (ui.edit && ui.edit.where === "day") ui.edit = null;
		ui.selected = iso;
		ui.checked.clear();
		ctx.refresh();
		setTimeout(() => ctx.root()?.querySelector(".tbn-daycard")?.scrollIntoView({block: "nearest", behavior: "smooth"}), 30);
	};

	/** The day picked on the calendar: its lines (tick some to pin them), edit, close. */
	const dayCard = (c, ctx) => {
		const ui = uiOf(c);
		const iso = ui.selected;
		if (!iso) return null;
		const books = booksOf(c).filter(b => b.sessionDate === iso).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
		const book = books[0] || null;
		const rows = books.flatMap(b => linesOf(b).map((html, index) => ({b, html, index})));
		const lines = rows.map(r => r.html);
		const editing = ui.edit && ui.edit.kind === "whole" && ui.edit.iso === iso && ui.edit.where === "day";
		const clips = books.flatMap(clipsOfBook);
		const hbHtml = books.map(homebrewHtmlOf).join("");
		const checked = [...ui.checked].filter(k => k.startsWith(`${iso}:`));
		const pin = () => {
			const list = (c.importantNotes ||= []);
			rows.filter(r => checked.includes(`${iso}:${r.b.id}:${r.index}`)).forEach(r => list.push({id: TBBook.uid(), html: r.html, date: iso, at: Date.now()}));
			c.updatedAt = Date.now();
			TBStore.changed("char");
			TBUI.toast(`${checked.length} line${checked.length === 1 ? "" : "s"} added to Important notes`);
			ui.checked.clear();
			ctx.refresh();
		};
		const extra = h("div.tbn-dayextra");
		if (clips.length) extra.appendChild(h("div.tbn-dayx", h("b", "From the wiki: "), clips.map(i => i.title).join(" · ")));
		if (hbHtml) { const x = h("div.tbn-dayx.hfeat-b"); x.innerHTML = `<b>Homebrew</b>${TBSan.clean(hbHtml)}`; extra.appendChild(x); }
		return h("div.card.pl-card.tbn-daycard", h("div.card-h",
			h("h3", dayLabel(iso)), h("div.spacer"),
			!editing ? h("button.btn.small", {title: "Edit the whole day", on: {click: () => { ui.edit = {kind: "whole", iso, where: "day"}; ctx.refresh(); }}}, "✎ Edit") : null,
			!editing && lines.length ? h("button.btn.small", {disabled: !checked.length, title: checked.length ? "Pin the ticked lines to Important notes" : "Tick lines first", on: {click: pin}}, `★ Add selected to important notes${checked.length ? ` (${checked.length})` : ""}`) : null,
			book && ctx.openBook ? h("button.btn.small", {title: "Open this day's notes book in the Books tab", on: {click: () => ctx.openBook(book.id)}}, "📖") : null,
			h("button.btn.small", {title: "Stop showing this day", on: {click: () => { ui.selected = null; if (ui.edit && ui.edit.where === "day") ui.edit = null; ui.checked.clear(); ctx.refresh(); }}}, "✕ Close")),
		h("div.card-b",
			editing ? wholeEditor(c, ctx, iso, books)
				: rows.length ? h("div.tbn-chat", ...rows.map(r => lineRow(c, ctx, {iso, index: r.index, html: r.html, book: r.b, checkable: true})))
					: h("div.tbn-none", "No written notes. ", h("a", {href: "#", on: {click: (e) => { e.preventDefault(); ui.edit = {kind: "whole", iso, where: "day"}; ctx.refresh(); }}}, "Write some")),
			extra.childNodes.length ? extra : null));
	};

	const importantCard = (c, ctx) => {
		const list = c.importantNotes || [];
		if (!list.length) return null;
		return h("div.card.pl-card.tbn-important", h("div.card-h", h("h3", "★ Important notes"), h("span.muted", ` · ${list.length}`)),
			h("div.card-b", ...list.map(n => {
				const t = h("div.tbn-line-t");
				t.innerHTML = cleanLine(n.html);
				return h("div.tbn-line.pinned", t,
					h("span.tbn-from", {title: dayLabel(n.date), on: {click: () => { const ui = uiOf(c); ui.selected = n.date; ui.checked.clear(); ctx.refresh(); }}}, shortLabel(n.date)),
					h("span.tbn-line-btns", h("button.btn.ghost.small", {title: "Remove from Important notes", on: {click: () => { c.importantNotes = list.filter(x => x.id !== n.id); c.updatedAt = Date.now(); TBStore.changed("char"); ctx.refresh(); }}}, "✕")));
			})));
	};

	/**
	 * The whole hub. opts:
	 * - sessionBook({create}) → the session's book (Play); without it, the composer writes today's notes.
	 * - extras: () => [cards] (homebrew, wiki clips), shown after the diary.
	 * - onCounters: called when a counter changes (Play redraws its sheet).
	 * - openBook(id).
	 */
	const hub = (c, opts = {}) => {
		const root = h("div.tbn-hub");
		const ctx = {
			...opts,
			root: () => root,
			refresh: () => {
				const cal = root.querySelector(".tbn-cal-scroll");
				if (cal && cal.scrollWidth > cal.clientWidth) { uiOf(c).scrollLeft = cal.scrollLeft; uiOf(c).atEnd = cal.scrollLeft >= cal.scrollWidth - cal.clientWidth - 4; }
				clear(root);
				fill();
			},
		};
		const fill = () => {
			[importantCard(c, ctx), composerCard(c, ctx), calendarCard(c, ctx), dayCard(c, ctx),
				countersCard(c, {onChange: () => { ctx.refresh(); opts.onCounters && opts.onCounters(); }, title: "HB Counters"}),
				...(opts.extras ? opts.extras() : [])].filter(Boolean).forEach(el => root.appendChild(el));
		};
		fill();
		return root;
	};
	// endregion

	return {
		hub, countersCard, counterChip, counterModal, homebrewModal, HB_TYPES, HB_LABEL, textToHtml,
		dayBook, dayIso, dayLabel, linesOf, setLines, noteItemOf, daysOf, cleanLine,
	};
})();
