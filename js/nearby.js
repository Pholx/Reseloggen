// Håll koll på pågående batch så att vi kan avbryta vid ny sökning
let currentBatch = null;

export async function fetchNearby(lat, lon, radiusM = 150) {
  // Avbryt föregående batch om en sådan pågår
  if (currentBatch) {
    currentBatch.abort();
  }

  const batch = {
    aborted: false,
    currentUrlController: null,
    abort() {
      this.aborted = true;
      if (this.currentUrlController) {
        this.currentUrlController.abort();
      }
    }
  };
  currentBatch = batch;

  const q = `[out:json][timeout:12];
    (
      nwr(around:${radiusM},${lat},${lon})["name"]["tourism"];
      nwr(around:${radiusM},${lat},${lon})["name"]["historic"];
      nwr(around:${radiusM},${lat},${lon})["name"]["amenity"];
      nwr(around:${radiusM},${lat},${lon})["name"]["leisure"];
    );
    out center 20;`;

  const queryStr = encodeURIComponent(q);
  const urls = [
    'https://overpass-api.de/api/interpreter?data=' + queryStr,
    'https://overpass.kumi.systems/api/interpreter?data=' + queryStr
  ];

  let lastError = null;

  try {
    for (const url of urls) {
      if (batch.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Timeout per URL så att spegelservern också får en chans
      const controller = new AbortController();
      batch.currentUrlController = controller;
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (batch.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        if (!res.ok) {
          throw new Error(`Overpass HTTP ${res.status}`);
        }

        const data = await res.json();
        const seen = new Set();
        const places = [];

        for (const el of (data.elements || [])) {
          const name = el.tags?.name;
          if (!name || seen.has(name)) continue;
          seen.add(name);

          const pLat = el.lat ?? el.center?.lat;
          const pLon = el.lon ?? el.center?.lon;
          if (pLat == null || pLon == null) continue;

          let type = 'Plats';
          if (el.tags.tourism) type = 'Sevärdhet';
          else if (el.tags.historic) type = 'Historiskt';
          else if (el.tags.leisure) type = 'Fritid/Natur';
          else if (el.tags.amenity) {
            type = ['restaurant','cafe','bar','food_court'].includes(el.tags.amenity)
              ? 'Mat & Dryck' : 'Bekvämlighet';
          }
          places.push({ name, type, lat: pLat, lon: pLon });
        }

        return places;
      } catch (err) {
        clearTimeout(timeoutId);

        if (batch.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        // Timeout (AbortError från vår egen timer) sparas som "Timeout"
        if (err.name === 'AbortError') {
          lastError = new Error('Timeout');
        } else {
          lastError = err;
        }
        console.warn(`Overpass misslyckades (${url}):`, err);
      }
    }
  } finally {
    if (currentBatch === batch) {
      currentBatch = null;
    }
  }

  throw lastError || new Error('Kunde inte nå någon Overpass-server');
}