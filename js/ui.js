export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  const colors = type === 'success'
    ? 'bg-emerald-600 text-white border-emerald-500'
    : 'bg-red-600 text-white border-red-500';
  t.className = `${colors} border shadow-2xl px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 opacity-0 -translate-y-3 pointer-events-auto`;
  t.innerText = message;
  container.appendChild(t);
  requestAnimationFrame(() => t.classList.remove('opacity-0', '-translate-y-3'));
  setTimeout(() => {
    t.classList.add('opacity-0', '-translate-y-3');
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
    return ok;
  }
}

export function getEmoji(type) {
  return ({
    'Mat & Dryck': '🍽️',
    'Sevärdhet': '📸',
    'Historiskt': '🏺',
    'Fritid/Natur': '🌳',
    'Bekvämlighet': '☕'
  })[type] || '📍';
}

// Bygg filnamnsmönster EN gång, vid sparning, och spara det på loggen.
// Detta gör mönstret immunt mot tidszonsbyten (Chiang Mai → Göteborg).
export function buildFilenamePattern(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function videoFilenamePattern(log) {
  // Föredra sparat mönster (immunt mot tidszon)
  if (log.filenamePattern) return log.filenamePattern;

  // Fallback för äldre loggar som saknar fältet
  const d = log.timestamp ? new Date(log.timestamp) : new Date();
  if (isNaN(d.getTime())) return 'okänt';
  return buildFilenamePattern(d);
}