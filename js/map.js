import { escapeHtml, getEmoji } from './ui.js';

const LAST_POS_KEY = 'reselogg:lastPos';

function readLastPos() {
  try {
    const raw = localStorage.getItem(LAST_POS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (typeof obj?.lat === 'number' && typeof obj?.lon === 'number') return obj;
  } catch {}
  return null;
}

function saveLastPos(lat, lon) {
  try {
    localStorage.setItem(LAST_POS_KEY, JSON.stringify({ lat, lon }));
  } catch {}
}

export function createMap(elementId) {
  const last = readLastPos();
  const startCenter = last ? [last.lat, last.lon] : [20, 0];
  const startZoom = last ? 14 : 2;

  const map = L.map(elementId, {
    zoomControl: false,
    minZoom: 2
  }).setView(startCenter, startZoom);
  // Blockera long-press/right-click-kontextmeny på kartan
  map.getContainer().addEventListener('contextmenu', (e) => e.preventDefault());

  const glLayer = L.maplibreGL({
    style: 'https://tiles.openfreemap.org/styles/dark'
  }).addTo(map);

  map.attributionControl.addAttribution(
    '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
    '© <a href="https://openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a> ' +
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
  );

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const savedLayer = L.layerGroup().addTo(map);
  let userMarker = null;
  let onEdit = null;

  const resizeObserver = new ResizeObserver(() => {
    map.invalidateSize();
  });
  resizeObserver.observe(map.getContainer());

  function makeEmojiIcon(emoji) {
    return L.divIcon({
      className: '',
      html: `<div style="font-size:26px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.65));text-align:center;line-height:1;">${emoji}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  }

  function fmtDate(s) {
    if (!s || s.length < 10) return s || '';
    return `${s.slice(8, 10)}/${s.slice(5, 7)}`;
  }

  function popupHtml(log) {
    const nav = `https://www.google.com/maps/dir/?api=1&destination=${log.lat},${log.lon}`;
    const notes = log.notes
      ? `<div style="margin-top:6px;color:#d1d5db;font-size:12px;white-space:pre-wrap;">${escapeHtml(log.notes)}</div>`
      : '';
    return `
      <div>
        <div style="font-weight:700;color:#f3f4f6;font-size:14px;">${escapeHtml(log.name)}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px;">
          ${fmtDate(log.dateString)} · ${log.timeString}
        </div>
        ${notes}
        <div style="margin-top:8px;display:flex;gap:12px;flex-wrap:wrap;">
          <a href="${nav}" target="_blank" rel="noopener" style="color:#60a5fa;font-size:12px;">🧭 Navigera</a>
          <a href="#" class="popup-edit" style="color:#fbbf24;font-size:12px;">✏️ Redigera</a>
        </div>
      </div>`;
  }

  return {
    map,
    onEdit(cb) { onEdit = cb; },

    setUser(lat, lon, zoom = 16, pan = true) {
      if (userMarker) userMarker.setLatLng([lat, lon]);
      else userMarker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: '',
          html: '<div style="width:18px;height:18px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 0 0 4px rgba(59,130,246,0.35);"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      }).addTo(map);

      saveLastPos(lat, lon);

      if (pan) {
        map.setView([lat, lon], zoom, { animate: false });
      }
    },

    /**
     * Väntar på att kartan är "idle". Ger 100 ms för setView att sätta tiles i
     * loading-state innan vi kollar gl.loaded(). Fallback 2.5 s.
     */
    once(event, cb) {
      if (event === 'idle') {
        const gl = glLayer.getMaplibreMap?.();
        if (!gl) { setTimeout(cb, 100); return; }

        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          cb();
        };

        setTimeout(() => {
          if (done) return;
          if (typeof gl.loaded === 'function' && gl.loaded()) {
            finish();
            return;
          }
          try {
            gl.once('idle', finish);
          } catch {
            finish();
            return;
          }
          setTimeout(finish, 2500);
        }, 100);
      } else {
        map.once(event, cb);
      }
    },

    renderSaved(logs, dateFilter = null, fit = false) {
      savedLayer.clearLayers();
      const visible = dateFilter ? logs.filter(l => l.dateString === dateFilter) : logs;

      const bounds = [];
      for (const log of visible) {
        const m = L.marker([log.lat, log.lon], { icon: makeEmojiIcon(getEmoji(log.type)) });
        m.bindPopup(popupHtml(log));
        m.on('popupopen', () => {
          const el = m.getPopup()?.getElement();
          if (!el) return;
          const editBtn = el.querySelector('.popup-edit');
          if (editBtn && onEdit) {
            editBtn.addEventListener('click', (ev) => {
              ev.preventDefault();
              map.closePopup();
              onEdit(log.id);
            });
          }
        });
        m.addTo(savedLayer);
        bounds.push([log.lat, log.lon]);
      }

      if (fit && bounds.length > 0) {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      }
      return visible.length;
    },

    invalidate() { map.invalidateSize(); }
  };
}