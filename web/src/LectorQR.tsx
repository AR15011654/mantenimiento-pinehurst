import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats as F } from 'html5-qrcode';

// QR y códigos de barras comunes (gafetes, etiquetas de repuestos, códigos de proveedor).
const FORMATOS = [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.DATA_MATRIX, F.PDF_417];

export function IconoQR() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor">
      <path d="M3 3h7v7H3V3zm2 2v3h3V5H5zm9-2h7v7h-7V3zm2 2v3h3V5h-3zM3 14h7v7H3v-7zm2 2v3h3v-3H5zm9-2h3v3h-3v-3zm4 0h3v3h-3v-3zm-4 4h3v3h-3v-3zm4 0h3v3h-3v-3z" />
    </svg>
  );
}

/** Botón que abre la cámara y devuelve el texto leído (QR o código de barras). Con `icono` se muestra como botón cuadrado junto a un campo. */
export default function LectorQR({ onLeido, texto = 'Escanear QR', icono = false, disabled = false }:
  { onLeido: (t: string) => void; texto?: string; icono?: boolean; disabled?: boolean }) {
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
    lector.current = new Html5Qrcode(id.current, { verbose: false, formatsToSupport: FORMATOS,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
    // Recuadro ancho para que quepan los códigos de barras; sigue sirviendo para QR.
    const recuadro = (w: number, h: number) => ({ width: Math.max(160, Math.floor(w * 0.85)), height: Math.max(120, Math.floor(Math.min(h, w) * 0.6)) });
    lector.current.start({ facingMode: 'environment' }, { fps: 10, qrbox: recuadro },
      async t => { await cerrar(); onLeido(t.trim()); }, () => {})
      .catch(e => {
        setAbierto(false);
        const n = (e as { name?: string })?.name;
        setError(!window.isSecureContext ? 'La cámara requiere https. Escriba el código.'
          : n === 'NotAllowedError' ? 'Permiso de cámara denegado. Escriba el código o habilite la cámara.'
          : 'No se pudo abrir la cámara. Escriba el código.');
      });
  }, [abierto, onLeido]);

  return (
    <>
      {icono
        ? <button type="button" className="btn-qr" disabled={disabled} aria-label={abierto ? 'Cerrar cámara' : texto}
            onClick={() => (abierto ? cerrar() : setAbierto(true))}>{abierto ? '✕' : <IconoQR />}</button>
        : <button type="button" className="btn btn-sec" disabled={disabled} onClick={() => (abierto ? cerrar() : setAbierto(true))}>{abierto ? 'Cerrar cámara' : texto}</button>}
      {abierto && <div id={id.current} className="lector activo" />}
      {error && <div className="aviso aviso-alerta">{error}</div>}
    </>
  );
}
