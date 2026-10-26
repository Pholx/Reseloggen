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
let isSaving = false;
let isDownloading = false;

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

// ---------- GPS ----------
function updateLocation() {
  el.mapOverlay.classList.remove('hidden');
  el.coord.innerText = 'Söker...';

  if (!('geolocation' in navigator)) {
    el.mapOverlay.classList.add('hidden');
    ui.showToast('GPS stöds inte. Lång-tryck på kartan för att logga plats.', 'error');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      currentLat = pos.coords.latitude;
      currentLon = pos.coords.longitude;
      el.coord.innerText = `${currentLat.toFixed(5)}, ${currentLon.toFixed(5)}`;
      mapHandle.setUser(currentLat, currentLon);
      el.mapOverlay.classList.add('hidden');
      fetchAndRenderNearby();
    },
    err => {
      console.warn(err);
      el.mapOverlay.classList.add('hidden');
      el.coord.innerText = 'GPS ej tillgänglig';
      ui.showToast('Ingen GPS. Lång-tryck på kartan för att logga en plats.', 'error');
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
      if (p) p.innerText = 'Inga kända platser inom 150 m. Logga positionen ändå.';
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
  if (!logs.length) {
    el.dateFilter.classList.add('hidden');
    el.dateFilter.classList.remove('flex');
    return;
  }
  el.dateFilter.classList.remove('hidden');
  el.dateFilter.classList.add('flex');

  const makePill = (label, dateValue, count) => {
    const b = document.createElement('button');
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
      mapHandle.renderSaved(logs, activeDate);
    });
    return b;
  };

  el.dateFilter.appendChild(makePill('Alla', null, logs.length));
  for (const [date, count] of storage.uniqueDates(logs)) {
    const [, mm, dd] = date.split('-');
    el.dateFilter.appendChild(makePill(`${dd}/${mm}`, date, count));
  }
}

// ---------- Save / Edit modal ----------
function openSaveModal({ name = '', type = 'Egen plats', lat, lon, existing = null }) {
  editingId = existing ? existing.id : null;
  pendingLatLng = { lat, lon };
  pendingType = existing ? existing.type : type;

  $('save-title').innerText = existing ? 'Redigera plats' : 'Logga plats';
  $('input-name').value = existing ? existing.name : name;
  $('input-notes').value = existing ? (existing.notes || '') : '';
  $('btn-save-confirm').innerText = existing ? 'Spara ändringar' : 'Spara plats';
  $('save-coords').innerText = `${lat.toFixed(5)}, ${lon.toFixed(5)} · ${pendingType}`;

  const baseDate = existing ? new Date(existing.timestamp) : new Date();
  const yyyy = baseDate.getFullYear();
  const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
  const dd = String(baseDate.getDate()).padStart(2, '0');
  const hh = String(baseDate.getHours()).padStart(2, '0');
  const min = String(baseDate.getMinutes()).padStart(2, '0');
  $('input-date').value = `${yyyy}-${mm}-${dd}`;
  $('input-time').value = `${hh}:${min}`;

  $('save-modal').classList.remove('hidden');
  $('input-name').focus();
}

function closeSaveModal() {
  el.saveModal.classList.add('hidden');
  editingId = null;
  pendingLatLng = null;
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
  
  $('input-name').value = '';
  $('input-notes').value = '';
  $('input-date').value = '';
  $('input-time').value = '';
}

async function saveCurrent() {
  if (isSaving || !pendingLatLng) return;
  isSaving = true;

  const name = $('input-name').value.trim() || 'Namnlös plats';
  const notes = $('input-notes').value.trim();

  const dateVal = $('input-date').value;
  const timeVal = $('input-time').value;
  let now;
  if (dateVal && timeVal) {
    const [y, m, d] = dateVal.split('-').map(Number);
    const [h, min] = timeVal.split(':').map(Number);
    now = new Date(y, m - 1, d, h, min);
  } else {
    now = new Date();
  }

  try {
    if (editingId) {
      await storage.update(editingId, { name, notes });
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
      ui.showToast('Sparad!');
    }
    closeSaveModal();
    await refreshAll();
  } catch (e) {
    console.error(e);
    ui.showToast('Kunde inte spara.', 'error');
  } finally {
    isSaving = false;
  }
}

