# Reseloggen 🛵📍

https://pholx.github.io/Reseloggen/

En offline-först PWA (Progressive Web App) för att logga platser under resan. Byggd för att fungera smidigt oavsett om du är i Chiang Mai, Göteborg, Medelhavet eller någon helt annan plats i världen. All data sparas lokalt i telefonens IndexedDB och kräver inget konto.

## 🚀 Funktioner
- **Logga platser** via GPS, genom att lång-trycka (eller högerklicka) på kartan, eller via Overpass-sökning ("Platser nära dig").
- **Koppla videor**: Varje plats sparar ett exakt datum och ett filnamnsmönster (t.ex. `20261025_142533`) som du kan söka på i telefonens galleri.
- **Datumfilter**: Visa bara markörer från en specifik dag på kartan.
- **Kartcache**: Kartan cachas automatiskt när du besöker områden online – inget manuellt nedladdningssteg behövs.
- **Offline-läge**: Kartan cachas, och appen fungerar helt utan nät.
- **Export**: Ladda ner alla loggade platser som en GeoJSON-fil.
- **Installationsbar**: Läggs till på hemskärmen som en native-app (PWA).
- **Global**: Fungerar i vilken stad och på vilken plats som helst – inga inbyggda antaganden om specifika länder eller regioner.

---

## 🔑 API-nycklar & Tredjepartstjänster

**Du behöver INGA API-nycklar för att använda den här appen.** Den är byggd för att vara helt gratis och öppen.

