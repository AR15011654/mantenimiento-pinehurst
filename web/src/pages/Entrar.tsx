import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { mensajeError, supabase } from '../lib';
import { useSesion } from '../sesion';
import { Aviso, Campo, Titulo } from '../ui';

export default function Entrar() {
  const { auth } = useSesion();
  const loc = useLocation() as { state?: { desde?: string } };
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));
  const [info, setInfo] = useState<string | null>(null);

  if (auth) return <Navigate to={loc.state?.desde || '/'} replace />;

  async function entrar(e: FormEvent) {
    e.preventDefault(); setError(null); setInfo(null); setEnviando(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: clave });
      if (error) setError(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : mensajeError(error));
    } catch (e) { setError(mensajeError(e)); }
    finally { setEnviando(false); }
  }

  async function recuperar() {
    setError(null); setInfo(null);
    if (!email.trim()) { setError('Escriba su correo para enviarle el enlace de recuperación.'); return; }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + window.location.pathname });
      if (error) setError(mensajeError(error)); else setInfo('Si el correo tiene cuenta, recibirá un enlace para crear una nueva contraseña.');
    } catch (e) { setError(mensajeError(e)); }
  }

  return (
    <main className="contenido angosto">
      <Titulo sinVolver sub="Ingrese con la cuenta que le asignó el administrador.">Iniciar sesión</Titulo>
      <form onSubmit={entrar} className="tarjeta">
        <Campo etiqueta="Correo"><input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></Campo>
        <Campo etiqueta="Contraseña"><input type="password" autoComplete="current-password" value={clave} onChange={e => setClave(e.target.value)} required /></Campo>
        {error && <Aviso tipo="error">{error}</Aviso>}
        {info && <Aviso tipo="info">{info}</Aviso>}
        <button className="btn btn-pri btn-grande" disabled={enviando}>{enviando ? 'Entrando…' : 'Entrar'}</button>
        <button type="button" className="btn btn-link" onClick={recuperar}>Olvidé mi contraseña</button>
      </form>
      <p className="nota">No hay registro público. Si necesita acceso, solicítelo al administrador de mantenimiento.</p>
    </main>
  );
}
