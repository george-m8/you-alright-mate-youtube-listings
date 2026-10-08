# Tasks: YouTube Listings for Webflow

See `tasks/plan.md` for context and `SPEC.md` for requirements.

## Phase 1: Data path

### Task 1: YouTube client module with unit tests

**Description:** Set up the npm project and write `src/youtube.js`. It exports `parseDuration`, `isShort`, `toListing` and `fetchLatestVideos(apiKey, channelId, fetchFn = fetch)`, which runs channels.list, then playlistItems.list (maxResults 15), then videos.list, drops Shorts and returns the newest 3 listings. Errors throw with the HTTP status and the API's error message.

**Acceptance criteria:**
- [x] `parseDuration` handles `PT59S`, `PT3M`, `PT3M1S`, `PT1H2M`, `P0D`
- [x] `fetchLatestVideos` makes exactly 3 API calls, never calls `search`, and returns ≤3 non-Shorts newest first in the SPEC response shape
- [x] Thumbnail falls back maxres → high → medium

**Verification:**
- [x] `npx vitest run` passes (fetch mocked with fixture responses)

**Dependencies:** None

**Files likely touched:** `package.json`, `src/youtube.js`, `test/youtube.test.js`, `.gitignore` (add `node_modules`, `.dev.vars`, `.wrangler`)

**Estimated scope:** M

### Task 2: Worker `/videos` with KV cache, cron refresh and CORS

**Description:** Write `src/worker.js` with a `fetch` handler for `/videos` that reads KV `videos:latest` (refreshing inline if it's empty) and a `scheduled` handler that refreshes KV. Add `wrangler.jsonc` with the name, `main`, assets, `vars` (`CHANNEL_ID`, `ALLOWED_ORIGINS`), the `VIDEOS` KV binding and the `*/30 * * * *` cron. Local dev reads the key from `.env` (wrangler 4 loads it when there is no `.dev.vars`).

**Acceptance criteria:**
- [x] `/videos` returns the SPEC JSON with `Cache-Control: public, max-age=300`
- [x] `Access-Control-Allow-Origin` is echoed only for origins in `ALLOWED_ORIGINS`, and `OPTIONS` preflight is handled
- [x] A refresh failure leaves the existing KV value untouched and logs the error; `/videos` with empty KV plus a failed refresh returns 502 JSON `{ "videos": [] }`

**Verification:**
- [x] `npx vitest run` passes (fake env + stubbed fetch)
- [x] `npx wrangler dev`, then `curl -i localhost:8787/videos` shows real Journal episodes
- [x] `curl -i -H "Origin: https://evil.example" localhost:8787/videos` returns no ACAO header
- [x] `npx wrangler dev --test-scheduled`, then `curl localhost:8787/__scheduled` refreshes KV

**Dependencies:** Task 1

**Files likely touched:** `src/worker.js`, `wrangler.jsonc`, `test/worker.test.js`

**Estimated scope:** M

## Checkpoint A: Local data
- [x] All tests pass
- [x] Real data served locally, no Shorts
- [x] Review with George before continuing

## Phase 2: Display

### Task 3: Client script, scoped CSS and local test page

**Description:** Write `public/yt-listings.js`, an IIFE that finds every `[data-yt-listings]`, injects a `<style>` block scoped to `.yt-listings` once, renders 3 placeholder cards, fetches `/videos` (URL derived from the script's own `src`), then renders cards: a 16:9 lazy thumbnail with alt = title, an uppercase title clamped to 3 lines, and a `Watch` link with classes `outlined-button w-button` and `target="_blank" rel="noopener"`. Black card, 2px white border, flex row that stacks at ≤767px. Add `public/index.html` with the embed snippet on a black background, with Montserrat loaded to mimic the site.

**Acceptance criteria:**
- [x] DOM is built with `createElement`/`textContent` only (no `innerHTML` with API data)
- [x] On fetch error or empty list, placeholders are removed, the container is empty and a `console.warn` is logged
- [x] No globals are added; CSS selectors are all prefixed `.yt-listings`

**Verification:**
- [x] `npx vitest run` passes (`test/render.test.js`, jsdom: 3 cards, correct href/target/alt, `<img onerror>` title rendered as text, error leaves it empty)
- [x] Manual: `npx wrangler dev`, open `localhost:8787` at 1280px (row of 3) and 375px (1 column), with no layout shift on load

**Dependencies:** Task 2

**Files likely touched:** `public/yt-listings.js`, `public/index.html`, `test/render.test.js`, `package.json` (jsdom dev dep)

**Estimated scope:** M

## Checkpoint B: Local end-to-end
- [x] All tests pass
- [x] Visual review with George against the live site

## Phase 3: Ship

### Task 4: Cloudflare setup and README

**Description:** Done early: `npx wrangler login`, KV namespace `YOUTUBE_LISTINGS_VIDEOS` created and its ID added to `wrangler.jsonc`. Remaining: set the secret (`npx wrangler secret put GOOGLE_CLOUD_API_KEY` or in the dashboard). Recommend restricting the key to YouTube Data API v3 in Google Cloud Console. Write `README.md`: what it does, local dev, tests, deploy-on-push, config table, how to add a domain, the Webflow embed snippet.

**Acceptance criteria:**
- [x] `wrangler.jsonc` has the real KV namespace ID
- [x] Secret exists on the Worker (`npx wrangler secret list`)
- [x] README covers setup, dev, test, deploy, adding a domain and the embed snippet

**Verification:**
- [x] `npx wrangler deploy --dry-run` succeeds
- [x] `npx wrangler secret list` shows `GOOGLE_CLOUD_API_KEY`

**Dependencies:** Task 3

**Files likely touched:** `wrangler.jsonc`, `README.md`

**Estimated scope:** S

### Task 5: Deploy (push) and embed on Webflow staging

**Description:** With George's go-ahead, commit and push to `main` (which deploys). Verify the live Worker, then George adds the embed snippet to a Webflow Embed element and publishes staging.

**Acceptance criteria:**
- [x] `https://you-alright-mate-youtube-listings.george-49a.workers.dev/videos` returns 3 videos
- [x] Cards render on `different-hats-staging.webflow.io` and match the site style
- [x] SPEC success criteria 1-9 are all met

**Verification:**
- [x] `curl -i -H "Origin: https://www.different-hats.co.uk" <worker>/videos` echoes ACAO
- [x] View source / Network on staging shows no API key
- [x] Manual check at desktop and mobile widths on staging

**Dependencies:** Task 4

**Files likely touched:** none (git + Webflow)

**Estimated scope:** XS

## Checkpoint C: Complete
- [x] All SPEC success criteria met on staging
- [x] README accurate
