import { describe, expect, it, vi } from 'vitest';
import { fetchLatestVideos, isShort, parseDuration, toListing } from '../src/youtube.js';

function video(id, duration, publishedAt, thumbnails = { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } }) {
  return { id, snippet: { title: `Title ${id}`, publishedAt, thumbnails }, contentDetails: { duration } };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockYouTube(videos) {
  return vi.fn(async (url) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith('/channels')) {
      return jsonResponse({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUchannel' } } }] });
    }
    if (pathname.endsWith('/playlistItems')) {
      return jsonResponse({ items: videos.map((v) => ({ contentDetails: { videoId: v.id } })) });
    }
    if (pathname.endsWith('/videos')) {
      return jsonResponse({ items: videos });
    }
    throw new Error(`Unexpected URL ${url}`);
  });
}

describe('parseDuration', () => {
  it.each([
    ['PT59S', 59],
    ['PT3M', 180],
    ['PT3M1S', 181],
    ['PT1H2M', 3720],
    ['P0D', 0],
  ])('%s is %i seconds', (iso, seconds) => {
    expect(parseDuration(iso)).toBe(seconds);
  });
});

describe('isShort', () => {
  it('treats 180s or less as a Short', () => {
    expect(isShort(video('a', 'PT3M', ''))).toBe(true);
    expect(isShort(video('b', 'PT3M1S', ''))).toBe(false);
  });

  it('treats upcoming/live premieres (P0D) as a Short so they are excluded', () => {
    expect(isShort(video('c', 'P0D', ''))).toBe(true);
  });
});

describe('toListing', () => {
  it('maps to the /videos response shape', () => {
    expect(toListing(video('abc', 'PT20M', '2026-10-01T09:00:00Z'))).toEqual({
      id: 'abc',
      title: 'Title abc',
      thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=abc',
      publishedAt: '2026-10-01T09:00:00Z',
    });
  });

  it('prefers maxres, then high, then medium thumbnails', () => {
    const thumbs = { maxres: { url: 'max' }, high: { url: 'high' }, medium: { url: 'medium' } };
    expect(toListing(video('a', 'PT20M', '', thumbs)).thumbnail).toBe('max');
    expect(toListing(video('a', 'PT20M', '', { high: thumbs.high, medium: thumbs.medium })).thumbnail).toBe('high');
    expect(toListing(video('a', 'PT20M', '', { medium: thumbs.medium })).thumbnail).toBe('medium');
  });
});

describe('fetchLatestVideos', () => {
  const uploads = [
    video('short1', 'PT45S', '2026-10-07T00:00:00Z'),
    video('v1', 'PT25M', '2026-10-06T00:00:00Z'),
    video('v2', 'PT30M', '2026-09-27T00:00:00Z'),
    video('short2', 'PT2M', '2026-09-25T00:00:00Z'),
    video('v3', 'PT18M', '2026-09-20T00:00:00Z'),
    video('v4', 'PT40M', '2026-09-13T00:00:00Z'),
  ];

  it('returns the newest 3 non-Shorts, newest first', async () => {
    const videos = await fetchLatestVideos('key', 'UCchannel', mockYouTube(uploads));
    expect(videos.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
  });

  it('makes exactly 3 API calls and never uses search', async () => {
    const fetchFn = mockYouTube(uploads);
    await fetchLatestVideos('key', 'UCchannel', fetchFn);
    const paths = fetchFn.mock.calls.map(([url]) => new URL(url).pathname.split('/').pop());
    expect(paths).toEqual(['channels', 'playlistItems', 'videos']);
  });

  it('passes the key and channel to the API', async () => {
    const fetchFn = mockYouTube(uploads);
    await fetchLatestVideos('secret-key', 'UCchannel', fetchFn);
    const channelsUrl = new URL(fetchFn.mock.calls[0][0]);
    expect(channelsUrl.searchParams.get('key')).toBe('secret-key');
    expect(channelsUrl.searchParams.get('id')).toBe('UCchannel');
  });

  it('sorts by publish date even if the API returns them out of order', async () => {
    const shuffled = [uploads[4], uploads[1], uploads[2]];
    const videos = await fetchLatestVideos('key', 'UCchannel', mockYouTube(shuffled));
    expect(videos.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
  });

  it('throws with the status and API message on an error response', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: { message: 'API key not valid' } }, 400));
    await expect(fetchLatestVideos('bad', 'UCchannel', fetchFn)).rejects.toThrow('400: API key not valid');
  });

  it('throws if the channel is not found', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ items: [] }));
    await expect(fetchLatestVideos('key', 'UCmissing', fetchFn)).rejects.toThrow('Channel not found');
  });
});
