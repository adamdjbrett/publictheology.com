// `npm run test:webmentions`: unit checks for endpoint discovery + a full build with the hostile
// fixture (scripts/fixtures/webmentions.json) into .cache/wm-test/, asserting it renders and that
// no markup/URL from the untrusted input survives. Never touches _site/ or the network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { contentLinks, findEndpoint } from "./send-webmentions.mjs";

const page = "https://example.com/a/post";
assert.equal(findEndpoint('<https://e.example/wm>; rel="webmention"', "", page), "https://e.example/wm");
assert.equal(findEndpoint('<https://x.example/>; rel="other", </wm?x=1>; rel="webmention me"', "", page), "https://example.com/wm?x=1");
assert.equal(findEndpoint('<https://h.example/wm>; rel=webmention', '<link rel="webmention" href="/html">', page), "https://h.example/wm");
assert.equal(findEndpoint("", '<!-- <link rel="webmention" href="/c"> --><a rel="webmention" href="rel">x</a><link href="/l" rel="webmention">', page), "https://example.com/a/rel");
assert.equal(findEndpoint("", '<link rel="webmention" href="">', page), page);
assert.equal(findEndpoint("", '<link rel="webmentions" href="/no">', page), null);
const links = contentLinks('<article><section class="gh-content gh-canvas e-content"><a href="https://a.example/x#f">a</a> <a href="/local/">l</a> <a href="https://fed.brid.gy/">b</a> <section><a href=\'https://b.example/\'>n</a></section></section></article>', "https://publictheology.com/p/");
assert.deepEqual(links.links, ["https://a.example/x", "https://b.example/"]);

const out = ".cache/wm-test";
rmSync(out, { recursive: true, force: true });
execFileSync("npx", ["buildawesome", `--output=${out}`, "--quiet"], {
	stdio: "inherit",
	env: { ...process.env, ELEVENTY_RUN_MODE: "build", WEBMENTIONS_FILE: "scripts/fixtures/webmentions.json" },
});
const html = readFileSync(`${out}/borderless-public-theology/index.html`, "utf8");
const section = html.slice(html.indexOf('<section class="gh-webmentions'), html.indexOf("</section>", html.indexOf('<section class="gh-webmentions')));
for (const expected of ["2 Likes", "1 Repost", "3 Replies and mentions", "WM Fixture Alice", "Carol Reposter", "Great piece &amp; thanks!", "Erin Blogger", "mentioned this post"]) {
	assert.ok(section.includes(expected), `fixture render is missing: ${expected}`);
}
assert.ok(!/<script|<b>|\son\w+\s*=|javascript:/i.test(section), "untrusted markup or URL survived in the webmentions section");
assert.ok(section.includes("&lt;script&gt;alert(4)&lt;/script&gt;"), "escaped text in content should stay visible as text");
assert.ok(!section.includes("WM Private") && !section.includes("WM Wrong Host"), "private / foreign-host mentions rendered");
rmSync(out, { recursive: true, force: true });
console.log("Webmention tests passed (discovery, link extraction, hostile fixture render).");
