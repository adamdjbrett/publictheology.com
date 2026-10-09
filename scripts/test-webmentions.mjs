// `npm run test:webmentions`: unit checks for the sender (discovery, link extraction, SSRF guard,
// redirects, deletes, failure reporting), the fetch shrink guard, and a full build with the hostile
// fixture (scripts/fixtures/webmentions.json) into .cache/wm-test/, asserting it renders and that
// no markup/URL from the untrusted input survives. Never touches _site/ and needs no network:
// DNS and fetch are mocked for the sender tests.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shrinkProblem } from "./fetch-webmentions.mjs";
import { assertPublicUrl, contentLinks, discover, findEndpoint, isPrivateAddress, net, run } from "./send-webmentions.mjs";

// --- endpoint discovery (W3C §3.1.2) --------------------------------------------------------
const page = "https://example.com/a/post";
assert.equal(findEndpoint('<https://e.example/wm>; rel="webmention"', "", page), "https://e.example/wm");
assert.equal(findEndpoint('<https://x.example/>; rel="other", </wm?x=1>; rel="webmention me"', "", page), "https://example.com/wm?x=1");
assert.equal(findEndpoint('<https://h.example/wm>; rel=webmention', '<link rel="webmention" href="/html">', page), "https://h.example/wm");
assert.equal(findEndpoint("", '<!-- <link rel="webmention" href="/c"> --><a rel="webmention" href="rel">x</a><link href="/l" rel="webmention">', page), "https://example.com/a/rel");
assert.equal(findEndpoint("", '<link rel="webmention" href="">', page), page);
assert.equal(findEndpoint("", '<link rel="webmentions" href="/no">', page), null);

// --- e-content link extraction (non-greedy: stops at the post's own </section></article>) ----
const post = (extra = "") =>
	`<article class="h-entry"><section class="gh-content gh-canvas e-content"><a href="https://a.example/x#f">a</a> <a href="/local/">l</a> <a href="https://fed.brid.gy/">b</a> <section><a href='https://b.example/'>n</a></section></section></article>${extra}`;
const related = '<section class="gh-related"><article class="gh-card"><section><a href="https://related.example/">r</a></section></article></section>';
assert.deepEqual(contentLinks(post(), "https://publictheology.com/p/").links, ["https://a.example/x", "https://b.example/"]);
assert.deepEqual(contentLinks(post(related), "https://publictheology.com/p/").links, ["https://a.example/x", "https://b.example/"], "links after the article leaked in");
assert.equal(contentLinks(post(related), "x:").hash, contentLinks(post(), "x:").hash, "hash must ignore content after the article");

// --- SSRF guard (DNS mocked: these names really resolve to loopback) --------------------------
const fakeDns = {
	"localtest.me": ["127.0.0.1"],
	"127.0.0.1.nip.io": ["127.0.0.1"],
	"mixed.example": ["93.184.216.34", "10.0.0.5"],
	"v6.example": ["::ffff:127.0.0.1"],
	"public.example": ["93.184.216.34", "2606:2800:220:1::1"],
	"redirector.example": ["93.184.216.34"],
	"endpoint.example": ["93.184.216.35"],
	"fed.brid.gy": ["34.120.0.1"],
	"fails.example": ["93.184.216.36"],
	"gone-endpoint.example": ["93.184.216.37"],
};
net.lookup = async (host) => {
	if (!fakeDns[host]) throw new Error(`ENOTFOUND ${host}`);
	return fakeDns[host].map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};
for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1",
	"::1", "::", "fc00::1", "fd12::1", "fe80::1", "febf::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "not-an-ip"]) {
	assert.ok(isPrivateAddress(ip), `${ip} should be private`);
}
for (const ip of ["93.184.216.34", "100.63.255.255", "100.128.0.1", "172.32.0.1", "2606:2800:220:1::1", "::ffff:93.184.216.34"]) {
	assert.ok(!isPrivateAddress(ip), `${ip} should be public`);
}
const blocked = ["http://localhost/", "http://localhost./", "http://foo.localhost/", "http://127.0.0.1/", "http://2130706433/", "http://0x7f.1/",
	"http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://localtest.me/", "http://127.0.0.1.nip.io/", "http://localtest.me./", "http://mixed.example/",
	"http://v6.example/", "http://intranet/", "ftp://public.example/", "file:///etc/passwd"];
