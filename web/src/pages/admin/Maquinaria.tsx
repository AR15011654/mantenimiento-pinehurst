import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { fechaHora, Maquina, mensajeError, rpc, supabase } from '../../lib';
import { descargarExcel } from '../../excel';
import { Aviso, Campo, Titulo } from '../../ui';

type Hist = { id: number; desde: string; hasta: string | null; puesto: string | null; origen: string; motivo: string | null; ubicaciones: { nombre: string } | null; areas: { nombre: string } | null; modulos: { nombre: string } | null };

export default function Maquinaria() {
  const [params] = useSearchParams();
  const [txt, setTxt] = useState('');
  const [modulo, setModulo] = useState('');
  const [estado, setEstado] = useState('');
  const [rev, setRev] = useState(params.get('rev') === '1');
  const [critica, setCritica] = useState(false);
  const [filas, setFilas] = useState<Maquina[]>([]);
  const [total, setTotal] = useState(0);
  const [pag, setPag] = useState(0);
  const [mods, setMods] = useState<{ id: string; nombre: string }[]>([]);
  const [sel, setSel] = useState<Maquina | null>(null);
  const [hist, setHist] = useState<Hist[]>([]);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; t: string } | null>(null);
  const POR = 100;

  useEffect(() => { supabase.from('modulos').select('id, nombre').order('orden').then(r => setMods(r.data ?? [])); }, []);

  const consulta = useCallback((conConteo: boolean) => {
    let q = supabase.from('v_maquinas').select('*', conConteo ? { count: 'exact' } : undefined);
    const t = txt.trim().replace(/[%_,()"\\]/g, ' ');
    if (t) { const v = `"%${t}%"`; q = q.or(`asset_id.ilike.${v},qr.ilike.${v},serie.ilike.${v},fabricante.ilike.${v},modelo.ilike.${v},tipo.ilike.${v},grupo.ilike.${v},ubicacion.ilike.${v},puesto.ilike.${v}`); }
    if (modulo === 'sin') q = q.is('modulo_id', null); else if (modulo) q = q.eq('modulo_id', modulo);
    if (estado) q = q.eq('estado_inventario', estado);
    if (rev) q = q.eq('requiere_revision', true);
    if (critica) q = q.eq('es_critica', true);
    return q.order('asset_id');
  }, [txt, modulo, estado, rev, critica]);

  const buscar = useCallback(async (p = 0, e?: FormEvent) => {
    e?.preventDefault();
    const { data, count, error } = await consulta(true).range(p * POR, p * POR + POR - 1);
    if (error) { setMsg({ tipo: 'error', t: mensajeError(error) }); return; }
    setFilas(data as Maquina[]); setTotal(count ?? 0); setPag(p);
  }, [consulta]);
  useEffect(() => { buscar(0); }, [modulo, estado, rev, critica]); // eslint-disable-line react-hooks/exhaustive-deps

  async function abrir(m: Maquina) {
    setSel(m); setMsg(null);
    const h = await supabase.from('maquina_ubicacion_historial').select('id, desde, hasta, puesto, origen, motivo, ubicaciones(nombre), areas(nombre), modulos(nombre)').eq('maquina_id', m.id).order('desde', { ascending: false });
    setHist((h.data ?? []) as unknown as Hist[]);
  }

  async function guardar(cambios: Partial<Maquina>, texto: string) {
    if (!sel) return;
    const { error } = await supabase.from('maquinas').update(cambios).eq('id', sel.id);
    if (error) { setMsg({ tipo: 'error', t: mensajeError(error) }); return; }
    setMsg({ tipo: 'ok', t: texto });
    const r = await supabase.from('v_maquinas').select('*').eq('id', sel.id).single();
    setSel(r.data as Maquina); buscar(pag);
  }

  async function exportar() {
    const filasAll: Maquina[] = [];
    for (let d = 0; ; d += 1000) { const { data } = await consulta(false).range(d, d + 999); filasAll.push(...((data ?? []) as Maquina[])); if (!data || data.length < 1000) break; }
    await descargarExcel('maquinaria.xlsx', 'Maquinaria', [
      { titulo: 'Asset ID', clave: 'asset_id', ancho: 26 }, { titulo: 'QR', clave: 'qr' }, { titulo: 'SERIE', clave: 'serie' }, { titulo: 'TIPO', clave: 'tipo' },
      { titulo: 'GRUPO', clave: 'grupo' }, { titulo: 'FABRICANTE', clave: 'fabricante' }, { titulo: 'MODELO', clave: 'modelo' },
      { titulo: 'MODULO', clave: 'modulo', ancho: 28 }, { titulo: 'AREA', clave: 'area' }, { titulo: 'UBICACION', clave: 'ubicacion' }, { titulo: 'PUESTO', clave: 'puesto' },
      { titulo: 'ESTADO INVENTARIO', clave: 'estado_inventario' }, { titulo: 'CONDICION OPERATIVA', clave: 'condicion_operativa' }, { titulo: 'CRITICA', clave: 'es_critica' },
      { titulo: 'EN REVISION', clave: 'requiere_revision' }, { titulo: 'MOTIVO REVISION', clave: 'motivo_revision', ancho: 50 },
    ], filasAll.map(m => ({ ...m, es_critica: m.es_critica ? 'SÍ' : '', requiere_revision: m.requiere_revision ? 'SÍ' : '' })));
  }

  return (
    <main className="contenido">
      <Titulo sub="Estado del inventario (Excel), condición operativa y estado del mantenimiento son datos distintos.">Maquinaria</Titulo>
      <form className="tarjeta filtros" onSubmit={e => buscar(0, e)}>
        <Campo etiqueta="Buscar (QR, serie, fabricante, modelo, tipo, grupo, ubicación)"><input value={txt} onChange={e => setTxt(e.target.value)} /></Campo>
        <Campo etiqueta="Módulo"><select value={modulo} onChange={e => setModulo(e.target.value)}><option value="">Todos</option><option value="sin">Sin clasificar</option>{mods.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Estado inventario"><select value={estado} onChange={e => setEstado(e.target.value)}><option value="">Todos</option><option>ACTIVO</option><option>INACTIVO</option><option>DESCARTADO</option></select></Campo>
        <label className="mini"><input type="checkbox" checked={rev} onChange={e => setRev(e.target.checked)} /> Solo en revisión</label>
        <label className="mini"><input type="checkbox" checked={critica} onChange={e => setCritica(e.target.checked)} /> Solo críticas</label>
        <div className="fila-botones"><button className="btn btn-pri">Buscar</button><button type="button" className="btn btn-sec" onClick={exportar}>Exportar a Excel</button></div>
      </form>
      {msg && !sel && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}
      <p className="nota">{total} máquinas · página {pag + 1} de {Math.max(1, Math.ceil(total / POR))}</p>
      <div className="tabla-scroll"><table className="tabla">
        <thead><tr><th>Asset ID</th><th>QR</th><th>Serie</th><th>Tipo</th><th>Fabricante</th><th>Ubicación</th><th>Área</th><th>Estado</th><th></th></tr></thead>
        <tbody>{filas.map(m => (
          <tr key={m.id} className={sel?.id === m.id ? 'sel' : ''}>
            <td>{m.asset_id}</td><td>{m.qr}</td><td>{m.serie}</td><td>{m.tipo}</td><td>{m.fabricante}</td><td>{m.ubicacion}{m.puesto ? ` / ${m.puesto}` : ''}</td>
            <td>{m.area ?? m.modulo ?? <i>Sin clasificar</i>}</td><td>{m.estado_inventario}{m.requiere_revision && ' ⚠'}</td>
            <td><button className="btn btn-link" onClick={() => abrir(m)}>Ver</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="fila-botones">
        <button className="btn btn-sec btn-chico" disabled={pag === 0} onClick={() => buscar(pag - 1)}>Anterior</button>
        <button className="btn btn-sec btn-chico" disabled={(pag + 1) * POR >= total} onClick={() => buscar(pag + 1)}>Siguiente</button>
      </div>

      {sel && (
        <section className="tarjeta" id="detalle">
          <h2>{sel.tipo} · {sel.asset_id}</h2>
          {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}
          {sel.requiere_revision && (
            <Aviso tipo="alerta">En revisión: {sel.motivo_revision}{' '}
              <button className="btn btn-sec btn-chico" onClick={async () => {
                const nota = prompt('Nota de la revisión (qué se verificó):'); if (nota === null) return;
                try { await rpc('admin_marcar_revisada', { p_ids: [sel.id], p_nota: nota }); setMsg({ tipo: 'ok', t: 'Marcada como revisada.' }); abrir({ ...sel, requiere_revision: false, motivo_revision: null }); buscar(pag); }
                catch (e) { setMsg({ tipo: 'error', t: (e as Error).message }); }
              }}>Marcar como revisada</button>
            </Aviso>
          )}
          <p className="nota">Origen: {sel.origen_archivo ?? '—'} · hoja {sel.origen_hoja ?? '—'} · fila {sel.origen_fila ?? '—'}{sel.campos_origen_numerico?.length ? ` · columnas que venían como número: ${sel.campos_origen_numerico.join(', ')}` : ''}</p>
          <div className="filtros">
            <Campo etiqueta="Condición operativa">
              <select value={sel.condicion_operativa} onChange={e => guardar({ condicion_operativa: e.target.value }, 'Condición operativa actualizada.')}>
                <option value="operativa">Operativa</option><option value="en_reparacion">En reparación</option><option value="fuera_de_servicio">Fuera de servicio</option>
              </select>
            </Campo>
            <label className="mini"><input type="checkbox" checked={sel.es_critica} onChange={e => guardar({ es_critica: e.target.checked }, 'Indicador de máquina crítica actualizado.')} /> Máquina crítica</label>
            <label className="mini"><input type="checkbox" checked={sel.activo} onChange={e => guardar({ activo: e.target.checked }, e.target.checked ? 'Máquina activada.' : 'Máquina desactivada (no se borra su historial).')} /> Activa en la aplicación</label>
          </div>
          <p><Link to={`/maquina/${sel.id}`}>Abrir ficha y trabajos</Link> · <Link to="/admin/clasificacion">Cambiar módulo/área</Link></p>
          <h3>Historial de ubicación y área</h3>
          <ul className="lista-simple">{hist.map(h => <li key={h.id}>{fechaHora(h.desde)} → {h.hasta ? fechaHora(h.hasta) : 'actual'} · {h.ubicaciones?.nombre ?? '—'}{h.puesto ? ` / ${h.puesto}` : ''} · {h.areas?.nombre ?? h.modulos?.nombre ?? 'Sin clasificar'} · <span className="nota">{h.origen}{h.motivo ? `: ${h.motivo}` : ''}</span></li>)}</ul>
        </section>
      )}
    </main>
  );
}
