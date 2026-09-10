import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { consultar, llamar, leerCola, vaciarCola, subirArchivo, fusionarLocales } from './api.js';
import { Icono, Marca } from './icons.jsx';

const NACIMIENTO = '2026-04-19';          // ajustar en Ajustes → perfil
const PULSACION_LARGA = 420;              // ms
const UMBRAL_TETA_MS = 3 * 60 * 60 * 1000; // aviso "alimente" tras 3 h sin teta

// Última respuesta buena de action=inicial, para pintar de entrada con lo
// último conocido (en vez de una pantalla vacía) mientras se espera la
// respuesta real del Apps Script, que puede tardar unos segundos.
const CACHE_DATOS_LS = 'ultimo_estado_emma';
function leerCacheDatos() {
  try { return JSON.parse(localStorage.getItem(CACHE_DATOS_LS) || 'null') || {}; } catch { return {}; }
}
function guardarCacheDatos(parcial) {
  try { localStorage.setItem(CACHE_DATOS_LS, JSON.stringify({ ...leerCacheDatos(), ...parcial })); } catch { /* localStorage lleno o bloqueado, no pasa nada */ }
}

// "teta" conserva el cronómetro (arranca/para toma) además del registro
// rápido; los otros tres son alta directa con hoja de detalle al mantener
// pulsado. Los 4 muestran "hace cuánto" (o la fecha, ver ultimo()).
const RAPIDOS = [
  { tipo: 'teta', crono: true }, { tipo: 'baño' }, { tipo: 'vacuna' }, { tipo: 'peso' },
];

// Campos opcionales de la hoja de detalle, por tipo de evento.
const DETALLE = {
  teta: [
    { campo: 'lado', label: 'Lado', ops: ['izquierdo', 'derecho', 'ambos'] },
    { campo: 'cantidad_ml', label: 'Biberón', ops: ['60 ml', '90 ml', '120 ml'] },
    { campo: 'duracion_minutos', label: 'Duración (min)', ops: [], libre: true, numerico: true },
  ],
  'sueño': [
    { campo: 'notas', label: 'Dónde', ops: ['cuna', 'brazos', 'carro'] },
    { campo: 'duracion_minutos', label: 'Duración (min)', ops: [], libre: true, numerico: true },
  ],
  pis: [{ campo: 'cantidad_ml', label: 'Cantidad', ops: ['poco', 'normal', 'mucho'] }],
  caca: [
    { campo: 'consistencia', label: 'Consistencia', ops: ['blanda', 'normal', 'dura'] },
    { campo: 'color', label: 'Color', ops: ['mostaza', 'verde', 'marrón'] },
  ],
  'pañal': [
    { campo: 'contenido', label: 'Contenido', ops: ['pis', 'caca', 'ambos'] },
    { campo: 'cantidad_ml', label: 'Cantidad', ops: ['poco', 'normal', 'mucho'] },
    { campo: 'consistencia', label: 'Consistencia', ops: ['blanda', 'normal', 'dura'] },
    { campo: 'color', label: 'Color', ops: ['mostaza', 'verde', 'marrón'] },
    { campo: 'crema', label: 'Crema', ops: ['sí', 'no'] },
  ],
  'baño': [{ campo: 'duracion_minutos', label: 'Duración', ops: ['5', '10', '15'] }],
  vacuna: [{ campo: 'dosis', label: 'Vacuna', ops: [], libre: true }],
  peso: [
    { campo: 'peso_kg', label: 'Peso (kg)', ops: [], libre: true, numerico: true },
    { campo: 'talla_cm', label: 'Talla (cm)', ops: [], libre: true, numerico: true },
  ],
};

// Una fila optimista recién creada (ver registrar()) usa un id temporal
// 'tmp-...' hasta que el servidor confirma la real: no sirve para corregir
// o eliminar todavía.
const filaReal = f => f != null && !String(f).startsWith('tmp-');

const dosD = n => String(n).padStart(2, '0');
const reloj = d => dosD(d.getHours()) + ':' + dosD(d.getMinutes());

function hace(desde) {
  const min = Math.floor((Date.now() - desde.getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return min + ' min';
  const horas = Math.floor(min / 60);
  if (horas < 24) return horas + ' h ' + dosD(min % 60);
  const dias = Math.floor(horas / 24), restoHoras = horas % 24;
  return dias + ' d' + (restoHoras ? ' ' + restoHoras + ' h' : '');
}

// Cuenta regresiva hasta una fecha futura (p. ej. próxima dosis de medicación).
// Mismo criterio que hace(): pasadas las 24 h, se expresa en días.
function faltan(hasta) {
  const min = Math.max(0, Math.ceil((hasta.getTime() - Date.now()) / 60000));
  if (min < 1) return 'ahora';
  if (min < 60) return min + ' min';
  const horas = Math.floor(min / 60);
  if (horas < 24) return horas + ' h ' + dosD(min % 60);
  const dias = Math.floor(horas / 24), restoHoras = horas % 24;
  return dias + ' d' + (restoHoras ? ' ' + restoHoras + ' h' : '');
}

// "2026-04-19" con `new Date(...)` se interpreta como medianoche UTC, así
// que en husos horarios detrás de UTC (como Argentina) puede correr un día
// para atrás. Para fechas de sólo-día (nacimiento, dosis del esquema) hay
// que armar la fecha en horario local.
function fechaLocal(iso) {
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, m - 1, d);
  }
  return new Date(iso);
}

function mesesDeVida(iso) {
  const n = fechaLocal(iso), h = new Date();
  let meses = (h.getFullYear() - n.getFullYear()) * 12 + h.getMonth() - n.getMonth();
  const ref = new Date(n); ref.setMonth(ref.getMonth() + meses);
  if (ref > h) meses -= 1;
  return meses;
}

function edad(iso) {
  const n = fechaLocal(iso), h = new Date();
  let meses = (h.getFullYear() - n.getFullYear()) * 12 + h.getMonth() - n.getMonth();
  const ref = new Date(n); ref.setMonth(n.getMonth() + meses);
  if (ref > h) { meses -= 1; ref.setMonth(ref.getMonth() - 1); }
  const dias = Math.floor((h - ref) / 86400000);
  return meses + ' meses · ' + dias + ' días';
}

const fecha = r => new Date(r.iso || r.timestamp);

// Para teta/sueño el timestamp guardado es la hora de INICIO (se guarda al
// arrancar el cronómetro, o a mano si se carga el registro manualmente); la
// hora de fin se calcula sumando la duración guardada.
const finDe = r => new Date(fecha(r).getTime() + (Number(r.duracion_minutos) || 0) * 60000);

// Ajustes ya no vive acá: es información que casi no cambia, así que se
// accede con un ícono en el header en vez de competir por espacio en este
// menú (ver botón "ajustes" en el <header>). Hoy se fusionó con Semana.
const SECCIONES = [
  { id: 'registrar', txt: 'Registrar', icono: 'registrar' },
  { id: 'semana', txt: 'Resumen', icono: 'barras' },
  { id: 'citas', txt: 'Turnos', icono: 'cita' },
  { id: 'vacunas', txt: 'Medicación', icono: 'vacuna' },
  { id: 'estudios', txt: 'Estudios', icono: 'documento' },
];

// Turnos, medicación y tomas ahora también viven en la planilla (ver Codigo.gs),
// pero no son parte del feed diario de registros — se excluyen igual que "estudio".
const TIPOS_NO_DIARIOS = ['estudio', 'cita', 'medicamento', 'toma_medicacion'];

