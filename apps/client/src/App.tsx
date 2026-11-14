import React from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { routes } from './routes.js';

/**
 * Route shell. The table itself lives in `routes.tsx` so it can be tested
 * without a DOM; this module only binds it to the browser history.
 */
const router = createBrowserRouter(routes);

export const App: React.FC = () => <RouterProvider router={router} />;
