import * as storage from './storage.js';
import * as ui from './ui.js';
import { fetchNearby } from './nearby.js';
import { createMap } from './map.js';

// ---------- State ----------
let mapHandle = null;
let currentLat = null, currentLon = null;
let activeDate = null;
let editingId = null;
let pendingLatLng = null;
let pendingType = 'Egen plats';
let itemToDelete = null;
let confirmMode = null; // 'delete-one' | 'delete-all'
let isSaving = false;
let modalOpenTime = null; // används för sekund-fallback om webbläsaren inte ger sekunder

// ---------- Elements ----------
const $ = id => document.getElementById(id);
const el = {
  mapOverlay: $('map-overlay'),
  coord: $('coord-display'),
  dateFilter: $('date-filter'),
  placesLoading: $('places-loading'),
  placesList: $('places-list'),
  placesEmpty: $('places-empty'),
  placesCount: $('places-count'),
  historyList: $('history-list'),
  historyEmpty: $('history-empty'),
  historySummary: $('history-summary'),
  saveModal: $('save-modal'),
  confirmModal: $('confirm-modal'),
  cacheConfirmModal: $('cache-confirm-modal')
};

// ---------- Utilities ----------
const uid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

// ---------- Online/Offline ----------
function updateOnlineStatus() {
  const dot = $('status-dot');
  const label = $('status-label');
  if (!dot || !label) return;
  if (navigator.onLine) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    label.textContent = 'Online';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-orange-500';
    label.textContent = 'Offline';
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW reg fail', e));
}

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  $('btn-install').classList.remove('hidden');
});
$('btn-install')?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('btn-install').classList.add('hidden');
});

// ---------- Category selector ----------
function setActiveCategory(type) {
  pendingType = type;
  document.querySelectorAll('#category-selector .cat-btn').forEach(btn => {
    if (btn.dataset.type === type) {
      btn.className = 'cat-btn py-2 px-1 rounded-lg border text-xs font-semibold transition-colors bg-blue-600 text-white border-blue-500';
    } else {
      btn.className = 'cat-btn py-2 px-1 rounded-lg border text-xs font-semibold transition-colors bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700';
    }
  });
}

document.querySelectorAll('#category-selector .cat-btn').forEach(btn => {
  btn.addEventListener('click', () => setActiveCategory(btn.dataset.type));
});

