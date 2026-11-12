import { describe, expect, it, vi } from 'vitest';
import {
  FOCUSABLE_SELECTOR,
  activateModalFocus,
  focusableWithin,
  nextFocusIndex
} from './useModalFocus.js';

/**
 * This suite runs in Node, with no jsdom, so the trap is exercised against a
 * hand-rolled document. `activateModalFocus` is written against the parts of the
 * DOM contract it actually uses — `activeElement`, a `defaultView` that carries
 * the key listener, `focus()` and `isConnected` — which a fake can provide.
 */
interface FakeElement {
  label: string;
  isConnected: boolean;
  focus: () => void;
}

interface Harness {
  doc: { readonly activeElement: FakeElement | null };
  container: { tabIndex: number; focus: () => void; querySelectorAll: (selector: string) => unknown };
  controls: FakeElement[];
  state: { activeElement: FakeElement | null };
  listenerCount: () => number;
  press: (key: string, shiftKey?: boolean) => { preventDefault: () => void };
}

function makeHarness(focusableCount: number): Harness {
  const state: { activeElement: FakeElement | null } = { activeElement: null };
  const listeners = new Map<string, EventListener>();

  const doc = {
    get activeElement() {
      return state.activeElement;
    },
    defaultView: {
      addEventListener: (type: string, handler: EventListener) => {
        listeners.set(type, handler);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      }
    }
  };

  const makeElement = (label: string): FakeElement => {
    const element: FakeElement = {
      label,
      isConnected: true,
      focus: () => {
        state.activeElement = element;
      }
    };
    return element;
  };

  const controls = Array.from({ length: focusableCount }, (_, index) =>
    makeElement(`control-${index}`)
  );

  const container = {
    ownerDocument: doc,
    // A plain `div` reports -1 but cannot take focus until the attribute is set.
    tabIndex: -1,
    querySelectorAll: (selector: string) => {
      expect(selector).toBe(FOCUSABLE_SELECTOR);
      return controls;
    },
    focus: () => {
      state.activeElement = container as unknown as FakeElement;
    }
  };

  return {
    doc,
    container,
    controls,
    state,
    listenerCount: () => listeners.size,
    press: (key: string, shiftKey = false) => {
      const handler = listeners.get('keydown');
      if (!handler) throw new Error('the modal installed no key listener');
      const event = { key, shiftKey, preventDefault: vi.fn() };
      handler(event as unknown as KeyboardEvent);
      return event;
    }
  };
}

/** Focus is one element; the opener is the element that had it before the dialog. */
function openerFor(state: { activeElement: FakeElement | null }): FakeElement {
  const opener: FakeElement = {
    label: 'opener',
    isConnected: true,
    focus: () => {
      state.activeElement = opener;
    }
  };
  state.activeElement = opener;
  return opener;
}

describe('useModalFocus — focus in, trap, restore (UIX-09)', () => {
  it('moves focus to the first control when the dialog opens', () => {
    const h = makeHarness(3);
    const opener = openerFor(h.state);

    activateModalFocus(h.container as unknown as HTMLElement, vi.fn());

    expect(h.state.activeElement).toBe(h.controls[0]);
    expect(h.state.activeElement).not.toBe(opener);
  });

  it('falls back to the container when the dialog holds no control', () => {
    const h = makeHarness(0);
    openerFor(h.state);

    activateModalFocus(h.container as unknown as HTMLElement, vi.fn());

    // No tab stop inside, so the container itself becomes the stop.
    expect(h.container.tabIndex).toBe(-1);
    expect(h.state.activeElement).toBe(h.container);
  });

  it('wraps forward from the last control to the first', () => {
    const h = makeHarness(3);
    activateModalFocus(h.container as unknown as HTMLElement, vi.fn());
    h.controls[2].focus();

    const event = h.press('Tab');

    expect(h.state.activeElement).toBe(h.controls[0]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('wraps backwards from the first control to the last', () => {
    const h = makeHarness(3);
    activateModalFocus(h.container as unknown as HTMLElement, vi.fn());
    h.controls[0].focus();

    const event = h.press('Tab', true);

    expect(h.state.activeElement).toBe(h.controls[2]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('walks one control at a time between the ends', () => {
    const h = makeHarness(3);
    activateModalFocus(h.container as unknown as HTMLElement, vi.fn());
    h.controls[0].focus();

    h.press('Tab');
    expect(h.state.activeElement).toBe(h.controls[1]);

    h.press('Tab', true);
    expect(h.state.activeElement).toBe(h.controls[0]);
  });

  it('pulls focus back in when it sits outside the dialog', () => {
    const h = makeHarness(3);
    activateModalFocus(h.container as unknown as HTMLElement, vi.fn());
    // The HUD control behind the overlay, or a browser-managed element.
    h.state.activeElement = null;

    h.press('Tab');

    expect(h.state.activeElement).toBe(h.controls[0]);
  });

  it('consumes Tab even with nothing to focus', () => {
    const h = makeHarness(0);
    activateModalFocus(h.container as unknown as HTMLElement, vi.fn());

    const event = h.press('Tab');

    expect(event.preventDefault).toHaveBeenCalled();
    expect(h.state.activeElement).toBe(h.container);
  });

  it('leaves every other key alone', () => {
    const h = makeHarness(3);
    activateModalFocus(h.container as unknown as HTMLElement, vi.fn());
    h.controls[1].focus();

    const event = h.press('a');

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(h.state.activeElement).toBe(h.controls[1]);
  });

  it('closes on Escape and consumes nothing else', () => {
    const h = makeHarness(2);
    const onClose = vi.fn();
    activateModalFocus(h.container as unknown as HTMLElement, onClose);

    const event = h.press('Escape');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('hands focus back to the opener on teardown', () => {
    const h = makeHarness(2);
    const opener = openerFor(h.state);
    const teardown = activateModalFocus(h.container as unknown as HTMLElement, vi.fn());
    h.controls[1].focus();

    teardown();

    expect(h.state.activeElement).toBe(opener);
    expect(h.listenerCount()).toBe(0);
  });

  it('skips the restore when the opener has unmounted', () => {
    const h = makeHarness(2);
    const opener = openerFor(h.state);
    const teardown = activateModalFocus(h.container as unknown as HTMLElement, vi.fn());
    // The dock row that owned the button is gone (selection cleared mid-dialog).
    opener.isConnected = false;
    h.controls[0].focus();

    teardown();

    expect(h.state.activeElement).toBe(h.controls[0]);
  });
});

describe('useModalFocus — helpers', () => {
  it('reads the focusable controls out of the container', () => {
    const h = makeHarness(4);

    expect(focusableWithin(h.container as unknown as HTMLElement)).toHaveLength(4);
  });

  it('computes the wrap targets', () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(2, 3, false)).toBe(0);
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
    expect(nextFocusIndex(1, 3, true)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
  });
});
