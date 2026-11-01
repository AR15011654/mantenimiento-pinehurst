import { HashRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { ProveedorSesion, useSesion } from './sesion';
import { configurado } from './lib';
import { Aviso, Cargando } from './ui';
import Entrar from './pages/Entrar';
import CambiarClave from './pages/CambiarClave';
import Inicio from './pages/Inicio';
import ModuloInicio from './pages/ModuloInicio';
import Escanear from './pages/Escanear';
import FichaMaquina from './pages/FichaMaquina';
import Trabajo from './pages/Trabajo';
import Trabajos from './pages/Trabajos';
import Historial from './pages/Historial';
import Panel from './pages/admin/Panel';
import Usuarios from './pages/admin/Usuarios';
import Maquinaria from './pages/admin/Maquinaria';
import Personal from './pages/admin/Personal';
import Clasificacion from './pages/admin/Clasificacion';
import Importacion from './pages/admin/Importacion';

function Protegida({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { auth, sesion, cargando, error, salir, recargar } = useSesion();
  const loc = useLocation();
  if (cargando) return <Cargando />;
  if (!auth) return <Navigate to="/entrar" state={{ desde: loc.pathname }} replace />;
  if (error) return <main className="contenido"><Aviso tipo="error" onReintentar={recargar}>{error}</Aviso></main>;
  if (!sesion?.autorizado) {
    return (
      <main className="contenido">
        <Aviso tipo="alerta">
          {sesion?.motivo === 'inactivo'
            ? 'Su cuenta está desactivada. Comuníquese con el administrador.'
            : 'Su cuenta todavía no tiene acceso a esta aplicación. El administrador debe autorizarla.'}
        </Aviso>
        <button className="btn btn-sec" onClick={salir}>Cerrar sesión</button>
      </main>
    );
  }
  if (admin && sesion.usuario?.perfil !== 'admin') return <main className="contenido"><Aviso tipo="error">Sección exclusiva del administrador.</Aviso></main>;
  return <>{children}</>;
}

function Marco({ children }: { children: ReactNode }) {
  const { sesion, salir, auth } = useSesion();
  const perfil = sesion?.usuario?.perfil;
  return (
    <div className="marco">
      <header className="barra">
        <Link to="/" className="marca">Mantenimiento <b>Pinehurst</b></Link>
        {auth && sesion?.autorizado && (
          <div className="barra-der">
            <span className="quien">{sesion.usuario?.nombre || sesion.usuario?.email} · {perfil === 'admin' ? 'Administrador' : perfil === 'supervisor' ? 'Supervisor' : 'Técnico'}</span>
            <button className="btn btn-link" onClick={salir}>Salir</button>
          </div>
        )}
      </header>
      {auth && sesion?.autorizado && (
        <nav className="menu">
          <NavLink to="/" end>Inicio</NavLink>
          <NavLink to="/escanear">Escanear</NavLink>
          <NavLink to="/trabajos">Trabajos</NavLink>
          <NavLink to="/historial">Historial</NavLink>
          {perfil === 'admin' && <NavLink to="/admin">Administración</NavLink>}
        </nav>
      )}
      {children}
    </div>
  );
}

export default function App() {
  if (!configurado) {
    return <main className="contenido"><Aviso tipo="error">Falta configurar VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Vea el archivo LEEME.</Aviso></main>;
  }
  return (
    <ProveedorSesion>
      <HashRouter>
        <Marco>
          <Routes>
            <Route path="/entrar" element={<Entrar />} />
            <Route path="/cambiar-clave" element={<CambiarClave />} />
            <Route path="/" element={<Protegida><Inicio /></Protegida>} />
            <Route path="/m/:codigo" element={<Protegida><ModuloInicio /></Protegida>} />
            <Route path="/escanear" element={<Protegida><Escanear /></Protegida>} />
            <Route path="/maquina/:id" element={<Protegida><FichaMaquina /></Protegida>} />
            <Route path="/trabajo/:id" element={<Protegida><Trabajo /></Protegida>} />
            <Route path="/trabajos" element={<Protegida><Trabajos /></Protegida>} />
            <Route path="/historial" element={<Protegida><Historial /></Protegida>} />
            <Route path="/admin" element={<Protegida admin><Panel /></Protegida>} />
            <Route path="/admin/usuarios" element={<Protegida admin><Usuarios /></Protegida>} />
            <Route path="/admin/maquinaria" element={<Protegida admin><Maquinaria /></Protegida>} />
            <Route path="/admin/personal" element={<Protegida admin><Personal /></Protegida>} />
            <Route path="/admin/clasificacion" element={<Protegida admin><Clasificacion /></Protegida>} />
            <Route path="/admin/importacion" element={<Protegida admin><Importacion /></Protegida>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Marco>
      </HashRouter>
    </ProveedorSesion>
  );
}