for (const url of blocked) await assert.rejects(assertPublicUrl(url), undefined, `${url} should be blocked`);
await assert.rejects(assertPublicUrl("http://localhost./"), /blocked host localhost$/, "trailing-dot localhost must be refused by name, before DNS");
await assertPublicUrl("https://public.example/x");

// --- redirects are followed by hand and every hop re-checked; POSTs never follow ------------
const calls = [];
const respond = (status, headers = {}, body = "") => new Response(body, { status, headers });
net.fetch = async (url, opts = {}) => {
	const u = String(url);
	calls.push(`${opts.method || "GET"} ${u} redirect=${opts.redirect}`);
	if (u === "https://redirector.example/to-loopback") return respond(302, { location: "http://127.0.0.1:9/" });
	if (u === "https://redirector.example/to-nip") return respond(301, { location: "http://127.0.0.1.nip.io/" });
	if (u === "https://redirector.example/hop") return respond(302, { location: "/final" });
	if (u === "https://redirector.example/final") return respond(200, { "content-type": "text/html" }, '<link rel="webmention" href="wm">');
	if (u === "https://redirector.example/loop") return respond(302, { location: "/loop" });
	if (u === "https://public.example/linked") return respond(200, { link: '<https://endpoint.example/wm>; rel="webmention"' });
	if (u === "https://public.example/fails") return respond(200, { link: '<https://fails.example/wm>; rel="webmention"' });
	if (u === "https://public.example/sneaky") return respond(200, { link: '<http://localtest.me/wm>; rel="webmention"' });
	if (u === "https://public.example/old-link") return respond(200, { link: '<https://gone-endpoint.example/wm>; rel="webmention"' });
	if (opts.method === "POST" && u === "https://fails.example/wm") return respond(307, { location: "http://127.0.0.1/" });
	if (opts.method === "POST") return respond(202);
	return respond(404);
};
assert.equal(await discover("https://redirector.example/to-loopback"), null);
assert.equal(await discover("https://redirector.example/to-nip"), null);
assert.ok(!calls.some((c) => c.includes("127.0.0.1")), "a redirect to loopback was fetched");
assert.equal(await discover("https://redirector.example/hop"), "https://redirector.example/wm", "relative endpoint must resolve against the final hop");
assert.equal(await discover("https://redirector.example/loop"), null);
assert.equal(await discover("https://public.example/sneaky"), null, "private endpoint accepted at discovery");
assert.ok(calls.filter((c) => c.includes("/loop")).length <= 21, "redirect loop not capped");
assert.ok(calls.every((c) => c.endsWith("redirect=manual")), "fetch must never auto-follow redirects");

// --- run(): live post, deleted post, failures -> ::warning:: + step summary ------------------
const tmp = mkdtempSync(join(tmpdir(), "wm-send-"));
const site = join(tmp, "site");
mkdirSync(join(site, "live"), { recursive: true });
writeFileSync(join(site, "live/index.html"), '<article class="h-entry"><section class="e-content"><a href="https://public.example/linked">ok</a> <a href="https://public.example/fails">x</a> <a href="https://public.example/sneaky">s</a></section></article>');
writeFileSync(join(tmp, "urls.txt"), "https://publictheology.com/live/\nhttps://publictheology.com/gone/\n");
const logFile = join(tmp, "sent.json");
writeFileSync(logFile, JSON.stringify({ "https://publictheology.com/gone/": { hash: "abc", targets: { "https://public.example/old-link": "2026-01-01T00:00:00Z" } } }));
process.env.GITHUB_STEP_SUMMARY = join(tmp, "summary.md");
calls.length = 0;
const out = [];
const origLog = console.log;
console.log = (...a) => out.push(a.join(" "));
let stats;
try {
	stats = await run({ list: join(tmp, "urls.txt"), site, logFile });
} finally {
	console.log = origLog;
	delete process.env.GITHUB_STEP_SUMMARY;
}
const posts = calls.filter((c) => c.startsWith("POST"));
assert.ok(posts.includes("POST https://fed.brid.gy/webmention redirect=manual"), "Bridgy not mentioned");
assert.equal(posts.filter((c) => c.includes("fed.brid.gy")).length, 2, "Bridgy must get the live AND the deleted post");
assert.ok(posts.includes("POST https://endpoint.example/wm redirect=manual"), "linked site not mentioned");
assert.ok(posts.includes("POST https://gone-endpoint.example/wm redirect=manual"), "deleted post: logged target not re-sent");
assert.ok(!posts.some((c) => c.includes("localtest.me") || c.includes("127.0.0.1")), "POST reached a private endpoint");
assert.ok(!calls.some((c) => c.startsWith("POST http://127.0.0.1")), "POST followed a redirect");
assert.deepEqual(stats.deleted, ["https://publictheology.com/gone/"]);
assert.deepEqual(stats.failed, ["https://publictheology.com/live/ -> https://public.example/fails"]);
assert.ok(out.some((l) => l.startsWith("::warning::webmention failed (HTTP 307)")), "failed send not surfaced as ::warning::");
assert.ok(out.some((l) => /gone\/: not in .* DELETED/.test(l)), "deleted post not logged clearly");
const summary = readFileSync(join(tmp, "summary.md"), "utf8");
assert.match(summary, /Posts: 2 \(1 deleted\)/);
assert.match(summary, /FAILED: https:\/\/publictheology.com\/live\/ -> https:\/\/public.example\/fails/);
const log = JSON.parse(readFileSync(logFile, "utf8"));
assert.deepEqual(Object.keys(log), ["https://publictheology.com/live/"], "deleted post must leave the sent-log");
assert.deepEqual(Object.keys(log["https://publictheology.com/live/"].targets), ["https://public.example/linked"]);
rmSync(tmp, { recursive: true, force: true });

