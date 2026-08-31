// Todo el contacto con el backend (Apps Script + Google Sheet).
// Mantiene la cola offline que ya tenía la versión anterior.

export const URL_APP =
  'https://script.google.com/macros/s/AKfycbyXtWBPgti9NjI81G0Ce8YmnaSsHAHd_MKNSY3ixm8uaS0pE6P6yPPqiVxrY1i4FOJbLQ/exec';

const COLA = 'cola_pendiente';

function conTimeout(url, opciones = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opciones, signal: ctrl.signal })
    .then(r => { clearTimeout(t); return r.json(); })
    .catch(err => { clearTimeout(t); throw err; });
}

export function leerCola() {
  try { return JSON.parse(localStorage.getItem(COLA) || '[]'); } catch { return []; }
}
function guardarCola(cola) {
  try { localStorage.setItem(COLA, JSON.stringify(cola)); } catch {}
}

// POST. Si no hay red, guarda en la cola y responde ok/offline.
export function llamar(body) {
  const payload = { cliente_hora: new Date().toISOString(), ...body };
  return conTimeout(URL_APP, { method: 'POST', body: JSON.stringify(payload) }).catch(() => {
    guardarCola([...leerCola(), payload]);
    return { ok: true, offline: true, mensaje: 'Sin conexión: guardado en el celular.' };
  });
}

export function consultar(action, extra = '') {
  return conTimeout(URL_APP + '?action=' + action + extra).catch(() => ({ ok: false, offline: true }));
}

// Envía la cola de a uno, en orden.
export function vaciarCola(alTerminar) {
  const cola = leerCola();
  if (!cola.length) return Promise.resolve(0);
  return conTimeout(URL_APP, { method: 'POST', body: JSON.stringify(cola[0]) })
    .then(() => {
      const resto = leerCola().slice(1);
      guardarCola(resto);
      if (alTerminar) alTerminar(resto.length);
      return vaciarCola(alTerminar);
    })
    .catch(() => cola.length);
}
