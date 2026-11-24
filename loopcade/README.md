# plan2run — Firebase Authentication en Firestore

Loopcade blijft een statische ES-module-app zonder framework. Starten gaat nog steeds met de bestaande Python-server, die de juiste JavaScript-MIME-types en `Cache-Control: no-store` instelt.

## 1. Firebase-project instellen

1. Maak in de [Firebase Console](https://console.firebase.google.com/) een project of kies het bestaande hackathonproject.
2. Ga naar **Build → Authentication → Get started** en schakel bij **Sign-in method** zowel **Google** als **Anonymous** in.
3. Ga naar **Build → Firestore Database** en maak een database. Kies een geschikte regio. Start **niet** met open testregels; de repository bevat `firestore.rules`.
4. Ga naar **Project settings → General → Your apps**, voeg een **Web App** toe en kopieer de configuratie.
5. Vul `dist/firebase-config.mjs` in:

   ```js
   export const firebaseConfig = {
     apiKey: '...',                         // Web API key uit de Web App-config
     authDomain: 'jouw-project.firebaseapp.com',
     projectId: 'jouw-project-id',
     appId: '1:...:web:...',
   };
   ```

   Deze vier waarden komen uit de Firebase Web App-configuratie. Er zijn geen serviceaccount- of AI-sleutels nodig en die horen nooit in `dist/`.
6. Ga naar **Authentication → Settings → Authorized domains**. Zorg dat `localhost` en `127.0.0.1` voor lokaal gebruik zijn toegestaan. Voeg later ook het definitieve hostingdomein toe, bijvoorbeeld `jouw-project.web.app`, `jouw-project.firebaseapp.com` of een eigen domein.
7. Deploy de meegeleverde regels nadat je ze hebt getest:

   ```bash
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project JOUW_PROJECT_ID
   ```

   Vervang `JOUW_PROJECT_ID` door de echte project-ID. Er is door deze wijzigingen nog niets gedeployd.

## 2. Starten

```bash
cd "C:\Home\Projects\Hack The Future\hack-the-future\loopcade"
python serve.py
```

Open <http://localhost:8000>. Met placeholders in `firebase-config.mjs` verschijnt **Alleen lokaal**: de routeplanner en oude lokale activiteiten blijven werken, maar accountknoppen geven een duidelijke configuratiemelding. Met echte configuratie kun je routes altijd plannen; voor het bewaren van een rondje log je in met Google of als gast.

## Gebruik

- **Doorgaan met Google** opent Google Authenticatie en herstelt de sessie bij vernieuwen via lokale Firebase-persistentie.
- **Verder als gast** maakt een anoniem Firebase-account met een eigen UID en eigen Firestore-gegevens.
- **Koppel aan Google** gebruikt `linkWithPopup`, waardoor de gast-UID en activiteiten behouden blijven.
- Bestaat het Google-account al, dan wordt niets overschreven of automatisch samengevoegd. Je kunt expliciet naar dat bestaande account overschakelen; het gastaccount blijft onder zijn eigen UID bestaan.
- Bij uitloggen of wisselen worden zichtbare activiteiten, punten, open terugblikken en een actief rondje van de vorige identiteit ontruimd.
- **Lokale activiteiten importeren** staat onder Account en op Activiteiten zolang er oude lokale records zijn. Import gebeurt alleen na een expliciete klik, gebruikt bestaande activiteit-ID’s en verwijdert de lokale kopieën niet. Opnieuw importeren slaat bestaande ID’s over.

## Gegevensmodel

```text
users/{uid}
  schemaVersion: 1
  profile: { displayName, email, isAnonymous }
  preferences: { preferredMode, preferredDistance }
  createdAt / updatedAt / lastLoginAt

users/{uid}/activities/{activityId}
  id, began, end, elapsed, mode, place, from
  meters, height, points, target, note, voice
  schemaVersion, hasRoute, createdAt, updatedAt

users/{uid}/routes/{activityId}
  activityId, encoding: "delta36-v1", path
  pointCount, originalPointCount, updatedAt
```

Elke activiteit heeft zijn eigen document; er is geen onbeperkt groeiende activiteitenarray. Routegeometrie staat apart en wordt met decimeter-delta’s compact gecodeerd. Zeer lange paden worden tot maximaal ongeveer 6.000 punten gereduceerd en de codec weigert te grote payloads. Bestaande activiteit-ID’s blijven de Firestore-document-ID’s.

Audio blijft in IndexedDB. Voor ingelogde gebruikers is de sleutel met de UID genamespaced, zodat een ander account geen bestaande opnames opent. Alleen bij expliciete migratie worden oude lokale clips naar de nieuwe namespace gekopieerd, zonder het origineel te verwijderen. Cloudaudio en transcriptie zijn niet geïmplementeerd.

## Security

`firestore.rules` weigert standaard alles. Alleen `request.auth.uid == uid` geeft toegang tot het eigen profiel, activiteiten en routes. Dezelfde regel geldt voor anonieme authenticatie. Er zijn geen publieke lees- of schrijfregels.

## Tests

Eenmalig testdependencies installeren (Node.js en Java zijn vereist voor de Firebase Emulator Suite):

```bash
npm install
npx playwright install chromium
npm run test:unit
npm run test:merge
npm run test:emulator
```

- `test:unit` controleert de route-codec en de ongewijzigde routeplanner.
- `test:merge` controleert de gecombineerde frontend in Chromium: omgevingsvoorkeuren, kaartbediening, lokale opslag, tekstreflecties en herstel van actieve rondjes. Een gesimuleerde accountsessie controleert ook het wisselen van gebruiker. Deze tests wijzigen geen echte Firebase-gegevens.
- `test:emulator` start tijdelijk Auth en Firestore op poorten 9099 en 8080. Naast anonieme authenticatie en vijf ruleschecks draait een echte Chromium-flow: gastlogin, sessieherstel, activiteit en tekstreflectie, uitloggen, accountscheiding, tweemaal migreren zonder duplicaten, gast koppelen aan Google met behoud van UID, en de afhandeling van een reeds bestaand Google-account. De test start `python serve.py` zelf als poort 8000 nog vrij is.
- De Emulator UI staat tijdens `npm run emulators` op <http://127.0.0.1:4000>.

Voor de emulator-tests is geen echte Firebase-configuratie nodig; ze gebruiken project `demo-loopcade`. Laat `emulatorConfig.enabled` in de frontend op `false` voor normaal gebruik.

### Handmatige acceptatie met echte configuratie

De emulator-tests dekken de volledige gast-, Google-popup-, sessie-, opslag-, scheidings- en migratieflow. Controleer na het invullen van de echte configuratie nog wel:

1. Google-login en koppeling met de echte Google-provider, inclusief een reeds bestaand account.
2. Gast- en Google-sessieherstel op localhost en later op het uiteindelijke authorized hostingdomein.
3. Een activiteit en tekstreflectie in de echte Firestore-database, met de gedeployde rules in plaats van de emulator.
4. Audio-opname met microfoon en de accountscheiding van audio op een gedeeld toestel; de geautomatiseerde browserflow gebruikt geen echte microfoon.
5. De routeplanner op je eigen doelbrowsers en mobiele schermformaten.

AI en transcriptie vallen buiten deze implementatie. Firebase-audio blijft op het toestel; de demovrienden worden per gebruiker in Firestore bewaard.

## Vrienden via Firebase

Er is nog maar één app en één inlogsysteem: Firebase Google-/gastlogin op `/`. De aparte SQLite-demo, registratiepagina en lokale account-API zijn verwijderd. Oude links naar `/local/` en `/login.html` verwijzen bij de Python-server naar de hoofdapp.

Bij de eerste opening van **Vrienden** worden drie fictieve vrienden met voorbeeldactiviteiten opgeslagen in `users/{uid}.demoFriends`: Noor en Milan zijn al vrienden; Yara heeft een openstaand verzoek. Dit gebeurt in een Firestore-transactie, zodat herladen of een tweede tab geen duplicaten maakt en bestaande keuzes niet worden overschreven. Accepteren, weigeren en opnieuw toevoegen worden in hetzelfde document bewaard.

De feed en het klassement tonen deze herkenbaar gemarkeerde voorbeeldpersonen. Routekaarten gebruiken vaste Gentse voorbeeldroutes en verbergen de zone binnen 350 meter van het startpunt. Deze gegevens bevatten geen echte gebruikerslocaties, tekstreflecties of audio. Het betreft drie vaste demofiguren, geen zoekfunctie voor echte gebruikers of gedeelde toegang tot hun profielen.

De bestaande eigenaarregels voor `users/{uid}` volstaan; er zijn geen publieke collecties, extra rechten of nieuwe regels nodig. De demovrienden worden pas in het echte Firebase-project aangemaakt wanneer een ingelogde gebruiker de vriendenpagina opent. De geautomatiseerde tests gebruiken uitsluitend het emulatorproject.

Starten blijft `python serve.py` (optioneel `--port 8049`). Herstart een nog draaiende server na deze update. Een eventueel oud bestand in `data/` wordt niet meer gebruikt; bestaande gegevens zijn niet verwijderd.

## Spelen: wekelijkse gebiedscompetitie

Het tabblad **Spelen** (`#play`) gebruikt dezelfde Firebase-app, dezelfde login (Google of gast) en dezelfde Firestore-verbinding als de rest. Er is geen tweede app of inlogsysteem; `storage.mjs` geeft via `firestoreContext()` de bestaande verbinding door.

### Spel

- Een speler maakt een **groep**, kiest een **gezamenlijk startpunt** (een plein of straat in Gent) en deelt een **uitnodigingslink** (`#play/join/<groepscode>.<token>`) of code. Wie de link opent en inlogt, kan lid worden.
- Van maandag 00:00 tot maandag 00:00 (**Europe/Brussels**, ook rond zomer-/wintertijd) verzamelen spelers **cellen** van ongeveer 100 × 100 m (1 ha) door met GPS te wandelen of lopen. Een cel telt alleen als een echt geregistreerd GPS-traject erdoor gaat. Elke cel telt maximaal één keer per speler per week; meerdere spelers kunnen dezelfde cel verdienen. Wie de meeste cellen (grootste oppervlakte) heeft, wint; gelijke stand deelt de overwinning.
- Het tabblad toont de spelregels, een kaart met verzameld terrein (kleur per speler, aan/uit via de legenda), het weekklassement, persoonlijke voortgang, de resterende speeltijd en de afgesloten weken.
- Na de weekgrens bewaart de eerste groepsspeler die de app opent de uitslag (winnaar en eindstand) in `groups/{id}/results/{weekId}`. De nieuwe week begint vanzelf leeg, omdat cellen per week in een eigen document staan. Ontbrekende weken (niemand speelde) worden bij het openen alsnog afgesloten.
- **Demovrienden en geplande routes tellen niet mee.** Alleen echte spelers die zijn uitgenodigd en echte GPS-metingen doen mee. Het tabblad Vrienden is ongewijzigd.

### GPS en privacy

- Locatie wordt pas gebruikt na een duidelijke toestemming (per account, op dit toestel, intrekbaar) en alleen tussen **Start** en **Stop**. Tijdens registratie staat een rode **GPS actief**-indicator in de kop op elke pagina. Stop (of uitloggen/van account wisselen) geeft de locatie direct vrij.
- Het volledige spoor, coördinaten en tijdstippen worden **niet bewaard**. Elke meting wordt meteen een cel; alleen cellen die nog niet in Firestore staan, blijven in een lokale wachtrij (`loopcade-play-pending`).
- Met de groep deel je alleen je gekozen naam en je cel-id's (`x_y`). Cellen binnen 250 m van je startpositie blijven privé en tellen niet mee, tenzij je binnen 300 m van het gezamenlijke startpunt begint.
- Verlaat je een groep, dan worden al je cellen van die groep verwijderd.
- Metingen met een nauwkeurigheid slechter dan 40 m of een snelheid boven ± 23 km/u worden genegeerd. Bij een GPS-gat van meer dan 2 minuten of een sprong van meer dan 250 m wordt de tussenliggende route niet ingevuld. Browsers pauzeren GPS op de achtergrond: houd het tabblad open en het scherm aan.

### Architectuur (nieuwe spelmodi toevoegen)

```text
play-time.mjs      weekgrenzen Europe/Brussels, resterende tijd, af te sluiten weken (puur)
play-grid.mjs      rastercellen en traject → cellen (puur)
play-rules.mjs     spelregels van "Terreinjacht": parameters, regeltekst, GPS-sessie (puur)
play-scoring.mjs   puntentelling, ranglijst, voortgang, weekuitslag (puur)
play-modes.mjs     register: koppelt regels + scoring per modus
play-storage.mjs   Firestore: groepen, uitnodigingen, cellen, uitslagen
play-tracker.mjs   GPS, toestemming, start/stop, lokale wachtrij
territory-map.mjs  kaart met verzameld terrein
play.mjs           het tabblad Spelen
```

Een nieuwe modus is een regelbestand, een scorefunctie en één item in `play-modes.mjs`. De groep bewaart `mode`; `validGroup` in `firestore.rules` accepteert nu alleen `territory` en moet dan ook de nieuwe modus opnemen.

### Gegevensmodel

```text
users/{uid}/playGroups/{groupId}              privé overzicht van mijn groepen
groups/{groupId}                              schemaVersion, name, mode, ownerUid, start{name,lon,lat}, firstWeek, createdAt
groups/{groupId}/members/{uid}                uid, displayName, role (owner|player), joinedAt, inviteId
groups/{groupId}/invites/{token}              createdBy, createdAt, expiresAt (max. 30 d, standaard 7 d), active, groupName, startName, ownerName
groups/{groupId}/weeks/{weekId}/players/{uid} uid, weekId (maandag, YYYY-MM-DD), cells ["x_y", …], updatedAt
groups/{groupId}/results/{weekId}             weekId, mode, winners[], totalCells, standings[], closedBy, closedAt
```

Het startpunt is een celmiddelpunt van een openbare plek, geen precieze positie van een speler.

### Firestore-regels voor Spelen

- Groep, leden, cellen en uitslagen zijn alleen leesbaar voor leden. Niet-leden en niet-ingelogde gebruikers krijgen niets; de groep is na het aanmaken onveranderlijk.
- Een uitnodiging is alleen te openen met het geheime token (`get`), niet op te sommen door niet-leden. Deelnemen kan alleen als lid van jezelf, met een bestaande, actieve en niet verlopen uitnodiging, als `player`. Alleen de eigenaar maakt of trekt uitnodigingen in; de eigenaar-rol ontstaat alleen bij het aanmaken van de groep.
- Je schrijft alleen je eigen weekdocument, als lid, in de **lopende** week, en cellen kunnen alleen worden toegevoegd (max. 2500). Je mag je eigen gegevens altijd verwijderen.
- Uitslagen worden één keer aangemaakt voor een afgelopen week (niet vóór de start van de groep) en daarna nooit gewijzigd of verwijderd.
- Firestore-regels kennen geen tijdzones. Brussel is UTC+1 of UTC+2, dus de regels aanvaarden beide; de weekgrens is in de regels hooguit één uur onscherp. De app zelf rekent exact in Europe/Brussels.

**Bekende beperkingen** (bewust eenvoudig gehouden, geen Cloud Functions): de cellen worden op het toestel berekend en de regels kunnen niet bewijzen dat ze uit echte GPS komen. Een speler die de client aanpast, kan dus valsspelen; daarvoor is het een vriendenspel. De opgeslagen weekuitslag wordt door een groepslid geschreven en is niet cryptografisch bewezen. Een groep kan nog niet worden verwijderd en de eigenaar kan niet vertrekken. Wie door de eigenaar verwijderd wordt, kan met een nog actieve link terugkeren; daarom trekt de app bij verwijderen alle uitnodigingen in. Het aantal leden is niet in de regels begrensd. Strengere handhaving (servergegenereerde uitslagen, plausibiliteitscontrole) vraagt Cloud Functions op het Blaze-plan.

### Nog nodig in Firebase

Voor Spelen is **geen nieuwe dienst en geen nieuwe index** nodig (er zijn geen collectiegroep- of samengestelde queries). Wel:

1. **Firestore-regels deployen.** Dit is de enige verplichte stap: zonder de nieuwe `firestore.rules` krijgt Spelen "permission-denied" en blijft alles veilig geweigerd.
   ```bash
   npx firebase-tools deploy --only firestore:rules --project hack-the-future-92568
   ```
   Er is door deze wijziging nog **niets gedeployd** en er is niets tegen het echte project getest; alle tests draaien op de emulator.
2. Authentication met **Google** en **Anonymous** staat al aan (zie boven). Gasten verliezen hun groepen als ze uitloggen zonder te koppelen aan Google.
3. **Authorized domains**: de uitnodigingslinks wijzen naar het domein waarop de app draait. Voeg dat hostingdomein toe zoals eerder beschreven.
4. GPS vereist een veilige context: `http://localhost` en `http://127.0.0.1` werken, op het web moet de app via **HTTPS** draaien (Firebase Hosting doet dat standaard).

### Tests voor Spelen

```bash
npm run test:unit      # weekgrenzen (incl. zomer-/wintertijd), raster, spelregels, scoring, tracker
npm run test:emulator  # inclusief Firestore-regels voor Spelen (play.rules) en de browserflow (play.browser)
npm run test:play      # alleen de browserflow; vereist draaiende emulators (npm run emulators)
```

De browsertest gebruikt twee afzonderlijke browsersessies (eigenaar en uitgenodigde speler) en een **nep-GPS** met bepaalde posities en tijdstippen. Daarmee zijn toestemming, start/stop, celtelling, het negeren van sprongen, synchronisatie, uitnodigen, deelnemen, toegangsweigering voor buitenstaanders, weekafsluiting (met geseede vorige weken), verwijderen en het intrekken van links gedekt. Echte GPS in een telefoon en de echte Firestore-regels in het live project zijn niet automatisch getest; probeer ze handmatig: wandel enkele minuten buiten met Spelen open en controleer dat de cellen verschijnen.
