import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { load as loadYaml } from "js-yaml";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import markdownItFootnote from "markdown-it-footnote";
import pluginTOC from "@uncenter/eleventy-plugin-toc";
import pluginFilters from "./_config/filters.js";
import { normalizeTerms, publicPostTags } from "./_config/taxonomy.js";

export default async function (buildAwesomeConfig) {
	buildAwesomeConfig.addDataExtension("yaml", loadYaml);
	buildAwesomeConfig.addGlobalData("siteAuthors", () =>
		readdirSync("src/authors").filter((f) => f.endsWith(".md")).map((f) => {
			const slug = f.slice(0, -3);
			const data = loadYaml(readFileSync(`src/authors/${f}`, "utf8").split(/^---$/m)[1]) || {};
			return { ...data, key: slug, slug };
		}),
	);

	buildAwesomeConfig.addPreprocessor("drafts", "*", (data) => {
		if (process.env.ELEVENTY_RUN_MODE === "build" && data.published === false) {
			return false;
		}
	});

	buildAwesomeConfig.addPassthroughCopy({ "./src/assets": "/assets" });
	buildAwesomeConfig.addPassthroughCopy({ "./src/public": "/" });
	buildAwesomeConfig.addWatchTarget("src/assets/css/**/*.css");
	buildAwesomeConfig.addWatchTarget("src/assets/js/**/*.js");
	buildAwesomeConfig.addPlugin(pluginFilters);
	buildAwesomeConfig.addPlugin(pluginTOC, {
		tags: ["h2", "h3", "h4"],
		wrapper: (items) =>
			`<nav id="toc" class="post-toc" aria-labelledby="toc-title"><h2 id="toc-title">Contents</h2>${items}</nav>`,
	});

	const markdown = markdownIt({ html: true, linkify: true, typographer: true })
		.use(markdownItFootnote)
		.use(markdownItAnchor, {
			level: [2, 3, 4],
			slugify: (value) => buildAwesomeConfig.getFilter("slugify")(value),
		});
	// Pages CMS's rich-text editor saves `[^1]` as `\[^1\]`; unescape so footnotes still parse.
	// ponytail: also unescapes inside code spans/blocks; tokenise first if a post ever needs a literal `\[^x\]`.
	markdown.core.ruler.before("normalize", "pagescms_footnotes", (state) => {
		state.src = state.src.replace(/\\\[\^([^\]\s\\]+)\\\]/g, "[^$1]");
	});
	buildAwesomeConfig.setLibrary("md", markdown);

	let contentCache;
	const content = (api) => {
		if (contentCache) return contentCache;
		const posts = api.getFilteredByTag("posts").sort((a, b) => b.date - a.date);
		const pages = api.getFilteredByTag("pages");
		const buildTerms = (type) => {
			const groups = new Map();
			for (const post of posts) {
				const values = type === "tag" ? publicPostTags(post.data) : post.data.categories;
				for (const term of normalizeTerms(values, type, (value) => buildAwesomeConfig.getFilter("slugify")(value))) {
					const key = term.url.toLowerCase();
					const group = groups.get(key) || { ...term, posts: [] };
					group.posts.push(post);
					groups.set(key, group);
				}
			}
			return [...groups.values()]
				.map((term) => ({ ...term, count: term.posts.length }))
				.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
		};
		contentCache = { posts, pages, tags: buildTerms("tag"), categories: buildTerms("category") };
		return contentCache;
	};

	buildAwesomeConfig.on("eleventy.before", () => { contentCache = undefined; });
	buildAwesomeConfig.addCollection("posts", (api) => content(api).posts);
	buildAwesomeConfig.addCollection("pages", (api) => content(api).pages);
	buildAwesomeConfig.addCollection("tags", (api) => content(api).tags);
	buildAwesomeConfig.addCollection("topics", (api) => content(api).tags);
	buildAwesomeConfig.addCollection("categories", (api) => content(api).categories);

	buildAwesomeConfig.on("eleventy.after", ({ dir }) => {
		if (process.env.ELEVENTY_RUN_MODE !== "build") return;
		const executable = resolve("node_modules", ".bin", process.platform === "win32" ? "pagefind.cmd" : "pagefind");
		execFileSync(executable, ["--site", dir.output, "--glob", "**/*.html"], { stdio: "inherit" });
	});
}

export const config = {
	templateFormats: ["md", "njk", "html", "11ty.js"],
	markdownTemplateEngine: "njk",
	htmlTemplateEngine: "njk",
	dir: { input: "src", includes: "_includes", data: "_data", output: "_site" },
};