// ---------- History ----------
async function renderHistory(logs) {
  el.historyList.innerHTML = '';
  el.historySummary.innerText = `${logs.length} platser`;

  if (!logs.length) {
    el.historyEmpty.classList.remove('hidden');
    return;
  }
  el.historyEmpty.classList.add('hidden');

  let currentDate = '';
  for (const item of logs) {
    if (item.dateString !== currentDate) {
      currentDate = item.dateString;
      const [, mm, dd] = currentDate.split('-');
      const header = document.createElement('div');
      header.className = 'flex justify-between items-center mt-5 mb-2 pl-2';
      header.innerHTML = `
        <h3 class="text-[11px] font-bold text-gray-500 uppercase tracking-widest">${dd}/${mm}</h3>
        <button class="text-[10px] font-bold text-blue-400 hover:text-blue-300 uppercase tracking-wider focus-on-map">
          Visa på karta →
        </button>`;
      header.querySelector('.focus-on-map').addEventListener('click', () => {
        switchTab('map');
        activeDate = currentDate;
        renderDateFilter(logs);
        requestAnimationFrame(() => {
          mapHandle.renderSaved(logs, activeDate);
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
            <button data-role="copy-name" class="text-[10px] text-gray-400 hover:text-blue-400 bg-gray-900 border border-gray-700 px-2 py-0.5 rounded font-mono">
              📋 ${pattern}
            </button>
          </div>
          ${notesHtml}
        </div>
        <div class="flex flex-col gap-1 shrink-0">
          <button data-role="nav" class="text-gray-400 hover:text-emerald-400 bg-gray-900 p-2 rounded-lg border border-gray-700 active:scale-90" title="Navigera">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
          </button>
          <button data-role="del" class="text-gray-500 hover:text-red-500 bg-gray-900 p-2 rounded-lg border border-gray-700 active:scale-90" title="Radera">
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
      $('confirm-text').innerText = `Radera "${item.name}" från loggen?`;
      el.confirmModal.classList.remove('hidden');
    });

    el.historyList.appendChild(div);
  }
}

// ---------- Delete place ----------
$('btn-cancel-modal').addEventListener('click', () => {
  el.confirmModal.classList.add('hidden');
  itemToDelete = null;
});
$('btn-confirm-modal').addEventListener('click', async () => {
  if (!itemToDelete) return;
  await storage.remove(itemToDelete);
  el.confirmModal.classList.add('hidden');
  itemToDelete = null;
  await refreshAll();
  ui.showToast('Borttagen.');
});

// ---------- Export ----------
$('btn-export-geojson').addEventListener('click', async () => {
  const logs = await storage.getAll();
  if (!logs.length) { ui.showToast('Loggen är tom.', 'error'); return; }
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
  a.download = `Reselogg_${new Date().toLocaleDateString('sv-SE')}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
  ui.showToast('GeoJSON nedladdad!');
});

// ---------- Kartcache ----------
function lon2tile(lon, z) {
  return Math.floor((lon + 180) / 360 * Math.pow(2, z));
}

function lat2tile(lat, z) {
  const rad = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z));
}

async function updateCacheInfo() {
  const info = document.getElementById('cache-info');
  if (!info) return;
  
  if (!('caches' in window)) {
    info.innerText = 'Cache API stöds ej';
    return;
  }
  
  try {
    const cache = await caches.open('tiles-v1');
    const keys = await cache.keys();
    const count = keys.length;
    const estMB = (count * 12 / 1024).toFixed(1);
    info.innerText = `${count} rutor · ca ${estMB} MB`;
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
    const cache = await caches.open('tiles-v1');
    const keys = await cache.keys();
    const count = keys.length;
    
    if (count === 0) {
      ui.showToast('Ingen cache att rensa', 'error');
      return;
    }
    
    const estMB = (count * 12 / 1024).toFixed(1);
    $('cache-confirm-text').innerText = 
      `Rensa ${count} cachade rutor (ca ${estMB} MB)?\n\nKartan måste laddas ner igen för offline-bruk.`;
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
    await caches.delete('tiles-v1');
    await updateCacheInfo();
    ui.showToast('Kartcache rensad!');
  } catch (e) {
    ui.showToast('Kunde inte rensa.', 'error');
  }
  el.cacheConfirmModal.classList.add('hidden');
});

async function downloadVisibleArea() {
  if (isDownloading) return;

  const MAX_TILES = 400;
  
  if (!mapHandle) {
    ui.showToast('Kartan är inte redo än', 'error');
    return;
  }
  
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
    ui.showToast('Vänta någon sekund – appen förbereds.', 'error');
    return;
  }
  
  const map = mapHandle.map;
  const bounds = map.getBounds();
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const currentZoom = Math.round(map.getZoom());
  
  const minZ = Math.max(14, currentZoom - 2);
  const maxZ = Math.min(17, currentZoom + 2);
  
  // Användaren har zoomat ut för långt – be dem zooma in
  if (minZ > maxZ) {
    ui.showToast('Zooma in till stadsdelsnivå (zoom 14+) innan du laddar ner.', 'error');
    return;
  }
  
  const tiles = [];
  for (let z = minZ; z <= maxZ; z++) {
    const x1 = lon2tile(sw.lng, z);
    const x2 = lon2tile(ne.lng, z);
    const y1 = lat2tile(ne.lat, z);
    const y2 = lat2tile(sw.lat, z);
    
    for (let x = x1; x <= x2; x++) {
      for (let y = y1; y <= y2; y++) {
        tiles.push({ z, x, y });
        if (tiles.length > MAX_TILES) {
          ui.showToast(`Området är för stort (över ${MAX_TILES} rutor). Zooma in lite mer och försök igen.`, 'error');
          return;
        }
      }
    }
  }
  
  if (tiles.length === 0) {
    ui.showToast('Inget att ladda ner – zooma in på ett område först.', 'error');
    return;
  }

  // Allt validerat – lås knappen och starta nedladdning
  isDownloading = true;
  const btn = document.getElementById('btn-download-area');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('opacity-50', 'cursor-not-allowed');
  btn.innerHTML = '⏳ Laddar...';
  
  const progress = document.getElementById('download-progress');
  const bar = document.getElementById('download-bar');
  const text = document.getElementById('download-text');
  progress.classList.remove('hidden');
  bar.style.width = '0%';
  text.innerText = `Zoom ${minZ}–${maxZ} · förbereder ${tiles.length} rutor...`;
  
  const retina = (window.L && L.Browser.retina) ? '@2x' : '';
  const BATCH = 8;
  let done = 0;
  let failed = 0;
  
  try {
    for (let i = 0; i < tiles.length; i += BATCH) {
      const batch = tiles.slice(i, i + BATCH);
      await Promise.all(batch.map(async t => {
        const sub = 'abcd'[Math.abs(t.x + t.y) % 4];
        const url = `https://${sub}.basemaps.cartocdn.com/dark_all/${t.z}/${t.x}/${t.y}${retina}.png`;
        try {
          await fetch(url);
        } catch {
          failed++;
        }
      }));
      done += batch.length;
      const pct = Math.round(done / tiles.length * 100);
      bar.style.width = pct + '%';
      text.innerText = `Zoom ${minZ}–${maxZ} · ${done}/${tiles.length}`;
    }
    
    text.innerText = failed > 0 
      ? `Klart! ${done - failed} rutor (zoom ${minZ}–${maxZ}), ${failed} misslyckades.`
      : `Klart! ${tiles.length} rutor nedladdade (zoom ${minZ}–${maxZ}).`;
    
    await updateCacheInfo();
    
    setTimeout(() => {
      progress.classList.add('hidden');
      bar.style.width = '0%';
    }, 3000);
  } catch (e) {
    console.error(e);
    text.innerText = 'Nedladdningen avbröts.';
  } finally {
    isDownloading = false;
    btn.disabled = false;
    btn.classList.remove('opacity-50', 'cursor-not-allowed');
    btn.innerHTML = originalText;
  }
}

$('btn-download-area').addEventListener('click', downloadVisibleArea);
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
}
$('nav-log').addEventListener('click', () => switchTab('map'));
$('nav-history').addEventListener('click', () => {
  switchTab('history');
  updateCacheInfo();
});

// ---------- Refresh everything ----------
async function refreshAll() {
  const logs = await storage.getAll();

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
    ui.showToast('Ingen position. Lång-tryck på kartan för att logga manuellt.', 'error');
    return;
  }
  openSaveModal({ name: '', type: 'Egen plats', lat: currentLat, lon: currentLon });
});
$('btn-close-save').addEventListener('click', closeSaveModal);
$('btn-save-confirm').addEventListener('click', saveCurrent);
$('btn-save-coords').addEventListener('click', () => {
  if (currentLat == null) {
    ui.showToast('Ingen position. Lång-tryck på kartan istället.', 'error');
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

  mapHandle.onLongPress((lat, lon) => {
    openSaveModal({ name: '', type: 'Egen plats', lat, lon });
  });

  await refreshAll();
  await updateCacheInfo();
  updateLocation();
});