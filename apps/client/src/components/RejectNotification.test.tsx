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

  it('stays clickable inside the pointer-events-none stack', () => {
    const html = renderToString(<RejectNotification message="x" code={null} seq={3} />);

    expect(html).toContain('pointer-events-auto');
  });
});
