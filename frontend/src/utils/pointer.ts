// Tracks the latest pointer position so components can tell whether the cursor
// is currently inside them even when React's mouseenter/mouseleave boundary
// events did not fire (e.g. a modal overlay appearing/disappearing under a
// stationary cursor). Used by the numeric-key overlay shortcut.

export const pointer = { x: -1, y: -1 };

if (typeof window !== 'undefined') {
  window.addEventListener(
    'mousemove',
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    },
    { passive: true },
  );
}

export function isPointerInside(rect: DOMRect | null | undefined): boolean {
  if (!rect) return false;
  return (
    pointer.x >= rect.left &&
    pointer.x <= rect.right &&
    pointer.y >= rect.top &&
    pointer.y <= rect.bottom
  );
}
