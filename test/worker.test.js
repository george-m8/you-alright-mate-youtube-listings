import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker.js';

const LISTING = {
  id: 'v1',
  title: 'Title v1',
  thumbnail: 'https://i.ytimg.com/vi/v1/hqdefault.jpg',
  url: 'https://www.youtube.com/watch?v=v1',
  publishedAt: '2026-10-06T00:00:00Z',
};
const CACHED = { updatedAt: '2026-10-08T12:00:00.000Z', videos: [LISTING] };

function fakeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key, type) => {
      const value = store.get(key) ?? null;
      return type === 'json' && value !== null ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key, value) => void store.set(key, value)),
  };
}

function makeEnv(kvContents) {
  return {
    GOOGLE_CLOUD_API_KEY: 'test-key',
    CHANNEL_ID: 'UCchannel',
    ALLOWED_ORIGINS: 'https://different-hats-staging.webflow.io, https://www.different-hats.co.uk',
    VIDEOS: fakeKv(kvContents),
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Stubs the three YouTube calls with one long-form video.
function youTubeOk() {
  return vi.fn(async (url) => {
    const endpoint = new URL(url).pathname.split('/').pop();
    if (endpoint === 'channels') return jsonResponse({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU' } } }] });
    if (endpoint === 'playlistItems') return jsonResponse({ items: [{ contentDetails: { videoId: 'v1' } }] });
    return jsonResponse({
      items: [{
        id: 'v1',
        snippet: { title: 'Title v1', publishedAt: LISTING.publishedAt, thumbnails: { high: { url: LISTING.thumbnail } } },
        contentDetails: { duration: 'PT20M' },
      }],
    });
  });
}

function youTubeDown() {
  return vi.fn(async () => jsonResponse({ error: { message: 'Backend Error' } }, 503));
}

function request(path, { origin, method = 'GET' } = {}) {
  const headers = origin ? { Origin: origin } : {};
  return new Request(`https://worker.example${path}`, { method, headers });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /videos', () => {
  it('serves cached videos from KV without calling YouTube', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const env = makeEnv({ 'videos:latest': JSON.stringify(CACHED) });

    const res = await worker.fetch(request('/videos'), env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CACHED);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refreshes inline and stores the result when KV is empty', async () => {
    vi.stubGlobal('fetch', youTubeOk());
    const env = makeEnv();

    const res = await worker.fetch(request('/videos'), env);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.videos).toEqual([LISTING]);
    expect(JSON.parse(env.VIDEOS.store.get('videos:latest')).videos).toEqual([LISTING]);
  });

  it('returns 502 with an empty list when KV is empty and the refresh fails', async () => {
    vi.stubGlobal('fetch', youTubeDown());

    const res = await worker.fetch(request('/videos'), makeEnv());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ videos: [] });
    expect(console.error).toHaveBeenCalled();
  });

  it('returns 404 for other paths', async () => {
    const res = await worker.fetch(request('/nope'), makeEnv());
    expect(res.status).toBe(404);
  });
});

describe('CORS', () => {
  it('echoes an allowed origin', async () => {
    const env = makeEnv({ 'videos:latest': JSON.stringify(CACHED) });
    const res = await worker.fetch(request('/videos', { origin: 'https://www.different-hats.co.uk' }), env);

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://www.different-hats.co.uk');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('sends no Access-Control-Allow-Origin for other origins', async () => {
    const env = makeEnv({ 'videos:latest': JSON.stringify(CACHED) });
    const res = await worker.fetch(request('/videos', { origin: 'https://evil.example' }), env);

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('answers OPTIONS preflight with 204', async () => {
    const res = await worker.fetch(
      request('/videos', { origin: 'https://different-hats-staging.webflow.io', method: 'OPTIONS' }),
      makeEnv(),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://different-hats-staging.webflow.io');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
  });
});

describe('scheduled refresh', () => {
  function runScheduled(env) {
    const pending = [];
    worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
    return Promise.all(pending);
  }

  it('writes fresh videos to KV', async () => {
    vi.stubGlobal('fetch', youTubeOk());
    const env = makeEnv();

    await runScheduled(env);

    const stored = JSON.parse(env.VIDEOS.store.get('videos:latest'));
    expect(stored.videos).toEqual([LISTING]);
    expect(Date.parse(stored.updatedAt)).not.toBeNaN();
  });

  it('keeps the last good value and logs when YouTube fails', async () => {
    vi.stubGlobal('fetch', youTubeDown());
    const env = makeEnv({ 'videos:latest': JSON.stringify(CACHED) });

    await runScheduled(env);

    expect(env.VIDEOS.put).not.toHaveBeenCalled();
    expect(JSON.parse(env.VIDEOS.store.get('videos:latest'))).toEqual(CACHED);
    expect(console.error).toHaveBeenCalled();
  });
});
