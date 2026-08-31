/**
 * Emma · backend (Google Apps Script + Google Sheet) — v2
 *
 * Compatible con los datos que ya tienes: no reordena ni borra nada.
 * Al arrancar lee la fila 1 (encabezados) y AÑADE al final las columnas que
 * falten. Las filas viejas quedan con esos campos en blanco.
 *
 * Columnas que usa (por nombre, no por posición):
 *   timestamp · tipo_evento · duracion_minutos · notas          (ya existían)
 *   lado · cantidad_ml · contenido · consistencia · color ·
 *   crema · dosis · peso_kg · talla_cm · cliente_hora           (nuevas)
 *   archivo_url · archivo_nombre                                (estudios/archivos)
 *
 * El perfil (nombre y fecha de nacimiento) y los archivos subidos ("estudios")
 * viven aparte: el perfil en PropertiesService, los archivos en una carpeta de
 * Drive ("Emma · estudios") con el link guardado en la fila del registro.
 *
 * Instalación: pegar en el editor de Apps Script del Sheet, guardar,
 * Implementar → Nueva implementación → Aplicación web → acceso "cualquiera".
 * La URL /exec resultante va en app/src/api.js (constante URL_APP).
 */

var HOJA = 'registros';
var COLUMNAS = [
  'timestamp', 'tipo_evento', 'duracion_minutos', 'notas',
  'lado', 'cantidad_ml', 'contenido', 'consistencia', 'color',
  'crema', 'dosis', 'peso_kg', 'talla_cm', 'cliente_hora',
  'archivo_url', 'archivo_nombre', 'archivo_categoria'
];

function hoja_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HOJA) || ss.getSheets()[0];
  var ancho = Math.max(sh.getLastColumn(), 1);
  var encabezados = sh.getRange(1, 1, 1, ancho).getValues()[0].map(function (h) { return String(h).trim(); });
  // añade al final las columnas que falten (migración no destructiva)
  COLUMNAS.forEach(function (c) {
    if (encabezados.indexOf(c) === -1) {
      encabezados.push(c);
      sh.getRange(1, encabezados.length).setValue(c);
    }
  });
  return { sh: sh, cols: encabezados };
}

function indice_(cols, nombre) { return cols.indexOf(nombre) + 1; }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function leerRegistros_(limite) {
  var h = hoja_(), sh = h.sh, cols = h.cols;
  var ultima = sh.getLastRow();
  if (ultima < 2) return [];
  var desde = limite ? Math.max(2, ultima - limite + 1) : 2;
  var filas = sh.getRange(desde, 1, ultima - desde + 1, cols.length).getValues();
  var out = [];
  for (var i = filas.length - 1; i >= 0; i--) {
    var f = filas[i], r = { fila: desde + i };
    cols.forEach(function (c, j) { if (c) r[c] = f[j] === '' ? '' : f[j]; });
    if (!r.tipo_evento) continue;
    r.iso = r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp);
    out.push(r);
  }
  return out;
}

function estado_() {
  var raw = PropertiesService.getScriptProperties().getProperty('estado');
  return raw ? JSON.parse(raw) : { activo: false };
}
function guardarEstado_(e) {
  PropertiesService.getScriptProperties().setProperty('estado', JSON.stringify(e));
}

function perfil_() {
  var raw = PropertiesService.getScriptProperties().getProperty('perfil');
  return raw ? JSON.parse(raw) : { nombre: 'Emma', nacimiento: '2026-04-19' };
}
function guardarPerfil_(p) {
  PropertiesService.getScriptProperties().setProperty('perfil', JSON.stringify(p));
}

// Carpeta de Drive donde se guardan los archivos subidos ("estudios").
// Se crea una sola vez y se recuerda el id en las propiedades del script.
function carpetaEstudios_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('carpeta_estudios');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* la carpeta ya no existe, se crea de nuevo */ }
  }
  var carpeta = DriveApp.getRootFolder().createFolder('Emma · estudios');
  props.setProperty('carpeta_estudios', carpeta.getId());
  return carpeta;
}

// Ejecutar esta función UNA VEZ a mano desde el editor (▶ Ejecutar, con esta
// función elegida en el desplegable de arriba) para autorizar el permiso de
// Drive. Sin este paso, subir_archivo falla con "No cuentas con el permiso".
function autorizarDrive() {
  var carpeta = carpetaEstudios_();
  Logger.log('Carpeta de estudios lista: ' + carpeta.getUrl());
}

