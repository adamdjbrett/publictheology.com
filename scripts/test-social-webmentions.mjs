import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkSocialWebmentions } from "./check-social-webmentions.mjs";

const did = "did:plc:3vmq5usrh3yvhbrrzf4ymo23";
const target = "https://publictheology.com/article/";
const now = Date.parse("2026-11-14T23:00:00Z");
const recent = "2026-11-14T22:00:00Z";
const post = (id, uri = target) => ({
	uri: `at://${did}/app.bsky.feed.post/${id}`,
	author: { did },
	indexedAt: recent,
	record: { embed: { external: { uri } }, facets: [{ features: [{ uri }] }] },
});
const status = (id, visibility = "public") => ({
	id, visibility, created_at: recent, content: `<p><a href="${target}">article</a></p>`,
});

test("discovers public posts, skips cached mentions and waits for verification", async () => {
	const dir = await mkdtemp(join(tmpdir(), "social-wm-"));
	try {
		const cacheFile = join(dir, "cache.json");
		await writeFile(cacheFile, JSON.stringify({ children: [{
			"wm-source": `https://bsky.brid.gy/convert/web/at://${did}/app.bsky.feed.post/cached`,
			"wm-target": target,
		}] }));
		const submissions = [];
		let checked = 0;
		const fakeFetch = async (input, options = {}) => {
			const url = String(input);
			if (url.startsWith("https://public.api.bsky.app/")) return Response.json({ feed: [
				{ post: post("cached") }, { post: post("new") },
				{ post: post("other", "https://publictheology.com.evil.example/article/") },
				{ post: post("repost"), reason: { indexedAt: recent } },
			] });
			if (url.startsWith("https://hcommons.social/api/")) return Response.json([status("123"), status("124", "unlisted")]);
			if (url === "https://webmention.io/publictheology.com/webmention") {
				submissions.push(Object.fromEntries(options.body));
				return Response.json({ status: "queued", location: `https://webmention.io/publictheology.com/webmention/${submissions.length}` }, { status: 201 });
			}
			if (url.startsWith("https://webmention.io/publictheology.com/webmention/")) {
				checked++;
				return Response.json({ status: "success" });
			}
			throw new Error(`Unexpected request: ${url}`);
		};
		assert.equal(await checkSocialWebmentions({ fetchImpl: fakeFetch, cacheFile, now, sleep: async () => {} }), 2);
		assert.equal(checked, 2);
		assert.deepEqual(submissions.map((s) => s.source), [
			`https://bsky.brid.gy/convert/web/at://${did}/app.bsky.feed.post/new`,
			"https://ap.brid.gy/convert/web/https://hcommons.social/users/adjb/statuses/123",
		]);
		assert.ok(submissions.every((s) => s.target === target));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("reports a rejected or unverified submission", async () => {
	const dir = await mkdtemp(join(tmpdir(), "social-wm-"));
	const fakeFetch = async (input) => {
		const url = String(input);
		if (url.startsWith("https://public.api.bsky.app/")) return Response.json({ feed: [{ post: post("new") }] });
		if (url.startsWith("https://hcommons.social/api/")) return Response.json([]);
		return Response.json({ status: "queued", location: "https://evil.example/status" }, { status: 201 });
	};
	try {
		await assert.rejects(checkSocialWebmentions({ fetchImpl: fakeFetch, cacheFile: join(dir, "missing.json"), now }), /Unexpected webmention response/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("continues pagination to find recent posts beyond the first page", async () => {
	const dir = await mkdtemp(join(tmpdir(), "social-wm-"));
	const submissions = [];
	const fakeFetch = async (input, options = {}) => {
		const url = new URL(input);
		if (url.hostname === "public.api.bsky.app") {
			return Response.json(url.searchParams.has("cursor") ? { feed: [{ post: post("next") }] } : { feed: [{ post: post("first", "https://example.com/") }], cursor: "next" });
		}
		if (url.hostname === "hcommons.social") {
			return Response.json(url.searchParams.has("max_id") ? [status("90")] :
				Array.from({ length: 40 }, (_, i) => ({ ...status(String(130 - i)), content: "" })));
		}
		submissions.push(Object.fromEntries(options.body));
		return Response.json({ status: "success" });
	};
	try {
		assert.equal(await checkSocialWebmentions({ fetchImpl: fakeFetch, cacheFile: join(dir, "missing.json"), now }), 2);
		assert.match(submissions[0].source, /\/next$/);
		assert.match(submissions[1].source, /\/90$/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
