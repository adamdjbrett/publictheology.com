import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";

const output = "_site";
const files = (root) => readdirSync(root, { recursive: true })
	.filter((name) => statSync(join(root, name)).isFile());
const htmlFiles = files(output).filter((name) => name.endsWith(".html"));
const required = [
	"index.html", "search/index.html", "tags/index.html", "categories/index.html",
	"feed.xml", "feed/feed.json", "feed/feed.rss", "sitemap.xml",
];

for (const name of required) {
	if (!existsSync(join(output, name))) throw new Error(`Missing required output: /${name}`);
}
for (const name of readdirSync("src/posts").filter((name) => name.endsWith(".md"))) {
	const slug = basename(name, ".md").replace(/^\d{4}-\d{2}-\d{2}-/, "");
	const draft = /^published:\s*false\b/m.test(readFileSync(join("src/posts", name), "utf8"));
	if (draft === existsSync(join(output, slug, "index.html"))) throw new Error(draft ? `Draft was published: /${slug}/` : `Missing post route: /${slug}/`);
}
for (const name of readdirSync("src/pages").filter((name) => name.endsWith(".md"))) {
	const slug = basename(name, ".md");
	if (!existsSync(join(output, slug, "index.html"))) throw new Error(`Missing page route: /${slug}/`);
}
for (const slug of readFileSync("src/_data/authors.yaml", "utf8").matchAll(/^\s*slug:\s*["']?([^\s"']+)/gm)) {
	if (!existsSync(join(output, "author", slug[1], "index.html"))) throw new Error(`Missing author route: /author/${slug[1]}/`);
}
if (!existsSync(join(output, "pagefind/pagefind-entry.json"))) throw new Error("Pagefind index was not generated");

const canonicalUrls = new Set();
const missing = new Set();
for (const name of htmlFiles) {
	const html = readFileSync(join(output, name), "utf8");
	for (const json of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(json[1]);
	const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1];
	if (canonical) {
		if (canonicalUrls.has(canonical)) throw new Error(`Duplicate canonical URL: ${canonical}`);
		canonicalUrls.add(canonical);
	}
	for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)) {
		const value = match[1].replaceAll("&amp;", "&");
		if (/^(?:#|mailto:|tel:|data:|javascript:|\/\/)/i.test(value)) continue;
		let url;
		try { url = new URL(value, `https://publictheology.com/${name}`); } catch { continue; }
		if (url.hostname !== "publictheology.com") continue;
		const pathname = decodeURIComponent(url.pathname);
		const target = normalize(join(output, pathname));
		if (!target.startsWith(normalize(`${output}/`))) continue;
		if (!existsSync(target) && !existsSync(join(target, "index.html"))) missing.add(`${name}: ${pathname}`);
	}
}
if (missing.size) throw new Error(`Broken local references:\n${[...missing].join("\n")}`);

for (const name of files(output).filter((name) => name.endsWith(".css"))) {
	const css = readFileSync(join(output, name), "utf8");
	for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
		const value = match[1].split(/[?#]/)[0];
		if (/^(?:data:|https?:|\/\/)/i.test(value)) continue;
		const target = value.startsWith("/") ? join(output, value) : join(output, dirname(name), value);
		if (!existsSync(normalize(target))) missing.add(`${name}: ${value}`);
	}
}
if (missing.size) throw new Error(`Broken local references:\n${[...missing].join("\n")}`);

console.log(`Verified ${htmlFiles.length} HTML files, ${canonicalUrls.size} canonical URLs, Pagefind, drafts, JSON-LD, and local references.`);