// ---------- GPS ----------
// Overlayn styrs av kartans "idle"-event (i boot). GPS-flödet nedan rör
// aldrig overlayn, så kartan blir användbar direkt medan GPS söker.
function updateLocation() {
  if (!mapHandle) {
    ui.showToast('Kartan laddas fortfarande, vänta en sekund.', 'error');
    return;
  }

  el.coord.innerText = 'Söker...';

  if (!('geolocation' in navigator)) {
    el.coord.innerText = 'GPS stöds ej';
    ui.showToast('GPS stöds inte i denna webbläsare.', 'error');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      currentLat = pos.coords.latitude;
      currentLon = pos.coords.longitude;
      el.coord.innerText = `${currentLat.toFixed(5)}, ${currentLon.toFixed(5)}`;

      mapHandle.setUser(currentLat, currentLon);

      fetchAndRenderNearby();
    },
    err => {
      console.warn(err);
      el.coord.innerText = 'GPS ej tillgänglig';
      ui.showToast('Ingen GPS. Tryck på uppdatera för att försöka igen.', 'error');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

async function fetchAndRenderNearby() {
  if (currentLat == null) return;

  el.placesList.innerHTML = '';
  el.placesEmpty.classList.add('hidden');
  el.placesLoading.classList.remove('hidden');
  el.placesCount.innerText = 'Söker...';

  try {
    const places = await fetchNearby(currentLat, currentLon);
    el.placesLoading.classList.add('hidden');

    if (!places.length) {
      el.placesCount.innerText = '0 funna';
      const p = el.placesEmpty.querySelector('p');
      if (p) p.innerText = 'Inga kända platser inom 250 m. Logga positionen ändå.';
      el.placesEmpty.classList.remove('hidden');
      return;
    }

    el.placesCount.innerText = `${places.length} nära`;
    for (const p of places) {
      const div = document.createElement('div');
      div.className = 'bg-gray-800 border border-gray-700 rounded-xl p-3 flex justify-between items-center active:scale-[0.98] transition-all cursor-pointer';
      div.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <div class="text-xl bg-gray-900 p-1.5 rounded-lg shrink-0">${ui.getEmoji(p.type)}</div>
          <div class="min-w-0">
            <h3 class="text-gray-100 font-bold text-sm leading-tight truncate">${ui.escapeHtml(p.name)}</h3>
            <p class="text-[10px] text-gray-400 uppercase tracking-wide">${p.type}</p>
          </div>
        </div>
        <div class="bg-blue-600 text-white w-9 h-9 flex items-center justify-center rounded-full shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
        </div>`;
      div.addEventListener('click', () => openSaveModal({
        name: p.name, type: p.type, lat: p.lat, lon: p.lon
      }));
      el.placesList.appendChild(div);
    }
  } catch (err) {
    if (err.name === 'AbortError') return;

    console.error('Overpass:', err);
    el.placesLoading.classList.add('hidden');
    el.placesEmpty.classList.remove('hidden');

    const p = el.placesEmpty.querySelector('p');
    if (err.message === 'Timeout') {
      el.placesCount.innerText = 'Timeout';
      if (p) p.innerText = 'Overpass svarade inte i tid. Logga positionen ändå.';
    } else {
      el.placesCount.innerText = 'Nätfel';
      if (p) p.innerText = 'Kunde inte hämta platser (nätverk). Logga positionen ändå.';
    }
  }
}

// ---------- Date filter ----------
function renderDateFilter(logs) {
  el.dateFilter.innerHTML = '';
  const uniqueDates = storage.uniqueDates(logs);

  if (logs.length === 0 || uniqueDates.length <= 1) {
    activeDate = null;
    el.dateFilter.classList.add('hidden');
    el.dateFilter.classList.remove('flex');
    return;
  }
  el.dateFilter.classList.remove('hidden');
  el.dateFilter.classList.add('flex');

  const years = new Set(logs.map(l => l.dateString.slice(0, 4)));
  const multiYear = years.size > 1;

  const makePill = (label, dateValue, count) => {
    const b = document.createElement('button');
    b.type = 'button';
    const selected = activeDate === dateValue;
    b.className = `px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap border transition-colors ${
      selected
        ? 'bg-blue-600 text-white border-blue-500'
        : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'
    }`;
    b.innerHTML = `${label}${count != null ? ` <span class="opacity-60">(${count})</span>` : ''}`;
    b.addEventListener('click', () => {
      activeDate = dateValue;
      renderDateFilter(logs);
      mapHandle.renderSaved(logs, activeDate, true);
      renderHistory(logs);
    });
    return b;
  };

  el.dateFilter.appendChild(makePill('Alla', null, logs.length));
  for (const [date, count] of uniqueDates) {
    const [, mm, dd] = date.split('-');
    const yy = date.slice(2, 4);
    const label = multiYear ? `${dd}/${mm}/${yy}` : `${dd}/${mm}`;
    el.dateFilter.appendChild(makePill(label, date, count));
  }
}

// ---------- Save / Edit modal ----------
function openSaveModal({ name = '', type = 'Egen plats', lat, lon, existing = null }) {
  if (isSaving) return;

  editingId = existing ? existing.id : null;
  const targetLat = existing ? existing.lat : lat;
  const targetLon = existing ? existing.lon : lon;
  pendingLatLng = { lat: targetLat, lon: targetLon };
  pendingType = existing ? existing.type : type;

  // Spara exakt tidpunkt när modalen öppnas – används som sekund-fallback
  modalOpenTime = existing ? new Date(existing.timestamp) : new Date();

  $('save-title').innerText = existing ? 'Redigera plats' : 'Logga plats';
  $('input-name').value = existing ? existing.name : name;
  $('input-notes').value = existing ? (existing.notes || '') : '';
  $('btn-save-confirm').innerText = existing ? 'Spara ändringar' : 'Spara plats';
  $('save-coords').innerText = `${targetLat.toFixed(5)}, ${targetLon.toFixed(5)}`;

  setActiveCategory(pendingType);

  const baseDate = modalOpenTime;
  const yyyy = baseDate.getFullYear();
  const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
  const dd = String(baseDate.getDate()).padStart(2, '0');
  const hh = String(baseDate.getHours()).padStart(2, '0');
  const min = String(baseDate.getMinutes()).padStart(2, '0');
  const sec = String(baseDate.getSeconds()).padStart(2, '0');
  $('input-date').value = `${yyyy}-${mm}-${dd}`;
  $('input-time').value = `${hh}:${min}:${sec}`;

  $('input-date').disabled = !!existing;
  $('input-time').disabled = !!existing;

  $('save-modal').classList.remove('hidden');
  $('input-name').focus();
}

function closeSaveModal() {
  el.saveModal.classList.add('hidden');
  editingId = null;
  pendingLatLng = null;
  modalOpenTime = null;
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }

  $('input-name').value = '';
  $('input-notes').value = '';
  $('input-date').value = '';
  $('input-time').value = '';
  $('input-date').disabled = false;
  $('input-time').disabled = false;
}

async function saveCurrent() {
  if (isSaving || !pendingLatLng) return;
  isSaving = true;

  const btn = $('btn-save-confirm');
  const originalText = btn.innerText;
  btn.innerText = 'Sparar...';
  btn.disabled = true;

  const name = $('input-name').value.trim() || 'Namnlös plats';
  const notes = $('input-notes').value.trim();

  const dateVal = $('input-date').value;
  const timeVal = $('input-time').value;
  let now;
  if (dateVal && timeVal) {
    const [y, m, d] = dateVal.split('-').map(Number);
    const [h, min, sec = 0] = timeVal.split(':').map(Number);
    now = new Date(y, m - 1, d, h, min, sec);

    // Fallback: vissa webbläsare (Safari iOS, en del WebViews) ger bara HH:MM
    // trots step="1". Om användaren inte ändrat minut/timme jämfört med
    // modalens öppningstid, använd då modaltidens sekunder så filnamns-
    // mönstret matchar DJI-kameran.
    if (sec === 0 && modalOpenTime) {
      const sameMinute =
        now.getFullYear() === modalOpenTime.getFullYear() &&
        now.getMonth() === modalOpenTime.getMonth() &&
        now.getDate() === modalOpenTime.getDate() &&
        now.getHours() === modalOpenTime.getHours() &&
        now.getMinutes() === modalOpenTime.getMinutes();
      if (sameMinute) {
        now.setSeconds(modalOpenTime.getSeconds());
      }
    }
  } else {
    now = new Date();
  }

  try {
    if (editingId) {
      await storage.update(editingId, { name, notes, type: pendingType });
      ui.showToast('Uppdaterad!');
    } else {
      await storage.add({
        id: uid(),
        name,
        notes,
        type: pendingType,
        lat: pendingLatLng.lat,
        lon: pendingLatLng.lon,
        timestamp: now.toISOString(),
        dateString: now.toLocaleDateString('sv-SE'),
        timeString: now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' }),
        filenamePattern: ui.buildFilenamePattern(now)
      });

      // Om användaren filtrerar på en annan dag – nolla filtret så nya platsen syns
      const savedDate = now.toLocaleDateString('sv-SE');
      if (activeDate && activeDate !== savedDate) {
        activeDate = null;
      }

      ui.showToast('Sparad!');
    }
    closeSaveModal();
    await refreshAll();
  } catch (e) {
    console.error(e);
    ui.showToast('Kunde inte spara.', 'error');
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
    isSaving = false;
  }
}

// ---------- History ----------
async function renderHistory(logs) {
  const visible = activeDate ? logs.filter(l => l.dateString === activeDate) : logs;

  el.historyList.innerHTML = '';

  if (activeDate) {
    const [, mm, dd] = activeDate.split('-');
    el.historySummary.innerText = `${dd}/${mm} · ${visible.length} platser`;
  } else {
    el.historySummary.innerText = `${visible.length} platser`;
  }

  if (!visible.length) {
    el.historyEmpty.classList.remove('hidden');
    return;
  }
  el.historyEmpty.classList.add('hidden');

  const years = new Set(visible.map(l => l.dateString.slice(0, 4)));
  const multiYear = years.size > 1;

  let currentDate = '';
  for (const item of visible) {
    if (item.dateString !== currentDate) {
      currentDate = item.dateString;
      const thisDate = item.dateString;
      const [, mm, dd] = thisDate.split('-');
      const yy = thisDate.slice(2, 4);
      const dateLabel = multiYear ? `${dd}/${mm}/${yy}` : `${dd}/${mm}`;

      const header = document.createElement('div');
      header.className = 'flex justify-between items-center mt-5 mb-2 pl-2';
      header.innerHTML = `
        <h3 class="text-[11px] font-bold text-gray-500 uppercase tracking-widest">${dateLabel}</h3>
        <button type="button" class="text-[10px] font-bold text-blue-400 hover:text-blue-300 uppercase tracking-wider focus-on-map">
          Visa på karta →
        </button>`;
      header.querySelector('.focus-on-map').addEventListener('click', () => {
        switchTab('map');
        activeDate = thisDate;
        renderDateFilter(logs);
        requestAnimationFrame(() => {
          mapHandle.renderSaved(logs, activeDate, true);
        });
      });
      el.historyList.appendChild(header);
    }

    const div = document.createElement('div');
    div.className = 'bg-gray-800 rounded-xl p-4 border border-gray-700';
    const notesHtml = item.notes
      ? `<p class="text-[12px] text-gray-300 mt-1 line-clamp-2">${ui.escapeHtml(item.notes)}</p>`
      : '';
    const pattern = ui.videoFilenamePattern(item);

    div.innerHTML = `
      <div class="flex justify-between items-start gap-3">
        <div class="flex-grow min-w-0" data-role="edit">
          <div class="flex items-baseline gap-2 flex-wrap">
            <span class="text-lg shrink-0">${ui.getEmoji(item.type)}</span>
            <h4 class="text-gray-100 font-bold text-sm truncate">${ui.escapeHtml(item.name)}</h4>
          </div>
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            <span class="text-[10px] text-blue-400 font-mono bg-blue-900/30 px-1.5 py-0.5 rounded">${item.dateString}</span>
            <span class="text-[10px] text-blue-400 font-mono bg-blue-900/30 px-1.5 py-0.5 rounded">${item.timeString}</span>
            <button type="button" data-role="copy-name" class="text-[10px] text-gray-400 hover:text-blue-400 bg-gray-900 border border-gray-700 px-2 py-0.5 rounded font-mono">
              📋 ${pattern}
            </button>
          </div>
          ${notesHtml}
        </div>
        <div class="flex flex-col gap-1 shrink-0">
          <button type="button" data-role="nav" class="text-gray-400 hover:text-emerald-400 bg-gray-900 p-2 rounded-lg border border-gray-700 active:scale-90" title="Navigera">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
          </button>
          <button type="button" data-role="del" class="text-gray-500 hover:text-red-500 bg-gray-900 p-2 rounded-lg border border-gray-700 active:scale-90" title="Radera">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </div>`;

    div.querySelector('[data-role="edit"]').addEventListener('click', () => {
      openSaveModal({ existing: item });
    });
    div.querySelector('[data-role="copy-name"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await ui.copyToClipboard(pattern);
      ui.showToast(ok ? `Kopierat: ${pattern}` : 'Kunde inte kopiera', ok ? 'success' : 'error');
    });
    div.querySelector('[data-role="nav"]').addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lon}`, '_blank');
    });
    div.querySelector('[data-role="del"]').addEventListener('click', (e) => {
      e.stopPropagation();
      itemToDelete = item.id;
      confirmMode = 'delete-one';
      $('confirm-title').innerText = 'Ta bort plats?';
      $('confirm-text').innerText = `Radera "${item.name}" från loggen?`;
      $('btn-confirm-modal').innerText = 'Ta bort';
      el.confirmModal.classList.remove('hidden');
    });

    el.historyList.appendChild(div);
  }
}