// --- fetch shrink guard ---------------------------------------------------------------------
assert.equal(shrinkProblem(0, 0), null);
assert.equal(shrinkProblem(0, 5), null);
assert.equal(shrinkProblem(10, 12), null);
assert.equal(shrinkProblem(10, 6), null, "a small drop is ordinary deletes");
assert.equal(shrinkProblem(10, 5), null, "exactly half is allowed");
assert.match(shrinkProblem(10, 4), />50% drop/);
assert.match(shrinkProblem(3, 0), /returned 0 mentions/);

// --- hostile fixture, full build ------------------------------------------------------------
const dir = ".cache/wm-test";
rmSync(dir, { recursive: true, force: true });
execFileSync("npx", ["buildawesome", `--output=${dir}`, "--quiet"], {
	stdio: "inherit",
	env: { ...process.env, ELEVENTY_RUN_MODE: "build", WEBMENTIONS_FILE: "scripts/fixtures/webmentions.json" },
});
const html = readFileSync(`${dir}/borderless-public-theology/index.html`, "utf8");
const start = html.indexOf('<section class="gh-webmentions');
const section = html.slice(start, html.indexOf("</section>", start));
for (const expected of ["3 Likes", "1 Repost", "4 Replies and mentions", "WM Fixture Alice", "Carol Reposter", "Great piece &amp; thanks!", "Erin Blogger",
	"mentioned this post", "WM Party", "Numeric “quotes” 😀 bad:&amp;#xD800; huge:&amp;#99999999; nul:&amp;#0;", 'target="_blank" rel="noopener"']) {
	assert.ok(section.includes(expected), `fixture render is missing: ${expected}`);
}
assert.ok(!/<script|<b>|\son\w+\s*=|javascript:/i.test(section), "untrusted markup or URL survived in the webmentions section");
assert.ok(section.includes("&lt;script&gt;alert(4)&lt;/script&gt;"), "escaped text in content should stay visible as text");
assert.ok(!section.includes("WM Private") && !section.includes("WM Wrong Host"), "private / foreign-host mentions rendered");
assert.ok(!section.includes("WM Duplicate"), "mention without wm-id rendered twice");
assert.ok(!section.includes("evil.example/x.png") && !section.includes("plain-http.png"), "non-allow-listed / non-https avatar rendered");
assert.ok(section.includes('src="https://cdn.bsky.app/img/avatar/fay.jpg"') && section.includes('src="https://avatars.webmention.io/cdn.bsky.app/alice.jpg"'), "allow-listed avatars missing");
assert.ok(section.includes('aria-label="🎉 WM Party">🎉</span>'), "astral initial broken");
assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(section), "lone surrogate in output");
assert.ok(!/<a [^>]*title=/.test(section), "facepile title duplicates alt");
rmSync(dir, { recursive: true, force: true });
console.log("Webmention tests passed (discovery, links, SSRF guard, redirects, deletes, warnings, shrink guard, hostile fixture render).");
