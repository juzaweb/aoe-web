import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

/**
 * Renders a routed component to HTML for the assertion-only tests.
 *
 * `react-router`'s `<Link>` uses a layout effect for prefetching, which React
 * cannot encode during a server render and warns about. That warning is an
 * artifact of the string renderer, not a defect in these screens, so it is
 * filtered here instead of in every test file that needs a router in scope.
 */
export function renderWithRouter(ui: React.ReactElement, path = '/'): string {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const [first] = args;
    if (typeof first === 'string' && first.includes('useLayoutEffect does nothing on the server')) {
      return;
    }
    originalError(...args);
  };

  try {
    return renderToString(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
  } finally {
    console.error = originalError;
  }
}
