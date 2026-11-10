import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
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

/** Flecha para regresar a la pantalla anterior (o al inicio si se abrió directo). */
export function Volver() {
  const navigate = useNavigate();
  const regresar = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1); else navigate('/');
  };
  return <button type="button" className="volver" aria-label="Regresar" title="Regresar" onClick={regresar}>←</button>;
}

export function Titulo({ children, sub, sinVolver }: { children: ReactNode; sub?: ReactNode; sinVolver?: boolean }) {
  return (
    <header className="titulo">
      <div className="titulo-fila">{!sinVolver && <Volver />}<h1>{children}</h1></div>
      {sub && <p className="sub">{sub}</p>}
    </header>
  );
}
