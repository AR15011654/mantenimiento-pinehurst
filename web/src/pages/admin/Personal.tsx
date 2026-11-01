import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { mensajeError, rpc, supabase } from '../../lib';
import { Aviso, Campo, Titulo } from '../../ui';

type Emp = { id: string; codigo: string; nombre: string; cargo: string | null; especialidad: string | null; es_mecanico: boolean; activo: boolean; empleado_areas: { area_id: string }[] };
type Ar = { id: string; nombre: string; modulo_id: string; modulos: { nombre: string } | null };

const CARGOS_MANT = ['Mecánico', 'Técnico(a)', 'Tecnico Certificado', 'Mecanico Jr.'];

export default function Personal() {
  const [params] = useSearchParams();
  const [txt, setTxt] = useState('');
  const [soloMec, setSoloMec] = useState(params.get('mec') === '1');
  const [filas, setFilas] = useState<Emp[]>([]);
  const [total, setTotal] = useState(0);
  const [areas, setAreas] = useState<Ar[]>([]);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; t: string } | null>(null);

  useEffect(() => { supabase.from('areas').select('id, nombre, modulo_id, modulos(nombre)').order('nombre').then(r => setAreas((r.data ?? []) as unknown as Ar[])); }, []);

  const buscar = useCallback(async (e?: FormEvent) => {
    e?.preventDefault();
    let q = supabase.from('empleados').select('id, codigo, nombre, cargo, especialidad, es_mecanico, activo, empleado_areas(area_id)', { count: 'exact' });
    const t = txt.trim().replace(/[%_,()"\\]/g, ' ');
    if (t) { const v = `"%${t}%"`; q = q.or(`codigo.ilike.${v},nombre.ilike.${v},cargo.ilike.${v}`); }
    if (soloMec) q = q.eq('es_mecanico', true);
    const { data, count, error } = await q.order('nombre').limit(200);
    if (error) { setMsg({ tipo: 'error', t: mensajeError(error) }); return; }
    setFilas(data as Emp[]); setTotal(count ?? 0);
  }, [txt, soloMec]);
  useEffect(() => { buscar(); }, [soloMec]); // eslint-disable-line react-hooks/exhaustive-deps

  async function actualizar(id: string, cambios: Partial<Emp>) {
    const { error } = await supabase.from('empleados').update(cambios).eq('id', id);
    if (error) setMsg({ tipo: 'error', t: mensajeError(error) }); else { setMsg({ tipo: 'ok', t: 'Guardado.' }); buscar(); }
  }
  async function alternarArea(e: Emp, areaId: string, asignar: boolean) {
    const r = asignar
      ? await supabase.from('empleado_areas').insert({ empleado_id: e.id, area_id: areaId })
      : await supabase.from('empleado_areas').delete().eq('empleado_id', e.id).eq('area_id', areaId);
    if (r.error) setMsg({ tipo: 'error', t: mensajeError(r.error) }); else buscar();
  }

  return (
    <main className="contenido">
      <Titulo sub="Catálogo de personal (importado del Excel). Estar en el catálogo NO da acceso a la aplicación.">Personal</Titulo>
      {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}
      <section className="tarjeta">
        <h2>Habilitar mecánicos por cargo</h2>
        <p className="nota">Solo los empleados habilitados como mecánicos y asignados a un área pueden quedar como responsables de un trabajo.</p>
        <button className="btn btn-sec" onClick={async () => {
          if (!confirm(`¿Habilitar como mecánicos a todos los empleados con cargo: ${CARGOS_MANT.join(', ')}?`)) return;
          try { const n = await rpc<number>('admin_habilitar_mecanicos_por_cargo', { p_cargos: CARGOS_MANT, p_habilitar: true }); setMsg({ tipo: 'ok', t: `${n} empleados habilitados como mecánicos. Ahora asígneles sus áreas.` }); buscar(); }
          catch (e) { setMsg({ tipo: 'error', t: (e as Error).message }); }
        }}>Habilitar cargos de mantenimiento</button>
      </section>
      <form className="tarjeta filtros" onSubmit={buscar}>
        <Campo etiqueta="Buscar (código, nombre o cargo)"><input value={txt} onChange={e => setTxt(e.target.value)} /></Campo>
        <label className="mini"><input type="checkbox" checked={soloMec} onChange={e => setSoloMec(e.target.checked)} /> Solo mecánicos</label>
        <button className="btn btn-pri">Buscar</button>
      </form>
      <p className="nota">{total} empleados{total > 200 ? ' (se muestran 200; afine la búsqueda)' : ''}</p>
      <div className="tabla-scroll"><table className="tabla">
        <thead><tr><th>Código</th><th>Nombre</th><th>Cargo</th><th>Mecánico</th><th>Activo</th><th>Especialidad</th><th>Áreas asignadas</th></tr></thead>
        <tbody>{filas.map(e => (
          <tr key={e.id}>
            <td>{e.codigo}</td><td>{e.nombre}</td><td>{e.cargo}</td>
            <td><input type="checkbox" checked={e.es_mecanico} onChange={x => actualizar(e.id, { es_mecanico: x.target.checked })} /></td>
            <td><input type="checkbox" checked={e.activo} onChange={x => actualizar(e.id, { activo: x.target.checked })} /></td>
            <td><input className="input-chico" defaultValue={e.especialidad ?? ''} onBlur={x => { if ((x.target.value || null) !== e.especialidad) actualizar(e.id, { especialidad: x.target.value || null }); }} /></td>
            <td>{e.es_mecanico ? (
              <div className="chips-mini">{areas.map(a => {
                const tiene = e.empleado_areas.some(x => x.area_id === a.id);
                return <button key={a.id} className={`chip chip-mini ${tiene ? 'activo' : ''}`} onClick={() => alternarArea(e, a.id, !tiene)} title={a.modulos?.nombre}>{a.nombre}</button>;
              })}</div>) : <span className="nota">—</span>}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </main>
  );
}
