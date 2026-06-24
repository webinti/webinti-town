import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// PWA : enregistre le service worker (cache des assets statiques uniquement,
// jamais le temps réel). En dev (HMR), on ne l'enregistre pas.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* PWA optionnelle : on ignore tout échec d'enregistrement */
    });
  });
}

