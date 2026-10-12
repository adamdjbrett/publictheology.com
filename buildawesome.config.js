import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { parse, resolve } from "node:path";
import sharp from "sharp";
import { load as loadYaml } from "js-yaml";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import markdownItFootnote from "markdown-it-footnote";
import pluginTOC from "@uncenter/eleventy-plugin-toc";
import pluginFilters from "./_config/filters.js";
import { normalizeTerms, publicPostTags } from "./_config/taxonomy.js";

// Pages CMS authors often enter bare values ("0009-…", "x.hcommons.org", "@me.bsky.social")
// in the profile-link fields; turn them into absolute URLs so they don't render as relative links.
function profileUrls(data) {
	const out = {};
	const handle = (v) => v.replace(/^@/, "");
	const rules = {
		orcid: (v) => (/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(v) ? `https://orcid.org/${v}` : v),
		bluesky: (v) => (/^@?[\w.-]+\.[a-z]{2,}$/i.test(v) ? `https://bsky.app/profile/${handle(v)}` : v),
		x: (v) => (/^@?\w{1,15}$/.test(v) ? `https://x.com/${handle(v)}` : v),
		mastodon: (v) => v.replace(/^@?([\w.]+)@([\w.-]+\.[a-z]{2,})$/i, "https://$2/@$1"),
		hcommons: (v) => v,
		website: (v) => v,
	};
	for (const [field, fix] of Object.entries(rules)) {
		const v = String(data[field] ?? "").trim();
		if (!v) continue;
		const fixed = fix(v);
		out[field] = /^[a-z][a-z\d+.-]*:/i.test(fixed) ? fixed : `https://${fixed.replace(/^\/+/, "")}`;
	}
	return out;
}

// Card thumbnails: originals run 1–2K px wide but cards show them at 100–400 px.
// Resized webp copies go to .cache/thumbs/w<N>/ (kept between CI runs), served at /assets/images/w<N>/.
const THUMB_WIDTHS = [400, 1000];
const THUMB_SRC = "src/assets/images";
const THUMB_OUT = ".cache/thumbs";
const thumbable = (f) => /\.(jpe?g|png|webp)$/i.test(f);
async function buildThumbs() {
	const files = readdirSync(THUMB_SRC).filter(thumbable);
	const jobs = THUMB_WIDTHS.flatMap((w) => {
		mkdirSync(`${THUMB_OUT}/w${w}`, { recursive: true });
		return files.map((f) => [w, `${THUMB_SRC}/${f}`, `${THUMB_OUT}/w${w}/${parse(f).name}.webp`]);
	});
	// Only missing/stale thumbs are made, all at once (sharp runs them on its own thread pool).
	await Promise.all(
		jobs
			.filter(([, src, out]) => !existsSync(out) || statSync(out).mtimeMs < statSync(src).mtimeMs)
			.map(([w, src, out]) => sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: 72 }).toFile(out)),
	);
}

export default async function (buildAwesomeConfig) {
	buildAwesomeConfig.on("eleventy.before", buildThumbs);
	for (const w of THUMB_WIDTHS) buildAwesomeConfig.addPassthroughCopy({ [`${THUMB_OUT}/w${w}`]: `/assets/images/w${w}` });
	// thumb(400): "/assets/images/x.jpg" → "/assets/images/w400/x.webp"; anything else (remote, gif, svg, subdirs) unchanged.
	buildAwesomeConfig.addFilter("thumb", (url = "", w = THUMB_WIDTHS[0]) =>
		/^\/assets\/images\/[^/]+$/.test(url) && thumbable(url) ? `/assets/images/w${w}/${parse(url).name}.webp` : url,
	);
	buildAwesomeConfig.addDataExtension("yaml", loadYaml);
	buildAwesomeConfig.addGlobalData("siteAuthors", () =>
		readdirSync("src/authors").filter((f) => f.endsWith(".md")).map((f) => {
			const slug = f.slice(0, -3);
			const data = loadYaml(readFileSync(`src/authors/${f}`, "utf8").split(/^---$/m)[1]) || {};
			// Pages CMS sometimes stores a bare upload name ("darryl-washington"); point it at the webp.
			if (data.profile_image && !/[/:]/.test(data.profile_image)) {
				const base = String(data.profile_image).replace(/\.(png|jpe?g|webp)$/i, "");
				data.profile_image = `/assets/images/${base}.webp`;
			}
			return { ...data, ...profileUrls(data), key: slug, slug };
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
	// Post-body images sit below the hero: lazy-load them.
	markdown.renderer.rules.image = ((render) => (tokens, i, ...rest) => {
		tokens[i].attrSet("loading", "lazy");
		tokens[i].attrSet("decoding", "async");
		return render(tokens, i, ...rest);
	})(markdown.renderer.rules.image);
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
