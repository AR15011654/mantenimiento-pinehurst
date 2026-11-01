import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib';
import { useSesion } from '../sesion';
import { Titulo } from '../ui';

export default function Inicio() {
  const { sesion } = useSesion();
  const [abiertos, setAbiertos] = useState<Record<string, number>>({});

  useEffect(() => {
    // Conteo de trabajos abiertos por módulo (RLS limita lo que cada usuario ve).
    supabase.from('mantenimientos').select('modulo_id, estado').in('estado', ['en_proceso', 'pendiente_validacion'])
      .then(({ data }) => {
        const c: Record<string, number> = {};
        (data ?? []).forEach(r => { if (r.modulo_id) c[r.modulo_id] = (c[r.modulo_id] ?? 0) + 1; });
        setAbiertos(c);
      });
  }, []);

  const modulos = sesion?.modulos ?? [];
  return (
    <main className="contenido">
      <Titulo sub="Seleccione el módulo en el que va a trabajar.">Módulos</Titulo>
      {modulos.length === 0 && <p>No tiene módulos asignados. Pida al administrador que le asigne uno.</p>}
      <div className="rejilla-modulos">
        {modulos.map(m => (
          <Link key={m.id} to={`/m/${m.codigo}`} className="tarjeta-modulo">
            <span className="tm-nombre">{m.nombre}</span>
            <span className="tm-areas">{m.areas.map(a => a.nombre).join(' · ')}</span>
            {abiertos[m.id] ? <span className="tm-cont">{abiertos[m.id]} trabajos abiertos</span> : <span className="tm-cont tm-cero">Sin trabajos abiertos</span>}
          </Link>
        ))}
      </div>
      {sesion?.usuario?.perfil === 'admin' && (
        <p><Link className="btn btn-sec" to="/admin">Panel general de administración</Link></p>
      )}
    </main>
  );
}
