import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { duracion, fechaHora, Mantenimiento, mensajeError, nuevaClave, rpc, supabase, TIPOS } from '../lib';
import { useSesion } from '../sesion';
import { Aviso, Cargando, Campo, Dato, Insignia, Titulo } from '../ui';

type Evento = { id: number; evento: string; estado_anterior: string | null; estado_nuevo: string | null; motivo: string | null; usuario_id: string | null; creado_en: string };
type Comentario = { id: string; texto: string; usuario_id: string; creado_en: string };
type Foto = { id: string; ruta: string; creado_en: string; url?: string };
type Externo = { proveedor: string; costo: number | null; moneda: string | null; actualizado_en: string };
type Documento = { id: string; ruta: string; nombre_original: string | null; tipo_mime: string | null; creado_en: string; url?: string };
type RepUsado = { id: number; cantidad: number; costo_total: number | null; art_codigo: string; art_descripcion: string };
type Periodo = { id: number; inicio_en: string; fin_en: string | null };
type Pendiente = { clave: string; texto: string; error?: string; enviando?: boolean };

const NOMBRE_EVENTO: Record<string, string> = {
  iniciado: 'Inicio', comentario: 'Comentario', foto: 'Foto', finalizado: 'Finalizado', validado: 'Validado',
  devuelto: 'Devuelto al técnico', reanudado: 'Reanudado', cancelado: 'Cancelado', reabierto: 'Reabierto',
  servicio_externo: 'Servicio externo', repuesto: 'Repuesto usado', documento: 'Cotización o factura',
};

