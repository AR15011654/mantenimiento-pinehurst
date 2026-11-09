import { useCallback, useEffect, useState } from 'react';
import { descargarExcel } from '../../excel';
import { fechaHora, mensajeError, rpc, supabase } from '../../lib';
import { Aviso } from '../../ui';

type Imp = {
  id: string; tipo: 'maquinaria' | 'personal'; archivo: string; hoja: string; estado: string; creado_en: string;
  total_filas: number | null; nuevos: number | null; modificados: number | null; sin_cambios: number | null; en_revision: number | null; errores: number | null;
  anulada_en: string | null; motivo_anulacion: string | null;
  resultado_anulacion: { borrados: number; revertidos: number; conservados: { clave: string; motivo: string }[] } | null;
};
type Fila = { fila_origen: number; clave: string | null; resultado: string; mensajes: string[] | null; cambios: Record<string, { antes: string | null; despues: string | null }> | null };

const RES: Record<string, string> = { nuevo: 'Nuevo', modificado: 'Modificado', sin_cambios: 'Sin cambios', revision: 'En revisión', error: 'Error' };

/** Lista de importaciones realizadas, con detalle por fila y opción de deshacer la última de cada tipo. */
export default function HistorialImportaciones({ recarga }: { recarga: number }) {
  const [imps, setImps] = useState<Imp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [filtro, setFiltro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await supabase.from('importaciones').select('*').order('creado_en', { ascending: false }).limit(50);
    if (r.error) setError(mensajeError(r.error)); else setImps(r.data as Imp[]);
  }, []);
  useEffect(() => { cargar(); }, [cargar, recarga]);

  async function verFilas(id: string) {
    if (abierta === id) { setAbierta(null); return; }
    setAbierta(id); setFilas([]); setFiltro('');
    const out: Fila[] = [];
    for (let desde = 0; ; desde += 1000) {
      const r = await supabase.from('importacion_filas').select('fila_origen, clave, resultado, mensajes, cambios')
        .eq('importacion_id', id).order('fila_origen').range(desde, desde + 999);
      if (r.error) { setError(mensajeError(r.error)); return; }
      out.push(...(r.data as Fila[]));
      if (r.data.length < 1000) break;
    }
    setFilas(out);
  }

  // La última importación vigente de cada tipo es la única que se puede deshacer.
  const ultimas = new Set(['maquinaria', 'personal'].map(t => imps.find(i => i.tipo === t && i.estado === 'aplicada')?.id).filter(Boolean));

  async function deshacer(i: Imp) {
    const motivo = prompt(`Deshacer la importación "${i.archivo}" (${fechaHora(i.creado_en)}).\n\n` +
      `Se borrarán los ${i.nuevos ?? 0} registros que creó (si no tienen trabajos registrados) y se devolverán a su valor anterior los ${i.modificados ?? 0} que modificó.\n\nEscriba el motivo:`);
    if (motivo === null) return;
    if (!motivo.trim()) { setError('Debe indicar el motivo.'); return; }
    setOcupado(true); setError(null); setAviso(null);
    try {
      const r = await rpc<{ borrados: number; revertidos: number; conservados: { clave: string; motivo: string }[] }>('admin_deshacer_importacion', { p_id: i.id, p_motivo: motivo.trim() });
      setAviso(`Importación deshecha. Registros borrados: ${r.borrados} · devueltos a su valor anterior: ${r.revertidos}` +
        (r.conservados.length ? ` · conservados por tener trabajos: ${r.conservados.map(c => c.clave).join(', ')}` : ''));
      await cargar();
    } catch (e) { setError((e as Error).message); }
    finally { setOcupado(false); }
  }

  const visibles = filtro ? filas.filter(f => f.resultado === filtro) : filas;
  const imp = imps.find(i => i.id === abierta);

  return (
    <section className="tarjeta">
      <h2>Importaciones realizadas</h2>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {imps.length === 0 && <p className="nota">Todavía no hay importaciones.</p>}
      {imps.length > 0 && (
        <div className="tabla-scroll"><table className="tabla">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Archivo / hoja</th><th>Filas</th><th>Nuevos</th><th>Modif.</th><th>Revisión</th><th>Errores</th><th>Estado</th><th></th></tr></thead>
          <tbody>{imps.map(i => (
            <tr key={i.id} className={i.estado === 'anulada' ? 'inactivo' : abierta === i.id ? 'sel' : ''}>
              <td>{fechaHora(i.creado_en)}</td><td>{i.tipo === 'maquinaria' ? 'Maquinaria' : 'Personal'}</td>
              <td>{i.archivo}<br /><span className="nota">{i.hoja}</span></td>
              <td>{i.total_filas}</td><td>{i.nuevos}</td><td>{i.modificados}</td><td>{i.en_revision}</td><td>{i.errores}</td>
              <td>{i.estado === 'anulada'
                ? <>Deshecha<br /><span className="nota">{fechaHora(i.anulada_en)} · {i.motivo_anulacion}</span></>
                : 'Aplicada'}</td>
              <td className="acciones-celda">
                <button className="btn btn-link" onClick={() => verFilas(i.id)}>{abierta === i.id ? 'Ocultar' : 'Ver filas'}</button>
                {ultimas.has(i.id) && <button className="btn btn-link peligro" disabled={ocupado} onClick={() => deshacer(i)}>Deshacer</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="nota">Importar dos veces el mismo archivo no duplica registros: la máquina se identifica por su Asset ID y el empleado por su código. Solo se puede deshacer la última importación de cada tipo.</p>

      {imp && (
        <div>
          <h3>Filas de {imp.archivo}</h3>
          <div className="chips">
            <button className={`chip chip-mini ${!filtro ? 'activo' : ''}`} onClick={() => setFiltro('')}>Todas ({filas.length})</button>
            {Object.entries(RES).map(([k, v]) => {
              const n = filas.filter(f => f.resultado === k).length;
              return n ? <button key={k} className={`chip chip-mini ${filtro === k ? 'activo' : ''}`} onClick={() => setFiltro(k)}>{v} ({n})</button> : null;
            })}
            <button className="btn btn-sec btn-chico" onClick={() => descargarExcel(`importacion_${imp.archivo.replace(/\.xlsx$/i, '')}.xlsx`, 'Filas',
              [{ titulo: 'FILA EXCEL', clave: 'fila_origen', ancho: 10 }, { titulo: 'CLAVE', clave: 'clave', ancho: 28 }, { titulo: 'RESULTADO', clave: 'resultado', ancho: 14 }, { titulo: 'MENSAJES', clave: 'mensajes', ancho: 90 }],
              visibles.map(f => ({ ...f, resultado: RES[f.resultado] ?? f.resultado, mensajes: (f.mensajes ?? []).join(' | ') })))}>Descargar</button>
          </div>
          <div className="tabla-scroll alto"><table className="tabla">
            <thead><tr><th>Fila</th><th>Clave</th><th>Resultado</th><th>Detalle</th></tr></thead>
            <tbody>{visibles.slice(0, 500).map(f => (
              <tr key={f.fila_origen + (f.clave ?? '')}><td>{f.fila_origen}</td><td>{f.clave}</td><td>{RES[f.resultado] ?? f.resultado}</td>
                <td>{(f.mensajes ?? []).join(' · ')}{Object.entries(f.cambios ?? {}).map(([k, v]) => <div key={k} className="cambio"><b>{k}</b>: {v.antes ?? '(vacío)'} → {v.despues ?? '(vacío)'}</div>)}</td></tr>
            ))}</tbody>
          </table></div>
          {visibles.length > 500 && <p className="nota">Se muestran 500 de {visibles.length}. Use Descargar para verlas todas.</p>}
        </div>
      )}
    </section>
  );
}
