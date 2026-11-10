-- =====================================================================
-- Migración 11: el técnico no ve precios ni costos de ningún tipo.
-- - Las lecturas de inventario y servicio externo pasan a vistas que ocultan
--   precios/costos cuando el perfil es técnico. Se quita la lectura directa de
--   las tablas para que no se puedan consultar por fuera de la app.
-- - Servicio externo: el costo es opcional; el técnico no lo envía ni lo ve.
--   Gerente de área y administrador lo registran o corrigen, aun con el trabajo finalizado.
-- =====================================================================

create or replace function public.ve_precios()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.perfil_actual() in ('admin', 'supervisor'), false)
$$;

-- ---------------------------------------------------------------- Inventario
revoke select on public.inv_articulos, public.inv_movimientos from authenticated;

create view public.inv_v_articulos as
  select a.id, a.modulo_id, a.codigo, a.descripcion, a.codigo_ax, a.ubicacion,
         case when public.ve_precios() then a.precio_usd end as precio_usd,
         a.notas, a.existencia, a.activo, a.creado_en, a.actualizado_en
    from public.inv_articulos a
   where public.inv_puede(a.modulo_id);

create view public.inv_v_movimientos as
  select m.id, m.modulo_id, m.articulo_id, ar.codigo as art_codigo, ar.descripcion as art_descripcion,
         m.tipo, m.cantidad,
         case when public.ve_precios() then m.precio_unitario end as precio_unitario,
         case when public.ve_precios() then m.costo_total end as costo_total,
         m.existencia_despues, m.empleado_id, m.snap_empleado_codigo, m.snap_empleado_nombre,
         m.maquina_id, m.snap_maquina_qr, m.snap_maquina, m.mantenimiento_id, m.observacion, m.usuario_id, m.creado_en
    from public.inv_movimientos m join public.inv_articulos ar on ar.id = m.articulo_id
   where public.inv_puede(m.modulo_id);

grant select on public.inv_v_articulos, public.inv_v_movimientos to authenticated;

-- ---------------------------------------------------------------- Servicio externo
alter table public.mantenimiento_servicio_externo alter column costo drop not null;
revoke select on public.mantenimiento_servicio_externo from authenticated;

create view public.v_servicio_externo as
  select s.mantenimiento_id, s.proveedor,
         case when public.ve_precios() then s.costo end as costo,
         case when public.ve_precios() then s.moneda end as moneda,
         s.registrado_por, s.creado_en, s.actualizado_en
    from public.mantenimiento_servicio_externo s
   where public.puede_ver_mantenimiento(s.mantenimiento_id);
grant select on public.v_servicio_externo to authenticated;

-- Técnico: solo en trabajos en proceso y sin costo (el costo guardado no se toca).
-- Gerente/administrador: en proceso o completado, con o sin costo.
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
  -- El historial del trabajo (visible para el técnico) no guarda el costo.
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, usuario_id, datos)
    values (p_mantenimiento_id, 'servicio_externo', u.id, jsonb_build_object('proveedor', btrim(p_proveedor)));
  return jsonb_build_object('ok', true);
end $$;

-- Quitar el costo de los registros de historial anteriores (solo el dato de costo; el evento se conserva).
update public.mantenimiento_eventos set datos = datos - 'costo' - 'moneda'
 where evento = 'servicio_externo' and datos ? 'costo';

revoke execute on function public.ve_precios() from public, anon;
grant execute on function public.ve_precios() to authenticated;
