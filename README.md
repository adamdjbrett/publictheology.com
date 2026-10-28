# Public Theology
[![Deploy Eleventy to XMIT](https://github.com/adamdjbrett/publictheology.com/actions/workflows/xmit-deploy.yml/badge.svg)](https://github.com/adamdjbrett/publictheology.com/actions/workflows/xmit-deploy.yml)

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

## Webmentions

Replies, likes and reposts from Mastodon, Bluesky (via [Bridgy Fed](https://fed.brid.gy/docs)) and other sites arrive at [webmention.io](https://webmention.io) and are shown under each post.

- **Setup (once)**: sign in at webmention.io as `publictheology.com`, copy the API key from Settings, and add it as the repo secret `WEBMENTION_IO_TOKEN`.
- **Display**: each deploy, and a check every 6 hours, fetches the mentions into `.cache/webmentions.json` and rebuilds. Without the token the site builds with none.
- **Sending**: each push sends webmentions for new, edited and deleted posts to Bridgy Fed (required for bridging; for a deleted post it removes the bridged copy) and to linked sites that accept them. Failures show as warnings in the Actions run summary.
- **Backfill**: all past mentions webmention.io holds are fetched every time. To notify sites linked from older posts without re-bridging them: list their URLs in a file, `npm run build`, then `node scripts/send-webmentions.mjs urls.txt --skip-bridgy --dry-run` (drop `--dry-run` to send).
- **Test**: `npm run test:webmentions`.

## Content & Editing

### Email new posts with Buttondown

**Automatic sending is disabled** in the deploy workflow. The script and configuration
are retained; re-enabling the step will send posts since activation that have not been emailed.

Set the GitHub Actions secret `BUTTONDOWN_KEY` to the newsletter's Buttondown API key.
When enabled, after a successful push deployment, the workflow sends each newly published post's
full rendered article and author byline to the newsletter's subscribers. Drafts, edits to
published posts, deletions, scheduled builds, and manual deploys do not send emails.
Publishing a former draft does send it. The JSON feed includes all published posts so a
large content push cannot lose posts at the feed boundary.

The workflow pins `BUTTONDOWN_BASELINE` to the commit before activation, excluding the
existing archive. Keep that value unchanged: later unsent posts catch up on the next push,
even after a failed or replaced deployment. Buttondown's email records, matched by source
URL, prevent duplicate sends on reruns. Keep those email records to retain this protection.
If sending fails, rerun the failed workflow; it resumes any draft it already created.
Delivery status and the archive URL appear in the Actions log and summary. Buttondown may
continue sending after the workflow's two-minute delivery check ends.

Check locally with `node --test scripts/test-buttondown.mjs` and, after building,
`BUTTONDOWN_BASELINE=17ec9f9a3ba093744d04940174ffc693c0288369 node scripts/send-buttondown.mjs --dry-run`.
The dry run needs no API key and sends nothing. A missing/invalid baseline commit fails
closed rather than emailing the archive.

Posts, pages, and authors live in `src/` as Markdown/YAML. Edit via [Pages CMS](https://app.pagescms.org) or directly in the repo. Drafts are marked `published: false` in front matter and excluded from production builds.

## Credits

Built with the [Ghost Headline theme](https://github.com/TryGhost/Headline) (MIT) and [Phosphor icons](https://phosphoricons.com). See `LICENSE` for details.
