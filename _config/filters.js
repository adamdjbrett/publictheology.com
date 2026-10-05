import { DateTime } from "luxon";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";
import { normalizeTerms, publicPostTags } from "./taxonomy.js";

// Read the site timezone from metadata.yaml so date filters default to it.
const metadataPath = fileURLToPath(new URL("../src/_data/metadata.yaml", import.meta.url));
let SITE_TZ = "UTC";
try {
	const meta = loadYaml(readFileSync(metadataPath, "utf-8")) || {};
	if (meta.timezone) SITE_TZ = meta.timezone;
} catch {
	SITE_TZ = "UTC";
}

// Treat a stored date as wall-clock time in `zone` (keepLocalTime), so a
// date-only front-matter value never drifts across the UTC boundary.
function inZone(dateObj, zone) {
	return DateTime.fromJSDate(dateObj, { zone: "utc" }).setZone(zone || SITE_TZ, {
		keepLocalTime: true,
	});
}

/**
 * Interpolate {placeholder} tokens in a string from a vars object.
 * Mirrors Ghost's {{t "…" key=value}} helper.
 */
function interpolate(str, vars = {}) {
	return String(str).replace(/\{(\w+)\}/g, (match, name) =>
		Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match,
	);
}

export default function (eleventyConfig) {
	// --- i18n: {{ "Latest" | t }} or {{ "Subscribe to {sitetitle}" | t({ sitetitle: metadata.title }) }}
	eleventyConfig.addFilter("t", (key, vars) => interpolate(key, vars));

	// --- Dates (default to the site timezone from metadata.yaml) --------------
	eleventyConfig.addFilter("readableDate", (dateObj, format = "dd LLL yyyy", zone) =>
		inZone(dateObj, zone).toFormat(format),
	);

	eleventyConfig.addFilter("htmlDateString", (dateObj, zone) =>
		inZone(dateObj, zone).toFormat("yyyy-LL-dd"),
	);

	// RFC 3339 timestamp in the site timezone (for the Atom feed).
	eleventyConfig.addFilter("rfc3339", (dateObj, zone) =>
		inZone(dateObj, zone).toISO(),
	);

	eleventyConfig.addFilter("year", () => `${new Date().getFullYear()}`);

	// --- Reading time (Ghost's {{reading_time}}) ------------------------------
	// ~275 wpm over the rendered text content.
	eleventyConfig.addFilter("readingTime", (content) => {
		const text = String(content || "").replace(/<[^>]+>/g, " ");
		const words = text.split(/\s+/).filter(Boolean).length;
		return Math.max(1, Math.round(words / 275));
	});

	// --- Excerpt: strip HTML, truncate ----------------------------------------
	eleventyConfig.addFilter("excerpt", (content, words = 40) => {
		const text = String(content || "")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		const parts = text.split(" ");
		return parts.length > words ? parts.slice(0, words).join(" ") + "…" : text;
	});

	// --- Small array helpers used by the templates ----------------------------
	eleventyConfig.addFilter("limit", (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : arr));
	eleventyConfig.addFilter("head", (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : arr));
	eleventyConfig.addFilter("skip", (arr, n) => (Array.isArray(arr) ? arr.slice(n) : arr));
	eleventyConfig.addFilter("findTerm", (terms, name) =>
		(terms || []).find((term) => term.name.toLowerCase() === String(name).toLowerCase()),
	);

	// Resolve author keys on a post to full author objects from _data/authors.
	eleventyConfig.addFilter("resolveAuthors", (keys, authors) => {
		if (!keys || !authors) return [];
		const list = Array.isArray(keys) ? keys : String(keys).split(",").map((k) => k.trim());
		return list
			.map((key) => authors.find((a) => a.key === key))
			.filter(Boolean);
	});

	eleventyConfig.addFilter("resolvedPostTags", (preferred, legacy) =>
		publicPostTags({ postTags: preferred, tags: legacy }),
	);
	eleventyConfig.addFilter("taxonomyTerms", (values, type) =>
		normalizeTerms(values, type, (value) => eleventyConfig.getFilter("slugify")(value)),
	);

	// Up to `n` other posts that share a public tag with the current post.
	eleventyConfig.addFilter("relatedPosts", (post, posts, n = 3) => {
		if (!post || !posts) return [];
		const own = new Set(publicPostTags(post.data).map((term) => typeof term === "object" ? term.name : term));
		if (own.size === 0) return [];
		return posts
			.filter(
				(p) =>
					p.url !== post.url &&
					publicPostTags(p.data).some((term) => own.has(typeof term === "object" ? term.name : term)),
			)
			.slice(0, n);
	});

	// Filter internal tags out of a tag list.
	eleventyConfig.addFilter("publicTags", (tags) => publicPostTags({ tags }));

	eleventyConfig.addFilter("tocBacklinks", (content) =>
		String(content || "").replace(
			/<h([2-4])([^>]*)>/g,
			'<h$1$2><a class="toc-back" href="#toc" aria-label="Back to contents">↑</a>',
		),
	);

	// Assemble a schema.org BlogPosting object for a post's JSON-LD. Takes a
	// plain object of primitives (+ resolved author objects) and returns the
	// structured-data object, so templates avoid hand-building JSON.
	eleventyConfig.addFilter("postingLd", (o = {}) => {
		const ld = {
			"@context": "https://schema.org",
			"@type": "BlogPosting",
			headline: o.title,
			name: o.title,
			description: o.description,
			url: o.url,
			mainEntityOfPage: o.url,
			datePublished: o.date,
			dateModified: o.date,
			inLanguage: o.lang,
			isPartOf: o.blogId ? { "@id": o.blogId } : { "@type": "Blog", name: o.siteName, url: o.siteUrl + "/" },
			publisher: o.publisher,
		};
		if (o.image) ld.image = [o.image];
		ld.author = (o.authors || []).map((a) => ({
			"@type": "Person",
			name: a.name,
			url: o.siteUrl + "/author/" + a.slug + "/",
		}));
		return ld;
	});

	// `slug` was removed in Eleventy v4 (11ty/eleventy#3893) but the templates
	// use it for tag/author URLs. Re-add it as a thin alias over the built-in,
	// well-tested `slugify` so there is a SINGLE slug algorithm — using two
	// different implementations risks tag pages and their links diverging.
	eleventyConfig.addFilter("slug", function (input) {
		return eleventyConfig.getFilter("slugify")(String(input ?? ""));
	});
}
