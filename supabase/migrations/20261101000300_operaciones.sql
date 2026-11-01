-- =====================================================================
-- Migración 3: operaciones protegidas (RPC) de mantenimiento y administración.
-- El navegador NO escribe directamente en mantenimientos ni en usuarios:
-- todo pasa por estas funciones, que validan permisos, estado y hora del servidor.
-- =====================================================================

-- Errores con mensaje en español para el usuario: SQLSTATE P0001 + HINT con código.
create or replace function public.fallar(p_codigo text, p_mensaje text)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_mensaje, hint = p_codigo;
end $$;

create or replace function public.exigir_usuario()
returns public.usuarios language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.usuarios;
begin
  select * into u from public.usuarios where id = auth.uid();
  if u.id is null then perform public.fallar('sin_acceso', 'Su cuenta no tiene acceso a esta aplicación. Solicítelo al administrador.'); end if;
  if not u.activo then perform public.fallar('inactivo', 'Su cuenta está desactivada.'); end if;
  return u;
end $$;

create or replace function public.exigir_admin()
returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.es_admin() then perform public.fallar('solo_admin', 'Esta operación es exclusiva del administrador.'); end if;
end $$;

-- ---------------------------------------------------------------------
-- Sesión
-- ---------------------------------------------------------------------
create or replace function public.mi_sesion()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.usuarios; v jsonb;
begin
  select * into u from public.usuarios where id = auth.uid();
  if u.id is null then return jsonb_build_object('autorizado', false, 'motivo', 'sin_registro'); end if;
  if not u.activo then return jsonb_build_object('autorizado', false, 'motivo', 'inactivo'); end if;
  select jsonb_build_object(
    'autorizado', true,
    'usuario', jsonb_build_object('id', u.id, 'email', u.email, 'nombre', u.nombre, 'perfil', u.perfil,
                                  'puede_registrar_otros', u.puede_registrar_otros),
    'empleado', (select jsonb_build_object('id', e.id, 'codigo', e.codigo, 'nombre', e.nombre) from public.empleados e where e.id = u.empleado_id),
    'modulos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'codigo', m.codigo, 'nombre', m.nombre,
        'modulo_completo', (u.perfil = 'admin' or exists (select 1 from public.usuario_alcance a where a.usuario_id = u.id and a.modulo_id = m.id and a.area_id is null)),
        'areas', coalesce((select jsonb_agg(jsonb_build_object('id', ar.id, 'codigo', ar.codigo, 'nombre', ar.nombre) order by ar.nombre)
                  from public.areas ar where ar.modulo_id = m.id and ar.activo
                    and (u.perfil = 'admin' or exists (select 1 from public.usuario_alcance a where a.usuario_id = u.id and a.modulo_id = m.id
                                                         and (a.area_id is null or a.area_id = ar.id)))), '[]'::jsonb))
        order by m.orden)
      from public.modulos m
      where m.activo and (u.perfil = 'admin' or exists (select 1 from public.usuario_alcance a where a.usuario_id = u.id and a.modulo_id = m.id))), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- Búsquedas
-- ---------------------------------------------------------------------
-- Vista con nombres; security_invoker = true aplica la RLS de maquinas al usuario que consulta.
create or replace view public.v_maquinas with (security_invoker = true) as
select m.id, m.asset_id, m.qr, m.serie, m.modelo, m.puesto,
       m.estado_inventario, m.condicion_operativa, m.es_critica, m.fecha_compra_registro, m.actualizado_origen,
       m.operacion, m.estilo, m.observacion, m.requiere_revision, m.motivo_revision, m.activo,
       m.campos_origen_numerico,
       m.tipo_id, t.nombre as tipo, m.grupo_id, g.nombre as grupo, m.fabricante_id, f.nombre as fabricante,
       m.ubicacion_id, u.nombre as ubicacion, u.tipo as ubicacion_tipo,
       m.modulo_id, mo.nombre as modulo, m.area_id, a.nombre as area,
       (m.modulo_id is null) as sin_clasificar,
       m.origen_archivo, m.origen_hoja, m.origen_fila, m.creado_en, m.actualizado_en
