-- Migración 14: QR mecánico abierto a toda la lista de personal y mecánico externo con nombre escrito.
-- 1) Cualquier empleado ACTIVO de la lista de personal puede registrarse como mecánico (sin importar el usuario
--    que inició sesión, la marca "es mecánico" ni el área asignada).
-- 2) Servicio externo: se puede escribir el nombre del mecánico externo; el trabajo queda marcado como servicio externo.

alter table public.mantenimientos
  add column if not exists servicio_externo boolean not null default false,
  add column if not exists mecanico_externo text;
comment on column public.mantenimientos.servicio_externo is 'El trabajo fue (o incluyó) un servicio externo.';
comment on column public.mantenimientos.mecanico_externo is 'Nombre escrito del mecánico externo (no está en la lista de personal).';

-- Trabajos anteriores que ya tienen servicio externo registrado.
update public.mantenimientos m set servicio_externo = true
 where not m.servicio_externo and exists (select 1 from public.mantenimiento_servicio_externo s where s.mantenimiento_id = m.id);

create index if not exists ix_mantenimientos_servicio_externo on public.mantenimientos (servicio_externo) where servicio_externo;

-- ---------------------------------------------------------------- QR mecánico: toda la lista de personal
create or replace function public.buscar_mecanico(p_codigo text, p_maquina_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.usuarios; m public.maquinas; e public.empleados;
begin
  u := public.exigir_usuario();
  select * into m from public.maquinas where id = p_maquina_id;
  if m.id is null or not public.tiene_acceso(m.modulo_id, m.area_id) then
    perform public.fallar('maquina_sin_acceso', 'No tiene acceso a esta máquina.');
  end if;
  select * into e from public.empleados
   where codigo = btrim(p_codigo) or codigo_sin_ceros = public.codigo_sin_ceros(p_codigo)
   order by (codigo = btrim(p_codigo)) desc, activo desc limit 1;
  if e.id is null then
    return jsonb_build_object('encontrado', false, 'mensaje', 'No existe un empleado con el código ' || coalesce(p_codigo, ''));
  end if;
  return jsonb_build_object('encontrado', true, 'id', e.id, 'codigo', e.codigo, 'nombre', e.nombre, 'cargo', e.cargo,
    'autorizado', e.activo,
    'mensaje', case when not e.activo then 'El empleado está inactivo en la lista de personal.' else 'Empleado encontrado.' end);
end $$;

-- ---------------------------------------------------------------- Inicio (con mecánico externo opcional)
drop function if exists public.iniciar_mantenimiento(uuid, text, text, text, uuid, uuid);
create or replace function public.iniciar_mantenimiento(
  p_maquina_id uuid, p_tipo text, p_codigo_mecanico text, p_qr_leido text,
  p_idempotency_key uuid, p_programacion_id uuid default null, p_mecanico_externo text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; m record; e public.empleados; v_mec jsonb; v_externo text; v_id uuid; v_exist uuid; v_folio bigint;
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

  v_externo := nullif(regexp_replace(btrim(coalesce(p_mecanico_externo, '')), '\s+', ' ', 'g'), '');
  if v_externo is not null then
    -- Servicio externo: el mecánico no está en la lista de personal; se guarda el nombre escrito.
    if length(v_externo) > 120 then perform public.fallar('mecanico', 'El nombre del mecánico externo es demasiado largo.'); end if;
  else
    -- Cualquier empleado activo de la lista de personal (sin importar quién haya iniciado sesión).
    v_mec := public.buscar_mecanico(p_codigo_mecanico, p_maquina_id);
    if not (v_mec->>'encontrado')::boolean then perform public.fallar('mecanico', v_mec->>'mensaje'); end if;
    if not (v_mec->>'autorizado')::boolean then perform public.fallar('mecanico', v_mec->>'mensaje'); end if;
    select * into e from public.empleados where id = (v_mec->>'id')::uuid;
  end if;

  if p_programacion_id is not null and not exists (
       select 1 from public.programaciones pr where pr.id = p_programacion_id and pr.maquina_id = p_maquina_id and pr.estado = 'pendiente') then
    perform public.fallar('programacion', 'La programación indicada no corresponde a esta máquina o ya no está pendiente.');
  end if;

  begin
    insert into public.mantenimientos (
      tipo, estado, maquina_id, mecanico_id, programacion_id, modulo_id, area_id, ubicacion_id,
      snap_asset_id, snap_qr, snap_serie, snap_maquina, snap_fabricante, snap_modelo, snap_ubicacion, snap_puesto,
      snap_modulo, snap_area, snap_mecanico_codigo, snap_mecanico_nombre, servicio_externo, mecanico_externo,
      qr_leido, codigo_mecanico_leido, inicio_en, creado_por, iniciado_por, idempotency_key)
    values (
      p_tipo, 'en_proceso', m.id, e.id, p_programacion_id, m.modulo_id, m.area_id, m.ubicacion_id,
      m.asset_id, m.qr, m.serie, m.tipo, m.fabricante, m.modelo, m.ubicacion, m.puesto,
      m.modulo, m.area, case when v_externo is not null then 'EXTERNO' else e.codigo end, coalesce(v_externo, e.nombre),
      v_externo is not null, v_externo,
      nullif(btrim(p_qr_leido), ''), case when v_externo is null then nullif(btrim(p_codigo_mecanico), '') end, now(), u.id, u.id, p_idempotency_key)
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
    values (v_id, 'iniciado', null, 'en_proceso', u.id, jsonb_build_object('tipo', p_tipo, 'servicio_externo', v_externo is not null, 'mecanico_externo', v_externo));
  if p_programacion_id is not null then
    update public.programaciones set estado = 'en_proceso' where id = p_programacion_id;
  end if;
  return public.resumen_mantenimiento(v_id) || jsonb_build_object('repetido', false);
end $$;

revoke execute on function public.iniciar_mantenimiento(uuid, text, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.iniciar_mantenimiento(uuid, text, text, text, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------- Servicio externo marca el trabajo
create or replace function public.registrar_servicio_externo(p_mantenimiento_id uuid, p_proveedor text, p_costo numeric, p_moneda text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; v_estado text; v_gestion boolean;
begin
  u := public.exigir_usuario();
  v_gestion := public.ve_precios();
  if not public.puede_trabajar_mantenimiento(p_mantenimiento_id) then perform public.fallar('sin_acceso', 'No puede registrar en este trabajo.'); end if;
  select estado into v_estado from public.mantenimientos where id = p_mantenimiento_id;
  if not (v_estado = 'en_proceso' or (v_gestion and v_estado = 'completado')) then
    perform public.fallar('estado', 'Solo se puede registrar el servicio externo en un trabajo en proceso.');
  end if;
  if length(btrim(coalesce(p_proveedor, ''))) = 0 then perform public.fallar('proveedor', 'Escriba el nombre del proveedor.'); end if;
  if v_gestion then
    if p_costo is not null and p_costo < 0 then perform public.fallar('costo', 'El costo no puede ser negativo.'); end if;
    if p_costo is not null and coalesce(p_moneda, '') not in ('USD', 'HNL') then perform public.fallar('moneda', 'Moneda no válida.'); end if;
    insert into public.mantenimiento_servicio_externo (mantenimiento_id, proveedor, costo, moneda, registrado_por)
    values (p_mantenimiento_id, btrim(p_proveedor), round(p_costo, 2), coalesce(p_moneda, 'USD'), u.id)
    on conflict (mantenimiento_id) do update set proveedor = excluded.proveedor, costo = excluded.costo, moneda = excluded.moneda,
      registrado_por = excluded.registrado_por, actualizado_en = now();
  else
    insert into public.mantenimiento_servicio_externo (mantenimiento_id, proveedor, costo, registrado_por)
    values (p_mantenimiento_id, btrim(p_proveedor), null, u.id)
    on conflict (mantenimiento_id) do update set proveedor = excluded.proveedor, registrado_por = excluded.registrado_por, actualizado_en = now();
  end if;
  update public.mantenimientos set servicio_externo = true where id = p_mantenimiento_id and not servicio_externo;
  -- El historial del trabajo (visible para el técnico) no guarda el costo.
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, usuario_id, datos)
    values (p_mantenimiento_id, 'servicio_externo', u.id, jsonb_build_object('proveedor', btrim(p_proveedor)));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- Repuestos: salida a nombre del mecánico externo
create or replace function public.inv_registrar_salida(p_articulo_id uuid, p_cantidad numeric, p_codigo_empleado text,
  p_maquina_id uuid, p_mantenimiento_id uuid, p_observacion text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; a public.inv_articulos; e public.empleados; m public.maquinas; t public.mantenimientos;
        v_prev public.inv_movimientos; v_maquina uuid; v_snap text; v_id bigint;
begin
  u := public.exigir_usuario();
  select * into v_prev from public.inv_movimientos where idempotency_key = p_idempotency_key;
  if v_prev.id is not null then return jsonb_build_object('id', v_prev.id, 'existencia', v_prev.existencia_despues, 'repetido', true); end if;
  select * into a from public.inv_articulos where id = p_articulo_id for update;
  if a.id is null or not public.inv_puede(a.modulo_id) then perform public.fallar('sin_acceso', 'No tiene acceso a este repuesto.'); end if;
  if not a.activo then perform public.fallar('inactivo', 'El repuesto ' || a.codigo || ' está dado de baja.'); end if;
  if p_cantidad is null or p_cantidad <= 0 then perform public.fallar('cantidad', 'La cantidad debe ser mayor que cero.'); end if;

  if p_mantenimiento_id is not null then
    select * into t from public.mantenimientos where id = p_mantenimiento_id;
    if t.id is null or not public.puede_trabajar_mantenimiento(t.id) then perform public.fallar('sin_acceso', 'No puede registrar en este trabajo.'); end if;
    if t.estado <> 'en_proceso' then perform public.fallar('estado', 'Solo se pueden registrar repuestos en un trabajo en proceso.'); end if;
    if t.modulo_id is distinct from a.modulo_id then perform public.fallar('modulo', 'El repuesto es de otro inventario.'); end if;
    select * into e from public.empleados where id = t.mecanico_id;
    if t.mecanico_id is null and t.mecanico_externo is not null then e.codigo := 'EXTERNO'; e.nombre := t.mecanico_externo; end if;
    v_maquina := t.maquina_id; v_snap := t.snap_maquina;
    select * into m from public.maquinas where id = t.maquina_id;
  else
    e := public.inv_empleado(p_codigo_empleado);
    if p_maquina_id is not null then
      select * into m from public.maquinas where id = p_maquina_id;
      if m.id is null or not public.tiene_acceso(m.modulo_id, m.area_id) then perform public.fallar('maquina_sin_acceso', 'No tiene acceso a esta máquina.'); end if;
      if m.modulo_id is distinct from a.modulo_id then perform public.fallar('modulo', 'La máquina es de otro módulo.'); end if;
      v_maquina := m.id;
      select concat_ws(' · ', tm.nombre, f.nombre, m.modelo) into v_snap
        from public.maquinas x left join public.tipos_maquina tm on tm.id = x.tipo_id left join public.fabricantes f on f.id = x.fabricante_id
       where x.id = m.id;
      v_snap := coalesce(nullif(v_snap, ''), m.asset_id);
    end if;
  end if;

  if a.existencia < round(p_cantidad, 2) then
    perform public.fallar('sin_existencia', format('No hay suficiente existencia de %s (%s): hay %s y se piden %s.',
      a.codigo, a.descripcion, trim_scale(a.existencia), trim_scale(round(p_cantidad, 2))));
  end if;
  update public.inv_articulos set existencia = existencia - round(p_cantidad, 2), actualizado_en = now()
   where id = a.id returning * into a;
  insert into public.inv_movimientos (modulo_id, articulo_id, tipo, cantidad, precio_unitario, costo_total, existencia_despues,
      empleado_id, snap_empleado_codigo, snap_empleado_nombre, maquina_id, snap_maquina_qr, snap_maquina, mantenimiento_id,
      observacion, usuario_id, idempotency_key)
    values (a.modulo_id, a.id, 'salida', round(p_cantidad, 2), a.precio_usd, round(p_cantidad * a.precio_usd, 2), a.existencia,
      e.id, e.codigo, e.nombre, v_maquina, coalesce(m.qr, m.asset_id), v_snap, p_mantenimiento_id,
      nullif(btrim(p_observacion), ''), u.id, p_idempotency_key)
    returning id into v_id;
  if p_mantenimiento_id is not null then
    insert into public.mantenimiento_eventos (mantenimiento_id, evento, usuario_id, datos)
      values (p_mantenimiento_id, 'repuesto', u.id, jsonb_build_object('movimiento_id', v_id, 'codigo', a.codigo, 'cantidad', round(p_cantidad, 2)));
  end if;
  return jsonb_build_object('id', v_id, 'existencia', a.existencia);
end $$;
