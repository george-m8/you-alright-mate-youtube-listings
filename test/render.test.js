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
}));

// Loads the client script into a fresh page with a stubbed fetch and waits for it to settle.
async function render(fetchImpl) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div data-yt-listings></div></body></html>', {
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
