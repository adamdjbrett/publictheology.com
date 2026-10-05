export default {
	layout: "layouts/author.njk",
	permalink: "/authors/{{ page.fileSlug }}/",
	eleventyComputed: { title: (data) => data.name },
};
