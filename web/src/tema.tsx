import { useState } from 'react';

/** Tema claro u oscuro de la interfaz. Se guarda en este dispositivo. */
export type Tema = 'claro' | 'oscuro';
const CLAVE = 'tema';

export function temaGuardado(): Tema {
  try { return localStorage.getItem(CLAVE) === 'oscuro' ? 'oscuro' : 'claro'; } catch { return 'claro'; }
}
export function aplicarTema(t: Tema) {
  document.documentElement.dataset.tema = t;
  try { localStorage.setItem(CLAVE, t); } catch { /* sin almacenamiento */ }
}

/** Botón ☀ / ☾ para la barra superior. */
export function SelectorTema() {
  const [tema, setTema] = useState<Tema>(temaGuardado());
  const cambiar = () => { const t: Tema = tema === 'claro' ? 'oscuro' : 'claro'; aplicarTema(t); setTema(t); };
  return (
    <button type="button" className="tema" onClick={cambiar}
      aria-label={tema === 'claro' ? 'Cambiar a fondo oscuro' : 'Cambiar a fondo claro'} title={tema === 'claro' ? 'Cambiar a fondo oscuro' : 'Cambiar a fondo claro'}>
      {tema === 'claro' ? '☾' : '☀'}
    </button>
  );
}
