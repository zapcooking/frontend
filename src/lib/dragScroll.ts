/**
 * Svelte action: mouse drag-to-scroll for horizontal overflow containers.
 *
 * Touch devices already get native pan via `touch-pan-x`; this adds the same
 * feel for mouse users. Drag events are tracked on `document` so the scroll
 * continues even if the pointer leaves the container mid-drag.
 *
 * Rubber-band: when dragging past either boundary the content continues to
 * move at RESISTANCE× speed (feels elastic), then springs back on release via
 * a CSS transition — matching the feel of native macOS overscroll. The
 * overshoot is applied via `transform: translateX()` on the node itself;
 * because these containers bleed edge-to-edge (-mx-4) a small shift is
 * visually contained.
 *
 * Cursor strategy: `cursor: grabbing` is set on `document.body` only while
 * actively dragging so child elements (avatars, links) keep their own cursors
 * at rest.
 *
 * Smooth-scroll: `scroll-behavior: smooth` is temporarily overridden to
 * `auto` during drag so `scrollLeft` writes are instantaneous.
 *
 * Click suppression: if the pointer moved far enough to count as a drag, the
 * subsequent click is eaten in capture phase so child links/buttons don't fire.
 */
export function dragScroll(node: HTMLElement) {
  let isDown = false;
  let startX = 0;
  let baseScroll = 0;
  let hasDragged = false;
  let isOvershot = false;
  const DRAG_THRESHOLD = 5;
  const RESISTANCE = 0.2;
  const SPRING = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

  function maxScroll(): number {
    return Math.max(0, node.scrollWidth - node.clientWidth);
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    // Cancel any in-flight spring-back so a new drag starts clean.
    node.style.transition = '';
    node.style.transform = '';
    isDown = true;
    hasDragged = false;
    isOvershot = false;
    startX = e.pageX;
    baseScroll = node.scrollLeft;
    node.style.scrollBehavior = 'auto';
    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup', onDocMouseUp);
  }

  function onDocMouseMove(e: MouseEvent) {
    if (!isDown) return;
    const dx = startX - e.pageX;
    if (Math.abs(dx) > DRAG_THRESHOLD) {
      if (!hasDragged) {
        hasDragged = true;
        document.body.style.cursor = 'grabbing';
      }
    }

    const target = baseScroll + dx;
    const max = maxScroll();

    if (target < 0) {
      node.scrollLeft = 0;
      node.style.transform = `translateX(${-target * RESISTANCE}px)`;
      isOvershot = true;
    } else if (target > max) {
      node.scrollLeft = max;
      node.style.transform = `translateX(${-(target - max) * RESISTANCE}px)`;
      isOvershot = true;
    } else {
      node.scrollLeft = target;
      node.style.transform = '';
      isOvershot = false;
    }
  }

  function onDocMouseUp() {
    isDown = false;
    if (isOvershot) {
      node.style.transition = SPRING;
      node.style.transform = '';
      const cleanup = () => {
        node.style.transition = '';
        node.removeEventListener('transitionend', cleanup);
      };
      node.addEventListener('transitionend', cleanup);
      isOvershot = false;
    }
    node.style.scrollBehavior = '';
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mouseup', onDocMouseUp);
  }

  function onClickCapture(e: MouseEvent) {
    if (hasDragged) {
      e.stopPropagation();
      e.preventDefault();
      hasDragged = false;
    }
  }

  function onDragStart(e: DragEvent) {
    e.preventDefault();
  }

  node.addEventListener('mousedown', onMouseDown);
  node.addEventListener('dragstart', onDragStart);
  node.addEventListener('click', onClickCapture, true);

  return {
    destroy() {
      node.style.transition = '';
      node.style.transform = '';
      node.removeEventListener('mousedown', onMouseDown);
      node.removeEventListener('dragstart', onDragStart);
      node.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('mousemove', onDocMouseMove);
      document.removeEventListener('mouseup', onDocMouseUp);
      document.body.style.cursor = '';
    }
  };
}
