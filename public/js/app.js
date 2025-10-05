const form = document.getElementById('prompt-form');
const input = document.getElementById('prompt-input');
const sizeSelect = document.getElementById('size-select');
const countSelect = document.getElementById('count-select');
const statusEl = document.getElementById('status');
const gallery = document.getElementById('gallery');

function showStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.hidden = false;
  statusEl.dataset.type = type;
}

function hideStatus() {
  statusEl.hidden = true;
  statusEl.textContent = '';
}

function cardTemplate(src, provider) {
  return `
  <article class="card">
    <img class="thumb" src="${src}" alt="Generated image" />
    <div class="meta">
      <span>${provider}</span>
      <button onclick="navigator.clipboard.writeText('${src}')">Copy URL</button>
    </div>
  </article>`;
}

async function generate(e) {
  e.preventDefault();
  const prompt = input.value.trim();
  if (!prompt) {
    input.focus();
    return;
  }
  const size = sizeSelect.value;
  const n = Number(countSelect.value);

  showStatus('Generating images…');

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, size, n }),
    });
    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }
    const data = await res.json();
    const { images = [], provider = 'fallback' } = data;
    if (images.length === 0) {
      showStatus('No images returned. Try another prompt.', 'warn');
      return;
    }
    gallery.innerHTML = images.map(src => cardTemplate(src, provider)).join('');
    hideStatus();
  } catch (err) {
    console.error(err);
    showStatus('Something went wrong. Using fallback may help.', 'error');
  }
}

form.addEventListener('submit', generate);

// Demo prompt for quick start
if (!input.value) {
  input.value = 'A watercolor painting of a fox in a flower field';
}
