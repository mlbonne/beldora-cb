"use strict";

/** App state persisted through the Electron main process (falls back to localStorage in a plain browser). */
globalThis.TBStore = (() => {
	const LS_KEY = "tomebinder-store";
	const native = () => globalThis.tbNative;
	let state = null;
	let saveTimer = null;
	const listeners = new Set();

	const blank = () => ({version: 1, characters: [], books: [], encounters: [], settings: {clipTarget: null}});

	const load = async () => {
		try {
			if (native()) state = await native().readStore();
			else state = JSON.parse(localStorage.getItem(LS_KEY) || "null");
		} catch (e) { console.error(e); }
		state = {...blank(), ...(state || {})};
		state.settings = {...blank().settings, ...(state.settings || {})};
		return state;
	};

	const flush = async () => {
		clearTimeout(saveTimer);
		saveTimer = null;
		try {
			if (native()) await native().writeStore(state);
			else localStorage.setItem(LS_KEY, JSON.stringify(state));
		} catch (e) {
			console.error(e);
			TBUI?.toast?.(`Could not save: ${e.message}`, {error: true});
		}
	};

	/** Mark state dirty; saves are debounced. */
	const changed = (what = "any") => {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(flush, 350);
		listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } });
	};

	const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

	window.addEventListener("beforeunload", () => { if (saveTimer) flush(); });

	const get = () => state;
	const char = (id) => state.characters.find(c => c.id === id);
	const book = (id) => state.books.find(b => b.id === id);
	const bookOf = (charId) => state.books.find(b => b.ownerCharId === charId);

	return {load, get, changed, flush, on, char, book, bookOf};
})();
