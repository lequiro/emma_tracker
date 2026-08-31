import React from 'react';

// Iconos de trazo 2px, familia propia (reemplazan a los emoji).
const S = ({ s = 24, children, w = 2 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth={w} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">{children}</svg>
);

export const Iconos = {
  teta: p => <S {...p}><path d="M11 2h2v2h-2z" /><path d="M10 4h4v3h-4z" /><path d="M8.5 7h7v11a3 3 0 0 1-3 3h-1a3 3 0 0 1-3-3z" /><path d="M8.5 12h7" /></S>,
  'sueño': p => <S {...p}><path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11z" /></S>,
  pis: p => <S {...p}><path d="M12 2.5c3.5 4 6 7.4 6 10.5a6 6 0 0 1-12 0c0-3.1 2.5-6.5 6-10.5z" /></S>,
  caca: p => <S {...p}><path d="M4.5 21h15a2.5 2.5 0 0 0 0-5h-1.5a2.5 2.5 0 0 0-1-4.8h-1.2a2.4 2.4 0 0 0-1.3-4.2c.6-1.6-.4-3.5-2.5-4" /><path d="M4.5 21a2.5 2.5 0 0 1 0-5" /></S>,
  'pañal': p => <S {...p}><path d="M3.5 6.5h17v3.5c0 5.5-3.8 9.5-8.5 11.5C7.3 19.5 3.5 15.5 3.5 10z" /><path d="M3.5 10.5h17" /></S>,
  'baño': p => <S {...p}><path d="M2.5 12.5h19V16a4 4 0 0 1-4 4H6.5a4 4 0 0 1-4-4z" /><path d="M6.5 12.5V6a2.5 2.5 0 0 1 5 0" /><path d="M6 21l-1 1.5M18 21l1 1.5" /></S>,
  vacuna: p => <S {...p}><path d="M20 4l-3-1" /><path d="M20 4l1 3" /><path d="M20 4L6 18" /><path d="M6 18l-2 4" /><path d="M9 9l2 2" /><path d="M12 6l2 2" /></S>,
  peso: p => <S {...p}><path d="M4 20h16l-2.5-9h-11z" /><path d="M12 11V4" /><path d="M8.5 5.5h7" /></S>,
  reloj: p => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 12V7M12 12l4 3" /></S>,
  registrar: p => <S {...p}><path d="M4 4h16v16H4z" /><path d="M12 8v8M8 12h8" /></S>,
  barras: p => <S {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></S>,
  ajustes: p => <S {...p}><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="8" cy="17" r="2" /></S>,
  cerrar: p => <S {...p}><path d="M5 5l14 14M19 5L5 19" /></S>,
  imprimir: p => <S {...p}><path d="M7 9V3h10v6" /><path d="M5 9h14a2 2 0 0 1 2 2v6h-4v4H7v-4H3v-6a2 2 0 0 1 2-2z" /></S>,
  documento: p => <S {...p}><path d="M6 2.5h9l4 4V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" /><path d="M14.5 2.5V7h4.5" /><path d="M8.5 12.5h7M8.5 16h7" /></S>,
  estudio: p => <S {...p}><path d="M6 2.5h9l4 4V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" /><path d="M14.5 2.5V7h4.5" /><path d="M8.5 12.5h7M8.5 16h7" /></S>,
  subir: p => <S {...p}><path d="M12 20V6" /><path d="M6 11l6-6 6 6" /><path d="M4.5 20h15" /></S>,
  editar: p => <S {...p}><path d="M4 20l1-4.5L15.5 5l3.5 3.5L8.5 19z" /><path d="M13.5 6.5l4 4" /></S>,
};

export function Icono({ tipo, s = 24 }) {
  const F = Iconos[tipo] || Iconos.pis;
  return <F s={s} />;
}

// La marca de la app: cara de bebé de trazo continuo.
export function Marca({ s = 40, color = 'currentColor' }) {
  return (
    <svg width={s} height={s} viewBox="0 0 48 48" fill="none" stroke={color}
         strokeWidth="2.8" strokeLinecap="round" aria-label="Emma">
      <circle cx="24" cy="27" r="13" />
      <path d="M11 16q13-10 26 0" />
      <circle cx="19" cy="25" r="1.8" fill={color} stroke="none" />
      <circle cx="29" cy="25" r="1.8" fill={color} stroke="none" />
      <path d="M20 32q4 3 8 0" />
    </svg>
  );
}
