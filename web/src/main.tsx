import React from 'react';
import ReactDOM from 'react-dom/client';
import { supabase } from './lib';
import App from './App';
import './estilos.css';

// Los enlaces de invitación y de recuperación llegan como #access_token=...&type=invite.
// La app usa rutas con # (GitHub Pages), así que primero dejamos que Supabase lea el token
// y luego cambiamos la dirección a la pantalla correcta.
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
}
iniciar();
