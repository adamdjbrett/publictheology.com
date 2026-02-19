export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ public: "/" });

  return {
    markdownTemplateEngine: false,
    htmlTemplateEngine: "njk",
    dataTemplateEngine: "njk",
    dir: {
      input: "content",
      includes: "../_includes",
      data: "../_data",
      output: "_site"
    }
  };
}
