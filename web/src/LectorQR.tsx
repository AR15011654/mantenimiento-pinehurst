import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

/** Botón que abre la cámara y devuelve el texto leído. */
export default function LectorQR({ onLeido, texto = 'Escanear QR' }: { onLeido: (t: string) => void; texto?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lector = useRef<Html5Qrcode | null>(null);
  const id = useRef('qr-' + Math.random().toString(36).slice(2));

  async function cerrar() {
    try { if (lector.current?.isScanning) await lector.current.stop(); } catch { /* ignorar */ }
    setAbierto(false);
  }
  useEffect(() => () => { cerrar(); }, []);

  useEffect(() => {
    if (!abierto) return;
    setError(null);
    lector.current = new Html5Qrcode(id.current, { verbose: false });
    lector.current.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } },
      async t => { await cerrar(); onLeido(t.trim()); }, () => {})
      .catch(e => {
        const n = (e as { name?: string })?.name;
        setError(!window.isSecureContext ? 'La cámara requiere https. Escriba el código.'
          : n === 'NotAllowedError' ? 'Permiso de cámara denegado. Escriba el código o habilite la cámara.'
          : 'No se pudo abrir la cámara. Escriba el código.');
      });
  }, [abierto, onLeido]);

  return (
    <>
      <button type="button" className="btn btn-sec" onClick={() => (abierto ? cerrar() : setAbierto(true))}>{abierto ? 'Cerrar cámara' : texto}</button>
      {abierto && <div id={id.current} className="lector activo" />}
      {error && <div className="aviso aviso-alerta">{error}</div>}
    </>
  );
}
