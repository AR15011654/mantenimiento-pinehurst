import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ESTADOS, fechaHora, supabase } from '../../lib';
import { Titulo } from '../../ui';

type Imp = { id: string; tipo: string; archivo: string; hoja: string; creado_en: string; nuevos: number; modificados: number; sin_cambios: number; errores: number; en_revision: number };

async function contar(tabla: string, f?: (q: any) => any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  let q = supabase.from(tabla).select('*', { count: 'exact', head: true });
  if (f) q = f(q);
  const { count } = await q;
  return count ?? 0;
}

export default function Panel() {
  const [c, setC] = useState<Record<string, number>>({});
  const [porEstado, setPorEstado] = useState<Record<string, Record<string, number>>>({});
  const [imps, setImps] = useState<Imp[]>([]);
  const [modulos, setModulos] = useState<{ id: string; nombre: string }[]>([]);

  useEffect(() => {
    (async () => {
      const [maq, sinClas, rev, emp, mec, usu] = await Promise.all([
        contar('maquinas'), contar('maquinas', q => q.is('modulo_id', null)), contar('maquinas', q => q.eq('requiere_revision', true)),
        contar('empleados'), contar('empleados', q => q.eq('es_mecanico', true)), contar('usuarios', q => q.eq('activo', true)),
      ]);
      setC({ maq, sinClas, rev, emp, mec, usu });
      const mods = await supabase.from('modulos').select('id, nombre').order('orden');
      setModulos(mods.data ?? []);
      const t = await supabase.from('mantenimientos').select('modulo_id, estado').in('estado', ['en_proceso', 'pendiente_validacion', 'programado']);
      const pe: Record<string, Record<string, number>> = {};
      (t.data ?? []).forEach(r => { const k = r.modulo_id ?? '-'; pe[k] ??= {}; pe[k][r.estado] = (pe[k][r.estado] ?? 0) + 1; });
      setPorEstado(pe);
      const i = await supabase.from('importaciones').select('*').order('creado_en', { ascending: false }).limit(8);
      setImps((i.data ?? []) as Imp[]);
    })();
  }, []);

  return (
    <main className="contenido">
      <Titulo sub="Vista de los tres módulos. Los indicadores completos se incorporan en la Etapa 3.">Panel general</Titulo>
      <div className="rejilla-kpi">
        <Link to="/admin/maquinaria" className="kpi"><span>{c.maq ?? '…'}</span>Máquinas</Link>
        <Link to="/admin/clasificacion" className="kpi alerta"><span>{c.sinClas ?? '…'}</span>Sin clasificar</Link>
        <Link to="/admin/maquinaria?rev=1" className="kpi alerta"><span>{c.rev ?? '…'}</span>En revisión</Link>
        <Link to="/admin/personal" className="kpi"><span>{c.emp ?? '…'}</span>Empleados</Link>
        <Link to="/admin/personal?mec=1" className="kpi"><span>{c.mec ?? '…'}</span>Mecánicos habilitados</Link>
        <Link to="/admin/usuarios" className="kpi"><span>{c.usu ?? '…'}</span>Usuarios activos</Link>
      </div>
      <section className="tarjeta">
        <h2>Trabajos abiertos por módulo</h2>
        <div className="tabla-scroll"><table className="tabla">
          <thead><tr><th>Módulo</th>{['programado', 'en_proceso', 'pendiente_validacion'].map(e => <th key={e}>{ESTADOS[e]}</th>)}</tr></thead>
          <tbody>{modulos.map(m => <tr key={m.id}><td>{m.nombre}</td>{['programado', 'en_proceso', 'pendiente_validacion'].map(e => <td key={e}>{porEstado[m.id]?.[e] ?? 0}</td>)}</tr>)}</tbody>
        </table></div>
      </section>
      <section className="acciones-grandes">
        <Link className="btn btn-pri btn-grande" to="/admin/importacion">Importación y actualización de datos</Link>
        <Link className="btn btn-sec btn-grande" to="/admin/usuarios">Usuarios y permisos</Link>
        <Link className="btn btn-sec btn-grande" to="/admin/clasificacion">Clasificar módulos y áreas</Link>
        <Link className="btn btn-sec btn-grande" to="/admin/maquinaria">Maquinaria</Link>
        <Link className="btn btn-sec btn-grande" to="/admin/personal">Personal</Link>
      </section>
      <section className="tarjeta">
        <h2>Últimas importaciones</h2>
        {imps.length === 0 && <p className="nota">Todavía no hay importaciones.</p>}
        <ul className="lista-simple">{imps.map(i => <li key={i.id}><b>{i.tipo === 'maquinaria' ? 'Maquinaria' : 'Personal'}</b> · {i.archivo} ({i.hoja}) · {fechaHora(i.creado_en)}<br /><span className="nota">Nuevos {i.nuevos} · Modificados {i.modificados} · Sin cambios {i.sin_cambios} · Errores {i.errores} · Revisión {i.en_revision}</span></li>)}</ul>
      </section>
    </main>
  );
}
