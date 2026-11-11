import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { validateLayout } from '@/nav/validate';
import { GRID } from '@/nav/grid';
import { initMaterials } from '@/three/materials';
import { primeCache } from '@/nav/astar';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/config/chain';

const queryClient = new QueryClient();

// The layout validator runs at startup — a bad layout fails loudly, not silently.
const errs = validateLayout(GRID);
if (errs.length) {
  const el = document.createElement('div');
  el.style.cssText = 'font-family:monospace;padding:24px;white-space:pre-wrap;color:#d64545';
  el.textContent = 'Layout validation failed:\n\n' + errs.join('\n');
  document.body.appendChild(el);
  throw new Error(errs.join('\n'));
}
initMaterials();
primeCache();

import { ErrorBoundary } from '@/ui/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
