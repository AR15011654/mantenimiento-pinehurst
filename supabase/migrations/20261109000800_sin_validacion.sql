-- =====================================================================
-- Migración 8: se elimina la validación (decisión del usuario 2026-11-09).
-- Al presionar "Finalizar" el trabajo queda COMPLETADO directamente.
-- Los trabajos que estaban "pendiente de validación" pasan a completado.
-- El administrador puede reabrir un trabajo completado (vuelve a "en proceso").
-- =====================================================================

create or replace function public.finalizar_mantenimiento(p_mantenimiento_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; mt public.mantenimientos; v_periodo bigint;
begin
  u := public.exigir_usuario();
  if not public.puede_trabajar_mantenimiento(p_mantenimiento_id) then perform public.fallar('sin_acceso', 'No puede finalizar este trabajo.'); end if;
  select * into mt from public.mantenimientos where id = p_mantenimiento_id for update;
  if exists (select 1 from public.mantenimiento_eventos where mantenimiento_id = mt.id and evento = 'finalizado'
               and datos->>'clave' = p_idempotency_key::text) then
    return public.resumen_mantenimiento(mt.id) || jsonb_build_object('repetido', true);
  end if;
  if mt.estado <> 'en_proceso' then
    perform public.fallar('estado', 'Solo se puede finalizar un trabajo en proceso.');
  end if;
  select id into v_periodo from public.mantenimiento_periodos where mantenimiento_id = mt.id and fin_en is null for update;
  if v_periodo is null then
    perform public.fallar('sin_inicio', 'El trabajo no tiene un período iniciado. Presione "Reanudar" antes de finalizar.');
  end if;
  update public.mantenimiento_periodos set fin_en = now(), finalizado_por = u.id where id = v_periodo;
  update public.mantenimientos set estado = 'completado', finalizado_por = u.id where id = mt.id;
  if mt.programacion_id is not null then update public.programaciones set estado = 'completada' where id = mt.programacion_id; end if;
  perform public.recalcular_tiempos(mt.id);
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, estado_anterior, estado_nuevo, usuario_id, datos)
    values (mt.id, 'finalizado', 'en_proceso', 'completado', u.id, jsonb_build_object('clave', p_idempotency_key));
  return public.resumen_mantenimiento(mt.id) || jsonb_build_object('repetido', false);
end $$;

-- Reabrir (solo administrador): el trabajo vuelve a "en proceso" para corregirlo y finalizarlo otra vez.
create or replace function public.reabrir_mantenimiento(p_mantenimiento_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; mt public.mantenimientos;
begin
  u := public.exigir_usuario();
  perform public.exigir_admin();
  select * into mt from public.mantenimientos where id = p_mantenimiento_id for update;
  if mt.estado <> 'completado' then perform public.fallar('estado', 'Solo se puede reabrir un trabajo completado.'); end if;
  if length(btrim(coalesce(p_motivo, ''))) = 0 then perform public.fallar('motivo', 'Indique el motivo.'); end if;
  update public.mantenimientos set estado = 'en_proceso', validado_por = null, validado_en = null where id = mt.id;
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, estado_anterior, estado_nuevo, motivo, usuario_id)
    values (mt.id, 'reabierto', 'completado', 'en_proceso', btrim(p_motivo), u.id);
  return public.resumen_mantenimiento(mt.id);
end $$;

-- La validación ya no se usa desde la aplicación.
revoke execute on function public.validar_mantenimiento(uuid, text, text) from authenticated;

-- Trabajos que quedaron pendientes de validación → completados.
do $$
declare r record;
begin
  perform set_config('app.motivo', 'Se eliminó la validación', true);
  for r in select id from public.mantenimientos where estado = 'pendiente_validacion' loop
    update public.mantenimientos set estado = 'completado' where id = r.id;
    insert into public.mantenimiento_eventos (mantenimiento_id, evento, estado_anterior, estado_nuevo, motivo)
      values (r.id, 'completado', 'pendiente_validacion', 'completado', 'Se eliminó la validación');
  end loop;
end $$;
