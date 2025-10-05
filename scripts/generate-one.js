import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const openaiApiKey = process.env.OPENAI_API_KEY;
const assetsDir = path.resolve('public/assets');

function nowStamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    '-',
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('');
}

function hashStringToInt(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
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

function svgPlaceholder(prompt, width, height, seed = 0) {
  const hash = hashStringToInt(`${prompt}-${seed}`);
  const hueA = hash % 360;
  const hueB = (hueA + 60) % 360;
  const bg1 = hslToHex(hueA, 70, 60);
  const bg2 = hslToHex(hueB, 70, 40);
  const safePrompt = prompt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  <defs>\n    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">\n      <stop offset="0%" stop-color="${bg1}"/>\n      <stop offset="100%" stop-color="${bg2}"/>\n    </linearGradient>\n  </defs>\n  <rect x="0" y="0" width="100%" height="100%" fill="url(#g)"/>\n  <g>\n    <rect x="16" y="16" rx="12" ry="12" width="${width - 32}" height="${height - 32}" fill="rgba(255,255,255,0.25)" />\n    <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif" font-size="${Math.max(14, Math.min(width, height) / 16)}" fill="#111" opacity="0.9" style="paint-order: stroke; stroke: rgba(255,255,255,0.65); stroke-width: 6px;">\n      ${safePrompt}\n    </text>\n  </g>\n</svg>`;
  return svg;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const getVal = (keys, fallback) => {
    const i = args.findIndex(a => keys.includes(a));
    if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
    const kv = args.find(a => keys.some(k => a.startsWith(k + '=')));
    if (kv) return kv.split('=')[1];
    return fallback;
  };
  const prompt = getVal(['--prompt', '-p'], 'A dreamy futuristic city in the clouds, neon, cinematic');
  const size = getVal(['--size', '-s'], '1024x1024');
  const name = getVal(['--name', '-n'], `sample-${nowStamp()}`);
  return { prompt, size, name };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function saveBuffer(filePath, dataBuffer) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, dataBuffer);
}

function parseSize(size) {
  const m = /^(\d+)x(\d+)$/.exec(size);
  if (!m) return { width: 512, height: 512 };
  return { width: Math.max(64, parseInt(m[1], 10)), height: Math.max(64, parseInt(m[2], 10)) };
}

async function generateViaOpenAI(prompt, size) {
  if (!openaiApiKey) return null;
  const client = new OpenAI({ apiKey: openaiApiKey });
  const response = await client.images.generate({ model: 'gpt-image-1', prompt, size, n: 1 });
  const item = response?.data?.[0];
  if (!item) return null;
  if (item.b64_json) {
    return Buffer.from(item.b64_json, 'base64');
  }
  if (item.url) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`Failed to fetch image url: ${res.status}`);
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }
  return null;
}

async function main() {
  const { prompt, size, name } = parseArgs();
  await ensureDir(assetsDir);
  try {
    let fileExt = 'png';
    let buffer = null;
    if (openaiApiKey) {
      try {
        buffer = await generateViaOpenAI(prompt, size);
      } catch (openaiError) {
        // Swallow provider error and fallback to SVG
        buffer = null;
      }
    }
    if (buffer) {
      const outPath = path.join(assetsDir, `${name}.${fileExt}`);
      await saveBuffer(outPath, buffer);
      console.log(JSON.stringify({ status: 'ok', provider: 'openai', path: outPath }));
      return;
    }
    // Fallback to SVG placeholder on error or no provider
    const { width, height } = parseSize(size);
    const svg = svgPlaceholder(prompt, width, height);
    const outPath = path.join(assetsDir, `${name}.svg`);
    await fs.writeFile(outPath, svg, 'utf8');
    console.log(JSON.stringify({ status: 'ok', provider: 'fallback', path: outPath }));
  } catch (err) {
    // As a last resort, still try to emit a fallback SVG
    try {
      const { prompt, size, name } = parseArgs();
      const { width, height } = parseSize(size);
      const svg = svgPlaceholder(prompt, width, height);
      const outPath = path.join(assetsDir, `${name}.svg`);
      await fs.writeFile(outPath, svg, 'utf8');
      console.log(JSON.stringify({ status: 'ok', provider: 'fallback', path: outPath }));
    } catch (nestedErr) {
      console.error(JSON.stringify({ status: 'error', message: nestedErr?.message || String(nestedErr) }));
      process.exit(1);
    }
  }
}

main();
