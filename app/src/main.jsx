import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/emma_tracker/service-worker.js')
      .then(registro => {
        // Chequear si hay una versión nueva cada vez que se vuelve a la app
        // (en vez de depender de que alguien la cierre y la abra de nuevo).
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) registro.update().catch(() => {});
        });
        setInterval(() => registro.update().catch(() => {}), 5 * 60 * 1000);
      })
      .catch(err => console.log('Service worker', err));
  });

  // Apenas el navegador activa una versión nueva del service worker, recargar
  // sola la página para que se vea al toque (evita tener que cerrar y volver
  // a abrir la app para que se actualice).
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    window.location.reload();
  });
}
