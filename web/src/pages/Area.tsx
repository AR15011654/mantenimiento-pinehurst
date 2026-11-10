import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { rpc } from '../lib';
import { useSesion } from '../sesion';
import ModuloImagen, { ETIQUETA_MODULO } from '../ModuloImagen';

/** Área elegida por el gerente o administrador: 1. Mantenimiento de esa área, 2. Sistema de inventario de esa área. */
export default function Area() {
  const { codigo } = useParams();
  const { sesion } = useSesion();
  const modulo = (sesion?.modulos ?? []).find(m => m.codigo === codigo);
  const [articulos, setArticulos] = useState<number | null>(null);
  useEffect(() => {
    rpc<{ modulo_id: string; articulos: number }[]>('inv_resumen').then(r => setArticulos(r.find(x => x.modulo_id === modulo?.id)?.articulos ?? 0)).catch(() => setArticulos(0));
  }, [modulo?.id]);
  const conInventario = (articulos ?? 0) > 0 || sesion?.usuario?.perfil === 'admin';
  if (!modulo) return <Navigate to="/" replace />;
  const nombre = (ETIQUETA_MODULO[modulo.codigo] ?? modulo.nombre.toUpperCase()).replace('\n', ' ');

  return (
    <main className="contenido">
      <div className="form-cabecera">
        <Link to="/" className="volver" aria-label="Volver a las áreas">←</Link>
        <h1>{nombre}</h1>
      </div>
      <div className="rejilla-app">
        {/* Gerente y administrador: panel de mantenimiento del módulo, limitado a sus áreas autorizadas. */}
        <Link to={`/mantenimiento?m=${modulo.codigo}`} className="tile">
          <ModuloImagen codigo="MANTENIMIENTO" etiqueta="MANTENIMIENTO" />
          <span className="tile-nombre">Registro, programación, avance y costos</span>
        </Link>
        {conInventario ? (
          <Link to={`/inventario/${modulo.codigo}`} className="tile">
            <ModuloImagen codigo="INVENTARIO" etiqueta="INVENTARIO" />
            <span className="tile-nombre">{articulos ? `Sistema de inventario · ${articulos} repuestos` : 'Sistema de inventario · cargar catálogo'}</span>
          </Link>
        ) : (
          <div className="tile deshabilitado" aria-disabled="true" title="Todavía no tiene catálogo de repuestos">
            <ModuloImagen codigo="INVENTARIO" etiqueta="INVENTARIO" />
            <span className="tile-nombre">Sistema de inventario · {articulos === null ? '…' : 'Próximamente'}</span>
          </div>
        )}
      </div>
    </main>
  );
}
