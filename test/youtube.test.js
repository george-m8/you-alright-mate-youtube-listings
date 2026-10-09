import { describe, expect, it, vi } from 'vitest';
import {
  descriptionPreview,
  fetchLatestVideos,
  isShort,
  parseDuration,
  platformLinks,
  toListing,
  toShort,
} from '../src/youtube.js';

function video(id, duration, publishedAt, thumbnails = { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } }) {
  return { id, snippet: { title: `Title ${id}`, description: '', publishedAt, thumbnails }, contentDetails: { duration } };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Pages playlistItems 50 at a time (pageToken = start index) and answers videos.list by id.
function mockYouTube(videos) {
  return vi.fn(async (url) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith('/channels')) {
      return jsonResponse({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUchannel' } } }] });
    }
    if (pathname.endsWith('/playlistItems')) {
      const start = Number(searchParams.get('pageToken') ?? 0);
      const page = videos.slice(start, start + 50);
      const next = start + 50 < videos.length ? { nextPageToken: String(start + 50) } : {};
      return jsonResponse({ items: page.map((v) => ({ contentDetails: { videoId: v.id } })), ...next });
    }
    if (pathname.endsWith('/videos')) {
      const ids = searchParams.get('id').split(',');
      return jsonResponse({ items: videos.filter((v) => ids.includes(v.id)) });
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

describe('descriptionPreview', () => {
  it('joins the opening paragraphs into one line', () => {
    expect(descriptionPreview('What do you do?\n\nFor nine months,\nI heard no.')).toBe(
      'What do you do? For nine months, I heard no.',
    );
  });

  it('stops at the first paragraph with a URL', () => {
    expect(descriptionPreview('Intro.\n\nSponsored by https://sponsor.example\n\nMore text.')).toBe('Intro.');
  });

  it('is empty when the first paragraph has a URL, or there is no description', () => {
    expect(descriptionPreview('Listen: https://open.spotify.com/x\n\nIntro.')).toBe('');
    expect(descriptionPreview('')).toBe('');
  });

  it('cuts long text at a word boundary to 280 characters with an ellipsis', () => {
    const preview = descriptionPreview('word '.repeat(100));
    expect(preview.length).toBeLessThanOrEqual(281);
    expect(preview).toMatch(/word…$/);
  });
});

describe('platformLinks', () => {
  it('finds known platforms in description order, one per platform', () => {
    const description = [
      'Listen on Spotify: https://open.spotify.com/episode/abc',
      'Apple: https://podcasts.apple.com/gb/podcast/x/id123.',
      'Spotify again: https://open.spotify.com/episode/other',
      'Acast (https://shows.acast.com/show/ep)',
      'Book: https://www.different-hats.co.uk/book',
    ].join('\n');

    expect(platformLinks(description)).toEqual([
      { name: 'Spotify', url: 'https://open.spotify.com/episode/abc' },
      { name: 'Apple Podcasts', url: 'https://podcasts.apple.com/gb/podcast/x/id123' },
      { name: 'Acast', url: 'https://shows.acast.com/show/ep' },
    ]);
  });

  it('returns nothing when there are no platform links', () => {
    expect(platformLinks('Visit https://www.linkedin.com/in/someone and https://')).toEqual([]);
    expect(platformLinks('')).toEqual([]);
  });

  it('does not match lookalike hosts', () => {
    expect(platformLinks('https://notspotify.com/x https://spotify.com.evil.example/x')).toEqual([]);
  });
});

describe('toListing', () => {
  it('maps to the /videos response shape', () => {
    const v = video('abc', 'PT20M', '2026-10-01T09:00:00Z');
    v.snippet.description = 'Episode intro.\n\nhttps://open.spotify.com/episode/abc';
    expect(toListing(v)).toEqual({
      id: 'abc',
      title: 'Title abc',
      thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=abc',
      publishedAt: '2026-10-01T09:00:00Z',
      description: 'Episode intro.',
      links: [{ name: 'Spotify', url: 'https://open.spotify.com/episode/abc' }],
    });
  });

  it('links Shorts to the Shorts player, without description or links', () => {
    expect(toShort(video('s1', 'PT45S', '2026-10-01T09:00:00Z'))).toEqual({
      id: 's1',
      title: 'Title s1',
      thumbnail: 'https://i.ytimg.com/vi/s1/hqdefault.jpg',
      url: 'https://www.youtube.com/shorts/s1',
      publishedAt: '2026-10-01T09:00:00Z',
    });
  });

  it('strips trailing hashtags from Shorts titles, but keeps a title that is only hashtags', () => {
    const tagged = video('s2', 'PT45S', '');
    tagged.snippet.title = 'Change the future?👇#tedtalk #mental_health #2026';
    expect(toShort(tagged).title).toBe('Change the future?👇');

    tagged.snippet.title = '#shorts';
    expect(toShort(tagged).title).toBe('#shorts');
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

  it('splits uploads into videos and Shorts, newest first', async () => {
    const { videos, shorts } = await fetchLatestVideos('key', 'UCchannel', mockYouTube(uploads));
    expect(videos.map((v) => v.id)).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(shorts.map((v) => v.id)).toEqual(['short1', 'short2']);
  });

  it('leaves upcoming/live premieres (P0D) out of both lists', async () => {
    const premiere = video('live', 'P0D', '2026-10-08T00:00:00Z');
    const { videos, shorts } = await fetchLatestVideos('key', 'UCchannel', mockYouTube([premiere, ...uploads]));
    expect([...videos, ...shorts].map((v) => v.id)).not.toContain('live');
  });

  it('makes 3 API calls for a single page of uploads and never uses search', async () => {
    const fetchFn = mockYouTube(uploads);
    await fetchLatestVideos('key', 'UCchannel', fetchFn);
    const paths = fetchFn.mock.calls.map(([url]) => new URL(url).pathname.split('/').pop());
    expect(paths).toEqual(['channels', 'playlistItems', 'videos']);
  });

  it('reads 2 pages (100 candidates) and caps at 30 videos and 12 Shorts', async () => {
    const many = Array.from({ length: 150 }, (_, i) => {
      const date = new Date(Date.UTC(2026, 9, 1) - i * 3600_000).toISOString();
      return video(`u${i}`, i % 2 ? 'PT1M' : 'PT20M', date);
    });
    const fetchFn = mockYouTube(many);

    const { videos, shorts } = await fetchLatestVideos('key', 'UCchannel', fetchFn);

    const paths = fetchFn.mock.calls.map(([url]) => new URL(url).pathname.split('/').pop());
    expect(paths).toEqual(['channels', 'playlistItems', 'playlistItems', 'videos', 'videos']);
    expect(videos).toHaveLength(30);
    expect(videos[0].id).toBe('u0');
    expect(shorts).toHaveLength(12);
    expect(shorts[0].id).toBe('u1');
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
    const { videos } = await fetchLatestVideos('key', 'UCchannel', mockYouTube(shuffled));
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
