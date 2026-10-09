import { readFileSync } from "node:fs";
import { load as loadYaml } from "js-yaml";

export const INTERNAL_TAGS = new Set(["posts", "pages", "all", "featured", "page"]);

// Canonical display names, keyed by slug (src/_data/taxonomy.yaml).
let names = {};
try {
	names = loadYaml(readFileSync(new URL("../src/_data/taxonomy.yaml", import.meta.url), "utf8")) || {};
} catch {
	names = {};
}
const titleCase = (slug) => slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export function publicPostTags(data = {}) {
	const values = data.postTags ?? data.tags ?? [];
	return (Array.isArray(values) ? values : [values]).filter((value) => {
		const name = typeof value === "object" ? value?.name : value;
		return name && !INTERNAL_TAGS.has(String(name));
	});
}

// Every spelling of a term ("Public Theology", "public-theology", "#Public-Theology ")
// collapses to one slug, one URL and one display name, so tag pages don't depend on
// which post happened to be read first.
export function normalizeTerms(values, type, slugify) {
	const vocab = names[type === "tag" ? "tags" : "categories"] || {};
	const seen = new Set();
	return (Array.isArray(values) ? values : values ? [values] : []).map((value) => {
		const source = typeof value === "object" ? value : { name: value };
		const raw = String(source.name || "").replace(/^#+/, "").trim();
		const slug = source.slug || slugify(raw);
		const name = vocab[slug] || titleCase(slug);
		return { name, slug, url: source.url || `/${type}/${slug}/` };
	}).filter((term) => term.slug && !seen.has(term.slug) && seen.add(term.slug));
}
