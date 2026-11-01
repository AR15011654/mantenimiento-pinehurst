import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { supabase } from '../lib';
import { useModulo, useSesion } from '../sesion';
import { useAmbito } from '../ambito';
import { Titulo } from '../ui';

export default function ModuloInicio() {
  const { codigo } = useParams();
  const modulo = useModulo(codigo);
  const { sesion } = useSesion();
  const [ambito, setAmbito] = useAmbito();
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const area = ambito.modulo === modulo?.id ? ambito.area : null;

  useEffect(() => {
    if (modulo && ambito.modulo !== modulo.id) setAmbito({ modulo: modulo.id, area: null });
  }, [modulo, ambito.modulo, setAmbito]);

  useEffect(() => {
    if (!modulo) return;
    let q = supabase.from('mantenimientos').select('estado').eq('modulo_id', modulo.id).in('estado', ['programado', 'en_proceso', 'pendiente_validacion']);
    if (area) q = q.eq('area_id', area);
    q.then(({ data }) => {
      const c: Record<string, number> = {};
      (data ?? []).forEach(r => { c[r.estado] = (c[r.estado] ?? 0) + 1; });
      setConteo(c);
    });
  }, [modulo, area]);

  if (!modulo) return <Navigate to="/" replace />;
  const perfil = sesion?.usuario?.perfil;
  const qs = `?m=${modulo.id}${area ? `&a=${area}` : ''}`;

  return (
    <main className="contenido">
      <Titulo sub="Las áreas de este módulo comparten técnicos y registro.">{modulo.nombre}</Titulo>
      <div className="chips" role="group" aria-label="Área">
        {modulo.modulo_completo && (
          <button className={`chip ${!area ? 'activo' : ''}`} onClick={() => setAmbito({ modulo: modulo.id, area: null })}>Todo el módulo</button>
        )}
        {modulo.areas.map(a => (
          <button key={a.id} className={`chip ${area === a.id ? 'activo' : ''}`} onClick={() => setAmbito({ modulo: modulo.id, area: a.id })}>{a.nombre}</button>
        ))}
      </div>
      <div className="acciones-grandes">
        <Link className="btn btn-pri btn-gigante" to={`/escanear${qs}`}>Escanear o buscar máquina</Link>
        <Link className="btn btn-sec btn-gigante" to={`/trabajos${qs}&e=en_proceso`}>En proceso <b>{conteo.en_proceso ?? 0}</b></Link>
        <Link className="btn btn-sec btn-gigante" to={`/trabajos${qs}&e=pendiente_validacion`}>
          {perfil === 'tecnico' ? 'Pendientes de validación' : 'Por validar'} <b>{conteo.pendiente_validacion ?? 0}</b>
        </Link>
        <Link className="btn btn-sec btn-gigante" to={`/trabajos${qs}&e=programado`}>Programados <b>{conteo.programado ?? 0}</b></Link>
        <Link className="btn btn-sec btn-gigante" to={`/historial${qs}`}>Historial y exportación</Link>
      </div>
    </main>
  );
}
