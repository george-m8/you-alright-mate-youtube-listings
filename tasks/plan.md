# Implementation Plan: YouTube Listings for Webflow

## Overview

A Cloudflare Worker (`you-alright-mate-youtube-listings`) refreshes the latest 3 long-form videos from `@different-hats` into KV every 30 minutes, serves them as JSON at `/videos`, and serves a plain-JS client script at `/yt-listings.js` that renders site-styled cards into `<div data-yt-listings>`. See `SPEC.md` for full requirements.

## Current State

- Repo has `SPEC.md`, `example.env`, `.gitignore` (ignores `.env`). No code, no `wrangler.jsonc`, no `package.json`.
- Pushing to `main` deploys to Cloudflare via Workers Builds, so **every push is a deploy**.

## Dependency Graph

```
youtube.js (API client, duration parse, Shorts filter, mapping)
    │
    └── worker.js (/videos, KV cache, cron refresh, CORS)  ← wrangler.jsonc
            │
            └── public/yt-listings.js (fetch /videos, render cards, scoped CSS)
                    │
                    └── Cloudflare setup (KV namespace, secret) → push/deploy → Webflow embed
```

## Architecture Decisions

- **KV + cron, not the Cache API.** The Cache API does nothing on `*.workers.dev`, which is the host we're using. KV with a 30-minute cron is predictable and uses about 48 writes/day (the free limit is 1,000).
- **Worker tests use a hand-rolled fake `env`** (`{ VIDEOS: { get, put }, ... }`) and a stubbed `fetch`, not `@cloudflare/vitest-pool-workers`. That keeps dev dependencies to `wrangler`, `vitest` and `jsdom`, which is enough for this much logic.
- **Static assets** (`assets.directory = "./public"`) serve `yt-listings.js` and the local test page. The Worker only handles `/videos`.
- **Button reuses the site's `outlined-button w-button` classes**, with scoped fallback CSS (see SPEC Visual Design).
- **Fail safe:** a failed refresh never overwrites the last good KV value, and the client leaves the container empty if the fetch fails.

## Task List

### Phase 1: Data path (highest risk first: real API + quota maths)
- [x] Task 1: YouTube client module with unit tests
- [x] Task 2: Worker `/videos` with KV cache, cron refresh and CORS

### Checkpoint A: Local data
- [x] `npx vitest run` passes
- [x] `npx wrangler dev` then `curl localhost:8787/videos` returns 3 real "The Journal" episodes, no Shorts
- [x] Review with George

### Phase 2: Display
- [x] Task 3: Client script, scoped CSS and local test page

### Checkpoint B: Local end-to-end
- [x] Test page at `localhost:8787` shows 3 cards in a row at 1280px and 1 column at 375px
- [x] Visual review with George against the live site

### Phase 3: Ship
- [x] Task 4: Cloudflare setup and README
- [ ] Task 5: Deploy (push) and embed on Webflow staging

### Checkpoint C: Complete
- [ ] All SPEC success criteria (1-9) met on staging
- [ ] README accurate

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Push deploys before the KV namespace ID or secret exists, so the deploy fails or `/videos` errors | Med | Task 4 creates the KV namespace and sets the secret **before** the first push; ask before every push |
| Workers Builds requires `name` in `wrangler.jsonc` to match the Worker name | Med | Use `you-alright-mate-youtube-listings` exactly |
| Shorts heuristic (≤180s) hides a short regular video | Low | Agreed for now; the threshold is a single constant |
| Upcoming/live premieres have duration `P0D` | Low | Treated as ≤180s, so they're excluded; covered by a unit test |
| Deploys overwrite `vars` set in the dashboard | Low | All non-secret config lives in `wrangler.jsonc`; only the API key is a dashboard/CLI secret |
| Webflow Designer canvas may not run embed scripts | Low | Verify on the published staging site, not in the Designer |

## Open Questions

- Third domain (coming soon): add it to `ALLOWED_ORIGINS` when known.