from public.maquinas m
left join public.tipos_maquina t on t.id = m.tipo_id
left join public.grupos_maquina g on g.id = m.grupo_id
left join public.fabricantes f on f.id = m.fabricante_id
left join public.ubicaciones u on u.id = m.ubicacion_id
left join public.modulos mo on mo.id = m.modulo_id
left join public.areas a on a.id = m.area_id;

-- Busca por QR, Asset ID o serie exactos (sin distinguir mayúsculas/espacios). Puede devolver varias.
create or replace function public.buscar_por_codigo(p_codigo text)
returns setof public.v_maquinas language sql stable security invoker set search_path = public, pg_temp as $$
  select * from public.v_maquinas v
  where public.normalizar(p_codigo) is not null
    and (public.normalizar(v.qr) = public.normalizar(p_codigo)
      or public.normalizar(v.asset_id) = public.normalizar(p_codigo)
      or public.normalizar(v.serie) = public.normalizar(p_codigo))
  order by v.activo desc, v.asset_id
  limit 20
$$;

-- Identifica al mecánico por su código (acepta con o sin ceros iniciales) y valida que pueda atender la máquina.
create or replace function public.buscar_mecanico(p_codigo text, p_maquina_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.usuarios; m public.maquinas; e public.empleados; v_ok boolean;
begin
  u := public.exigir_usuario();
  select * into m from public.maquinas where id = p_maquina_id;
  if m.id is null or not public.tiene_acceso(m.modulo_id, m.area_id) then
    perform public.fallar('maquina_sin_acceso', 'No tiene acceso a esta máquina.');
  end if;
  select * into e from public.empleados
   where codigo = btrim(p_codigo) or codigo_sin_ceros = public.codigo_sin_ceros(p_codigo)
   order by (codigo = btrim(p_codigo)) desc limit 1;
  if e.id is null then
    return jsonb_build_object('encontrado', false, 'mensaje', 'No existe un empleado con el código ' || coalesce(p_codigo, ''));
  end if;
  v_ok := e.activo and e.es_mecanico and (
    (m.area_id is not null and exists (select 1 from public.empleado_areas ea where ea.empleado_id = e.id and ea.area_id = m.area_id))
    or (m.area_id is null and exists (select 1 from public.empleado_areas ea join public.areas a on a.id = ea.area_id
                                       where ea.empleado_id = e.id and a.modulo_id = m.modulo_id)));
  return jsonb_build_object('encontrado', true, 'id', e.id, 'codigo', e.codigo, 'nombre', e.nombre, 'cargo', e.cargo,
    'autorizado', v_ok,
    'mensaje', case
      when not e.activo then 'El empleado está inactivo.'
      when not e.es_mecanico then 'El empleado no está habilitado como mecánico.'
      when not v_ok then 'El mecánico no está asignado al área de esta máquina.'
      else 'Mecánico autorizado.' end);
end $$;

-- ---------------------------------------------------------------------
-- Flujo de mantenimiento
-- ---------------------------------------------------------------------
create or replace function public.recalcular_tiempos(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_fin timestamptz; v_dur numeric;
begin
  select max(fin_en), round(sum(extract(epoch from (fin_en - inicio_en)) / 60.0)::numeric, 2)
    into v_fin, v_dur from public.mantenimiento_periodos where mantenimiento_id = p_id and fin_en is not null;
  update public.mantenimientos set
    fin_en = v_fin, duracion_min = v_dur,
    semana = case when v_fin is not null then public.semana_appsheet(v_fin) end,
    semana_iso = case when v_fin is not null then extract(week from v_fin at time zone 'America/Tegucigalpa')::int end,
    anio = case when v_fin is not null then extract(year from v_fin at time zone 'America/Tegucigalpa')::int end,
    mes = case when v_fin is not null then extract(month from v_fin at time zone 'America/Tegucigalpa')::int end
  where id = p_id;
end $$;

create or replace function public.resumen_mantenimiento(p_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', m.id, 'folio', m.folio, 'estado', m.estado, 'tipo', m.tipo,
    'inicio_en', m.inicio_en, 'fin_en', m.fin_en, 'duracion_min', m.duracion_min,
    'periodo_abierto', exists (select 1 from public.mantenimiento_periodos p where p.mantenimiento_id = m.id and p.fin_en is null))
  from public.mantenimientos m where m.id = p_id
$$;

create or replace function public.iniciar_mantenimiento(
  p_maquina_id uuid, p_tipo text, p_codigo_mecanico text, p_qr_leido text,
  p_idempotency_key uuid, p_programacion_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; m record; e public.empleados; v_mec jsonb; v_id uuid; v_exist uuid; v_folio bigint;
begin
  u := public.exigir_usuario();
  if p_idempotency_key is null then perform public.fallar('sin_clave', 'Falta la clave de la operación. Recargue la página.'); end if;
  -- Reintento o doble clic: devolver el mismo trabajo.
  select id into v_exist from public.mantenimientos where idempotency_key = p_idempotency_key;
  if v_exist is not null then
    if not public.puede_ver_mantenimiento(v_exist) then perform public.fallar('sin_acceso', 'Operación no permitida.'); end if;
    return public.resumen_mantenimiento(v_exist) || jsonb_build_object('repetido', true);
  end if;
  if p_tipo not in ('preventivo','correctivo') then perform public.fallar('tipo', 'Seleccione mantenimiento preventivo o correctivo.'); end if;

  select v.* into m from public.v_maquinas v where v.id = p_maquina_id;
  -- v_maquinas usa security_invoker pero esta función es definer: validar acceso explícitamente.
  if m.id is null or not public.tiene_acceso(m.modulo_id, m.area_id) then
    perform public.fallar('maquina_sin_acceso', 'No tiene acceso a esta máquina.');
  end if;
  if m.modulo_id is null then
    perform public.fallar('sin_clasificar', 'La máquina no tiene módulo asignado. Pida al administrador que la clasifique.');
  end if;
  if not m.activo or public.normalizar(m.estado_inventario) = 'DESCARTADO' then
    perform public.fallar('maquina_descartada', 'La máquina está descartada o desactivada en el inventario.');
  end if;

  v_mec := public.buscar_mecanico(p_codigo_mecanico, p_maquina_id);
  if not (v_mec->>'encontrado')::boolean then perform public.fallar('mecanico', v_mec->>'mensaje'); end if;
  if not (v_mec->>'autorizado')::boolean then perform public.fallar('mecanico', v_mec->>'mensaje'); end if;
  select * into e from public.empleados where id = (v_mec->>'id')::uuid;

  if u.perfil = 'tecnico' and not u.puede_registrar_otros then
    if u.empleado_id is null then
      perform public.fallar('sin_empleado', 'Su cuenta no está vinculada a un empleado. Pida al administrador que la vincule.');
    elsif u.empleado_id <> e.id then
      perform public.fallar('otro_mecanico', 'Solo puede registrar trabajos a su propio nombre.');
    end if;
  end if;

  if p_programacion_id is not null and not exists (
       select 1 from public.programaciones pr where pr.id = p_programacion_id and pr.maquina_id = p_maquina_id and pr.estado = 'pendiente') then
    perform public.fallar('programacion', 'La programación indicada no corresponde a esta máquina o ya no está pendiente.');
  end if;

  begin
    insert into public.mantenimientos (
      tipo, estado, maquina_id, mecanico_id, programacion_id, modulo_id, area_id, ubicacion_id,
      snap_asset_id, snap_qr, snap_serie, snap_maquina, snap_fabricante, snap_modelo, snap_ubicacion, snap_puesto,
      snap_modulo, snap_area, snap_mecanico_codigo, snap_mecanico_nombre,
      qr_leido, codigo_mecanico_leido, inicio_en, creado_por, iniciado_por, idempotency_key)
    values (
      p_tipo, 'en_proceso', m.id, e.id, p_programacion_id, m.modulo_id, m.area_id, m.ubicacion_id,
      m.asset_id, m.qr, m.serie, m.tipo, m.fabricante, m.modelo, m.ubicacion, m.puesto,
      m.modulo, m.area, e.codigo, e.nombre,
      nullif(btrim(p_qr_leido), ''), nullif(btrim(p_codigo_mecanico), ''), now(), u.id, u.id, p_idempotency_key)
    returning id into v_id;
  exception when unique_violation then
    select folio into v_folio from public.mantenimientos
      where maquina_id = p_maquina_id and mecanico_id = e.id and estado = 'en_proceso';
    if v_folio is not null then
      perform public.fallar('ya_en_proceso', format('Este mecánico ya tiene el trabajo #%s en proceso en esta máquina.', v_folio));
    end if;
    raise;
  end;

  insert into public.mantenimiento_periodos (mantenimiento_id, inicio_en, iniciado_por) values (v_id, now(), u.id);
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, estado_anterior, estado_nuevo, usuario_id, datos)
    values (v_id, 'iniciado', null, 'en_proceso', u.id, jsonb_build_object('tipo', p_tipo));
  if p_programacion_id is not null then
    update public.programaciones set estado = 'en_proceso' where id = p_programacion_id;
  end if;
  return public.resumen_mantenimiento(v_id) || jsonb_build_object('repetido', false);
end $$;

create or replace function public.agregar_comentario(p_mantenimiento_id uuid, p_texto text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; v_estado text; v_id uuid;
begin
  u := public.exigir_usuario();
  select id into v_id from public.mantenimiento_comentarios where idempotency_key = p_idempotency_key;
  if v_id is not null then return jsonb_build_object('id', v_id, 'repetido', true); end if;
  if not public.puede_trabajar_mantenimiento(p_mantenimiento_id) then perform public.fallar('sin_acceso', 'No puede registrar en este trabajo.'); end if;
  select estado into v_estado from public.mantenimientos where id = p_mantenimiento_id;
  if v_estado not in ('en_proceso','pendiente_validacion') then
    perform public.fallar('estado', 'Solo se pueden agregar comentarios a trabajos en proceso o pendientes de validación.');
  end if;
  if length(btrim(coalesce(p_texto, ''))) = 0 then perform public.fallar('vacio', 'Escriba un comentario.'); end if;
  insert into public.mantenimiento_comentarios (mantenimiento_id, texto, usuario_id, idempotency_key)
    values (p_mantenimiento_id, btrim(p_texto), u.id, p_idempotency_key) returning id into v_id;
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, usuario_id, datos)
    values (p_mantenimiento_id, 'comentario', u.id, jsonb_build_object('comentario_id', v_id));
  return jsonb_build_object('id', v_id, 'repetido', false);
end $$;

create or replace function public.registrar_foto(p_mantenimiento_id uuid, p_ruta text, p_tamano bigint, p_mime text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; v_estado text; v_id uuid;
begin
  u := public.exigir_usuario();
  if not public.puede_trabajar_mantenimiento(p_mantenimiento_id) then perform public.fallar('sin_acceso', 'No puede registrar en este trabajo.'); end if;
  select estado into v_estado from public.mantenimientos where id = p_mantenimiento_id;
  if v_estado <> 'en_proceso' then perform public.fallar('estado', 'Solo se pueden agregar fotos a trabajos en proceso.'); end if;
  if p_ruta is null or split_part(p_ruta, '/', 1) <> p_mantenimiento_id::text then
    perform public.fallar('ruta', 'Ruta de foto no válida.');
  end if;
  insert into public.mantenimiento_fotos (mantenimiento_id, ruta, tamano_bytes, tipo_mime, usuario_id)
    values (p_mantenimiento_id, p_ruta, p_tamano, p_mime, u.id)
    on conflict (ruta) do update set ruta = excluded.ruta returning id into v_id;
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, usuario_id, datos)
    values (p_mantenimiento_id, 'foto', u.id, jsonb_build_object('foto_id', v_id));
  return jsonb_build_object('id', v_id);
end $$;

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
  update public.mantenimientos set estado = 'pendiente_validacion', finalizado_por = u.id where id = mt.id;
  perform public.recalcular_tiempos(mt.id);
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, estado_anterior, estado_nuevo, usuario_id, datos)
    values (mt.id, 'finalizado', 'en_proceso', 'pendiente_validacion', u.id, jsonb_build_object('clave', p_idempotency_key));
  return public.resumen_mantenimiento(mt.id) || jsonb_build_object('repetido', false);
end $$;

-- Tras una devolución, el técnico reanuda: se abre un nuevo período (no se borra el anterior).
create or replace function public.reanudar_mantenimiento(p_mantenimiento_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; mt public.mantenimientos;
begin
  u := public.exigir_usuario();
  if not public.puede_trabajar_mantenimiento(p_mantenimiento_id) then perform public.fallar('sin_acceso', 'No puede reanudar este trabajo.'); end if;
  select * into mt from public.mantenimientos where id = p_mantenimiento_id for update;
  if mt.estado <> 'en_proceso' then perform public.fallar('estado', 'Solo se puede reanudar un trabajo devuelto (en proceso).'); end if;
  if exists (select 1 from public.mantenimiento_periodos where mantenimiento_id = mt.id and fin_en is null) then
    return public.resumen_mantenimiento(mt.id) || jsonb_build_object('repetido', true);
  end if;
  insert into public.mantenimiento_periodos (mantenimiento_id, inicio_en, iniciado_por) values (mt.id, now(), u.id);
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, estado_anterior, estado_nuevo, usuario_id)
    values (mt.id, 'reanudado', 'en_proceso', 'en_proceso', u.id);
  return public.resumen_mantenimiento(mt.id) || jsonb_build_object('repetido', false);
end $$;

create or replace function public.validar_mantenimiento(p_mantenimiento_id uuid, p_resultado text, p_observacion text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; mt public.mantenimientos;
begin
  u := public.exigir_usuario();
  select * into mt from public.mantenimientos where id = p_mantenimiento_id for update;
  if mt.id is null then perform public.fallar('no_existe', 'El trabajo no existe.'); end if;
  if not (u.perfil = 'admin' or (u.perfil = 'supervisor' and public.tiene_acceso(mt.modulo_id, mt.area_id))) then
    perform public.fallar('sin_acceso', 'Solo un supervisor del área o el administrador puede validar.');
  end if;
  if u.perfil <> 'admin' and (mt.finalizado_por = u.id or (u.empleado_id is not null and mt.mecanico_id = u.empleado_id)) then
    perform public.fallar('propio', 'No puede validar un trabajo propio.');
  end if;
  if mt.estado <> 'pendiente_validacion' then perform public.fallar('estado', 'El trabajo no está pendiente de validación.'); end if;
  if p_resultado not in ('aprobado','devuelto') then perform public.fallar('resultado', 'Resultado no válido.'); end if;
  if p_resultado = 'devuelto' and length(btrim(coalesce(p_observacion, ''))) = 0 then
    perform public.fallar('motivo', 'Indique el motivo de la devolución.');
  end if;
  insert into public.validaciones (mantenimiento_id, resultado, observacion, supervisor_id)
    values (mt.id, p_resultado, nullif(btrim(p_observacion), ''), u.id);
  if p_resultado = 'aprobado' then
    update public.mantenimientos set estado = 'completado', validado_por = u.id, validado_en = now() where id = mt.id;
    if mt.programacion_id is not null then update public.programaciones set estado = 'completada' where id = mt.programacion_id; end if;
    insert into public.mantenimiento_eventos (mantenimiento_id, evento, estado_anterior, estado_nuevo, motivo, usuario_id)
      values (mt.id, 'validado', 'pendiente_validacion', 'completado', nullif(btrim(p_observacion), ''), u.id);
  else
    update public.mantenimientos set estado = 'en_proceso' where id = mt.id;
    insert into public.mantenimiento_eventos (mantenimiento_id, evento, estado_anterior, estado_nuevo, motivo, usuario_id)
      values (mt.id, 'devuelto', 'pendiente_validacion', 'en_proceso', btrim(p_observacion), u.id);
  end if;
  return public.resumen_mantenimiento(mt.id);
end $$;

create or replace function public.cancelar_mantenimiento(p_mantenimiento_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; mt public.mantenimientos;
begin
  u := public.exigir_usuario();
  select * into mt from public.mantenimientos where id = p_mantenimiento_id for update;
  if mt.id is null then perform public.fallar('no_existe', 'El trabajo no existe.'); end if;
  if not (u.perfil = 'admin' or (u.perfil = 'supervisor' and public.tiene_acceso(mt.modulo_id, mt.area_id))) then
    perform public.fallar('sin_acceso', 'Solo un supervisor del área o el administrador puede cancelar.');
  end if;
  if mt.estado not in ('programado','en_proceso') then perform public.fallar('estado', 'Solo se pueden cancelar trabajos programados o en proceso.'); end if;
  if length(btrim(coalesce(p_motivo, ''))) = 0 then perform public.fallar('motivo', 'Indique el motivo de la cancelación.'); end if;
  update public.mantenimiento_periodos set fin_en = now(), finalizado_por = u.id where mantenimiento_id = mt.id and fin_en is null;
  update public.mantenimientos set estado = 'cancelado', cancelado_por = u.id, cancelado_en = now(), motivo_cancelacion = btrim(p_motivo) where id = mt.id;
  perform public.recalcular_tiempos(mt.id);
  if mt.programacion_id is not null then update public.programaciones set estado = 'pendiente' where id = mt.programacion_id and estado = 'en_proceso'; end if;
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, estado_anterior, estado_nuevo, motivo, usuario_id)
    values (mt.id, 'cancelado', mt.estado, 'cancelado', btrim(p_motivo), u.id);
  return public.resumen_mantenimiento(mt.id);
end $$;

create or replace function public.reabrir_mantenimiento(p_mantenimiento_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; mt public.mantenimientos;
begin
  u := public.exigir_usuario();
  perform public.exigir_admin();
  select * into mt from public.mantenimientos where id = p_mantenimiento_id for update;
  if mt.estado <> 'completado' then perform public.fallar('estado', 'Solo se puede reabrir un trabajo completado.'); end if;
  if length(btrim(coalesce(p_motivo, ''))) = 0 then perform public.fallar('motivo', 'Indique el motivo.'); end if;
  update public.mantenimientos set estado = 'pendiente_validacion', validado_por = null, validado_en = null where id = mt.id;
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, estado_anterior, estado_nuevo, motivo, usuario_id)
    values (mt.id, 'reabierto', 'completado', 'pendiente_validacion', btrim(p_motivo), u.id);
  return public.resumen_mantenimiento(mt.id);
end $$;

-- ---------------------------------------------------------------------
-- Administración de usuarios (la invitación de la cuenta la hace la Edge Function admin-usuarios)
-- ---------------------------------------------------------------------
create or replace function public.admin_guardar_usuario(
  p_id uuid, p_perfil text, p_nombre text, p_empleado_id uuid, p_puede_registrar_otros boolean, p_alcance jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_email text; v_prev public.usuarios; a jsonb;
begin
  perform public.exigir_admin();
  if p_perfil not in ('admin','supervisor','tecnico') then perform public.fallar('perfil', 'Perfil no válido.'); end if;
  select email into v_email from auth.users where id = p_id;
  if v_email is null then perform public.fallar('sin_cuenta', 'La cuenta no existe en Authentication.'); end if;
  select * into v_prev from public.usuarios where id = p_id;
  if v_prev.perfil = 'admin' and p_perfil <> 'admin'
     and (select count(*) from public.usuarios where perfil = 'admin' and activo) <= 1 then
    perform public.fallar('ultimo_admin', 'No puede quitar el perfil al único administrador activo.');
  end if;
  insert into public.usuarios (id, email, nombre, perfil, empleado_id, puede_registrar_otros, creado_por)
  values (p_id, lower(v_email), nullif(btrim(p_nombre), ''), p_perfil, p_empleado_id, coalesce(p_puede_registrar_otros, false), auth.uid())
  on conflict (id) do update set nombre = excluded.nombre, perfil = excluded.perfil, empleado_id = excluded.empleado_id,
    puede_registrar_otros = excluded.puede_registrar_otros, email = excluded.email;

  delete from public.usuario_alcance where usuario_id = p_id;
  if p_perfil = 'admin' then
    insert into public.usuario_alcance (usuario_id, modulo_id, creado_por) select p_id, id, auth.uid() from public.modulos;
  else
    for a in select * from jsonb_array_elements(coalesce(p_alcance, '[]'::jsonb)) loop
      if (a->>'area_id') is not null and not exists (select 1 from public.areas where id = (a->>'area_id')::uuid and modulo_id = (a->>'modulo_id')::uuid) then
        perform public.fallar('alcance', 'Un área seleccionada no pertenece a su módulo.');
      end if;
      insert into public.usuario_alcance (usuario_id, modulo_id, area_id, creado_por)
        values (p_id, (a->>'modulo_id')::uuid, nullif(a->>'area_id', '')::uuid, auth.uid())
        on conflict do nothing;
    end loop;
  end if;
  return jsonb_build_object('id', p_id, 'email', v_email);
end $$;

create or replace function public.admin_activar_usuario(p_id uuid, p_activo boolean, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.usuarios;
begin
  perform public.exigir_admin();
  select * into v from public.usuarios where id = p_id;
  if v.id is null then perform public.fallar('no_existe', 'Usuario no encontrado.'); end if;
  if not p_activo and v.perfil = 'admin' and (select count(*) from public.usuarios where perfil = 'admin' and activo) <= 1 then
    perform public.fallar('ultimo_admin', 'No puede desactivar al único administrador activo.');
  end if;
  perform set_config('app.motivo', coalesce(p_motivo, ''), true);
  update public.usuarios set activo = p_activo,
    desactivado_por = case when p_activo then null else auth.uid() end,
    desactivado_en = case when p_activo then null else now() end
  where id = p_id;
  return jsonb_build_object('id', p_id, 'activo', p_activo);
end $$;

-- Lista de usuarios con datos de Auth (solo admin).
create or replace function public.admin_listar_usuarios()
returns table (id uuid, email text, nombre text, perfil text, activo boolean, empleado_id uuid, empleado_codigo text, empleado_nombre text,
               puede_registrar_otros boolean, alcance jsonb, ultimo_acceso timestamptz, invitacion_aceptada boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.exigir_admin();
  return query
  select u.id, u.email, u.nombre, u.perfil, u.activo, u.empleado_id, e.codigo, e.nombre, u.puede_registrar_otros,
    coalesce((select jsonb_agg(jsonb_build_object('modulo_id', a.modulo_id, 'modulo', mo.nombre, 'area_id', a.area_id, 'area', ar.nombre))
              from public.usuario_alcance a join public.modulos mo on mo.id = a.modulo_id left join public.areas ar on ar.id = a.area_id
              where a.usuario_id = u.id), '[]'::jsonb),
    au.last_sign_in_at, (au.last_sign_in_at is not null)
  from public.usuarios u
  left join auth.users au on au.id = u.id
  left join public.empleados e on e.id = u.empleado_id
  order by u.activo desc, u.perfil, u.email;
end $$;

-- ---------------------------------------------------------------------
-- Clasificación de maquinaria (solo admin)
-- ---------------------------------------------------------------------
create or replace function public.admin_clasificar_maquinas(p_ids uuid[], p_modulo_id uuid, p_area_id uuid, p_motivo text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform public.exigir_admin();
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id and modulo_id = p_modulo_id) then
    perform public.fallar('area', 'El área no pertenece al módulo seleccionado.');
  end if;
  perform set_config('app.motivo', coalesce(nullif(btrim(p_motivo), ''), 'Clasificación manual'), true);
  perform set_config('app.origen', 'manual', true);
  update public.maquinas set modulo_id = p_modulo_id, area_id = p_area_id where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_regla_ubicacion(p_ubicacion_id uuid, p_area_id uuid, p_tipo text, p_aplicar boolean)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; r record; mq record;
begin
  perform public.exigir_admin();
  update public.ubicaciones set area_id = p_area_id, tipo = coalesce(p_tipo, tipo) where id = p_ubicacion_id;
  if p_aplicar and p_area_id is not null then
    perform set_config('app.motivo', 'Regla de ubicación', true);
    perform set_config('app.origen', 'regla', true);
    for mq in select id, tipo_id from public.maquinas where ubicacion_id = p_ubicacion_id and area_id is null loop
      r := public.regla_clasificacion(mq.tipo_id, p_ubicacion_id);
      update public.maquinas set modulo_id = r.modulo_id, area_id = r.area_id where id = mq.id;
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

create or replace function public.admin_regla_tipo(p_tipo_id uuid, p_modulo_id uuid, p_aplicar boolean)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; r record; mq record;
begin
  perform public.exigir_admin();
  update public.tipos_maquina set modulo_id = p_modulo_id where id = p_tipo_id;
  if p_aplicar and p_modulo_id is not null then
    perform set_config('app.motivo', 'Regla por tipo de máquina', true);
    perform set_config('app.origen', 'regla', true);
    for mq in select id, ubicacion_id from public.maquinas where tipo_id = p_tipo_id loop
      r := public.regla_clasificacion(p_tipo_id, mq.ubicacion_id);
      update public.maquinas set modulo_id = r.modulo_id, area_id = r.area_id where id = mq.id;
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

create or replace function public.admin_marcar_revisada(p_ids uuid[], p_nota text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform public.exigir_admin();
  perform set_config('app.motivo', coalesce(nullif(btrim(p_nota), ''), 'Revisión confirmada'), true);
  update public.maquinas set requiere_revision = false, motivo_revision = null where id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.admin_habilitar_mecanicos_por_cargo(p_cargos text[], p_habilitar boolean)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform public.exigir_admin();
  update public.empleados set es_mecanico = p_habilitar
   where public.normalizar(cargo) = any (select public.normalizar(x) from unnest(p_cargos) x) and es_mecanico <> p_habilitar;
  get diagnostics n = row_count;
  return n;
end $$;

-- Nombres de usuarios para mostrar en el historial de un trabajo (solo nombre/correo; requiere sesión activa).
create or replace function public.nombres_usuarios(p_ids uuid[])
returns table (id uuid, nombre text) language sql stable security definer set search_path = public, pg_temp as $$
  select u.id, coalesce(u.nombre, u.email) from public.usuarios u
  where public.usuario_activo() and u.id = any(p_ids)
$$;
