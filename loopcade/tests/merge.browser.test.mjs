import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium, expect} from '@playwright/test';

let browser;
const origin = 'http://localhost:8000';
const dist = new URL('../dist/', import.meta.url);
before(async () => { browser = await chromium.launch({headless: true}); });
after(async () => { await browser?.close(); });

// Serve the real frontend without touching the user's Firebase database or server.
async function openApp({cloud = false, localActivities = []} = {}) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await context.addInitScript(items => {
    if (!localStorage.getItem('merge-test-seeded')) {
      localStorage.setItem('loopcade-activities', JSON.stringify(items));
      localStorage.setItem('merge-test-seeded', 'true');
    }
  }, localActivities);
  await context.route(`${origin}/**`, async route => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    if (name === 'firebase-config.mjs') return route.fulfill({contentType: 'text/javascript', body:
      `export const firebaseConfig={};export const emulatorConfig={enabled:false};
       export const FIREBASE_SDK_VERSION='13.4.0';export const firebaseIsConfigured=()=>false;`});
    if (cloud && name === 'storage.mjs') return route.fulfill({contentType: 'text/javascript', body: `
      let state={configured:true,status:'loading',user:null,activities:[],error:'',
        preferences:{preferredMode:'run',preferredDistance:7000}};
      const listeners=[];
      export const getStorageState=()=>state;
      export const storageIdentity=()=>state.user?.uid||null;
      export const subscribeStorage=fn=>{listeners.push(fn);fn(state);return()=>{};};
      export const canSaveActivities=()=>state.status==='ready'&&!!state.user;
      export const readLocalActivities=()=>[];
      globalThis.switchTestUser=(uid,preferredDistance=7000)=>{
        state={...state,status:'ready',user:uid?{uid,isAnonymous:true}:null,activities:[],
          preferences:{preferredMode:'run',preferredDistance}};
        listeners.forEach(fn=>fn(state));
      };
      export const initializeStorage=()=>new Promise(resolve=>setTimeout(()=>{
        globalThis.switchTestUser('test-owner');resolve();
      },300));
      export const savePreferences=async()=>{};
      export const saveActivity=async()=>{};
      export const saveReflection=async()=>{};
      export const signInWithGoogle=async()=>{};
      export const signInAsGuest=async()=>{};
      export const linkGuestToGoogle=async()=>{};
      export const signOutUser=async()=>globalThis.switchTestUser(null);
      export const migrateLocalActivities=async()=>{};
    `});
    try {
      const body = await readFile(new URL(name, dist));
      const contentType = /\.m?js$/.test(name) ? 'text/javascript' : name.endsWith('.html') ? 'text/html'
        : name.endsWith('.css') ? 'text/css' : name.endsWith('.json') ? 'application/json' : 'application/octet-stream';
      await route.fulfill({body, contentType});
    } catch { await route.fulfill({status: 404, body: ''}); }
  });
  await page.goto(origin);
  await expect(page.locator('#start-run')).toBeEnabled({timeout: 30000});
  return {context, page, errors};
}

test('merge: new map controls, scenery, local activity and reflection survive reload', {timeout: 90000}, async () => {
  const {context, page, errors} = await openApp();
  try {
    await expect(page).toHaveTitle(/plan2run/);
    await expect(page.locator('input[name=scenery]')).toHaveCount(6);
    await expect(page.locator('#start-marker')).toBeVisible();
    await page.locator('#zoom-in').click();
    await page.locator('#zoom-out').click();
    await page.locator('#map-fit').click();
    await page.locator('#pick-start').click();
    await expect(page.locator('#pick-start')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#map').press('Escape');
    await expect(page.locator('#pick-start')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#start-place').click();
    await page.locator('#place-search').fill('Sint-Pietersplein');
    await page.locator('[data-loc]').first().click();
    await expect(page.locator('#place-label')).toContainText('Sint-Pietersplein');
    await page.locator('input[name=scenery][value=nature]').check();
    await page.locator('input[name=scenery][value=architecture]').check();
    await page.locator('#generate').click();
    await expect(page.locator('#start-run')).toBeEnabled({timeout: 30000});
    await expect(page.locator('#route-matches')).toContainText('van 2 voorkeuren');
    await page.locator('#start-run').click();
    const ongoing = await page.evaluate(() => JSON.parse(localStorage.getItem('loopcade-ongoing')));
    assert.equal(ongoing.ownerUid, 'local');
    assert.deepEqual(ongoing.requested, ['nature', 'architecture']);
    await page.reload();
    await expect(page.locator('#start-run')).toContainText('Rondje bekijken', {timeout: 30000});
    await expect(page.locator('input[name=scenery][value=nature]')).toBeChecked();
    await expect(page.locator('#route-matches')).toContainText('van 2 voorkeuren');
    await page.locator('#start-run').click();
    await page.locator('#finish').click();
    await page.locator('#note').fill('Merge-test: mooi park.');
    await page.locator('#save-note').click();
    await expect(page.locator('#dialog')).not.toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('loopcade-activities'))[0]);
    assert.equal(saved.note, 'Merge-test: mooi park.');
    assert.deepEqual(saved.requested, ['nature', 'architecture']);
    assert.equal(saved.matches.length, 2);
    assert.deepEqual(saved.path[0], saved.path.at(-1));
    await page.reload();
    await page.locator('[data-page=activities]').click();
    await expect(page.locator('[data-note]')).toHaveCount(1);
    await page.locator('[data-note]').click();
    await expect(page.locator('#note')).toHaveValue('Merge-test: mooi park.');
    await page.locator('#dialog-close').click();
    await page.locator('[data-page=friends]').click();
    await expect(page.locator('#export-card')).toBeVisible();
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('merge: delayed session restore preserves active owner; switching accounts clears it', {timeout: 60000}, async () => {
  const {context, page, errors} = await openApp({cloud: true});
  try {
    await expect(page.locator('#account-status')).toHaveText('Gastaccount');
    await expect(page.locator('#distance')).toHaveValue('7');
    await page.locator('input[name=scenery][value=river]').check();
    await page.locator('#generate').click();
    await expect(page.locator('#start-run')).toBeEnabled({timeout: 30000});
    await page.locator('#start-run').click();
    const original = await page.evaluate(() => JSON.parse(localStorage.getItem('loopcade-ongoing')));
    assert.equal(original.ownerUid, 'test-owner');
    await page.reload();
    await expect(page.locator('#start-run')).toContainText('Rondje bekijken', {timeout: 30000});
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('loopcade-ongoing')).id), original.id);
    await expect(page.locator('input[name=scenery][value=river]')).toBeChecked();
    await page.evaluate(() => globalThis.switchTestUser('other-owner', 3000));
    await expect(page.locator('#start-run')).toContainText('Start rondje');
    await expect(page.locator('#distance')).toHaveValue('3');
    assert.equal(await page.evaluate(() => localStorage.getItem('loopcade-ongoing')), 'null');
    await expect(page.locator('input[name=scenery][value=river]')).not.toBeChecked();
    await expect(page.locator('#start-run')).toBeEnabled({timeout: 30000});
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
