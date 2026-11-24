import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';

let browser, server;
const root = fileURLToPath(new URL('../', import.meta.url));

before(async () => {
  let running = await fetch('http://127.0.0.1:8000').then(() => true).catch(() => false);
  if (!running) {
    server = spawn('python', ['serve.py'], {cwd: root, stdio: 'ignore'});
    for (let attempt = 0; attempt < 50 && !running; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      running = await fetch('http://127.0.0.1:8000').then(() => true).catch(() => false);
    }
  }
  if (!running) throw new Error('Loopcade-server kon niet worden gestart.');
  browser = await chromium.launch({headless: true});
});
after(async () => {
  await browser?.close();
  if (server) server.kill();
});

async function openEmulatorPage(context) {
  await context.route('**/firebase-config.mjs', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const firebaseConfig={apiKey:'demo-api-key',authDomain:'demo-loopcade.firebaseapp.com',projectId:'demo-loopcade',appId:'demo-app-id'};
      export const FIREBASE_SDK_VERSION='13.4.0';
      export const emulatorConfig={enabled:true,authUrl:'http://127.0.0.1:9099',firestoreHost:'127.0.0.1',firestorePort:8080};
      export const firebaseIsConfigured=()=>true;`,
  }));
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:8000');
  await expect(page.locator('#route-status')).toContainText('Route klaar', {timeout: 30000});
  return page;
}

async function guestLogin(page) {
  if (!await page.locator('#guest-login').isVisible()) await page.locator('#account-button').click();
  await page.locator('#guest-login').click();
  await expect(page.locator('#account-status')).toHaveText('Gastaccount', {timeout: 15000});
}

async function currentUid(page) {
  if (!await page.locator('#dialog').isVisible()) await page.locator('#account-button').click();
  const text = await page.locator('#dialog-body').innerText();
  const uid = /UID: ([^\s]+)/.exec(text)?.[1];
  assert.ok(uid, 'UID wordt in de accountdialog getoond');
  await page.locator('#dialog-close').click();
  return uid;
}

test('browser: gast, Google-koppeling, sessieherstel, cloudreflectie, scheiding en migratie', {timeout: 120000}, async () => {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const errors = [];
  const page = await openEmulatorPage(context);
  page.on('pageerror', error => errors.push(error.message));

  await guestLogin(page);
  const firstUid = await currentUid(page);
  await page.reload();
  await expect(page.locator('#account-status')).toHaveText('Gastaccount', {timeout: 15000});
  assert.equal(await currentUid(page), firstUid, 'dezelfde gast-UID wordt hersteld');

  await page.locator('input[name=scenery][value=nature]').check();
  await page.locator('#generate').click();
  await expect(page.locator('#start-run')).toBeEnabled({timeout: 30000});
  await page.locator('#start-run').click();
  const ongoingId = await page.evaluate(() => JSON.parse(localStorage.getItem('loopcade-ongoing')).id);
  await page.reload();
  await expect(page.locator('#start-run')).toContainText('Rondje bekijken', {timeout: 30000});
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('loopcade-ongoing')).id), ongoingId);
  await expect(page.locator('input[name=scenery][value=nature]')).toBeChecked();
  await page.locator('#start-run').click();
  await page.locator('#finish').click();
  await expect(page.locator('#note')).toBeVisible({timeout: 15000});
  await page.locator('#note').fill('Emulator: fijn moment bij de Korenmarkt.');
  await page.locator('#save-note').click();
  await expect(page.locator('#dialog')).not.toBeVisible();
  await expect(page.locator('#toast')).toContainText('Je terugblik is bewaard.');

  await page.locator('[data-page="activities"]').click();
  await expect(page.locator('[data-note]')).toHaveCount(1);
  await page.locator('[data-note]').click();
  await expect(page.locator('#note')).toHaveValue('Emulator: fijn moment bij de Korenmarkt.');
  await page.locator('#dialog-close').click();
  await page.reload();
  await expect(page.locator('#account-status')).toHaveText('Gastaccount', {timeout: 15000});
  await page.locator('[data-page="activities"]').click();
  await expect(page.locator('[data-note]')).toHaveCount(1);

  const saved = await page.evaluate(async () => (await import('/storage.mjs')).getStorageState().activities[0]);
  assert.deepEqual(saved.requested, ['nature'], 'omgevingsvoorkeuren blijven in Firestore bewaard');
  assert.equal(saved.matches[0].key, 'nature');
  assert.ok(saved.path.length > 1, 'de opgeslagen route wordt uit Firestore herladen');

  await page.locator('#account-button').click();
  await page.locator('#logout').click();
  await expect(page.locator('#account-status')).toHaveText('Niet ingelogd', {timeout: 15000});
  await expect(page.locator('[data-note]')).toHaveCount(0);
  await expect(page.locator('#total')).toHaveText('0');

  await guestLogin(page);
  const secondUid = await currentUid(page);
  assert.notEqual(secondUid, firstUid, 'een nieuwe gast krijgt geen gegevens van de vorige gast');
  await page.locator('[data-page="activities"]').click();
  await expect(page.locator('[data-note]')).toHaveCount(0);

  await page.evaluate(() => {
    localStorage.setItem('loopcade-activities', JSON.stringify([{
      id: 'legacy-stable-id', began: 1700000000000, end: 1700000001000, elapsed: 1000,
      mode: 'walk', place: 'Lokaal testpunt', from: 1, meters: 2500, height: 4,
      points: 75, target: 2500, note: 'Lokale notitie', voice: false, path: [[0, 0], [100, 100], [0, 0]],
    }]));
  });
  await page.reload();
  await expect(page.locator('#account-status')).toHaveText('Gastaccount', {timeout: 15000});
  await page.locator('[data-page="activities"]').click();
  await page.locator('#migrate-activities').click();
  await expect(page.locator('#migration-state')).toContainText('1 geïmporteerd · 0 al aanwezig', {timeout: 15000});
  await expect(page.locator('[data-note]')).toHaveCount(1);
  await page.locator('#migrate-activities').click();
  await expect(page.locator('#migration-state')).toContainText('0 geïmporteerd · 1 al aanwezig', {timeout: 15000});
  await expect(page.locator('[data-note]')).toHaveCount(1);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('loopcade-activities')).length), 1, 'lokale bron blijft behouden');

  // Koppel de gast aan een nieuw Google-account in de Auth-emulator.
  await page.locator('#account-button').click();
  const firstPopupPromise = page.waitForEvent('popup');
  await page.locator('#link-google').click();
  const firstPopup = await firstPopupPromise;
  await firstPopup.waitForLoadState('domcontentloaded');
  await firstPopup.getByRole('button', {name: /add new account/i}).click();
  await firstPopup.getByLabel(/display name/i).fill('Emulator Koppeling');
  await firstPopup.getByLabel(/email/i).fill('google-link@example.com');
  await firstPopup.getByRole('button', {name: /sign in with google/i}).click();
  await expect(page.locator('#account-status')).toHaveText('google-link@example.com', {timeout: 15000});
  assert.equal(await currentUid(page), secondUid, 'koppelen behoudt de gast-UID');
  await page.locator('[data-page="activities"]').click();
  await expect(page.locator('[data-note]')).toHaveCount(1, 'gekoppelde activiteiten blijven zichtbaar');

  // Een andere gast mag datzelfde bestaande Google-account niet overnemen.
  await page.locator('#account-button').click();
  await page.locator('#logout').click();
  await expect(page.locator('#account-status')).toHaveText('Niet ingelogd', {timeout: 15000});
  await guestLogin(page);
  const thirdUid = await currentUid(page);
  assert.notEqual(thirdUid, secondUid);
  await page.locator('#account-button').click();
  const secondPopupPromise = page.waitForEvent('popup');
  await page.locator('#link-google').click();
  const secondPopup = await secondPopupPromise;
  await secondPopup.waitForLoadState('domcontentloaded');
  await secondPopup.getByText('google-link@example.com', {exact: false}).click();
  await expect(page.locator('[data-account-error]')).toContainText('bestaat al', {timeout: 15000});
  await expect(page.locator('#account-status')).toHaveText('Gastaccount');
  await expect(page.locator('#existing-google-login')).toBeVisible();

  // Expliciet overschakelen opent het bestaande account zonder samenvoeging.
  const thirdPopupPromise = page.waitForEvent('popup');
  await page.locator('#existing-google-login').click();
  const thirdPopup = await thirdPopupPromise;
  await thirdPopup.waitForLoadState('domcontentloaded');
  await thirdPopup.getByText('google-link@example.com', {exact: false}).click();
  await expect(page.locator('#account-status')).toHaveText('google-link@example.com', {timeout: 15000});
  assert.equal(await currentUid(page), secondUid);
  await page.locator('[data-page="activities"]').click();
  await expect(page.locator('[data-note]')).toHaveCount(1);

  await page.screenshot({path: 'test-results/emulator-activities.png', fullPage: true});
  assert.deepEqual(errors, [], 'geen onverwachte browserfouten');
  await context.close();
});
