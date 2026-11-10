-- =====================================================================
-- Migración 10: inventario de repuestos por módulo (área).
-- Catálogo (inv_articulos) + movimientos (inv_movimientos: entradas y salidas).
-- La existencia se guarda en el artículo y solo la cambian las funciones de
-- entrada/salida, con bloqueo de fila: una salida mayor a la existencia se rechaza.
-- Las tablas consumos_repuestos / inventarios_origen (integración externa futura) no se tocan.
-- =====================================================================

create table public.inv_articulos (
  id uuid primary key default gen_random_uuid(),
  modulo_id uuid not null references public.modulos(id),
  codigo text not null check (codigo = btrim(codigo) and codigo <> ''),
  descripcion text not null check (btrim(descripcion) <> ''),
  codigo_ax text,
  ubicacion text,
  precio_usd numeric(14,2) check (precio_usd >= 0),     -- null = precio desconocido
  notas text,
  existencia numeric(14,2) not null default 0 check (existencia >= 0),
  activo boolean not null default true,
  origen_archivo text, origen_fila int,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (modulo_id, codigo)
);

create table public.inv_movimientos (
  id bigint generated always as identity primary key,
  modulo_id uuid not null references public.modulos(id),
  articulo_id uuid not null references public.inv_articulos(id),
  tipo text not null check (tipo in ('entrada', 'salida')),
  cantidad numeric(14,2) not null check (cantidad > 0),
  precio_unitario numeric(14,2),
  costo_total numeric(16,2),
  existencia_despues numeric(14,2) not null,
  empleado_id uuid references public.empleados(id),
  snap_empleado_codigo text, snap_empleado_nombre text,
  maquina_id uuid references public.maquinas(id),
  snap_maquina_qr text, snap_maquina text,
  mantenimiento_id uuid references public.mantenimientos(id),
  observacion text,
  usuario_id uuid not null,
  idempotency_key uuid not null unique,
  creado_en timestamptz not null default now()
);
create index on public.inv_movimientos (articulo_id);
create index on public.inv_movimientos (modulo_id, creado_en);
create index on public.inv_movimientos (mantenimiento_id);
create index on public.inv_movimientos (maquina_id);

alter table public.inv_articulos enable row level security;
alter table public.inv_movimientos enable row level security;

-- ¿Puede el usuario usar el inventario de este módulo? (admin, o cualquier alcance en el módulo)
create or replace function public.inv_puede(p_modulo uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.es_admin() or exists (
    select 1 from public.usuario_alcance a join public.usuarios u on u.id = a.usuario_id
    where u.id = auth.uid() and u.activo and a.modulo_id = p_modulo)
$$;

grant select on public.inv_articulos, public.inv_movimientos to authenticated;
create policy leer on public.inv_articulos for select to authenticated using (public.inv_puede(modulo_id));
create policy leer on public.inv_movimientos for select to authenticated using (public.inv_puede(modulo_id));

create trigger inv_articulos_auditoria after insert or update or delete on public.inv_articulos
  for each row execute function public.tg_auditar();

-- Empleado que hace el movimiento. Técnico sin permiso para registrar a otros: solo él mismo.
create or replace function public.inv_empleado(p_codigo text)
returns public.empleados language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u public.usuarios; e public.empleados;
begin
  select * into u from public.usuarios where id = auth.uid();
  if coalesce(btrim(p_codigo), '') = '' then perform public.fallar('empleado', 'Escriba el código del empleado.'); end if;
  select * into e from public.empleados
   where codigo = btrim(p_codigo) or codigo_sin_ceros = public.codigo_sin_ceros(p_codigo)
   order by (codigo = btrim(p_codigo)) desc limit 1;
  if e.id is null then perform public.fallar('empleado', 'No existe un empleado con el código ' || btrim(p_codigo) || '.'); end if;
  if not e.activo then perform public.fallar('empleado', 'El empleado ' || e.codigo || ' está inactivo.'); end if;
  if u.perfil = 'tecnico' and not u.puede_registrar_otros and e.id is distinct from u.empleado_id then
    perform public.fallar('empleado', 'Solo puede registrar movimientos a su propio nombre.');
  end if;
  return e;
end $$;

-- Resumen de inventarios a los que el usuario tiene acceso: [{modulo_id, articulos}]
create or replace function public.inv_resumen()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('modulo_id', modulo_id, 'articulos', n)), '[]'::jsonb)
  from (select modulo_id, count(*) n from public.inv_articulos where activo and public.inv_puede(modulo_id) group by modulo_id) x
