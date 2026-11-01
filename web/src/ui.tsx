import { ReactNode } from 'react';
import { ESTADOS } from './lib';

export function Aviso({ tipo, children, onReintentar }: { tipo: 'ok' | 'error' | 'info' | 'alerta'; children: ReactNode; onReintentar?: () => void }) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onReintentar && <button className="btn btn-sec btn-chico" onClick={onReintentar}>Reintentar</button>}
    </div>
  );
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return <div className="cargando" aria-live="polite">{texto}</div>;
}

export function Insignia({ estado }: { estado: string }) {
  return <span className={`insignia est-${estado}`}>{ESTADOS[estado] ?? estado}</span>;
}

export function Campo({ etiqueta, children, ayuda }: { etiqueta: string; children: ReactNode; ayuda?: string }) {
  return (
    <label className="campo">
      <span className="campo-etiqueta">{etiqueta}</span>
      {children}
      {ayuda && <span className="campo-ayuda">{ayuda}</span>}
    </label>
  );
}

export function Dato({ k, v }: { k: string; v: ReactNode }) {
  return <div className="dato"><dt>{k}</dt><dd>{v === null || v === undefined || v === '' ? '—' : v}</dd></div>;
}

export function Titulo({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return <header className="titulo"><h1>{children}</h1>{sub && <p className="sub">{sub}</p>}</header>;
}
