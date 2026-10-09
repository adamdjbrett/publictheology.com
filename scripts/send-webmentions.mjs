// Send webmentions for new, edited and deleted posts after the deploy is live.
//   node scripts/send-webmentions.mjs [changed-urls.txt] [--dry-run] [--skip-bridgy]
// For each post URL (one per line, written by the deploy workflow):
//   1. always mention https://fed.brid.gy/ — Bridgy Fed is in webmention-only mode, so this is
//      what bridges a new post, re-bridges an edit, or (once the URL 404s) deletes it;
//   2. mention every external link in the post's e-content whose page advertises a webmention
//      endpoint (W3C discovery: HTTP Link header, then the first <link>/<a rel="webmention">).
// .cache/webmention-sent.json remembers source -> target sends plus a hash of the post content:
// unchanged content re-sends nothing external; changed content re-sends to current targets and
// to links that were removed (so receivers can update). A post missing from _site/ is treated as
// deleted: every target on record is re-sent so receivers see the 404 and drop the mention.
// Reads the built _site/ copy of each post (identical to what was just deployed).
// SSRF guard: every URL fetched or POSTed to must resolve only to public addresses; discovery
// follows redirects by hand and re-checks each hop; POSTs never follow redirects.
// Remote errors are logged (::warning:: + $GITHUB_STEP_SUMMARY), never fatal: always exits 0.
// --dry-run discovers endpoints (GETs only) and prints what it would POST; no sends, no log write.
// --skip-bridgy: linked sites only (backfilling old posts must not re-announce them on Mastodon/Bluesky).
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

const SITE_HOSTS = new Set(["publictheology.com", "www.publictheology.com"]);
const BRIDGY = { endpoint: "https://fed.brid.gy/webmention", target: "https://fed.brid.gy/" };
const BRIDGY_GAP_MS = 5000; // Bridgy Fed rate-limits bridged activities to one per 5 s per user.
const MAX_TARGETS = 100;
const MAX_REDIRECTS = 20;
const UA = "publictheology.com-webmention-sender/1.0 (+https://publictheology.com/)";

// Swappable for tests (no network in `npm run test:webmentions`).
export const net = { fetch: (...a) => globalThis.fetch(...a), lookup };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Loopback, private, link-local, CGNAT, multicast/reserved, and their IPv6 / IPv4-mapped forms.
export function isPrivateAddress(ip) {
	const addr = String(ip).toLowerCase().replace(/^\[|\]$/g, "");
	if (isIP(addr) === 4) {
		const [a, b] = addr.split(".").map(Number);
		return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
	}
	if (isIP(addr) !== 6) return true;
	const mapped = addr.match(/^(?:0*:)*:?ffff:(?:0+:)?(\d+\.\d+\.\d+\.\d+)$/)?.[1] ||
		addr.match(/^(?:0*:)*:?ffff:([\da-f]{1,4}):([\da-f]{1,4})$/)?.slice(1).map((h) => { const n = Number.parseInt(h, 16); return `${n >> 8}.${n & 255}`; }).join(".");
	if (mapped) return isPrivateAddress(mapped);
	return addr === "::" || addr === "::1" || /^f[cd]/.test(addr) || /^fe[89ab]/.test(addr) || /^ff/.test(addr) || /^64:ff9b:/.test(addr) || /^2001:db8:/.test(addr);
}

// Throws unless `url` is http(s) and its host resolves only to public addresses.
// ponytail: fetch re-resolves DNS, so a rebinding host can still flip between check and connect;
// pinning needs a custom undici dispatcher (not stdlib). Acceptable for a CI-only sender.
export async function assertPublicUrl(url) {
	const u = new URL(url);
	if (!/^https?:$/.test(u.protocol)) throw new Error(`blocked non-http URL ${u.protocol}`);
	const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
	if (!host || host === "localhost" || host.endsWith(".localhost") || (!isIP(host) && !host.includes("."))) throw new Error(`blocked host ${host || "(empty)"}`);
	const addrs = isIP(host) ? [{ address: host }] : await net.lookup(host, { all: true });
	if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`blocked private address for ${host}`);
}

function attr(tag, name) {
	const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
	return m ? (m[1] ?? m[2] ?? m[3]).replaceAll("&amp;", "&") : null;
}

// Links inside the post's e-content (up to the first </section> that closes the <article>).
export function contentLinks(html, base) {
	const body = html.match(/class="[^"]*\be-content\b[^"]*"[^>]*>([\s\S]*?)<\/section>\s*<\/article>/)?.[1] || "";
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

// GET with redirects followed by hand, so every hop is re-checked against the guard.
async function guardedGet(url) {
	let current = url;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		await assertPublicUrl(current);
		const res = await net.fetch(current, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "manual", signal: AbortSignal.timeout(10000) });
		const location = res.headers.get("location");
		if (res.status < 300 || res.status > 399 || !location) return { res, url: current };
		await res.body?.cancel();
		current = new URL(location, current).href;
	}
	throw new Error("too many redirects");
}

