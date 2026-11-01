// Edge Function: operaciones de cuentas que requieren la clave de servicio.
// La clave de servicio SOLO existe aquí (variable de entorno del servidor), nunca en el navegador.
// Cada llamada verifica, con el token del usuario, que quien llama es administrador activo.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !anon || !servicio) return responder({ error: 'La función no tiene configuradas las variables del servidor.' }, 500);
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return responder({ error: 'Sesión requerida' }, 401);

  // Cliente con el token del usuario: RLS y las funciones verifican sus permisos.
  const usuario = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: esAdmin, error: errAdmin } = await usuario.rpc('es_admin');
  if (errAdmin || esAdmin !== true) return responder({ error: 'Operación exclusiva del administrador.' }, 403);

  const admin = createClient(url, servicio, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return responder({ error: 'Solicitud no válida' }, 400); }

  try {
    if (body.accion === 'invitar') {
      const email = String(body.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responder({ error: 'Correo no válido.' }, 400);
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: String(body.redirectTo ?? '') || undefined });
      if (error) {
        const msg = /already been registered|already registered|exists/i.test(error.message)
          ? 'Ese correo ya tiene una cuenta. Búsquelo en la lista y edítelo.' : error.message;
        return responder({ error: msg }, 400);
      }
      // El perfil y el alcance se guardan con el token del administrador (queda en la auditoría).
      const { error: e2 } = await usuario.rpc('admin_guardar_usuario', {
        p_id: data.user.id, p_perfil: body.perfil, p_nombre: body.nombre ?? null, p_empleado_id: body.empleado_id ?? null,
        p_puede_registrar_otros: Boolean(body.puede_registrar_otros), p_alcance: body.alcance ?? [],
      });
      if (e2) return responder({ error: 'La invitación se envió pero no se guardaron los permisos: ' + e2.message + '. Edite el usuario para completarlos.' }, 400);
      return responder({ ok: true, id: data.user.id });
    }

    if (body.accion === 'desactivar' || body.accion === 'activar') {
      const activo = body.accion === 'activar';
      const id = String(body.id ?? '');
      // Primero la base de datos (impide desactivar al último administrador), luego el bloqueo de inicio de sesión.
      const { error: e1 } = await usuario.rpc('admin_activar_usuario', { p_id: id, p_activo: activo, p_motivo: body.motivo ?? null });
      if (e1) return responder({ error: e1.message }, 400);
      const { error: e2 } = await admin.auth.admin.updateUserById(id, { ban_duration: activo ? 'none' : '876000h' });
      if (e2) return responder({ error: 'Se actualizó el acceso a la app, pero no el bloqueo de inicio de sesión: ' + e2.message }, 500);
      return responder({ ok: true });
    }

    return responder({ error: 'Acción no válida' }, 400);
  } catch (e) {
    return responder({ error: (e as Error).message }, 500);
  }
});
