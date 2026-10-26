import { escapeHtml, getEmoji } from './ui.js';

export function createMap(elementId) {
  // Starta på världsöversikt – GPS zoomar sedan in till din position
  const map = L.map(elementId, { zoomControl: false, minZoom: 2 })
    .setView([20, 0], 2);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OSM &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
    maxNativeZoom: 19,
    minZoom: 2
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const savedLayer = L.layerGroup().addTo(map);
  let userMarker = null;
  let onLongPress = null;

  // ResizeObserver: automatiskt invalidateSize när container ändras
  const resizeObserver = new ResizeObserver(() => {
    map.invalidateSize();
  });
  resizeObserver.observe(map.getContainer());

  // Lång-tryck / högerklick → logga plats.
  map.on('contextmenu', (e) => {
    const target = e.originalEvent?.target;
    if (target && target.closest && target.closest('.leaflet-marker-icon')) return;
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
      ? `<div style="margin-top:6px;color:#d1d5db;font-size:12px;">${escapeHtml(log.notes)}</div>`
      : '';
    return `
      <div>
        <div style="font-weight:700;color:#f3f4f6;font-size:14px;">${escapeHtml(log.name)}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:2px;">
          ${fmtDate(log.dateString)} · ${log.timeString}
        </div>
        ${notes}
        <div style="margin-top:8px;">
          <a href="${nav}" target="_blank" rel="noopener" style="color:#60a5fa;font-size:12px;">🧭 Navigera i Google Maps</a>
        </div>
      </div>`;
  }

  return {
    map,

    onLongPress(cb) { onLongPress = cb; },

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
      if (pan) map.setView([lat, lon], zoom);
    },

    renderSaved(logs, dateFilter = null) {
      savedLayer.clearLayers();
      const visible = dateFilter
        ? logs.filter(l => l.dateString === dateFilter)
        : logs;

      const bounds = [];
      for (const log of visible) {
        const m = L.marker([log.lat, log.lon], { icon: makeEmojiIcon(getEmoji(log.type)) });
        m.bindPopup(popupHtml(log));
        m.addTo(savedLayer);
        bounds.push([log.lat, log.lon]);
      }

      if (dateFilter && bounds.length > 0) {
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
      }

      return visible.length;
    },

    invalidate() { map.invalidateSize(); }
  };
}