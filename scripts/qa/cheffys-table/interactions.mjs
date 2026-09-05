const { chromium } = await import(process.env.TABLE_PLAYWRIGHT_MODULE || 'playwright');
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const output = process.env.TABLE_QA_OUTPUT || join(tmpdir(), 'cheffys-table-qa');
const url = process.env.TABLE_QA_URL || 'http://127.0.0.1:5188/cheffys-table';
await fs.mkdir(join(output, 'screenshots'), { recursive: true });
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname))
  throw Error('Interaction fixtures require a local Vite server.');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write']
});
const page = await context.newPage(),
  results = [];
await page.route('**/src/lib/cheffys-table/zap.ts*', (route) =>
  route.fulfill({
    contentType: 'application/javascript',
    body: `import {cheffyDraft,openCheffy} from '/src/lib/stores/cheffyChat.ts'; let calls=0; export const zapKitchen={async findRecipes(){calls++; if(calls===1)throw new Error('QA offline'); if(calls===2)return []; return [{title:'Roasted tomato and chickpea bowl',url:'/recipe/qa-fixture',image:'/game/pantry-atlas.png',creator:'QA kitchen'}];},askCheffy(run){cheffyDraft.set('Turn these ingredients into dinner: '+run.ingredients.join(', '));openCheffy();}};`
  })
);
const button = (name) => page.getByRole('button', { name, exact: true });
const check = (name) => {
  results.push(name);
  console.log(`PASS ${name}`);
};
async function begin() {
  await page.getByRole('button', { name: /^Cook for / }).click();
}
async function make() {
  for (const name of ['Tomato', 'Sourdough', 'Olive oil']) await button(`Add ${name}`).click();
  await button('To the stove').click();
  await page.getByRole('button', { name: /^Assemble/ }).click();
  await page.getByRole('slider').press('Home');
  await button('Plate it').click();
  await button('On toast').click();
  await button('Lemon').click();
}
async function serve() {
  await page.getByRole('button', { name: /^Serve (Maya|Theo|Jules|Robin|Alex)$/ }).click();
  await page.getByText('points on the pass', { exact: true }).waitFor();
}
async function complete() {
  for (let i = 0; i < 3; i++) {
    await begin();
    await make();
    await serve();
    await button(i === 2 ? 'Close the kitchen' : 'Next guest').click();
  }
  await page.getByRole('heading', { name: 'Kitchen closed.', exact: true }).waitFor();
}
try {
  await page.goto(url);
  await button('Open the kitchen').click();
  await begin();
  await button('Add Tomato').focus();
  await button('Add Tomato').press('i');
  await page.getByRole('dialog', { name: 'Tomato' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    'Add Tomato'
  );
  check('Keyboard ingredient inspection, Escape and restored focus');
  await button('Add Tomato').press('Enter');
  assert.equal(await button('Remove Tomato').getAttribute('aria-pressed'), 'true');
  await button('Remove Tomato').click();
  await button('Add Tomato').dragTo(
    page.getByRole('complementary', { name: 'Your dish and next action' })
  );
  assert.equal(await button('Remove Tomato').getAttribute('aria-pressed'), 'true');
  check('Optional drag-to-board plus keyboard selection');
  await button('Remove Tomato').click();
  const target = await button('Add Tomato').boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(620);
  await page.mouse.up();
  await page.getByRole('dialog', { name: 'Tomato' }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await button('Add Tomato').getAttribute('aria-pressed'), 'false');
  check('Long press opens a note without adding the ingredient');
  await button('Pause and kitchen settings').click();
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('dialog')), true);
  }
  check('Native sheet focus containment');
  await page.getByLabel('Kitchen sounds', { exact: true }).check();
  assert.equal(await page.evaluate(() => localStorage.getItem('cheffy-table-sound')), 'on');
  await page.getByLabel('Kitchen sounds', { exact: true }).uncheck();
  await page.getByLabel('Haptics on supported devices', { exact: true }).check();
  assert.equal(await page.evaluate(() => localStorage.getItem('cheffys-table-haptics')), 'on');
  await page.getByLabel('Reduce motion', { exact: true }).check();
  assert.equal(await page.locator('.table-world').getAttribute('data-reduced'), 'true');
  await page.getByLabel('Kitchen lighting', { exact: true }).selectOption('dark');
  assert.equal(await page.locator('html').getAttribute('class'), 'dark');
  await page.getByLabel('Kitchen lighting', { exact: true }).selectOption('light');
  await page.keyboard.press('Escape');
  check('Sound/haptics preferences, reduced motion and Zap theme controls');
  await button('Add Tomato').click();
  await page.getByRole('link', { name: 'Back to Zap', exact: true }).click();
  await page.getByRole('dialog', { name: 'Leave this kitchen?' }).waitFor();
  await button('Keep cooking').click();
  assert.equal(await button('Remove Tomato').getAttribute('aria-pressed'), 'true');
  check('Back navigation preserves a plate when cancelled');
  await page.getByRole('link', { name: 'Back to Zap', exact: true }).click();
  await button('Back to Zap').click();
  await page.waitForURL('**/explore');
  assert.equal(
    await page.getByRole('textbox', { name: 'Search recipes, tags, or users...' }).count(),
    1
  );
  check('Leaving restores the Zap navigation shell');
  await page.goto(url);
  await page.getByRole('button', { name: /^Cook for / }).waitFor();
  await context.setOffline(true);
  await complete();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('cheffys-table:history:v1:guest') || '[]')
  );
  assert.equal(stored.length, 1);
  await page.screenshot({ path: join(output, 'screenshots', 'offline-finale.png') });
  check('Offline three-guest completion saves exactly one guest service');
  await context.setOffline(false);
  await button('Find recipes').click();
  await page.getByText('Couldn’t reach Zap recipes.', { exact: false }).waitFor();
  check('Recipe discovery failure keeps the finale playable');
  await button('Find recipes').click();
  await page.getByText('No close match today.', { exact: false }).waitFor();
  check('Recipe discovery empty state');
  await button('Find recipes').click();
  await page.getByRole('link', { name: /Roasted tomato and chickpea bowl/ }).waitFor();
  await page.screenshot({ path: join(output, 'screenshots', 'recipe-success-fixture.png') });
  check('Recipe discovery success renders recipe image, creator and link');
  await button('Share result').click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(text.includes('Three guests fed.') && text.includes('/cheffys-table'));
  check('Result card copies useful text without posting');
  await button('Make dinner with Cheffy').click();
  await page.waitForTimeout(3000);
  await page.getByRole('heading', { name: 'Sign in to cook with Cheffy' }).waitFor();
  const draft = await page.evaluate(async () => {
    const { cheffyDraft } = await import('/src/lib/stores/cheffyChat.ts');
    let value;
    const stop = cheffyDraft.subscribe((v) => (value = v));
    stop();
    return value;
  });
  assert.ok(draft.includes('Tomato'));
  await page.screenshot({ path: join(output, 'screenshots', 'cheffy-handoff.png') });
  check('Cheffy opens its sign-in gate on /cheffys-table and preserves the unsent dinner draft');
  // The following identities are synthetic public keys with no signer. No signed events can be published.
  await page.evaluate(async () => {
    const { userPublickey } = await import('/src/lib/nostr.ts');
    userPublickey.set('a'.repeat(64));
  });
  await page.getByRole('button', { name: /^Cook for / }).waitFor();
  // Close the messenger if it is still open so it cannot obscure kitchen controls.
  const closeChat = page.getByRole('button', { name: /Close.*Cheffy|Close chat/ });
  if (await closeChat.count()) await closeChat.first().click();
  await page.evaluate(async () => {
    const { closeCheffy } = await import('/src/lib/stores/cheffyChat.ts');
    closeCheffy();
  });
  await complete();
  await page.getByRole('button', { name: 'Service Book', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Your Service Book' }).waitFor();
  await button('Sync now').click();
  await page
    .getByText('Try Sync now when your connection and sign-in are ready.', { exact: false })
    .waitFor();
  check('Missing signer shows an honest sync failure while keeping identity-local history');
  await page.keyboard.press('Escape');
  await button('Cook another service').click();
  await begin();
  await make();
  await page.getByRole('button', { name: /^Serve Maya$/ }).click();
  await page.evaluate(async () => {
    const { userPublickey } = await import('/src/lib/nostr.ts');
    userPublickey.set('b'.repeat(64));
  });
  await page.waitForTimeout(1200);
  assert.equal(await page.getByText('points on the pass', { exact: true }).count(), 0);
  assert.equal(await page.locator('[aria-label="0 service points"]').count(), 1);
  const savedA = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('cheffys-table:history:v1:' + 'a'.repeat(64)) || '[]')
  );
  assert.equal(savedA.length, 1);
  check('Account switch during serving discards stale work and preserves the prior account book');
  await button('Pause and kitchen settings').click();
  await button('Today’s Table').click();
  const roster1 = await page.locator('.tickets').innerText();
  await begin();
  await button('Add Tomato').click();
  await button('Pause and kitchen settings').click();
  await button('New service').click();
  await button('Keep cooking').click();
  assert.equal(await button('Remove Tomato').getAttribute('aria-pressed'), 'true');
  await button('Pause and kitchen settings').click();
  await button('New service').click();
  await button('Today’s Table').click();
  assert.equal(await page.locator('.tickets').innerText(), roster1);
  check('Restart confirmation and deterministic Daily guest tickets');
  await fs.writeFile(join(output, 'interaction-results.json'), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
