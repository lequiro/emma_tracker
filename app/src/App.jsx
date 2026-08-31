import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { consultar, llamar, leerCola, vaciarCola, subirArchivo } from './api.js';
import { Icono, Marca } from './icons.jsx';

const NACIMIENTO = '2026-04-19';          // ajustar en Ajustes → perfil
const PULSACION_LARGA = 420;              // ms
const UMBRAL_TETA_MS = 3 * 60 * 60 * 1000; // aviso "alimente" tras 3 h sin teta

const RAPIDOS = [
  { tipo: 'pis' }, { tipo: 'caca' }, { tipo: 'pañal' },
  { tipo: 'baño' }, { tipo: 'vacuna' }, { tipo: 'peso' },
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
    { campo: 'crema', label: 'Crema', ops: ['sí', 'no'] },
  ],
  'baño': [{ campo: 'duracion_minutos', label: 'Duración', ops: ['5', '10', '15'] }],
  vacuna: [{ campo: 'dosis', label: 'Vacuna', ops: [], libre: true }],
  peso: [
    { campo: 'peso_kg', label: 'Peso (kg)', ops: [], libre: true, numerico: true },
    { campo: 'talla_cm', label: 'Talla (cm)', ops: [], libre: true, numerico: true },
  ],
};

const dosD = n => String(n).padStart(2, '0');
const reloj = d => dosD(d.getHours()) + ':' + dosD(d.getMinutes());

