export default {
	tags: ["posts"],
	layout: "layouts/post.njk",
	permalink: "/{{ page.fileSlug }}/",
	// Pages CMS keeps stray spaces ("Title "); trim once so every use (meta, DC, OAI, feeds) agrees.
	eleventyComputed: { title: (data) => (typeof data.title === "string" ? data.title.trim() : data.title) },
};
