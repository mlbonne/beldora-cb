"use strict";

/**
 * Copies the parts of the 5etools site that Beldora CB needs into site-bundle/, which the installer ships.
 * Artwork (about 12 GB of .webp) is left out: installers cannot exceed 2 GB and nothing depends on it.
 * Usage: node scripts/stage-site.js [siteRoot]
 */
const fs = require("fs");
const path = require("path");

const SITE = path.resolve(process.argv[2] || path.join(__dirname, "..", ".."));
const OUT = path.join(__dirname, "..", "site-bundle");

// Whole folders that make the wiki and the data work
const DIRS = ["data", "js", "lib", "css", "fonts", "search", "audio", "icon", "homebrew", "prerelease", "covers"];
// Files at the site root
const ROOT_EXT = new Set([".html", ".js", ".mjs", ".json", ".webmanifest", ".xml", ".svg", ".png", ".webp", ".ico", ".txt"]);
const ROOT_SKIP = new Set(["package.json", "package-lock.json", "jsconfig.json", "jest.config.json", "cspell.json", "eslint.config.mjs"]);

if (!fs.existsSync(path.join(SITE, "data", "races.json"))) {
	console.error(`Not a 5etools site: ${SITE}`);
	process.exit(1);
}

fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});

let files = 0;
let bytes = 0;
const copy = (from, to) => {
	fs.mkdirSync(path.dirname(to), {recursive: true});
	fs.copyFileSync(from, to);
	files++;
	bytes += fs.statSync(to).size;
};
const copyDir = (rel) => {
	const src = path.join(SITE, rel);
	if (!fs.existsSync(src)) return;
	for (const ent of fs.readdirSync(src, {withFileTypes: true})) {
		const r = path.join(rel, ent.name);
		if (ent.isDirectory()) copyDir(r);
		else copy(path.join(SITE, r), path.join(OUT, r));
	}
};

DIRS.forEach(copyDir);
for (const ent of fs.readdirSync(SITE, {withFileTypes: true})) {
	if (!ent.isFile() || ROOT_SKIP.has(ent.name)) continue;
	if (ROOT_EXT.has(path.extname(ent.name).toLowerCase())) copy(path.join(SITE, ent.name), path.join(OUT, ent.name));
}

const license = path.join(SITE, "LICENSE.md");
if (fs.existsSync(license)) copy(license, path.join(OUT, "LICENSE-5etools.md"));

console.log(`Staged ${files} files (${(bytes / 1048576).toFixed(1)} MB) from ${SITE} into ${OUT}`);
