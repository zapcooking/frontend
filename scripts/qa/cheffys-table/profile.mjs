const { chromium } = await import(process.env.TABLE_PLAYWRIGHT_MODULE || 'playwright');
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const output = process.env.TABLE_QA_OUTPUT || join(tmpdir(), 'cheffys-table-qa');
const url = process.env.TABLE_QA_URL || 'http://127.0.0.1:5188/cheffys-table';
await fs.mkdir(join(output, 'screenshots'), { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [375, 820, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 375 ? 667 : 1000 }
    });
    const page = await context.newPage();
    await page.goto(url);
    await page.getByRole('button', { name: 'Open the kitchen', exact: true }).click();
    await page.getByRole('button', { name: 'Cook for Maya', exact: true }).click();
    for (const name of ['Tomato', 'Sourdough', 'Olive oil'])
      await page.getByRole('button', { name: `Add ${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'To the stove', exact: true }).click();
    await page.getByRole('button', { name: 'Plate it', exact: true }).click();
    const hud = await page.locator('.hud-actions button').evaluateAll((buttons) =>
      buttons.map((b) => {
        const r = b.getBoundingClientRect();
        return { width: r.width, height: r.height };
      })
    );
    assert.ok(hud.every((r) => r.width >= 44 && r.height >= 44));
    const overflow = await page.evaluate(
      () => document.querySelector('.table-world').scrollWidth > innerWidth + 1
    );
    assert.equal(overflow, false);
    await page.screenshot({ path: join(output, 'screenshots', `${width}-profile-plating.png`) });
    const sample = page.evaluate(
      () =>
        new Promise((resolve) => {
          const longTasks = [];
          const observer = new PerformanceObserver((list) =>
            longTasks.push(...list.getEntries().map((e) => e.duration))
          );
          observer.observe({ type: 'longtask', buffered: false });
          const times = [];
          const start = performance.now();
          function frame(now) {
            times.push(now);
            if (now - start < 1900) requestAnimationFrame(frame);
            else {
              observer.disconnect();
              const deltas = times
                .slice(1)
                .map((t, i) => t - times[i])
                .sort((a, b) => a - b);
              resolve({
                frames: times.length,
                p95FrameMs: deltas[Math.floor(deltas.length * 0.95)],
                maxFrameMs: Math.max(...deltas),
                longTasks
              });
            }
          }
          requestAnimationFrame(frame);
        })
    );
    await page.getByRole('button', { name: 'Serve Maya', exact: true }).click();
    const timing = await sample;
    await page.getByText('points on the pass', { exact: true }).waitFor();
    await page.waitForTimeout(3600); // Includes the last finite steam iteration.
    const animatingAfterSettle = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running').length
    );
    results.push({ width, hud, ...timing, animatingAfterSettle });
    await context.close();
  }
  await fs.writeFile(join(output, 'profile-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
