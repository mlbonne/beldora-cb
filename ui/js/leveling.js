"use strict";

/**
 * Experience and levelling: the XP bar, levelling up when the XP is there, and a forced level-up
 * (for testing a build) that remembers where the character was so it can be reverted.
 */
globalThis.TBLevel = (() => {
	const {h} = TBUI;
	/** XP needed to reach each level (index = level), 2024 rules. */
	const LEVEL_XP = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
	const level = (char) => Math.max(1, (char.classes || []).reduce((a, c) => a + (Number(c.level) || 0), 0));

	/** Characters made before XP existed start at the minimum for their level. */
	const xpOf = (char) => (char.xp == null ? LEVEL_XP[level(char)] : Number(char.xp) || 0);
	const progress = (char) => {
		const L = level(char);
		const xp = xpOf(char);
		if (L >= 20) return {level: L, xp, from: LEVEL_XP[20], to: null, pct: 100, ready: false};
		const from = LEVEL_XP[L];
		const to = LEVEL_XP[L + 1];
		return {level: L, xp, from, to, pct: Math.max(0, Math.min(100, (xp - from) / (to - from) * 100)), ready: xp >= to};
	};
	const addXp = (char, n) => { char.xp = Math.max(0, xpOf(char) + Math.round(Number(n) || 0)); };

	/** Raise one class by a level (asks which when multiclassed), then open the builder on the new choices. */
	const levelUp = (char, {force = false} = {}) => {
		if (level(char) >= 20) { TBUI.toast("Already level 20."); return; }
		const p = progress(char);
		if (!force && !p.ready) { TBUI.toast(`${(p.to - p.xp).toLocaleString("en-US")} more XP needed for level ${p.level + 1}.`, {error: true}); return; }
		const doIt = (ix) => {
			if (force && !char.forced) {
				// Remember the character as it was, once, so every forced level can be undone together
				const copy = (v) => JSON.parse(JSON.stringify(v ?? null));
				char.forced = {fromLevel: level(char), xp: char.xp ?? null, classes: copy(char.classes), choices: copy(char.choices), feats: copy(char.feats), spells: copy(char.spells), optfeatures: copy(char.optfeatures), at: Date.now()};
			}
			char.classes[ix].level++;
			TBViewBuilder.goTo("class");
			TBViewBuilder.ui.classIx = ix;
			TBApp.charChanged(char);
			TBApp.openCharTab("builder");
			TBUI.toast(`${char.classes[ix].name} is now level ${char.classes[ix].level}${force ? " (forced)" : ""}. Make the new choices.`);
		};
		if (char.classes.length === 1) return doIt(0);
		const m = TBUI.modal({
			title: force ? "Force a level up: which class?" : "Level up which class?",
			body: h("div", {style: {padding: "14px", display: "flex", flexDirection: "column", gap: "8px", width: "360px"}},
				...char.classes.map((c, i) => h("button.btn", {on: {click: () => { m.close(); doIt(i); }}}, `${c.name} ${c.level} → ${c.level + 1}`)),
				h("button.btn.ghost", {on: {click: () => { m.close(); TBViewBuilder.goTo("class"); TBApp.openCharTab("builder"); }}}, "Multiclass into a new class…"),
			),
		});
	};

	const revertForced = async (char) => {
		const f = char.forced;
		if (!f) return;
		const ok = await TBUI.confirm("Revert forced level-up", `Go back to level ${f.fromLevel}${f.xp != null ? ` with ${Number(f.xp).toLocaleString("en-US")} XP` : ""}? Choices made after the forced level-up are discarded.`, {okLabel: "Revert"});
		if (!ok) return;
		Object.assign(char, {classes: f.classes, choices: f.choices || {}, feats: f.feats || [], spells: f.spells || [], optfeatures: f.optfeatures || []});
		if (f.xp == null) delete char.xp; else char.xp = f.xp;
		delete char.forced;
		TBApp.charChanged(char);
		TBApp.renderCharacters();
		TBUI.toast(`Back to level ${f.fromLevel}.`);
	};
	const keepForced = (char) => { delete char.forced; TBApp.charChanged(char); TBApp.renderCharacters(); };

	/** XP bar with an "add XP" box, for the Character tab. */
	const xpBar = (char, onChange) => {
		const p = progress(char);
		const inp = h("input", {type: "number", placeholder: "+ XP", style: {width: "90px"}});
		const add = () => { const n = Number(inp.value); if (!n) return; addXp(char, n); TBApp.charChanged(char); onChange && onChange(); };
		inp.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
		return h("div.xpbar",
			h("div.row",
				h("b", "Experience"),
				h("span.grow.dim", p.to == null ? `${p.xp.toLocaleString("en-US")} XP · level 20` : `${p.xp.toLocaleString("en-US")} / ${p.to.toLocaleString("en-US")} XP${p.ready ? " · ready to level up!" : ` · ${(p.to - p.xp).toLocaleString("en-US")} to level ${p.level + 1}`}`),
				inp, h("button.btn.small", {on: {click: add}}, "Add"),
			),
			h("div.xpbar-track", h("div.xpbar-fill", {class: p.ready ? "ready" : "", style: {width: `${p.pct}%`}})),
		);
	};

	return {LEVEL_XP, level, xpOf, progress, addXp, levelUp, revertForced, keepForced, xpBar};
})();
