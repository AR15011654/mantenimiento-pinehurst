import { createClient, PostgrestError } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const configurado = Boolean(url && key);

// Solo la clave pública (publishable/anon). La seguridad la aplica RLS en la base de datos.
export const supabase = createClient(url || 'http://localhost', key || 'sin-clave', {
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
});

export const ZONA = 'America/Tegucigalpa';

const fmtFechaHora = new Intl.DateTimeFormat('es-HN', {
  timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
});
const fmtFecha = new Intl.DateTimeFormat('es-HN', { timeZone: ZONA, day: '2-digit', month: '2-digit', year: 'numeric' });

export function fechaHora(v?: string | null) { return v ? fmtFechaHora.format(new Date(v)) : '—'; }
export function fecha(v?: string | null) {
  if (!v) return '—';
  // Una fecha sin hora (YYYY-MM-DD) se muestra tal cual, sin conversión de zona.
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const [a, m, d] = v.split('-'); return `${d}/${m}/${a}`; }
  return fmtFecha.format(new Date(v));
}
/** Fecha y hora local de Tegucigalpa como texto ordenable para Excel: 2026-11-01 14:05 */
export function fechaHoraExcel(v?: string | null) {
  if (!v) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(v));
  const g = (t: string) => p.find(x => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
}
export function duracion(min?: number | null) {
  if (min === null || min === undefined) return '—';
  const m = Math.round(Number(min));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
}

export const ESTADOS: Record<string, string> = {
  programado: 'Programado', en_proceso: 'En proceso', pendiente_validacion: 'Pendiente de validación',
  completado: 'Completado', cancelado: 'Cancelado',
};
export const TIPOS: Record<string, string> = { preventivo: 'Preventivo', correctivo: 'Correctivo' };

/** Traduce errores a mensajes claros. Distingue la falta de conexión (los datos NO se guardaron). */
export function mensajeError(e: unknown): string {
  const err = e as Partial<PostgrestError> & { name?: string; message?: string; status?: number };
  const msg = err?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return 'No se guardó: sin conexión con el servidor. Revise la red y presione Reintentar.';
  }
  if (err?.code === '42501' || /permission denied|row-level security/i.test(msg)) {
    return 'No tiene permiso para esta operación.';
  }
  if (err?.code === 'PGRST301' || /JWT expired/i.test(msg)) return 'Su sesión expiró. Vuelva a iniciar sesión.';
  return msg;
}

/** Llama una función RPC y lanza un Error con mensaje en español si falla. */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let res;
  try { res = await supabase.rpc(fn, args); }
  catch (e) { throw new Error(mensajeError(e)); }
  if (res.error) throw new Error(mensajeError(res.error));
  return res.data as T;
}

export function nuevaClave() { return crypto.randomUUID(); }

export type Area = { id: string; codigo: string; nombre: string };
export type Modulo = { id: string; codigo: string; nombre: string; modulo_completo: boolean; areas: Area[] };
export type Sesion = {
  autorizado: boolean; motivo?: string;
  usuario?: { id: string; email: string; nombre: string | null; perfil: 'admin' | 'supervisor' | 'tecnico'; puede_registrar_otros: boolean };
  empleado?: { id: string; codigo: string; nombre: string } | null;
  modulos?: Modulo[];
};

export type Maquina = {
  id: string; asset_id: string; qr: string | null; serie: string | null; modelo: string | null; puesto: string | null;
  estado_inventario: string | null; condicion_operativa: string; es_critica: boolean; fecha_compra_registro: string | null;
  actualizado_origen: string | null; operacion: string | null; estilo: string | null; observacion: string | null;
  requiere_revision: boolean; motivo_revision: string | null; activo: boolean; campos_origen_numerico: string[];
  tipo_id: string | null; tipo: string | null; grupo: string | null; fabricante: string | null;
  ubicacion_id: string | null; ubicacion: string | null; ubicacion_tipo: string | null;
  modulo_id: string | null; modulo: string | null; area_id: string | null; area: string | null; sin_clasificar: boolean;
  origen_archivo: string | null; origen_hoja: string | null; origen_fila: number | null;
  frecuencia: string | null; ultimo_mantenimiento_en: string | null; proximo_mantenimiento: string | null;
};

export const FRECUENCIAS: Record<string, string> = {
  MENSUAL: 'Mensual', BIMENSUAL: 'Bimensual (cada 2 meses)', TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual',
};

export type Mantenimiento = {
  id: string; folio: number; tipo: string; estado: string; maquina_id: string; mecanico_id: string | null;
  modulo_id: string | null; area_id: string | null;
  snap_asset_id: string | null; snap_qr: string | null; snap_serie: string | null; snap_maquina: string | null;
  snap_fabricante: string | null; snap_modelo: string | null; snap_ubicacion: string | null; snap_puesto: string | null;
  snap_modulo: string | null; snap_area: string | null; snap_mecanico_codigo: string | null; snap_mecanico_nombre: string | null;
  qr_leido: string | null; codigo_mecanico_leido: string | null;
  inicio_en: string | null; fin_en: string | null; duracion_min: number | null;
  semana: number | null; anio: number | null; mes: number | null; semana_iso: number | null;
  creado_por: string; finalizado_por: string | null; validado_por: string | null; validado_en: string | null;
  motivo_cancelacion: string | null; creado_en: string;
};

/** Supabase devuelve como máximo 1000 filas por consulta: esta función pide por páginas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function todas<T>(crear: () => any, pagina = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await crear().range(desde, desde + pagina - 1);
    if (error) throw new Error(mensajeError(error));
    out.push(...(data as T[]));
    if (!data || data.length < pagina) break;
  }
  return out;
}
