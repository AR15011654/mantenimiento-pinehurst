import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { Maquina, mensajeError, rpc, supabase } from '../lib';
import { Aviso, Campo, Titulo } from '../ui';

function errorCamara(e: unknown) {
  const n = (e as { name?: string })?.name ?? '';
  const m = String((e as Error)?.message ?? e);
  if (!window.isSecureContext) return 'La cámara solo funciona en una dirección segura (https). Use la búsqueda manual.';
  if (n === 'NotAllowedError' || /Permission|denied/i.test(m)) return 'No se dio permiso para usar la cámara. Actívelo en la configuración del navegador o use la búsqueda manual.';
  if (n === 'NotFoundError' || /no camera|not found|Requested device/i.test(m)) return 'No se encontró una cámara en este equipo. Use la búsqueda manual.';
  if (n === 'NotReadableError') return 'La cámara está siendo usada por otra aplicación.';
  return 'No se pudo abrir la cámara: ' + m;
}

export default function Escanear() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const modulo = params.get('m');
  const area = params.get('a');
  const [camara, setCamara] = useState(false);
  const [errCam, setErrCam] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<Maquina[] | null>(null);
  const [codigoLeido, setCodigoLeido] = useState<string>('');
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lector = useRef<Html5Qrcode | null>(null);

  async function detener() {
    try { if (lector.current?.isScanning) await lector.current.stop(); } catch { /* ya detenido */ }
    setCamara(false);
  }
  useEffect(() => () => { detener(); }, []);

  async function abrirCamara() {
    setErrCam(null); setResultados(null); setError(null);
    try {
      lector.current = lector.current ?? new Html5Qrcode('lector-qr', { verbose: false });
      setCamara(true);
      await lector.current.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decodificado) => { await detener(); buscarCodigo(decodificado); }, () => { /* sin lectura todavía */ });
    } catch (e) { setCamara(false); setErrCam(errorCamara(e)); }
  }

  async function buscarCodigo(codigo: string) {
    const c = codigo.trim(); if (!c) return;
    setBuscando(true); setError(null); setCodigoLeido(c);
    try {
      const r = await rpc<Maquina[]>('buscar_por_codigo', { p_codigo: c });
      if (r.length === 1) { nav(`/maquina/${r[0].id}?qr=${encodeURIComponent(c)}`); return; }
      setResultados(r);
    } catch (e) { setError((e as Error).message); }
    finally { setBuscando(false); }
  }

  async function buscarTexto(e: FormEvent) {
    e.preventDefault();
    const t = texto.trim(); if (!t) return;
    setBuscando(true); setError(null); setCodigoLeido('');
    try {
      // Primero coincidencia exacta de código; si no hay, búsqueda parcial.
      const exacta = await rpc<Maquina[]>('buscar_por_codigo', { p_codigo: t });
      if (exacta.length === 1) { nav(`/maquina/${exacta[0].id}?qr=${encodeURIComponent(t)}`); return; }
      const like = `"%${t.replace(/["%_,()\\]/g, ' ')}%"`;
      let q = supabase.from('v_maquinas').select('*')
        .or(`asset_id.ilike.${like},qr.ilike.${like},serie.ilike.${like},fabricante.ilike.${like},modelo.ilike.${like},tipo.ilike.${like},ubicacion.ilike.${like},grupo.ilike.${like}`)
        .order('asset_id').limit(60);
      if (modulo) q = q.eq('modulo_id', modulo);
      if (area) q = q.eq('area_id', area);
      const { data, error } = await q;
      if (error) throw error;
      setResultados(exacta.length > 1 ? exacta : (data as Maquina[]));
    } catch (e) { setError(mensajeError(e)); }
    finally { setBuscando(false); }
  }

  return (
    <main className="contenido">
      <Titulo sub="Escanee el QR de la máquina o búsquela por QR, serie, Asset ID, tipo, fabricante o ubicación.">Buscar máquina</Titulo>
      <div className="tarjeta">
        <div id="lector-qr" className={camara ? 'lector activo' : 'lector'} />
        {!camara
          ? <button className="btn btn-pri btn-grande" onClick={abrirCamara}>Abrir cámara</button>
          : <button className="btn btn-sec btn-grande" onClick={detener}>Cerrar cámara</button>}
        {errCam && <Aviso tipo="alerta">{errCam}</Aviso>}
      </div>
      <form className="tarjeta" onSubmit={buscarTexto}>
        <Campo etiqueta="Búsqueda manual">
          <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Ej.: tgdgtgi7, 149031, PEGASUS, LINE 11" autoCapitalize="characters" />
        </Campo>
        <button className="btn btn-pri btn-grande" disabled={buscando}>{buscando ? 'Buscando…' : 'Buscar'}</button>
      </form>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {resultados && (
        <section>
          {resultados.length === 0 && <Aviso tipo="alerta">No se encontró ninguna máquina{codigoLeido ? ` con el código ${codigoLeido}` : ''} en sus áreas autorizadas.</Aviso>}
          {resultados.length > 1 && codigoLeido && <Aviso tipo="alerta">El código {codigoLeido} corresponde a {resultados.length} máquinas. Elija la correcta.</Aviso>}
          <ul className="lista">
            {resultados.map(m => (
              <li key={m.id}>
                <Link to={`/maquina/${m.id}${codigoLeido ? `?qr=${encodeURIComponent(codigoLeido)}` : ''}`} className="item">
                  <b>{m.tipo ?? 'Sin tipo'}</b> · {m.fabricante ?? '—'} {m.modelo ?? ''}
                  <span className="item-sub">QR {m.qr ?? '—'} · Serie {m.serie ?? '—'} · {m.ubicacion ?? 'Sin ubicación'}{m.puesto ? ` / ${m.puesto}` : ''} · {m.area ?? m.modulo ?? 'Sin clasificar'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
