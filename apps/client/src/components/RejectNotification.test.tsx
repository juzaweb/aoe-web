import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { RejectCode } from '@chien-quoc/shared';
import { RejectNotification } from './RejectNotification.js';

describe('RejectNotification live region (UIX-08)', () => {
  it('is announced politely and keeps its icon out of the accessibility tree', () => {
    const html = renderToString(
      <RejectNotification message="Insufficient wood" code={RejectCode.RESOURCE} seq={1} />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('Insufficient wood');
    expect(html).toContain('data-reject-notification');
  });

  it('carries a sequence number so the same message announces twice', () => {
    const first = renderToString(<RejectNotification message="Insufficient wood" code={null} seq={1} />);
    const second = renderToString(<RejectNotification message="Insufficient wood" code={null} seq={2} />);

    expect(first).toContain('data-reject-seq="1"');
    expect(second).toContain('data-reject-seq="2"');
    // A different sequence means a different node key, which is what forces the
    // live region to be re-announced for identical text.
    expect(first).not.toEqual(second);
  });

  it('does not swallow map clicks: it carries no control', () => {
    const html = renderToString(<RejectNotification message="x" code={null} seq={3} />);

    // The toast lives in the `pointer-events-none` stack. It has nothing to
    // press, so it must stay transparent to clicks instead of becoming a dead
    // zone over the map for the 3.5 s it is visible.
    expect(html).not.toContain('pointer-events-auto');
    expect(html).not.toContain('<button');
  });
});

describe('re-announcement mechanism (UIX-08)', () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'RejectNotification.tsx'),
    'utf8'
  );

  it('remounts the live region for every new sequence number', () => {
    // `key` is the actual mechanism: a polite region whose markup did not change
    // is not re-read, and "insufficient wood" twice in a row is normal play.
    // Rendering cannot observe a remount here, so the wiring is asserted at the
    // source — the same gate this suite uses for the other Tailwind-only fixes.
    expect(source).toMatch(/key=\{seq\}/);
  });
});
