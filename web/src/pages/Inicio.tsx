import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../lib';
import { useSesion } from '../sesion';
import ModuloImagen, { ETIQUETA_MODULO as CORTO } from '../ModuloImagen';
import InstalarApp from '../InstalarApp';

/** Técnico: módulos para registrar. Gerente de área y administrador: sus áreas; cada una abre Mantenimiento e Inventario. */
export default function Inicio() {
  const { sesion } = useSesion();
  const perfil = sesion?.usuario?.perfil;
  const modulos = sesion?.modulos ?? [];
  // Técnicos: además de sus módulos, el inventario de los módulos que ya tienen catálogo.
  const [conInv, setConInv] = useState<string[]>([]);
  useEffect(() => {
    if (perfil !== 'tecnico') return;
    rpc<{ modulo_id: string; articulos: number }[]>('inv_resumen').then(r => setConInv(r.filter(x => x.articulos > 0).map(x => x.modulo_id))).catch(() => setConInv([]));
  }, [perfil]);

  if (perfil === 'supervisor' || perfil === 'admin') {
    return (
      <main className="contenido">
        <InstalarApp />
        {modulos.length === 0 && <p>No tiene áreas asignadas. Pida al administrador que le asigne una.</p>}
        <div className="rejilla-app">
          {modulos.map(m => (
            <Link key={m.id} to={`/area/${m.codigo}`} className="tile">
              <ModuloImagen codigo={m.codigo} etiqueta={CORTO[m.codigo] ?? m.nombre.toUpperCase()} />
              <span className="tile-nombre">{(CORTO[m.codigo] ?? m.nombre.toUpperCase()).replace('\n', ' ')}</span>
            </Link>
          ))}
          {perfil === 'admin' && (
            <Link to="/admin" className="tile">
              <ModuloImagen codigo="ADMIN" etiqueta="ADMINISTRACIÓN" />
              <span className="tile-nombre">Usuarios, datos e importación</span>
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="contenido">
      <InstalarApp />
      {modulos.length === 0 && <p>No tiene módulos asignados. Pida al administrador que le asigne uno.</p>}
      <div className="rejilla-app">
        {modulos.map(m => (
          <Link key={m.id} to={`/m/${m.codigo}`} className="tile">
            <ModuloImagen codigo={m.codigo} etiqueta={CORTO[m.codigo] ?? m.nombre.toUpperCase()} />
            <span className="tile-nombre">MANTTO. {(CORTO[m.codigo] ?? m.nombre.toUpperCase()).replace('\n', ' ')}</span>
          </Link>
        ))}
        {modulos.filter(m => conInv.includes(m.id)).map(m => (
          <Link key={'inv' + m.id} to={`/inventario/${m.codigo}`} className="tile">
            <ModuloImagen codigo="INVENTARIO" etiqueta="INVENTARIO" />
            <span className="tile-nombre">INVENTARIO {(CORTO[m.codigo] ?? m.nombre.toUpperCase()).replace('\n', ' ')}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
