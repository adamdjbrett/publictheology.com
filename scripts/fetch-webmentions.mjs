// Pull every webmention for publictheology.com from the webmention.io JF2 API into
// .cache/webmentions.json (gitignored), read at build time by src/_data/webmentions.js.
// No token: warn and leave any existing cache alone, exit 0 (local/fork builds just show none).
// API error: keep the previous file and exit 1, so CI can decide (the cache from the last
// good run is restored by actions/cache, so a webmention.io outage never blanks the site).
// The token goes only into the request URL; it is never logged.
import { mkdir, rename, writeFile } from "node:fs/promises";

const OUT = ".cache/webmentions.json";
const DOMAIN = process.env.WEBMENTION_DOMAIN || "publictheology.com";
const PER_PAGE = 100;
const MAX_PAGES = 50;
const token = (process.env.WEBMENTION_IO_TOKEN || "").trim();

if (!token) {
	console.warn("WEBMENTION_IO_TOKEN not set; skipping webmention fetch (build will use any cached or no mentions).");
	process.exit(0);
}

const children = [];
try {
	for (let page = 0; page < MAX_PAGES; page++) {
		const api = new URL("https://webmention.io/api/mentions.jf2");
		api.search = new URLSearchParams({ domain: DOMAIN, token, "per-page": PER_PAGE, page, "sort-dir": "up" });
		const res = await fetch(api, {
			headers: { "User-Agent": "publictheology.com-webmentions/1.0" },
			signal: AbortSignal.timeout(20000),
		});
		if (!res.ok) throw new Error(`webmention.io HTTP ${res.status}`);
		const batch = (await res.json()).children || [];
		children.push(...batch);
		if (batch.length < PER_PAGE) break;
	}
} catch (error) {
	// error.message never contains the URL (fetch errors are generic; ours carries only the status).
	console.error(`Webmention fetch failed, keeping previous ${OUT}: ${error.message}`);
	process.exit(1);
}

await mkdir(".cache", { recursive: true });
await writeFile(`${OUT}.tmp`, `${JSON.stringify({ fetched: new Date().toISOString(), domain: DOMAIN, children }, null, "\t")}\n`);
await rename(`${OUT}.tmp`, OUT);
console.log(`Saved ${children.length} webmentions to ${OUT}.`);
