import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { fecha, fechaHora, FRECUENCIAS, Maquina, mensajeError, nuevaClave, rpc, supabase } from '../lib';
import { useModulo, useSesion } from '../sesion';
import { Aviso } from '../ui';
import LectorQR from '../LectorQR';
import { Articulo, cargarArticulos, num, SelectorArticulo } from '../inventario';

type Mecanico = { encontrado: boolean; id?: string; codigo?: string; nombre?: string; autorizado?: boolean; mensaje: string };
type Trabajo = { id: string; folio: number; inicio_en: string | null; retomado?: boolean };
type Foto = { clave: string; blob: Blob; url: string; subida: boolean };
type Doc = { clave: string; blob: Blob; nombre: string; mime: string; ext: string; url: string; subido: boolean };
type Repuesto = { clave: string; articulo: Articulo; cantidad: number; registrado: boolean };
type Resultado = { folio: number; fin_en: string; maquina: string; mecanico: string; frecuencia: string | null; proximo: string | null };

async function reducirImagen(f: File): Promise<Blob> {
  const img = await createImageBitmap(f);
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, mal) => c.toBlob(b => (b ? ok(b) : mal(new Error('No se pudo procesar la foto'))), 'image/jpeg', 0.82));
}

const nombreMaquina = (m: Maquina) => [m.tipo, m.fabricante, m.modelo].filter(Boolean).join(' · ') || m.asset_id;

/**
 * Registro de mantenimiento en una sola pantalla:
 * QR máquina → QR mecánico → tipo (aquí el servidor guarda la hora de inicio) → comentario y foto → Finalizar (hora de cierre del servidor).
 */
