import React from 'react';
import ReactDOM from 'react-dom/client';
import { supabase } from './lib';
import App from './App';
import { iniciarTraduccion } from './idioma';
import { aplicarTema, temaGuardado } from './tema';

aplicarTema(temaGuardado());
import './estilos.css';

// Los enlaces de invitación y de recuperación llegan como #access_token=...&type=invite.
// La app usa rutas con # (GitHub Pages), así que primero dejamos que Supabase lea el token
// y luego cambiamos la dirección a la pantalla correcta.
// Si se publicó una versión nueva mientras la página estaba abierta, los archivos viejos ya no existen:
// se recarga una sola vez para tomar la versión nueva (evita "Failed to fetch dynamically imported module").
export function recargarPorVersionNueva() {
  try {
    const ultima = Number(sessionStorage.getItem('recarga-version') ?? 0);
    if (Date.now() - ultima < 60000) return false;
    sessionStorage.setItem('recarga-version', String(Date.now()));
  } catch { /* sin almacenamiento: recargar igual */ }
  window.location.reload();
  return true;
}
window.addEventListener('vite:preloadError', e => { if (recargarPorVersionNueva()) e.preventDefault(); });

// Instalación como app (ícono en la pantalla del teléfono).
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); (window as unknown as { __instalar?: Event }).__instalar = e; window.dispatchEvent(new Event('instalable')); });
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* sin instalación */ }); });
}

async function iniciar() {
  const hash = window.location.hash;
  if (hash.includes('access_token=') || hash.includes('error_description=')) {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const tipo = params.get('type');
    const error = params.get('error_description');
    await supabase.auth.getSession();
    window.history.replaceState(null, '', window.location.pathname + window.location.search +
      (error ? `#/entrar?error=${encodeURIComponent(error)}` : (tipo === 'invite' || tipo === 'recovery') ? '#/cambiar-clave' : '#/'));
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
  iniciarTraduccion();
}
iniciar();