$$;

create or replace function public.inv_registrar_entrada(p_articulo_id uuid, p_cantidad numeric, p_precio_unitario numeric,
  p_codigo_empleado text, p_observacion text, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; a public.inv_articulos; e public.empleados; v_prev public.inv_movimientos; v_precio numeric; v_id bigint;
begin
  u := public.exigir_usuario();
  select * into v_prev from public.inv_movimientos where idempotency_key = p_idempotency_key;
  if v_prev.id is not null then return jsonb_build_object('id', v_prev.id, 'existencia', v_prev.existencia_despues, 'repetido', true); end if;
  select * into a from public.inv_articulos where id = p_articulo_id for update;
  if a.id is null or not public.inv_puede(a.modulo_id) then perform public.fallar('sin_acceso', 'No tiene acceso a este repuesto.'); end if;
  if not a.activo then perform public.fallar('inactivo', 'El repuesto ' || a.codigo || ' está dado de baja.'); end if;
  if p_cantidad is null or p_cantidad <= 0 then perform public.fallar('cantidad', 'La cantidad debe ser mayor que cero.'); end if;
  if p_precio_unitario is not null and p_precio_unitario < 0 then perform public.fallar('precio', 'El precio no puede ser negativo.'); end if;
  e := public.inv_empleado(p_codigo_empleado);
  v_precio := coalesce(round(p_precio_unitario, 2), a.precio_usd);
  update public.inv_articulos set existencia = existencia + round(p_cantidad, 2),
         precio_usd = coalesce(precio_usd, round(p_precio_unitario, 2)), actualizado_en = now()
   where id = a.id returning * into a;
  insert into public.inv_movimientos (modulo_id, articulo_id, tipo, cantidad, precio_unitario, costo_total, existencia_despues,
      empleado_id, snap_empleado_codigo, snap_empleado_nombre, observacion, usuario_id, idempotency_key)
    values (a.modulo_id, a.id, 'entrada', round(p_cantidad, 2), v_precio, round(p_cantidad * v_precio, 2), a.existencia,
      e.id, e.codigo, e.nombre, nullif(btrim(p_observacion), ''), u.id, p_idempotency_key)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'existencia', a.existencia);
end $$;

-- Salida. Con p_mantenimiento_id la máquina y el mecánico se toman del trabajo (debe estar en proceso).
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

