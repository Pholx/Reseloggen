import { escapeHtml, getEmoji } from './ui.js';

export function createMap(elementId) {
  // Starta på världsöversikt. tapHold + tapTolerance aktiverar långtryck
  // även på Android (Leaflets default är annars bara Safari mobil).
  const map = L.map(elementId, {
    zoomControl: false,
    minZoom: 2,
    tapHold: true,
    tapTolerance: 15
  }).setView([20, 0], 2);

  // OpenFreeMap (vektorkarta, ingen API-nyckel krävs)
  L.maplibreGL({
    style: 'https://tiles.openfreemap.org/styles/dark'
  }).addTo(map);

  // Attribution för OpenFreeMap / OpenStreetMap
  map.attributionControl.addAttribution(
    '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
    '© <a href="https://openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a> ' +
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
  );

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const savedLayer = L.layerGroup().addTo(map);
  let userMarker = null;
  let onLongPress = null;
  let onEdit = null;

  const resizeObserver = new ResizeObserver(() => {
    map.invalidateSize();
  });
  resizeObserver.observe(map.getContainer());

  // Contextmenu (högerklick desktop, long-press mobil).
  // Skippa på markörer och popups så att användaren inte råkar öppna
  // save-modalen när de interagerar med befintliga objekt.
  map.on('contextmenu', (e) => {
    const target = e.originalEvent?.target;
    if (target && target.closest && (
      target.closest('.leaflet-marker-icon') ||
      target.closest('.leaflet-popup')
    )) return;
    if (onLongPress) onLongPress(e.latlng.lat, e.latlng.lng);
  });

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
    onLongPress(cb) { onLongPress = cb; },
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
      if (pan) map.flyTo([lat, lon], zoom, { duration: 1.2 });
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