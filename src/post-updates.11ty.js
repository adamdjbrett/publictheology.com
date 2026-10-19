// One "updated" note per post that has a `modified` date: /<slug>/updated-<yyyyLLdd-HHmm>/.
// Bluesky cannot edit posts, so re-announcing an edited post needs a new URL. The deploy workflow
// sends this page to Bridgy Fed only when a push changes the post's `modified:` line, which makes
// a new Bluesky + Mastodon post linking to the article. Kept out of collections, the sitemap and search.
import { parseSiteDate } from "../_config/filters.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export const data = {
	eleventyExcludeFromCollections: true,
	pagination: {
		data: "collections.posts",
		size: 1,
		alias: "post",
		before: (posts) => posts.filter((p) => p.data.modified && parseSiteDate(p.data.modified).isValid),
	},
	permalink: ({ post }) => `${post.url}updated-${parseSiteDate(post.data.modified).toFormat("yyyyLLdd-HHmm")}/`,
};

export function render({ post, metadata, page }) {
	const url = metadata.url + post.url;
	const modified = parseSiteDate(post.data.modified);
	const title = String(post.data.title || "").trim();
	return `<!doctype html>
<html lang="${esc(metadata.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Updated: ${esc(title)} · ${esc(metadata.title)}</title>
<link rel="webmention" href="https://webmention.io/publictheology.com/webmention">
<link rel="pingback" href="https://webmention.io/publictheology.com/xmlrpc">
<link rel="alternate" type="application/activity+json" href="https://fed.brid.gy/r/${esc(metadata.url + page.url)}">
</head>
<body>
<article class="h-entry">
	<a class="u-bridgy-fed" href="https://fed.brid.gy/" hidden="from-humans"></a>
	<a class="u-url" href="${esc(metadata.url + page.url)}" hidden></a>
	<div class="e-content"><p>Updated: ${esc(title)}${post.data.custom_excerpt ? ` — ${esc(String(post.data.custom_excerpt).trim())}` : ""}</p>
	<p><a href="${esc(url)}">${esc(url)}</a></p></div>
	<p><time class="dt-published" datetime="${modified.toISO({ suppressMilliseconds: true })}">${modified.toFormat("dd LLL yyyy")}</time></p>
</article>
</body>
</html>
`;
}
