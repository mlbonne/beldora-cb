"use strict";

/**
 * Builds the static versions of Beldora CB.
 *   node scripts/build-web.js web      -> web-dist/   (full app incl. wiki and DM books; host on any static web server)
 *   node scripts/build-web.js mobile   -> mobile/www/ (Android: character builder and exports only)
 * Both need site-bundle/ (run scripts/stage-site.js first). Artwork loads from the 5etools image repository.
 */
const fs = require("fs");
const path = require("path");

const target = process.argv[2] || "web";
const ROOT = path.join(__dirname, "..");
const SITE = path.join(ROOT, "site-bundle");
const OUT = target === "mobile" ? path.join(ROOT, "mobile", "www") : path.join(ROOT, "web-dist");
const REMOTE_IMG_ROOT = "https://raw.githubusercontent.com/5etools-mirror-3/5etools-img/main/";

if (!fs.existsSync(path.join(SITE, "data", "races.json"))) {
	console.error("site-bundle/ is missing: run node scripts/stage-site.js first.");
	process.exit(1);
}

fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});

let files = 0;
let bytes = 0;
const copyFile = (from, to) => {
	fs.mkdirSync(path.dirname(to), {recursive: true});
	fs.copyFileSync(from, to);
	files++;
	bytes += fs.statSync(to).size;
};
const copyDir = (from, to, filter = () => true) => {
	if (!fs.existsSync(from)) return;
	for (const ent of fs.readdirSync(from, {withFileTypes: true})) {
		const f = path.join(from, ent.name);
		const t = path.join(to, ent.name);
		if (ent.isDirectory()) copyDir(f, t, filter);
		else if (filter(f)) copyFile(f, t);
	}
};

// region 5etools site
if (target === "mobile") {
	// Only what the builder, renderer and exports use
	["data", "js", "lib", "css", "fonts", "icon"].forEach(d => copyDir(path.join(SITE, d), path.join(OUT, d)));
} else {
	copyDir(SITE, OUT);
}
// Artwork comes from the 5etools image repository
const utils = path.join(OUT, "js", "utils.js");
fs.writeFileSync(utils, fs.readFileSync(utils, "utf8").replace("globalThis.DEPLOYED_IMG_ROOT = undefined;", `globalThis.DEPLOYED_IMG_ROOT = ${JSON.stringify(REMOTE_IMG_ROOT)};`));
// No service worker: the site would otherwise try to cache itself
["sw.js", "sw-injector.js"].forEach(f => fs.writeFileSync(path.join(OUT, f), "/* disabled in Beldora CB */\n"));
// endregion

// region App
const UI = path.join(ROOT, "ui");
const pages = fs.readdirSync(UI).filter(f => /^tb-.*\.html$/.test(f) && !/selftest|test|boot/.test(f));
pages.forEach(f => copyFile(path.join(UI, f), path.join(OUT, f)));
copyDir(path.join(UI, "js"), path.join(OUT, "__tb", "js"));
copyDir(path.join(UI, "css"), path.join(OUT, "__tb", "css"));
copyDir(path.join(UI, "img"), path.join(OUT, "__tb", "img"));
copyFile(path.join(UI, "icon.png"), path.join(OUT, "__tb", "icon.png"));
// The interface version (the in-app updater compares against it)
copyFile(path.join(UI, "version.json"), path.join(OUT, "__tb", "version.json"));
if (target === "mobile") {
	// The APK's shell version (android/app/build.gradle): updates name the oldest shell they run on ("minAndroid")
	const gradle = fs.readFileSync(path.join(ROOT, "mobile", "android", "app", "build.gradle"), "utf8");
	const shell = (/versionName\s+"([^"]+)"/.exec(gradle) || [])[1] || "0.0.0";
	fs.writeFileSync(path.join(OUT, "__tb", "shell.json"), JSON.stringify({version: shell}));
}
// Vendor libraries normally served from node_modules by the desktop app
const NM = path.join(ROOT, "node_modules");
copyDir(path.join(NM, "pagedjs", "dist"), path.join(OUT, "__tb", "vendor", "pagedjs"), f => /paged\.min\.js$/.test(f));
const fontFilter = f => /-latin(-ext)?-\d+-(normal|italic)\.woff2$/.test(f);
copyDir(path.join(NM, "@fontsource", "cinzel", "files"), path.join(OUT, "__tb", "vendor", "cinzel", "files"), fontFilter);
copyDir(path.join(NM, "@fontsource", "eb-garamond", "files"), path.join(OUT, "__tb", "vendor", "garamond", "files"), fontFilter);
copyDir(path.join(NM, "@fontsource", "alegreya-sans", "files"), path.join(OUT, "__tb", "vendor", "alegreya-sans", "files"), fontFilter);
// endregion

// region Entry point
const manifest = {
	name: "Beldora Character Builder",
	short_name: "Beldora CB",
	id: "beldora-cb",
	start_url: target === "mobile" ? "index.html" : "tb-app.html",
	scope: "./",
	display: "standalone",
	orientation: "any",
	background_color: "#16130f",
	theme_color: "#16130f",
	icons: [
		{src: "__tb/img/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any"},
		{src: "__tb/img/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any"},
		{src: "__tb/icon.png", sizes: "256x256", type: "image/png"},
	],
};
fs.writeFileSync(path.join(OUT, "beldora.webmanifest"), JSON.stringify(manifest, null, "\t"));
// Installable as an app: the manifest for Chrome/Android/Windows, the apple-* tags for iPad "Add to Home Screen"
const appHtml = fs.readFileSync(path.join(OUT, "tb-app.html"), "utf8")
	.replace("</head>", [
		"\t<link rel=\"manifest\" href=\"beldora.webmanifest\">",
		"\t<meta name=\"theme-color\" content=\"#16130f\">",
		"\t<meta name=\"mobile-web-app-capable\" content=\"yes\">",
		"\t<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">",
		"\t<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">",
		"\t<meta name=\"apple-mobile-web-app-title\" content=\"Beldora CB\">",
		"\t<link rel=\"apple-touch-icon\" href=\"__tb/img/icon-192.png\">",
		"</head>",
	].join("\n"));
fs.writeFileSync(path.join(OUT, "tb-app.html"), appHtml);
if (target === "mobile") {
	// Capacitor opens index.html: the boot page starts an installed update, or the built-in tb-app.html
	copyFile(path.join(UI, "tb-boot.html"), path.join(OUT, "index.html"));
} else {
	// Visiting the site opens the app; the wiki frame inside the app still shows the 5etools home page
	const idx = path.join(OUT, "index.html");
	fs.writeFileSync(idx, fs.readFileSync(idx, "utf8").replace("<head>", "<head>\n<script>if (window.top === window && !/[?&]wiki\\b/.test(location.search)) location.replace(\"tb-app.html\");</script>"));
	// Hosts that serve paths as-is (Cloudflare with html_handling "none") still open the app at the bare address
	fs.writeFileSync(path.join(OUT, "_redirects"), "/ /tb-app.html 302\n");
}
// endregion

console.log(`Built ${target} into ${OUT}: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
