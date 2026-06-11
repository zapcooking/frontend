/**
 * Svelte action: swipe (touch) or drag (mouse) horizontally to page
 * through a fullscreen media viewer. Mirrors the drag rules used by
 * MediaCarousel — armed on pointerdown, engages only on a clearly
 * horizontal pull past a small threshold, captures the pointer once
 * engaged, and swallows the post-drag click so releasing over the
 * image doesn't trigger its click handler.
 *
 * While engaged, the element marked `[data-swipe-target]` inside the
 * node (or the node itself) follows the pointer with a translateX so
 * the gesture feels physical; releasing past the commit threshold
 * fires onNext/onPrev, anything shorter snaps back.
 */

export interface SwipeNavOptions {
  onPrev: () => void;
  onNext: () => void;
  /** Disable when there's only one item to show. */
  enabled?: boolean;
}

const ENGAGE_PX = 8;
const COMMIT_PX = 60;

export function swipeNav(node: HTMLElement, options: SwipeNavOptions) {
  let opts = options;
  let isPointerDown = false;
  let engaged = false;
  let suppressNextClick = false;
  let startX = 0;
  let startY = 0;

  // Let the browser keep handling vertical gestures (scroll/refresh);
  // horizontal pointermove streams stay with us.
  const previousTouchAction = node.style.touchAction;
  node.style.touchAction = 'pan-y';

  function target(): HTMLElement {
    return (node.querySelector('[data-swipe-target]') as HTMLElement) || node;
  }

  function setFollow(dx: number) {
    const el = target();
    el.style.transition = 'none';
    el.style.transform = `translateX(${dx}px)`;
  }

  function snapBack() {
    const el = target();
    el.style.transition = 'transform 200ms ease-out';
    el.style.transform = '';
  }

  function resetFollow() {
    const el = target();
    el.style.transition = 'none';
    el.style.transform = '';
  }

  function handlePointerDown(e: PointerEvent) {
    if (opts.enabled === false) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    isPointerDown = true;
    engaged = false;
    startX = e.clientX;
    startY = e.clientY;
    // No capture yet — a plain click must keep its original target.
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isPointerDown) return;
    // Mouse button released outside our view (e.g. pointerup landed
    // off-element before we captured) — don't resume on re-entry.
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) {
      handlePointerUp(e);
      return;
    }
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!engaged && Math.abs(dx) > ENGAGE_PX && Math.abs(dx) > Math.abs(dy)) {
      engaged = true;
      suppressNextClick = true;
      node.setPointerCapture(e.pointerId);
    }
    if (engaged) setFollow(dx);
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isPointerDown) return;
    isPointerDown = false;
    if (!engaged) return; // plain click — let it through untouched
    engaged = false;
    const dx = e.clientX - startX;
    if (dx <= -COMMIT_PX) {
      resetFollow();
      opts.onNext();
    } else if (dx >= COMMIT_PX) {
      resetFollow();
      opts.onPrev();
    } else {
      snapBack();
    }
  }

  function handleClickCapture(e: MouseEvent) {
    if (suppressNextClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressNextClick = false;
    }
  }

  node.addEventListener('pointerdown', handlePointerDown);
  node.addEventListener('pointermove', handlePointerMove);
  node.addEventListener('pointerup', handlePointerUp);
  node.addEventListener('pointercancel', handlePointerUp);
  node.addEventListener('lostpointercapture', handlePointerUp);
  node.addEventListener('click', handleClickCapture, true);

  return {
    update(next: SwipeNavOptions) {
      opts = next;
    },
    destroy() {
      node.style.touchAction = previousTouchAction;
      node.removeEventListener('pointerdown', handlePointerDown);
      node.removeEventListener('pointermove', handlePointerMove);
      node.removeEventListener('pointerup', handlePointerUp);
      node.removeEventListener('pointercancel', handlePointerUp);
      node.removeEventListener('lostpointercapture', handlePointerUp);
      node.removeEventListener('click', handleClickCapture, true);
    }
  };
}
