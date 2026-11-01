import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { rpc, Sesion, supabase } from './lib';

type Ctx = {
  auth: Session | null;
  sesion: Sesion | null;
  cargando: boolean;
  error: string | null;
  recargar: () => Promise<void>;
  salir: () => Promise<void>;
};

const SesionCtx = createContext<Ctx>(null as unknown as Ctx);
export const useSesion = () => useContext(SesionCtx);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<Session | null>(null);
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargarPerfil = useCallback(async (s: Session | null) => {
    setError(null);
    if (!s) { setSesion(null); setCargando(false); return; }
    try { setSesion(await rpc<Sesion>('mi_sesion')); }
    catch (e) { setError((e as Error).message); }
    finally { setCargando(false); }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setAuth(data.session); cargarPerfil(data.session); });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setAuth(s);
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') cargarPerfil(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [cargarPerfil]);

  const recargar = useCallback(async () => { await cargarPerfil(auth); }, [auth, cargarPerfil]);
  const salir = useCallback(async () => { await supabase.auth.signOut(); setSesion(null); }, []);

  return <SesionCtx.Provider value={{ auth, sesion, cargando, error, recargar, salir }}>{children}</SesionCtx.Provider>;
}

export function useModulo(codigo?: string) {
  const { sesion } = useSesion();
  return sesion?.modulos?.find(m => m.codigo === codigo);
}
