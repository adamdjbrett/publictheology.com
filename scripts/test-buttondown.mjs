import assert from "node:assert/strict";
import { test } from "node:test";
import { emailPayload, publishedUrl, sendPosts } from "./send-buttondown.mjs";

const post = {
	url: "https://publictheology.com/roundup/",
	title: 'Care & "Community"',
	authors: [{ name: "A & B" }],
	content_html: '<p>Full article.</p><img src="/assets/images/test.webp"><a href="../older/?a=1&amp;b=2">Older</a><a href="#note">Note</a><script>alert(1)</script>',
};
const API = "https://api.buttondown.com/v1/";

test("publication detection follows the site draft and filename conventions", () => {
	const file = "src/posts/2026-10-28-roundup.md";
	assert.equal(publishedUrl(file, "---\npublished: false\n---\nDraft"), null);
	assert.equal(publishedUrl(file, "---\npublished: true\n---\nPublished"), post.url);
	assert.equal(publishedUrl(file, "---\ntitle: No explicit published field\n---\nBody"), post.url);
});

test("email preserves the article and authors, resolves links, and removes scripts", () => {
	const payload = emailPayload(post);
	assert.equal(payload.subject, post.title);
	assert.equal(payload.canonical_url, post.url);
	assert.equal(payload.status, "draft");
	assert.match(payload.body, /Full article/);
	assert.match(payload.body, /By A &amp; B/);
	assert.match(payload.body, /src="https:\/\/publictheology.com\/assets\/images\/test.webp"/);
	assert.match(payload.body, /href="https:\/\/publictheology.com\/older\/\?a=1&amp;b=2"/);
	assert.match(payload.body, /href="#note"/);
	assert.doesNotMatch(payload.body, /<script/);
	assert.throws(() => emailPayload({ ...post, url: "https://example.com/" }));
	assert.throws(() => emailPayload({ ...post, content_html: "" }));
});

test("new post creates a draft, publishes once, and reruns skip the sent email", async () => {
	const calls = [];
	let email;
	const request = async (url, method = "GET", data) => {
		calls.push([url, method]);
		if (method === "GET") return { results: email ? [email] : [], next: null };
		if (url.endsWith("/publish")) email = { ...email, status: "sent" };
		else email = { ...data, id: "email-1" };
		return email;
	};
	await sendPosts([post], request, () => {});
	await sendPosts([post], request, () => {});
	assert.deepEqual(calls, [[`${API}emails`, "GET"], [`${API}emails`, "POST"], [`${API}emails/email-1/publish`, "POST"], [`${API}emails`, "GET"]]);
});

test("pagination prevents duplicates and failed sends resume the existing draft", async () => {
	const calls = [];
	const email = { ...emailPayload(post), id: "existing" };
	const request = async (url, method = "GET") => {
		calls.push([url, method]);
		if (url === `${API}emails`) return { results: [], next: `${API}emails?page=2` };
		if (url.endsWith("page=2")) return { results: [email], next: null };
		return { ...email, status: "about_to_send" };
	};
	await sendPosts([post], request, () => {});
	assert.equal(calls.length, 3);
	assert.deepEqual(calls[2], [`${API}emails/existing/publish`, "POST"]);
});

test("no new posts makes no requests; API errors and failed statuses fail the run", async () => {
	await sendPosts([], () => assert.fail("Unexpected API call"), () => {});
	await assert.rejects(sendPosts([post], async () => { throw new Error("401"); }), /401/);
	await assert.rejects(sendPosts([post], async () => ({ results: [{ canonical_url: post.url, id: "bad", status: "errored" }] })), /requires attention/);
});
