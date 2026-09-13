const { chromium } = await import(process.env.TABLE_PLAYWRIGHT_MODULE || 'playwright');
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output = process.env.TABLE_QA_OUTPUT || join(tmpdir(), 'cheffys-table-qa');
const url = process.env.TABLE_QA_URL || 'http://127.0.0.1:5188/cheffys-table';
await fs.mkdir(join(output, 'screenshots'), { recursive: true });
const browser = await chromium.launch({ headless: true });
const sizes = [
  [375, 667],
  [390, 844],
  [430, 932],
  [768, 1024],
  [1024, 900],
  [1280, 900],
  [1440, 1000]
];
const results = []; // Each invocation reports only the widths it actually exercised.
async function snap(page, name) {
  await page.evaluate(() => (document.getElementById('app-scroll').scrollTop = 0));
  await page.waitForTimeout(650);
  const overflow = await page.evaluate(() => ({
    viewport: innerWidth,
    content: document.querySelector('.table-world').scrollWidth
  }));
  if (overflow.content > overflow.viewport + 1)
    throw Error(`${name} overflows: ${JSON.stringify(overflow)}`);
  await page.screenshot({ path: join(output, 'screenshots', `${name}.png`) });
}
const selected = process.env.TABLE_QA_MIN
  ? sizes.filter((s) => s[0] >= Number(process.env.TABLE_QA_MIN))
  : process.env.TABLE_QA_ONE
    ? sizes.filter((s) => s[0] === Number(process.env.TABLE_QA_ONE))
    : sizes;
try {
  for (const [width, height] of selected)
    for (const dark of [false, true]) {
      const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: width < 700,
        colorScheme: dark ? 'dark' : 'light'
      });
      await context.addInitScript((dark) => {
        localStorage.setItem('nostrcooking_theme', dark ? 'dark' : 'light');
      }, dark);
      const page = await context.newPage();
      const key = `${width}-${dark ? 'dark' : 'light'}`;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(url);
      await page.getByRole('button', { name: 'Open the kitchen', exact: true }).waitFor();
      await snap(page, `${key}-opening`);
      await page.getByRole('button', { name: 'Open the kitchen', exact: true }).click();
      await snap(page, `${key}-arrival`);
      const guestNames = await page.locator('.tickets li > span').allTextContents();
      for (let guest = 0; guest < 3; guest++) {
        await page.getByRole('button', { name: /^Cook for / }).click();
        for (const name of ['Tomato', 'Sourdough', 'Olive oil']) {
          const button = page.getByRole('button', { name: `Add ${name}`, exact: true });
          if (width < 700) await button.tap();
          else await button.click();
        }
        if (guest === 0) {
          await page.getByRole('heading', { name: 'What’s your idea?' }).scrollIntoViewIfNeeded();
          await snap(page, `${key}-pantry`);
        }
        await page.getByRole('button', { name: 'To the stove', exact: true }).click();
        await page.getByRole('button', { name: /^Assemble/ }).click();
        await page.getByRole('slider', { name: 'Cooking time in kitchen minutes' }).press('Home');
        if (guest === 0) await snap(page, `${key}-cook`);
        await page.getByRole('button', { name: 'Plate it', exact: true }).click();
        await page.getByRole('button', { name: 'On toast', exact: true }).click();
        await page.getByRole('button', { name: 'Lemon', exact: true }).click();
        if (guest === 0) await snap(page, `${key}-plating`);
        await page.getByRole('button', { name: /^Serve / }).click();
        await page.getByText('points on the pass', { exact: true }).waitFor();
        if (guest === 0) await snap(page, `${key}-review`);
        await page
          .getByRole('button', {
            name: guest === 2 ? 'Close the kitchen' : 'Next guest',
            exact: true
          })
          .click();
      }
      await page.getByRole('heading', { name: 'Kitchen closed.', exact: true }).waitFor();
      await snap(page, `${key}-finale`);
      const score = await page.locator('.final-score > span').getAttribute('aria-label');
      const ratings = await page
        .locator('.fed-guests .stars')
        .evaluateAll((stars) => stars.map((star) => star.getAttribute('aria-label')));
      await page.getByRole('button', { name: 'Service Book', exact: true }).first().click();
      await page.getByRole('dialog', { name: 'Your Service Book' }).waitFor();
      await snap(page, `${key}-book`);
      const history = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('cheffys-table:history:v2:guest') || '[]')
      );
      if (history.length !== 1) throw Error(`${key}: expected one completed guest service`);
      assert.equal(history[0].run.version, 2);
      assert.equal(new Set(history[0].run.roster).size, 3);
      assert.deepEqual(
        await page
          .locator('.pages article .past-guests > div > span:first-child')
          .allTextContents(),
        guestNames
      );
      assert.equal(
        (await page.locator('.pages article .date > strong').innerText()).trim(),
        `${score} pts`
      );
      assert.deepEqual(
        await page
          .locator('.pages article .past-guests .stars')
          .evaluateAll((stars) => stars.map((star) => star.getAttribute('aria-label'))),
        ratings
      );
      // Reloading must keep the roster that was played, even as a fresh service is randomized.
      await page.reload();
      await page.getByRole('button', { name: /^Cook for / }).waitFor();
      await page.getByRole('button', { name: 'Service Book', exact: true }).first().click();
      await page.getByRole('dialog', { name: 'Your Service Book' }).waitFor();
      assert.deepEqual(
        await page
          .locator('.pages article .past-guests > div > span:first-child')
          .allTextContents(),
        guestNames
      );
      assert.equal(
        (await page.locator('.pages article .date > strong').innerText()).trim(),
        `${score} pts`
      );
      assert.deepEqual(
        await page
          .locator('.pages article .past-guests .stars')
          .evaluateAll((stars) => stars.map((star) => star.getAttribute('aria-label'))),
        ratings
      );
      if (errors.length) throw Error(`${key}: ${errors.join('; ')}`);
      results.push({
        key,
        screens: 8,
        storedServices: history.length,
        guestNames,
        roster: history[0].run.roster,
        score,
        ratings,
        errors
      });
      await fs.writeFile(join(output, 'matrix-results.json'), JSON.stringify(results, null, 2));
      console.log(`${key}: 8 screenshots, service saved, ${errors.length} page errors`);
      await context.close();
    }
} finally {
  await browser.close();
}
