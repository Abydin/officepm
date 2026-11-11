import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './app/App';
import { createQueryClient } from './app/query-client';
import { createAppRouter } from './app/router';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <App client={createQueryClient()} router={createAppRouter()} />
  </StrictMode>,
);