// datetime-local usa hora local sin zona horaria; convertimos en ambos sentidos.
function aLocal(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
const deLocalISO = s => new Date(s).toISOString();

function resumen(r) {
  const partes = [];
  if (r.lado) partes.push(r.lado);
  if (r.contenido) partes.push(r.contenido);
  if (r.consistencia) partes.push(r.consistencia);
  if (r.dosis) partes.push(r.dosis);
  if (r.peso_kg) partes.push(r.peso_kg + ' kg');
  if (r.talla_cm) partes.push(r.talla_cm + ' cm');
  if (r.duracion_minutos !== '' && r.duracion_minutos != null) partes.push(r.duracion_minutos + ' min');
  if (r.notas) partes.push(r.notas);
  return partes.join(' · ');
}

export default function App() {
  const [vista, setVista] = useState('registrar');
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [registros, setRegistros] = useState(() => leerCacheDatos().registros || []);
  const [estado, setEstado] = useState(() => leerCacheDatos().estado || null); // {tipo_evento, inicio} del servidor
  const [sincronizando, setSincronizando] = useState(false);
  const [ahora, setAhora] = useState(Date.now());
  const [pendientes, setPendientes] = useState(leerCola().length);
  const [hoja, setHoja] = useState(null);            // {tipo, modo:'nuevo'|'editar', fila, valores}
  const [aviso, setAviso] = useState(null);
  const [semanaOffset, setSemanaOffset] = useState(0); // 0 = semana actual, 1 = anterior, ...
  const [semanaCache, setSemanaCache] = useState({});  // offset -> respuesta del servidor
  const semana = semanaCache[semanaOffset] || null;
  const [semanaError, setSemanaError] = useState(false);
  const [estudios, setEstudios] = useState(null);
  const [estudiosError, setEstudiosError] = useState(false);
  const [categoriasEstudio, setCategoriasEstudio] = useState(null);
  const [carpetaEstudios, setCarpetaEstudios] = useState('');
  const [perfil, setPerfil] = useState(() => leerCacheDatos().perfil || { nombre: 'Emma', nacimiento: NACIMIENTO });
  const [avisoTeta, setAvisoTeta] = useState(false);
  const [editarInicio, setEditarInicio] = useState(false);
  const [ajustesAbierto, setAjustesAbierto] = useState(false);
  const [notifPermiso, setNotifPermiso] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'no-disponible'
  );
  const [ultimaSync, setUltimaSync] = useState(() => {
    const v = Number(localStorage.getItem('ultima_sync_emma'));
    return v ? new Date(v) : null;
  });
  // Citas/esquema/medicamentos/tomas: primero la cache unificada (ya sincronizada
  // con el servidor en una sesión anterior); si todavía no hay nada ahí (recién
  // instalada esta versión), caen a las claves viejas de localStorage —
  // dedicadas a cada una — que es donde vivía todo esto antes de la migración.
  const [citas, setCitasState] = useState(() => leerCacheDatos().citas || leerCitas());
  const [esquema, setEsquemaState] = useState(() => leerCacheDatos().esquema || leerEsquema());
  const [medicamentos, setMedicamentosState] = useState(() => leerCacheDatos().medicamentos || leerMedicamentos());
  const [tomasMed, setTomasMedState] = useState(() => leerCacheDatos().tomasMed || leerTomasMed());
  // Historial completo de baño/vacuna/peso (toda la planilla, no sólo los
  // ~60 registros cortos de action=inicial): sólo para el "hace cuánto"/fecha
  // de Registrar más allá de esa ventana y el gráfico de Peso y talla en
  // Resumen. No son parte de la migración localStorage→planilla: siempre
  // vivieron en la planilla, nunca tuvieron clave propia en el teléfono.
  const [historialBano, setHistorialBano] = useState(() => leerCacheDatos().historialBano || []);
  const [historialVacuna, setHistorialVacuna] = useState(() => leerCacheDatos().historialVacuna || []);
  const [historialPeso, setHistorialPeso] = useState(() => leerCacheDatos().historialPeso || []);
  const [avisosMed, setAvisosMed] = useState([]); // ids de medicamentos con dosis vencida
  const pulsacion = useRef(null);
  const sostenido = useRef(false);
  const toque = useRef(null);
  const avisadoRef = useRef(false);
  const avisadosMedRef = useRef(new Set());
  const perfilCargado = useRef(false); // sólo se toma del servidor una vez, para no pisar una edición en curso

  // Esquema sigue siendo un reemplazo completo (como categorias_guardar): no
  // hace falta refrescar desde el servidor después, lo que se manda es
  // exactamente lo que va a quedar guardado.
  function persistirEsquemaApp(lista) {
    setEsquemaState(lista);
    llamar({ accion: 'esquema_guardar', esquema: lista }).then(res => { if (res.offline) setPendientes(leerCola().length); });
  }

  // Turnos y medicación ahora son filas de la planilla: además del estado
  // optimista, hay que escribir/corregir la fila y después refrescar desde
  // el servidor (cargarExtra) para quedarse con la fila real — necesaria
  // para poder editar/borrar ese mismo turno o medicamento más adelante.
  function guardarCitaApp(c, esNueva) {
    setCitasState(prev => {
      const lista = esNueva ? [...prev, c] : prev.map(x => x.id === c.id ? c : x);
      return [...lista].sort((a, b) => a.iso.localeCompare(b.iso));
    });
    const campos = {
      cita_titulo: c.titulo, cita_lugar: c.lugar, cita_doctora: c.doctora, cita_telefono: c.telefono,
      notas: c.nota, cita_indicaciones: c.indicaciones, cita_aviso: c.aviso,
      cita_vacuna: c.vacuna ? 1 : '', cita_vacuna_id: c.vacunaId || '',
    };
    const llamada = esNueva
      ? llamar({ tipo_evento: 'cita', id_local: c.id, timestamp: c.iso, ...campos })
      : llamar({ accion: 'corregir', fila: c.fila, timestamp: c.iso, ...campos });
    llamada.then(res => { if (res.offline) setPendientes(leerCola().length); cargarExtra(); });
  }
  function borrarCitaApp(c) {
    setCitasState(prev => prev.filter(x => x.id !== c.id));
    if (c.fila) llamar({ accion: 'eliminar', fila: c.fila }).then(() => cargarExtra());
  }
  function guardarMedicamentoApp(m, esNueva) {
    setMedicamentosState(prev => esNueva ? [...prev, m] : prev.map(x => x.id === m.id ? m : x));
    const campos = { med_nombre: m.nombre, med_dias: m.dias, med_frecuencia_horas: m.frecuenciaHoras };
    const llamada = esNueva
      ? llamar({ tipo_evento: 'medicamento', id_local: m.id, timestamp: m.inicio, ...campos })
      : llamar({ accion: 'corregir', fila: m.fila, timestamp: m.inicio, ...campos });
    llamada.then(res => { if (res.offline) setPendientes(leerCola().length); cargarExtra(); });
  }
  function borrarMedicamentoApp(m) {
    setMedicamentosState(prev => prev.filter(x => x.id !== m.id));
    if (m.fila) llamar({ accion: 'eliminar', fila: m.fila }).then(() => cargarExtra());
  }
  function registrarToma(medId) {
    const med = medicamentos.find(m => m.id === medId);
    const nueva = { id: 'tm' + Date.now(), medId, iso: new Date().toISOString() };
    setTomasMedState(lista => [nueva, ...lista]);
    avisadosMedRef.current.delete(medId);
    setAvisosMed(a => a.filter(id => id !== medId));
    // Si el medicamento todavía no tiene fila (recién creado, no terminó de
    // sincronizar) esta toma queda sólo optimista hasta el próximo
    // cargarExtra(): caso borde raro, no vale la pena bloquear el botón por esto.
    if (med && med.fila) {
      llamar({ tipo_evento: 'toma_medicacion', id_local: nueva.id, timestamp: nueva.iso, med_fila: med.fila })
        .then(() => cargarExtra());
    }
  }
  // Editar/backdatear "la última toma" (no crea una toma nueva salvo que
  // todavía no hubiera ninguna): corrige in situ la más reciente, para el
  // caso "me olvidé de tocar Tomé ahora y quiero poner la hora a mano".
  function editarUltimaTomaApp(medId, iso) {
    const med = medicamentos.find(m => m.id === medId);
    const ultima = tomasMed.filter(t => t.medId === medId).sort((a, b) => b.iso.localeCompare(a.iso))[0];
    if (ultima && ultima.fila) {
      setTomasMedState(lista => lista.map(t => t.id === ultima.id ? { ...t, iso } : t));
      llamar({ accion: 'corregir', fila: ultima.fila, timestamp: iso }).then(() => cargarExtra());
    } else {
      const nueva = { id: 'tm' + Date.now(), medId, iso };
      setTomasMedState(lista => [nueva, ...lista]);
      if (med && med.fila) {
        llamar({ tipo_evento: 'toma_medicacion', id_local: nueva.id, timestamp: iso, med_fila: med.fila }).then(() => cargarExtra());
      }
    }
    avisadosMedRef.current.delete(medId);
    setAvisosMed(a => a.filter(id => id !== medId));
  }
  function borrarUltimaTomaApp(medId) {
    const ultima = tomasMed.filter(t => t.medId === medId).sort((a, b) => b.iso.localeCompare(a.iso))[0];
    if (!ultima) return;
    setTomasMedState(lista => lista.filter(t => t.id !== ultima.id));
    if (ultima.fila) llamar({ accion: 'eliminar', fila: ultima.fila }).then(() => cargarExtra());
  }
  // Igual que arriba pero para una dosis del esquema de vacunas: corrige el
  // registro ya matcheado (v.puesta) si existe, o crea uno nuevo con la
  // fecha elegida a mano (equivalente a cargarla desde Registrar, pero con
  // fecha propia en vez de "ahora").
  function editarVacunaApp(v, iso) {
    if (v.puesta && filaReal(v.puesta.fila)) {
      setHistorialVacuna(lista => lista.map(r => r.fila === v.puesta.fila ? { ...r, iso, timestamp: iso } : r));
      setRegistros(lista => lista.map(r => r.fila === v.puesta.fila ? { ...r, iso, timestamp: iso } : r));
      llamar({ accion: 'corregir', fila: v.puesta.fila, timestamp: iso }).then(() => cargarExtra());
    } else {
      llamar({ tipo_evento: 'vacuna', id_local: 'r' + Date.now(), timestamp: iso, dosis: v.nombre }).then(() => cargarExtra());
    }
  }
  function borrarVacunaApp(v) {
    if (!v.puesta || !filaReal(v.puesta.fila)) return;
    const fila = v.puesta.fila;
    setHistorialVacuna(lista => lista.filter(r => r.fila !== fila));
    setRegistros(lista => lista.filter(r => r.fila !== fila));
    llamar({ accion: 'eliminar', fila }).then(() => cargarExtra());
  }
  function proximaDosisMed(med) {
    const tomasDelMed = tomasMed.filter(t => t.medId === med.id).sort((a, b) => b.iso.localeCompare(a.iso));
    const base = tomasDelMed[0] ? new Date(tomasDelMed[0].iso) : new Date(med.inicio);
    return new Date(base.getTime() + (tomasDelMed[0] ? med.frecuenciaHoras * 3600000 : 0));
  }
  function medicamentoVigente(med) {
    const fin = new Date(new Date(med.inicio).getTime() + med.dias * 86400000);
    return ahora <= fin.getTime();
  }

  useEffect(() => {
    const vigentes = medicamentos.filter(medicamentoVigente);
    const vencidos = vigentes.filter(m => ahora >= proximaDosisMed(m).getTime());
    vencidos.forEach(m => {
      if (!avisadosMedRef.current.has(m.id)) {
        avisadosMedRef.current.add(m.id);
        setAvisosMed(a => a.includes(m.id) ? a : [...a, m.id]);
        if (notifPermiso === 'granted') {
          try { new Notification('Hora de ' + m.nombre, { body: 'Toca la próxima dosis.' }); } catch {}
        }
      }
    });
    // si un medicamento dejó de estar vigente (venció el tratamiento), sacar su aviso
    // (se devuelve la misma referencia cuando no cambia nada, así React no
    // re-renderiza de más en cada tick del segundero por esto)
    setAvisosMed(a => {
      const filtrado = a.filter(id => vigentes.some(m => m.id === id));
      return filtrado.length === a.length ? a : filtrado;
    });
  }, [ahora, medicamentos, tomasMed, notifPermiso]);

  const ultimaTeta = useMemo(() => {
    const r = registros.find(x => x.tipo_evento === 'teta');
    return r ? finDe(r) : null;
  }, [registros]);

  const refrescar = useCallback(() => {
    setSincronizando(true);
    consultar('inicial').then(res => {
      setSincronizando(false);
      if (!res.ok) return;
      const registrosNuevos = res.registros || [];
      const estadoNuevo = res.estado && res.estado.activo ? res.estado : null;
      setRegistros(registrosNuevos);
      setEstado(estadoNuevo);
      guardarCacheDatos({ registros: registrosNuevos, estado: estadoNuevo });
      if (res.perfil && !perfilCargado.current) {
        setPerfil(res.perfil);
        perfilCargado.current = true;
      }
      const ahoraSync = new Date();
      setUltimaSync(ahoraSync);
      try { localStorage.setItem('ultima_sync_emma', String(ahoraSync.getTime())); } catch {}
    });
  }, []);

  useEffect(() => {
    refrescar();
    vaciarCola(setPendientes);
    const t = setInterval(() => setAhora(Date.now()), 1000);
    const s = setInterval(() => vaciarCola(setPendientes), 20000);
    const online = () => vaciarCola(setPendientes);
    const visible = () => { if (!document.hidden) refrescar(); };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(t); clearInterval(s);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refrescar]);

  // Adapta la respuesta de action=extra (filas del Sheet) y la vuelca en el
  // estado de App + la cache unificada, en la forma de objeto que ya usan
  // PantallaCitas/PantallaVacunas (ver filaACita/filaAMedicamento/filaAToma).
  const adoptarExtra = r => {
    const citasNuevas = (r.citas || []).map(filaACita).sort((a, b) => a.iso.localeCompare(b.iso));
    const medsNuevos = (r.medicamentos || []).map(filaAMedicamento);
    const medsPorFila = {};
    medsNuevos.forEach(m => { medsPorFila[m.fila] = m.id; });
    const tomasNuevas = (r.tomas_medicacion || []).map(row => filaAToma(row, medsPorFila));
    const esquemaNuevo = (r.esquema && r.esquema.length) ? r.esquema : ESQUEMA_DEFECTO;
    // banos/vacunas/pesos ya vienen como filas crudas (mismo formato que
    // "registros"): no hacen falta adaptadores, se consumen tal cual en
    // ultimo() y en el gráfico de Peso y talla.
    const banosNuevos = r.banos || [];
    const vacunasNuevas = r.vacunas || [];
    const pesosNuevos = r.pesos || [];
    setCitasState(citasNuevas);
    setMedicamentosState(medsNuevos);
    setTomasMedState(tomasNuevas);
    setEsquemaState(esquemaNuevo);
    setHistorialBano(banosNuevos);
    setHistorialVacuna(vacunasNuevas);
    setHistorialPeso(pesosNuevos);
    guardarCacheDatos({
      citas: citasNuevas, medicamentos: medsNuevos, tomasMed: tomasNuevas, esquema: esquemaNuevo,
      historialBano: banosNuevos, historialVacuna: vacunasNuevas, historialPeso: pesosNuevos,
    });
  };

  // Turnos/medicación/esquema se piden aparte de action=inicial (no en cada
  // refrescar()) para no regresionar el pintado instantáneo del feed diario:
  // sólo hace falta al montar la app, al tocar "Actualizar" en esas pantallas,
  // o después de crear/editar/borrar un turno o medicamento.
  const cargarExtra = useCallback(() => {
    consultar('extra').then(r => { if (r.ok) adoptarExtra(r); });
  }, []); // eslint-disable-line

  // Migración única (por celular) de citas/medicamentos/tomas/esquema desde
  // localStorage hacia la planilla. Sólo se marca migrado si el servidor
  // respondió ok y no offline; si no, no se toca la marca y se reintenta sola
  // la próxima vez que se abra la app (fusionar_locales es idempotente del
  // lado del servidor, dedup por id_local, así que reintentar no duplica nada).
  useEffect(() => {
    if (localStorage.getItem(MIGRADO_LS)) { cargarExtra(); return; }
    fusionarLocales({
      accion: 'fusionar_locales',
      citas: leerCitas(), medicamentos: leerMedicamentos(),
      tomas_medicacion: leerTomasMed(), esquema: leerEsquema(),
    }).then(r => {
      if (r.ok && !r.offline) {
        try { localStorage.setItem(MIGRADO_LS, '1'); } catch { /* localStorage bloqueado, no pasa nada */ }
        adoptarExtra(r);
      }
    });
  }, []); // eslint-disable-line

  // Guarda citas/esquema/medicamentos/tomas en la cache unificada cada vez
  // que cambian (vengan del servidor o de una edición local), para pintar de
  // una con lo último conocido en la próxima apertura — mismo criterio que
  // ya se usa para "perfil".
  useEffect(() => {
    guardarCacheDatos({ citas, medicamentos, tomasMed, esquema, historialBano, historialVacuna, historialPeso });
  }, [citas, medicamentos, tomasMed, esquema, historialBano, historialVacuna, historialPeso]);

  const cargarSemana = useCallback(offset => {
    setSemanaError(false);
    consultar('semana', '&offset=' + offset).then(r => {
      if (r.ok) setSemanaCache(c => ({ ...c, [offset]: r })); else setSemanaError(true);
    });
  }, []);

  useEffect(() => {
    if (vista === 'semana' && !semanaCache[semanaOffset]) cargarSemana(semanaOffset);
  }, [vista, semanaOffset, semanaCache, cargarSemana]);

  // Precarga en segundo plano las semanas vecinas (sobre todo la anterior,
  // que es el sentido más común de navegación) para que moverse con las
  // flechas se sienta instantáneo la mayoría de las veces.
  useEffect(() => {
    if (vista !== 'semana') return;
    if (!semanaCache[semanaOffset + 1]) cargarSemana(semanaOffset + 1);
    if (semanaOffset > 0 && !semanaCache[semanaOffset - 1]) cargarSemana(semanaOffset - 1);
  }, [vista, semanaOffset, semanaCache, cargarSemana]);

  // Guarda el perfil en la cache local cada vez que cambia (venga del
  // servidor o de una edición en Ajustes), para que la próxima apertura
  // pinte de una con el nombre/fecha correctos sin esperar la red.
  useEffect(() => { guardarCacheDatos({ perfil }); }, [perfil]);

  const cargarEstudios = useCallback(() => {
    setEstudiosError(false);
    consultar('estudios').then(r => {
      if (!r.ok) { setEstudiosError(true); return; }
      setEstudios(r.registros || []);
      setCategoriasEstudio(r.categorias || []);
      if (r.carpeta) setCarpetaEstudios(r.carpeta);
    });
  }, []);

  useEffect(() => {
    if (vista === 'estudios' && !estudios) cargarEstudios();
  }, [vista, estudios, cargarEstudios]);

  // Botón manual de "actualizar": no hay pull-to-refresh porque el body ya
  // desactiva overscroll (para no disparar refrescos sin querer al scrollear),
  // así que esto refresca los datos de la pantalla actual y de paso se fija
  // si hay una versión nueva de la app para no depender de cerrar y reabrir.
  function actualizarTodo() {
    refrescar();
    cargarExtra(); // también refresca citas/medicación/esquema y el historial de baño/vacuna/peso
    if (vista === 'semana') cargarSemana(semanaOffset);
    if (vista === 'estudios') cargarEstudios();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
    }
  }

  // Aviso "Alimente al ácaro" 3 h después de la última toma.
  useEffect(() => {
    avisadoRef.current = false;
    setAvisoTeta(false);
  }, [ultimaTeta ? ultimaTeta.getTime() : null]);

  // Apagarlo apenas se pone en marcha una toma, sin esperar a que se guarde.
  useEffect(() => {
    if (estado && estado.tipo_evento === 'teta' && estado.activo) {
      avisadoRef.current = false;
      setAvisoTeta(false);
    }
  }, [estado]);

  useEffect(() => {
    if (!ultimaTeta || avisadoRef.current) return;
    if (estado && estado.tipo_evento === 'teta' && estado.activo) return; // hay una toma en curso, no avisar
    if (ahora - ultimaTeta.getTime() >= UMBRAL_TETA_MS) {
      avisadoRef.current = true;
      setAvisoTeta(true);
      if (notifPermiso === 'granted') {
        try { new Notification('Alimente al ácaro', { body: 'Pasaron 3 horas desde la última toma.' }); } catch {}
      }
    }
  }, [ahora, ultimaTeta, notifPermiso, estado]);

  function notificar(texto, deshacer) {
    setAviso({ texto, deshacer });
    clearTimeout(notificar.t);
    notificar.t = setTimeout(() => setAviso(null), 3600);
  }

  function registrar(tipo, extra = {}) {
    const optimista = {
      fila: 'tmp-' + Date.now(), tipo_evento: tipo,
      iso: new Date().toISOString(), duracion_minutos: '', notas: '', ...extra,
      ...(extra.timestamp ? { iso: extra.timestamp } : {}),
    };
    setRegistros(r => [optimista, ...r]);
    llamar({ tipo_evento: tipo, ...extra }).then(res => {
      if (res.offline) setPendientes(leerCola().length);
      refrescar();
    });
    notificar(tipo[0].toUpperCase() + tipo.slice(1) + ' registrado · ' + reloj(new Date()), () => {
      setRegistros(r => r.filter(x => x.fila !== optimista.fila));
      llamar({ accion: 'eliminar_ultimo', tipo_evento: tipo }).then(refrescar);
    });
  }

  function cronometro(tipo) {
    if (estado && estado.tipo_evento === tipo) {
      const min = Math.max(1, Math.round((ahora - new Date(estado.inicio)) / 60000));
      setEstado(null);
      llamar({ accion: 'detener' }).then(refrescar);
      notificar(tipo + ' · ' + min + ' min guardados' + (estado.reanudar_fila ? ' (retomado)' : ''));
    } else if (!estado) {
      setEstado({ tipo_evento: tipo, inicio: new Date().toISOString(), activo: true });
      llamar({ accion: 'iniciar', tipo_evento: tipo }).then(res => {
        if (res.estado) setEstado(res.estado);
        if (res.offline) setPendientes(leerCola().length);
      });
    }
  }

  // Reabre el último registro guardado de teta/sueño (solo si es el último
  // del historial) y sigue sumando tiempo a esa misma fila en vez de crear
  // una nueva al detener.
  function reanudar(tipo, fila) {
    if (estado) return;
    setEstado({ tipo_evento: tipo, inicio: new Date().toISOString(), activo: true, reanudar_fila: fila });
    llamar({ accion: 'reanudar', tipo_evento: tipo, fila }).then(res => {
      if (res.estado) setEstado(res.estado);
      if (res.offline) setPendientes(leerCola().length);
    });
    setHoja(null);
    notificar('Retomando ' + tipo);
  }

  // Un toque registra; mantener pulsado abre el detalle.
  // El pointer capture + el chequeo de movimiento evitan que un roce o un
  // gesto de scroll que empieza en una celda y termina en la de al lado
  // dispare un registro accidental (o el de otra celda).
  const TOLERANCIA_MOVIMIENTO = 12; // px
  const alPulsar = tipo => e => {
    sostenido.current = false;
    toque.current = { x: e.clientX, y: e.clientY, cancelado: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no soportado, no pasa nada */ }
    clearTimeout(pulsacion.current);
    pulsacion.current = setTimeout(() => {
      sostenido.current = true;
      if (navigator.vibrate) navigator.vibrate(12);
      setHoja({ tipo, modo: 'nuevo', valores: {} });
    }, PULSACION_LARGA);
  };
  const alMover = e => {
    if (!toque.current || toque.current.cancelado) return;
    const dx = e.clientX - toque.current.x, dy = e.clientY - toque.current.y;
    if (Math.hypot(dx, dy) > TOLERANCIA_MOVIMIENTO) {
      toque.current.cancelado = true;
      clearTimeout(pulsacion.current);
    }
  };
  const alSoltar = tipo => () => {
    clearTimeout(pulsacion.current);
    const cancelado = !toque.current || toque.current.cancelado;
    toque.current = null;
    if (!sostenido.current && !cancelado) registrar(tipo);
  };
  const cancelar = () => {
    clearTimeout(pulsacion.current);
    if (toque.current) toque.current.cancelado = true;
  };

  // Mismo mecanismo para las tarjetas de Teta/Sueño: un toque simple arranca
  // o para el cronómetro (como antes); mantener pulsado abre la carga manual
  // de un registro con hora de inicio y duración, pero solo si no hay ya un
  // cronómetro en marcha (si lo hay, el toque simple sigue sirviendo para
  // pararlo, no tiene sentido abrir el alta manual encima).
  const alPulsarCrono = tipo => e => {
    sostenido.current = false;
    toque.current = { x: e.clientX, y: e.clientY, cancelado: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no soportado */ }
    clearTimeout(pulsacion.current);
    pulsacion.current = setTimeout(() => {
      if (estado) return;
      sostenido.current = true;
      if (navigator.vibrate) navigator.vibrate(12);
      setHoja({ tipo, modo: 'nuevo', valores: {} });
    }, PULSACION_LARGA);
  };
  const alSoltarCrono = tipo => () => {
    clearTimeout(pulsacion.current);
    const cancelado = !toque.current || toque.current.cancelado;
    toque.current = null;
    if (!sostenido.current && !cancelado) cronometro(tipo);
  };

  // Mismo mecanismo de mantener presionado, para abrir el detalle de un
  // registro reciente. Un toque simple no hace nada: hay que sostener.
  const pulsacionLista = useRef(null);
  const toqueLista = useRef(null);
  const mantenerParaAbrir = cb => ({
    onPointerDown: e => {
      toqueLista.current = { x: e.clientX, y: e.clientY, cancelado: false };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no soportado */ }
      clearTimeout(pulsacionLista.current);
      pulsacionLista.current = setTimeout(() => {
        if (toqueLista.current && !toqueLista.current.cancelado) {
          if (navigator.vibrate) navigator.vibrate(12);
          cb();
        }
      }, PULSACION_LARGA);
    },
    onPointerMove: e => {
      if (!toqueLista.current || toqueLista.current.cancelado) return;
      const dx = e.clientX - toqueLista.current.x, dy = e.clientY - toqueLista.current.y;
      if (Math.hypot(dx, dy) > TOLERANCIA_MOVIMIENTO) {
        toqueLista.current.cancelado = true;
        clearTimeout(pulsacionLista.current);
      }
    },
    onPointerUp: () => { clearTimeout(pulsacionLista.current); toqueLista.current = null; },
    onPointerLeave: () => { clearTimeout(pulsacionLista.current); if (toqueLista.current) toqueLista.current.cancelado = true; },
    onPointerCancel: () => { clearTimeout(pulsacionLista.current); if (toqueLista.current) toqueLista.current.cancelado = true; },
    onContextMenu: e => e.preventDefault(),
  });

  const enMarcha = estado ? Math.floor((ahora - new Date(estado.inicio)) / 1000) : 0;
  const cronoTexto = dosD(Math.floor(enMarcha / 3600)) + ':' + dosD(Math.floor(enMarcha / 60) % 60) + ':' + dosD(enMarcha % 60);

  // fin=true usa la hora de fin (teta); si no, la hora del registro tal cual.
  // Primero busca en "registros" (ventana corta de action=inicial, pero al
  // instante e incluye lo recién cargado); si no aparece ahí cae al
  // historial completo de action=extra. Pasados 3 días sin uno nuevo, en vez
  // de seguir contando muestra la fecha real ("Últ. 12 jul" en vez de
  // "Hace 12 d") — es lo que realmente se quiere saber a esa distancia.
  const HISTORIAL_POR_TIPO = { 'baño': historialBano, vacuna: historialVacuna, peso: historialPeso };
  const ultimo = (tipo, fin) => {
    const r = registros.find(x => x.tipo_evento === tipo) || (HISTORIAL_POR_TIPO[tipo] || [])[0];
    if (!r) return 'Sin registros';
    const f = fin ? finDe(r) : fecha(r);
    const dias = Math.floor((Date.now() - f.getTime()) / 86400000);
    return dias >= 3 ? 'Últ. ' + f.toLocaleDateString('es', { day: 'numeric', month: 'short' }) : 'Hace ' + hace(f);
  };

  // Los "estudios", turnos, medicación y tomas tienen su propia pestaña; no
  // se mezclan con el feed diario.
  const registrosDiarios = useMemo(() => registros.filter(r => !TIPOS_NO_DIARIOS.includes(r.tipo_evento)), [registros]);

  const delDia = useMemo(() => {
    const hoy = new Date().toDateString();
    return registrosDiarios.filter(r => fecha(r).toDateString() === hoy);
  }, [registrosDiarios]);

  return (
    <div className="app">
      <header className="cab">
        <div>
          <h1>{perfil.nombre}</h1>
          <div className="edad">
            {edad(perfil.nacimiento)}
            {sincronizando && <span style={{ marginLeft: 8, color: 'var(--n-500)' }}>· actualizando…</span>}
          </div>
        </div>
        <div className="marcas">
          <button className="btn-actualizar" onClick={() => setAjustesAbierto(true)} aria-label="Ajustes">
            <Icono tipo="ajustes" s={20} />
          </button>
          <button className={'btn-actualizar' + (sincronizando ? ' girando' : '')} onClick={actualizarTodo}
                  aria-label="Actualizar">
            <Icono tipo="actualizar" s={20} />
          </button>
          <Marca s={30} color="var(--accent-600)" />
        </div>
      </header>
      {pendientes > 0 && (
        <div className="cola">{pendientes} {pendientes === 1 ? 'registro pendiente' : 'registros pendientes'} de enviar</div>
      )}
      {avisoTeta && (
        <button className="cola alerta" onClick={() => setAvisoTeta(false)}>
          Alimente al ácaro · última toma hace {hace(ultimaTeta)}
        </button>
      )}
      {medicamentos.filter(medicamentoVigente).map(med => {
        const prox = proximaDosisMed(med);
        const vencido = ahora >= prox.getTime();
        return (
          <button key={med.id} className="cola alerta" disabled={!vencido}
                  onClick={() => vencido && registrarToma(med.id)}>
            {vencido ? 'Hora de ' + med.nombre + ' · toca ahora'
                     : med.nombre + ' · próxima toma en ' + faltan(prox)}
          </button>
        );
      })}

      {vista === 'registrar' && (
        <section className="pantalla">
          {estado && (
            <div className="marcha">
              <div className="et">
                <Icono tipo="reloj" s={15} /> En marcha · {estado.tipo_evento}
                <button onClick={() => setEditarInicio(true)} aria-label="Editar hora de inicio"
                        style={{ marginLeft: 'auto', border: 0, background: 'none', color: 'inherit', padding: 4, opacity: .85 }}>
                  <Icono tipo="editar" s={15} />
                </button>
              </div>
              <div className="fila">
                <div className="num">{cronoTexto}</div>
                <button onClick={() => cronometro(estado.tipo_evento)}>Parar</button>
              </div>
            </div>
          )}

          <div className="pad" style={{ paddingTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div className="rotulo">Registro rápido</div>
              <div style={{ fontSize: 10, color: 'var(--n-500)' }}>Mantén pulsado para más detalle</div>
            </div>
            <div className="rejilla dos">
              {RAPIDOS.map(({ tipo, etiqueta, crono }) => (
                <button key={tipo} className="celda"
                        disabled={crono && !!estado && estado.tipo_evento !== tipo}
                        onPointerDown={(crono ? alPulsarCrono : alPulsar)(tipo)}
                        onPointerUp={(crono ? alSoltarCrono : alSoltar)(tipo)}
                        onPointerMove={alMover} onPointerLeave={cancelar}
                        onPointerCancel={cancelar} onContextMenu={e => e.preventDefault()}>
                  <Icono tipo={tipo} s={24} />
                  <div>
                    <div className="t" style={{ textTransform: 'capitalize' }}>{etiqueta || tipo}</div>
                    <div className="s">{ultimo(tipo, crono)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="pad" style={{ paddingTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div className="rotulo">Últimos registros</div>
              <button onClick={() => setVista('semana')}
                      style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent-600)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                Ver el día
              </button>
            </div>
            <hr className="regla" />
            {registrosDiarios.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--n-500)', padding: '8px 0 0' }}>Mantén pulsado para editar</div>
            )}
            {registrosDiarios.slice(0, 6).map(r => {
              const esCronometrado = r.tipo_evento === 'teta' || r.tipo_evento === 'sueño';
              return (
                <button key={r.fila} className="entrada"
                        {...mantenerParaAbrir(() => setHoja({ tipo: r.tipo_evento, modo: 'editar', fila: r.fila, valores: r }))}>
                  <Icono tipo={r.tipo_evento} s={20} />
                  <span>
                    <span className="t">{r.tipo_evento}</span>
                    {resumen(r) && <span className="s"> · {resumen(r)}</span>}
                  </span>
                  <span className="h">
                    <span>Hace {hace(esCronometrado ? finDe(r) : fecha(r))}</span>
                    {esCronometrado ? reloj(fecha(r)) + ' - ' + reloj(finDe(r)) : reloj(fecha(r))}
                  </span>
                </button>
              );
            })}
            {!registrosDiarios.length && <p style={{ color: 'var(--n-600)', fontSize: 13 }}>Sin registros todavía.</p>}
          </div>
        </section>
      )}

      {vista === 'semana' && (
        <section className="pantalla pad" style={{ paddingTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <button onClick={() => setSemanaOffset(o => o + 1)} aria-label="Semana anterior"
                    style={{ border: 0, background: 'none', color: 'var(--text)', fontSize: 20, fontWeight: 800, padding: '4px 10px' }}>
              ‹
            </button>
            <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n-600)' }}>
              {semanaOffset === 0 ? 'Esta semana' : semana ? semana.dias[0].fecha + ' – ' + semana.dias[6].fecha : 'Cargando…'}
            </div>
            <button onClick={() => setSemanaOffset(o => Math.max(0, o - 1))} disabled={semanaOffset === 0}
                    aria-label="Semana siguiente"
                    style={{ border: 0, background: 'none', color: semanaOffset === 0 ? 'var(--n-400)' : 'var(--text)', fontSize: 20, fontWeight: 800, padding: '4px 10px' }}>
              ›
            </button>
          </div>
          {semana?.incompleto && (
            <p style={{ color: 'var(--n-600)', fontSize: 11, marginBottom: 12 }}>
              Esta semana tiene muchos registros acumulados; los números podrían estar incompletos.
            </p>
          )}
          <div className="rotulo" style={{ marginBottom: 10 }}>Tomas por día</div>
          <hr className="regla" style={{ marginBottom: 12 }} />
          <div className="barras">
            {(semana?.dias || []).map((d, i) => (
              <div className="col" key={d.dia}>
                <div className="n">{d.tomas}</div>
                <div className={'b' + (i === 6 ? ' hoy' : '')}
                     style={{ height: Math.round((d.tomas / Math.max(1, semana.max_tomas)) * 120) }} />
              </div>
            ))}
          </div>
          <div className="dias">{(semana?.dias || []).map(d => <span key={d.dia}>{d.dia}</span>)}</div>

          {(() => {
            // Historial completo de peso_kg/talla_cm (de extra_(), no de esta
            // semana sola): los últimos 10 valores de cada uno, más viejo
            // primero. Un solo scatterplot con eje de tiempo compartido y
            // escala propia por serie (kg y cm no se comparan en valor
            // absoluto), para ver la curva de crecimiento real superpuesta.
            const conPeso = historialPeso.filter(r => r.peso_kg).slice(0, 10).reverse();
            const conTalla = historialPeso.filter(r => r.talla_cm).slice(0, 10).reverse();
            if (!conPeso.length && !conTalla.length) return null;

            const fechas = [...conPeso, ...conTalla].map(r => fecha(r).getTime());
            const fMin = Math.min.apply(null, fechas), fMax = Math.max.apply(null, fechas);
            const rangoF = Math.max(1, fMax - fMin);
            const ANCHO = 300, ALTO = 176, IZQ = 14, DER = 14, ARRIBA = 18, ABAJO = 32;
            const ejeX = t => IZQ + ((t - fMin) / rangoF) * (ANCHO - IZQ - DER);

            const serie = (lista, campo) => {
              if (!lista.length) return [];
              const valores = lista.map(r => Number(r[campo]));
              const min = Math.min.apply(null, valores), max = Math.max.apply(null, valores);
              const rango = Math.max(.001, max - min);
              const ejeY = v => ARRIBA + (1 - (v - min) / rango) * (ALTO - ARRIBA - ABAJO);
              return lista.map(r => ({ v: r[campo], x: ejeX(fecha(r).getTime()), y: ejeY(Number(r[campo])), fila: r.fila }));
            };
            const sPeso = serie(conPeso, 'peso_kg');
            const sTalla = serie(conTalla, 'talla_cm');
            const puntos = lista => lista.map(p => p.x + ',' + p.y).join(' ');
            const fmtFecha = t => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });

            return (
              <>
                <div className="rotulo" style={{ margin: '26px 0 10px' }}>Peso y talla</div>
                <hr className="regla" style={{ marginBottom: 12 }} />
                <svg viewBox={'0 0 ' + ANCHO + ' ' + ALTO} style={{ width: '100%', height: 'auto', display: 'block' }}>
                  {sPeso.length > 1 && <polyline points={puntos(sPeso)} fill="none" stroke="var(--accent-600)" strokeWidth="1.5" opacity=".55" />}
                  {sTalla.length > 1 && <polyline points={puntos(sTalla)} fill="none" stroke="var(--text)" strokeWidth="1.5" opacity=".4" />}
                  {sPeso.map((p, i) => (
                    <g key={'p' + i}>
                      <circle cx={p.x} cy={p.y} r="3.6" fill="var(--accent-600)" />
                      <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="8.5" fontWeight="800" fill="var(--accent-600)">{p.v}</text>
                    </g>
                  ))}
                  {sTalla.map((p, i) => (
                    <g key={'t' + i}>
                      <circle cx={p.x} cy={p.y} r="3.6" fill="var(--text)" />
                      <text x={p.x} y={p.y + 15} textAnchor="middle" fontSize="8.5" fontWeight="800" fill="var(--text)">{p.v}</text>
                    </g>
                  ))}
                  <text x={IZQ} y={ALTO - 6} textAnchor="start" fontSize="8" fontWeight="500" fill="var(--n-600)">{fmtFecha(fMin)}</text>
                  {fMax !== fMin && <text x={ANCHO - DER} y={ALTO - 6} textAnchor="end" fontSize="8" fontWeight="500" fill="var(--n-600)">{fmtFecha(fMax)}</text>}
                </svg>
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  {sPeso.length > 0 && <span className="leyenda"><i style={{ background: 'var(--accent-600)' }} />Peso (kg)</span>}
                  {sTalla.length > 0 && <span className="leyenda"><i style={{ background: 'var(--text)' }} />Talla (cm)</span>}
                </div>
              </>
            );
          })()}

          {semana && (
            <button className="btn btn-primario" style={{ marginTop: 18 }} onClick={() => window.print()}>
              <Icono tipo="imprimir" s={16} /> Resumen para el pediatra
            </button>
          )}
          {!semana && !semanaError && <p style={{ color: 'var(--n-600)', fontSize: 13, marginTop: 16 }}>Cargando la semana…</p>}
          {semanaError && (
            <div style={{ marginTop: 16 }}>
              <p style={{ color: 'var(--n-600)', fontSize: 13, marginBottom: 10 }}>No se pudo cargar. Revisá tu conexión.</p>
              <button className="btn btn-secundario" onClick={() => cargarSemana(semanaOffset)}>Reintentar</button>
            </div>
          )}

          {/* Fusionado de la antigua pestaña "Hoy". */}
          <div className="rotulo" style={{ margin: '30px 0 8px' }}>Línea del día</div>
          <hr className="regla" />
          {delDia.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--n-500)', padding: '8px 0 0' }}>Mantén pulsado para editar</div>
          )}
          {delDia.map(r => (
            <button key={r.fila} className="linea"
                    {...mantenerParaAbrir(() => setHoja({ tipo: r.tipo_evento, modo: 'editar', fila: r.fila, valores: r }))}>
              <span className="hora">{reloj(fecha(r))}</span>
              <span className="cuerpo">
                <Icono tipo={r.tipo_evento} s={20} />
                <span style={{ flex: 1 }}>
                  <span className="t" style={{ display: 'block', fontSize: 13.5, fontWeight: 600, textTransform: 'capitalize' }}>{r.tipo_evento}</span>
                  <span className="s" style={{ display: 'block', fontSize: 10.5, color: 'var(--n-600)' }}>{resumen(r)}</span>
                </span>
              </span>
            </button>
          ))}
          {!delDia.length && <p style={{ color: 'var(--n-600)', fontSize: 13 }}>Nada registrado hoy.</p>}
        </section>
      )}

      {vista === 'citas' && (
        <PantallaCitas registros={registros} historialVacuna={historialVacuna} perfil={perfil} esquema={esquema} medicamentos={medicamentos}
                       citas={citas} onGuardarCita={guardarCitaApp} onBorrarCita={borrarCitaApp}
                       onVerVacunas={() => setVista('vacunas')} />
      )}

      {vista === 'vacunas' && (
        <PantallaVacunas registros={registros} historialVacuna={historialVacuna} perfil={perfil} esquema={esquema} onEsquemaChange={persistirEsquemaApp}
                         medicamentos={medicamentos} onGuardarMedicamento={guardarMedicamentoApp} onBorrarMedicamento={borrarMedicamentoApp}
                         tomasMed={tomasMed} onRegistrarToma={registrarToma}
                         onEditarToma={editarUltimaTomaApp} onBorrarToma={borrarUltimaTomaApp}
                         onEditarVacuna={editarVacunaApp} onBorrarVacuna={borrarVacunaApp}
                         citas={citas} onGuardarCita={guardarCitaApp} />
      )}

      {vista === 'estudios' && (
        <PantallaEstudios
          estudios={estudios}
          error={estudiosError}
          carpeta={carpetaEstudios}
          categorias={categoriasEstudio}
          onReintentar={cargarEstudios}
          onSubido={() => { setEstudios(null); setCategoriasEstudio(null); cargarEstudios(); }}
          onBorrar={fila => {
            llamar({ accion: 'eliminar', fila }).then(() => { setEstudios(null); cargarEstudios(); });
          }}
          onMover={(fila, cat) => {
            setEstudios(es => es && es.map(r => r.fila === fila ? { ...r, archivo_categoria: cat } : r));
            llamar({ accion: 'corregir', fila, archivo_categoria: cat });
          }}
          onCategorias={lista => {
            setCategoriasEstudio(lista);
            llamar({ accion: 'categorias_guardar', categorias: lista });
          }}
        />
      )}

      {/* Resumen impreso: sólo visible al imprimir */}
      <div className="impreso">
        <h1>{perfil.nombre} · resumen</h1>
        <p>{edad(perfil.nacimiento)} — generado el {new Date().toLocaleDateString('es')}</p>
        <table>
          <thead><tr><th>Fecha</th><th>Hora</th><th>Evento</th><th>Detalle</th></tr></thead>
          <tbody>
            {registrosDiarios.slice(0, 80).map(r => (
              <tr key={r.fila}>
                <td>{fecha(r).toLocaleDateString('es')}</td>
                <td>{reloj(fecha(r))}</td>
                <td style={{ textTransform: 'capitalize' }}>{r.tipo_evento}</td>
                <td>{resumen(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hoja && (
        <HojaDetalle
          hoja={hoja}
          esquema={esquema}
          registros={registros}
          historialVacuna={historialVacuna}
          perfil={perfil}
          onCerrar={() => setHoja(null)}
          onGuardar={valores => {
            if (hoja.modo === 'nuevo') registrar(hoja.tipo, valores);
            else llamar({ accion: 'corregir', fila: hoja.fila, ...valores }).then(refrescar);
            setHoja(null);
          }}
          onBorrar={() => {
            llamar({ accion: 'eliminar', fila: hoja.fila }).then(refrescar);
            setRegistros(r => r.filter(x => x.fila !== hoja.fila));
            setHoja(null);
            notificar('Registro eliminado');
          }}
          onReanudar={
            !estado && hoja.modo === 'editar' &&
            (hoja.tipo === 'teta' || hoja.tipo === 'sueño') &&
            registrosDiarios[0] && registrosDiarios[0].fila === hoja.fila
              ? () => reanudar(hoja.tipo, hoja.fila)
              : null
          }
        />
      )}

      {editarInicio && estado && (
        <EditarInicioSheet
          valorInicial={aLocal(new Date(estado.inicio))}
          onCerrar={() => setEditarInicio(false)}
          onGuardar={valor => {
            const iso = deLocalISO(valor);
            setEstado(e => (e ? { ...e, inicio: iso } : e));
            llamar({ accion: 'ajustar_inicio', inicio: iso }).then(refrescar);
            setEditarInicio(false);
          }}
        />
      )}

      {/* Ajustes: antes era una pestaña del menú; como es información que
          casi no cambia (perfil, estado de sync, permiso de avisos), ahora
          se abre como hoja superpuesta desde el ícono de engranaje del
          header, igual que HojaDetalle/EditarInicioSheet. */}
      {ajustesAbierto && (
        <>
          <div className="fondo" onClick={() => setAjustesAbierto(false)} />
          <div className="hoja" role="dialog" aria-label="Ajustes">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ width: 56, height: 56, background: 'var(--accent)', display: 'grid', placeItems: 'center', flex: 'none' }}>
                  <Marca s={34} color="var(--text)" calado="var(--accent)" />
                </div>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{perfil.nombre}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--n-600)', marginTop: 5 }}>{edad(perfil.nacimiento)}</div>
                </div>
              </div>
              <button onClick={() => setAjustesAbierto(false)} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Cerrar">
                <Icono tipo="cerrar" s={22} />
              </button>
            </div>

            <div className="rotulo" style={{ margin: '4px 0 8px' }}>Editar datos</div>
            <hr className="regla" />
            <div className="campo">
              <span className="rotulo">Nombre</span>
              <input className="entrada-texto" value={perfil.nombre}
                     onChange={e => setPerfil(p => ({ ...p, nombre: e.target.value }))} />
            </div>
            <div className="campo">
              <span className="rotulo">Fecha de nacimiento</span>
              <input className="entrada-texto" type="date" value={perfil.nacimiento}
                     onChange={e => setPerfil(p => ({ ...p, nacimiento: e.target.value }))} />
            </div>
            <button className="btn btn-primario" style={{ marginTop: 4 }}
                    onClick={() => llamar({ accion: 'perfil', ...perfil }).then(() => notificar('Datos guardados'))}>
              Guardar datos
            </button>

            <div className="rotulo" style={{ margin: '20px 0 8px' }}>Datos</div>
            <hr className="regla" />
            <div style={{ padding: '12px 0', borderBottom: '1px solid var(--n-300)', fontSize: 13.5 }}>
              Hoja de cálculo conectada · {pendientes ? pendientes + ' pendientes' : 'todo sincronizado'}
            </div>
            <div style={{ padding: '12px 0', borderBottom: '1px solid var(--n-300)', fontSize: 13.5, color: 'var(--n-600)' }}>
              {ultimaSync ? 'Última sincronización: ' + hace(ultimaSync) : 'Todavía no sincronizó'}
            </div>
            <button className="btn btn-secundario" style={{ marginTop: 12 }} onClick={() => { vaciarCola(setPendientes); refrescar(); }}>
              Volver a sincronizar
            </button>

            <div className="rotulo" style={{ margin: '20px 0 8px' }}>Recordatorios</div>
            <hr className="regla" />
            <div style={{ padding: '12px 0', borderBottom: '1px solid var(--n-300)', fontSize: 13.5 }}>
              Aviso "Alimente al ácaro" 3 h después de la última toma ·{' '}
              {notifPermiso === 'granted' ? 'activado'
                : notifPermiso === 'no-disponible' ? 'no disponible en este navegador'
                : 'desactivado'}
            </div>
            {notifPermiso !== 'granted' && notifPermiso !== 'no-disponible' && (
              <button className="btn btn-secundario" style={{ marginTop: 12 }}
                      onClick={() => Notification.requestPermission().then(setNotifPermiso)}>
                Activar avisos
              </button>
            )}
          </div>
        </>
      )}

      {aviso && (
        <div className="aviso">
          <span>{aviso.texto}</span>
          {aviso.deshacer && <button onClick={() => { aviso.deshacer(); setAviso(null); }}>Deshacer</button>}
        </div>
      )}

      <button className="navbar" onClick={() => setMenuAbierto(true)} aria-haspopup="true" aria-expanded={menuAbierto}>
        <span className="navbar-actual">
          <Icono tipo={(SECCIONES.find(s => s.id === vista) || SECCIONES[0]).icono} s={20} />
          {(SECCIONES.find(s => s.id === vista) || SECCIONES[0]).txt}
        </span>
        <span className="navbar-flecha">▾</span>
      </button>

      {menuAbierto && (
        <>
          <div className="fondo" onClick={() => setMenuAbierto(false)} />
          <div className="hoja" role="dialog" aria-label="Menú">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div className="kicker">Ir a</div>
                <h2>Menú</h2>
              </div>
              <button onClick={() => setMenuAbierto(false)} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Cerrar">
                <Icono tipo="cerrar" s={22} />
              </button>
            </div>
            <hr className="regla" style={{ margin: '16px 0 0' }} />
            {SECCIONES.map(s => (
              <button key={s.id} className={'menu-item' + (vista === s.id ? ' on' : '')}
                      onClick={() => { setVista(s.id); setMenuAbierto(false); }}>
                <Icono tipo={s.icono} s={20} />
                <span>{s.txt}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const MAX_BYTES_ARCHIVO = 15 * 1024 * 1024;
const CATEGORIA_DEFECTO = ['Ecografía', 'Análisis', 'Vacunas', 'Pediatra', 'Otro'];

const extension = nombre => (String(nombre).split('.').pop() || '?').toUpperCase().slice(0, 4);

// Los estudios son lo primero de la pantalla: fichas en dos columnas.
// Subir y administrar categorías viven en hojas, no en formularios abiertos.
function PantallaEstudios({ estudios, error: cargaError, carpeta, categorias, onReintentar, onSubido, onBorrar, onMover, onCategorias }) {
  const [filtro, setFiltro] = useState('Todos');
  const [hoja, setHoja] = useState(null);        // 'subir' | 'cats' | ficha
  const [archivo, setArchivo] = useState(null);
  const [descripcion, setDescripcion] = useState('');
  const [categoria, setCategoria] = useState('');
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const camaraRef = useRef(null);

  const listaCategorias = categorias || CATEGORIA_DEFECTO;

  useEffect(() => {
    if (listaCategorias.length && !listaCategorias.includes(categoria)) setCategoria(listaCategorias[0]);
  }, [categorias]); // eslint-disable-line

  const cuenta = c => (estudios || []).filter(r => (r.archivo_categoria || 'Otro') === c).length;
  const visibles = (estudios || []).filter(r => filtro === 'Todos' || (r.archivo_categoria || 'Otro') === filtro);

  function elegirArchivo(e) {
    const f = e.target.files[0] || null;
    setError('');
    if (f && f.size > MAX_BYTES_ARCHIVO) {
      setError('Archivo muy grande (máx. 15 MB).');
      setArchivo(null);
      e.target.value = '';
      return;
    }
    setArchivo(f);
  }

  function subir() {
    if (!archivo) return;
    setSubiendo(true);
    setError('');
    const lector = new FileReader();
    lector.onload = () => {
      const base64 = String(lector.result).split(',')[1] || '';
      subirArchivo({ nombre: archivo.name, tipo: archivo.type, datos: base64, descripcion, categoria }).then(res => {
        setSubiendo(false);
        if (res.ok) {
          setArchivo(null);
          setDescripcion('');
          if (inputRef.current) inputRef.current.value = '';
          if (camaraRef.current) camaraRef.current.value = '';
          setHoja(null);
          onSubido();
        } else {
          setError(res.mensaje || 'No se pudo subir. Probá de nuevo.');
        }
      });
    };
    lector.onerror = () => { setSubiendo(false); setError('No se pudo leer el archivo.'); };
    lector.readAsDataURL(archivo);
  }

  function agregarCategoria() {
    const nombre = nuevaCategoria.trim();
    setNuevaCategoria('');
    if (!nombre || listaCategorias.includes(nombre)) return;
    onCategorias([...listaCategorias, nombre]);
  }

  return (
    <section className="pantalla" style={{ paddingTop: 8 }}>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" onChange={elegirArchivo} hidden />
      <input ref={camaraRef} type="file" accept="image/*" capture="environment" onChange={elegirArchivo} hidden />

      <div className="filtros">
        {['Todos', ...listaCategorias].map(c => (
          <button key={c} className={'filtro' + (filtro === c ? ' on' : '')} onClick={() => setFiltro(c)}>
            {c}<i>{c === 'Todos' ? (estudios || []).length : cuenta(c)}</i>
          </button>
        ))}
      </div>

      <div className="pad">
        {visibles.length > 0 && (
          <div className="pila">
            {visibles.map(r => (
              <div key={r.fila} className="archivo" role="button" tabIndex={0} style={{ cursor: 'pointer' }}
                   onClick={() => window.open(r.archivo_url, '_blank')}
                   onKeyDown={e => { if (e.key === 'Enter') window.open(r.archivo_url, '_blank'); }}>
                <span className="mini" style={{ width: 38, height: 38, background: 'var(--n-200)', display: 'grid', placeItems: 'center', fontSize: 9.5, fontWeight: 800, color: 'var(--n-700)' }}>
                  {extension(r.archivo_nombre)}
                </span>
                <span>
                  <span className="t">{r.notas || r.archivo_nombre}</span>
                  <span className="s">
                    {r.archivo_categoria || 'Otro'} · {r.iso ? new Date(r.iso).toLocaleDateString('es') : ''}
                  </span>
                </span>
                <button onClick={e => { e.stopPropagation(); setHoja(r); }}
                        style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }}
                        aria-label={'Gestionar ' + (r.notas || r.archivo_nombre)}>
                  <Icono tipo="editar" s={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        {estudios === null && !cargaError && <p style={{ color: 'var(--n-600)', fontSize: 13 }}>Cargando…</p>}
        {cargaError && (
          <>
            <p style={{ color: 'var(--n-600)', fontSize: 13, margin: '10px 0' }}>No se pudo cargar. Revisá tu conexión.</p>
            <button className="btn btn-secundario" onClick={onReintentar}>Reintentar</button>
          </>
        )}
        {estudios && !estudios.length && <p style={{ color: 'var(--n-600)', fontSize: 13 }}>Todavía no subiste nada.</p>}
        {estudios && estudios.length > 0 && !visibles.length && (
          <p style={{ color: 'var(--n-600)', fontSize: 13 }}>Nada en {filtro}.</p>
        )}

        {carpeta && (
          <>
            <div className="rotulo" style={{ margin: '22px 0 8px' }}>Guardado en Drive</div>
            <hr className="regla" />
            <a className="drive" href={carpeta} target="_blank" rel="noreferrer">
              <Icono tipo="documento" s={20} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>Emma · estudios</span>
                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 500, color: 'var(--n-600)', marginTop: 6 }}>Carpeta compartida</span>
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent-600)' }}>Abrir</span>
            </a>
          </>
        )}

        <button className="btn btn-primario" style={{ marginTop: 18 }} onClick={() => setHoja('subir')}>
          <Icono tipo="subir" s={16} /> Subir estudio
        </button>
        <button className="btn btn-secundario" style={{ marginTop: 10 }} onClick={() => setHoja('cats')}>
          <Icono tipo="ajustes" s={16} /> Administrar categorías
        </button>
      </div>

      {hoja === 'subir' && (
        <>
          <div className="fondo" onClick={() => setHoja(null)} />
          <div className="hoja" role="dialog" aria-label="Subir estudio">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div className="kicker">Nuevo</div>
                <h2>Subir estudio</h2>
              </div>
              <button onClick={() => setHoja(null)} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Cerrar">
                <Icono tipo="cerrar" s={22} />
              </button>
            </div>
            <hr className="regla" style={{ margin: '16px 0 0' }} />
            <div className="rejilla dos" style={{ marginTop: 14 }}>
              <button className="celda" onClick={() => camaraRef.current && camaraRef.current.click()}>
                <Icono tipo="camara" s={26} />
                <div className="t">Sacar foto</div>
              </button>
              <button className="celda" onClick={() => inputRef.current && inputRef.current.click()}>
                <Icono tipo="documento" s={26} />
                <div className="t">Elegir archivo</div>
              </button>
            </div>
            {archivo && (
              <div className="elegido">
                <span className="mini">{extension(archivo.name)}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>{archivo.name}</span>
                  <span style={{ display: 'block', fontSize: 10.5, fontWeight: 500, color: 'var(--n-600)', marginTop: 6 }}>
                    {(archivo.size / 1048576).toFixed(1)} MB · listo para subir
                  </span>
                </span>
                <button onClick={() => setArchivo(null)} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Quitar">
                  <Icono tipo="cerrar" s={16} />
                </button>
              </div>
            )}
            <div className="campo">
              <span className="rotulo">Categoría</span>
              <div className="opciones" style={{ flexWrap: 'wrap' }}>
                {listaCategorias.map(c => (
                  <button key={c} type="button" className={categoria === c ? 'on' : ''} onClick={() => setCategoria(c)}>{c}</button>
                ))}
              </div>
            </div>
            <div className="campo" style={{ borderBottom: 0 }}>
              <span className="rotulo">Descripción</span>
              <input className="entrada-texto" placeholder="Opcional · ej. Ecografía de cadera, 4 meses"
                     value={descripcion} onChange={e => setDescripcion(e.target.value)} />
            </div>
            {error && <div style={{ color: 'var(--accent-700)', fontSize: 12, fontWeight: 700 }}>{error}</div>}
            <div className="acciones">
              <button onClick={() => setHoja(null)}>Cancelar</button>
              <button className="guardar" disabled={!archivo || subiendo} onClick={subir}>
                {subiendo ? 'Subiendo…' : 'Subir a Drive'}
              </button>
            </div>
          </div>
        </>
      )}

      {hoja === 'cats' && (
        <>
          <div className="fondo" onClick={() => setHoja(null)} />
          <div className="hoja" role="dialog" aria-label="Categorías">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div className="kicker">Organizar</div>
                <h2>Categorías</h2>
              </div>
              <button onClick={() => setHoja(null)} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Cerrar">
                <Icono tipo="cerrar" s={22} />
              </button>
            </div>
            <hr className="regla" style={{ margin: '16px 0 0' }} />
            {listaCategorias.map(c => (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: '1px solid var(--n-300)' }}>
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{c}</span>
                <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--n-600)' }}>{cuenta(c)} archivos</span>
                <button onClick={() => { onCategorias(listaCategorias.filter(x => x !== c)); if (filtro === c) setFiltro('Todos'); }}
                        style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label={'Borrar categoría ' + c}>
                  <Icono tipo="cerrar" s={16} />
                </button>
              </div>
            ))}
            {!listaCategorias.length && <p style={{ color: 'var(--n-600)', fontSize: 13 }}>No hay categorías todavía.</p>}
            <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
              <input className="entrada-texto" placeholder="Nueva categoría" value={nuevaCategoria}
                     onChange={e => setNuevaCategoria(e.target.value)}
                     onKeyDown={e => e.key === 'Enter' && agregarCategoria()} style={{ flex: 1 }} />
              <button className="btn btn-primario" style={{ width: 'auto', padding: '0 18px' }} onClick={agregarCategoria}>Agregar</button>
            </div>
          </div>
        </>
      )}

      {hoja && typeof hoja === 'object' && (
        <>
          <div className="fondo" onClick={() => setHoja(null)} />
          <div className="hoja" role="dialog" aria-label="Estudio">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div className="kicker">{hoja.archivo_categoria || 'Otro'}</div>
                <h2 style={{ textTransform: 'none' }}>{hoja.notas || hoja.archivo_nombre}</h2>
              </div>
              <button onClick={() => setHoja(null)} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Cerrar">
                <Icono tipo="cerrar" s={22} />
              </button>
            </div>
            <hr className="regla" style={{ margin: '16px 0 0' }} />
            <div className="elegido">
              <span className="mini">{extension(hoja.archivo_nombre)}</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, wordBreak: 'break-word' }}>{hoja.archivo_nombre}</span>
                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 500, color: 'var(--n-600)', marginTop: 6 }}>
                  {hoja.iso ? new Date(hoja.iso).toLocaleDateString('es') : ''}
                </span>
              </span>
            </div>
            <div className="campo">
              <span className="rotulo">Mover a</span>
              <div className="opciones" style={{ flexWrap: 'wrap' }}>
                {listaCategorias.map(c => (
                  <button key={c} type="button" className={(hoja.archivo_categoria || 'Otro') === c ? 'on' : ''}
                          onClick={() => { onMover(hoja.fila, c); setHoja({ ...hoja, archivo_categoria: c }); }}>{c}</button>
                ))}
              </div>
            </div>
            <div className="acciones">
              <button onClick={() => { onBorrar(hoja.fila); setHoja(null); }}>Borrar</button>
              <button className="guardar" onClick={() => { window.open(hoja.archivo_url, '_blank'); setHoja(null); }}>Abrir archivo</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// ── Citas y vacunas ───────────────────────────────────────────────
// Las citas se guardan en el celular (no tocan la hoja de cálculo);
// las vacunas cruzan el esquema oficial con los registros tipo "vacuna".
const CITAS_LS = 'citas_emma';
const ESQUEMA_LS = 'esquema_vacunas_emma';
// Marca de que este celular ya mandó su localStorage viejo al servidor
// (fusionar_locales). Una vez seteada, no se vuelve a leer citas_emma /
// esquema_vacunas_emma / medicamentos_emma / medicamentos_tomas_emma: quedan
// como respaldo inerte en el teléfono, sin tocarlas.
const MIGRADO_LS = 'migrado_sync_v1';
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

// Esquema oficial hasta los 12 meses. Editable desde la app (se guarda en
// localStorage); esta lista es sólo el punto de partida la primera vez.
const ESQUEMA_DEFECTO = [
  { id: 'v1', nombre: 'BCG', mes: 0 },
  { id: 'v2', nombre: 'Hepatitis B', mes: 0 },
  { id: 'v3', nombre: 'Pentavalente · 1ª', mes: 2 },
  { id: 'v4', nombre: 'Neumococo · 1ª', mes: 2 },
  { id: 'v5', nombre: 'Rotavirus · 1ª', mes: 2 },
  { id: 'v6', nombre: 'Pentavalente · 2ª', mes: 4 },
  { id: 'v7', nombre: 'Neumococo · 2ª', mes: 4 },
  { id: 'v8', nombre: 'Polio IPV · 2ª', mes: 4 },
  { id: 'v9', nombre: 'Triple viral', mes: 12 },
];
const edadDosis = mes => mes <= 0 ? 'Al nacer' : mes + ' meses';

// Estas "leerX" ya sólo se usan una vez, al montar la app, para mandar lo que
// haya en el celular a fusionar_locales (ver MIGRADO_LS más arriba); las
// claves quedan como respaldo inerte, no se vuelve a escribir en ellas —
// turnos, medicación y esquema ahora viven en la planilla / PropertiesService
// y se cachean con guardarCacheDatos, como el resto de los datos del server.
function leerCitas() {
  try { return JSON.parse(localStorage.getItem(CITAS_LS) || '[]'); } catch { return []; }
}
function leerEsquema() {
  try {
    const guardado = JSON.parse(localStorage.getItem(ESQUEMA_LS) || 'null');
    return Array.isArray(guardado) && guardado.length ? guardado : ESQUEMA_DEFECTO;
  } catch { return ESQUEMA_DEFECTO; }
}

const MEDS_LS = 'medicamentos_emma';
const MEDS_TOMAS_LS = 'medicamentos_tomas_emma';
function leerMedicamentos() {
  try { return JSON.parse(localStorage.getItem(MEDS_LS) || '[]'); } catch { return []; }
}
function leerTomasMed() {
  try { return JSON.parse(localStorage.getItem(MEDS_TOMAS_LS) || '[]'); } catch { return []; }
}

// Adaptadores entre las filas de la planilla (tipo_evento 'cita'/'medicamento'/
// 'toma_medicacion', ver Codigo.gs) y la forma de objeto que ya usaban
// PantallaCitas/PantallaVacunas cuando esto vivía sólo en localStorage — así
// el resto de esas pantallas no tuvo que cambiar.
function filaACita(r) {
  return {
    id: r.id_local, fila: r.fila, titulo: r.cita_titulo || '', iso: r.iso,
    lugar: r.cita_lugar || '', doctora: r.cita_doctora || '', telefono: r.cita_telefono || '',
    nota: r.notas || '', indicaciones: r.cita_indicaciones || '', aviso: r.cita_aviso || '1 día antes',
    vacuna: !!r.cita_vacuna, vacunaId: r.cita_vacuna_id || null,
  };
}
function filaAMedicamento(r) {
  return {
    id: r.id_local, fila: r.fila, nombre: r.med_nombre || '',
    dias: Number(r.med_dias) || 0, frecuenciaHoras: Number(r.med_frecuencia_horas) || 0,
    inicio: r.iso,
  };
}
// medsPorFila: { [fila del medicamento]: id_local } — para reconstruir medId
// a partir de med_fila, que es lo único que guarda la fila de la toma.
function filaAToma(r, medsPorFila) {
  return { id: r.id_local, fila: r.fila, medId: medsPorFila[r.med_fila] || null, iso: r.iso };
}

// Une, para un mismo día del calendario, lo que hay que marcar: citas reales,
// la fecha teórica de una dosis próxima o vencida sin turno, y los días de
// un tratamiento de medicación en curso.
// Devuelve un array de marcas para el día (puede haber más de una a la vez:
// p. ej. un turno el mismo día que empieza una medicación), cada una con su
// propio color Y forma — no sólo color — para que se entienda de un vistazo
// qué hay ese día sin tener que tocar nada (ver .cal .pt en styles.css).
// La alerta de "vacuna atrasada sin turno" se repite también en el día de
// HOY (además de en la fecha en que se hizo exigible) para que no quede
// enterrada en un mes que ya se pasó de largo.
function marcaDia(dia, { citas, vacunas, medicamentos }) {
  const marcas = [];
  const enElDia = iso => new Date(iso).toDateString() === dia.toDateString();
  const esHoy = dia.toDateString() === new Date().toDateString();
  const citaDelDia = (citas || []).find(c => enElDia(c.iso));
  // "vturno" (no "vac": ese nombre ya lo usa, sin relación, la fila de una
  // dosis en la pantalla de Vacunas — evita que esas reglas de CSS choquen).
  if (citaDelDia) marcas.push(citaDelDia.vacuna ? 'vturno' : 'cita');
  (vacunas || []).forEach(v => {
    if (v.atrasadaSinTurno && (esHoy || enElDia(v.fechaDue))) {
      if (!marcas.includes('alerta')) marcas.push('alerta');
    } else if (!v.puesta && !v.turnoAgendado && enElDia(v.fechaDue)) {
      if (!marcas.includes('proxima')) marcas.push('proxima');
    }
  });
  if ((medicamentos || []).some(m => {
    const inicio = new Date(m.inicio), fin = new Date(inicio.getTime() + m.dias * 86400000);
    return dia >= new Date(inicio.toDateString()) && dia <= fin;
  })) {
    marcas.push('med');
  }
  return marcas;
}

// registros: idealmente el historial completo (no sólo la ventana corta de
// action=inicial), para que una dosis aplicada hace tiempo no deje de
// reconocerse. pasadas: turnos ya ocurridos — un turno de vacunación pasado
// vinculado a esta dosis (vacunaId) cuenta como aplicada aunque no se haya
// cargado además un registro de vacuna aparte, con la fecha del turno.
// fechaDue queda calculada acá (nacimiento + mes del esquema) para que tanto
// la pantalla de vacunas como el calendario usen siempre el mismo cálculo.
function vacunasConEstado(esquema, registros, futuras, pasadas, edadMeses, nacimiento) {
  const nac = fechaLocal(nacimiento);
  return (esquema || []).map(v => {
    const base = v.nombre.split(' ·')[0].toLowerCase();
    const registro = (registros || []).find(r => r.tipo_evento === 'vacuna' && String(r.dosis || '').toLowerCase().includes(base));
    const turnoPasado = !registro && (pasadas || []).find(c => c.vacunaId === v.id);
    const puesta = registro || (turnoPasado ? { iso: turnoPasado.iso, timestamp: turnoPasado.iso } : null);
    const turnoAgendado = (futuras || []).some(c => c.vacunaId === v.id);
    const fechaDue = new Date(nac.getFullYear(), nac.getMonth() + v.mes, nac.getDate());
    const atrasadaSinTurno = !puesta && !turnoAgendado && edadMeses >= v.mes;
    return { ...v, edad: edadDosis(v.mes), fechaDue, puesta, turnoAgendado, atrasadaSinTurno };
  });
}

function PantallaCitas({ registros, historialVacuna, perfil, esquema, medicamentos, citas, onGuardarCita, onBorrarCita, onVerVacunas }) {
  const [mes, setMes] = useState(() => { const d = new Date(); return { a: d.getFullYear(), m: d.getMonth() }; });
  const [sel, setSel] = useState(null);
  const [hoja, setHoja] = useState(null); // 'nueva' | cita | {prefillVacuna}
  const [verHistorial, setVerHistorial] = useState(false);

  const corte = new Date(Date.now() - 6 * 3600000);
  // Se descartan citas con fecha inválida en vez de dejar que desaparezcan
  // en silencio de ambas listas (ni futuras ni pasadas).
  const conFecha = citas.filter(c => !isNaN(new Date(c.iso).getTime()));
  const futuras = conFecha.filter(c => new Date(c.iso) >= corte);
  const pasadas = conFecha.filter(c => new Date(c.iso) < corte).slice().reverse();
  const proxima = futuras[0];

  const nacimiento = perfil?.nacimiento || NACIMIENTO;
  const edadMeses = mesesDeVida(nacimiento);
  // Historial completo de vacunas (no sólo la ventana corta de "registros"),
  // para que una dosis aplicada hace más de unos días no deje de detectarse.
  const historialVacunaCompleto = useMemo(() => {
    const vistas = new Set();
    return [...registros.filter(r => r.tipo_evento === 'vacuna'), ...(historialVacuna || [])].filter(r => {
      const clave = r.fila != null ? 'f' + r.fila : 'l' + (r.id_local || r.id);
      if (vistas.has(clave)) return false;
      vistas.add(clave);
      return true;
    });
  }, [registros, historialVacuna]);
  const vacunas = vacunasConEstado(esquema, historialVacunaCompleto, futuras, pasadas, edadMeses, nacimiento);
  const aplicadas = vacunas.filter(v => v.puesta).length;
  const proximaVacuna = vacunas.find(v => !v.puesta);

  const primero = new Date(mes.a, mes.m, 1);
  const huecos = (primero.getDay() + 6) % 7;
  const largo = new Date(mes.a, mes.m + 1, 0).getDate();

  const diasFalta = iso => Math.round((new Date(iso) - Date.now()) / 86400000);

  return (
    <section className="pantalla">
      {proxima ? (
        <div className="marcha">
          <div className="et"><Icono tipo="cita" s={15} /> Próximo turno · {diasFalta(proxima.iso) <= 0 ? 'hoy' : 'en ' + diasFalta(proxima.iso) + ' días'}</div>
          <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', margin: '10px 0 0', lineHeight: 1.05 }}>{proxima.titulo}</h2>
          <div style={{ fontSize: 12, fontWeight: 500, marginTop: 7, lineHeight: 1.5 }}>
            {new Date(proxima.iso).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })} · {reloj(new Date(proxima.iso))}
            {proxima.lugar ? <><br />{proxima.lugar}</> : null}
            {proxima.doctora ? <><br />{proxima.doctora}</> : null}
            {proxima.telefono ? <><br /><a href={'tel:' + proxima.telefono} style={{ color: 'inherit' }}>{proxima.telefono}</a></> : null}
          </div>
          <div className="acciones" style={{ marginTop: 16 }}>
            <button onClick={() => setHoja(proxima)}>Ver detalle</button>
            {proxima.lugar
              ? <button className="guardar" style={{ background: 'var(--text)', color: 'var(--bg)' }}
                        onClick={() => window.open('https://maps.google.com/?q=' + encodeURIComponent(proxima.lugar), '_blank')}>Cómo llegar</button>
              : <button className="guardar" style={{ background: 'var(--text)', color: 'var(--bg)' }} onClick={() => setHoja(proxima)}>Editar</button>}
          </div>
        </div>
      ) : null}

      <div className="pad" style={{ paddingTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <div className="rotulo">{new Date(mes.a, mes.m, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' })}</div>
          <div style={{ display: 'flex', gap: 14 }}>
            <button onClick={() => setMes(m => ({ a: m.m ? m.a : m.a - 1, m: m.m ? m.m - 1 : 11 }))}
                    style={{ border: 0, background: 'none', padding: 0, fontSize: 13, fontWeight: 800, color: 'var(--text)' }} aria-label="Mes anterior">←</button>
            <button onClick={() => setMes(m => ({ a: m.m === 11 ? m.a + 1 : m.a, m: m.m === 11 ? 0 : m.m + 1 }))}
                    style={{ border: 0, background: 'none', padding: 0, fontSize: 13, fontWeight: 800, color: 'var(--text)' }} aria-label="Mes siguiente">→</button>
          </div>
        </div>
        <div className="semanas">{DIAS_SEMANA.map(d => <span key={d}>{d}</span>)}</div>
        <div className="cal">
          {Array.from({ length: huecos }).map((_, i) => <button key={'h' + i} className="off" disabled />)}
          {Array.from({ length: largo }).map((_, i) => {
            const n = i + 1;
            const marcas = marcaDia(new Date(mes.a, mes.m, n), { citas, vacunas, medicamentos });
            return (
              <button key={n} className={sel === n ? 'sel' : ''} onClick={() => setSel(sel === n ? null : n)}>
                {n}<span className="pts">{marcas.map(m => <span key={m} className={'pt ' + m} />)}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          <span className="leyenda"><i className="cita" />Turno</span>
          <span className="leyenda"><i className="vturno" />Vacuna agendada</span>
          <span className="leyenda"><i className="proxima" />Vacuna próxima</span>
          <span className="leyenda"><i className="alerta" />Vacuna sin turno</span>
          <span className="leyenda"><i className="med" />Medicación</span>
        </div>

        <div className="rotulo" style={{ margin: '26px 0 8px' }}>Lo que viene</div>
        <hr className="regla" />
        {futuras.map(c => (
          <button key={c.id} className="linea" onClick={() => setHoja(c)}>
            <span className="hora" style={{ fontSize: 15 }}>
              {dosD(new Date(c.iso).getDate())}
              <span style={{ display: 'block', fontSize: 10, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n-500)', marginTop: 5 }}>
                {MESES[new Date(c.iso).getMonth()]}
              </span>
            </span>
            <span className="cuerpo">
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{c.titulo}</span>
                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 500, color: 'var(--n-600)', marginTop: 6 }}>
                  {[c.lugar, c.doctora].filter(Boolean).join(' · ') || 'Sin lugar'}
                </span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{reloj(new Date(c.iso))}</span>
            </span>
          </button>
        ))}
        {!futuras.length && <p style={{ color: 'var(--n-600)', fontSize: 13, marginTop: 10 }}>No hay turnos anotados.</p>}
        <button className="btn btn-secundario" style={{ marginTop: 14 }} onClick={() => setHoja('nueva')}>
          <Icono tipo="mas" s={16} /> Agregar turno
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '26px 0 8px' }}>
          <div className="rotulo">Historial</div>
          {pasadas.length > 0 && (
            <button onClick={() => setVerHistorial(v => !v)}
                    style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent-600)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>
              {verHistorial ? 'Ocultar' : 'Ver todo · ' + pasadas.length}
            </button>
          )}
        </div>
        <hr className="regla" />
        {!pasadas.length && <p style={{ color: 'var(--n-600)', fontSize: 13, marginTop: 10 }}>Todavía no hay turnos pasados.</p>}
        {(verHistorial ? pasadas : pasadas.slice(0, 3)).map(c => (
          <button key={c.id} className="linea" onClick={() => setHoja(c)}>
            <span className="hora" style={{ fontSize: 15 }}>
              {dosD(new Date(c.iso).getDate())}
              <span style={{ display: 'block', fontSize: 10, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--n-500)', marginTop: 5 }}>
                {MESES[new Date(c.iso).getMonth()]}
              </span>
            </span>
            <span className="cuerpo">
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{c.titulo}</span>
                <span style={{ display: 'block', fontSize: 10.5, fontWeight: 500, color: 'var(--n-600)', marginTop: 6 }}>
                  {[c.doctora, c.indicaciones ? 'Con indicaciones' : (c.lugar || 'Sin lugar')].filter(Boolean).join(' · ')}
                </span>
              </span>
            </span>
          </button>
        ))}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '26px 0 8px' }}>
          <div className="rotulo">Vacunas</div>
          <div style={{ fontSize: 10, color: 'var(--n-500)' }}>{aplicadas} de {vacunas.length} aplicadas</div>
        </div>
        <hr className="regla" />
        <button className="linea" onClick={onVerVacunas}>
          <span className="cuerpo">
            <span style={{ flex: 1 }}>
              {proximaVacuna ? (
                <>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{proximaVacuna.nombre}</span>
                  <span style={{ display: 'block', fontSize: 10.5, fontWeight: 500, color: 'var(--n-600)', marginTop: 6 }}>
                    {proximaVacuna.edad}{proximaVacuna.atrasadaSinTurno ? ' · sin turno agendado' : ' · próxima'}
                  </span>
                </>
              ) : (
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>Esquema completo</span>
              )}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--accent-600)' }}>Ver todas</span>
          </span>
        </button>
      </div>

      {hoja && (
        <HojaCita
          cita={hoja && hoja.prefillVacuna ? null : (hoja === 'nueva' ? null : hoja)}
          prefillVacuna={hoja && hoja.prefillVacuna}
          onCerrar={() => setHoja(null)}
          onGuardar={c => { onGuardarCita(c, hoja === 'nueva' || !!hoja.prefillVacuna); setHoja(null); }}
          onBorrar={c => { onBorrarCita(c); setHoja(null); }}
        />
      )}
    </section>
  );
}

function HojaCita({ cita, prefillVacuna, onCerrar, onGuardar, onBorrar }) {
  const [titulo, setTitulo] = useState(cita ? cita.titulo : (prefillVacuna ? 'Turno · ' + prefillVacuna.nombre : ''));
  const [cuando, setCuando] = useState(cita ? aLocal(new Date(cita.iso)) : aLocal(new Date()));
  const [lugar, setLugar] = useState(cita ? cita.lugar || '' : '');
  const [doctora, setDoctora] = useState(cita ? cita.doctora || '' : '');
  const [telefono, setTelefono] = useState(cita ? cita.telefono || '' : '');
  const [nota, setNota] = useState(cita ? cita.nota || '' : '');
  const [indicaciones, setIndicaciones] = useState(cita ? cita.indicaciones || '' : '');
  const [aviso, setAviso] = useState(cita ? cita.aviso || '1 día antes' : '1 día antes');
  const [vacuna, setVacuna] = useState(cita ? !!cita.vacuna : !!prefillVacuna);
  const vacunaId = cita ? cita.vacunaId : (prefillVacuna ? prefillVacuna.id : null);
  const yaFue = cita && new Date(cita.iso) < new Date();

  return (
    <>
      <div className="fondo" onClick={onCerrar} />
      <div className="hoja" role="dialog" aria-label="Turno">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="kicker">{cita ? 'Editar' : 'Nuevo'}</div>
            <h2 style={{ textTransform: 'none' }}>{cita ? cita.titulo : 'Turno'}</h2>
          </div>
          <button onClick={onCerrar} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Cerrar">
            <Icono tipo="cerrar" s={22} />
          </button>
        </div>
        <hr className="regla" style={{ margin: '16px 0 0' }} />
        <div className="campo">
          <span className="rotulo">Qué</span>
          <input className="entrada-texto" placeholder="ej. Control de 4 meses" value={titulo} onChange={e => setTitulo(e.target.value)} />
        </div>
        <div className="campo">
          <span className="rotulo">Cuándo</span>
          <input className="entrada-texto" type="datetime-local" value={cuando} onChange={e => setCuando(e.target.value)} />
        </div>
        <div className="campo">
          <span className="rotulo">Dónde</span>
          <input className="entrada-texto" placeholder="Consultorio o dirección" value={lugar} onChange={e => setLugar(e.target.value)} />
        </div>
        <div className="campo">
          <span className="rotulo">Doctora / médico</span>
          <input className="entrada-texto" placeholder="Opcional · ej. Dra. Pérez" value={doctora} onChange={e => setDoctora(e.target.value)} />
        </div>
        <div className="campo">
          <span className="rotulo">Teléfono</span>
          <input className="entrada-texto" type="tel" placeholder="Opcional" value={telefono} onChange={e => setTelefono(e.target.value)} />
        </div>
        <div className="campo">
          <span className="rotulo">Tipo</span>
          <div className="opciones">
            <button className={!vacuna ? 'on' : ''} onClick={() => setVacuna(false)}>Consulta</button>
            <button className={vacuna ? 'on' : ''} onClick={() => setVacuna(true)}>Vacunas</button>
          </div>
        </div>
        <div className="campo">
          <span className="rotulo">Avisarme</span>
          <div className="opciones">
            {['1 día antes', '2 h antes', 'No'].map(a => (
              <button key={a} className={aviso === a ? 'on' : ''} onClick={() => setAviso(a)}>{a}</button>
            ))}
          </div>
        </div>
        <div className="campo">
          <span className="rotulo">Nota</span>
          <textarea className="entrada-texto" rows={3} placeholder="Opcional · ej. preguntar por el reflujo" value={nota} onChange={e => setNota(e.target.value)} />
        </div>
        <div className="campo" style={{ borderBottom: 0 }}>
          <span className="rotulo">Indicaciones{yaFue ? '' : ' · después de la consulta'}</span>
          <textarea className="entrada-texto" rows={3} placeholder="Qué dijo el pediatra, próximos pasos…"
                    value={indicaciones} onChange={e => setIndicaciones(e.target.value)} />
        </div>
        <div className="acciones">
          <button onClick={() => (cita ? onBorrar(cita) : onCerrar())}>{cita ? 'Borrar' : 'Cancelar'}</button>
          <button className="guardar" disabled={!titulo.trim()}
                  onClick={() => onGuardar({
                    id: cita ? cita.id : 'c' + Date.now(), fila: cita ? cita.fila : undefined,
                    titulo: titulo.trim(), iso: deLocalISO(cuando), lugar, doctora, telefono, nota, indicaciones, aviso, vacuna,
                    vacunaId: vacuna ? vacunaId : null,
                  })}>
            Guardar
          </button>
        </div>
      </div>
    </>
  );
}

// Agrupa las dosis del esquema por vacuna base (quita el "· 1ª"/"· 2ª" del
// nombre) para poder mostrar el progreso de la serie con estrellitas.
function agruparVacunas(vacunas) {
  const grupos = [];
  const porNombre = new Map();
  vacunas.forEach(v => {
    const base = v.nombre.replace(/\s*·\s*\d+ª\s*$/, '');
    if (!porNombre.has(base)) { porNombre.set(base, { base, dosis: [] }); grupos.push(porNombre.get(base)); }
    porNombre.get(base).dosis.push(v);
  });
  return grupos;
}

function PantallaVacunas({ registros, historialVacuna, perfil, esquema, onEsquemaChange, medicamentos, onGuardarMedicamento, onBorrarMedicamento, tomasMed, onRegistrarToma, onEditarToma, onBorrarToma, onEditarVacuna, onBorrarVacuna, citas, onGuardarCita }) {
  const [mes, setMes] = useState(() => { const d = new Date(); return { a: d.getFullYear(), m: d.getMonth() }; });
  const [sel, setSel] = useState(null);
  const [hoja, setHoja] = useState(null); // 'esquema' | 'medNueva' | medicamento | {prefillVacuna} | {editarToma} | {editarVacuna}

  const nacimiento = perfil?.nacimiento || NACIMIENTO;
  const edadMeses = mesesDeVida(nacimiento);
  const corte = new Date(Date.now() - 6 * 3600000);
  const conFecha = citas.filter(c => !isNaN(new Date(c.iso).getTime()));
  const futuras = conFecha.filter(c => new Date(c.iso) >= corte);
  // Más reciente primero (igual que en PantallaCitas), para que si hay más
  // de un turno pasado vinculado a la misma dosis, vacunasConEstado() tome
  // el más reciente como fecha de aplicación.
  const pasadas = conFecha.filter(c => new Date(c.iso) < corte).slice().reverse();
  // Historial completo de vacunas (no sólo la ventana corta de "registros"),
  // para que una dosis aplicada hace más de unos días no deje de detectarse.
  const historialVacunaCompleto = useMemo(() => {
    const vistas = new Set();
    return [...registros.filter(r => r.tipo_evento === 'vacuna'), ...(historialVacuna || [])].filter(r => {
      const clave = r.fila != null ? 'f' + r.fila : 'l' + (r.id_local || r.id);
      if (vistas.has(clave)) return false;
      vistas.add(clave);
      return true;
    });
  }, [registros, historialVacuna]);
  const vacunas = vacunasConEstado(esquema, historialVacunaCompleto, futuras, pasadas, edadMeses, nacimiento);
  const aplicadas = vacunas.filter(v => v.puesta).length;
  const grupos = agruparVacunas(vacunas);

  const primero = new Date(mes.a, mes.m, 1);
  const huecos = (primero.getDay() + 6) % 7;
  const largo = new Date(mes.a, mes.m + 1, 0).getDate();

  return (
    <section className="pantalla pad" style={{ paddingTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div className="rotulo">{new Date(mes.a, mes.m, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' })}</div>
        <div style={{ display: 'flex', gap: 14 }}>
          <button onClick={() => setMes(m => ({ a: m.m ? m.a : m.a - 1, m: m.m ? m.m - 1 : 11 }))}
                  style={{ border: 0, background: 'none', padding: 0, fontSize: 13, fontWeight: 800, color: 'var(--text)' }} aria-label="Mes anterior">←</button>
          <button onClick={() => setMes(m => ({ a: m.m === 11 ? m.a + 1 : m.a, m: m.m === 11 ? 0 : m.m + 1 }))}
                  style={{ border: 0, background: 'none', padding: 0, fontSize: 13, fontWeight: 800, color: 'var(--text)' }} aria-label="Mes siguiente">→</button>
        </div>
      </div>
      <div className="semanas">{DIAS_SEMANA.map(d => <span key={d}>{d}</span>)}</div>
      <div className="cal">
        {Array.from({ length: huecos }).map((_, i) => <button key={'h' + i} className="off" disabled />)}
        {Array.from({ length: largo }).map((_, i) => {
          const n = i + 1;
          const marcas = marcaDia(new Date(mes.a, mes.m, n), { citas, vacunas, medicamentos });
          return (
            <button key={n} className={sel === n ? 'sel' : ''} onClick={() => setSel(sel === n ? null : n)}>
              {n}<span className="pts">{marcas.map(m => <span key={m} className={'pt ' + m} />)}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
        <span className="leyenda"><i className="cita" />Cita</span>
        <span className="leyenda"><i className="vturno" />Vacuna agendada</span>
        <span className="leyenda"><i className="proxima" />Vacuna próxima</span>
        <span className="leyenda"><i className="alerta" />Vacuna sin turno</span>
        <span className="leyenda"><i className="med" />Medicación</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '26px 0 8px' }}>
        <div className="rotulo">Esquema de vacunación</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--n-500)' }}>{aplicadas} de {vacunas.length} aplicadas</div>
          <button onClick={() => setHoja('esquema')} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 2 }} aria-label="Editar esquema de vacunas">
            <Icono tipo="editar" s={15} />
          </button>
        </div>
      </div>
      <hr className="regla" />
      {grupos.map(g => (
        <div key={g.base} style={{ padding: '13px 0', borderBottom: '1px solid var(--n-300)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{g.base}</span>
            {g.dosis.length > 1 && (
              <span className="estrellas" aria-label={g.dosis.filter(v => v.puesta).length + ' de ' + g.dosis.length + ' dosis'}>
                {g.dosis.map((v, i) => (
                  <Icono key={i} tipo={v.puesta ? 'estrellaLlena' : 'estrellaVacia'} s={14} />
                ))}
              </span>
            )}
          </div>
          {g.dosis.map(v => (
            <div key={v.id} className={'vac' + (v.puesta ? ' hecha' : '')}>
              <Icono tipo="vacuna" s={20} />
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{g.dosis.length > 1 ? v.nombre.split(' · ').pop() : v.edad}</span>
                {(g.dosis.length > 1 || v.atrasadaSinTurno) && (
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--n-600)', marginTop: 4 }}>
                    {[g.dosis.length > 1 ? v.edad : null, v.atrasadaSinTurno ? 'sin turno agendado' : null].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {v.atrasadaSinTurno
                  ? <button className="p urgente" onClick={() => setHoja({ prefillVacuna: v })} aria-label={'Agendar turno de ' + v.nombre}>Agendar</button>
                  : v.puesta
                    ? <span className="d">{new Date(v.puesta.iso || v.puesta.timestamp).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>
                    : <span className="p">Pendiente</span>}
                <button onClick={() => setHoja({ editarVacuna: v })} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 2 }}
                        aria-label={'Editar fecha de aplicación · ' + v.nombre}>
                  <Icono tipo="editar" s={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
      ))}
      {!grupos.length && <p style={{ color: 'var(--n-600)', fontSize: 13, marginTop: 10 }}>No hay dosis en el esquema.</p>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '26px 0 8px' }}>
        <div className="rotulo">Medicación</div>
      </div>
      <hr className="regla" />
      {medicamentos.map(m => {
        const fin = new Date(new Date(m.inicio).getTime() + m.dias * 86400000);
        const vigente = Date.now() <= fin.getTime();
        const tomasDelMed = tomasMed.filter(t => t.medId === m.id).sort((a, b) => b.iso.localeCompare(a.iso));
        const ultimaToma = tomasDelMed[0] ? new Date(tomasDelMed[0].iso) : null;
        return (
          <div key={m.id} className="med-item">
            <Icono tipo="medicamento" s={20} />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{m.nombre}</span>
              <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--n-600)', marginTop: 4 }}>
                Cada {m.frecuenciaHoras} h · {m.dias} días · {tomasDelMed.length} {tomasDelMed.length === 1 ? 'toma' : 'tomas'}{!vigente ? ' · terminado' : ''}
              </span>
              <button onClick={() => setHoja({ editarToma: m })}
                      style={{ display: 'block', border: 0, background: 'none', padding: 0, marginTop: 5, color: 'var(--accent-600)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em' }}>
                {ultimaToma ? 'Última toma: hace ' + hace(ultimaToma) : 'Sin tomas · cargar a mano'}
              </button>
            </span>
            {vigente && (
              <button className="btn btn-secundario" style={{ width: 'auto', padding: '8px 12px', fontSize: 10.5 }}
                      onClick={() => onRegistrarToma(m.id)}>
                Tomé ahora
              </button>
            )}
            <button onClick={() => setHoja(m)} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label={'Editar ' + m.nombre}>
              <Icono tipo="editar" s={15} />
            </button>
          </div>
        );
      })}
      {!medicamentos.length && <p style={{ color: 'var(--n-600)', fontSize: 13, marginTop: 10 }}>No hay medicación en curso.</p>}
      <button className="btn btn-secundario" style={{ marginTop: 14 }} onClick={() => setHoja('medNueva')}>
        <Icono tipo="mas" s={16} /> Agregar medicación
      </button>

      {hoja === 'esquema' && (
        <HojaEsquema esquema={esquema} onGuardar={onEsquemaChange} onCerrar={() => setHoja(null)} />
      )}
      {(hoja === 'medNueva' || (hoja && hoja.id && hoja.dias !== undefined)) && (
        <HojaMedicamento
          medicamento={hoja === 'medNueva' ? null : hoja}
          onCerrar={() => setHoja(null)}
          onGuardar={m => { onGuardarMedicamento(m, hoja === 'medNueva'); setHoja(null); }}
          onBorrar={m => { onBorrarMedicamento(m); setHoja(null); }}
        />
      )}
      {hoja && hoja.prefillVacuna && (
        <HojaCita
          cita={null}
          prefillVacuna={hoja.prefillVacuna}
          onCerrar={() => setHoja(null)}
          onGuardar={c => { onGuardarCita(c, true); setHoja(null); }}
          onBorrar={() => setHoja(null)}
        />
      )}
      {hoja && hoja.editarToma && (
        <EditarInicioSheet
          kicker="Medicación"
          titulo={'Última toma · ' + hoja.editarToma.nombre}
          etiqueta="Se tomó a las"
          valorInicial={(() => {
            const t = tomasMed.filter(x => x.medId === hoja.editarToma.id).sort((a, b) => b.iso.localeCompare(a.iso))[0];
            return aLocal(t ? new Date(t.iso) : new Date());
          })()}
          onBorrar={tomasMed.some(t => t.medId === hoja.editarToma.id) ? () => { onBorrarToma(hoja.editarToma.id); setHoja(null); } : undefined}
          onCerrar={() => setHoja(null)}
          onGuardar={valor => { onEditarToma(hoja.editarToma.id, deLocalISO(valor)); setHoja(null); }}
        />
      )}
      {hoja && hoja.editarVacuna && (
        <EditarInicioSheet
          kicker="Vacunas"
          titulo={hoja.editarVacuna.nombre}
          etiqueta="Se aplicó el"
          valorInicial={aLocal(hoja.editarVacuna.puesta ? new Date(hoja.editarVacuna.puesta.iso || hoja.editarVacuna.puesta.timestamp) : new Date())}
          onBorrar={hoja.editarVacuna.puesta && filaReal(hoja.editarVacuna.puesta.fila) ? () => { onBorrarVacuna(hoja.editarVacuna); setHoja(null); } : undefined}
          onCerrar={() => setHoja(null)}
          onGuardar={valor => { onEditarVacuna(hoja.editarVacuna, deLocalISO(valor)); setHoja(null); }}
        />
      )}
    </section>
  );
}

function HojaMedicamento({ medicamento, onCerrar, onGuardar, onBorrar }) {
  const [nombre, setNombre] = useState(medicamento ? medicamento.nombre : '');
  const [dias, setDias] = useState(medicamento ? String(medicamento.dias) : '7');
  const [frecuenciaHoras, setFrecuenciaHoras] = useState(medicamento ? String(medicamento.frecuenciaHoras) : '8');
  const [inicio, setInicio] = useState(aLocal(medicamento ? new Date(medicamento.inicio) : new Date()));

  return (
    <>
      <div className="fondo" onClick={onCerrar} />
      <div className="hoja" role="dialog" aria-label="Medicación">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="kicker">{medicamento ? 'Editar' : 'Nueva'}</div>
            <h2 style={{ textTransform: 'none' }}>{medicamento ? medicamento.nombre : 'Medicación'}</h2>
          </div>
          <button onClick={onCerrar} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Cerrar">
            <Icono tipo="cerrar" s={22} />
          </button>
        </div>
        <hr className="regla" style={{ margin: '16px 0 0' }} />
        <div className="campo">
          <span className="rotulo">Medicamento</span>
          <input className="entrada-texto" placeholder="ej. Amoxicilina" value={nombre} onChange={e => setNombre(e.target.value)} />
        </div>
        <div className="campo">
          <span className="rotulo">Empieza</span>
          <input className="entrada-texto" type="datetime-local" value={inicio} onChange={e => setInicio(e.target.value)} />
        </div>
        <div className="campo">
          <span className="rotulo">Cantidad de días</span>
          <input className="entrada-texto" inputMode="numeric" value={dias} onChange={e => setDias(e.target.value)} />
        </div>
        <div className="campo" style={{ borderBottom: 0 }}>
          <span className="rotulo">Cada cuántas horas</span>
          <input className="entrada-texto" inputMode="numeric" value={frecuenciaHoras} onChange={e => setFrecuenciaHoras(e.target.value)} />
        </div>
        <div className="acciones">
          <button onClick={() => (medicamento ? onBorrar(medicamento) : onCerrar())}>{medicamento ? 'Borrar' : 'Cancelar'}</button>
          <button className="guardar" disabled={!nombre.trim() || !Number(dias) || !Number(frecuenciaHoras)}
                  onClick={() => onGuardar({
                    id: medicamento ? medicamento.id : 'm' + Date.now(), fila: medicamento ? medicamento.fila : undefined,
                    nombre: nombre.trim(), dias: Number(dias), frecuenciaHoras: Number(frecuenciaHoras),
                    inicio: deLocalISO(inicio),
                  })}>
            Guardar
          </button>
        </div>
      </div>
    </>
  );
}

function HojaEsquema({ esquema, onGuardar, onCerrar }) {
  const [lista, setLista] = useState(esquema);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [mesNuevo, setMesNuevo] = useState('');

  function actualizar(nueva) {
    setLista(nueva);
    onGuardar(nueva);
  }

  function agregar() {
    if (!nombreNuevo.trim()) return;
    actualizar([...lista, { id: 'v' + Date.now(), nombre: nombreNuevo.trim(), mes: Number(mesNuevo) || 0 }]
      .sort((a, b) => a.mes - b.mes));
    setNombreNuevo('');
    setMesNuevo('');
  }

  return (
    <>
      <div className="fondo" onClick={onCerrar} />
      <div className="hoja" role="dialog" aria-label="Esquema de vacunas">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="kicker">Editar</div>
            <h2>Esquema de vacunas</h2>
          </div>
          <button onClick={onCerrar} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Cerrar">
            <Icono tipo="cerrar" s={22} />
          </button>
        </div>
        <hr className="regla" style={{ margin: '16px 0 0' }} />
        <p style={{ fontSize: 11.5, color: 'var(--n-600)', margin: '12px 0 0' }}>
          Ajustá el nombre y la edad (en meses) de cada dosis según el esquema que te haya dado el pediatra.
        </p>
        {lista.map((v, i) => (
          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 0', borderBottom: '1px solid var(--n-300)' }}>
            <input className="entrada-texto" style={{ flex: 1 }} value={v.nombre}
                   onChange={e => actualizar(lista.map(x => x.id === v.id ? { ...x, nombre: e.target.value } : x))} />
            <input className="entrada-texto" type="number" inputMode="numeric" style={{ width: 64 }} value={v.mes}
                   onChange={e => actualizar(lista.map(x => x.id === v.id ? { ...x, mes: Number(e.target.value) || 0 } : x))} />
            <span style={{ fontSize: 10.5, color: 'var(--n-500)' }}>m</span>
            <button onClick={() => actualizar(lista.filter(x => x.id !== v.id))}
                    style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label={'Borrar ' + v.nombre}>
              <Icono tipo="cerrar" s={16} />
            </button>
          </div>
        ))}
        {!lista.length && <p style={{ color: 'var(--n-600)', fontSize: 13 }}>No hay dosis en el esquema.</p>}
        <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
          <input className="entrada-texto" placeholder="Nueva dosis, ej. Refuerzo · 18 m" value={nombreNuevo}
                 onChange={e => setNombreNuevo(e.target.value)} style={{ flex: 1 }} />
          <input className="entrada-texto" type="number" inputMode="numeric" placeholder="Mes" value={mesNuevo}
                 onChange={e => setMesNuevo(e.target.value)} style={{ width: 64 }} />
          <button className="btn btn-primario" style={{ width: 'auto', padding: '0 18px' }} onClick={agregar}>Agregar</button>
        </div>
      </div>
    </>
  );
}

// Hoja genérica para editar UN valor de fecha/hora a mano (se reutiliza para
// la hora de inicio del cronómetro en curso, la última toma de un
// medicamento y la fecha de aplicación de una dosis de vacuna).
function EditarInicioSheet({ valorInicial, onCerrar, onGuardar, onBorrar, kicker = 'Editar en curso', titulo = 'Hora de inicio', etiqueta = 'Empezó a las' }) {
  const [valor, setValor] = useState(valorInicial);
  const ahoraLocal = aLocal(new Date());
  return (
    <>
      <div className="fondo" onClick={onCerrar} />
      <div className="hoja" role="dialog" aria-label={titulo}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="kicker">{kicker}</div>
            <h2 style={{ textTransform: 'none' }}>{titulo}</h2>
          </div>
          <button onClick={onCerrar} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Cerrar">
            <Icono tipo="cerrar" s={22} />
          </button>
        </div>
        <hr className="regla" style={{ margin: '16px 0 0' }} />
        <div className="campo" style={{ borderBottom: 0 }}>
          <span className="rotulo">{etiqueta}</span>
          <input className="entrada-texto" type="datetime-local" max={ahoraLocal} value={valor} onChange={e => setValor(e.target.value)} />
        </div>
        <div className="acciones">
          <button onClick={onBorrar || onCerrar}>{onBorrar ? 'Borrar' : 'Cancelar'}</button>
          <button className="guardar" onClick={() => onGuardar(valor > ahoraLocal ? ahoraLocal : valor)}>Guardar</button>
        </div>
      </div>
    </>
  );
}

function HojaDetalle({ hoja, esquema, registros, historialVacuna, perfil, onCerrar, onGuardar, onBorrar, onReanudar }) {
  const campos = DETALLE[hoja.tipo] || [];
  const esCrono = hoja.tipo === 'teta' || hoja.tipo === 'sueño';
  const conHora = hoja.modo === 'editar' || esCrono;
  const [valores, setValores] = useState(() => {
    const v = {};
    // !== '' (no truthy): una duración de 0 es un valor real, no "vacío".
    campos.forEach(c => { if (hoja.valores[c.campo] !== undefined && hoja.valores[c.campo] !== '') v[c.campo] = hoja.valores[c.campo]; });
    if (hoja.valores.notas) v.notas = hoja.valores.notas;
    return v;
  });
  const [hora, setHora] = useState(() => aLocal(hoja.modo === 'editar' ? fecha(hoja.valores) : new Date()));
  const ahoraLocal = aLocal(new Date());
  // Nunca en el futuro (rompería el cálculo de "hace"/hora de fin): si se
  // llega a cargar una hora posterior a ahora, se recorta a este momento.
  const limpiarHora = valor => (valor > ahoraLocal ? ahoraLocal : valor);
  const limpiarDuracion = v => {
    if (v.duracion_minutos === undefined || v.duracion_minutos === '') return v;
    const n = Number(v.duracion_minutos);
    return { ...v, duracion_minutos: (!Number.isFinite(n) || n < 0) ? 0 : n };
  };
  const [otraVacuna, setOtraVacuna] = useState(false);
  const set = (campo, valor) => setValores(v => ({ ...v, [campo]: v[campo] === valor ? '' : valor }));

  // Al registrar una vacuna, se elige de las dosis del esquema que todavía no
  // se aplicaron: así la app sabe sola si es "1ª" o "2ª" según lo que ya
  // esté cargado, en vez de tener que escribirlo a mano.
  const opcionesVacuna = useMemo(() => {
    if (hoja.tipo !== 'vacuna') return [];
    const nacimiento = perfil?.nacimiento || NACIMIENTO;
    const edadMeses = mesesDeVida(nacimiento);
    // Se usa el historial completo (no sólo la ventana corta de "registros")
    // para no ofrecer como "pendiente" una dosis que ya se cargó hace tiempo.
    const registrosVacuna = [...(registros || []).filter(r => r.tipo_evento === 'vacuna'), ...(historialVacuna || [])];
    return vacunasConEstado(esquema || [], registrosVacuna, [], [], edadMeses, nacimiento)
      .filter(v => !v.puesta)
      .map(v => v.nombre);
  }, [hoja.tipo, esquema, registros, historialVacuna, perfil]);

  return (
    <>
      <div className="fondo" onClick={onCerrar} />
      <div className="hoja" role="dialog" aria-label={'Detalle de ' + hoja.tipo}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="kicker">{hoja.modo === 'editar' ? 'Editar' : 'Detalle'} · {reloj(new Date())}</div>
            <h2>{hoja.tipo}</h2>
          </div>
          <button onClick={onCerrar} style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Cerrar">
            <Icono tipo="cerrar" s={22} />
          </button>
        </div>
        <hr className="regla" style={{ margin: '16px 0 0' }} />

        {conHora && (
          <div className="campo">
            <span className="rotulo">{esCrono ? 'Empezó a las' : 'Hora'}</span>
            <input className="entrada-texto" type="datetime-local" max={ahoraLocal}
                   value={hora} onChange={e => setHora(e.target.value)} />
          </div>
        )}

        {campos.map(c => (
          <div className="campo" key={c.campo}>
            <span className="rotulo">{c.label}</span>
            {hoja.tipo === 'vacuna' && c.campo === 'dosis' ? (
              <>
                <div className="opciones" style={{ flexWrap: 'wrap' }}>
                  {opcionesVacuna.map(o => (
                    <button key={o} className={valores.dosis === o ? 'on' : ''}
                            onClick={() => { set('dosis', o); setOtraVacuna(false); }}>{o}</button>
                  ))}
                  <button className={otraVacuna ? 'on' : ''} onClick={() => setOtraVacuna(x => !x)}>Otra…</button>
                </div>
                {(otraVacuna || (valores.dosis && !opcionesVacuna.includes(valores.dosis))) && (
                  <input className="entrada-texto" style={{ marginTop: 8 }} placeholder="Nombre de la vacuna"
                         value={valores.dosis || ''} onChange={e => setValores(v => ({ ...v, dosis: e.target.value }))} />
                )}
                {!opcionesVacuna.length && !otraVacuna && !valores.dosis && (
                  <p style={{ fontSize: 11, color: 'var(--n-600)', marginTop: 8 }}>No quedan dosis pendientes en el esquema.</p>
                )}
              </>
            ) : c.libre ? (
              <input className="entrada-texto" inputMode={c.numerico ? 'decimal' : 'text'} placeholder={c.label}
                     value={valores[c.campo] || ''} onChange={e => set(c.campo, e.target.value)} />
            ) : (
              <div className="opciones">
                {c.ops.map(o => (
                  <button key={o} className={valores[c.campo] === o ? 'on' : ''} onClick={() => set(c.campo, o)}>{o}</button>
                ))}
              </div>
            )}
          </div>
        ))}

        <div className="campo" style={{ borderBottom: 0 }}>
          <span className="rotulo">Nota</span>
          <textarea className="entrada-texto" rows={3} placeholder="Opcional"
                 value={valores.notas || ''} onChange={e => setValores(v => ({ ...v, notas: e.target.value }))} />
        </div>

        {onReanudar && (
          <button className="btn btn-secundario" style={{ marginTop: 4 }} onClick={onReanudar}>
            <Icono tipo="reloj" s={16} /> Retomar cronómetro
          </button>
        )}

        <div className="acciones">
          <button onClick={hoja.modo === 'editar' ? onBorrar : onCerrar}>
            {hoja.modo === 'editar' ? 'Borrar' : 'Cancelar'}
          </button>
          <button className="guardar" disabled={hoja.tipo === 'vacuna' && !valores.dosis}
                  onClick={() => onGuardar(limpiarDuracion(conHora ? { ...valores, timestamp: deLocalISO(limpiarHora(hora)) } : valores))}>
            Guardar
          </button>
        </div>
      </div>
    </>
  );
}