// ---------- Delete place / Clear all ----------
$('btn-cancel-modal').addEventListener('click', () => {
  el.confirmModal.classList.add('hidden');
  itemToDelete = null;
  confirmMode = null;
});

$('btn-confirm-modal').addEventListener('click', async () => {
  if (confirmMode === 'delete-one' && itemToDelete) {
    await storage.remove(itemToDelete);
    ui.showToast('Borttagen.');
  } else if (confirmMode === 'delete-all') {
    await storage.setAll([]);
    activeDate = null;
    ui.showToast('Alla platser borttagna.');
  } else {
    return;
  }
  itemToDelete = null;
  confirmMode = null;
  el.confirmModal.classList.add('hidden');
  await refreshAll();
});

$('btn-clear-all').addEventListener('click', async () => {
  const all = await storage.getAll();
  if (!all.length) {
    ui.showToast('Inga platser att rensa.', 'error');
    return;
  }
  confirmMode = 'delete-all';
  itemToDelete = null;
  $('confirm-title').innerText = 'Rensa alla platser?';
  $('confirm-text').innerText = `Radera alla ${all.length} platser permanent? Detta kan inte ångras.`;
  $('btn-confirm-modal').innerText = 'Rensa allt';
  el.confirmModal.classList.remove('hidden');
});

