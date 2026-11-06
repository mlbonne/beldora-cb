/**
 * Beldora CB on Cloudflare: the web version's static files, plus the app-update endpoints.
 *   GET /api/updates/manifest          -> {"desktop": {version, minApp, sha256, size, notes, published}, …}
 *   GET /api/updates/bundle/<version>  -> gzip'd JSON bundle of the ui/ folder for that version
 * Both read from the UPDATES KV namespace (written by `npm run publish:update`). Everything else is a static file.
 */
// The desktop app's pages may download updates themselves (http://127.0.0.1:<port>), so the API allows any origin
const CORS = {"access-control-allow-origin": "*"};

export default {
	async fetch (request, env) {
		const url = new URL(request.url);
		if (url.pathname === "/api/updates/manifest") {
			const m = await env.UPDATES.get("manifest");
			return new Response(m || "{}", {headers: {...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-cache"}});
		}
		const b = /^\/api\/updates\/bundle\/([\w.-]+)$/.exec(url.pathname);
		if (b) {
			const data = await env.UPDATES.get(`bundle:${b[1]}`, "arrayBuffer");
			if (!data) return new Response("Not found", {status: 404});
			return new Response(data, {headers: {...CORS, "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable"}});
		}
		if (url.pathname.startsWith("/api/")) return new Response("Not found", {status: 404});
		return env.ASSETS.fetch(request);
	},
};
