import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

// --- State ---
let currentDiagramId = null;
let currentSvg = null;
let debounceTimer = null;
let renderCounter = 0;

// --- DOM refs ---
const editor = document.getElementById('editor');
const titleInput = document.getElementById('title-input');
const preview = document.getElementById('preview');
const errorPanel = document.getElementById('error-panel');
const errorMessage = document.getElementById('error-message');
const statusText = document.getElementById('status-text');
const autoSaveIndicator = document.getElementById('auto-save-indicator');
const historyList = document.getElementById('history-list');

// --- Buttons ---
document.getElementById('render-btn').addEventListener('click', () => renderDiagram());
document.getElementById('save-btn').addEventListener('click', () => saveDiagram());
document.getElementById('download-svg-btn').addEventListener('click', downloadSvg);
document.getElementById('download-png-btn').addEventListener('click', downloadPng);
document.getElementById('delete-btn').addEventListener('click', deleteDiagram);
document.getElementById('new-btn').addEventListener('click', newDiagram);

// --- Init mermaid ---
mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'default',
    htmlLabels: false,
});

// --- Editor: debounced auto-render ---
editor.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        renderDiagram();
    }, 600);
});

// Tab key support in textarea
editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 4;
    }
});

// --- Render ---
async function renderDiagram() {
    const code = editor.value.trim();
    if (!code) {
        preview.innerHTML = '';
        hideError();
        setStatus('Ready');
        return;
    }

    setStatus('Rendering...');

    try {
        // Validate first
        await mermaid.parse(code);
        hideError();

        // Render — unique ID each time to avoid collisions
        renderCounter++;
        const id = `mermaid-preview-${renderCounter}`;
        const { svg } = await mermaid.render(id, code);
        preview.innerHTML = svg;
        currentSvg = svg;

        setStatus('Rendered');

        // Auto-save after successful render
        await autoSave(code, svg);
    } catch (err) {
        showError(err);
        setStatus('Error');
    }
}

// --- Error handling ---
function showError(err) {
    const msg = err.message || err.str || String(err);
    // Clean up mermaid's verbose error formatting
    const cleaned = msg
        .replace(/Syntax error in text[\s\S]*?mermaid version[\s\S]*$/m, '')
        .replace(/Parse error on line \d+:/, (m) => m)
        .trim();
    errorMessage.textContent = cleaned || msg;
    errorPanel.classList.remove('hidden');
}

function hideError() {
    errorPanel.classList.add('hidden');
    errorMessage.textContent = '';
}

