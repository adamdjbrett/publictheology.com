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

const httpUrl = (value) => {
	try {
		const url = new URL(String(value));
		return /^https?:$/.test(url.protocol) ? url.href : "";
	} catch {
		return "";
	}
};

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function plainText(value) {
	const text = String(value || "")
		.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
		.replace(/<br\s*\/?>|<\/p>/gi, "\n")
		.replace(/<[^>]*>/g, " ")
		.replace(/&(#?\w+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
		.replace(/[ \t\r\f\v]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim();
	return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trimEnd()}…` : text;
}

function clean(entry) {
	const author = entry.author || {};
	const date = new Date(entry.published || entry["wm-received"] || 0);
	return {
		id: entry["wm-id"],
		type: entry["wm-property"],
		// Bridgy Fed sources are brid.gy proxy pages; `url` is the original Mastodon/Bluesky post.
		url: httpUrl(entry.url) || httpUrl(entry["wm-source"]),
		date: Number.isNaN(date.getTime()) ? null : date,
		text: plainText(entry.content?.text || entry.content?.html || entry.summary || ""),
		author: {
			name: plainText(author.name).slice(0, 80) || "Someone",
			url: httpUrl(author.url),
			photo: httpUrl(author.photo),
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
		if (!bucket || entry["wm-private"] || seen.has(entry["wm-id"])) continue;
		let target;
		try {
			target = new URL(entry["wm-target"]);
		} catch {
			continue;
		}
		if (!HOSTS.has(target.hostname)) continue;
		seen.add(entry["wm-id"]);
		const path = target.pathname.endsWith("/") ? target.pathname : `${target.pathname}/`;
		byPath[path] ??= { likes: [], reposts: [], replies: [] };
		byPath[path][bucket].push(clean(entry));
	}
	for (const group of Object.values(byPath)) {
		group.replies.sort((a, b) => (a.date || 0) - (b.date || 0)); // oldest first, like a thread
	}
	return byPath;
}
