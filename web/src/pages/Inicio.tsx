import { Link } from 'react-router-dom';
import { useSesion } from '../sesion';
import ModuloImagen from '../ModuloImagen';

const CORTO: Record<string, string> = {
  COSTURA_PD: 'COSTURA Y PD',
  SERIGRAFIA_BORDADO_SUBLIMADO: 'SERIGRAFÍA',
  CORTE_BODEGA_STAGING: 'CORTE Y BODEGA',
};

export default function Inicio() {
  const { sesion } = useSesion();
  const modulos = sesion?.modulos ?? [];
  return (
    <main className="contenido">
      {modulos.length === 0 && <p>No tiene módulos asignados. Pida al administrador que le asigne uno.</p>}
      <div className="rejilla-app">
        {modulos.map(m => (
          <Link key={m.id} to={`/m/${m.codigo}`} className="tile">
            <ModuloImagen codigo={m.codigo} etiqueta={CORTO[m.codigo] ?? m.nombre.toUpperCase()} />
            <span className="tile-nombre">MANTTO. {CORTO[m.codigo] ?? m.nombre.toUpperCase()}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
