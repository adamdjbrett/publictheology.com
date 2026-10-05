export const INTERNAL_TAGS = new Set(["posts", "pages", "all", "featured", "page"]);

export function publicPostTags(data = {}) {
	const values = data.postTags ?? data.tags ?? [];
	return (Array.isArray(values) ? values : [values]).filter((value) => {
		const name = typeof value === "object" ? value?.name : value;
		return name && !INTERNAL_TAGS.has(String(name));
	});
}

export function normalizeTerms(values, type, slugify) {
	return (Array.isArray(values) ? values : values ? [values] : []).map((value) => {
		const source = typeof value === "object" ? value : { name: value };
		const name = String(source.name || "").trim();
		const slug = source.slug || slugify(name);
		return { name, slug, url: source.url || `/${type}/${slug}/` };
	}).filter((term) => term.name);
}
