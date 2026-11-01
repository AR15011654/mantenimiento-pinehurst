-- =====================================================================
-- Migración 2: funciones de seguridad, reglas de clasificación,
-- historial de ubicaciones y auditoría.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funciones de permisos (security definer para evitar recursión de RLS)
-- ---------------------------------------------------------------------
create or replace function public.usuario_activo()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.activo)
$$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.activo and u.perfil = 'admin')
$$;

create or replace function public.perfil_actual()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select u.perfil from public.usuarios u where u.id = auth.uid() and u.activo
$$;

create or replace function public.mi_empleado_id()
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select u.empleado_id from public.usuarios u where u.id = auth.uid() and u.activo
$$;

-- ¿El usuario actual puede trabajar en este módulo/área?
-- Alcance con area_id nulo = todo el módulo. Una máquina sin área solo la ve quien tiene el módulo completo.
create or replace function public.tiene_acceso(p_modulo uuid, p_area uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.es_admin() or (
    p_modulo is not null and exists (
      select 1 from public.usuario_alcance a join public.usuarios u on u.id = a.usuario_id
      where u.id = auth.uid() and u.activo
        and a.modulo_id = p_modulo
        and (a.area_id is null or a.area_id = p_area)))
$$;

-- Ver un mantenimiento: admin; supervisor de esa área; técnico solo los suyos en sus áreas.
create or replace function public.puede_ver_mantenimiento(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.mantenimientos m
    where m.id = p_id and (
      public.es_admin()
      or (public.perfil_actual() = 'supervisor' and public.tiene_acceso(m.modulo_id, m.area_id))
      or (public.perfil_actual() = 'tecnico' and public.tiene_acceso(m.modulo_id, m.area_id)
          and (m.creado_por = auth.uid() or m.iniciado_por = auth.uid()
               or (m.mecanico_id is not null and m.mecanico_id = public.mi_empleado_id())))))
$$;

-- Registrar en un mantenimiento (comentarios, fotos, finalizar).
create or replace function public.puede_trabajar_mantenimiento(p_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.mantenimientos m
    where m.id = p_id and (
      public.es_admin()
      or (public.perfil_actual() = 'supervisor' and public.tiene_acceso(m.modulo_id, m.area_id))
      or (public.perfil_actual() = 'tecnico' and public.tiene_acceso(m.modulo_id, m.area_id)
          and (m.creado_por = auth.uid() or (m.mecanico_id is not null and m.mecanico_id = public.mi_empleado_id())))))
$$;

-- ---------------------------------------------------------------------
-- Reglas de clasificación: tipo de máquina (prioridad) y ubicación
-- ---------------------------------------------------------------------
create or replace function public.regla_clasificacion(p_tipo uuid, p_ubicacion uuid, out modulo_id uuid, out area_id uuid)
language plpgsql stable set search_path = public, pg_temp as $$
declare v_tipo_mod uuid; v_ub_area uuid; v_ub_mod uuid;
begin
  select t.modulo_id into v_tipo_mod from public.tipos_maquina t where t.id = p_tipo;
  select u.area_id, a.modulo_id into v_ub_area, v_ub_mod
    from public.ubicaciones u left join public.areas a on a.id = u.area_id where u.id = p_ubicacion;
  if v_tipo_mod is not null then
    modulo_id := v_tipo_mod;
    area_id := case when v_ub_mod = v_tipo_mod then v_ub_area end;
  elsif v_ub_area is not null then
    modulo_id := v_ub_mod; area_id := v_ub_area;
  end if;
end $$;

create or replace function public.tg_maquinas_antes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  new.actualizado_en := now();
  if tg_op = 'INSERT' then
    if new.area_id is null and new.modulo_id is null then
      r := public.regla_clasificacion(new.tipo_id, new.ubicacion_id);
      new.modulo_id := r.modulo_id; new.area_id := r.area_id;
    end if;
  elsif (new.ubicacion_id is distinct from old.ubicacion_id or new.tipo_id is distinct from old.tipo_id)
        and new.area_id is not distinct from old.area_id and new.modulo_id is not distinct from old.modulo_id then
    -- Cambió la ubicación/tipo y quien actualiza no indicó área: aplicar reglas.
    r := public.regla_clasificacion(new.tipo_id, new.ubicacion_id);
    if r.modulo_id is not null then
      new.modulo_id := r.modulo_id; new.area_id := r.area_id;
    elsif old.modulo_id is not null then
      new.requiere_revision := true;
      new.motivo_revision := concat_ws(' · ', nullif(new.motivo_revision, ''), 'Cambió la ubicación y no hay regla de área: confirme la clasificación');
    end if;
  end if;
  -- El área siempre debe pertenecer al módulo.
  if new.area_id is not null then
    select a.modulo_id into new.modulo_id from public.areas a where a.id = new.area_id;
  end if;
  return new;
end $$;

create trigger maquinas_antes before insert or update on public.maquinas
  for each row execute function public.tg_maquinas_antes();

-- Historial de ubicación / área / módulo
create or replace function public.tg_maquinas_historial()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT'
     or new.ubicacion_id is distinct from old.ubicacion_id or new.puesto is distinct from old.puesto
     or new.area_id is distinct from old.area_id or new.modulo_id is distinct from old.modulo_id then
    update public.maquina_ubicacion_historial set hasta = now()
      where maquina_id = new.id and hasta is null;
    insert into public.maquina_ubicacion_historial (maquina_id, ubicacion_id, puesto, modulo_id, area_id, origen, motivo, usuario_id)
    values (new.id, new.ubicacion_id, new.puesto, new.modulo_id, new.area_id,
            coalesce(nullif(current_setting('app.origen', true), ''), 'manual'),
            nullif(current_setting('app.motivo', true), ''), auth.uid());
  end if;
  return null;
end $$;

create trigger maquinas_historial after insert or update on public.maquinas
  for each row execute function public.tg_maquinas_historial();

create or replace function public.tg_actualizado_en()
returns trigger language plpgsql as $$ begin new.actualizado_en := now(); return new; end $$;
create trigger empleados_actualizado before update on public.empleados
  for each row execute function public.tg_actualizado_en();

-- ---------------------------------------------------------------------
-- Auditoría genérica
-- ---------------------------------------------------------------------
create or replace function public.tg_auditar()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_antes jsonb; v_despues jsonb; v_id text;
begin
  if tg_op in ('UPDATE','DELETE') then v_antes := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_despues := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_antes = v_despues then return null; end if;
  v_id := coalesce(v_despues->>'id', v_antes->>'id',
                   concat_ws(':', coalesce(v_despues, v_antes)->>'empleado_id', coalesce(v_despues, v_antes)->>'area_id'));
  insert into public.auditoria (tabla, registro_id, accion, antes, despues, motivo, usuario_id)
  values (tg_table_name, v_id, lower(tg_op), v_antes, v_despues, nullif(current_setting('app.motivo', true), ''), auth.uid());
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['modulos','areas','ubicaciones','tipos_maquina','grupos_maquina','fabricantes',
                           'maquinas','empleados','empleado_areas','usuarios','usuario_alcance',
                           'planes_preventivos','plan_actividades','inventarios_origen']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.tg_auditar()',
                   t || '_auditoria', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Habilitación del primer administrador (solo desde SQL Editor / rol dueño)
-- ---------------------------------------------------------------------
create or replace function public.bootstrap_admin(p_email text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid;
begin
  if exists (select 1 from public.usuarios where perfil = 'admin') then
    raise exception 'Ya existe un administrador. Los demás usuarios se gestionan desde la aplicación.';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then
    raise exception 'No existe una cuenta con el correo %. Invítela primero en Authentication > Users.', p_email;
  end if;
  insert into public.usuarios (id, email, perfil, activo) values (v_uid, lower(btrim(p_email)), 'admin', true);
  insert into public.usuario_alcance (usuario_id, modulo_id) select v_uid, id from public.modulos;
  return 'Administrador habilitado: ' || p_email;
end $$;
