import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";
import assert from "node:assert/strict";
import { CORE_SCHEMA, load as loadYaml } from "js-yaml";
import { publicPostTags } from "../_config/taxonomy.js";

assert.deepEqual(publicPostTags({ tags: ["posts", "public-theology", { name: "pages" }, { name: "faith" }] }), ["public-theology", { name: "faith" }]);
assert.deepEqual(publicPostTags({ tags: "faith" }), ["faith"]);

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
	if (!draft) {
		const data = loadYaml(readFileSync(join("src/posts", name), "utf8").split(/^---$/m)[1], { schema: CORE_SCHEMA });
		const html = readFileSync(join(output, slug, "index.html"), "utf8");
		const posting = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
			.map((match) => JSON.parse(match[1])).find((value) => value["@type"] === "BlogPosting");
		assert.ok(posting, `${name}: missing BlogPosting metadata`);
		if (data.description) assert.equal(posting.description, data.description, `${name}: description lost`);
		if (data.image) assert.equal(new URL(posting.image[0]).pathname, new URL(data.image, "https://publictheology.com").pathname, `${name}: image lost`);
		const toc = html.match(/<details id="toc" class="post-toc" open>([\s\S]*?)<\/details>/);
		if (data.toc) {
			assert.ok(toc, `${name}: TOC must start open`);
			assert.ok(toc[1].includes('<summary id="toc-title">☞ Table of Contents</summary>'), `${name}: incorrect TOC title`);
			for (const [, id] of toc[1].matchAll(/href="#([^"]+)"/g)) {
				assert.ok(html.includes(`id="${id}"`), `${name}: missing TOC target ${id}`);
			}
		} else {
			assert.equal(toc, null, `${name}: TOC rendered when disabled`);
		}
	}
}
for (const name of readdirSync("src/pages").filter((name) => name.endsWith(".md"))) {
	const slug = basename(name, ".md");
	if (!existsSync(join(output, slug, "index.html"))) throw new Error(`Missing page route: /${slug}/`);
}
for (const name of readdirSync("src/authors").filter((name) => name.endsWith(".md"))) {
	const slug = basename(name, ".md");
	if (!existsSync(join(output, "authors", slug, "index.html"))) throw new Error(`Missing author route: /authors/${slug}/`);
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
