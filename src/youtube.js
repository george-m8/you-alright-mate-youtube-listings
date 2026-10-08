const API_BASE = 'https://www.googleapis.com/youtube/v3';
const SHORTS_MAX_SECONDS = 180;
const CANDIDATES = 15;
const LISTING_COUNT = 3;

export function parseDuration(iso) {
  const [, h = 0, m = 0, s = 0] = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) ?? [];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

// YouTube has no "is Short" flag, so anything 3 minutes or under counts as one.
export function isShort(video) {
  return parseDuration(video.contentDetails.duration) <= SHORTS_MAX_SECONDS;
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

async function callApi(fetchFn, endpoint, params) {
  const url = `${API_BASE}/${endpoint}?${new URLSearchParams(params)}`;
  const res = await fetchFn(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`YouTube ${endpoint} ${res.status}: ${body.error?.message ?? res.statusText}`);
  }
  return body;
}

// Costs 3 quota units: channels.list, playlistItems.list, videos.list (never search.list).
export async function fetchLatestVideos(apiKey, channelId, fetchFn = fetch) {
  const channels = await callApi(fetchFn, 'channels', { part: 'contentDetails', id: channelId, key: apiKey });
  const uploads = channels.items?.[0]?.contentDetails.relatedPlaylists.uploads;
  if (!uploads) throw new Error(`Channel not found: ${channelId}`);

  const playlist = await callApi(fetchFn, 'playlistItems', {
    part: 'contentDetails',
    playlistId: uploads,
    maxResults: CANDIDATES,
    key: apiKey,
  });
  const ids = playlist.items.map((item) => item.contentDetails.videoId);
  if (ids.length === 0) return [];

  const videos = await callApi(fetchFn, 'videos', { part: 'snippet,contentDetails', id: ids.join(','), key: apiKey });
  return videos.items
    .filter((video) => !isShort(video))
    .sort((a, b) => b.snippet.publishedAt.localeCompare(a.snippet.publishedAt))
    .slice(0, LISTING_COUNT)
    .map(toListing);
}
