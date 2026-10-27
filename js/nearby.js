let currentBatch = null;

// Amenity-värden som ger meningsfulla platser. Filtreras redan i Overpass-
// queryn (regex) för att spara data, tid och undvika skräp som parking/
// bench/atm/bank som ändå bara blev "Aktivitet".
const MEANINGFUL_AMENITIES = 'restaurant|fast_food|food_court|bar|pub|biergarten|cafe|ice_cream|theatre|cinema|arts_centre|community_centre|library|nightclub|place_of_worship';

function categorizePlace(el) {
  const t = el.tags || {};

  if (t.tourism) {
    if (['hotel','hostel','guest_house','motel','apartment','chalet',
         'camp_site','caravan_site','alpine_hut','wilderness_hut','resort']
        .includes(t.tourism)) {
      return 'Boende';
    }
    return 'Sevärdhet';
  }

  if (t.amenity) {
    if (t.amenity === 'cafe' || t.amenity === 'ice_cream') return 'Café';
    if (['restaurant','fast_food','food_court','bar','pub','biergarten']
        .includes(t.amenity)) {
      return 'Restaurang';
    }
    return 'Aktivitet';
  }

  if (t.historic) return 'Sevärdhet';
  if (t.leisure) return 'Aktivitet';

  return 'Egen plats';
}

function parseOverpass(data) {
  const seen = new Set();
  const places = [];
  for (const el of (data.elements || [])) {
    const name = el.tags?.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const pLat = el.lat ?? el.center?.lat;
    const pLon = el.lon ?? el.center?.lon;
    if (pLat == null || pLon == null) continue;

    places.push({
      name,
      type: categorizePlace(el),
      lat: pLat,
      lon: pLon
    });
  }
  return places;
}

export async function fetchNearby(lat, lon, radiusM = 250) {
  if (currentBatch) currentBatch.abort();

  const batch = {
    aborted: false,
    controllers: [],
    settle: null,
    abort() {
      this.aborted = true;
      this.controllers.forEach(c => { try { c.abort(); } catch {} });
      if (this.settle) this.settle(new DOMException('Aborted', 'AbortError'));
    }
  };
  currentBatch = batch;

  // amenity begränsas redan i Overpass med regex – ger mindre payload och
  // renare resultat (ingen "parkering", "bänk", "bankomat" som skräp).
  const q = `[out:json][timeout:8];
    (
      nwr(around:${radiusM},${lat},${lon})["name"]["tourism"];
      nwr(around:${radiusM},${lat},${lon})["name"]["historic"];
      nwr(around:${radiusM},${lat},${lon})["name"]["amenity"~"^(${MEANINGFUL_AMENITIES})$"];
      nwr(around:${radiusM},${lat},${lon})["name"]["leisure"];
    );
    out center 20;`;

  const queryStr = encodeURIComponent(q);

  const urls = [
    'https://overpass.kumi.systems/api/interpreter?data=' + queryStr,
    'https://overpass.private.coffee/api/interpreter?data=' + queryStr,
    'https://overpass-api.de/api/interpreter?data=' + queryStr
  ];

  return new Promise((resolve, reject) => {
    let settled = false;
    let pending = urls.length;
    let lastError = null;

    const finish = (err, places) => {
      if (settled) return;
      settled = true;
      batch.controllers.forEach(c => { try { c.abort(); } catch {} });
      if (err) reject(err);
      else resolve(places);
    };
    batch.settle = finish;

    if (batch.aborted) {
      finish(new DOMException('Aborted', 'AbortError'));
      return;
    }

    for (const url of urls) {
      const controller = new AbortController();
      batch.controllers.push(controller);
      const timeoutId = setTimeout(() => {
        try { controller.abort(); } catch {}
      }, 8000);

      fetch(url, { signal: controller.signal })
        .then(res => {
          if (settled) return null;
          if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
          return res.json();
        })
        .then(data => {
          clearTimeout(timeoutId);
          if (settled || !data) return;
          finish(null, parseOverpass(data));
        })
        .catch(err => {
          clearTimeout(timeoutId);
          if (settled) return;
          if (batch.aborted) {
            finish(new DOMException('Aborted', 'AbortError'));
            return;
          }
          lastError = err.name === 'AbortError' ? new Error('Timeout') : err;
          pending--;
          if (pending === 0) {
            finish(lastError || new Error('Kunde inte nå någon Overpass-server'));
          }
        });
    }
  });
}