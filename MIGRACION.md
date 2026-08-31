# Emma tracker v2 — cómo pasar de la versión actual a esta

Todo lo que sigue reemplaza al `index.html` de una sola pieza. La app se sigue
sirviendo desde `https://lequiro.github.io/emma_tracker/` y sigue guardando en
la misma Google Sheet.

## 1. Archivos

```
app/                      ← la app React (Vite)
  index.html
  package.json
  vite.config.js          base: '/emma_tracker/'
  src/{main.jsx,App.jsx,api.js,icons.jsx,styles.css}
  public/{manifest.json,service-worker.js,icon-192.png,icon-512.png,icon-maskable-512.png}
.github/workflows/deploy.yml
apps-script/Codigo.gs     ← pegar en el editor de Apps Script
```

Se pueden borrar del repo: el `index.html` viejo, `manifest.json`,
`service-worker.js`, `icon-192.png` e `icon-512.png` de la raíz (sus versiones
nuevas viven dentro de `app/public/`).

## 2. Backend (primero esto)

1. Abrir el Sheet → Extensiones → Apps Script.
2. Reemplazar el código por `apps-script/Codigo.gs`.
3. Si la pestaña de datos no se llama `registros`, cambiar la constante `HOJA`.
4. Implementar → **Nueva implementación** → Aplicación web → ejecutar como tú,
   acceso "cualquiera". Copiar la URL `/exec`.
5. Pegar esa URL en `app/src/api.js` (`URL_APP`). Si la implementación es una
   actualización de la anterior, la URL no cambia y no hay que tocar nada.

La migración es automática y no destructiva: al primer pedido, el script lee la
fila 1 y **añade al final** las columnas que falten (`lado`, `cantidad_ml`,
`contenido`, `consistencia`, `color`, `crema`, `dosis`, `peso_kg`, `talla_cm`,
`cliente_hora`). Las filas viejas quedan en blanco en esos campos y se siguen
leyendo igual. Conviene duplicar la hoja antes, por las dudas.

## 3. Frontend

```bash
cd app
npm install          # genera package-lock.json — commitéalo, el workflow lo usa
npm run dev          # desarrollo
npm run build        # sale en app/dist
```

## 4. Publicación

En GitHub: Settings → Pages → **Source: GitHub Actions**. Con eso, cada push a
`main` compila y publica (`.github/workflows/deploy.yml`). No hace falta
commitear `dist/`.

## 5. Después de publicar

El service worker viejo (`emma-tracker-v1`) sigue cacheado en los teléfonos ya
instalados. El nuevo se llama `emma-tracker-v2` y borra las cachés anteriores al
activarse, pero puede tardar una recarga en tomar. Si algún teléfono queda
mostrando la versión vieja: cerrar la app, volver a abrirla dos veces.

## Qué cambió en la app

- **Cronómetro en marcha** como franja roja a pantalla completa, con el número
  grande y un botón "Parar" de tamaño pulgar. El estado sigue viviendo en el
  servidor, así que se ve igual desde los dos teléfonos.
- **Registro rápido de 6 celdas**: pis, caca, pañal, baño, vitamina D, peso.
  Un toque registra; **mantener pulsado** abre la hoja de detalle (lado, ml,
  consistencia, dosis, peso/talla, nota). El registro es optimista y aparece en
  la lista antes de que responda el servidor, con "Deshacer".
- **Hoy**: línea del día con los tres números de cabecera.
- **Semana**: tomas por día, sueño por día, último peso, y "Resumen para el
  pediatra" que abre el diálogo de impresión (Guardar como PDF en el teléfono).
- **Ajustes**: estado de sincronización y re-sincronización manual.
- Emoji reemplazados por iconos de trazo 2px; tipografía Archivo; sin esquinas
  redondeadas; rojo `#ec3013` sólo para lo activo y lo primario.
- Icono nuevo (cara de bebé de trazo continuo) en 192, 512 y 512 maskable.

## Pendientes que dejé fuera a propósito

- Quién registró cada entrada (dijiste que no).
- Modo noche automático.
- Aviso de próxima toma.
- La fecha de nacimiento está fija en `App.jsx` (`NACIMIENTO`); si quieres
  editarla desde Ajustes hay que guardarla en el Sheet o en localStorage.
