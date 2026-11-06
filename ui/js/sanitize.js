"use strict";

/** Turns live 5etools markup into static, print-friendly markup. */
globalThis.TBSan = (() => {
	const REMOVE = [
		"script", "style", "button", "input", "select", "textarea", "noscript", "iframe",
		".ve-rd__h-toggle", "[data-rd-h-toggle-button]", ".tb-clip-ui",
		".ve-stats__btn-share", ".ve-stats__wrp-btns", ".ve-btn", ".ve-glyphicon",
		".cls-nav", ".cls-tabs__wrp", ".ve-lst-is-exporting-image__hidden",
	].join(",");

	const clean = (html) => {
		const tpl = document.createElement("template");
		tpl.innerHTML = html;
		const root = tpl.content;
		root.querySelectorAll(REMOVE).forEach(el => el.remove());
		root.querySelectorAll("*").forEach(el => {
			for (const attr of [...el.attributes]) {
				const n = attr.name.toLowerCase();
				if (n.startsWith("on") || n === "draggable" || n === "contenteditable" || n === "tabindex" || n === "data-packed-dice" || n === "title" && el.tagName !== "ABBR") el.removeAttribute(attr.name);
			}
			if (el.style && el.style.display === "none") el.remove();
		});
		root.querySelectorAll("a").forEach(a => {
			if (a.classList.contains("tb-xref") || a.classList.contains("tb-pref")) return;
			const span = document.createElement("span");
			span.className = `${a.className} tb-term`.trim();
			if (a.dataset.vetPage) span.dataset.vetPage = a.dataset.vetPage;
			span.innerHTML = a.innerHTML;
			a.replaceWith(span);
		});
		return tpl.innerHTML.replace(/\s{2,}/g, " ");
	};

	/** Clone a live element, keeping only what is actually displayed. */
	const cloneVisible = (el, win = window) => {
		const walk = (node) => {
			if (node.nodeType === Node.TEXT_NODE) return node.cloneNode();
			if (node.nodeType !== Node.ELEMENT_NODE) return null;
			const cs = win.getComputedStyle(node);
			if (cs.display === "none" || (cs.visibility === "hidden" && node.tagName !== "TR")) return null;
			const c = node.cloneNode(false);
			if (node.tagName === "IMG" && node.currentSrc) c.setAttribute("src", node.getAttribute("src"));
			for (const ch of node.childNodes) {
				const cc = walk(ch);
				if (cc) c.appendChild(cc);
			}
			return c;
		};
		return walk(el);
	};

	return {clean, cloneVisible};
})();
