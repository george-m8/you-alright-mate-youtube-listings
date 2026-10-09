# Spec: YouTube Listings for Webflow

## Objective

Show the latest long-form YouTube videos (and, optionally, the latest Shorts) from one fixed channel on the Different Hats / You Alright Mate Webflow site (`https://different-hats-staging.webflow.io/`). The homepage shows a row of 3; a listings page shows up to 30 in a grid or list.

A site editor adds two lines to a Webflow Embed element, and the videos appear as a row of cards styled to match the site. They don't need an iframe, and the API key never reaches the browser.

**User stories**
- As a site editor, I paste a `<div>` and a `<script>` tag into Webflow and get the latest 3 videos, with no further setup.
- As a visitor, I see each video's thumbnail and title, and a "Watch" button that opens the video on YouTube in a new tab.
- As the site owner, I don't want the API key exposed or quota used up, however much traffic the site gets.
- As a site editor, I add a listings page with up to 30 videos by setting `data-yt-limit="30"`, and choose a grid or a list layout with attributes.
- As a site editor, I add a separate row of the latest Shorts (4 across, 2x2 on mobile).
- As a site editor, I can turn on a short description preview and an "Other ways to watch and listen" line of platform links per container.

**Embed snippet (the whole integration)**
```html
<div data-yt-listings></div>
<script src="https://you-alright-mate-youtube-listings.george-49a.workers.dev/yt-listings.js" defer></script>
```

**Container options (data attributes on the `[data-yt-listings]` div; Webflow custom attributes need a value, so any value except `false` turns a flag on)**

| Attribute | Values | Default |
|---|---|---|
| `data-yt-source` | `videos`, `shorts` | `videos` |
| `data-yt-limit` | 1-30 | 3 (videos), 4 (shorts) |
| `data-yt-layout` | `grid`, `list` (videos only) | `grid` |
| `data-yt-thumb` | `left`, `right`, `alternate` (list layout only) | `left` |
| `data-yt-description` | flag: show the description preview | off |
| `data-yt-links` | flag: show platform links, if the description has any | off |

The existing homepage embed (`data-yt-listings` only) keeps rendering exactly 3 cards in a row.

## Architecture

One Cloudflare Worker with two jobs:

| Route | Purpose |
|---|---|
| `GET /videos` | Returns cached JSON for the latest 3 non-Shorts videos. CORS limited to allowed origins. |
| `GET /yt-listings.js` | Static client script (Workers static assets). Fetches `/videos` and renders the cards into `[data-yt-listings]`. |
| Cron trigger (every 30 min) | Refreshes the cached video list from the YouTube Data API v3 and writes it to KV. |

**Refresh flow (up to 5 quota units per run, about 240 units/day of the 10,000 limit):**
1. `channels.list?part=contentDetails&id=<CHANNEL_ID>` returns the uploads playlist ID (1 unit).
2. `playlistItems.list?part=contentDetails&playlistId=<uploads>&maxResults=50`, 2 pages, returns the latest 100 upload IDs (2 units). About half the channel's uploads are Shorts, so 100 candidates gives 30+ long-form videos.
3. `videos.list?part=snippet,contentDetails&id=<ids>` in batches of 50 returns titles, descriptions, thumbnails and durations (2 units).
4. Split into long-form videos (newest 30) and Shorts (newest 12), and write both to KV under `videos:latest`. If fewer exist, store what there is.
5. **If any step fails, keep the existing KV value** (serve stale data rather than nothing) and log the error.

`/videos` reads from KV. If KV is empty (first deploy), it runs the refresh once inline.

**Shorts rule:** treat a video as a Short if its duration is **3 minutes (180s) or less**. YouTube doesn't expose an "is Short" flag in the API, so this is a heuristic (threshold agreed, see Decisions). Upcoming/live premieres (`P0D`) appear in neither list.

**Description preview:** the description's opening paragraphs, up to the first paragraph containing a URL (sponsor and link blocks), joined into one line and cut at a word boundary to 280 characters with `…`. Empty if the first paragraph has a URL.

**Platform links:** URLs in the description whose host matches a known platform (Apple Podcasts, Spotify, Acast, Amazon Music, YouTube Music, Pocket Casts, Overcast), first link per platform, in description order. Empty if there are none, and the client then shows nothing.

**`/videos` response shape**
```json
{
  "updatedAt": "2026-10-08T12:00:00Z",
  "videos": [
    {
      "id": "abc123",
      "title": "Episode title",
      "thumbnail": "https://i.ytimg.com/vi/abc123/maxresdefault.jpg",
      "url": "https://www.youtube.com/watch?v=abc123",
      "publishedAt": "2026-10-01T09:00:00Z",
      "description": "Opening paragraph of the description…",
      "links": [{ "name": "Spotify", "url": "https://open.spotify.com/episode/..." }]
    }
  ],
  "shorts": [
    { "id": "xyz789", "title": "Short title", "thumbnail": "...", "url": "https://www.youtube.com/shorts/xyz789", "publishedAt": "..." }
  ]
}
```
Headers: `Cache-Control: public, max-age=300` and `Access-Control-Allow-Origin` set to the request origin if it's in `ALLOWED_ORIGINS`.

