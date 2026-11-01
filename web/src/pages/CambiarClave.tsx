import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { mensajeError, supabase } from '../lib';
import { useSesion } from '../sesion';
import { Aviso, Campo, Titulo } from '../ui';

export default function CambiarClave() {
  const { auth } = useSesion();
  const [clave, setClave] = useState('');
  const [clave2, setClave2] = useState('');
  const [estado, setEstado] = useState<'editar' | 'guardando' | 'listo'>('editar');
  const [error, setError] = useState<string | null>(null);

  if (!auth) return <main className="contenido angosto"><Aviso tipo="alerta">El enlace no es válido o ya expiró. Pida al administrador que le envíe uno nuevo, o use "Olvidé mi contraseña".</Aviso><Link to="/entrar">Ir a iniciar sesión</Link></main>;

  async function guardar(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (clave.length < 10) { setError('Use al menos 10 caracteres.'); return; }
    if (clave !== clave2) { setError('Las contraseñas no coinciden.'); return; }
    setEstado('guardando');
    try {
      const { error } = await supabase.auth.updateUser({ password: clave });
      if (error) { setError(mensajeError(error)); setEstado('editar'); } else setEstado('listo');
    } catch (e) { setError(mensajeError(e)); setEstado('editar'); }
  }

  if (estado === 'listo') return <main className="contenido angosto"><Aviso tipo="ok">Contraseña guardada.</Aviso><Link className="btn btn-pri btn-grande" to="/">Continuar</Link></main>;

  return (
    <main className="contenido angosto">
      <Titulo sub={auth.user.email}>Crear contraseña</Titulo>
      <form className="tarjeta" onSubmit={guardar}>
        <Campo etiqueta="Nueva contraseña" ayuda="Mínimo 10 caracteres."><input type="password" autoComplete="new-password" value={clave} onChange={e => setClave(e.target.value)} /></Campo>
        <Campo etiqueta="Repita la contraseña"><input type="password" autoComplete="new-password" value={clave2} onChange={e => setClave2(e.target.value)} /></Campo>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <button className="btn btn-pri btn-grande" disabled={estado === 'guardando'}>{estado === 'guardando' ? 'Guardando…' : 'Guardar contraseña'}</button>
      </form>
    </main>
  );
}
