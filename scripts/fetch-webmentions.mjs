// Pull every webmention for publictheology.com from the webmention.io JF2 API into
// .cache/webmentions.json (gitignored), read at build time by src/_data/webmentions.js.
// No token: warn and leave any existing cache alone, exit 0 (local/fork builds just show none).
// API error, or a suspicious shrink (see shrinkProblem): keep the previous file and exit 1, so
// CI keeps the last good copy restored by actions/cache and a webmention.io outage or a wrong
// token never blanks the site. WEBMENTION_ALLOW_SHRINK=1 accepts a big drop on purpose.
// The token goes only into the request URL; it is never logged.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const OUT = ".cache/webmentions.json";
const DOMAIN = process.env.WEBMENTION_DOMAIN || "publictheology.com";
const PER_PAGE = 100;
const MAX_PAGES = 50;

// webmention.io answers 200 with children:[] when the domain isn't on the token's account, so an
// empty list (or one that lost over half its entries) replacing a non-empty cache is treated as a
// fault. Smaller drops are ordinary deletes (e.g. Bridgy Fed relaying a deleted reply).
export function shrinkProblem(oldCount, newCount) {
	if (oldCount > 0 && newCount === 0) return `webmention.io returned 0 mentions but the cache has ${oldCount}`;
	if (oldCount > 0 && newCount < oldCount * 0.5) return `webmention.io returned ${newCount} mentions, down from ${oldCount} (>50% drop)`;
	return null;
}

async function main() {
	const token = (process.env.WEBMENTION_IO_TOKEN || "").trim();
	if (!token) {
		console.warn("WEBMENTION_IO_TOKEN not set; skipping webmention fetch (build will use any cached or no mentions).");
		return 0;
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
		console.log(`::warning::Webmention fetch failed, keeping previous ${OUT}: ${error.message}`);
		return 1;
	}

	let oldCount = 0;
	try {
		oldCount = JSON.parse(await readFile(OUT, "utf8")).children?.length || 0;
	} catch {}
	const problem = shrinkProblem(oldCount, children.length);
	if (problem && process.env.WEBMENTION_ALLOW_SHRINK !== "1") {
		console.log(`::warning::${problem}; keeping previous ${OUT}. Check the token/domain, or rerun with WEBMENTION_ALLOW_SHRINK=1.`);
		return 1;
	}

	await mkdir(".cache", { recursive: true });
	await writeFile(`${OUT}.tmp`, `${JSON.stringify({ fetched: new Date().toISOString(), domain: DOMAIN, children }, null, "\t")}\n`);
	await rename(`${OUT}.tmp`, OUT);
	console.log(`Saved ${children.length} webmentions to ${OUT} (was ${oldCount}).`);
	return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
