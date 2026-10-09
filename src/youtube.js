const API_BASE = 'https://www.googleapis.com/youtube/v3';
const SHORTS_MAX_SECONDS = 180;
const PAGE_SIZE = 50; // The most playlistItems.list and videos.list accept per call.
const CANDIDATE_PAGES = 2; // About half the channel's uploads are Shorts, so 100 candidates covers 30 videos.
const VIDEO_COUNT = 30;
const SHORTS_COUNT = 12;
const PREVIEW_MAX_CHARS = 280;

// Hosts are matched exactly or as a parent domain (open.spotify.com matches spotify.com).
const PLATFORMS = [
  ['Apple Podcasts', ['podcasts.apple.com']],
  ['Spotify', ['spotify.com', 'spotify.link']],
  ['Acast', ['acast.com']],
  ['Amazon Music', ['music.amazon.com', 'music.amazon.co.uk']],
  ['YouTube Music', ['music.youtube.com']],
  ['Pocket Casts', ['pocketcasts.com', 'pca.st']],
  ['Overcast', ['overcast.fm']],
];

export function parseDuration(iso) {
  const [, h = 0, m = 0, s = 0] = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) ?? [];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// YouTube has no "is Short" flag, so anything 3 minutes or under counts as one.
export function isShort(video) {
  return parseDuration(video.contentDetails.duration) <= SHORTS_MAX_SECONDS;
}

// The opening paragraphs, stopping at the first one with a URL (sponsor and link blocks).
export function descriptionPreview(description) {
  const kept = [];
  for (const paragraph of description.split(/\n\s*\n/)) {
    if (/https?:\/\//.test(paragraph)) break;
    kept.push(paragraph);
  }
  const text = kept.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, PREVIEW_MAX_CHARS).replace(/\s+\S*$/, '')}…`;
}

// Links to other podcast/music platforms in the description, first one per platform.
export function platformLinks(description) {
  const links = [];
  for (const match of description.match(/https?:\/\/[^\s<>()"]+/g) ?? []) {
    const url = match.replace(/[.,;:!?']+$/, '');
    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      continue; // Not a valid URL, e.g. a bare "https://".
    }
    const platform = PLATFORMS.find(([, hosts]) => hosts.some((h) => host === h || host.endsWith(`.${h}`)));
    if (platform && !links.some((link) => link.name === platform[0])) {
      links.push({ name: platform[0], url });
    }
  }
  return links;
}

function baseListing(video, url) {
  const { id, snippet } = video;
  const thumbs = snippet.thumbnails;
  return {
    id,
    title: snippet.title,
    thumbnail: (thumbs.maxres ?? thumbs.high ?? thumbs.medium).url,
    url,
    publishedAt: snippet.publishedAt,
  };
}

export function toListing(video) {
  const { description } = video.snippet;
  return {
    ...baseListing(video, `https://www.youtube.com/watch?v=${video.id}`),
    description: descriptionPreview(description),
    links: platformLinks(description),
  };
}

// Shorts titles often end in a run of hashtags, which look messy on a card.
export function toShort(video) {
  const short = baseListing(video, `https://www.youtube.com/shorts/${video.id}`);
  return { ...short, title: short.title.replace(/(\s*#[\p{L}\p{N}_]+)+\s*$/u, '').trim() || short.title };
}

async function callApi(fetchFn, endpoint, params) {
  const url = `${API_BASE}/${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetchFn(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`YouTube ${endpoint} ${res.status}: ${body.error?.message ?? res.statusText}`);
  }
  return body;
}

// Costs up to 5 quota units: channels.list, 2x playlistItems.list, 2x videos.list (never search.list).
export async function fetchLatestVideos(apiKey, channelId, fetchFn = fetch) {
  const channels = await callApi(fetchFn, 'channels', { part: 'contentDetails', id: channelId, key: apiKey });
  const uploads = channels.items?.[0]?.contentDetails.relatedPlaylists.uploads;
  if (!uploads) throw new Error(`Channel not found: ${channelId}`);

  const ids = [];
  let pageToken;
  for (let page = 0; page < CANDIDATE_PAGES; page++) {
    const playlist = await callApi(fetchFn, 'playlistItems', {
      part: 'contentDetails',
      playlistId: uploads,
      maxResults: PAGE_SIZE,
      key: apiKey,
      ...(pageToken && { pageToken }),
    });
    ids.push(...playlist.items.map((item) => item.contentDetails.videoId));
    pageToken = playlist.nextPageToken;
    if (!pageToken) break;
  }

  const items = [];
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const batch = ids.slice(i, i + PAGE_SIZE).join(',');
    const videos = await callApi(fetchFn, 'videos', { part: 'snippet,contentDetails', id: batch, key: apiKey });
    items.push(...videos.items);
  }
  items.sort((a, b) => b.snippet.publishedAt.localeCompare(a.snippet.publishedAt));

  return {
    videos: items.filter((video) => !isShort(video)).slice(0, VIDEO_COUNT).map(toListing),
    // Upcoming/live premieres have a zero duration and belong in neither list.
    shorts: items
      .filter((video) => isShort(video) && parseDuration(video.contentDetails.duration) > 0)
      .slice(0, SHORTS_COUNT)
      .map(toShort),
  };
}
