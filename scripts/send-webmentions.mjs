// Send webmentions for new/edited posts after they are live.
//   node scripts/send-webmentions.mjs [changed-urls.txt] [--dry-run] [--skip-bridgy]
// For each post URL (one per line, written by the deploy workflow):
//   1. always mention https://fed.brid.gy/ — Bridgy Fed is in webmention-only mode, so this is
//      what bridges a new post (or re-bridges an edit) to Mastodon and Bluesky;
//   2. mention every external link in the post's e-content whose page advertises a webmention
//      endpoint (W3C discovery: HTTP Link header, then the first <link>/<a rel="webmention">).
// .cache/webmention-sent.json remembers source -> target sends plus a hash of the post content:
// unchanged content re-sends nothing external; changed content re-sends to current targets and
// to links that were removed (so receivers can update). Reads the built _site/ copy of each post
// (identical to what was just deployed). Remote errors are logged, never fatal: always exits 0.
// --dry-run discovers endpoints (GETs only) and prints what it would POST; no sends, no log write.
// --skip-bridgy: linked sites only (backfilling old posts must not re-announce them on Mastodon/Bluesky).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const SKIP_BRIDGY = args.includes("--skip-bridgy");
const LIST = args.find((a) => !a.startsWith("--")) || "changed-urls.txt";
const LOG = ".cache/webmention-sent.json";
const SITE_HOSTS = new Set(["publictheology.com", "www.publictheology.com"]);
const BRIDGY = { endpoint: "https://fed.brid.gy/webmention", target: "https://fed.brid.gy/" };
const BRIDGY_GAP_MS = 5000; // Bridgy Fed rate-limits bridged activities to one per 5 s per user.
const MAX_TARGETS = 100;
const UA = "publictheology.com-webmention-sender/1.0 (+https://publictheology.com/)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Never send to or fetch loopback/private addresses (spec §4.3); names without a dot too.
const isPrivateHost = (host) =>
	!host.includes(".") || host === "localhost" || /^\[(::1?|f[cd]|fe80)/i.test(host) ||
	/^(127|10|0)\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(/^[\d.]+$/.test(host) ? host : "");

function attr(tag, name) {
	const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
	return m ? (m[1] ?? m[2] ?? m[3]).replaceAll("&amp;", "&") : null;
}

// Links inside the post's e-content (the <section> closed right before </article>).
export function contentLinks(html, base) {
	const body = html.match(/class="[^"]*\be-content\b[^"]*"[^>]*>([\s\S]*)<\/section>\s*<\/article>/)?.[1] || "";
	const links = new Set();
	for (const [tag] of body.matchAll(/<a\b[^>]*>/gi)) {
		const href = attr(tag, "href");
		if (!href) continue;
		try {
			const url = new URL(href, base);
			url.hash = "";
			if (/^https?:$/.test(url.protocol) && !SITE_HOSTS.has(url.hostname) && !url.hostname.endsWith("brid.gy")) links.add(url.href);
		} catch {}
	}
	return { hash: createHash("sha256").update(body).digest("hex").slice(0, 16), links: [...links].slice(0, MAX_TARGETS) };
}

// W3C Webmention §3.1.2: Link header first, then the first <link>/<a> with rel~=webmention in
// document order; resolve relative (and empty, = the page itself) hrefs against the final URL.
export function findEndpoint(linkHeader, html, pageUrl) {
	for (const part of (linkHeader || "").split(/,\s*(?=<)/)) {
		const m = part.match(/^\s*<([^>]*)>(.*)$/s);
		const rel = m?.[2].match(/;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i);
		if (rel && (rel[1] ?? rel[2]).toLowerCase().split(/\s+/).includes("webmention")) return new URL(m[1], pageUrl).href;
	}
	for (const [tag] of (html || "").replace(/<!--[\s\S]*?-->/g, "").matchAll(/<(?:link|a)\b[^>]*>/gi)) {
		const rel = attr(tag, "rel");
		const href = attr(tag, "href");
		if (rel && href !== null && rel.toLowerCase().split(/\s+/).includes("webmention")) return new URL(href, pageUrl).href;
	}
	return null;
}

const endpoints = new Map();
async function discover(target) {
	if (!endpoints.has(target)) {
		endpoints.set(target, (async () => {
			try {
				if (isPrivateHost(new URL(target).hostname)) return null;
				const res = await fetch(target, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
				const html = /html/i.test(res.headers.get("content-type") || "") ? (await res.text()).slice(0, 2_000_000) : "";
				const endpoint = findEndpoint(res.headers.get("link"), html, res.url || target);
				return endpoint && /^https?:$/.test(new URL(endpoint).protocol) && !isPrivateHost(new URL(endpoint).hostname) ? endpoint : null;
			} catch {
				return null;
			}
		})());
	}
	return endpoints.get(target);
}

async function send(source, target, endpoint) {
	if (DRY) {
		console.log(`[dry-run] would POST source=${source} target=${target} to ${endpoint}`);
		return true;
	}
	try {
		const res = await fetch(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
			body: new URLSearchParams({ source, target }),
			signal: AbortSignal.timeout(15000),
		});
		console.log(`${res.ok ? "sent" : `failed (HTTP ${res.status})`}: ${source} -> ${target}`);
		return res.ok;
	} catch (error) {
		console.log(`failed (${error.message}): ${source} -> ${target}`);
		return false;
	}
}

async function main() {
	const sources = existsSync(LIST) ? readFileSync(LIST, "utf8").split(/\s+/).filter((u) => /^https:\/\//.test(u)) : [];
	if (!sources.length) return console.log(`No post URLs in ${LIST}; nothing to send.`);
	let log = {};
	try { log = JSON.parse(readFileSync(LOG, "utf8")); } catch {}

	let first = true;
	for (const source of sources) {
		if (!SKIP_BRIDGY) {
			if (!first) await sleep(DRY ? 0 : BRIDGY_GAP_MS);
			first = false;
			await send(source, BRIDGY.target, BRIDGY.endpoint);
		}

		const file = `_site${new URL(source).pathname}index.html`;
		if (!existsSync(file)) { console.log(`skip external links: ${file} not found`); continue; }
		const { hash, links } = contentLinks(readFileSync(file, "utf8"), source);
		const prev = log[source] || { hash: null, targets: {} };
		const changed = prev.hash !== hash;
		const removed = changed ? Object.keys(prev.targets).filter((t) => !links.includes(t)) : [];
		const todo = [...links.filter((t) => changed || !prev.targets[t]), ...removed];
		const next = { hash, targets: changed ? {} : { ...prev.targets } };

		const results = await Promise.all(todo.map(async (target) => {
			const endpoint = await discover(target);
			if (!endpoint) return [target, null];
			return [target, (await send(source, target, endpoint)) ? new Date().toISOString() : null];
		}));
		for (const [target, at] of results) if (at && links.includes(target)) next.targets[target] = at;
		console.log(`${source}: ${links.length} external links, ${todo.length} checked, ${Object.keys(next.targets).length} with webmentions on record`);
		log[source] = next;
	}

	if (DRY) return console.log("[dry-run] sent-log not written.");
	mkdirSync(".cache", { recursive: true });
	writeFileSync(LOG, `${JSON.stringify(log, null, "\t")}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await main().catch((error) => console.log(`webmention sending aborted (non-fatal): ${error.message}`));
}
