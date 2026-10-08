# YouTube Listings for Webflow

Shows the 3 latest long-form videos from the [Different Hats Podcast](https://www.youtube.com/@different-hats) YouTube channel as styled cards on the Webflow site. You add it with a script tag, not an iframe.

A Cloudflare Worker keeps the YouTube API key secret, refreshes the video list every 30 minutes and serves the embed script. See [SPEC.md](SPEC.md) for the full requirements.

## Add it to Webflow

Paste this into an **Embed** element wherever the cards should appear:

```html
<div data-yt-listings></div>
<script src="https://you-alright-mate-youtube-listings.george-49a.workers.dev/yt-listings.js" defer></script>
```

- The cards fill the width of their parent: a row of 3 on desktop, stacking to 1 column at 767px and below.
- The Watch button uses the site's own `outlined-button` class, so it follows any restyle of that class.
- Embed scripts don't run in the Webflow Designer. Check on the published site.
- The page's domain must be in `ALLOWED_ORIGINS` (see below), or the browser blocks the request and the container stays empty.

## How it works

```
Cron (every 30 min) ──► YouTube Data API v3 ──► KV (videos:latest)
                         (3 quota units/run)          │
Webflow page ──► /yt-listings.js ──► GET /videos ◄────┘
```

| Route | What it does |
|---|---|
| `GET /yt-listings.js` | The embed script (static asset from `public/`) |
| `GET /videos` | Latest 3 videos as JSON, read from KV. CORS only for `ALLOWED_ORIGINS` |
| Cron `*/30 * * * *` | Refreshes KV. If YouTube fails, the last good list is kept |

Videos of **3 minutes or less are treated as Shorts** and skipped (`SHORTS_MAX_SECONDS` in `src/youtube.js`).

## Configuration

| Name | Where | Value |
|---|---|---|
| `GOOGLE_CLOUD_API_KEY` | Worker secret; `.env` for local dev | Google Cloud API key with YouTube Data API v3 enabled |
| `CHANNEL_ID` | `wrangler.jsonc` `vars` | `UCtifmqPSWYmwn9J53Bdh-Gg` (@different-hats) |
| `ALLOWED_ORIGINS` | `wrangler.jsonc` `vars` | Comma-separated site origins allowed to load the videos |
| `VIDEOS` | `wrangler.jsonc` KV binding | KV namespace `YOUTUBE_LISTINGS_VIDEOS` |

### Add a new site domain

Add the origin (scheme + host, no trailing slash) to `ALLOWED_ORIGINS` in `wrangler.jsonc` and push:

```jsonc
"ALLOWED_ORIGINS": "https://different-hats-staging.webflow.io,https://www.different-hats.co.uk,https://new-domain.example,http://localhost:8787"
```

## Local development

Requires Node 18+.

```sh
npm install
cp example.env .env        # then add your API key
npm run dev                # http://localhost:8787 preview page
npm test                   # unit tests (Vitest)
```

- `wrangler dev` reads the API key from `.env` and uses a **local** KV store, so live data is never touched.
- `http://localhost:8787/videos` shows the raw JSON.
- To run the cron locally: `npx wrangler dev --test-scheduled`, then `curl "http://localhost:8787/__scheduled?cron=*/30+*+*+*+*"`.

## Deployment

**Pushing to `main` deploys** via Cloudflare Workers Builds. To deploy manually: `npx wrangler deploy`.

One-time setup (already done for this project):

```sh
npx wrangler login
npx wrangler kv namespace create YOUTUBE_LISTINGS_VIDEOS   # put the id in wrangler.jsonc
grep '^GOOGLE_CLOUD_API_KEY=' .env | cut -d= -f2- \
  | npx wrangler secret put GOOGLE_CLOUD_API_KEY --name you-alright-mate-youtube-listings
```

- Set the API key as a **Worker secret** (Settings > Variables and Secrets), not a build variable.
- All other config lives in `wrangler.jsonc`, because deploys overwrite variables set in the dashboard.
- In Google Cloud Console, restrict the key to **YouTube Data API v3**. Don't add a website restriction, because the key is only used server-side.

### Checking the live Worker

```sh
curl https://you-alright-mate-youtube-listings.george-49a.workers.dev/videos
npx wrangler kv key get videos:latest --binding VIDEOS --remote   # cached data
npx wrangler tail                                                  # live logs
```

## Project structure

```
src/worker.js          Worker: /videos, CORS, cron refresh
src/youtube.js         YouTube API calls, Shorts filter, mapping
public/yt-listings.js  Embed script (cards + scoped CSS)
public/index.html      Local preview page
test/                  Vitest unit tests
wrangler.jsonc         Worker config
SPEC.md, tasks/        Spec and implementation plan
```