export default function Registro() {
  const { codigo } = useParams();
  const modulo = useModulo(codigo);
  const { sesion } = useSesion();
  const soloPropio = sesion?.usuario?.perfil === 'tecnico' && !sesion?.usuario?.puede_registrar_otros;

  const [qr, setQr] = useState('');
  const [maquina, setMaquina] = useState<Maquina | null>(null);
  const [opciones, setOpciones] = useState<Maquina[]>([]);
  const [errMaq, setErrMaq] = useState<string | null>(null);
  const [codMec, setCodMec] = useState(soloPropio ? sesion?.empleado?.codigo ?? '' : '');
  const [mec, setMec] = useState<Mecanico | null>(null);
  const [errMec, setErrMec] = useState<string | null>(null);
  const [tipo, setTipo] = useState<'preventivo' | 'correctivo' | ''>('');
  const [trabajo, setTrabajo] = useState<Trabajo | null>(null);
  const [iniciando, setIniciando] = useState(false);
  const [errInicio, setErrInicio] = useState<string | null>(null);
  const [comentario, setComentario] = useState('');
  const [comGuardado, setComGuardado] = useState('');
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [finalizando, setFinalizando] = useState(false);
  const [errFin, setErrFin] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [externo, setExterno] = useState<'' | 'si' | 'no'>('');
  const [proveedor, setProveedor] = useState('');
  const [costo, setCosto] = useState('');
  const [moneda, setMoneda] = useState<'USD' | 'HNL'>('USD');
  const [docs, setDocs] = useState<Doc[]>([]);
  const [inventario, setInventario] = useState<Articulo[]>([]);
  const [repAbierto, setRepAbierto] = useState(false);
  const [repuestos, setRepuestos] = useState<Repuesto[]>([]);
  const [repArt, setRepArt] = useState<Articulo | null>(null);
  const [repCant, setRepCant] = useState('');
  const [errRep, setErrRep] = useState<string | null>(null);
  const claves = useRef({ inicio: nuevaClave(), comentario: nuevaClave(), fin: nuevaClave() });

  function limpiar() {
    fotos.forEach(f => URL.revokeObjectURL(f.url));
    setQr(''); setMaquina(null); setOpciones([]); setErrMaq(null);
    setCodMec(soloPropio ? sesion?.empleado?.codigo ?? '' : ''); setMec(null); setErrMec(null);
    setTipo(''); setTrabajo(null); setErrInicio(null); setComentario(''); setComGuardado(''); setFotos([]);
    docs.forEach(d => URL.revokeObjectURL(d.url)); setExterno(''); setProveedor(''); setCosto(''); setMoneda('USD'); setDocs([]);
    setRepAbierto(false); setRepuestos([]); setRepArt(null); setRepCant(''); setErrRep(null);
    setErrFin(null); setResultado(null);
    claves.current = { inicio: nuevaClave(), comentario: nuevaClave(), fin: nuevaClave() };
    window.scrollTo(0, 0);
  }

  // Repuestos del inventario del módulo (si tiene catálogo).
  const cargarInventario = useCallback(async () => {
    if (!modulo) return;
    try { setInventario(await cargarArticulos(modulo.id)); } catch { setInventario([]); }
  }, [modulo]);
  useEffect(() => { cargarInventario(); }, [cargarInventario]);

  function agregarRepuesto() {
    setErrRep(null);
    const cant = Number(repCant.replace(',', '.'));
    if (!repArt) { setErrRep('Elija el repuesto.'); return; }
    if (!repCant.trim() || !Number.isFinite(cant) || cant <= 0) { setErrRep('Escriba la cantidad.'); return; }
    const ya = repuestos.filter(r => r.articulo.id === repArt.id && !r.registrado).reduce((s2, r) => s2 + r.cantidad, 0);
    if (ya + cant > repArt.existencia) { setErrRep(`Solo hay ${num(repArt.existencia)} en existencia de ${repArt.codigo}.`); return; }
    setRepuestos(rs => [...rs, { clave: nuevaClave(), articulo: repArt, cantidad: cant, registrado: false }]);
    setRepArt(null); setRepCant('');
  }

  // 1. Máquina
  async function buscarMaquina(c: string) {
    const t = c.trim();
    setMaquina(null); setOpciones([]); setErrMaq(null); setMec(null);
    if (!t || !modulo) return;
    try {
      const r = await rpc<Maquina[]>('buscar_por_codigo', { p_codigo: t });
      const delModulo = r.filter(m => m.modulo_id === modulo.id);
      if (delModulo.length === 1) setMaquina(delModulo[0]);
      else if (delModulo.length > 1) setOpciones(delModulo);
      else if (r.length > 0) setErrMaq(`Esa máquina pertenece a otro módulo (${r[0].modulo ?? 'sin clasificar'}).`);
      else setErrMaq(`No se encontró ninguna máquina con el código ${t} en sus áreas.`);
    } catch (e) { setErrMaq((e as Error).message); }
  }

  // 2. Mecánico (se valida contra el área de la máquina)
  const verificarMecanico = useCallback(async (c: string, m: Maquina | null) => {
    setMec(null); setErrMec(null);
    if (!c.trim() || !m) return;
    try {
      const r = await rpc<Mecanico>('buscar_mecanico', { p_codigo: c.trim(), p_maquina_id: m.id });
      setMec(r);
      if (!r.encontrado || !r.autorizado) setErrMec(r.mensaje);
    } catch (e) { setErrMec((e as Error).message); }
  }, []);
  useEffect(() => { if (maquina && codMec) verificarMecanico(codMec, maquina); }, [maquina]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. Inicio automático en cuanto hay máquina, mecánico autorizado y tipo. Si ya había uno en proceso, se retoma.
  useEffect(() => {
    if (!maquina || !mec?.autorizado || !tipo || trabajo || iniciando || errInicio) return;
    (async () => {
      setIniciando(true);
      try {
        const ex = await supabase.from('mantenimientos').select('id, folio, inicio_en')
          .eq('maquina_id', maquina.id).eq('mecanico_id', mec.id!).eq('estado', 'en_proceso').maybeSingle();
        if (ex.error) throw ex.error;
        if (ex.data) { setTrabajo({ ...(ex.data as Trabajo), retomado: true }); return; }
        const r = await rpc<Trabajo>('iniciar_mantenimiento', {
          p_maquina_id: maquina.id, p_tipo: tipo, p_codigo_mecanico: codMec.trim(), p_qr_leido: qr.trim(), p_idempotency_key: claves.current.inicio,
        });
        setTrabajo(r);
      } catch (e) { setErrInicio(mensajeError(e)); }
      finally { setIniciando(false); }
    })();
  }, [maquina, mec, tipo, trabajo, iniciando, errInicio, codMec, qr]);

  async function agregarFotos(lista: FileList | null) {
    if (!lista) return;
    const nuevas: Foto[] = [];
    for (const f of Array.from(lista)) {
      try { const blob = await reducirImagen(f); nuevas.push({ clave: nuevaClave(), blob, url: URL.createObjectURL(blob), subida: false }); }
      catch (e) { setErrFin((e as Error).message); }
    }
    setFotos(fs => [...fs, ...nuevas]);
  }

  // Cotización o factura: foto (se reduce a JPEG) o archivo digital (PDF o imagen, hasta 10 MB).
  async function agregarDocs(lista: FileList | null) {
    if (!lista) return;
    const nuevos: Doc[] = [];
    for (const f of Array.from(lista)) {
      try {
        if (f.type === 'application/pdf') {
          if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name}: el archivo pasa de 10 MB.`);
          nuevos.push({ clave: nuevaClave(), blob: f, nombre: f.name, mime: f.type, ext: 'pdf', url: URL.createObjectURL(f), subido: false });
        } else if (f.type.startsWith('image/')) {
          const blob = await reducirImagen(f);
          nuevos.push({ clave: nuevaClave(), blob, nombre: f.name || 'foto.jpg', mime: 'image/jpeg', ext: 'jpg', url: URL.createObjectURL(blob), subido: false });
        } else throw new Error(`${f.name}: solo se aceptan fotos o PDF.`);
      } catch (e) { setErrFin((e as Error).message); }
    }
    setDocs(ds => [...ds, ...nuevos]);
  }

  // 4. Finalizar: guarda comentario y fotos, y el servidor registra la fecha y hora de cierre.
  async function finalizar() {
    if (!trabajo || !maquina || !mec) return;
    const montoTxt = costo.replace(/[$,\s]/g, '');
    const monto = Number(montoTxt);
    if (externo === 'si') {
      if (!proveedor.trim()) { setErrFin('Escriba el proveedor del servicio externo.'); return; }
      if (!montoTxt || !Number.isFinite(monto) || monto < 0) { setErrFin('Escriba el costo del servicio externo.'); return; }
    }
    setFinalizando(true); setErrFin(null);
    try {
      const c = comentario.trim();
      if (c && c !== comGuardado) {
        await rpc('agregar_comentario', { p_mantenimiento_id: trabajo.id, p_texto: c, p_idempotency_key: claves.current.comentario });
        setComGuardado(c);
      }
      for (const f of fotos) {
        if (f.subida) continue;
        const ruta = `${trabajo.id}/${f.clave}.jpg`;
        const up = await supabase.storage.from('mant-evidencias').upload(ruta, f.blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error && !/exist|duplicate/i.test(up.error.message)) throw new Error('No se pudo subir una foto: ' + mensajeError(up.error));
        await rpc('registrar_foto', { p_mantenimiento_id: trabajo.id, p_ruta: ruta, p_tamano: f.blob.size, p_mime: 'image/jpeg' });
        f.subida = true;
      }
      // Repuestos usados: cada uno es una salida del inventario ligada a este trabajo.
      for (const r of repuestos) {
        if (r.registrado) continue;
        await rpc('inv_registrar_salida', { p_articulo_id: r.articulo.id, p_cantidad: r.cantidad, p_codigo_empleado: null, p_maquina_id: null,
          p_mantenimiento_id: trabajo.id, p_observacion: null, p_idempotency_key: r.clave });
        r.registrado = true;
      }
      if (repuestos.length) { setRepuestos(rs => [...rs]); cargarInventario(); }
      if (externo === 'si') {
        await rpc('registrar_servicio_externo', { p_mantenimiento_id: trabajo.id, p_proveedor: proveedor.trim(), p_costo: monto, p_moneda: moneda });
        for (const d of docs) {
          if (d.subido) continue;
          const ruta = `${trabajo.id}/docs/${d.clave}.${d.ext}`;
          const up = await supabase.storage.from('mant-evidencias').upload(ruta, d.blob, { contentType: d.mime, upsert: false });
          if (up.error && !/exist|duplicate/i.test(up.error.message)) throw new Error('No se pudo subir la cotización o factura: ' + mensajeError(up.error));
          await rpc('registrar_documento', { p_mantenimiento_id: trabajo.id, p_ruta: ruta, p_nombre: d.nombre, p_mime: d.mime, p_tamano: d.blob.size });
          d.subido = true;
        }
      }
      // Si el administrador lo había reabierto, se abre un nuevo período antes de cerrar.
      const per = await supabase.from('mantenimiento_periodos').select('id').eq('mantenimiento_id', trabajo.id).is('fin_en', null);
      if (!per.error && (per.data ?? []).length === 0) await rpc('reanudar_mantenimiento', { p_mantenimiento_id: trabajo.id });
      const r = await rpc<{ folio: number; fin_en: string }>('finalizar_mantenimiento', { p_mantenimiento_id: trabajo.id, p_idempotency_key: claves.current.fin });
      // El servidor ya calculó el próximo mantenimiento (cierre + frecuencia de la máquina).
      const px = await supabase.from('maquinas').select('frecuencia, proximo_mantenimiento').eq('id', maquina.id).maybeSingle();
      setResultado({ folio: r.folio, fin_en: r.fin_en, maquina: nombreMaquina(maquina), mecanico: mec.nombre ?? '',
        frecuencia: px.data?.frecuencia ?? null, proximo: px.data?.proximo_mantenimiento ?? null });
      window.scrollTo(0, 0);
    } catch (e) { setErrFin(mensajeError(e) + ' Nada se perdió: presione de nuevo "Finalizar mantenimiento".'); }
    finally { setFinalizando(false); }
  }

  if (!modulo) return <Navigate to="/" replace />;

  if (resultado) {
    return (
      <main className="contenido angosto">
        <div className="hecho">
          <div className="hecho-icono">✓</div>
          <h1>Mantenimiento finalizado</h1>
          <p>Trabajo #{resultado.folio} · {resultado.maquina}</p>
          <p>Mecánico: {resultado.mecanico}</p>
          <p className="hecho-hora">Cerrado el {fechaHora(resultado.fin_en)}</p>
          {resultado.proximo
            ? <p className="hecho-proximo">Próximo mantenimiento: <b>{fecha(resultado.proximo)}</b><br /><span className="nota">Frecuencia {FRECUENCIAS[resultado.frecuencia ?? ''] ?? resultado.frecuencia}</span></p>
            : <p className="nota">Esta máquina no tiene frecuencia de mantenimiento definida; no se calculó el próximo.</p>}
          <p className="nota">Mantenimiento completado.</p>
        </div>
        <button className="btn btn-pri btn-gigante centrado" onClick={limpiar}>Registrar otro mantenimiento</button>
        <Link className="btn btn-sec btn-grande" to="/">Volver a los módulos</Link>
      </main>
    );
  }

  const bloqueado = !!trabajo || iniciando;
  return (
    <main className="contenido angosto">
      <div className="form-cabecera">
        <Link to="/" className="volver" aria-label="Volver a los módulos">←</Link>
        <h1>{modulo.nombre}</h1>
      </div>

      <div className="form-app">
        <div className="campo">
          <span className="campo-etiqueta">QR MÁQUINA<span className="req">*</span></span>
          <div className="campo-qr">
            <input value={qr} disabled={bloqueado} placeholder="Escanee o escriba el código" autoCapitalize="characters"
              onChange={e => { setQr(e.target.value); setMaquina(null); setOpciones([]); setErrMaq(null); }}
              onBlur={() => { if (qr.trim() && !maquina) buscarMaquina(qr); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarMaquina(qr); } }} />
            <LectorQR icono texto="Escanear QR de la máquina" disabled={bloqueado} onLeido={t => { setQr(t); buscarMaquina(t); }} />
          </div>
          {errMaq && <Aviso tipo="error">{errMaq}</Aviso>}
          {opciones.length > 0 && (
            <div className="opciones-maq">
              <span className="nota">Ese código corresponde a {opciones.length} máquinas. Elija la correcta:</span>
              {opciones.map(o => (
                <button type="button" key={o.id} className="item" onClick={() => { setMaquina(o); setOpciones([]); }}>
                  <b>{nombreMaquina(o)}</b><span className="item-sub">Serie {o.serie ?? '—'} · {o.ubicacion ?? '—'}{o.puesto ? ` / ${o.puesto}` : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="campo">
          <span className="campo-etiqueta">MÁQUINA</span>
          <div className="solo-lectura">
            {maquina ? <><b>{nombreMaquina(maquina)}</b><br /><span className="nota">{maquina.ubicacion ?? 'Sin ubicación'}{maquina.puesto ? ` / ${maquina.puesto}` : ''} · {maquina.area ?? 'Sin área'}</span>
              <br /><span className="nota">Frecuencia: {maquina.frecuencia ? FRECUENCIAS[maquina.frecuencia] ?? maquina.frecuencia : 'sin definir'} · Próximo: {fecha(maquina.proximo_mantenimiento)}</span></> : '—'}
          </div>
        </div>

        <div className="campo">
          <span className="campo-etiqueta">QR MECÁNICO<span className="req">*</span></span>
          <div className="campo-qr">
            <input value={codMec} inputMode="numeric" disabled={bloqueado || soloPropio || !maquina}
              placeholder={maquina ? 'Escanee el gafete o escriba el código' : 'Primero la máquina'}
              onChange={e => { setCodMec(e.target.value); setMec(null); setErrMec(null); }}
              onBlur={() => verificarMecanico(codMec, maquina)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); verificarMecanico(codMec, maquina); } }} />
            <LectorQR icono texto="Escanear gafete del mecánico" disabled={bloqueado || soloPropio || !maquina}
              onLeido={t => { setCodMec(t); verificarMecanico(t, maquina); }} />
          </div>
          {mec?.autorizado && <div className="ok-linea">✓ {mec.nombre}</div>}
          {errMec && <Aviso tipo="error">{errMec}</Aviso>}
          {soloPropio && !sesion?.empleado && <Aviso tipo="alerta">Su cuenta no está vinculada a un código de empleado. Pida al administrador que la vincule.</Aviso>}
        </div>

        <div className="campo">
          <span className="campo-etiqueta">TIPO DE MANTENIMIENTO<span className="req">*</span></span>
          <div className="opciones-tipo" role="radiogroup" aria-label="Tipo de mantenimiento">
            {(['preventivo', 'correctivo'] as const).map(t => (
              <button type="button" key={t} role="radio" aria-checked={tipo === t} disabled={bloqueado}
                className={`btn btn-opcion ${tipo === t ? 'activo' : ''}`} onClick={() => { setTipo(t); setErrInicio(null); }}>
                {t === 'preventivo' ? 'PREVENTIVO' : 'CORRECTIVO'}
              </button>
            ))}
          </div>
        </div>

        {iniciando && <Aviso tipo="info">Registrando la hora de inicio…</Aviso>}
        {errInicio && <Aviso tipo="error" onReintentar={() => setErrInicio(null)}>{errInicio}</Aviso>}
        {trabajo && (
          <Aviso tipo="ok">
            {trabajo.retomado ? `Se retomó el trabajo #${trabajo.folio}, que ya estaba en proceso.` : `Trabajo #${trabajo.folio} en proceso.`} Inicio: {fechaHora(trabajo.inicio_en)}
          </Aviso>
        )}

        <div className="campo">
          <span className="campo-etiqueta">COMENTARIO</span>
          <textarea rows={4} value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Trabajo realizado, piezas cambiadas, observaciones…" />
        </div>

        <div className="campo">
          <span className="campo-etiqueta">FOTO DE LA MÁQUINA</span>
          <label className="caja-foto">
            <span>📷 Tomar foto</span>
            <input type="file" accept="image/*" capture="environment" onChange={e => { agregarFotos(e.target.files); e.target.value = ''; }} />
          </label>
          {fotos.length > 0 && (
            <div className="fotos">
              {fotos.map(f => (
                <div key={f.clave} className="foto-mini">
                  <img src={f.url} alt="Foto de la máquina" />
                  {!f.subida && <button type="button" className="quitar" aria-label="Quitar foto"
                    onClick={() => { URL.revokeObjectURL(f.url); setFotos(fs => fs.filter(x => x.clave !== f.clave)); }}>✕</button>}
                </div>
              ))}
            </div>
          )}
        </div>

        {inventario.length > 0 && (
          <>
            <button type="button" aria-expanded={repAbierto || repuestos.length > 0}
              className={`btn btn-opcion btn-externo ${repAbierto || repuestos.length > 0 ? 'activo' : ''}`}
              onClick={() => setRepAbierto(!repAbierto)}>
              <span>REPUESTOS USADOS{repuestos.length ? ` (${repuestos.length})` : ''}</span><span aria-hidden="true">{repAbierto ? '▲' : '▼'}</span>
            </button>
            {repAbierto && (
              <div className="bloque-externo">
                <div className="campo">
                  <span className="campo-etiqueta">REPUESTO</span>
                  <SelectorArticulo articulos={inventario} elegido={repArt} onElegir={setRepArt} mostrarSinExistencia={false} />
                </div>
                <div className="campo">
                  <span className="campo-etiqueta">CANTIDAD</span>
                  <div className="rep-agregar">
                    <input value={repCant} inputMode="decimal" placeholder="0" onChange={e => setRepCant(e.target.value)} />
                    <button type="button" className="btn btn-pri" onClick={agregarRepuesto}>Agregar</button>
                  </div>
                </div>
                {errRep && <Aviso tipo="error">{errRep}</Aviso>}
                <span className="nota">Al finalizar se descuentan del inventario y quedan ligados a esta máquina y a este trabajo.</span>
              </div>
            )}
            {repuestos.length > 0 && (
              <div className="lista">
                {repuestos.map(r => (
                  <div key={r.clave} className="rep-linea">
                    <span><b>{num(r.cantidad)}</b> × {r.articulo.codigo} · {r.articulo.descripcion}{r.registrado ? ' ✓' : ''}</span>
                    {!r.registrado && <button type="button" className="btn btn-link" aria-label="Quitar repuesto"
                      onClick={() => setRepuestos(rs => rs.filter(x => x.clave !== r.clave))}>✕</button>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <button type="button" aria-expanded={externo === 'si'}
          className={`btn btn-opcion btn-externo ${externo === 'si' ? 'activo' : ''}`}
          onClick={() => setExterno(externo === 'si' ? '' : 'si')}>
          <span>SERVICIO EXTERNO</span><span aria-hidden="true">{externo === 'si' ? '▲' : '▼'}</span>
        </button>

        {externo === 'si' && (
          <div className="bloque-externo">
            <div className="campo">
              <span className="campo-etiqueta">PROVEEDOR<span className="req">*</span></span>
              <input value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Nombre del proveedor o taller" />
            </div>
            <div className="campo">
              <span className="campo-etiqueta">COSTO ($)<span className="req">*</span></span>
              <div className="campo-costo">
                <input value={costo} inputMode="decimal" placeholder="0.00" onChange={e => setCosto(e.target.value)} />
                <select value={moneda} onChange={e => setMoneda(e.target.value as 'USD' | 'HNL')} aria-label="Moneda">
                  <option value="USD">USD $</option>
                  <option value="HNL">HNL L</option>
                </select>
              </div>
            </div>
            <div className="campo">
              <span className="campo-etiqueta">COTIZACIÓN O FACTURA</span>
              <div className="doc-botones">
                <label className="caja-foto">
                  <span>📷 Tomar foto</span>
                  <input type="file" accept="image/*" capture="environment" onChange={e => { agregarDocs(e.target.files); e.target.value = ''; }} />
                </label>
                <label className="caja-foto">
                  <span>📎 Subir archivo</span>
                  <input type="file" accept="image/*,application/pdf" multiple onChange={e => { agregarDocs(e.target.files); e.target.value = ''; }} />
                </label>
              </div>
              <span className="nota">Foto de la cotización o factura, o el archivo digital (PDF o imagen, hasta 10 MB).</span>
              {docs.length > 0 && (
                <div className="fotos">
                  {docs.map(d => (
                    <div key={d.clave} className="foto-mini">
                      {d.ext === 'pdf' ? <div className="doc-pdf"><b>PDF</b><span>{d.nombre}</span></div> : <img src={d.url} alt={d.nombre} />}
                      {!d.subido && <button type="button" className="quitar" aria-label="Quitar documento"
                        onClick={() => { URL.revokeObjectURL(d.url); setDocs(ds => ds.filter(x => x.clave !== d.clave)); }}>✕</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {errFin && <Aviso tipo="error">{errFin}</Aviso>}
        <button type="button" className="btn btn-fin" disabled={!trabajo || finalizando} onClick={finalizar}>
          {finalizando ? 'Guardando…' : 'FINALIZAR MANTENIMIENTO'}
        </button>
        <p className="nota centrado">
          {trabajo ? 'Al finalizar, el servidor guarda la fecha y hora de cierre.' : 'Complete QR máquina, QR mecánico y tipo para habilitar el botón.'}
        </p>
        <button type="button" className="btn btn-link" onClick={limpiar}>Limpiar formulario</button>
      </div>

      <p className="centrado"><Link to={`/m/${modulo.codigo}/panel`}>Ver trabajos del módulo</Link></p>
    </main>
  );
}
