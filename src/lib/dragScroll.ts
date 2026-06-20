/**
 * Svelte action: mouse drag-to-scroll for horizontal overflow containers.
 *
 * Touch devices already get native pan via `touch-pan-x`; this adds the same
 * feel for mouse users. Drag events are tracked on `document` so the scroll
 * continues even if the pointer leaves the container mid-drag.
 *
 * Cursor strategy: we never set `cursor: grab` on the node itself because it
 * inherits down to every child (breaking pointer cursors on avatars, links,
 * etc). Instead we only set `cursor: grabbing` on `document.body` for the
 * duration of an active drag — child cursor declarations are unaffected at
 * rest and overridden globally only while the user is holding down.
 *
 * Smooth-scroll: `scroll-behavior: smooth` on the container would make direct
 * `scrollLeft` writes feel elastic / laggy. We temporarily override it to
 * `auto` during the drag and restore it on release.
 *
 * Click suppression: if the pointer moved far enough to be a drag, the
 * subsequent click event is eaten in capture phase so child links / buttons
 * don't accidentally navigate.
 */
export function dragScroll(node: HTMLElement) {
  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;
  let hasDragged = false;
  const DRAG_THRESHOLD = 5;

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    // Prevent the browser from starting text selection or other default
    // mouse-press actions on the container and its children.
    e.preventDefault();
    isDown = true;
    hasDragged = false;
    startX = e.pageX;
    scrollLeft = node.scrollLeft;
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
    node.scrollLeft = scrollLeft + dx;
  }

  function onDocMouseUp() {
    isDown = false;
    node.style.scrollBehavior = '';
    node.style.userSelect = '';
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mouseup', onDocMouseUp);
  }

  // Capture-phase: if the pointer moved enough to be a drag, eat the click so
  // child links and buttons don't fire.
  function onClickCapture(e: MouseEvent) {
    if (hasDragged) {
      e.stopPropagation();
      e.preventDefault();
      hasDragged = false;
    }
  }

  // Prevent the browser's native image/element drag-and-drop from firing when
  // the user holds down on an <img> or other draggable child (avatars, cards).
  function onDragStart(e: DragEvent) {
    e.preventDefault();
  }

  node.addEventListener('mousedown', onMouseDown);
  node.addEventListener('dragstart', onDragStart);
  node.addEventListener('click', onClickCapture, true);

  return {
    destroy() {
      node.removeEventListener('mousedown', onMouseDown);
      node.removeEventListener('dragstart', onDragStart);
      node.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('mousemove', onDocMouseMove);
      document.removeEventListener('mouseup', onDocMouseUp);
      document.body.style.cursor = '';
    }
  };
}
