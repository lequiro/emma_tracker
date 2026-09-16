// Todo el contacto con el backend (Apps Script + Google Sheet).
// Mantiene la cola offline que ya tenía la versión anterior.

export const URL_APP =
  'https://script.google.com/macros/s/AKfycbyXtWBPgti9NjI81G0Ce8YmnaSsHAHd_MKNSY3ixm8uaS0pE6P6yPPqiVxrY1i4FOJbLQ/exec';

const COLA = 'cola_pendiente';

function conTimeout(url, opciones = {}, ms = 15000) {
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
  try { localStorage.setItem(COLA, JSON.stringify(cola)); } catch { }
}
// Último recurso desde Ajustes: descarta lo que haya quedado pegado en la
// cola offline (p. ej. algo que corrige/borra una fila que ya no existe y
// nunca va a dejar de fallar). Se pierde ese envío puntual a propósito —
// es preferible a que se quede trabado ahí para siempre.
export function descartarCola() {
  guardarCola([]);
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

// Migración única citas/medicamentos/tomas/esquema (localStorage → Sheet).
// Sin cola offline: si falla, la app no marca la migración como hecha y
// reintenta sola en la próxima apertura (fusionar_locales es idempotente
// del lado del servidor, dedup por id_local).
export function fusionarLocales(body) {
  const payload = { cliente_hora: new Date().toISOString(), ...body };
  return conTimeout(URL_APP, { method: 'POST', body: JSON.stringify(payload) }, 20000)
    .catch(() => ({ ok: false, offline: true }));
}

// Sube un archivo (estudio). Sin cola offline: si falla, se avisa y se reintenta a mano.
export function subirArchivo({ nombre, tipo, datos, descripcion, categoria }) {
  const payload = {
    accion: 'subir_archivo', nombre, tipo, datos, descripcion, categoria,
    cliente_hora: new Date().toISOString(),
  };
  return conTimeout(URL_APP, { method: 'POST', body: JSON.stringify(payload) }, 25000)
    .catch(() => ({ ok: false, mensaje: 'Sin conexión' }));
}

// Envía la cola de a uno, en orden. Un error real del servidor (ok:false,
// no un problema de red) no es motivo para descartar ese envío como si se
// hubiera entregado — se pierde para siempre y nadie se entera — pero
// tampoco puede trabar a los que vienen después: si el primero de la cola
// queda pegado (p. ej. corrige una fila que ya no existe), todo lo nuevo
// que se registre después de él tiene que poder salir igual. Por eso se
// recorre la cola entera en este ciclo en vez de cortar en el primer error,
// y sólo los que fallaron de verdad (no los que ya se entregaron) quedan
// guardados para el próximo intento.
export function vaciarCola(alTerminar) {
  const cola = leerCola();
  if (!cola.length) return Promise.resolve(0);
  return vaciarDesde_(cola, 0, [], alTerminar);
}
function vaciarDesde_(cola, i, fallidos, alTerminar) {
  if (i >= cola.length) {
    guardarCola(fallidos);
    if (alTerminar) alTerminar(fallidos.length);
    return fallidos.length;
  }
  return conTimeout(URL_APP, { method: 'POST', body: JSON.stringify(cola[i]) })
    .then(res => vaciarDesde_(cola, i + 1, res.ok ? fallidos : [...fallidos, cola[i]], alTerminar))
    .catch(() => {
      // Sin conexión: no tiene sentido seguir probando el resto ahora. Lo
      // que ya había fallado de verdad más lo que faltaba por intentar
      // quedan en la cola entera para el próximo ciclo.
      const resto = [...fallidos, ...cola.slice(i)];
      guardarCola(resto);
      if (alTerminar) alTerminar(resto.length);
      return resto.length;
    });
}
