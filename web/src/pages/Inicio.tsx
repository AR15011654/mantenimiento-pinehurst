import { Link } from 'react-router-dom';
import { useSesion } from '../sesion';
import ModuloImagen from '../ModuloImagen';

const CORTO: Record<string, string> = {
  COSTURA_PD: 'COSTURA Y PD',
  SERIGRAFIA_BORDADO_SUBLIMADO: 'SERIGRAFÍA',
  CORTE_BODEGA_STAGING: 'CORTE Y BODEGA',
};

/** Técnico: módulos para registrar. Gerente de área y administrador: Mantenimiento e Inventario. */
export default function Inicio() {
  const { sesion } = useSesion();
  const perfil = sesion?.usuario?.perfil;
  const modulos = sesion?.modulos ?? [];

  if (perfil === 'supervisor' || perfil === 'admin') {
    return (
      <main className="contenido">
        <div className="rejilla-app">
          <Link to="/mantenimiento" className="tile">
            <ModuloImagen codigo="MANTENIMIENTO" etiqueta="MANTENIMIENTO" />
            <span className="tile-nombre">Programación, avance y registros</span>
          </Link>
          <div className="tile deshabilitado" aria-disabled="true" title="Se construirá en la siguiente etapa">
            <ModuloImagen codigo="INVENTARIO" etiqueta="INVENTARIO" />
            <span className="tile-nombre">Próximamente</span>
          </div>
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
