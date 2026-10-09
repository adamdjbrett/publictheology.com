// Verify the built site is wired for webmentions and Bridgy Fed:
//   node scripts/check-webmention-setup.mjs [siteDir=_site]
// Every page advertises the webmention.io endpoint; every post is an h-entry with e-content,
// the hidden u-bridgy-fed link, the Bridgy Fed AP alternate and the responses section;
// no test-fixture mention (scripts/fixtures/webmentions.json) leaked into the build.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] || "_site";
const pages = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".html"));
const failures = [];
const need = (ok, msg) => ok || failures.push(msg);
let posts = 0;

for (const name of pages) {
	const html = readFileSync(join(dir, name), "utf8");
	if (!html.includes("<head")) continue; // fragments
	need(html.includes('<link rel="webmention" href="https://webmention.io/publictheology.com/webmention">'), `${name}: no rel=webmention endpoint`);
	need(html.includes('<link rel="pingback" href="https://webmention.io/publictheology.com/xmlrpc">'), `${name}: no rel=pingback`);
	need(!/WM Fixture|wm-fixture/.test(html), `${name}: test fixture mention leaked into the build`);
	if (!html.includes('<meta property="og:type" content="article">')) continue;
	need(/<article class="[^"]*\bh-entry\b/.test(html), `${name}: post is not an h-entry`);
	posts++;
	need(/class="[^"]*\be-content\b/.test(html), `${name}: h-entry without e-content`);
	need(html.includes('class="u-bridgy-fed" href="https://fed.brid.gy/"'), `${name}: no u-bridgy-fed link`);
	need(/<link rel="alternate" type="application\/activity\+json" href="https:\/\/fed\.brid\.gy\/r\/https:\/\/publictheology\.com\/[^"]*\/">/.test(html), `${name}: no Bridgy Fed activity+json alternate`);
	need(html.includes('class="gh-webmentions'), `${name}: no webmentions section`);
}
need(posts > 0, "no h-entry posts found");

if (failures.length) {
	console.error(failures.join("\n"));
	process.exit(1);
}
console.log(`Webmention setup OK: ${pages.length} HTML files advertise the endpoint, ${posts} posts are bridgeable h-entries.`);
