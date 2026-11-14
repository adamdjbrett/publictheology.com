// Find recent public posts from the two accounts that link to this site, and submit missing
// mentions using Bridgy's microformats representations. Existing webmention.io data is the dedupe
// source; an unsuccessful or still-pending submission is retried on the next run.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DID = "did:plc:3vmq5usrh3yvhbrrzf4ymo23";
const ENDPOINT = "https://webmention.io/publictheology.com/webmention";
const DAYS = 30;
const MAX_PAGES = 20;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function target(value) {
	try {
		const url = new URL(value);
		if (!["http:", "https:"].includes(url.protocol) || !["publictheology.com", "www.publictheology.com"].includes(url.hostname)) return null;
		url.hash = "";
		return url.href;
	} catch {
		return null;
	}
}

function blueskyLinks(record) {
	return [
		record?.embed?.external?.uri,
		record?.embed?.media?.external?.uri,
		...(record?.facets || []).flatMap((facet) => (facet.features || []).map((feature) => feature.uri)),
	];
}

function mastodonLinks(html) {
	return [...html.matchAll(/<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi)]
		.map((match) => (match[1] ?? match[2]).replaceAll("&amp;", "&"));
}

async function json(fetchImpl, url, options = {}) {
	const response = await fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20000) });
	if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
	return response.json();
}

export async function checkSocialWebmentions({ fetchImpl = fetch, cacheFile = ".cache/webmentions.json", now = Date.now(), sleep = delay } = {}) {
	let cache;
	try {
		cache = JSON.parse(await readFile(cacheFile, "utf8"));
		if (!Array.isArray(cache.children)) throw new Error("children is not an array");
	} catch (error) {
		if (error.code !== "ENOENT") throw new Error(`Cannot read webmention cache: ${error.message}`);
		cache = { children: [] };
	}
	const existing = new Set();
	for (const entry of cache.children) {
		for (const source of [entry["wm-source"], entry.url]) {
			if (source && entry["wm-target"]) existing.add(`${source}\n${entry["wm-target"]}`);
		}
	}
	const cutoff = now - DAYS * 24 * 60 * 60 * 1000;
	const pending = new Map();
	function add(source, original, links) {
		for (const link of links) {
			const dest = target(link);
			if (!dest || existing.has(`${source}\n${dest}`) || existing.has(`${original}\n${dest}`)) continue;
			pending.set(`${source}\n${dest}`, { source, target: dest });
		}
	}

	let cursor;
	for (let page = 0; page < MAX_PAGES; page++) {
		const url = new URL("https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed");
		url.search = new URLSearchParams({ actor: DID, limit: "100", ...(cursor ? { cursor } : {}) });
		const data = await json(fetchImpl, url);
		if (!Array.isArray(data.feed)) throw new Error("Invalid Bluesky feed");
		let recent = false;
		for (const item of data.feed) {
			const time = Date.parse(item.reason?.indexedAt || item.post?.indexedAt);
			if (!Number.isFinite(time)) throw new Error("Bluesky feed item has no valid timestamp");
			if (time < cutoff) continue;
			recent = true;
			const post = item.post;
			if (item.reason || post.author?.did !== DID || !new RegExp(`^at://${DID}/app\\.bsky\\.feed\\.post/[a-zA-Z0-9]+$`).test(post.uri)) continue;
			const id = post.uri.split("/").at(-1);
			add(`https://bsky.brid.gy/convert/web/${post.uri}`, `https://bsky.app/profile/${DID}/post/${id}`, blueskyLinks(post.record));
		}
		if (!data.cursor || !data.feed.length || !recent) break;
		if (page === MAX_PAGES - 1) throw new Error(`Bluesky feed exceeded ${MAX_PAGES} pages within ${DAYS} days`);
		cursor = data.cursor;
	}

	let maxId;
	for (let page = 0; page < MAX_PAGES; page++) {
		const url = new URL("https://hcommons.social/api/v1/accounts/109309680295170638/statuses");
		url.search = new URLSearchParams({ limit: "40", exclude_reblogs: "true", ...(maxId ? { max_id: maxId } : {}) });
		const statuses = await json(fetchImpl, url);
		if (!Array.isArray(statuses)) throw new Error("Invalid Mastodon feed");
		let recent = false;
		for (const status of statuses) {
			const time = Date.parse(status.created_at);
			if (!Number.isFinite(time)) throw new Error("Mastodon status has no valid timestamp");
			if (time < cutoff) continue;
			recent = true;
			if (status.visibility !== "public" || !/^\d+$/.test(status.id) || typeof status.content !== "string") continue;
			add(`https://ap.brid.gy/convert/web/https://hcommons.social/users/adjb/statuses/${status.id}`,
				`https://hcommons.social/@adjb/${status.id}`, mastodonLinks(status.content));
		}
		if (statuses.length < 40 || !recent) break;
		if (page === MAX_PAGES - 1) throw new Error(`Mastodon feed exceeded ${MAX_PAGES} pages within ${DAYS} days`);
		maxId = statuses.at(-1).id;
		if (!/^\d+$/.test(maxId)) throw new Error("Invalid Mastodon pagination id");
	}

	async function submit(mention) {
		const result = await json(fetchImpl, ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(mention),
		});
		if (result.status === "success") return;
		const location = result.location;
		if (result.status !== "queued" || typeof location !== "string" ||
			!/^https:\/\/webmention\.io\/publictheology\.com\/webmention\/[a-zA-Z0-9_-]+$/.test(location)) {
			throw new Error(`Unexpected webmention response for ${mention.source}`);
		}
		for (let attempt = 0; attempt < 20; attempt++) {
			await sleep(1000);
			const status = await json(fetchImpl, location);
			if (status.status === "success") return;
			if (status.status !== "queued" && status.status !== "processing") {
				throw new Error(`Webmention ${mention.source} failed: ${status.status || "unknown status"}`);
			}
		}
		throw new Error(`Webmention ${mention.source} is still pending`);
	}
	const mentions = [...pending.values()];
	for (let i = 0; i < mentions.length; i += 5) await Promise.all(mentions.slice(i, i + 5).map(submit));
	console.log(`Checked ${DAYS} days of social posts; submitted ${mentions.length} missing webmentions.`);
	return mentions.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		await checkSocialWebmentions();
	} catch (error) {
		console.error(`::error::Social webmention check failed: ${error.message}`);
		process.exitCode = 1;
	}
}