// ---------- Export ----------
$('btn-export-geojson').addEventListener('click', async () => {
  const allLogs = await storage.getAll();
  const logs = activeDate
    ? allLogs.filter(l => l.dateString === activeDate)
    : allLogs;

  if (!logs.length) {
    ui.showToast(activeDate ? 'Inga platser för valt datum.' : 'Loggen är tom.', 'error');
    return;
  }

  const geojson = {
    type: 'FeatureCollection',
    features: logs.map(l => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [l.lon, l.lat] },
      properties: {
        name: l.name, type: l.type, notes: l.notes || '',
        date: l.dateString, time: l.timeString, timestamp: l.timestamp,
        videoPattern: ui.videoFilenamePattern(l)
      }
    }))
  };
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = activeDate
    ? `Reselogg_${activeDate}.geojson`
    : `Reselogg_${new Date().toLocaleDateString('sv-SE')}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
  ui.showToast(activeDate
    ? `GeoJSON för ${activeDate} nedladdad!`
    : 'GeoJSON nedladdad!');
});

// ---------- Kartcache (OpenFreeMap) ----------
async function updateCacheInfo() {
  const info = document.getElementById('cache-info');
  if (!info) return;

  if (!('caches' in window)) {
    info.innerText = 'Cache API stöds ej';
    return;
  }

  try {
    const cache = await caches.open('gl-map-offline');
    const keys = await cache.keys();
    const count = keys.length;
    if (count === 0) {
      info.innerText = '0 filer';
      return;
    }
    const estMB = (count * 25 / 1024).toFixed(1);
    info.innerText = `${count} filer · ca ${estMB} MB`;
  } catch (e) {
    info.innerText = 'Kunde inte läsa';
  }
}

async function clearTileCache() {
  if (!('caches' in window)) {
    ui.showToast('Cache API stöds inte i denna webbläsare', 'error');
    return;
  }

  try {
    const cache = await caches.open('gl-map-offline');
    const keys = await cache.keys();
    const count = keys.length;

    if (count === 0) {
      ui.showToast('Ingen cache att rensa', 'error');
      return;
    }

    const estMB = (count * 25 / 1024).toFixed(1);
    $('cache-confirm-text').innerText =
      `Rensa ${count} cachade kartfiler (ca ${estMB} MB)?\n\nKartan måste laddas ner igen genom att du besöker området online.`;
    el.cacheConfirmModal.classList.remove('hidden');
  } catch (e) {
    ui.showToast('Kunde inte läsa cache-info.', 'error');
  }
}

$('btn-cancel-cache').addEventListener('click', () => {
  el.cacheConfirmModal.classList.add('hidden');
});

$('btn-confirm-cache').addEventListener('click', async () => {
  try {
    await caches.delete('gl-map-offline');
    await updateCacheInfo();
    ui.showToast('Kartcache rensad!');
  } catch (e) {
    ui.showToast('Kunde inte rensa.', 'error');
  }
  el.cacheConfirmModal.classList.add('hidden');
});

$('btn-clear-cache').addEventListener('click', clearTileCache);

// ---------- Tabs ----------
function switchTab(which) {
  const mapTab = $('tab-log');
  const histTab = $('tab-history');
  const navMap = $('nav-log');
  const navHist = $('nav-history');
  const activeMap = which === 'map';

  mapTab.classList.toggle('hidden', !activeMap);
  histTab.classList.toggle('hidden', activeMap);
  navMap.classList.toggle('text-blue-400', activeMap);
  navMap.classList.toggle('text-gray-500', !activeMap);
  navHist.classList.toggle('text-blue-400', !activeMap);
  navHist.classList.toggle('text-gray-500', activeMap);

  // Leaflet/MapLibre behöver veta att containern fick ny storlek
  if (activeMap && mapHandle) {
    setTimeout(() => mapHandle.invalidate(), 50);
  }
}
$('nav-log').addEventListener('click', () => switchTab('map'));
$('nav-history').addEventListener('click', () => {
  switchTab('history');
  updateCacheInfo();
});
$('btn-go-map').addEventListener('click', () => switchTab('map'));

// ---------- Refresh everything ----------
async function refreshAll() {
  const logs = await storage.getAll();
  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (activeDate && !logs.some(l => l.dateString === activeDate)) {
    activeDate = null;
  }

  renderDateFilter(logs);
  mapHandle.renderSaved(logs, activeDate);
  await renderHistory(logs);
}

// ---------- Buttons ----------
$('btn-refresh').addEventListener('click', updateLocation);
$('btn-manual').addEventListener('click', () => {
  if (currentLat == null) {
    ui.showToast('Ingen position ännu. Vänta eller tryck på uppdatera.', 'error');
    return;
  }
  openSaveModal({ name: '', type: 'Egen plats', lat: currentLat, lon: currentLon });
});
$('btn-close-save').addEventListener('click', closeSaveModal);
$('btn-save-confirm').addEventListener('click', saveCurrent);
$('btn-save-coords').addEventListener('click', () => {
  if (currentLat == null) {
    ui.showToast('Ingen position. Tryck på uppdatera-ikonen ↻ först.', 'error');
    return;
  }
  openSaveModal({ name: '', type: 'Egen plats', lat: currentLat, lon: currentLon });
});

// ---------- Stäng modaler vid klick på bakgrunden ----------
$('save-modal').addEventListener('click', (e) => {
  if (e.target.id === 'save-modal') closeSaveModal();
});
$('confirm-modal').addEventListener('click', (e) => {
  if (e.target.id === 'confirm-modal') {
    el.confirmModal.classList.add('hidden');
    itemToDelete = null;
    confirmMode = null;
  }
});
$('cache-confirm-modal').addEventListener('click', (e) => {
  if (e.target.id === 'cache-confirm-modal') {
    el.cacheConfirmModal.classList.add('hidden');
  }
});

// ---------- Boot ----------
window.addEventListener('load', async () => {
  mapHandle = createMap('map');

  // Overlayn styrs av kartan – inte GPS. Kartan blir användbar så snart
  // tiles är laddade, oavsett om GPS svarat. Fallback 3 s om idle aldrig
  // triggar (t.ex. mycket långsamt nät eller offline kallstart).
  mapHandle.once('idle', () => el.mapOverlay.classList.add('hidden'));
  setTimeout(() => el.mapOverlay.classList.add('hidden'), 3000);

  mapHandle.onEdit(async (id) => {
    const item = await storage.findById(id);
    if (item) openSaveModal({ existing: item });
  });

  await refreshAll();
  await updateCacheInfo();
  updateLocation();
});