import { useEffect, useRef, type RefObject } from 'react';

/**
 * What a `Tab` press can land on inside a dialog.
 *
 * Disabled controls are deliberately absent: the browser skips them, so a list
 * that includes them would compute a wrap target that cannot take focus and
 * leave the keyboard stuck on the last reachable element.
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

/** Every control inside the dialog, in tab order. */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Where one `Tab` (or `Shift+Tab`) lands, given where focus is now.
 *
 * `currentIndex < 0` means focus is on the container itself — the fallback used
 * when the dialog holds no control — or outside it altogether. Both read as
 * "first element forward, last element backwards", which is what a browser does
 * when focus enters an element from the outside.
 */
export function nextFocusIndex(currentIndex: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (backwards) return currentIndex <= 0 ? count - 1 : currentIndex - 1;
  return currentIndex < 0 || currentIndex >= count - 1 ? 0 : currentIndex + 1;
}

/**
 * The DOM half of `useModalFocus`, kept separate so the trap can be exercised
 * without a renderer (this suite runs in Node, with no jsdom).
 *
 * Returns the teardown that removes the key listener and hands focus back.
 */
export function activateModalFocus(container: HTMLElement, onClose: () => void): () => void {
  const doc = container.ownerDocument;
  const previous = doc.activeElement;
  const returnFocus =
    previous && typeof (previous as HTMLElement).focus === 'function'
      ? (previous as HTMLElement)
      : null;

  // UIX-09: focus moves inside on open, so the keyboard has a way out and a
  // screen reader announces the dialog's contents instead of leaving the
  // listener on the HUD controls sitting behind the overlay.
  const items = focusableWithin(container);
  if (items.length > 0) {
    items[0].focus();
  } else {
    // A dialog whose body is text only still has to take the keyboard: without
    // a tab stop the trap below would have nothing to hold onto.
    container.tabIndex = -1;
    container.focus();
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    // Re-read on every press: a control can become disabled (a busy refresh
    // button, an unaffordable tile) while the dialog stays open.
    const focusable = focusableWithin(container);
    const next = nextFocusIndex(
      focusable.indexOf(doc.activeElement as unknown as HTMLElement),
      focusable.length,
      event.shiftKey
    );
    // Always consumed: a `Tab` the browser handled itself would leave the
    // dialog through the last control, which is the bug this hook exists for.
    event.preventDefault();
    if (next < 0) {
      container.focus();
      return;
    }
    focusable[next].focus();
  };

  const view = doc.defaultView;
  view?.addEventListener('keydown', onKeyDown);

  return () => {
    view?.removeEventListener('keydown', onKeyDown);
    // UIX-09: whoever opened the dialog gets the keyboard back — normally the
    // dock button that opened it. `isConnected` guards the case where the
    // trigger unmounted while the dialog was open (a raid ends, the selection
    // clears), which would otherwise throw on a detached node.
    if (returnFocus?.isConnected) returnFocus.focus();
  };
}

/**
 * UIX-09 / D5: modal behaviour shared by every overlay that covers the map.
 *
 * `isOpen` rather than "is mounted" because one of the callers (the world map)
 * keeps its component mounted and returns `null` while closed, while the
 * spectator window mounts only when it has something to show.
 */
export function useModalFocus<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  isOpen: boolean,
  onClose: () => void
): void {
  // The latest handler, not the one this effect closed over: callers pass
  // inline arrows, and the overlays re-render while open (a reload lands, the
  // stockpile ticks). Keeping the handler in the dependency list would re-run
  // the trap on those renders and yank focus back to the first control
  // mid-interaction.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;
    return activateModalFocus(container, () => onCloseRef.current());
  }, [containerRef, isOpen]);
}
