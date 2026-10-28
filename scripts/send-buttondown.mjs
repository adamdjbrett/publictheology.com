import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { load, CORE_SCHEMA } from "js-yaml";

const API = "https://api.buttondown.com/v1/";
const SITE = "https://publictheology.com";
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

export function publishedUrl(file, source) {
	const data = load(source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || "", { schema: CORE_SCHEMA }) || {};
	if (data.published === false) return null;
	return `${SITE}/${basename(file, ".md").replace(/^\d{4}-\d{2}-\d{2}-/, "")}/`;
}

export function emailPayload(post) {
	if (new URL(post.url).origin !== SITE || !post.title || !post.content_html?.trim()) throw new Error("Invalid post in JSON feed");
	const body = post.content_html
		.replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/\b(href|src)=(['"])(.*?)\2/gi, (match, attr, quote, value) =>
			value.startsWith("#") ? match : `${attr}=${quote}${escape(new URL(value.replaceAll("&amp;", "&"), post.url).href)}${quote}`);
	const authors = (post.authors || []).map((author) => escape(author.name)).join(", ");
	return {
		subject: post.title,
		canonical_url: post.url,
		slug: new URL(post.url).pathname.split("/").filter(Boolean).join("-"),
		body: `<!-- buttondown-editor-mode: fancy --><h1>${escape(post.title)}</h1>${authors ? `<p>By ${authors}</p>` : ""}${body}<p><a href="${escape(post.url)}">Read on Public Theology</a></p>`,
		status: "draft",
		metadata: { publictheology_url: post.url },
	};
}

export async function sendPosts(posts, request, report = console.log) {
	if (!posts.length) { report("No newly published posts; no emails sent."); return []; }
	const emails = [];
	let next = `${API}emails`;
	do {
		const page = await request(next);
		if (!Array.isArray(page.results)) throw new Error("Invalid Buttondown email list");
		emails.push(...page.results);
		next = page.next ? new URL(page.next, API).href : null;
	} while (next);
	const results = [];
	for (const post of posts) {
		const payload = emailPayload(post);
		let email = emails.find((item) => item.canonical_url === post.url || item.metadata?.publictheology_url === post.url);
		if (!email) {
			email = await request(`${API}emails`, "POST", payload);
			emails.push(email);
		}
		if (!email.id) throw new Error("Buttondown returned no email ID");
		if (email.status === "draft" && email.metadata?.publictheology_url === post.url) {
			email = await request(`${API}emails/${encodeURIComponent(email.id)}/publish`, "POST", {});
		}
		if (!["about_to_send", "in_flight", "sent", "scheduled", "throttled", "resending"].includes(email.status)) {
			throw new Error(`Buttondown email ${email.id} requires attention: ${email.status}`);
		}
		report(`${post.title}: ${email.status} (${email.id}) ${email.absolute_url || ""}`);
		results.push(email);
	}
	return results;
}

async function main() {
	const before = process.env.BUTTONDOWN_BASELINE;
	if (!/^[a-f\d]{40}$/.test(before || "") || /^0+$/.test(before)) throw new Error("BUTTONDOWN_BASELINE must be a valid activation commit; refusing to email the archive");
	const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
	const files = git("ls-tree", "-r", "--name-only", before, "--", "src/posts").trim().split("\n").filter((file) => file.endsWith(".md"));
	const published = new Set(files.map((file) => publishedUrl(file, git("show", `${before}:${file}`))).filter(Boolean));
	const feed = JSON.parse(readFileSync("_site/feed/feed.json", "utf8"));
	const posts = feed.items.filter((post) => !published.has(post.url)).reverse();
	if (process.argv.includes("--dry-run")) {
		for (const post of posts) console.log(JSON.stringify(emailPayload(post), null, 2));
		console.log(`${posts.length} newly published post(s); dry run, nothing sent.`);
		return;
	}
	if (posts.length && !process.env.BUTTONDOWN_KEY) throw new Error("BUTTONDOWN_KEY secret is not set");
	const request = async (url, method = "GET", data) => {
		if (!url.startsWith(API)) throw new Error("Refusing to send Buttondown credentials to another endpoint");
		const response = await fetch(url, {
			method,
			headers: { Authorization: `Token ${process.env.BUTTONDOWN_KEY}`, "Content-Type": "application/json", "X-API-Version": "2026-04-01" },
			body: data === undefined ? undefined : JSON.stringify(data),
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) throw new Error(`Buttondown ${method} failed (${response.status}): ${(await response.text()).replaceAll(process.env.BUTTONDOWN_KEY, "[redacted]")}`);
		return response.json();
	};
	const report = (message) => {
		console.log(message);
		if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
	};
	const emails = await sendPosts(posts, request, report);
	// Observe delivery without repeating a publish request if Buttondown is still sending.
	for (let attempt = 0; attempt < 12 && emails.some((email) => email.status !== "sent"); attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 10_000));
		for (let i = 0; i < emails.length; i++) {
			if (emails[i].status === "sent") continue;
			emails[i] = await request(`${API}emails/${encodeURIComponent(emails[i].id)}`);
			report(`Delivery ${emails[i].id}: ${emails[i].status}`);
			if (["errored", "paused", "partially_sent", "deleted", "draft"].includes(emails[i].status)) throw new Error(`Buttondown delivery needs attention: ${emails[i].status}`);
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