function escribir_(datos) {
  var h = hoja_(), sh = h.sh, cols = h.cols;
  var fila = new Array(cols.length).fill('');
  fila[indice_(cols, 'timestamp') - 1] = new Date();
  cols.forEach(function (c, j) { if (datos[c] !== undefined && c !== 'timestamp') fila[j] = datos[c]; });
  sh.appendRow(fila);
  return sh.getLastRow();
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var b = JSON.parse(e.postData.contents);

    if (b.accion === 'iniciar') {
      guardarEstado_({ activo: true, tipo_evento: b.tipo_evento, inicio: new Date().toISOString() });
      return json_({ ok: true, mensaje: 'Cronómetro en marcha', estado: estado_() });
    }

    if (b.accion === 'detener') {
      var est = estado_();
      if (!est.activo) return json_({ ok: false, mensaje: 'No había nada en marcha' });
      var min = Math.max(1, Math.round((new Date() - new Date(est.inicio)) / 60000));
      var datos = { tipo_evento: est.tipo_evento, duracion_minutos: min };
      COLUMNAS.forEach(function (c) { if (b[c] !== undefined) datos[c] = b[c]; });
      escribir_(datos);
      guardarEstado_({ activo: false });
      return json_({ ok: true, mensaje: est.tipo_evento + ': ' + min + ' min' });
    }

    if (b.accion === 'corregir') {
      var h = hoja_(), sh = h.sh, cols = h.cols;
      COLUMNAS.forEach(function (c) {
        if (b[c] === undefined) return;
        var valor = (c === 'timestamp') ? new Date(b[c]) : b[c];
        sh.getRange(b.fila, indice_(cols, c)).setValue(valor);
      });
      return json_({ ok: true, mensaje: 'Registro actualizado' });
    }

    if (b.accion === 'eliminar') {
      hoja_().sh.deleteRow(b.fila);
      return json_({ ok: true, mensaje: 'Registro eliminado' });
    }

    if (b.accion === 'eliminar_ultimo') {
      var sh2 = hoja_().sh, ult = sh2.getLastRow();
      if (ult > 1) sh2.deleteRow(ult);
      return json_({ ok: true, mensaje: 'Deshecho' });
    }

    if (b.accion === 'perfil') {
      var p = perfil_();
      if (b.nombre !== undefined) p.nombre = b.nombre;
      if (b.nacimiento !== undefined) p.nacimiento = b.nacimiento;
      guardarPerfil_(p);
      return json_({ ok: true, mensaje: 'Datos guardados', perfil: p });
    }

    if (b.accion === 'subir_archivo') {
      if (!b.datos) return json_({ ok: false, mensaje: 'Sin archivo' });
      var bytes = Utilities.base64Decode(b.datos);
      var blob = Utilities.newBlob(bytes, b.tipo || 'application/octet-stream', b.nombre || 'archivo');
      var archivo = carpetaEstudios_().createFile(blob);
      archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      escribir_({
        tipo_evento: 'estudio',
        notas: b.descripcion || '',
        archivo_url: archivo.getUrl(),
        archivo_nombre: archivo.getName(),
        archivo_categoria: b.categoria || 'Otro',
        cliente_hora: b.cliente_hora
      });
      return json_({ ok: true, mensaje: 'Archivo subido', url: archivo.getUrl() });
    }

    // registro rápido: cualquier tipo_evento con sus campos opcionales
    var datos2 = {};
    COLUMNAS.forEach(function (c) { if (b[c] !== undefined) datos2[c] = b[c]; });
    datos2.tipo_evento = b.tipo_evento;
    escribir_(datos2);
    return json_({ ok: true, mensaje: b.tipo_evento + ' registrado' });
  } catch (err) {
    return json_({ ok: false, mensaje: 'Error: ' + err });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var action = (e.parameter.action || 'inicial');

  if (action === 'estado') return json_(Object.assign({ ok: true }, estado_()));
  if (action === 'ultimos') return json_({ ok: true, registros: leerRegistros_(60) });
  if (action === 'perfil') return json_(Object.assign({ ok: true }, perfil_()));

  if (action === 'estudios') {
    var todos = leerRegistros_(); // sin límite: que no se pierdan estudios viejos entre el ruido diario
    return json_({ ok: true, registros: todos.filter(function (r) { return r.tipo_evento === 'estudio'; }) });
  }

  if (action === 'semana') {
    var regs = leerRegistros_(600);
    var dias = [], nombres = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
      var fin = new Date(d); fin.setDate(d.getDate() + 1);
      var delDia = regs.filter(function (r) { var t = new Date(r.iso); return t >= d && t < fin; });
      dias.push({
        dia: nombres[d.getDay()],
        fecha: Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM'),
        tomas: delDia.filter(function (r) { return r.tipo_evento === 'teta'; }).length,
        sueno_horas: delDia.filter(function (r) { return r.tipo_evento === 'sueño'; })
          .reduce(function (a, r) { return a + (Number(r.duracion_minutos) || 0); }, 0) / 60,
        panales: delDia.filter(function (r) { return ['pañal', 'pis', 'caca'].indexOf(r.tipo_evento) >= 0; }).length
      });
    }
    var pesos = regs.filter(function (r) { return r.peso_kg; });
    var peso = pesos.length ? {
      kg: pesos[0].peso_kg, cm: pesos[0].talla_cm || '',
      fecha: Utilities.formatDate(new Date(pesos[0].iso), Session.getScriptTimeZone(), 'dd/MM/yyyy')
    } : null;
    return json_({
      ok: true, dias: dias, peso: peso,
      max_tomas: Math.max.apply(null, dias.map(function (d) { return d.tomas; }).concat([1]))
    });
  }

  // inicial: estado del cronómetro + últimos registros + perfil en una sola llamada
  return json_({ ok: true, estado: estado_(), registros: leerRegistros_(60), perfil: perfil_() });
}
