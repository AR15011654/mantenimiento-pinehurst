import { useEffect, useState } from 'react';

type Aviso = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const w = window as unknown as { __instalar?: Aviso };

/** Ofrece crear el ícono de la app en el teléfono. No se muestra si ya se abrió desde el ícono. */
export default function InstalarApp() {
  const instalada = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const [aviso, setAviso] = useState<Aviso | undefined>(w.__instalar);
  const [oculto, setOculto] = useState(() => { try { return localStorage.getItem('ocultar-instalar') === '1'; } catch { return false; } });
  useEffect(() => {
    const f = () => setAviso(w.__instalar);
    window.addEventListener('instalable', f);
    return () => window.removeEventListener('instalable', f);
  }, []);
  if (instalada || oculto) return null;

  const ua = navigator.userAgent;
  const iphone = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  const cerrar = () => { setOculto(true); try { localStorage.setItem('ocultar-instalar', '1'); } catch { /* sin almacenamiento */ } };

  let contenido;
  if (aviso) {
    contenido = <button className="btn btn-pri" onClick={async () => { await aviso.prompt(); await aviso.userChoice; w.__instalar = undefined; setAviso(undefined); }}>Instalar la app en este teléfono</button>;
  } else if (iphone) {
    contenido = <span>En Safari toque <b>Compartir</b> (cuadro con flecha hacia arriba) y luego <b>Agregar a inicio</b>.</span>;
  } else if (android) {
    contenido = <span>En Chrome toque el menú <b>⋮</b> y luego <b>Agregar a la pantalla principal</b> o <b>Instalar app</b>.</span>;
  } else {
    return null;
  }
  return (
    <div className="instalar">
      <img src="./icono-192.png" alt="" width={44} height={44} />
      <div className="instalar-texto"><b>Tenga la app en su teléfono</b><br />{contenido}</div>
      <button className="instalar-cerrar" aria-label="Ocultar" onClick={cerrar}>✕</button>
    </div>
  );
}