## Visual Design

Matches the live site's CSS (`different-hats-staging.webflow.shared.*.css`):

- **Font:** inherits Montserrat from the page (already loaded by Webflow). Don't load fonts separately.
- **Container:** CSS grid, 3 equal columns with a gap, so 30 videos make 10 rows. It stacks to 1 column at 767px and below (Webflow's mobile landscape breakpoint).
- **Shorts:** 4 columns of 9:16 cards (thumbnail cropped from the centre), 2x2 at 767px and below, smaller 2-line title.
- **List layout:** one card per row. The thumbnail takes 55% of the card at full height and fades into the black text side (title, description, links, Watch). `data-yt-thumb` puts it left, right or alternating. At 767px and below it stacks with the thumbnail on top fading downwards.
- **Description:** 14px, clamped to 3 lines (4 in the list layout). **Links:** one 14px line, `Other ways to watch and listen: Apple Podcasts, Spotify`, underlined text links opening in a new tab; omitted when there are no links.
- **Card:** `background: #000`, `border: 2px solid #fff`, white text.
  - Thumbnail at full card width, 16:9 (`aspect-ratio: 16/9; object-fit: cover`), `loading="lazy"`, `alt` = video title.
  - Title below the thumbnail, centred, uppercase like the site's `h3` but smaller (about 18px, weight 400), clamped to 3 lines.
  - "Watch" button (label: `Watch`) below the title.
- **Button:** uses the site's own `outlined-button w-button` classes, so it stays in sync with any site restyle: 3px solid `#fcee21` (yellow) border, yellow uppercase text, weight 600, transparent background, `scale(1.2)` on hover. The script's CSS repeats these rules scoped under `.yt-listings` as a fallback, so the cards still look right on a page without the site stylesheet (the local test page).
- **Link:** `href` = YouTube watch URL, `target="_blank" rel="noopener"`.
- **States:** while loading, show as many placeholder cards as the limit of the same size so the layout doesn't shift. On error or with no videos, the container stays empty (no broken UI) and the script logs `console.warn`.
- All injected CSS is prefixed `.yt-listings` and doesn't change any other part of the page.

## Tech Stack

- Cloudflare Workers + Workers KV + Cron Triggers + Workers Static Assets
- Wrangler 4.x (via `npx`)
- Plain JavaScript (ES modules) for the Worker. The client script is a single plain-JS file with no build step and no dependencies.
- Vitest for tests
- Node via `npm` (this is a JS project, so the uv/Python rules don't apply)

## Config

| Name | Kind | Value |
|---|---|---|
| `GOOGLE_CLOUD_API_KEY` | Worker secret (`wrangler secret put`); locally read from `.env` by `wrangler dev` | from `.env` |
| `CHANNEL_ID` | `vars` in `wrangler.jsonc` | `UCtifmqPSWYmwn9J53Bdh-Gg` (@different-hats, "Different Hats Podcast") |
| `ALLOWED_ORIGINS` | `vars` in `wrangler.jsonc` (comma-separated string) | `https://different-hats-staging.webflow.io,https://www.different-hats.co.uk,http://localhost:8787` |
| `VIDEOS` | KV namespace binding | namespace `YOUTUBE_LISTINGS_VIDEOS`, id `72bea2d74fca4cd69fb005e9e75ac16f` |

The Google Cloud key should also be restricted to **YouTube Data API v3** only in Google Cloud Console. It is only used server-side, so it doesn't need a referrer restriction.

## Commands

```
Install:      npm install
Dev:          npx wrangler dev            # serves /videos, /yt-listings.js and test/index.html on :8787
Test cron:    npx wrangler dev --test-scheduled  then  curl "http://localhost:8787/__scheduled"
Test:         npx vitest run
Deploy:       git push (Cloudflare Workers Builds deploys on push); npx wrangler deploy for manual deploys
Set secret:   npx wrangler secret put GOOGLE_CLOUD_API_KEY   (or Worker > Settings > Variables in the dashboard)
Create KV:    npx wrangler kv namespace create YOUTUBE_LISTINGS_VIDEOS   (done)
```

## Project Structure

```
src/worker.js          → fetch handler (/videos, CORS) + scheduled handler (cron refresh)
src/youtube.js         → YouTube API calls, ISO-8601 duration parsing, Shorts filter, response mapping
public/yt-listings.js  → client script served as a static asset (render + scoped CSS)
public/index.html      → local test page with the embed snippet (dev preview only)
test/youtube.test.js   → unit tests for youtube.js with mocked fetch
test/render.test.js    → unit tests for client rendering (jsdom)
wrangler.jsonc         → Worker config, KV binding, cron, vars
.env / example.env     → API key; wrangler dev reads .env directly
README.md              → setup, deploy and Webflow embed instructions
SPEC.md                → this file
```

## Code Style

Small, pure functions where possible. No frameworks, and short JSDoc only where the purpose isn't obvious.

```js
// src/youtube.js
const SHORTS_MAX_SECONDS = 180;

export function parseDuration(iso) {
  const [, h = 0, m = 0, s = 0] = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) ?? [];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export function toListing(video) {
  const { id, snippet } = video;
  const thumbs = snippet.thumbnails;
  return {
    id,
    title: snippet.title,
    thumbnail: (thumbs.maxres ?? thumbs.high ?? thumbs.medium).url,
    url: `https://www.youtube.com/watch?v=${id}`,
    publishedAt: snippet.publishedAt,
  };
}
```

- camelCase functions, UPPER_SNAKE constants, kebab-case filenames
- The client builds DOM with `document.createElement` / `textContent`, **never `innerHTML` with API data**, to avoid XSS from video titles.
- The client script is wrapped in an IIFE and adds no globals.

## Testing Strategy

- **Unit (Vitest):** `parseDuration` edge cases (`PT59S`, `PT3M`, `PT3M1S`, `PT1H2M`, `P0D` live/premiere), Shorts filter, thumbnail fallback, newest-3 selection, refresh keeps the old KV value when the API errors.
- **Client (Vitest + jsdom):** renders 3 cards with the correct href/target/alt/text, uses `textContent` (a title like `<img onerror>` stays as text), and leaves the container empty on fetch failure.
- **Manual:** `wrangler dev` plus `public/index.html` with the real key and channel. Check the layout at 1280px and 375px, and check the live Webflow staging page after deploy.
- No coverage target. Every function in `youtube.js` has at least one test.

## Boundaries

- **Always:** keep the API key server-side only, scope all CSS under `.yt-listings`, use `textContent` for API data, run `npx vitest run` before deploy, keep README in sync.
- **Ask first:** adding npm dependencies beyond wrangler/vitest/jsdom, changing the refresh interval or Shorts threshold, pushing to the deployed branch (push = deploy), anything touching the Webflow project itself.
- **Never:** commit `.env` / `.dev.vars` (add to `.gitignore`), put the key in client code, call `search.list` (100 units), use `innerHTML` with API strings.

## Success Criteria

1. Pasting the embed snippet into a Webflow Embed element on staging shows 3 cards in a row on desktop and a single column at 375px wide.
2. Each card shows thumbnail (16:9, full width), title, and a yellow outlined "Watch" button that opens the correct YouTube video in a new tab.
3. No Shorts (≤180s) appear. Cards show the newest qualifying uploads, newest first.
4. The API key doesn't appear in any browser-visible response or script.
5. Under any page traffic, YouTube API calls only happen on the 30-minute cron (plus at most one inline refresh when KV is empty).
6. If the YouTube API fails, `/videos` still serves the last good data.
7. A request to `/videos` from an origin not in `ALLOWED_ORIGINS` gets no `Access-Control-Allow-Origin` header.
8. The script adds no visible layout shift and doesn't affect styling outside the container.
9. `npx vitest run` passes.
10. `data-yt-limit="30"` shows up to 30 videos, 3 per row; the homepage embed with no extra attributes still shows 3.
11. `data-yt-source="shorts"` shows the latest 4 Shorts, 4 across, 2x2 at 375px, each linking to `youtube.com/shorts/<id>`.
12. Description preview and platform links appear only when their attribute is set, and no empty "Other ways to watch" line appears for videos without platform links.
13. `data-yt-layout="list"` shows full-height thumbnails fading into the text, on the side set by `data-yt-thumb`.

## Decisions

- **Channel:** `@different-hats` resolved to `UCtifmqPSWYmwn9J53Bdh-Gg`. Its latest uploads are "The Journal" episodes, so there's real data to test against.
- **Worker host:** `you-alright-mate-youtube-listings.george-49a.workers.dev`. The repo already deploys there on push.
- **Shorts threshold:** 180s, fine for now.
- **Button label:** `Watch`.
- **Listings page (2026-10-09):** one cache entry and one `/videos` response for every container; the client slices per container. The response grows to about 20KB (about 6KB gzipped), which is fine for the homepage too.
- **Tablet:** grid stays at 3 columns down to 768px for now; 2 columns between 768px and 991px is a possible follow-up.

## Open Questions

1. **Third domain (coming soon):** add it to `ALLOWED_ORIGINS` in `wrangler.jsonc` and push. No code change needed. The apex `different-hats.co.uk` 301-redirects to `www`, so it doesn't need its own entry.
