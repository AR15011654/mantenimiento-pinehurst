import { useCallback, useState } from 'react';

// Módulo y área seleccionados (preferencia de este navegador; los permisos reales los aplica el servidor).
export type Ambito = { modulo: string | null; area: string | null };
const CLAVE = 'mant.ambito';

function leer(): Ambito {
  try { return JSON.parse(localStorage.getItem(CLAVE) || '') as Ambito; } catch { return { modulo: null, area: null }; }
}

export function useAmbito() {
  const [ambito, setAmbitoState] = useState<Ambito>(leer);
  const setAmbito = useCallback((a: Ambito) => {
    setAmbitoState(a);
    try { localStorage.setItem(CLAVE, JSON.stringify(a)); } catch { /* sin almacenamiento: solo en memoria */ }
  }, []);
  return [ambito, setAmbito] as const;
}
