import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router';
import { Root } from './Root';
import './styles/tokens.css';
import './styles/global.css';

// `npm run build:static` makes a single file that opens without a server, so routes live after "#".
const Router = import.meta.env.MODE === 'static' ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <Root />
    </Router>
  </StrictMode>,
);
