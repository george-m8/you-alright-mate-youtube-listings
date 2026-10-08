import { fetchLatestVideos } from './youtube.js';

const KV_KEY = 'videos:latest';

async function refresh(env) {
  const videos = await fetchLatestVideos(env.GOOGLE_CLOUD_API_KEY, env.CHANNEL_ID);
  const data = { updatedAt: new Date().toISOString(), videos };
  await env.VIDEOS.put(KV_KEY, JSON.stringify(data));
  return data;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  const headers = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  }
  return headers;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', ...headers },
  });
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/videos') {
      return new Response('Not found', { status: 404 });
    }

    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    let data = await env.VIDEOS.get(KV_KEY, 'json');
    if (!data) {
      // First request after deploy, before the cron has run.
      try {
        data = await refresh(env);
      } catch (err) {
        console.error('Inline refresh failed:', err.message);
        return json({ videos: [] }, 502, cors);
      }
    }
    return json(data, 200, cors);
  },

  // Cron: refresh KV. On failure the previous value is left untouched.
  scheduled(controller, env, ctx) {
    ctx.waitUntil(refresh(env).catch((err) => console.error('Scheduled refresh failed:', err.message)));
  },
};
