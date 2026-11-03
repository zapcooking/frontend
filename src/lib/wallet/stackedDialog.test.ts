// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { stackedDialog } from './stackedDialog';
import { walletModalSuspended } from './walletModalStore';

/**
 * Dialogs WalletPanel portals above the wallet modal (recovery-phrase
 * notice, reveal modal): the modal's focus trap must step aside, focus
 * must land in the dialog and stay there, and Escape closes only the
 * stacked dialog.
 */

function dialog(html: string) {
  const node = document.createElement('div');
  node.innerHTML = html;
  document.body.appendChild(node);
  return node;
}
const press = (key: string, shiftKey = false) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = '';
  walletModalSuspended.set(false);
});

describe('stackedDialog', () => {
  it('suspends the wallet modal while open and focuses [data-autofocus]', async () => {
    const opener = dialog('<button id="opener">open</button>').querySelector('button')!;
    opener.focus();
    const node = dialog(
      '<button id="a">Not now</button><button id="b" data-autofocus>Show</button>'
    );

    const action = stackedDialog(node, { onEscape: () => {} });
    expect(get(walletModalSuspended)).toBe(true);
    await Promise.resolve();
    expect(document.activeElement?.id).toBe('b');

    action.destroy();
    expect(get(walletModalSuspended)).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside the dialog and closes it on Escape', async () => {
    const node = dialog('<button id="a">Not now</button><button id="b">Show</button>');
    const onEscape = vi.fn();
    const action = stackedDialog(node, { onEscape });
    await Promise.resolve();
    expect(document.activeElement?.id).toBe('a');

    (node.querySelector('#b') as HTMLElement).focus();
    press('Tab');
    expect(document.activeElement?.id).toBe('a');
    press('Tab', true);
    expect(document.activeElement?.id).toBe('b');

    press('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
    action.destroy();
  });

  it('stays suspended across a hand-off from one stacked dialog to the next', () => {
    const notice = stackedDialog(dialog('<button>x</button>'), { onEscape: () => {} });
    const reveal = stackedDialog(dialog('<button>y</button>'), { onEscape: () => {} });
    notice.destroy();
    expect(get(walletModalSuspended)).toBe(true);
    reveal.destroy();
    expect(get(walletModalSuspended)).toBe(false);
  });
});
