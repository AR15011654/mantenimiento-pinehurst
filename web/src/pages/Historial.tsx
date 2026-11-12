import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { duracion, ESTADOS, fechaHora, fechaHoraExcel, Mantenimiento, mensajeError, supabase, TIPOS } from '../lib';
import { descargarExcel } from '../excel';
import { useSesion } from '../sesion';
import { Aviso, Campo, Insignia, Titulo } from '../ui';

type Filtros = { desde: string; hasta: string; modulo: string; area: string; ubicacion: string; maquina: string; mecanico: string; tipo: string; estado: string };

function hoyMenos(d: number) {
  const x = new Date(Date.now() - d * 864e5);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa' }).format(x);
}
const limpio = (s: string) => s.replace(/[%_,()"\\]/g, ' ').trim();

export default function Historial() {
  const [params] = useSearchParams();
  const { sesion } = useSesion();
  const [f, setF] = useState<Filtros>({ desde: hoyMenos(30), hasta: hoyMenos(0), modulo: params.get('m') ?? '', area: params.get('a') ?? '', ubicacion: '', maquina: '', mecanico: '', tipo: '', estado: '' });
  const [filas, setFilas] = useState<Mantenimiento[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const modulos = sesion?.modulos ?? [];
  const areas = modulos.find(m => m.id === f.modulo)?.areas ?? [];
  const LIMITE = 2000;

  async function buscar(e?: FormEvent) {
    e?.preventDefault(); setCargando(true); setError(null);
    try {
      // Período por fecha de inicio, en hora de Tegucigalpa (UTC-6).
      let q = supabase.from('mantenimientos').select('*')
        .gte('inicio_en', `${f.desde}T00:00:00-06:00`).lte('inicio_en', `${f.hasta}T23:59:59.999-06:00`)
        .order('inicio_en', { ascending: false }).limit(LIMITE);
      if (f.modulo) q = q.eq('modulo_id', f.modulo);
      if (f.area) q = q.eq('area_id', f.area);
      if (f.tipo) q = q.eq('tipo', f.tipo);
      if (f.estado) q = q.eq('estado', f.estado);
      if (f.ubicacion) q = q.ilike('snap_ubicacion', `%${limpio(f.ubicacion)}%`);
      if (f.maquina) { const v = `"%${limpio(f.maquina)}%"`; q = q.or(`snap_qr.ilike.${v},snap_serie.ilike.${v},snap_maquina.ilike.${v},snap_asset_id.ilike.${v}`); }
      if (f.mecanico) { const v = `"%${limpio(f.mecanico)}%"`; q = q.or(`snap_mecanico_nombre.ilike.${v},snap_mecanico_codigo.ilike.${v}`); }
      const { data, error } = await q;
      if (error) throw error;
      setFilas(data as Mantenimiento[]);
    } catch (e) { setError(mensajeError(e)); }
    finally { setCargando(false); }
  }
  useEffect(() => { buscar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportar() {
    if (!filas?.length) return;
    setExportando(true); setError(null);
    try {
      const coment: Record<string, string[]> = {};
      for (let i = 0; i < filas.length; i += 200) {
        const ids = filas.slice(i, i + 200).map(r => r.id);
        const { data, error } = await supabase.from('mantenimiento_comentarios').select('mantenimiento_id, texto, creado_en').in('mantenimiento_id', ids).order('creado_en');
        if (error) throw error;
        (data ?? []).forEach(c => { (coment[c.mantenimiento_id] ??= []).push(c.texto); });
      }
      await descargarExcel(`mantenimientos_${f.desde}_${f.hasta}.xlsx`, 'Mantenimientos', [
        { titulo: 'FOLIO', clave: 'folio', ancho: 8 }, { titulo: 'MODULO', clave: 'snap_modulo', ancho: 26 }, { titulo: 'AREA', clave: 'snap_area' },
        { titulo: 'UBICACION / LINEA', clave: 'snap_ubicacion' }, { titulo: 'PUESTO', clave: 'snap_puesto', ancho: 10 },
        { titulo: 'QR', clave: 'snap_qr' }, { titulo: 'SERIE', clave: 'snap_serie' }, { titulo: 'ASSET ID', clave: 'snap_asset_id', ancho: 26 },
        { titulo: 'MAQUINA', clave: 'snap_maquina', ancho: 22 }, { titulo: 'QR MECANICO', clave: 'snap_mecanico_codigo', ancho: 12 },
        { titulo: 'MECANICO', clave: 'snap_mecanico_nombre', ancho: 32 }, { titulo: 'SERVICIO EXTERNO', clave: 'externo_txt', ancho: 10 }, { titulo: 'TIPO DE MANTENIMIENTO', clave: 'tipo_txt', ancho: 16 },
        { titulo: 'ESTADO', clave: 'estado_txt', ancho: 22 },
        { titulo: 'INICIO ACTIVIDAD (Tegucigalpa)', clave: 'inicio', ancho: 18 }, { titulo: 'FINAL ACTIVIDAD (Tegucigalpa)', clave: 'fin', ancho: 18 },
        { titulo: 'DURACION MANTENIMIENTO (min)', clave: 'duracion_min', ancho: 14 },
        { titulo: 'COMENTARIO', clave: 'comentarios', ancho: 60 },
        { titulo: 'SEMANA', clave: 'semana', ancho: 8 }, { titulo: 'AÑO', clave: 'anio', ancho: 8 }, { titulo: 'MES', clave: 'mes', ancho: 6 },
      ], filas.map(r => ({ ...r, tipo_txt: TIPOS[r.tipo], externo_txt: r.servicio_externo ? 'SI' : 'NO', estado_txt: ESTADOS[r.estado], inicio: fechaHoraExcel(r.inicio_en), fin: fechaHoraExcel(r.fin_en),
        duracion_min: r.duracion_min === null ? '' : Number(r.duracion_min), comentarios: (coment[r.id] ?? []).join(' | ') })));
    } catch (e) { setError(mensajeError(e)); }
    finally { setExportando(false); }
  }

  const set = (k: keyof Filtros) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value, ...(k === 'modulo' ? { area: '' } : {}) }));

  return (
    <main className="contenido">
      <Titulo sub="Semana, mes y año se calculan sobre el FINAL de la actividad (hora de Tegucigalpa), igual que en AppSheet.">Historial de mantenimientos</Titulo>
      <form className="tarjeta filtros" onSubmit={buscar}>
        <Campo etiqueta="Desde (inicio)"><input type="date" value={f.desde} onChange={set('desde')} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" value={f.hasta} onChange={set('hasta')} /></Campo>
        <Campo etiqueta="Módulo"><select value={f.modulo} onChange={set('modulo')}><option value="">Todos</option>{modulos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Área"><select value={f.area} onChange={set('area')} disabled={!f.modulo}><option value="">Todas</option>{areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Ubicación / línea"><input value={f.ubicacion} onChange={set('ubicacion')} placeholder="LINE 11" /></Campo>
        <Campo etiqueta="Máquina (QR, serie, tipo)"><input value={f.maquina} onChange={set('maquina')} /></Campo>
        <Campo etiqueta="Mecánico (nombre o código)"><input value={f.mecanico} onChange={set('mecanico')} /></Campo>
        <Campo etiqueta="Tipo"><select value={f.tipo} onChange={set('tipo')}><option value="">Todos</option><option value="preventivo">Preventivo</option><option value="correctivo">Correctivo</option></select></Campo>
        <Campo etiqueta="Estado"><select value={f.estado} onChange={set('estado')}><option value="">Todos</option>{Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
        <div className="fila-botones">
          <button className="btn btn-pri" disabled={cargando}>{cargando ? 'Buscando…' : 'Buscar'}</button>
          <button type="button" className="btn btn-sec" disabled={!filas?.length || exportando} onClick={exportar}>{exportando ? 'Generando…' : 'Exportar a Excel'}</button>
        </div>
      </form>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {filas && (
        <>
          <p className="nota">{filas.length} registros{filas.length === LIMITE ? ` (se muestran los primeros ${LIMITE}; reduzca el período)` : ''} · Duración total: {duracion(filas.reduce((s, r) => s + Number(r.duracion_min ?? 0), 0))}</p>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead><tr><th>Folio</th><th>Estado</th><th>Tipo</th><th>Máquina</th><th>QR</th><th>Área</th><th>Ubicación</th><th>Mecánico</th><th>Inicio</th><th>Final</th><th>Duración</th><th>Sem.</th></tr></thead>
              <tbody>
                {filas.map(r => (
                  <tr key={r.id}>
                    <td><Link to={`/trabajo/${r.id}`}>#{r.folio}</Link></td><td><Insignia estado={r.estado} /></td><td>{TIPOS[r.tipo]}</td>
                    <td>{r.snap_maquina}</td><td>{r.snap_qr}</td><td>{r.snap_area ?? r.snap_modulo}</td><td>{r.snap_ubicacion}</td>
                    <td>{r.snap_mecanico_nombre}{r.servicio_externo && <span className="nota"> · Externo</span>}</td><td>{fechaHora(r.inicio_en)}</td><td>{fechaHora(r.fin_en)}</td><td>{duracion(r.duracion_min)}</td><td>{r.semana ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
