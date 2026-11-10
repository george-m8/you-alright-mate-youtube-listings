# YouTube Listings for Webflow

Shows the latest 3 videos from a [curated playlist](https://www.youtube.com/playlist?list=PLV1mW11ZuqTKKQCzKVExS6tCWbeU3k9J_) on the homepage, plus the latest long-form videos (up to 30) and Shorts for a listings page, from the [Different Hats Podcast](https://www.youtube.com/@different-hats) YouTube channel as styled cards on the Webflow site. You add it with a script tag, not an iframe.

A Cloudflare Worker keeps the YouTube API key secret, refreshes the video list every 30 minutes and serves the embed script. See [SPEC.md](SPEC.md) for the full requirements.

## Add it to Webflow

Paste this into an **Embed** element wherever the cards should appear:

```html
<div data-yt-listings data-yt-source="playlist"></div>
<script src="https://you-alright-mate-youtube-listings.george-49a.workers.dev/yt-listings.js" defer></script>
```

**Without a code embed** (how it's set up on the site): add an empty Div Block and give it the custom attribute `data-yt-listings` = `true` (Settings > Custom attributes; any value works). Then put the `<script>` tag in Page settings > Custom code > Before `</body>` (or Site settings > Footer code to use it on every page). Don't set display, flex direction or gap on that div, because the script controls the layout.

- The cards fill the width of their parent: a row of 3 on desktop, stacking to 1 column at 767px and below.
- The Watch button uses the site's own `outlined-button` class, so it follows any restyle of that class.
- Embed scripts don't run in the Webflow Designer. Check on the published site.
- The page's domain must be in `ALLOWED_ORIGINS` (see below), or the browser blocks the request and the container stays empty.

### Options

Add these as extra custom attributes on the same div (Webflow attributes always need a value). One script tag per page handles every container on it, and all of them share one request.

| Attribute | Values | Default | What it does |
|---|---|---|---|
| `data-yt-source` | `videos`, `shorts`, `playlist` | `videos` | `videos`: latest uploads. `playlist`: latest from the playlist in `PLAYLIST_ID` (the homepage), same cards and options as `videos`. `shorts`: Shorts in a row of 4 (2x2 on mobile), linking to the Shorts player |
| `data-yt-limit` | 1-30 (12 for Shorts) | 3 (4 for Shorts) | How many to show; grids wrap 3 per row, so 30 makes 10 rows |
| `data-yt-layout` | `grid`, `list` | `grid` | `list`: one wide card per row, thumbnail at full height fading into the text |
| `data-yt-thumb` | `left`, `right`, `alternate` | `left` | Thumbnail side in the `list` layout |
| `data-yt-description` | `true`/`false` | off | Preview of the description's opening paragraphs (about 280 characters, clamped to 3-4 lines) |
| `data-yt-links` | `true`/`false` | off | `Other ways to watch and listen: Apple Podcasts, Spotify` from links in the description; hidden when there are none |

Examples:

```html
<!-- Homepage: latest 3 from the playlist -->
<div data-yt-listings data-yt-source="playlist"></div>

<!-- Listings page -->
<div data-yt-listings data-yt-source="shorts"></div>
<div data-yt-listings data-yt-limit="30" data-yt-description="true" data-yt-links="true"></div>

<!-- List layout, alternating sides -->
<div data-yt-listings data-yt-limit="30" data-yt-layout="list" data-yt-thumb="alternate" data-yt-description="true" data-yt-links="true"></div>
```

**Platform links** come from the video's YouTube description: paste the full episode URL (for example `https://open.spotify.com/episode/...` or `https://podcasts.apple.com/...`) anywhere in it. Recognised: Apple Podcasts, Spotify, Acast, Amazon Music, YouTube Music, Pocket Casts, Overcast. They show up on the site after the next refresh (within 30 minutes).

**The description preview** stops at the first paragraph that contains a URL, so put links and sponsor blocks below the opening text.

## How it works

```
Cron (every 30 min) ──► YouTube Data API v3 ──► KV (videos:latest)
                         (~7 quota units/run)          │
Webflow page ──► /yt-listings.js ──► GET /videos ◄────┘
```

| Route | What it does |
|---|---|
| `GET /yt-listings.js` | The embed script (static asset from `public/`) |
| `GET /videos` | `videos` (latest 30, with description preview and platform links), `shorts` (latest 12) and `playlist` (latest 30 from `PLAYLIST_ID`) as JSON, read from KV. CORS only for `ALLOWED_ORIGINS` |
| Cron `*/30 * * * *` | Refreshes KV. If YouTube fails, the last good list is kept |

Each refresh reads the newest 100 uploads and every item in the playlist. **The playlist is sorted by publish date**, not by its order in YouTube Studio, and keeps everything in it (Shorts included). Removing a video from the playlist drops it from the homepage on the next refresh. Videos of **3 minutes or less are treated as Shorts** (`SHORTS_MAX_SECONDS` in `src/youtube.js`); trailing hashtags are stripped from Shorts titles.

## Configuration

| Name | Where | Value |
|---|---|---|
| `GOOGLE_CLOUD_API_KEY` | Worker secret; `.env` for local dev | Google Cloud API key with YouTube Data API v3 enabled |
| `CHANNEL_ID` | `wrangler.jsonc` `vars` | `UCtifmqPSWYmwn9J53Bdh-Gg` (@different-hats) |
| `PLAYLIST_ID` | `wrangler.jsonc` `vars` | `PLV1mW11ZuqTKKQCzKVExS6tCWbeU3k9J_` (homepage playlist). Unset: `playlist` is empty |
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
public/yt-listings.js  Embed script (cards, options, scoped CSS)
public/index.html      Local preview page (every layout)
test/                  Vitest unit tests
wrangler.jsonc         Worker config
SPEC.md, tasks/        Spec and implementation plan
```
