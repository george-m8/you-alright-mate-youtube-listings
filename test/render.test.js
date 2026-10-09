import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

const SCRIPT = readFileSync(new URL('../public/yt-listings.js', import.meta.url), 'utf8');

const VIDEOS = [1, 2, 3].map((n) => ({
  id: `v${n}`,
  title: `Episode ${n}`,
  thumbnail: `https://i.ytimg.com/vi/v${n}/maxresdefault.jpg`,
  url: `https://www.youtube.com/watch?v=v${n}`,
  publishedAt: `2026-10-0${n}T00:00:00Z`,
  description: `About episode ${n}.`,
  links: [],
}));

const MANY = Array.from({ length: 30 }, (_, i) => ({ ...VIDEOS[0], id: `m${i}`, title: `Episode m${i}` }));
const SHORTS = Array.from({ length: 12 }, (_, i) => ({
  id: `s${i}`,
  title: `Short ${i}`,
  thumbnail: `https://i.ytimg.com/vi/s${i}/maxresdefault.jpg`,
  url: `https://www.youtube.com/shorts/s${i}`,
  publishedAt: '2026-10-01T00:00:00Z',
}));

// Loads the client script into a fresh page with a stubbed fetch and waits for it to settle.
async function render(fetchImpl, markup = '<div data-yt-listings></div>') {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${markup}</body></html>`, {
    url: 'https://worker.example/',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  // A deferred script runs once parsing is done, like this.
  if (window.document.readyState === 'loading') {
    await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve));
  }
  window.fetch = vi.fn(fetchImpl);
  window.console.warn = vi.fn();
  window.eval(SCRIPT);
  const container = window.document.querySelector('[data-yt-listings]');
  const placeholdersShown = container.querySelectorAll('.yt-listings__card--loading').length;
  await vi.waitFor(() => expect(container.querySelector('.yt-listings__card--loading')).toBeNull());
  return { window, container, placeholdersShown };
}

const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });

describe('container options', () => {
  it('shows 3 by default even when 30 videos are cached (homepage embed)', async () => {
    const { container, placeholdersShown } = await render(ok({ videos: MANY, shorts: SHORTS }));

    expect(placeholdersShown).toBe(3);
    expect(container.querySelectorAll('.yt-listings__card')).toHaveLength(3);
    expect(container.className).toBe('yt-listings yt-listings--grid');
    expect(container.querySelector('.yt-listings__description')).toBeNull();
    expect(container.querySelector('.yt-listings__links')).toBeNull();
  });

  it('shows up to data-yt-limit videos, capped at 30', async () => {
    const thirty = await render(ok({ videos: MANY }), '<div data-yt-listings data-yt-limit="30"></div>');
    expect(thirty.placeholdersShown).toBe(30);
    expect(thirty.container.querySelectorAll('.yt-listings__card')).toHaveLength(30);

    const tooMany = await render(ok({ videos: MANY }), '<div data-yt-listings data-yt-limit="100"></div>');
    expect(tooMany.placeholdersShown).toBe(30);
  });

  it('shows fewer cards when fewer videos exist than the limit', async () => {
    const { container } = await render(ok({ videos: VIDEOS }), '<div data-yt-listings data-yt-limit="30"></div>');
    expect(container.querySelectorAll('.yt-listings__card')).toHaveLength(3);
  });

  it('renders the latest 4 Shorts linking to the Shorts player', async () => {
    const { container } = await render(ok({ videos: MANY, shorts: SHORTS }), '<div data-yt-listings data-yt-source="shorts"></div>');

    expect(container.classList.contains('yt-listings--shorts')).toBe(true);
    const links = [...container.querySelectorAll('a.yt-listings__watch')].map((a) => a.href);
    expect(links).toEqual(SHORTS.slice(0, 4).map((s) => s.url));
  });

  it('leaves a Shorts container empty and warns when the cache has no Shorts yet', async () => {
    const { window, container } = await render(ok({ videos: VIDEOS }), '<div data-yt-listings data-yt-source="shorts"></div>');
    expect(container.children).toHaveLength(0);
    expect(window.console.warn).toHaveBeenCalled();
  });

  it('shows the description preview when data-yt-description is set', async () => {
    const { container } = await render(ok({ videos: VIDEOS }), '<div data-yt-listings data-yt-description="true"></div>');
    const descriptions = [...container.querySelectorAll('.yt-listings__description')].map((p) => p.textContent);
    expect(descriptions).toEqual(['About episode 1.', 'About episode 2.', 'About episode 3.']);
  });

  it('treats data-yt-description="false" as off', async () => {
    const { container } = await render(ok({ videos: VIDEOS }), '<div data-yt-listings data-yt-description="false"></div>');
    expect(container.querySelector('.yt-listings__description')).toBeNull();
  });

  it('skips the description for videos without one (older cache)', async () => {
    const bare = VIDEOS.map(({ description, links, ...rest }) => rest);
    const { container } = await render(ok({ videos: bare }), '<div data-yt-listings data-yt-description data-yt-links></div>');
    expect(container.querySelectorAll('.yt-listings__card')).toHaveLength(3);
    expect(container.querySelector('.yt-listings__description')).toBeNull();
    expect(container.querySelector('.yt-listings__links')).toBeNull();
  });

  it('shows platform links only for videos that have them', async () => {
    const withLinks = {
      ...VIDEOS[0],
      links: [
        { name: 'Apple Podcasts', url: 'https://podcasts.apple.com/x' },
        { name: 'Spotify', url: 'https://open.spotify.com/x' },
      ],
    };
    const { container } = await render(ok({ videos: [withLinks, VIDEOS[1]] }), '<div data-yt-listings data-yt-links="true"></div>');

    const lines = container.querySelectorAll('.yt-listings__links');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe('Other ways to watch and listen: Apple Podcasts, Spotify');
    const anchors = lines[0].querySelectorAll('a');
    expect(anchors[1].href).toBe('https://open.spotify.com/x');
    expect(anchors[1].target).toBe('_blank');
    expect(anchors[1].rel).toBe('noopener');
  });

  it('alternates the thumbnail side in the list layout', async () => {
    const { container } = await render(
      ok({ videos: VIDEOS }),
      '<div data-yt-listings data-yt-layout="list" data-yt-thumb="alternate"></div>',
    );
    expect(container.classList.contains('yt-listings--list')).toBe(true);
    const flipped = [...container.querySelectorAll('.yt-listings__card')].map((c) => c.classList.contains('yt-listings__card--flip'));
    expect(flipped).toEqual([false, true, false]);
  });

  it('fetches once for several containers', async () => {
    const { window } = await render(
      ok({ videos: MANY, shorts: SHORTS }),
      '<div data-yt-listings data-yt-source="shorts"></div><div data-yt-listings data-yt-limit="30"></div>',
    );
    expect(window.fetch).toHaveBeenCalledTimes(1);
    const [shorts, videos] = window.document.querySelectorAll('[data-yt-listings]');
    expect(shorts.querySelectorAll('.yt-listings__card')).toHaveLength(4);
    expect(videos.querySelectorAll('.yt-listings__card')).toHaveLength(30);
  });
});

describe('yt-listings client', () => {
  it('shows 3 placeholders, then 3 video cards', async () => {
    const { container, placeholdersShown } = await render(ok({ videos: VIDEOS }));

    expect(placeholdersShown).toBe(3);
    const cards = container.querySelectorAll('.yt-listings__card');
    expect(cards).toHaveLength(3);
    expect(container.classList.contains('yt-listings')).toBe(true);
  });

  it('fetches /videos from the same host as the page', async () => {
    const { window } = await render(ok({ videos: VIDEOS }));
    expect(window.fetch).toHaveBeenCalledWith('https://worker.example/videos');
  });

  it('renders thumbnail, title and a Watch link that opens YouTube in a new tab', async () => {
    const { container } = await render(ok({ videos: VIDEOS }));
    const card = container.querySelector('.yt-listings__card');

    const img = card.querySelector('img');
    expect(img.src).toBe(VIDEOS[0].thumbnail);
    expect(img.alt).toBe('Episode 1');
    expect(img.getAttribute('loading')).toBe('lazy');

    expect(card.querySelector('.yt-listings__title').textContent).toBe('Episode 1');

    const link = card.querySelector('a');
    expect(link.textContent).toBe('Watch');
    expect(link.href).toBe(VIDEOS[0].url);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');
    expect(link.classList.contains('outlined-button')).toBe(true);
    expect(link.classList.contains('w-button')).toBe(true);
  });

  it('renders HTML in titles as plain text', async () => {
    const evil = { ...VIDEOS[0], title: '<img src=x onerror="alert(1)">' };
    const { container } = await render(ok({ videos: [evil] }));

    const title = container.querySelector('.yt-listings__title');
    expect(title.textContent).toBe(evil.title);
    expect(title.children).toHaveLength(0);
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('injects scoped styles once', async () => {
    const { window } = await render(ok({ videos: VIDEOS }));
    const styles = window.document.querySelectorAll('#yt-listings-style');

    expect(styles).toHaveLength(1);
    const selectors = styles[0].textContent.split('\n').filter((rule) => !rule.startsWith('@media'));
    for (const rule of selectors) {
      expect(rule).toMatch(/^(:where\()?\.yt-listings/);
    }
  });

  it.each([
    ['a network error', async () => { throw new Error('offline'); }],
    ['a 502 response', async () => ({ ok: false, status: 502, json: async () => ({ videos: [] }) })],
    ['an empty list', ok({ videos: [] })],
  ])('leaves the container empty and warns on %s', async (_, fetchImpl) => {
    const { window, container } = await render(fetchImpl);

    expect(container.children).toHaveLength(0);
    expect(window.console.warn).toHaveBeenCalled();
  });

  it('adds no globals', async () => {
    const before = new JSDOM('').window;
    const { window } = await render(ok({ videos: VIDEOS }));
    const added = Object.keys(window).filter((key) => !(key in before) && key !== 'fetch');
    expect(added).toEqual([]);
  });
});
