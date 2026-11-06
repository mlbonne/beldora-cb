"use strict";

/**
 * Searchable list + live preview modal used to pick species, backgrounds, classes, feats, options and spells.
 */
globalThis.TBPickers = (() => {
	const {h, clear, modal} = TBUI;
	const D = () => TBData;

	/**
	 * @param opts
	 * @param opts.title
	 * @param opts.load async () => entities
	 * @param opts.prop renderer prop for the preview
	 * @param [opts.info] (ent) => short string shown in the list
	 * @param [opts.chipGroups] [{label, chips: [{label, test: ent => bool, on: bool}]}] OR within a group, AND across groups
	 * @param [opts.extraFilter] (ent) => bool
	 * @param [opts.isChosen] (ent) => bool
	 * @param opts.onPick (ent) => void|false  (return false to keep it open in single mode)
	 * @param [opts.multi] keep the modal open after picking
	 * @param [opts.renderPreview] (ent) => html
	 * @param [opts.legacyDefault]
	 */
	const open = async (opts) => {
		let all = [];
		let filtered = [];
		let selIx = -1;
		let showLegacy = !!opts.legacyDefault;
		const groups = (opts.chipGroups || []).map(g => ({...g, chips: g.chips.map(c => ({...c}))}));

		const search = h("input", {type: "search", placeholder: "Search by name…"});
		const legacyChk = h("input", {type: "checkbox", checked: showLegacy});
		const chipWrap = h("div", {style: {display: "flex", flexDirection: "column", gap: "5px"}});
		const list = h("div.picker-list");
		const count = h("div.pl-count");
		const frame = TBUI.fragFrame();
		const pickBtn = h("button.btn.primary", {disabled: true}, opts.multi ? "Add" : "Choose");
		const prTitle = h("span.grow.dim", "");

		const renderChips = () => {
			clear(chipWrap);
			groups.forEach(g => {
				if (!g.chips.length) return;
				const row = h("div.picker-chips");
				if (g.label) row.appendChild(h("span.muted", {style: {fontSize: "12px", marginRight: "4px", minWidth: "64px"}}, g.label));
				g.chips.forEach(c => row.appendChild(h("span.chip", {class: c.on ? "on" : "", on: {click: () => { c.on = !c.on; renderChips(); refilter(); }}}, c.label)));
				chipWrap.appendChild(row);
			});
		};

		const refilter = () => {
			const q = search.value.trim().toLowerCase();
			const activeGroups = groups.map(g => g.chips.filter(c => c.on)).filter(a => a.length);
			filtered = all.filter(e => {
				if (!showLegacy && !D().isModern(e.source)) return false;
				if (q && !e.name.toLowerCase().includes(q)) return false;
				if (activeGroups.some(act => !act.some(c => c.test(e)))) return false;
				if (opts.extraFilter && !opts.extraFilter(e)) return false;
				return true;
			});
			selIx = filtered.length ? Math.max(0, Math.min(selIx, filtered.length - 1)) : -1;
			renderList();
			showSel();
		};

		const renderList = () => {
			clear(list);
			const frag = document.createDocumentFragment();
			filtered.slice(0, 1500).forEach((e, ix) => {
				const chosen = opts.isChosen && opts.isChosen(e);
				frag.appendChild(h("div.pl-row", {
					class: ix === selIx ? "sel" : "",
					dataset: {ix},
					on: {
						click: () => { selIx = ix; list.querySelectorAll(".pl-row.sel").forEach(r => r.classList.remove("sel")); list.children[ix]?.classList.add("sel"); showSel(); },
						dblclick: () => { selIx = ix; doPick(); },
					},
				},
				h("span.nm", e.name),
				chosen ? h("span.have", "✓") : null,
				opts.info ? h("span.info", opts.info(e)) : null,
				h("span.src", D().sourceShort(e.source)),
				));
			});
			list.appendChild(frag);
			count.textContent = `${filtered.length} result${filtered.length === 1 ? "" : "s"}${filtered.length > 1500 ? " (showing 1500)" : ""}`;
		};

		const showSel = () => {
			const e = filtered[selIx];
			pickBtn.disabled = !e;
			prTitle.textContent = e ? `${e.name} — ${D().sourceFull(e.source)}` : "";
			if (!e) return frame.setContent("");
			try {
				const html = opts.renderPreview ? opts.renderPreview(e) : D().renderEntity(opts.prop, e);
				Promise.resolve(html).then(x => frame.setContent(TBSan.clean(x)));
			} catch (err) { frame.setContent(`<p>Preview failed: ${err.message}</p>`); }
		};

		const doPick = () => {
			const e = filtered[selIx];
			if (!e) return;
			const r = opts.onPick(e);
			if (opts.multi) {
				renderList();
				TBUI.toast(`Added ${e.name}`, {timeout: 1600});
			} else if (r !== false) m.close();
		};
		pickBtn.addEventListener("click", doPick);

		search.addEventListener("input", TBUI.debounce(refilter, 120));
		search.addEventListener("keydown", (e) => {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				selIx = Math.max(0, Math.min(filtered.length - 1, selIx + (e.key === "ArrowDown" ? 1 : -1)));
				list.querySelectorAll(".pl-row.sel").forEach(r => r.classList.remove("sel"));
				const row = list.children[selIx];
				if (row) { row.classList.add("sel"); row.scrollIntoView({block: "nearest"}); }
				showSel();
			} else if (e.key === "Enter") doPick();
		});
		legacyChk.addEventListener("change", () => { showLegacy = legacyChk.checked; refilter(); });

		const m = modal({
			title: opts.title,
			className: "picker",
			body: [
				h("div.picker-left",
					h("div.picker-filters",
						search,
						chipWrap,
						h("label.chk", legacyChk, "Include legacy (2014) and older content"),
					),
					list,
					count,
				),
				h("div.picker-right", h("div.pr-bar", prTitle), frame),
			],
			footer: [h("span.muted.grow", `${opts.multi ? "Double-click or Enter to add. Keep adding, then close." : "Double-click or Enter to choose."}${opts.note && !/^0 hidden/.test(opts.note) ? `  ·  ${opts.note}` : ""}`), h("button.btn", {on: {click: () => m.close()}}, opts.multi ? "Done" : "Cancel"), pickBtn],
			onClose: opts.onClose,
		});
		renderChips();
		list.appendChild(h("div.empty", "Loading…"));
		setTimeout(() => search.focus(), 30);
		try {
			all = (await opts.load()).slice().sort((a, b) => a.name.localeCompare(b.name) || (D().isModern(b.source) - D().isModern(a.source)));
		} catch (e) {
			clear(list).appendChild(h("div.empty", `Failed to load: ${e.message}`));
			return;
		}
		refilter();
		return m;
	};

	return {open};
})();
