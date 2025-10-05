import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const openaiApiKey = process.env.OPENAI_API_KEY;
let openaiClient = null;
if (openaiApiKey && openaiApiKey.trim().length > 0) {
  openaiClient = new OpenAI({ apiKey: openaiApiKey });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

function hashStringToInt(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function svgPlaceholder(prompt, width, height, seed) {
  const hash = hashStringToInt(`${prompt}-${seed}`);
  const hueA = hash % 360;
  const hueB = (hueA + 60) % 360;
  const bg1 = hslToHex(hueA, 70, 60);
  const bg2 = hslToHex(hueB, 70, 40);
  const safePrompt = prompt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg1}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="100%" height="100%" fill="url(#g)"/>
  <g>
    <rect x="16" y="16" rx="12" ry="12" width="${width - 32}" height="${height - 32}" fill="rgba(255,255,255,0.25)" />
    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif" font-size="${Math.max(14, Math.min(width, height) / 16)}" fill="#111" opacity="0.9" style="paint-order: stroke; stroke: rgba(255,255,255,0.65); stroke-width: 6px;">
      ${safePrompt}
    </text>
  </g>
</svg>`;
  const base64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

function parseSize(size) {
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return { width: 512, height: 512 };
  return { width: Math.max(64, parseInt(match[1], 10)), height: Math.max(64, parseInt(match[2], 10)) };
}

function generateFallbackImages(prompt, n, size) {
  const { width, height } = parseSize(size);
  const images = [];
  for (let i = 0; i < n; i++) {
    images.push(svgPlaceholder(prompt, width, height, i));
  }
  return images;
}

async function generateWithOpenAI(prompt, n, size) {
  if (!openaiClient) return null;
  const response = await openaiClient.images.generate({
    model: 'gpt-image-1',
    prompt,
    n,
    size,
  });
  const images = (response?.data || []).map(item => {
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item.url) return item.url;
    return null;
  }).filter(Boolean);
  return images;
}

app.post('/api/generate', async (req, res) => {
  try {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required.' });
    }
    const nRaw = parseInt(req.body?.n, 10);
    const n = Number.isFinite(nRaw) ? Math.max(1, Math.min(4, nRaw)) : 1;
    const size = ['256x256', '512x512', '1024x1024'].includes(req.body?.size) ? req.body.size : '512x512';

    let images = null;
    let provider = 'fallback';

    if (openaiClient) {
      try {
        images = await generateWithOpenAI(prompt, n, size);
        provider = 'openai';
      } catch (err) {
        console.error('OpenAI generation failed, using fallback. Details:', err?.response?.data || err?.message || err);
        images = null;
        provider = 'openai-fallback';
      }
    }

    if (!images || images.length === 0) {
      images = generateFallbackImages(prompt, n, size);
    }

    return res.json({ images, provider });
  } catch (error) {
    console.error('Unhandled error in /api/generate:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

app.use((err, _req, res, _next) => {
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Imagination-to-Image server listening on http://localhost:${port}`);
});