async function reducirImagen(f: File): Promise<Blob> {
  const img = await createImageBitmap(f);
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((ok, mal) => c.toBlob(b => (b ? ok(b) : mal(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.82));
}

export default function Trabajo() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { sesion } = useSesion();
  const perfil = sesion?.usuario?.perfil;
  const verPrecios = perfil === 'admin' || perfil === 'supervisor';
  const [costoEd, setCostoEd] = useState<{ costo: string; moneda: string } | null>(null);
  const [t, setT] = useState<Mantenimiento | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [comentarios, setComentarios] = useState<Comentario[]>([]);
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [externo, setExterno] = useState<Externo | null>(null);
  const [docs, setDocs] = useState<Documento[]>([]);
  const [reps, setReps] = useState<RepUsado[]>([]);
  const [periodos, setPeriodos] = useState<Periodo[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(params.get('nuevo') ? { tipo: 'ok', texto: 'Mantenimiento iniciado. La hora de inicio quedó guardada.' } : null);
  const [texto, setTexto] = useState('');
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [claveFin, setClaveFin] = useState(nuevaClave);
  const [motivo, setMotivo] = useState('');
  const [ahora, setAhora] = useState(Date.now());

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const r = await supabase.from('mantenimientos').select('*').eq('id', id).maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) { setError('El trabajo no existe o no tiene permiso para verlo.'); return; }
      setT(r.data as Mantenimiento);
      const [ev, co, fo, pe, se, dc, rp] = await Promise.all([
        supabase.from('mantenimiento_eventos').select('*').eq('mantenimiento_id', id).order('id'),
        supabase.from('mantenimiento_comentarios').select('*').eq('mantenimiento_id', id).order('creado_en'),
        supabase.from('mantenimiento_fotos').select('*').eq('mantenimiento_id', id).order('creado_en'),
        supabase.from('mantenimiento_periodos').select('*').eq('mantenimiento_id', id).order('id'),
        supabase.from('v_servicio_externo').select('*').eq('mantenimiento_id', id).maybeSingle(),
        supabase.from('mantenimiento_documentos').select('*').eq('mantenimiento_id', id).order('creado_en'),
        supabase.from('inv_v_movimientos').select('id, cantidad, costo_total, art_codigo, art_descripcion').eq('mantenimiento_id', id).eq('tipo', 'salida').order('id'),
      ]);
      setReps((rp.data ?? []) as unknown as RepUsado[]);
      setExterno((se.data ?? null) as Externo | null);
      const ds = (dc.data ?? []) as Documento[];
      if (ds.length) {
        const s = await supabase.storage.from('mant-evidencias').createSignedUrls(ds.map(d => d.ruta), 3600);
        ds.forEach((d, i) => { d.url = s.data?.[i]?.signedUrl ?? undefined; });
      }
      setDocs(ds);
      const evs = (ev.data ?? []) as Evento[];
      setEventos(evs); setComentarios((co.data ?? []) as Comentario[]); setPeriodos((pe.data ?? []) as Periodo[]);
      const fs = (fo.data ?? []) as Foto[];
      if (fs.length) {
        const s = await supabase.storage.from('mant-evidencias').createSignedUrls(fs.map(f => f.ruta), 3600);
        fs.forEach((f, i) => { f.url = s.data?.[i]?.signedUrl ?? undefined; });
      }
      setFotos(fs);
      const ids = Array.from(new Set([...evs.map(e => e.usuario_id), ...((co.data ?? []) as Comentario[]).map(c => c.usuario_id)].filter(Boolean))) as string[];
      if (ids.length) {
        const n = await rpc<{ id: string; nombre: string }[]>('nombres_usuarios', { p_ids: ids });
        setNombres(Object.fromEntries(n.map(x => [x.id, x.nombre])));
      }
    } catch (e) { setError(mensajeError(e)); }
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const abierto = periodos.some(p => !p.fin_en);
  useEffect(() => {
    if (!abierto) return;
    const i = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(i);
  }, [abierto]);

  async function accion(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    setOcupado(true); setAviso(null);
    try { await fn(); setAviso({ tipo: 'ok', texto: ok }); setMotivo(''); await cargar(); return true; }
    catch (e) { setAviso({ tipo: 'error', texto: (e as Error).message }); return false; }
    finally { setOcupado(false); }
  }

  async function enviarComentario(p: Pendiente) {
    setPendientes(ps => ps.map(x => x.clave === p.clave ? { ...x, enviando: true, error: undefined } : x));
    try {
      await rpc('agregar_comentario', { p_mantenimiento_id: id, p_texto: p.texto, p_idempotency_key: p.clave });
      setPendientes(ps => ps.filter(x => x.clave !== p.clave));
      setAviso({ tipo: 'ok', texto: 'Comentario guardado. El trabajo sigue en proceso.' });
      await cargar();
    } catch (e) {
      setPendientes(ps => ps.map(x => x.clave === p.clave ? { ...x, enviando: false, error: (e as Error).message } : x));
    }
  }
  function agregarComentario(e: FormEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    const p = { clave: nuevaClave(), texto: texto.trim() };
    setPendientes(ps => [...ps, p]); setTexto('');
    enviarComentario(p);
  }

  async function subirFoto(f: File | undefined) {
    if (!f || !t) return;
    await accion(async () => {
      const blob = await reducirImagen(f);
      const ruta = `${t.id}/${nuevaClave()}.jpg`;
      const up = await supabase.storage.from('mant-evidencias').upload(ruta, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw new Error(mensajeError(up.error));
      await rpc('registrar_foto', { p_mantenimiento_id: t.id, p_ruta: ruta, p_tamano: blob.size, p_mime: 'image/jpeg' });
    }, 'Foto guardada.');
  }

  if (error) return <main className="contenido"><Aviso tipo="error" onReintentar={cargar}>{error}</Aviso></main>;
  if (!t) return <Cargando />;

  const esSupervisor = perfil === 'admin' || perfil === 'supervisor';
  const propio = t.creado_por === sesion?.usuario?.id || (sesion?.empleado && t.mecanico_id === sesion.empleado.id);
  const puedeTrabajar = perfil !== 'tecnico' || propio;
  const minutosAbiertos = abierto ? (ahora - new Date(periodos.find(p => !p.fin_en)!.inicio_en).getTime()) / 60000 : 0;
  const devuelto = t.estado === 'en_proceso' && !abierto;

  return (
    <main className="contenido">
      <Titulo sub={<><Insignia estado={t.estado} /> {TIPOS[t.tipo]} · {t.snap_modulo} · {t.snap_area ?? 'Sin área'}</>}>
        Trabajo #{t.folio}
      </Titulo>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <dl className="datos tarjeta">
        <Dato k="Máquina" v={<Link to={`/maquina/${t.maquina_id}`}>{t.snap_maquina} {t.snap_fabricante ?? ''}</Link>} />
        <Dato k="QR / Serie" v={`${t.snap_qr ?? '—'} / ${t.snap_serie ?? '—'}`} />
        <Dato k="Ubicación" v={`${t.snap_ubicacion ?? '—'}${t.snap_puesto ? ' / ' + t.snap_puesto : ''}`} />
        <Dato k="Mecánico" v={t.mecanico_externo ? `${t.mecanico_externo} (mecánico externo)` : `${t.snap_mecanico_nombre ?? '—'} (${t.snap_mecanico_codigo ?? ''})`} />
        <Dato k="Servicio externo" v={t.servicio_externo ? 'Sí' : 'No'} />
        <Dato k="Inicio" v={fechaHora(t.inicio_en)} />
        <Dato k="Final" v={fechaHora(t.fin_en)} />
        <Dato k="Duración del mantenimiento" v={abierto ? `${duracion((t.duracion_min ?? 0) + minutosAbiertos)} (en curso)` : duracion(t.duracion_min)} />
        <Dato k="Semana / Mes / Año" v={t.semana ? `${t.semana} / ${t.mes} / ${t.anio}` : '—'} />
        {t.motivo_cancelacion && <Dato k="Motivo de cancelación" v={t.motivo_cancelacion} />}
      </dl>

      {t.estado === 'en_proceso' && puedeTrabajar && (
        <section className="tarjeta">
          {devuelto ? (
            <>
              <Aviso tipo="alerta">Este trabajo fue reabierto. Revise el motivo en el historial y presione Reanudar para continuar.</Aviso>
              <button className="btn btn-pri btn-gigante" disabled={ocupado} onClick={() => accion(() => rpc('reanudar_mantenimiento', { p_mantenimiento_id: t.id }), 'Trabajo reanudado. Se registró la nueva hora de inicio.')}>Reanudar trabajo</button>
            </>
          ) : (
            <>
              <form onSubmit={agregarComentario}>
                <Campo etiqueta="Comentario o actividad realizada" ayuda="Guardar un comentario no finaliza el trabajo.">
                  <textarea rows={3} value={texto} onChange={e => setTexto(e.target.value)} />
                </Campo>
                <button className="btn btn-sec btn-grande" disabled={!texto.trim()}>Guardar comentario</button>
              </form>
              <label className="btn btn-sec btn-grande archivo">
                Agregar foto
                <input type="file" accept="image/*" capture="environment" onChange={e => { subirFoto(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
              <button className="btn btn-pri btn-gigante" disabled={ocupado || pendientes.length > 0}
                onClick={() => { if (confirm('¿Finalizar el mantenimiento? El servidor registrará la hora final.')) accion(async () => { await rpc('finalizar_mantenimiento', { p_mantenimiento_id: t.id, p_idempotency_key: claveFin }); setClaveFin(nuevaClave()); }, 'Mantenimiento finalizado y completado.'); }}>
                Finalizar mantenimiento
              </button>
              {pendientes.length > 0 && <p className="nota">Hay comentarios sin enviar: envíelos antes de finalizar.</p>}
            </>
          )}
        </section>
      )}

      {pendientes.map(p => (
        <Aviso key={p.clave} tipo={p.error ? 'error' : 'info'} onReintentar={p.error ? () => enviarComentario(p) : undefined}>
          {p.enviando ? 'Enviando: ' : p.error ? `No enviado (${p.error}): ` : 'Pendiente: '}“{p.texto}”
        </Aviso>
      ))}

      {(t.estado === 'en_proceso' || t.estado === 'programado') && esSupervisor && (
        <details className="tarjeta">
          <summary>Cancelar trabajo</summary>
          <Campo etiqueta="Motivo de la cancelación"><textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} /></Campo>
          <button className="btn btn-peligro" disabled={ocupado} onClick={() => accion(() => rpc('cancelar_mantenimiento', { p_mantenimiento_id: t.id, p_motivo: motivo }), 'Trabajo cancelado. El historial se conserva.')}>Confirmar cancelación</button>
        </details>
      )}

      {t.estado === 'completado' && perfil === 'admin' && (
        <details className="tarjeta">
          <summary>Reabrir (administrador)</summary>
          <Campo etiqueta="Motivo"><textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} /></Campo>
          <button className="btn btn-sec" disabled={ocupado} onClick={() => accion(() => rpc('reabrir_mantenimiento', { p_mantenimiento_id: t.id, p_motivo: motivo }), 'Trabajo reabierto: vuelve a en proceso.')}>Reabrir</button>
        </details>
      )}

      {reps.length > 0 && (
        <section className="tarjeta">
          <h2>Repuestos usados</h2>
          <ul className="lista">{reps.map(r => (
            <li key={r.id}><b>{Number(r.cantidad).toLocaleString('es-HN')}</b> × {r.art_codigo} · {r.art_descripcion}
              {verPrecios && <span className="nota"> · {r.costo_total === null ? 'sin precio' : '$ ' + Number(r.costo_total).toLocaleString('es-HN', { minimumFractionDigits: 2 })}</span>}</li>
          ))}</ul>
          {verPrecios && reps.some(r => r.costo_total !== null) && <p className="nota">Total: $ {reps.reduce((s, r) => s + Number(r.costo_total ?? 0), 0).toLocaleString('es-HN', { minimumFractionDigits: 2 })}</p>}
        </section>
      )}

      {externo && (
        <section className="tarjeta">
          <h2>Servicio externo</h2>
          <p><b>Proveedor:</b> {externo.proveedor}
            {verPrecios && <><br /><b>Costo:</b> {externo.costo === null ? <span className="nota">pendiente de registrar</span>
              : <>{externo.moneda === 'HNL' ? 'L' : '$'} {Number(externo.costo).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {externo.moneda}</>}
              {!costoEd && (t.estado === 'en_proceso' || t.estado === 'completado') &&
                <> <button className="btn btn-link" onClick={() => setCostoEd({ costo: externo.costo === null ? '' : String(externo.costo), moneda: externo.moneda ?? 'USD' })}>{externo.costo === null ? 'Registrar costo' : 'Corregir costo'}</button></>}</>}
          </p>
          {verPrecios && costoEd && (
            <div className="campo-costo">
              <input value={costoEd.costo} inputMode="decimal" placeholder="0.00" onChange={e => setCostoEd({ ...costoEd, costo: e.target.value })} />
              <select value={costoEd.moneda} onChange={e => setCostoEd({ ...costoEd, moneda: e.target.value })} aria-label="Moneda">
                <option value="USD">USD $</option><option value="HNL">HNL L</option>
              </select>
              <div className="acciones">
                <button className="btn btn-pri" disabled={ocupado} onClick={() => {
                  const txt = costoEd.costo.replace(/[$,\s]/g, ''); const n = Number(txt);
                  if (txt && (!Number.isFinite(n) || n < 0)) { setAviso({ tipo: 'error', texto: 'El costo no es válido.' }); return; }
                  accion(() => rpc('registrar_servicio_externo', { p_mantenimiento_id: t.id, p_proveedor: externo.proveedor, p_costo: txt ? n : null, p_moneda: txt ? costoEd.moneda : null }), 'Costo del servicio externo guardado.')
                    .then(bien => { if (bien) setCostoEd(null); });
                }}>Guardar costo</button>
                <button className="btn btn-sec" onClick={() => setCostoEd(null)}>Cancelar</button>
              </div>
            </div>
          )}
          {!verPrecios ? (docs.length > 0 && <p className="nota">Cotización o factura adjunta ({docs.length}).</p>) : docs.length > 0 ? (
            <div className="doc-lista">
              {docs.map(d => d.url
                ? <a key={d.id} href={d.url} target="_blank" rel="noreferrer">{d.tipo_mime === 'application/pdf' ? '📄' : (d.tipo_mime ?? '').includes('excel') || (d.tipo_mime ?? '').includes('sheet') ? '📊' : '🖼️'} {d.nombre_original ?? 'Documento'}</a>
                : <span key={d.id}>{d.nombre_original ?? 'Documento'} (no disponible)</span>)}
            </div>
          ) : <p className="nota">Sin cotización o factura adjunta.</p>}
        </section>
      )}

      {fotos.length > 0 && (
        <section className="tarjeta">
          <h2>Fotos</h2>
          <div className="fotos">{fotos.map(f => f.url ? <a key={f.id} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt="Evidencia" loading="lazy" /></a> : <span key={f.id}>Foto no disponible</span>)}</div>
        </section>
      )}

      <section className="tarjeta">
        <h2>Comentarios</h2>
        {comentarios.length === 0 && <p className="nota">Sin comentarios.</p>}
        <ul className="lista-simple">
          {comentarios.map(c => <li key={c.id}><span className="nota">{fechaHora(c.creado_en)} · {nombres[c.usuario_id] ?? 'Usuario'}</span><br />{c.texto}</li>)}
        </ul>
      </section>

      <section className="tarjeta">
        <h2>Historial del trabajo</h2>
        <ul className="lista-simple">
          {eventos.filter(e => e.evento !== 'comentario').map(e => (
            <li key={e.id}><b>{NOMBRE_EVENTO[e.evento] ?? e.evento}</b> · {fechaHora(e.creado_en)} · {e.usuario_id ? nombres[e.usuario_id] ?? 'Usuario' : ''}{e.motivo ? <><br />Motivo: {e.motivo}</> : null}</li>
          ))}
        </ul>
        {periodos.length > 1 && <p className="nota">Períodos trabajados: {periodos.map(p => `${fechaHora(p.inicio_en)} – ${p.fin_en ? fechaHora(p.fin_en) : 'en curso'}`).join(' · ')}</p>}
      </section>
    </main>
  );
}
