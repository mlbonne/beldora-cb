"use strict";

/** Small DOM helpers shared by the views. */
globalThis.TBUI = (() => {
	/**
	 * h("div.cls#id", {attrs, on: {click}}, ...children)
	 */
	const h = (sel, props, ...children) => {
		if (props == null || typeof props !== "object" || props instanceof Node || Array.isArray(props)) {
			if (props !== undefined && props !== null) children.unshift(props);
			props = {};
		}
		const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel);
		const el = document.createElement((m && m[1]) || "div");
		if (m && m[2]) {
			m[2].match(/[.#][\w-]+/g).forEach(tok => {
				if (tok[0] === ".") el.classList.add(tok.slice(1));
				else el.id = tok.slice(1);
			});
		}
		for (const [k, v] of Object.entries(props)) {
			if (v == null || v === false) continue;
			if (k === "on") Object.entries(v).forEach(([evt, fn]) => el.addEventListener(evt, fn));
			else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
			else if (k === "class") el.className += (el.className ? " " : "") + v;
			else if (k === "html") el.innerHTML = v;
			else if (k === "value") el.value = v;
			else if (k === "checked") el.checked = !!v;
			else if (k === "dataset") Object.assign(el.dataset, v);
			else if (k in el && typeof v !== "string") el[k] = v;
			else el.setAttribute(k, v === true ? "" : v);
		}
		const add = (c) => {
			if (c == null || c === false) return;
			if (Array.isArray(c)) return c.forEach(add);
			el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
		};
		children.forEach(add);
		return el;
	};

	const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

	const toast = (msg, {error = false, action = null, timeout = 4200} = {}) => {
		const root = document.getElementById("tb-toasts");
		const t = h("div.toast", {class: error ? "err" : ""}, h("span.grow", msg));
		if (action) t.appendChild(h("button.btn.small", {on: {click: () => { action.fn(); t.remove(); }}}, action.label));
		t.appendChild(h("button.btn.ghost.small", {on: {click: () => t.remove()}}, "✕"));
		root.appendChild(t);
		setTimeout(() => t.remove(), timeout);
		return t;
	};

	/** Open a modal; returns {el, close}. */
	const modal = ({title, body, footer, className = "", onClose} = {}) => {
		const root = document.getElementById("tb-modal-root");
		const close = () => { back.remove(); document.removeEventListener("keydown", onKey); onClose && onClose(); };
		const onKey = (e) => { if (e.key === "Escape") close(); };
		const m = h("div.modal", {class: className},
			h("div.modal-h", h("h2", title), h("div.spacer"), h("button.btn.ghost", {on: {click: close}}, "✕")),
			h("div.modal-b", body),
			footer ? h("div.modal-f", footer) : null,
		);
		const back = h("div.modal-back", {on: {mousedown: (e) => { if (e.target === back) close(); }}}, m);
		root.appendChild(back);
		document.addEventListener("keydown", onKey);
		return {el: m, close};
	};

	const prompt = (title, value = "", {multiline = false, placeholder = ""} = {}) => new Promise(resolve => {
		const inp = multiline ? h("textarea", {rows: 6, style: {width: "100%"}, placeholder}) : h("input", {type: "text", style: {width: "100%"}, placeholder});
		inp.value = value;
		let done = false;
		const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
		const m = modal({
			title,
			className: "prompt",
			body: h("div", {style: {padding: "14px 16px", width: "520px"}}, inp),
			footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel"), h("button.btn.primary", {on: {click: () => finish(inp.value)}}, "OK")],
			onClose: () => { if (!done) { done = true; resolve(null); } },
		});
		inp.addEventListener("keydown", e => { if (e.key === "Enter" && !multiline) finish(inp.value); });
		setTimeout(() => { inp.focus(); inp.select && inp.select(); }, 30);
	});

	const confirm = (title, text, {okLabel = "OK", danger = false} = {}) => new Promise(resolve => {
		let done = false;
		const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
		const m = modal({
			title,
			body: h("div", {style: {padding: "16px", width: "460px", lineHeight: "1.45"}}, text),
			footer: [h("button.btn", {on: {click: () => finish(false)}}, "Cancel"), h(`button.btn${danger ? ".danger" : ".primary"}`, {on: {click: () => finish(true)}}, okLabel)],
			onClose: () => { if (!done) { done = true; resolve(false); } },
		});
	});

	/** A short list of options; resolves to the chosen value or null. options: [{value, label, hint?}] */
	const choose = (title, options) => new Promise(resolve => {
		let done = false;
		const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
		const m = modal({
			title,
			className: "choose",
			body: h("div.choose-list", ...options.map(o => h("button.btn.choose-opt", {on: {click: () => finish(o.value)}}, h("span", o.label), o.hint ? h("small.muted", o.hint) : null))),
			footer: [h("button.btn", {on: {click: () => finish(null)}}, "Cancel")],
			onClose: () => { if (!done) { done = true; resolve(null); } },
		});
	});

	/** An iframe that shows booklet-styled HTML fragments. */
	const fragFrame = () => {
		const frame = h("iframe.frag-frame", {src: "tb-frag.html"});
		let pending = null;
		let ready = false;
		frame.addEventListener("load", () => {
			ready = true;
			if (pending != null) frame.contentWindow.setContent(pending);
		});
		frame.setContent = (html) => {
			if (ready && frame.contentWindow && frame.contentWindow.setContent) frame.contentWindow.setContent(html);
			else pending = html;
		};
		return frame;
	};

	const debounce = (fn, ms) => {
		let t = null;
		return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
	};

	const fileToDataUrl = (file, maxDim = 900) => new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = reject;
		reader.onload = () => {
			const img = new Image();
			img.onload = () => {
				const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
				const c = document.createElement("canvas");
				c.width = Math.round(img.width * scale);
				c.height = Math.round(img.height * scale);
				c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
				resolve(c.toDataURL("image/jpeg", 0.88));
			};
			img.onerror = reject;
			img.src = reader.result;
		};
		reader.readAsDataURL(file);
	});

	// region Dropdowns on touch screens
	/**
	 * Tablets running the web app: native <select> pickers can fail to open or to apply the choice (reported on a
	 * tablet in the Add homebrew form). A tap on any dropdown opens the app's own list instead; picking sets the
	 * value and fires the usual input/change events, so the code behind each dropdown doesn't change.
	 * The Android app keeps the system pickers.
	 */
	const selectSheet = (sel) => {
		const label = sel.closest("label")?.querySelector("span")?.textContent || sel.getAttribute("aria-label") || sel.title || "Choose";
		let m = null;
		const pick = (opt) => {
			m.close();
			if (sel.value === opt.value && opt.selected) return;
			sel.value = opt.value;
			sel.dispatchEvent(new Event("input", {bubbles: true}));
			sel.dispatchEvent(new Event("change", {bubbles: true}));
		};
		const row = (opt) => h("button.tb-selopt", {type: "button", class: opt.selected ? "on" : "", disabled: opt.disabled, on: {click: () => pick(opt)}}, opt.textContent);
		const items = [];
		[...sel.children].forEach(ch => {
			if (ch.tagName === "OPTGROUP") { items.push(h("div.tb-selgrp", ch.label)); [...ch.children].forEach(o => items.push(row(o))); } else if (ch.tagName === "OPTION" && !ch.hidden) items.push(row(ch));
		});
		m = modal({title: label.replace(/[:…]+$/, ""), className: "tb-selsheet", body: items});
		setTimeout(() => m.el.querySelector(".tb-selopt.on")?.scrollIntoView({block: "center"}), 30);
	};
	const touchSelects = () => {
		if (!("ontouchstart" in window) || window.Capacitor?.isNativePlatform?.()) return;
		let start = null;
		const target = (e) => {
			const sel = e.target.closest && e.target.closest("select");
			return sel && !sel.disabled && !sel.multiple && !sel.closest(".tb-native-select") ? sel : null;
		};
		// Stop the system picker (and the focus that opens it) on the tap itself
		document.addEventListener("touchstart", (e) => {
			const sel = target(e);
			if (!sel) return;
			e.preventDefault();
			start = {sel, x: e.touches[0].clientX, y: e.touches[0].clientY};
		}, {passive: false, capture: true});
		document.addEventListener("touchend", (e) => {
			if (!start) return;
			const s = start;
			start = null;
			const t = e.changedTouches[0];
			if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > 12) return;
			e.preventDefault();
			selectSheet(s.sel);
		}, {passive: false, capture: true});
		document.addEventListener("touchcancel", () => { start = null; }, {capture: true});
	};
	touchSelects();
	// endregion

	return {h, clear, toast, modal, prompt, confirm, choose, fragFrame, debounce, fileToDataUrl, selectSheet};
})();