function hace(desde) {
  const min = Math.floor((Date.now() - desde.getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return min + ' min';
  return Math.floor(min / 60) + ' h ' + dosD(min % 60);
}

function edad(iso) {
  const n = new Date(iso), h = new Date();
  let meses = (h.getFullYear() - n.getFullYear()) * 12 + h.getMonth() - n.getMonth();
  const ref = new Date(n); ref.setMonth(n.getMonth() + meses);
  if (ref > h) { meses -= 1; ref.setMonth(ref.getMonth() - 1); }
  const dias = Math.floor((h - ref) / 86400000);
  return meses + ' meses · ' + dias + ' días';
}

const fecha = r => new Date(r.iso || r.timestamp);

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
  return partes.join(' · ') || '—';
}

export default function App() {
  const [vista, setVista] = useState('registrar');
  const [registros, setRegistros] = useState([]);
  const [estado, setEstado] = useState(null);        // {tipo_evento, inicio} del servidor
  const [ahora, setAhora] = useState(Date.now());
  const [pendientes, setPendientes] = useState(leerCola().length);
  const [hoja, setHoja] = useState(null);            // {tipo, modo:'nuevo'|'editar', fila, valores}
  const [aviso, setAviso] = useState(null);
  const [semana, setSemana] = useState(null);
  const [estudios, setEstudios] = useState(null);
  const [perfil, setPerfil] = useState({ nombre: 'Emma', nacimiento: NACIMIENTO });
  const [avisoTeta, setAvisoTeta] = useState(false);
  const [notifPermiso, setNotifPermiso] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'no-disponible'
  );
  const pulsacion = useRef(null);
  const sostenido = useRef(false);
  const avisadoRef = useRef(false);
  const perfilCargado = useRef(false); // sólo se toma del servidor una vez, para no pisar una edición en curso

  const ultimaTeta = useMemo(() => {
    const r = registros.find(x => x.tipo_evento === 'teta');
    return r ? fecha(r) : null;
  }, [registros]);

  const refrescar = useCallback(() => {
    consultar('inicial').then(res => {
      if (!res.ok) return;
      setRegistros(res.registros || []);
      setEstado(res.estado && res.estado.activo ? res.estado : null);
      if (res.perfil && !perfilCargado.current) {
        setPerfil(res.perfil);
        perfilCargado.current = true;
      }
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

  useEffect(() => {
    if (vista === 'semana' && !semana) consultar('semana').then(r => r.ok && setSemana(r));
  }, [vista, semana]);

  const cargarEstudios = useCallback(() => {
    consultar('estudios').then(r => r.ok && setEstudios(r.registros || []));
  }, []);

  useEffect(() => {
    if (vista === 'estudios' && !estudios) cargarEstudios();
  }, [vista, estudios, cargarEstudios]);

  // Aviso "Alimente al ácaro" 3 h después de la última toma.
  useEffect(() => {
    avisadoRef.current = false;
    setAvisoTeta(false);
  }, [ultimaTeta ? ultimaTeta.getTime() : null]);

  useEffect(() => {
    if (!ultimaTeta || avisadoRef.current) return;
    if (ahora - ultimaTeta.getTime() >= UMBRAL_TETA_MS) {
      avisadoRef.current = true;
      setAvisoTeta(true);
      if (notifPermiso === 'granted') {
        try { new Notification('Alimente al ácaro', { body: 'Pasaron 3 horas desde la última toma.' }); } catch {}
      }
    }
  }, [ahora, ultimaTeta, notifPermiso]);

  function notificar(texto, deshacer) {
    setAviso({ texto, deshacer });
    clearTimeout(notificar.t);
    notificar.t = setTimeout(() => setAviso(null), 3600);
  }

  function registrar(tipo, extra = {}) {
    const optimista = {
      fila: 'tmp-' + Date.now(), tipo_evento: tipo,
      iso: new Date().toISOString(), duracion_minutos: '', notas: '', ...extra,
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
      notificar(tipo + ' · ' + min + ' min guardados');
    } else if (!estado) {
      setEstado({ tipo_evento: tipo, inicio: new Date().toISOString(), activo: true });
      llamar({ accion: 'iniciar', tipo_evento: tipo }).then(res => {
        if (res.estado) setEstado(res.estado);
        if (res.offline) setPendientes(leerCola().length);
      });
    }
  }

  // Un toque registra; mantener pulsado abre el detalle.
  const alPulsar = tipo => () => {
    sostenido.current = false;
    clearTimeout(pulsacion.current);
    pulsacion.current = setTimeout(() => {
      sostenido.current = true;
      if (navigator.vibrate) navigator.vibrate(12);
      setHoja({ tipo, modo: 'nuevo', valores: {} });
    }, PULSACION_LARGA);
  };
  const alSoltar = tipo => () => {
    clearTimeout(pulsacion.current);
    if (!sostenido.current) registrar(tipo);
  };
  const cancelar = () => clearTimeout(pulsacion.current);

  const enMarcha = estado ? Math.floor((ahora - new Date(estado.inicio)) / 1000) : 0;
  const cronoTexto = dosD(Math.floor(enMarcha / 3600)) + ':' + dosD(Math.floor(enMarcha / 60) % 60) + ':' + dosD(enMarcha % 60);

  const ultimo = tipo => {
    const r = registros.find(x => x.tipo_evento === tipo);
    return r ? 'Hace ' + hace(fecha(r)) : 'Sin registros';
  };

  // Los "estudios" tienen su propia pestaña; no se mezclan con el feed diario.
  const registrosDiarios = useMemo(() => registros.filter(r => r.tipo_evento !== 'estudio'), [registros]);

  const delDia = useMemo(() => {
    const hoy = new Date().toDateString();
    return registrosDiarios.filter(r => fecha(r).toDateString() === hoy);
  }, [registrosDiarios]);

  return (
    <div className="app">
      <header className="cab">
        <div>
          <h1>{perfil.nombre}</h1>
          <div className="edad">{edad(perfil.nacimiento)}</div>
        </div>
        <Marca s={30} color="var(--accent)" />
      </header>
      {pendientes > 0 && (
        <div className="cola">{pendientes} {pendientes === 1 ? 'registro pendiente' : 'registros pendientes'} de enviar</div>
      )}
      {avisoTeta && (
        <button className="cola alerta" onClick={() => setAvisoTeta(false)}>
          Alimente al ácaro · última toma hace {hace(ultimaTeta)}
        </button>
      )}

      {vista === 'registrar' && (
        <section className="pantalla">
          {estado && (
            <div className="marcha">
              <div className="et"><Icono tipo="reloj" s={15} /> En marcha · {estado.tipo_evento}</div>
              <div className="fila">
                <div className="num">{cronoTexto}</div>
                <button onClick={() => cronometro(estado.tipo_evento)}>Parar</button>
              </div>
            </div>
          )}

          <div className="pad" style={{ paddingTop: 16 }}>
            <div className="rotulo" style={{ marginBottom: 10 }}>Cronómetro</div>
            <div className="rejilla dos">
              {['teta', 'sueño'].map(t => (
                <button key={t} className="celda" disabled={!!estado && estado.tipo_evento !== t}
                        onClick={() => cronometro(t)}>
                  <Icono tipo={t} s={30} />
                  <div>
                    <div className="t" style={{ textTransform: 'capitalize' }}>{t}</div>
                    <div className="s">{ultimo(t)}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="pad" style={{ paddingTop: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div className="rotulo">Registro rápido</div>
              <div style={{ fontSize: 10, color: 'var(--n-500)' }}>Mantén pulsado para detalle</div>
            </div>
            <div className="rejilla tres">
              {RAPIDOS.map(({ tipo, etiqueta }) => (
                <button key={tipo} className="celda"
                        onPointerDown={alPulsar(tipo)} onPointerUp={alSoltar(tipo)}
                        onPointerLeave={cancelar} onContextMenu={e => e.preventDefault()}>
                  <Icono tipo={tipo} s={24} />
                  <div className="t" style={{ textTransform: 'capitalize' }}>{etiqueta || tipo}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="pad" style={{ paddingTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <div className="rotulo">Últimos registros</div>
              <button onClick={() => setVista('hoy')}
                      style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                Ver el día
              </button>
            </div>
            <hr className="regla" />
            {registrosDiarios.slice(0, 6).map(r => (
              <button key={r.fila} className="entrada"
                      onClick={() => setHoja({ tipo: r.tipo_evento, modo: 'editar', fila: r.fila, valores: r })}>
                <Icono tipo={r.tipo_evento} s={20} />
                <span>
                  <span className="t">{r.tipo_evento}</span>
                  <span className="s">{resumen(r)}</span>
                </span>
                <span className="h">{hace(fecha(r))}<span>{reloj(fecha(r))}</span></span>
              </button>
            ))}
            {!registrosDiarios.length && <p style={{ color: 'var(--n-600)', fontSize: 13 }}>Sin registros todavía.</p>}
          </div>
        </section>
      )}

      {vista === 'hoy' && (
        <section className="pantalla pad" style={{ paddingTop: 14 }}>
          <div className="numeros" style={{ marginBottom: 20 }}>
            <div><b>{delDia.filter(r => r.tipo_evento === 'teta').length}</b><span>Tomas</span></div>
            <div><b>{delDia.filter(r => r.tipo_evento === 'sueño').length}</b><span>Sueños</span></div>
            <div><b>{delDia.filter(r => ['pañal', 'pis', 'caca'].includes(r.tipo_evento)).length}</b><span>Pañales</span></div>
          </div>
          <div className="rotulo" style={{ marginBottom: 8 }}>Línea del día</div>
          <hr className="regla" />
          {delDia.map(r => (
            <button key={r.fila} className="linea"
                    onClick={() => setHoja({ tipo: r.tipo_evento, modo: 'editar', fila: r.fila, valores: r })}>
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

      {vista === 'semana' && (
        <section className="pantalla pad" style={{ paddingTop: 14 }}>
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

          <div className="rotulo" style={{ margin: '26px 0 10px' }}>Sueño por día</div>
          <hr className="regla" />
          {(semana?.dias || []).map((d, i) => (
            <div className="sueno" key={d.dia}>
              <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--n-600)' }}>{d.dia}</span>
              <span className="pista"><i style={{ width: Math.round((d.sueno_horas / 14) * 100) + '%', background: i === 6 ? 'var(--accent)' : 'var(--n-700)' }} /></span>
              <span className="v">{Math.floor(d.sueno_horas)} h {dosD(Math.round((d.sueno_horas % 1) * 60))}</span>
            </div>
          ))}

          {semana?.peso && (
            <>
              <div className="rotulo" style={{ margin: '26px 0 10px' }}>Peso</div>
              <hr className="regla" />
              <div style={{ padding: '14px 0 16px', borderBottom: '1px solid var(--n-300)' }}>
                <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1 }}>
                  {semana.peso.kg} <span style={{ fontSize: 16 }}>kg</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--n-600)', marginTop: 6 }}>{semana.peso.fecha} · {semana.peso.cm} cm</div>
              </div>
            </>
          )}

          <button className="btn btn-primario" style={{ marginTop: 18 }} onClick={() => window.print()}>
            <Icono tipo="imprimir" s={16} /> Resumen para el pediatra
          </button>
          {!semana && <p style={{ color: 'var(--n-600)', fontSize: 13, marginTop: 16 }}>Cargando la semana…</p>}
        </section>
      )}

      {vista === 'estudios' && (
        <PantallaEstudios
          estudios={estudios}
          onSubido={() => { setEstudios(null); cargarEstudios(); }}
          onBorrar={fila => {
            llamar({ accion: 'eliminar', fila }).then(() => { setEstudios(null); cargarEstudios(); });
          }}
        />
      )}

      {vista === 'ajustes' && (
        <section className="pantalla pad" style={{ paddingTop: 14 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', paddingBottom: 16, borderBottom: '2px solid var(--divider)' }}>
            <div style={{ width: 64, height: 64, background: 'var(--accent)', display: 'grid', placeItems: 'center', flex: 'none' }}>
              <Marca s={38} color="var(--bg)" />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{perfil.nombre}</div>
              <div style={{ fontSize: 11.5, color: 'var(--n-600)', marginTop: 5 }}>{edad(perfil.nacimiento)}</div>
            </div>
          </div>

          <div className="rotulo" style={{ margin: '20px 0 8px' }}>Editar datos</div>
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
          <div style={{ padding: '12px 0', borderBottom: '1px solid var(--n-300)', fontSize: 13.5 }}>
            {registros.length} registros cargados
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
        </section>
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
        />
      )}

      {aviso && (
        <div className="aviso">
          <span>{aviso.texto}</span>
          {aviso.deshacer && <button onClick={() => { aviso.deshacer(); setAviso(null); }}>Deshacer</button>}
        </div>
      )}

      <nav className="tabs">
        {[['registrar', 'Registrar'], ['hoy', 'Hoy'], ['semana', 'Semana'], ['estudios', 'Estudios'], ['ajustes', 'Ajustes']].map(([id, txt]) => (
          <button key={id} className={vista === id ? 'on' : ''} onClick={() => setVista(id)}>
            <Icono tipo={{ registrar: 'registrar', hoy: 'reloj', semana: 'barras', estudios: 'documento', ajustes: 'ajustes' }[id]} s={21} />
            {txt}
          </button>
        ))}
      </nav>
    </div>
  );
}

const MAX_BYTES_ARCHIVO = 15 * 1024 * 1024;
const CATEGORIAS_ESTUDIO = ['Ecografía', 'Análisis', 'Vacunas', 'Pediatra', 'Otro'];

function PantallaEstudios({ estudios, onSubido, onBorrar }) {
  const [archivo, setArchivo] = useState(null);
  const [descripcion, setDescripcion] = useState('');
  const [categoria, setCategoria] = useState('Otro');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const grupos = useMemo(() => {
    if (!estudios) return null;
    const porCategoria = {};
    estudios.forEach(r => {
      const cat = r.archivo_categoria || 'Otro';
      (porCategoria[cat] = porCategoria[cat] || []).push(r);
    });
    const orden = [
      ...CATEGORIAS_ESTUDIO.filter(c => porCategoria[c]),
      ...Object.keys(porCategoria).filter(c => !CATEGORIAS_ESTUDIO.includes(c)),
    ];
    return orden.map(cat => ({ cat, items: porCategoria[cat] }));
  }, [estudios]);

  function elegirArchivo(e) {
    const f = e.target.files[0] || null;
    setError('');
    if (f && f.size > MAX_BYTES_ARCHIVO) {
      setError('Archivo muy grande (máx. 15 MB).');
      setArchivo(null);
      if (inputRef.current) inputRef.current.value = '';
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
          setCategoria('Otro');
          if (inputRef.current) inputRef.current.value = '';
          onSubido();
        } else {
          setError(res.mensaje || 'No se pudo subir. Probá de nuevo.');
        }
      });
    };
    lector.onerror = () => { setSubiendo(false); setError('No se pudo leer el archivo.'); };
    lector.readAsDataURL(archivo);
  }

  return (
    <section className="pantalla pad" style={{ paddingTop: 14 }}>
      <div className="rotulo" style={{ marginBottom: 8 }}>Subir estudio</div>
      <hr className="regla" style={{ marginBottom: 12 }} />
      <div className="subida">
        <Icono tipo="subir" s={26} />
        <input ref={inputRef} type="file" accept="image/*,application/pdf" onChange={elegirArchivo} />
        <input className="entrada-texto" placeholder="Descripción (opcional) · ej. Ecografía 20 semanas"
               value={descripcion} onChange={e => setDescripcion(e.target.value)} style={{ marginTop: 6 }} />
        <div className="opciones" style={{ marginTop: 8, width: '100%', flexWrap: 'wrap' }}>
          {CATEGORIAS_ESTUDIO.map(c => (
            <button key={c} type="button" className={categoria === c ? 'on' : ''} onClick={() => setCategoria(c)}>{c}</button>
          ))}
        </div>
        {error && <div style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>{error}</div>}
        <button className="btn btn-primario" style={{ marginTop: 8 }} disabled={!archivo || subiendo} onClick={subir}>
          {subiendo ? 'Subiendo…' : 'Subir'}
        </button>
      </div>

      <div className="rotulo" style={{ margin: '24px 0 8px' }}>Estudios guardados</div>
      {estudios === null && <><hr className="regla" /><p style={{ color: 'var(--n-600)', fontSize: 13, marginTop: 10 }}>Cargando…</p></>}
      {estudios && !estudios.length && <><hr className="regla" /><p style={{ color: 'var(--n-600)', fontSize: 13, marginTop: 10 }}>Todavía no subiste nada.</p></>}
      {grupos && grupos.map(g => (
        <div key={g.cat}>
          <div className="rotulo" style={{ margin: '14px 0 6px', color: 'var(--accent)' }}>{g.cat}</div>
          <hr className="regla" />
          {g.items.map(r => (
            <div key={r.fila} className="archivo">
              <Icono tipo="documento" s={20} />
              <a href={r.archivo_url} target="_blank" rel="noreferrer">
                <span className="t">{r.notas || r.archivo_nombre}</span>
                <span className="s">{r.archivo_nombre}{r.iso ? ' · ' + new Date(r.iso).toLocaleDateString('es') : ''}</span>
              </a>
              <button onClick={() => onBorrar(r.fila)}
                      style={{ border: 0, background: 'none', color: 'var(--n-600)', padding: 4 }} aria-label="Borrar">
                <Icono tipo="cerrar" s={16} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function HojaDetalle({ hoja, onCerrar, onGuardar, onBorrar }) {
  const campos = DETALLE[hoja.tipo] || [];
  const [valores, setValores] = useState(() => {
    const v = {};
    campos.forEach(c => { if (hoja.valores[c.campo]) v[c.campo] = hoja.valores[c.campo]; });
    if (hoja.valores.notas) v.notas = hoja.valores.notas;
    return v;
  });
  const [hora, setHora] = useState(() => aLocal(hoja.modo === 'editar' ? fecha(hoja.valores) : new Date()));
  const set = (campo, valor) => setValores(v => ({ ...v, [campo]: v[campo] === valor ? '' : valor }));

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

        {hoja.modo === 'editar' && (
          <div className="campo">
            <span className="rotulo">Hora</span>
            <input className="entrada-texto" type="datetime-local"
                   value={hora} onChange={e => setHora(e.target.value)} />
          </div>
        )}

        {campos.map(c => (
          <div className="campo" key={c.campo}>
            <span className="rotulo">{c.label}</span>
            {c.libre ? (
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
          <input className="entrada-texto" placeholder="Opcional"
                 value={valores.notas || ''} onChange={e => setValores(v => ({ ...v, notas: e.target.value }))} />
        </div>

        <div className="acciones">
          <button onClick={hoja.modo === 'editar' ? onBorrar : onCerrar}>
            {hoja.modo === 'editar' ? 'Borrar' : 'Cancelar'}
          </button>
          <button className="guardar"
                  onClick={() => onGuardar(hoja.modo === 'editar' ? { ...valores, timestamp: deLocalISO(hora) } : valores)}>
            Guardar
          </button>
        </div>
      </div>
    </>
  );
}
