import { Link, Navigate, useParams } from 'react-router-dom';
import { useSesion } from '../sesion';
import ModuloImagen, { ETIQUETA_MODULO } from '../ModuloImagen';

/** Área elegida por el gerente o administrador: 1. Mantenimiento de esa área, 2. Sistema de inventario de esa área. */
export default function Area() {
  const { codigo } = useParams();
  const { sesion } = useSesion();
  const modulo = (sesion?.modulos ?? []).find(m => m.codigo === codigo);
  if (!modulo) return <Navigate to="/" replace />;
  const nombre = (ETIQUETA_MODULO[modulo.codigo] ?? modulo.nombre.toUpperCase()).replace('\n', ' ');

  return (
    <main className="contenido">
      <div className="form-cabecera">
        <Link to="/" className="volver" aria-label="Volver a las áreas">←</Link>
        <h1>{nombre}</h1>
      </div>
      <div className="rejilla-app">
        <Link to={`/mantenimiento?m=${modulo.codigo}`} className="tile">
          <ModuloImagen codigo="MANTENIMIENTO" etiqueta="MANTENIMIENTO" />
          <span className="tile-nombre">Registro, programación y avance</span>
        </Link>
        <div className="tile deshabilitado" aria-disabled="true" title="Se construirá en la siguiente etapa">
          <ModuloImagen codigo="INVENTARIO" etiqueta="INVENTARIO" />
          <span className="tile-nombre">Sistema de inventario · Próximamente</span>
        </div>
      </div>
    </main>
  );
}
