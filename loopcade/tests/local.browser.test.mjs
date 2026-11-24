import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {chromium, expect} from '@playwright/test';

let browser, server, origin;
before(async () => {
  const results = resolve('test-results');
  await mkdir(results, {recursive: true});
  const folder = await mkdtemp(join(results, 'local-demo-'));
  server = spawn('python', ['-u', 'serve.py', '--port', '0', '--db', join(folder, 'test.sqlite3')], {stdio: ['ignore', 'pipe', 'pipe']});
  origin = await new Promise((resolveOrigin, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Lokale testserver startte niet binnen 15 seconden.')), 15000);
    server.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = /plan2run: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolveOrigin(match[1]); }
    });
    server.on('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Testserver stopte met ${code}.`)); });
  });
  browser = await chromium.launch({headless: true});
});
after(async () => { await browser?.close(); server?.kill(); });

async function waitForPlanner(page) {
  await page.waitForURL(`${origin}/local/**`);
  await expect(page.locator('#route-status')).toContainText('Route klaar', {timeout: 30000});
}

test('local demo: sessions, friend feed, route maps, sharing and reflections', {timeout: 90000}, async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${origin}/login.html`);
    await page.locator('#demo').click();
    await waitForPlanner(page);
    await expect(page.locator('#account-name')).toHaveText('Demo-speler');
    await page.locator('[data-page=activities]').click();
    await expect(page.locator('[data-note]')).toHaveCount(2);
    await page.locator('[data-note]').first().click();
    await page.locator('#note').fill('Lokale demo na merge.');
    await page.locator('#save-note').click();
    await expect(page.locator('#dialog')).not.toBeVisible();
    await page.locator('[data-page=friends]').click();
    await expect(page.locator('#feed [data-path]').first()).toBeVisible();
    await page.locator('#feed [data-path]').first().click();
    await expect(page.locator('#friend-map')).toBeVisible();
    await expect.poll(() => page.locator('#friend-map').getAttribute('width')).toBe('860');
    await page.locator('#dialog-close').click();
    await page.locator('#people [data-action=accept]').click();
    await expect(page.locator('#people [data-action=accept]')).toHaveCount(0);
    await page.locator('[data-page=planner]').click();
    await page.locator('input[name=scenery][value=river]').check();
    await page.locator('#generate').click();
    await expect(page.locator('#start-run')).toBeEnabled({timeout: 30000});
    await page.locator('#start-run').click();
    await page.locator('#share-map').check();
    await page.reload();
    await expect(page.locator('#start-run')).toContainText('Rondje bekijken', {timeout: 30000});
    await page.locator('#start-run').click();
    await expect(page.locator('#share-map')).toBeChecked();
    await page.locator('#finish').click();
    await page.locator('#note').fill('Nieuwe run lokaal opgeslagen.');
    await page.locator('#save-note').click();
    await expect(page.locator('#dialog')).not.toBeVisible();
    await page.reload();
    await expect(page.locator('#account-name')).toHaveText('Demo-speler');
    await page.locator('[data-page=activities]').click();
    await expect(page.locator('[data-note]')).toHaveCount(3);
    const state = await page.evaluate(async () => (await fetch('/api/me')).json());
    assert.equal(state.activities[0].note, 'Nieuwe run lokaal opgeslagen.');
    assert.ok(state.activities[0].lines.length);
    await page.locator('.share-toggle input').first().uncheck();
    await expect(page.locator('.share-toggle input').first()).toBeEnabled();
    const changed = await page.evaluate(async () => (await fetch('/api/me')).json());
    assert.equal(changed.activities[0].shared, false);
    await page.locator('#account-button').click();
    await page.locator('#logout').click();
    await page.waitForURL(`${origin}/login.html`);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('local registration: two accounts can request and accept friendship, then log in again', {timeout: 90000}, async () => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
  pages.forEach(page => page.on('pageerror', error => errors.push(error.message)));
  try {
    for (const [index, page] of pages.entries()) {
      await page.goto(`${origin}/login.html`);
      await page.locator('#tab-signup').click();
      await page.locator('#display').fill(`Merge Loper ${index}`);
      await page.locator('#handle').fill(`merge_loper_${index}`);
      await page.locator('#password').fill('Merge-test-wachtwoord');
      await page.locator('#auth-submit').click();
      await waitForPlanner(page);
      await page.locator('[data-page=friends]').click();
    }
    const [alice, bob] = pages;
    await alice.locator('#people-search').fill('merge_loper_1');
    await expect(alice.locator('#suggestions [data-action=request]')).toHaveCount(1);
    await alice.locator('#suggestions [data-action=request]').click();
    await expect(alice.locator('#people')).toContainText('Verzoek verstuurd');
    await bob.locator('#refresh-feed').click();
    await expect(bob.locator('#people [data-action=accept]')).toHaveCount(1);
    await bob.locator('#people [data-action=accept]').click();
    await expect(bob.locator('#people')).toContainText('Merge Loper 0');
    await expect(bob.locator('#people [data-action=accept]')).toHaveCount(0);
    await alice.locator('#refresh-feed').click();
    await expect(alice.locator('#people')).not.toContainText('Verzoek verstuurd');
    await alice.locator('#account-button').click();
    await alice.locator('#logout').click();
    await alice.waitForURL(`${origin}/login.html`);
    await alice.locator('#handle').fill('merge_loper_0');
    await alice.locator('#password').fill('Merge-test-wachtwoord');
    await alice.locator('#auth-submit').click();
    await waitForPlanner(alice);
    await expect(alice.locator('#account-name')).toHaveText('Merge Loper 0');
    assert.deepEqual(errors, []);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('server: modules ignore stale caches and APIs require a session', async () => {
  const context = await browser.newContext();
  try {
    const module = await context.request.get(`${origin}/app.mjs`, {headers: {'If-Modified-Since': 'Wed, 01 Jan 2099 00:00:00 GMT'}});
    assert.equal(module.status(), 200);
    assert.equal(module.headers()['content-type'], 'text/javascript');
    assert.equal((await context.request.get(`${origin}/api/me`)).status(), 401);
    const badOrigin = await context.request.post(`${origin}/api/demo`, {headers: {Origin: 'https://example.com'}, data: {}});
    assert.equal(badOrigin.status(), 403);
  } finally { await context.close(); }
});