// --- Auto-save ---
async function autoSave(source, svg) {
    const title = titleInput.value.trim() || generateTitle(source);
    let pngBase64 = null;

    try {
        pngBase64 = await svgToPngBase64(svg);
    } catch (e) {
        // PNG conversion failed — save without it
        console.warn('PNG conversion failed:', e);
    }

    const payload = { title, source, svg, png_base64: pngBase64 || null };

    try {
        if (currentDiagramId) {
            // Update existing
            await fetch(`/api/diagrams/${currentDiagramId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            autoSaveIndicator.textContent = 'Updated';
        } else {
            // Create new
            const resp = await fetch('/api/diagrams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await resp.json();
            currentDiagramId = data.id;
            autoSaveIndicator.textContent = 'Saved';
        }

        // Refresh history
        await loadHistory();

        // Clear the indicator after 2s
        setTimeout(() => {
            autoSaveIndicator.textContent = '';
        }, 2000);
    } catch (e) {
        console.error('Auto-save failed:', e);
        autoSaveIndicator.textContent = 'Save failed';
    }
}

// --- Manual save (force save even if no change) ---
async function saveDiagram() {
    const code = editor.value.trim();
    if (!code) return;

    if (!currentSvg) {
        await renderDiagram();
    }

    if (currentSvg) {
        await autoSave(code, currentSvg);
    }
}

// --- Generate title from source ---
function generateTitle(source) {
    const firstLine = source.split('\n')[0].trim();
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    return `${firstLine} — ${dateStr}`;
}

// --- SVG to PNG ---
// Uses data URI instead of blob URL to avoid tainted canvas from foreignObject
function svgToPngBase64(svgString) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        // Encode SVG as data URI to avoid cross-origin tainting
        const svgData = encodeURIComponent(svgString);
        const dataUrl = `data:image/svg+xml;charset=utf-8,${svgData}`;

        img.onload = () => {
            try {
                const scale = 2; // retina
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth * scale;
                canvas.height = img.naturalHeight * scale;
                const ctx = canvas.getContext('2d');
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0);

                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Canvas toBlob failed'));
                        return;
                    }
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const base64 = reader.result.split(',')[1];
                        resolve(base64);
                    };
                    reader.readAsDataURL(blob);
                }, 'image/png');
            } catch (e) {
                // If canvas is still tainted somehow, resolve with null
                console.warn('PNG conversion failed (tainted canvas):', e);
                resolve(null);
            }
        };

        img.onerror = () => {
            reject(new Error('Failed to load SVG as image'));
        };

        img.src = dataUrl;
    });
}

// --- Download SVG ---
function downloadSvg() {
    if (!currentSvg) return;
    const title = titleInput.value.trim() || 'diagram';
    const blob = new Blob([currentSvg], { type: 'image/svg+xml' });
    triggerDownload(blob, `${sanitizeFilename(title)}.svg`);
}

// --- Download PNG ---
async function downloadPng() {
    if (!currentSvg) return;
    const title = titleInput.value.trim() || 'diagram';
    try {
        const base64 = await svgToPngBase64(currentSvg);
        const byteString = atob(base64);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: 'image/png' });
        triggerDownload(blob, `${sanitizeFilename(title)}.png`);
    } catch (e) {
        console.error('PNG download failed:', e);
    }
}

function triggerDownload(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9_\-. ]/g, '_').substring(0, 100);
}

// --- Delete ---
async function deleteDiagram() {
    if (!currentDiagramId) return;
    if (!confirm('Delete this diagram?')) return;

    try {
        await fetch(`/api/diagrams/${currentDiagramId}`, { method: 'DELETE' });
        newDiagram();
        await loadHistory();
    } catch (e) {
        console.error('Delete failed:', e);
    }
}

// --- New diagram ---
function newDiagram() {
    currentDiagramId = null;
    currentSvg = null;
    editor.value = '';
    titleInput.value = '';
    preview.innerHTML = '';
    hideError();
    setStatus('Ready');

    // Deselect history item
    document.querySelectorAll('.history-item.active').forEach(el => el.classList.remove('active'));
}

// --- Load history ---
async function loadHistory() {
    try {
        const resp = await fetch('/api/diagrams?limit=100');
        const diagrams = await resp.json();

        historyList.innerHTML = '';
        for (const d of diagrams) {
            const item = document.createElement('div');
            item.className = 'history-item';
            if (d.id === currentDiagramId) {
                item.classList.add('active');
            }

            const date = new Date(d.updated_at);
            const dateStr = date.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
            });

            item.innerHTML = `
                <div class="history-title">${escapeHtml(d.title)}</div>
                <div class="history-date">${dateStr}</div>
            `;

            item.addEventListener('click', () => loadDiagram(d.id));
            historyList.appendChild(item);
        }
    } catch (e) {
        console.error('Failed to load history:', e);
    }
}

// --- Load a diagram from history ---
async function loadDiagram(id) {
    try {
        const resp = await fetch(`/api/diagrams/${id}`);
        if (!resp.ok) return;
        const d = await resp.json();

        currentDiagramId = d.id;
        editor.value = d.source;
        titleInput.value = d.title;

        // Re-render
        await renderDiagram();

        // Highlight active in sidebar
        document.querySelectorAll('.history-item.active').forEach(el => el.classList.remove('active'));
        const items = document.querySelectorAll('.history-item');
        for (const item of items) {
            if (item.querySelector('.history-title')?.textContent === d.title) {
                item.classList.add('active');
                break;
            }
        }
    } catch (e) {
        console.error('Failed to load diagram:', e);
    }
}

// --- Status ---
function setStatus(text) {
    statusText.textContent = text;
}

// --- Escape HTML ---
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Init: load history on page load ---
loadHistory();
