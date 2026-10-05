# AGENTS.md

## Scope

publictheology.com: a blog built on the Ghost **Headline** theme, converted to a
**Build Awesome v4 + Nunjucks** static site. There is no Ghost backend — posts, pages, authors and
site config are Markdown/YAML under `src/`.

## Commands

```bash
npm ci
npm run dev      # dev server + watch (http://localhost:8080)
npm run build    # production build to _site/ (Pagefind runs on eleventy.after)
```

Node ≥ 24. Build Awesome is pinned to `4.0.0-alpha.10`; do not install its
unqualified `latest` tag.

## Conventions

- Templating is **Nunjucks**. The Build Awesome `input` dir is
  `src/` (includes `src/_includes/`, data `src/_data/`, assets `src/assets/`).
  Build tooling — `buildawesome.config.js`, `_config/` — stays at the repo
  root; `.js` config files must not live inside `src/` or Eleventy renders them.
- **Drafts**: `published: false` front matter marks a post or page as draft.
  A build-mode preprocessor drops them from production; they render in `--serve`.
- **Timezone**: `src/_data/metadata.yaml → timezone` (IANA) feeds the date filters
  in `_config/filters.js`, which keep date-only values as wall-clock dates in that
  zone; full timestamps with an offset (`2026-10-06T09:00:00-05:00`) are kept as-is.
- Layout chain: content → `_includes/layouts/{post,page,home}.njk` →
  `_includes/layouts/default.njk` (renders `<head>`, header, footer, search modal).
- Shared partials are included with `{% include "partials/NAME.njk" %}` and
  **inherit context**; card/meta partials expect a variable named `post` (an
  Eleventy collection item). Set it before including in a non-loop context.
- Custom filters live in `_config/filters.js`: `readableDate`, `htmlDateString`, `readingTime`, `excerpt`,
  `slug`, `resolveAuthors`, `relatedPosts`, taxonomy helpers, TOC backlinks,
  and `year`. Images are preoptimized and copied without build-time transforms.
- Collections are memoized in `buildawesome.config.js`: `posts`, `pages`,
  `tags`, `categories`, and compatibility alias `topics`.
- Prefer `postTags` for public tags. Legacy `tags` values remain supported after
  internal collection tags are removed. Taxonomy values may be strings or
  `{name, slug?, url?}` objects.
- Authors are one Markdown file each in `src/authors/` (`/authors/<slug>/`), exposed
  as `siteAuthors`; `authors` on a post lists slugs or `src/authors/<slug>.md` paths.

## Gotchas (Eleventy v4 alpha)

- The `slug` filter was **removed** in v4 → re-added in `_config/filters.js`.
  `slugify` remains built-in.
- Nunjucks namespace member-assignment in `{% set ns.x = … %}` can fail to
  compile — prefer a JS filter (see `relatedPosts`).
- `eleventyComputed` still works despite the internal "buildawesome" rename.

## Features to keep working

- **Pagefind** search: `head.njk` loads the Component UI; `data-pagefind-body`
  on post/page `<article>` scopes the index.
- **Light/dark**: no-flash script in `head.njk`, `assets/css/darkmode.css`,
  `assets/js/theme-toggle.js`, default in `_data/theme.yaml`.
- **Pages CMS**: `.pages.yml` field paths must track `src/_data/*`, `src/posts`, `src/pages` and `src/authors`.

## Boundaries

- Do not commit `node_modules/`, `_site/`, or secrets.
- Assets under `assets/built/` are the original theme's compiled CSS/JS — treat as
  vendored; add new styles in `assets/css/darkmode.css` or a new file.
