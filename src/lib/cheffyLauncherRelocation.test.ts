/**
 * A2: the floating Cheffy launcher was retired and its entry point moved
 * into the header IntelligenceMenu as an "Ask Cheffy" item that opens the
 * floating messenger in place (openCheffy), not the full /cheffy page.
 *
 * No Svelte component-test harness in this repo (see vitest.config.ts) —
 * these are source scans, the same style as the note-review
 * removal-completeness tests.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const INTEL = 'src/components/IntelligenceMenu.svelte';
const LAYOUT = 'src/routes/+layout.svelte';
const MESSENGER = 'src/components/CheffyMessenger.svelte';

describe('A2 — header "Ask Cheffy" item', () => {
  const src = readFileSync(INTEL, 'utf8');

  it('opens the floating messenger via openCheffy (not a /cheffy navigation)', () => {
    expect(src).toContain("import { openCheffy } from '$lib/stores/cheffyChat'");
    expect(src).toContain('action: openCheffy');
    // The item activates through the action branch, and the menu still
    // supports href items (Sous Chef, Nourish).
    expect(src).toContain('if (item.action) item.action()');
    expect(src).toContain('activate(item)');
  });

  it('is labeled "Ask Cheffy" — no full-page "Cheffy" item survives', () => {
    expect(src).toContain("label: 'Ask Cheffy'");
    expect(src).not.toContain("label: 'Cheffy'"); // old full-page label gone
    // The old item's href navigation to /cheffy is no longer wired as a
    // menu item (the messenger keeps its own in-panel full-page action).
    expect(src).not.toContain("href: '/cheffy'");
  });
});

describe('A2 — launcher fully removed, no orphans', () => {
  it('the CheffyLauncher component file is deleted', () => {
    expect(existsSync('src/components/CheffyLauncher.svelte')).toBe(false);
  });

  it('the layout no longer imports or renders the launcher, but keeps the messenger', () => {
    const layout = readFileSync(LAYOUT, 'utf8');
    expect(layout).not.toContain('CheffyLauncher');
    expect(layout).toContain('<CheffyMessenger />'); // messenger stays, still showCheffy-gated
  });

  it('no launcher DOM/id/z-index references remain in the messenger', () => {
    const messenger = readFileSync(MESSENGER, 'utf8');
    expect(messenger).not.toContain('cheffy-launcher-btn');
    expect(messenger).not.toContain('cheffy-launcher');
  });

  it('close-focus falls back to the stable Intelligence trigger when the opener is detached', () => {
    // The IntelligenceMenu "Ask Cheffy" item unmounts on selection, so
    // prevFocus is disconnected by close time — focus must not fall to
    // <body>. The header trigger (.zh-intelligence-btn) is the fallback.
    const messenger = readFileSync(MESSENGER, 'utf8');
    expect(messenger).toContain('prevFocus.isConnected');
    expect(messenger).toContain('.zh-intelligence-btn');
    // And that trigger actually exists in the header with that class.
    expect(readFileSync('src/components/Header.svelte', 'utf8')).toContain('zh-intelligence-btn');
  });

  it('no source file references the launcher component or its class', () => {
    for (const file of [INTEL, LAYOUT, MESSENGER]) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toContain('CheffyLauncher');
      expect(src, file).not.toContain('.cheffy-launcher');
    }
  });
});