const endpoints = new Map();
export async function discover(target) {
	if (!endpoints.has(target)) {
		endpoints.set(target, (async () => {
			try {
				const { res, url } = await guardedGet(target);
				const html = /html/i.test(res.headers.get("content-type") || "") ? (await res.text()).slice(0, 2_000_000) : "";
				const endpoint = findEndpoint(res.headers.get("link"), html, url);
				if (!endpoint) return null;
				await assertPublicUrl(endpoint); // throws for private/non-http endpoints -> null
				return endpoint;
			} catch {
				return null;
			}
		})());
	}
	return endpoints.get(target);
}

export async function run({ list = "changed-urls.txt", site = "_site", logFile = ".cache/webmention-sent.json", dry = false, skipBridgy = false } = {}) {
	const stats = { bridgy: 0, bridgyFailed: [], sent: 0, failed: [], deleted: [] };
	const warn = (msg) => console.log(`::warning::${msg}`);

	async function send(source, target, endpoint) {
		if (dry) {
			console.log(`[dry-run] would POST source=${source} target=${target} to ${endpoint}`);
			return true;
		}
		try {
			await assertPublicUrl(endpoint); // re-check right before POSTing
			const res = await net.fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
				body: new URLSearchParams({ source, target }),
				redirect: "manual", // a 3xx is a failure: never re-POST to wherever it points
				signal: AbortSignal.timeout(15000),
			});
			if (res.ok) {
				console.log(`sent (HTTP ${res.status}): ${source} -> ${target}`);
				return true;
			}
			warn(`webmention failed (HTTP ${res.status}): ${source} -> ${target}`);
		} catch (error) {
			warn(`webmention failed (${error.message}): ${source} -> ${target}`);
		}
		return false;
	}

	const sources = existsSync(list) ? readFileSync(list, "utf8").split(/\s+/).filter((u) => /^https:\/\//.test(u)) : [];
	if (!sources.length) {
		console.log(`No post URLs in ${list}; nothing to send.`);
		return stats;
	}
	let log = {};
	try { log = JSON.parse(readFileSync(logFile, "utf8")); } catch {}

	let first = true;
	for (const source of sources) {
		if (!skipBridgy) {
			if (!first) await sleep(dry ? 0 : BRIDGY_GAP_MS);
			first = false;
			if (await send(source, BRIDGY.target, BRIDGY.endpoint)) stats.bridgy++;
			else stats.bridgyFailed.push(source);
		}

		const file = `${site}${new URL(source).pathname}index.html`;
		const deleted = !existsSync(file);
		const prev = log[source] || { hash: null, targets: {} };
		const { hash, links } = deleted ? { hash: null, links: [] } : contentLinks(readFileSync(file, "utf8"), source);
		if (deleted) {
			stats.deleted.push(source);
			console.log(`${source}: not in ${site}/ → treated as DELETED; re-sending to ${Object.keys(prev.targets).length} logged target(s) so they drop it`);
		}
		const changed = deleted || prev.hash !== hash;
		const removed = changed ? Object.keys(prev.targets).filter((t) => !links.includes(t)) : [];
		const todo = [...links.filter((t) => changed || !prev.targets[t]), ...removed];
		const next = { hash, targets: changed ? {} : { ...prev.targets } };

		const results = await Promise.all(todo.map(async (target) => {
			const endpoint = await discover(target);
			if (!endpoint) return [target, null];
			const ok = await send(source, target, endpoint);
			if (ok) stats.sent++;
			else stats.failed.push(`${source} -> ${target}`);
			return [target, ok ? new Date().toISOString() : null];
		}));
		for (const [target, at] of results) if (at && links.includes(target)) next.targets[target] = at;
		console.log(`${source}: ${links.length} external links, ${todo.length} checked, ${Object.keys(next.targets).length} with webmentions on record`);
		if (deleted) delete log[source];
		else log[source] = next;
	}

	const summary = [
		`### Webmentions${dry ? " (dry run)" : ""}`,
		`- Posts: ${sources.length}${stats.deleted.length ? ` (${stats.deleted.length} deleted)` : ""}`,
		skipBridgy ? "- Bridgy Fed: skipped" : `- Bridgy Fed: ${stats.bridgy} ok, ${stats.bridgyFailed.length} failed`,
		`- Linked sites: ${stats.sent} sent, ${stats.failed.length} failed`,
		...[...stats.bridgyFailed.map((s) => `${s} -> ${BRIDGY.target}`), ...stats.failed].map((f) => `  - FAILED: ${f}`),
	].join("\n");
	console.log(summary);
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);

	if (dry) {
		console.log("[dry-run] sent-log not written.");
	} else {
		mkdirSync(logFile.replace(/\/[^/]*$/, "") || ".", { recursive: true });
		writeFileSync(logFile, `${JSON.stringify(log, null, "\t")}\n`);
	}
	return stats;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const args = process.argv.slice(2);
	await run({
		list: args.find((a) => !a.startsWith("--")) || "changed-urls.txt",
		dry: args.includes("--dry-run"),
		skipBridgy: args.includes("--skip-bridgy"),
	}).catch((error) => console.log(`::warning::webmention sending aborted (non-fatal): ${error.message}`));
}
