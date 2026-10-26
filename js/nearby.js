// Behåll en referens till pågående förfrågan för att kunna avbryta den
let currentController = null;

export async function fetchNearby(lat, lon, radiusM = 150) {
  // Avbryt föregående anrop om ett sådant pågår
  if (currentController) {
    currentController.abort();
  }
  currentController = new AbortController();
  const signal = currentController.signal;

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    currentController.abort();
  }, 10000);

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

  for (const url of urls) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);

      const data = await res.json();
      clearTimeout(timeoutId);

      const seen = new Set();
      const places = [];

      for (const el of (data.elements || [])) {
        const name = el.tags?.name;
        if (!name || seen.has(name)) continue;
        seen.add(name);

        // Nodes har el.lat/el.lon, ways/relations har el.center.lat/lon
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
      
      // Om anropet avbröts
      if (err.name === 'AbortError') {
        if (timedOut) throw new Error('Timeout');
        throw err; // Kastar AbortError så att app.js kan ignorera det
      }

      console.warn(`Overpass misslyckades (${url}):`, err);
      lastError = err;
    }
  }

  throw lastError || new Error('Kunde inte nå någon Overpass-server');
}