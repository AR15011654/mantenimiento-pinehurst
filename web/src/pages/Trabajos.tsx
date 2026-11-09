import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { duracion, ESTADOS, fechaHora, Mantenimiento, mensajeError, supabase, TIPOS } from '../lib';
import { useSesion } from '../sesion';
import { Aviso, Cargando, Insignia, Titulo } from '../ui';

const PESTANAS = ['en_proceso', 'completado', 'cancelado'];

export default function Trabajos() {
  const [params, setParams] = useSearchParams();
  const { sesion } = useSesion();
  const estado = params.get('e') ?? 'en_proceso';
  const modulo = params.get('m');
  const area = params.get('a');
  const [filas, setFilas] = useState<Mantenimiento[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFilas(null); setError(null);
    let q = supabase.from('mantenimientos').select('*').eq('estado', estado).order('creado_en', { ascending: false }).limit(200);
    if (modulo) q = q.eq('modulo_id', modulo);
    if (area) q = q.eq('area_id', area);
    q.then(({ data, error }) => { if (error) setError(mensajeError(error)); else setFilas(data as Mantenimiento[]); });
  }, [estado, modulo, area]);

  const nombreModulo = sesion?.modulos?.find(m => m.id === modulo);
  const nombreArea = nombreModulo?.areas.find(a => a.id === area);
  function cambiar(e: string) { const p = new URLSearchParams(params); p.set('e', e); setParams(p, { replace: true }); }

  return (
    <main className="contenido">
      <Titulo sub={nombreModulo ? `${nombreModulo.nombre}${nombreArea ? ' · ' + nombreArea.nombre : ''}` : 'Todos sus módulos'}>
        {sesion?.usuario?.perfil === 'tecnico' ? 'Mis trabajos' : 'Trabajos'}
      </Titulo>
      <div className="chips">
        {PESTANAS.map(p => <button key={p} className={`chip ${estado === p ? 'activo' : ''}`} onClick={() => cambiar(p)}>{ESTADOS[p]}</button>)}
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!filas && !error && <Cargando />}
      {filas && filas.length === 0 && <p className="nota">No hay trabajos en este estado.</p>}
      <ul className="lista">
        {filas?.map(t => (
          <li key={t.id}><Link to={`/trabajo/${t.id}`} className="item">
            <b>#{t.folio}</b> {t.snap_maquina} · {TIPOS[t.tipo]} <Insignia estado={t.estado} />
            <span className="item-sub">{t.snap_area ?? t.snap_modulo} · {t.snap_ubicacion ?? '—'} · QR {t.snap_qr ?? '—'} · {t.snap_mecanico_nombre}</span>
            <span className="item-sub">Inicio {fechaHora(t.inicio_en)}{t.fin_en ? ` · Final ${fechaHora(t.fin_en)}` : ''} · {duracion(t.duracion_min)}</span>
          </Link></li>
        ))}
      </ul>
    </main>
  );
}
