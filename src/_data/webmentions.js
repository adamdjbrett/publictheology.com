// Webmentions received via webmention.io (incl. Bridgy Fed backfeed from Mastodon/Bluesky),
// grouped by post path: { "/slug/": { likes, reposts, replies } }.
// Source: .cache/webmentions.json, written by scripts/fetch-webmentions.mjs before the build.
// Missing/unreadable file = no mentions, so the build never needs a token or the network.
// WEBMENTIONS_FILE overrides the path (used only by `npm run test:webmentions`).
// Everything here is untrusted input: content is reduced to plain text (the template's
// autoescape then escapes it) and only http(s) URLs survive.
import { readFileSync } from "node:fs";

const FILE = process.env.WEBMENTIONS_FILE || ".cache/webmentions.json";
const HOSTS = new Set(["publictheology.com", "www.publictheology.com"]);
const MAX_TEXT = 600;
// Avatars are hotlinked, so only https images from these proxies/CDNs are shown (webmention.io
// re-hosts most author photos on avatars.webmention.io; Bluesky backfeed uses cdn.bsky.app).
// Anything else falls back to the author's initial.
const AVATAR_HOSTS = new Set(["avatars.webmention.io", "cdn.bsky.app"]);

const httpUrl = (value) => {
	try {
		const url = new URL(String(value));
		return /^https?:$/.test(url.protocol) ? url.href : "";
	} catch {
		return "";
	}
};

const avatarUrl = (value) => {
	const url = httpUrl(value);
	return url && url.startsWith("https://") && AVATAR_HOSTS.has(new URL(url).hostname) ? url : "";
};

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntity = (m, name) => {
	const lower = name.toLowerCase();
	if (lower[0] !== "#") return ENTITIES[lower] ?? m;
	const code = lower[1] === "x" ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
	// Invalid, surrogate or NUL code points stay as the literal text (then autoescaped).
	return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : m;
};

// "/Slug/index.html", "/slug" and "/%73lug/" all key as "/slug/" (the template looks up page.url | lower).
const pathKey = (pathname) => {
	let path = pathname;
	try {
		path = decodeURIComponent(pathname);
	} catch {}
	path = path.toLowerCase().replace(/index\.html$/, "");
	return path.endsWith("/") ? path : `${path}/`;
};
function plainText(value) {
	const text = String(value || "")
		.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
		.replace(/<br\s*\/?>|<\/p>/gi, "\n")
		.replace(/<[^>]*>/g, " ")
		.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, decodeEntity)
		.replace(/[ \t\r\f\v]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim();
	return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trimEnd()}…` : text;
}

function clean(entry) {
	const author = entry.author || {};
	const name = plainText(author.name).slice(0, 80) || "Someone";
	const date = new Date(entry.published || entry["wm-received"] || 0);
	return {
		id: entry["wm-id"],
		type: entry["wm-property"],
		// Bridgy Fed sources are brid.gy proxy pages; `url` is the original Mastodon/Bluesky post.
		url: httpUrl(entry.url) || httpUrl(entry["wm-source"]),
		date: Number.isNaN(date.getTime()) ? null : date,
		text: plainText(entry.content?.text || entry.content?.html || entry.summary || ""),
		author: {
			name,
			initial: (Array.from(name)[0] || "?").toUpperCase(), // Array.from: no lone surrogates
			url: httpUrl(author.url),
			photo: avatarUrl(author.photo),
		},
	};
}

const BUCKET = {
	"like-of": "likes",
	"repost-of": "reposts",
	"in-reply-to": "replies",
	"mention-of": "replies",
	// ponytail: bookmark-of / rsvp are ignored; add a bucket if they ever show up.
};

export default function () {
	let children = [];
	try {
		children = JSON.parse(readFileSync(FILE, "utf8")).children || [];
	} catch {
		return {};
	}
	const byPath = {};
	const seen = new Set();
	for (const entry of children) {
		const bucket = BUCKET[entry?.["wm-property"]];
		const id = entry?.["wm-id"] ?? `${entry?.["wm-source"]}|${entry?.["wm-target"]}`;
		if (!bucket || entry["wm-private"] || seen.has(id)) continue;
		let target;
		try {
			target = new URL(entry["wm-target"]);
		} catch {
			continue;
		}
		if (!HOSTS.has(target.hostname)) continue;
		seen.add(id);
		const path = pathKey(target.pathname);
		byPath[path] ??= { likes: [], reposts: [], replies: [] };
		byPath[path][bucket].push(clean(entry));
	}
	for (const group of Object.values(byPath)) {
		group.replies.sort((a, b) => (a.date || 0) - (b.date || 0)); // oldest first, like a thread
	}
	return byPath;
}