1. **Karta (Leaflet + MapLibre GL JS + OpenFreeMap)**: Vi använder en vektorkarta från [OpenFreeMap](https://openfreemap.org) som renderas med **MapLibre GL JS** inuti **Leaflet** (via `leaflet-maplibre-gl`). OpenFreeMap är en öppen, gratis tjänst utan API-nyckel som täcker hela världen. Style: `https://tiles.openfreemap.org/styles/dark`.
2. **Platsdata (Overpass API / OpenStreetMap)**: När du trycker "Platser nära dig" skickas en query till Overpass för att hitta närliggande sevärdheter, restauranger och tempel. Även detta är helt gratis och kräver ingen nyckel (appen har inbyggd fallback till en spegelserver om huvudservern är nere). Fungerar i alla länder där OpenStreetMap har data – vilket i praktiken är hela världen.
3. **Lagring (localForage)**: Sparar data i webbläsarens IndexedDB.

### Om du absolut vill byta karttjänst
Om du i framtiden vill ha en annan karta och skaffar en API-nyckel (t.ex. från Mapbox), gör du så här:

1. **Skaffa nyckeln**: Registrera dig på [Mapbox](https://www.mapbox.com/) och skapa en API-nyckel.
2. **Lägg in den i koden**: Öppna `js/map.js`. Leta upp raden `L.maplibreGL({ style: 'https://tiles.openfreemap.org/styles/dark' })`.
3. **Byt ut style-URL:en** mot din tjänst. Exempel för Mapbox:

   ```javascript
   L.maplibreGL({
     style: 'https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=DIN_API_NYCKEL_HÄR'
   }).addTo(map);
   ```

4. **Uppdatera `sw.js`**: Byt ut `tiles.openfreemap.org` mot din nya domän i fetch-hanteraren så att rätt tiles cachas offline.

---

## 🕒 Tidszoner & Kameror (DJI Osmo Action 4)

**Behöver du ändra tiden i din DJI Osmo Action 4?**
**Ja, se till att kameran är inställd på lokal tid** (den tid som gäller på platsen du besöker). DJI-kameror använder ofta filnamn som `DJI_20241025142533_0001_D.MP4` där siffrorna är datum och tid. Om kameran är inställd på lokal tid kommer `20241025142533` att matcha den tid appen sparar.

**Exempel:** Är du i Chiang Mai ställer du in kameran på thailändsk tid. Är du i Göteborg ställer du in den på svensk tid. Är du i Mexico City ställer du in den på mexikansk tid. Alltid den tid som gäller **där du befinner dig**.

### Så hanterar appen tidszoner
När du trycker "Spara plats" läser appen av telefonens **lokala tid** (den tid som gäller på den plats där du just nu befinner dig). Den skapar filnamnsmönstret `20261025_142533` och sparar detta **permanent** på platsen.

**Varför?** För att filen `20261025_142533` ska matcha det filnamn din DJI-kamera gav videon när den spelades in. Om du senare reser hem (eller vidare till en annan tidszon) och öppnar appen, kommer mönstret fortfarande att visa tiden från inspelningsplatsen – eftersom det är då videon spelades in.

**Din plan fungerar precis som det är tänkt:**
- Du ställer in kameran på lokal tid när du anländer till resmålet.
- Du loggar platser med appen, som använder telefonens lokala tid (samma tid som kameran).
- När du kommer hem (eller reser vidare) visar appen **fortfarande** den lokala tiden från inspelningsplatsen för de sparade platserna – och det är exakt det mönster som matchar videofilerna i galleriet. Inget behöver ändras.

### Hur du ändrar så att mönstret byter till lokal tid när du byter tidszon
Detta rekommenderas **inte** eftersom det förstör matchningen mot DJI-kamerans filnamn (videon spelades in i en annan tidszon, inte där du råkar befinna dig nu). Men om du absolut vill det:

1. Öppna `js/ui.js`.
2. Ändra i funktionen `videoFilenamePattern(log)`:

   ```javascript
   export function videoFilenamePattern(log) {
     // Använder alltid aktuell tid/tidszon istället för loggens sparade tid
     const d = new Date(); 
     const pad = n => String(n).padStart(2, '0');
     return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
   }
   ```

*OBS: Detta kommer visa nuvarande tid, inte tiden då platsen loggades – och därmed inte matcha videofilen.*

---

## 🗺️ Kartcache & Offline-förberedelse

Appen använder **OpenFreeMap** (vektorkarta). Till skillnad från gamla raster-tiles behöver du **inte** ladda ner ett område manuellt. Istället **cachas kartan automatiskt** av service workern (`sw.js`) när du besöker ett område – varje tile, style-fil, sprite och font som laddas sparas i `Cache Storage` under namnet `gl-map-offline`.

### Så här förbereder du offline-läget

1. Gå till **Karta**-fliken.
2. **Panorera och zooma runt** i det område du vill kunna se offline (t.ex. Chiang Mai centrum, din hemort eller hotellområdet).
   - Titta på zoom-nivåerna – ju mer du zoomar, desto fler detaljerade tiles laddas ner.
   - Besök området i den detaljnivå du förväntar dig behöva offline.
3. Byt till **Logg**-fliken och kontrollera **Kartcache**-sektionen. Där ser du antal cachade filer och uppskattad storlek (t.ex. `412 filer · ca 10,1 MB`).
4. Upprepa för alla platser du ska besöka.

### Teknisk information

- **Cache-namn**: `gl-map-offline`
- **Max antal filer**: 3000 (FIFO – äldsta raderas automatiskt när gränsen nås)
- **Uppskattad storlek**: ca 25 KB per fil i snitt → 3000 filer ≈ 75 MB
- **Var sparas det?**: I telefonens `Cache Storage` under `gl-map-offline`

### När ska man rensa?

- **Efter en resa** – för att frigöra utrymme och förbereda för nästa resa
- **Om kartan visar gamla vägar** – om en stad byggts om och du vill hämta senaste versionen
- **Om du byter resmål** – om du inte längre behöver offline-kartan för förra staden

Klicka på **"🗑 Rensa kartcache"** i Logg-fliken för att tömma cachen. Du får en bekräftelsedialog med antal filer och uppskattad storlek.

---

## 📱 Offline-guide (Gör detta INNAN avresa)

Appen fungerar offline på två sätt: **appen själv** (HTML/JS/CSS) cachas automatiskt, och **kartdata** cachas automatiskt när du besöker ett område online.

### Steg för steg

1. Öppna appen i **Chrome på telefonen** (via din GitHub Pages-URL)
2. Lägg till på hemskärmen (Installera-knappen eller Chrome-meny → "Lägg till på startskärmen")
3. **Panorera och zooma runt i de områden du ska besöka** – ju mer du rör dig runt desto mer cachas. Gör detta för alla städer/områden du planerar att besöka.
4. Kontrollera i **Logg**-fliken att antalet cachade filer ökar.
5. **Testa offline**: sätt telefonen i flygplansläge, öppna appen, panorera runt de cachade områdena.
6. Verifiera att dina sparade platser fortfarande syns och att popup-fönster fungerar.

### Vad fungerar offline?

| Funktion | Fungerar offline? |
|---|---|
| Öppna appen | ✅ (cachas automatiskt) |
| Se sparade platser på kartan | ✅ |
| Klicka på markörer och se anteckningar | ✅ |
| Panorera i cachade kartområden | ✅ |
| "Platser nära dig" (Overpass) | ❌ (kräver nät) |
| GPS-position | ✅ (men kan vara långsam utan nät) |
| Exportera GeoJSON | ✅ |

**Om "Platser nära dig" och dataförbrukning:** En sökning skickar en liten förfrågan (150 m radie, max 20 resultat) och landar typiskt på **50–200 KB** data. Det är ungefär en femtedel av en genomsnittlig webbsida – försumbart om du har ett normalt mobilabonnemang. Du kan tryggt trycka 100 gånger utan att märka det i surfpotten.

**Tips:** Besök både ditt resmål och området kring din hemort online innan avresa, så att appen fungerar smidigt hela vägen.

---

## 🌍 Filstruktur

```text
/
├── index.html
├── manifest.json
├── sw.js
├── README.md
├── icons/
│   ├── apple-touch-icon.png
│   ├── icon-192.png
│   └── icon-512.png
├── css/
│   ├── app.css
│   └── lib/
│       ├── leaflet.css
│       └── maplibre-gl.css
└── js/
    ├── app.js       # Huvudlogik, UI-händelser, state
    ├── storage.js   # IndexedDB (localForage wrapper)
    ├── ui.js        # Toast, kopiering, tidsstämplar
    ├── nearby.js    # Overpass API (nwr, center)
    ├── map.js       # Leaflet + MapLibre GL JS + OpenFreeMap
    └── lib/
        ├── leaflet.js
        ├── localforage.min.js
        ├── maplibre-gl.js
        └── leaflet-maplibre-gl.js
```

---

## 📤 Exportera GeoJSON
Under fliken **Logg**, tryck på "Exportera GeoJSON". Filen laddas ned. Du kan dra in den i [Google My Maps](https://mymaps.google.com) eller [geojson.io](https://geojson.io) för att se rutten och dina platser på en stor skärm. Filen får automatiskt dagens datum i filnamnet.

---

## 🧑‍💻 Utveckling & Hosting
- **Hostas enklast på GitHub Pages**.
- Inga byggsteg krävs. Ladda bara upp filerna.
- Service Workern (`sw.js`) ligger i roten för att kunna styra hela appens scope.

---

## 🗺️ Teknisk översikt: hur kartan fungerar

- **Leaflet** är huvudkartan och ansvarar för markörer, popups och zoomkontroller.
- **MapLibre GL JS** renderar vektorkartan (OpenFreeMap) i en canvas.
- **leaflet-maplibre-gl** är bryggan som gör att MapLibre-lagret beter sig som ett Leaflet-lager – zoom, panorering och markörer samverkar.
- **OpenFreeMap** levererar style + tiles utan API-nyckel: `https://tiles.openfreemap.org/styles/dark`.
- **Service workern** cachar automatiskt OpenFreeMap-filer (tiles, style, sprites, fonts) i `gl-map-offline` när du använder kartan online.

---

Skapad för äventyr – oavsett om det bär av till Asien, Europa, Amerika eller någon annanstans. Trevlig resa! 🌏