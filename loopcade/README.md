# Loopcade — Firebase Authentication en Firestore

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

AI, transcriptie, cloudaudio en een sociale backend vallen bewust buiten deze implementatie.
