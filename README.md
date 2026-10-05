# Public Theology

**Public Theology** is a new publication of public theology, public witness and shared resources: writing on how faith meets public life, edited by Adam DJ Brett.

## Stack

- **Build Awesome** 4.0.0-alpha.10 (Eleventy v4)
- **Nunjucks** templates
- **Pagefind** search
- **Pages CMS** for content management
- Deployed to **xmit.co**

## Getting Started

```bash
nvm use
npm ci
npm run dev
```

Site runs at `http://localhost:8080`.

## Build & Deploy

```bash
npm run build
```

The build runs Pagefind indexing and verifies the output. Commits to `main` deploy via GitHub Actions to xmit.co.

## Content & Editing

Posts, pages, and authors live in `src/` as Markdown/YAML. Edit via [Pages CMS](https://app.pagescms.org) or directly in the repo. Drafts are marked `published: false` in front matter and excluded from production builds.

## Credits

Built with the [Ghost Headline theme](https://github.com/TryGhost/Headline) (MIT) and [Phosphor icons](https://phosphoricons.com). See `LICENSE` for details.