-- Catálogo (solo administrador): alta o corrección de un artículo. No cambia la existencia.
create or replace function public.inv_guardar_articulo(p_id uuid, p_modulo_id uuid, p_codigo text, p_descripcion text,
  p_codigo_ax text, p_ubicacion text, p_precio numeric, p_notas text, p_activo boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.exigir_admin();
  if coalesce(btrim(p_codigo), '') = '' then perform public.fallar('codigo', 'Escriba el código del artículo.'); end if;
  if coalesce(btrim(p_descripcion), '') = '' then perform public.fallar('descripcion', 'Escriba la descripción.'); end if;
  if p_precio is not null and p_precio < 0 then perform public.fallar('precio', 'El precio no puede ser negativo.'); end if;
  if exists (select 1 from public.inv_articulos where modulo_id = p_modulo_id and codigo = btrim(p_codigo) and id is distinct from p_id) then
    perform public.fallar('codigo', 'Ya existe un artículo con el código ' || btrim(p_codigo) || '.');
  end if;
  if p_id is null then
    insert into public.inv_articulos (modulo_id, codigo, descripcion, codigo_ax, ubicacion, precio_usd, notas, activo)
      values (p_modulo_id, btrim(p_codigo), btrim(p_descripcion), nullif(btrim(p_codigo_ax), ''), nullif(btrim(p_ubicacion), ''),
              round(p_precio, 2), nullif(btrim(p_notas), ''), coalesce(p_activo, true))
      returning id into v_id;
  else
    update public.inv_articulos set codigo = btrim(p_codigo), descripcion = btrim(p_descripcion), codigo_ax = nullif(btrim(p_codigo_ax), ''),
           ubicacion = nullif(btrim(p_ubicacion), ''), precio_usd = round(p_precio, 2), notas = nullif(btrim(p_notas), ''),
           activo = coalesce(p_activo, true), actualizado_en = now()
     where id = p_id and modulo_id = p_modulo_id returning id into v_id;
    if v_id is null then perform public.fallar('no_existe', 'El artículo no existe.'); end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- Importación del catálogo desde Excel (solo administrador). Identifica por código; nunca cambia la existencia.
-- Celdas vacías en el archivo no borran lo que ya está guardado.
-- p_filas: [{fila, codigo, descripcion, codigo_ax, ubicacion, precio, notas}]
create or replace function public.inv_importar_articulos(p_modulo_id uuid, p_filas jsonb, p_archivo text, p_aplicar boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare f jsonb; a public.inv_articulos; v_cod text; v_desc text; v_precio numeric;
        n_nuevos int := 0; n_mod int := 0; n_igual int := 0; errores jsonb := '[]'::jsonb; vistos text[] := '{}';
begin
  perform public.exigir_admin();
  if not exists (select 1 from public.modulos where id = p_modulo_id) then perform public.fallar('modulo', 'Módulo no válido.'); end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    v_cod := nullif(btrim(f->>'codigo'), ''); v_desc := nullif(btrim(f->>'descripcion'), '');
    if v_cod is null or v_desc is null then
      errores := errores || jsonb_build_object('fila', f->'fila', 'mensaje', 'Falta el código o la descripción.'); continue;
    end if;
    if v_cod = any(vistos) then
      errores := errores || jsonb_build_object('fila', f->'fila', 'mensaje', 'Código repetido en el archivo: ' || v_cod); continue;
    end if;
    vistos := vistos || v_cod;
    begin v_precio := round(nullif(btrim(f->>'precio'), '')::numeric, 2);
    exception when others then
      errores := errores || jsonb_build_object('fila', f->'fila', 'mensaje', 'Precio no numérico: ' || (f->>'precio')); continue;
    end;
    if v_precio < 0 then errores := errores || jsonb_build_object('fila', f->'fila', 'mensaje', 'Precio negativo.'); continue; end if;
    select * into a from public.inv_articulos where modulo_id = p_modulo_id and codigo = v_cod;
    if a.id is null then
      n_nuevos := n_nuevos + 1;
      if p_aplicar then
        insert into public.inv_articulos (modulo_id, codigo, descripcion, codigo_ax, ubicacion, precio_usd, notas, origen_archivo, origen_fila)
          values (p_modulo_id, v_cod, v_desc, nullif(btrim(f->>'codigo_ax'), ''), nullif(btrim(f->>'ubicacion'), ''), v_precio,
                  nullif(btrim(f->>'notas'), ''), p_archivo, (f->>'fila')::int);
      end if;
    elsif a.descripcion is distinct from v_desc
       or a.codigo_ax is distinct from coalesce(nullif(btrim(f->>'codigo_ax'), ''), a.codigo_ax)
       or a.ubicacion is distinct from coalesce(nullif(btrim(f->>'ubicacion'), ''), a.ubicacion)
       or a.precio_usd is distinct from coalesce(v_precio, a.precio_usd)
       or a.notas is distinct from coalesce(nullif(btrim(f->>'notas'), ''), a.notas) then
      n_mod := n_mod + 1;
      if p_aplicar then
        update public.inv_articulos set descripcion = v_desc,
               codigo_ax = coalesce(nullif(btrim(f->>'codigo_ax'), ''), codigo_ax),
               ubicacion = coalesce(nullif(btrim(f->>'ubicacion'), ''), ubicacion),
               precio_usd = coalesce(v_precio, precio_usd),
               notas = coalesce(nullif(btrim(f->>'notas'), ''), notas),
               origen_archivo = p_archivo, origen_fila = (f->>'fila')::int, actualizado_en = now()
         where id = a.id;
      end if;
    else
      n_igual := n_igual + 1;
    end if;
  end loop;
  return jsonb_build_object('nuevos', n_nuevos, 'modificados', n_mod, 'sin_cambios', n_igual, 'errores', errores, 'aplicado', p_aplicar);
end $$;

revoke execute on function public.inv_puede(uuid), public.inv_empleado(text), public.inv_resumen(),
  public.inv_registrar_entrada(uuid, numeric, numeric, text, text, uuid),
  public.inv_registrar_salida(uuid, numeric, text, uuid, uuid, text, uuid),
  public.inv_guardar_articulo(uuid, uuid, text, text, text, text, numeric, text, boolean),
  public.inv_importar_articulos(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.inv_puede(uuid), public.inv_resumen(),
  public.inv_registrar_entrada(uuid, numeric, numeric, text, text, uuid),
  public.inv_registrar_salida(uuid, numeric, text, uuid, uuid, text, uuid),
  public.inv_guardar_articulo(uuid, uuid, text, text, text, text, numeric, text, boolean),
  public.inv_importar_articulos(uuid, jsonb, text, boolean) to authenticated;
