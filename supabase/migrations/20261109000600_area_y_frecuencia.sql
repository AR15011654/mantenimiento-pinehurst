-- =====================================================================
-- Migración 6: área desde el Excel (columna "Area") y frecuencia de
-- mantenimiento (columna "FRECUENCIA DE MANTENIMIENTO").
-- Cada vez que se finaliza un mantenimiento (preventivo o correctivo) el
-- servidor calcula la fecha del próximo: fecha de cierre + frecuencia.
-- =====================================================================

-- Catálogo de frecuencias. Confirmado por el usuario (2026-11-09): BIMENSUAL = cada 2 meses.
create table public.frecuencias_mantenimiento (
  codigo text primary key,
  nombre text not null,
  meses int not null default 0 check (meses >= 0),
  dias int not null default 0 check (dias >= 0),
  orden int not null default 0,
  check (meses > 0 or dias > 0)
);
insert into public.frecuencias_mantenimiento (codigo, nombre, meses, orden) values
  ('MENSUAL', 'Mensual', 1, 1),
  ('BIMENSUAL', 'Bimensual (cada 2 meses)', 2, 2),
  ('TRIMESTRAL', 'Trimestral', 3, 3),
  ('SEMESTRAL', 'Semestral', 6, 4),
  ('ANUAL', 'Anual', 12, 5);
alter table public.frecuencias_mantenimiento enable row level security;
grant select on public.frecuencias_mantenimiento to authenticated;
create policy leer_activos on public.frecuencias_mantenimiento for select to authenticated using (public.usuario_activo());

alter table public.maquinas
  add column frecuencia text references public.frecuencias_mantenimiento(codigo),
  add column ultimo_mantenimiento_en timestamptz,   -- cierre (fin_en) del último mantenimiento finalizado
  add column proximo_mantenimiento date;            -- último cierre (fecha de Tegucigalpa) + frecuencia
create index on public.maquinas (proximo_mantenimiento);
grant update (frecuencia) on public.maquinas to authenticated;  -- RLS: solo admin

-- Fecha del próximo mantenimiento a partir de una fecha de cierre y una frecuencia.
create or replace function public.calcular_proximo(p_ultimo timestamptz, p_frecuencia text)
returns date language sql stable set search_path = public, pg_temp as $$
  select ((p_ultimo at time zone 'America/Tegucigalpa')::date + make_interval(months => f.meses, days => f.dias))::date
  from public.frecuencias_mantenimiento f where f.codigo = p_frecuencia and p_ultimo is not null
$$;

-- Recalcula último y próximo de una máquina con los mantenimientos finalizados (pendientes de validación o completados).
create or replace function public.recalcular_proximo(p_maquina uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ultimo timestamptz;
begin
  select max(fin_en) into v_ultimo from public.mantenimientos
   where maquina_id = p_maquina and estado in ('pendiente_validacion', 'completado') and fin_en is not null;
  perform set_config('app.motivo', 'Cálculo del próximo mantenimiento', true);
  update public.maquinas set ultimo_mantenimiento_en = v_ultimo,
         proximo_mantenimiento = public.calcular_proximo(v_ultimo, frecuencia)
   where id = p_maquina
     and (ultimo_mantenimiento_en is distinct from v_ultimo
          or proximo_mantenimiento is distinct from public.calcular_proximo(v_ultimo, frecuencia));
end $$;

create or replace function public.tg_mantenimientos_proximo()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.recalcular_proximo(new.maquina_id);
  return null;
end $$;
create trigger mantenimientos_proximo after insert or update of estado, fin_en on public.mantenimientos
  for each row execute function public.tg_mantenimientos_proximo();

-- Si cambia la frecuencia de una máquina, se recalcula su próxima fecha.
create or replace function public.tg_maquinas_frecuencia()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.proximo_mantenimiento := public.calcular_proximo(new.ultimo_mantenimiento_en, new.frecuencia);
  return new;
end $$;
create trigger maquinas_frecuencia before insert or update of frecuencia, ultimo_mantenimiento_en on public.maquinas
  for each row execute function public.tg_maquinas_frecuencia();

-- Reglas de clasificación: si la importación trae el área explícita, no se recalcula por ubicación.
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
        and new.area_id is not distinct from old.area_id and new.modulo_id is not distinct from old.modulo_id
        and not (coalesce(current_setting('app.origen', true), '') = 'importacion' and new.area_id is not null) then
    r := public.regla_clasificacion(new.tipo_id, new.ubicacion_id);
    if r.modulo_id is not null then
      new.modulo_id := r.modulo_id; new.area_id := r.area_id;
    elsif old.modulo_id is not null then
      new.requiere_revision := true;
      new.motivo_revision := concat_ws(' · ', nullif(new.motivo_revision, ''), 'Cambió la ubicación y no hay regla de área: confirme la clasificación');
    end if;
  end if;
  if new.area_id is not null then
    select a.modulo_id into new.modulo_id from public.areas a where a.id = new.area_id;
  end if;
  return new;
end $$;

-- Vista: se agregan las columnas nuevas al final (no cambia el orden de las existentes).
create or replace view public.v_maquinas with (security_invoker = true) as
select m.id, m.asset_id, m.qr, m.serie, m.modelo, m.puesto,
       m.estado_inventario, m.condicion_operativa, m.es_critica, m.fecha_compra_registro, m.actualizado_origen,
       m.operacion, m.estilo, m.observacion, m.requiere_revision, m.motivo_revision, m.activo,
       m.campos_origen_numerico,
       m.tipo_id, t.nombre as tipo, m.grupo_id, g.nombre as grupo, m.fabricante_id, f.nombre as fabricante,
       m.ubicacion_id, u.nombre as ubicacion, u.tipo as ubicacion_tipo,
       m.modulo_id, mo.nombre as modulo, m.area_id, a.nombre as area,
       (m.modulo_id is null) as sin_clasificar,
       m.origen_archivo, m.origen_hoja, m.origen_fila, m.creado_en, m.actualizado_en,
       m.frecuencia, m.ultimo_mantenimiento_en, m.proximo_mantenimiento
from public.maquinas m
left join public.tipos_maquina t on t.id = m.tipo_id
left join public.grupos_maquina g on g.id = m.grupo_id
left join public.fabricantes f on f.id = m.fabricante_id
left join public.ubicaciones u on u.id = m.ubicacion_id
left join public.modulos mo on mo.id = m.modulo_id
left join public.areas a on a.id = m.area_id;
grant select on public.v_maquinas to authenticated;

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

-- Importación de maquinaria: agrega "frecuencia" y "area" (las demás reglas no cambian).
create or replace function public.importar_maquinas(
  p_filas jsonb, p_archivo text, p_hoja text, p_hash text, p_mapeo jsonb,
  p_vaciar text[] default '{}', p_opciones jsonb default '{}', p_aplicar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f jsonb; v_res jsonb[] := '{}'; v_fila int; v_asset text; m public.maquinas;
  v_msgs text[]; v_resultado text; v_aplicar_fila boolean; v_cambios jsonb; v_nuevo jsonb; v_id uuid;
  v_imp uuid; k text; v_val text; v_antes text; c_nuevos int := 0; c_mod int := 0; c_igual int := 0; c_err int := 0; c_rev int := 0;
  v_actualizado timestamptz; v_compra timestamptz; v_numericos text[]; v_flag_rev boolean; v_motivo_rev text;
  v_area public.areas; v_frec text;
  v_campos text[] := array['tipo','grupo','fabricante','ubicacion','serie','modelo','puesto','estado','actualizado','fecha_compra','qr','especial','operacion','estilo','observacion','frecuencia','area'];
  v_aceptar_num boolean := coalesce((p_opciones->>'aceptar_asset_numerico')::boolean, false);
  v_crear_cat boolean := true;
begin
  perform public.exigir_admin();
  if jsonb_typeof(p_filas) <> 'array' then perform public.fallar('formato', 'Formato de filas no válido.'); end if;

  -- Tablas temporales para detectar duplicados dentro del archivo.
  create temp table if not exists _imp (fila int, asset text, qr text, serie text) on commit drop;
  truncate _imp;
  create index if not exists _imp_asset on _imp (asset); create index if not exists _imp_qr on _imp (qr); create index if not exists _imp_serie on _imp (serie);
  insert into _imp select (x->>'fila')::int, public.texto(x,'asset_id'), public.normalizar(x->>'qr'), public.normalizar(x->>'serie')
    from jsonb_array_elements(p_filas) x;

  if p_aplicar then
    insert into public.importaciones (tipo, archivo, hash_archivo, hoja, mapeo, opciones, usuario_id)
      values ('maquinaria', p_archivo, p_hash, p_hoja, p_mapeo, jsonb_build_object('vaciar', p_vaciar) || coalesce(p_opciones,'{}'), auth.uid())
      returning id into v_imp;
    perform set_config('app.origen', 'importacion', true);
    perform set_config('app.motivo', 'Importación ' || p_archivo, true);
  end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    v_fila := (f->>'fila')::int; v_asset := public.texto(f, 'asset_id'); v_msgs := '{}';
    v_resultado := null; v_aplicar_fila := true; v_cambios := '{}'::jsonb; v_id := null;
    v_flag_rev := false; v_motivo_rev := null; v_area := null; v_frec := null;
    v_numericos := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(f->'numericos','[]')) x), '{}');

    -- Validaciones de la fila
    if v_asset is null then
      v_resultado := 'error'; v_msgs := array_append(v_msgs, ('Asset ID vacío')::text); v_aplicar_fila := false;
    end if;
    begin v_actualizado := public.leer_fecha(public.texto(f,'actualizado'));
    exception when others then v_resultado := 'error'; v_msgs := array_append(v_msgs, (('Fecha no válida en ACTUALIZADO: ' || coalesce(f->>'actualizado','')))::text); v_aplicar_fila := false; end;
    begin v_compra := public.leer_fecha(public.texto(f,'fecha_compra'));
    exception when others then v_resultado := 'error'; v_msgs := array_append(v_msgs, (('Fecha no válida en FECHA DE COMPRA: ' || coalesce(f->>'fecha_compra','')))::text); v_aplicar_fila := false; end;

    if v_resultado is null then
      if (select count(*) from _imp where asset = v_asset) > 1 then
        v_resultado := 'revision'; v_aplicar_fila := false;
        v_msgs := array_append(v_msgs, (('Asset ID repetido en el archivo (filas ' || (select string_agg(fila::text, ', ' order by fila) from _imp where asset = v_asset) || ')'))::text);
      elsif 'asset_id' = any(v_numericos) and not v_aceptar_num then
        v_resultado := 'revision'; v_aplicar_fila := false;
        v_msgs := array_append(v_msgs, ('Asset ID guardado como número en Excel: confirme que no perdió dígitos o ceros (opción "Aceptar Asset ID numéricos")')::text);
      end if;
    end if;

    if v_resultado is null then
      select * into m from public.maquinas where asset_id = v_asset;
      -- Duplicados de QR / serie con otras máquinas (no se fusionan; se importan marcadas para revisión)
      if public.normalizar(f->>'qr') is not null and (
           exists (select 1 from _imp where qr = public.normalizar(f->>'qr') and asset is distinct from v_asset)
           or exists (select 1 from public.maquinas x where public.normalizar(x.qr) = public.normalizar(f->>'qr') and x.asset_id <> v_asset)) then
        v_flag_rev := true; v_motivo_rev := concat_ws(' · ', v_motivo_rev, 'QR ' || (f->>'qr') || ' compartido con otra máquina');
      end if;
      if not public.codigo_generico(f->>'serie') and (
           exists (select 1 from _imp where serie = public.normalizar(f->>'serie') and asset is distinct from v_asset)
           or exists (select 1 from public.maquinas x where public.normalizar(x.serie) = public.normalizar(f->>'serie') and x.asset_id <> v_asset)) then
        v_flag_rev := true; v_motivo_rev := concat_ws(' · ', v_motivo_rev, 'Serie ' || (f->>'serie') || ' compartida con otra máquina');
      end if;
      if public.normalizar(f->>'qr') is null and m.id is null then
        v_flag_rev := true; v_motivo_rev := concat_ws(' · ', v_motivo_rev, 'Sin QR');
      end if;
      -- Área (columna Area del Excel): debe existir en el catálogo de áreas.
      if public.texto(f,'area') is not null then
        select * into v_area from public.areas a
         where public.normalizar(a.codigo) = public.normalizar(replace(f->>'area', ' ', '_'))
            or public.normalizar(a.nombre) = public.normalizar(f->>'area')
            or public.normalizar(translate(a.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = public.normalizar(translate(f->>'area', 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'))
         limit 1;
        if v_area.id is null then
          v_flag_rev := true; v_motivo_rev := concat_ws(' · ', v_motivo_rev, 'Área ' || (f->>'area') || ' no existe');
        end if;
      end if;
      -- Frecuencia de mantenimiento: debe existir en el catálogo de frecuencias.
      if public.texto(f,'frecuencia') is not null then
        select codigo into v_frec from public.frecuencias_mantenimiento where codigo = public.normalizar(f->>'frecuencia');
        if v_frec is null then
          v_flag_rev := true; v_motivo_rev := concat_ws(' · ', v_motivo_rev, 'Frecuencia ' || (f->>'frecuencia') || ' no reconocida');
        end if;
      end if;
      if v_flag_rev then v_msgs := array_append(v_msgs, (v_motivo_rev)::text); end if;

      -- Valores nuevos (texto) para comparar
      v_nuevo := jsonb_build_object(
        'tipo', public.texto(f,'tipo'), 'grupo', public.texto(f,'grupo'), 'fabricante', public.texto(f,'fabricante'),
        'ubicacion', public.texto(f,'ubicacion'), 'serie', public.texto(f,'serie'), 'modelo', public.texto(f,'modelo'),
        'puesto', public.texto(f,'puesto'), 'estado', public.normalizar(f->>'estado'),
        'actualizado', v_actualizado::text, 'fecha_compra', (v_compra at time zone 'America/Tegucigalpa')::date::text,
        'qr', public.texto(f,'qr'),
        'especial', case when public.texto(f,'especial') is null then null else (public.normalizar(f->>'especial') = 'CRITICA')::text end,
        'operacion', public.texto(f,'operacion'), 'estilo', public.texto(f,'estilo'), 'observacion', public.texto(f,'observacion'),
        'frecuencia', v_frec, 'area', v_area.nombre);

      if m.id is null then
        v_resultado := case when v_flag_rev then 'revision' else 'nuevo' end;
      else
        foreach k in array v_campos loop
          v_val := v_nuevo->>k;
          v_antes := case k
            when 'tipo' then (select nombre from public.tipos_maquina where id = m.tipo_id)
            when 'grupo' then (select nombre from public.grupos_maquina where id = m.grupo_id)
            when 'fabricante' then (select nombre from public.fabricantes where id = m.fabricante_id)
            when 'ubicacion' then (select nombre from public.ubicaciones where id = m.ubicacion_id)
            when 'serie' then m.serie when 'modelo' then m.modelo when 'puesto' then m.puesto
            when 'estado' then m.estado_inventario when 'actualizado' then m.actualizado_origen::text
            when 'fecha_compra' then m.fecha_compra_registro::text when 'qr' then m.qr
            when 'especial' then m.es_critica::text when 'operacion' then m.operacion
            when 'estilo' then m.estilo when 'observacion' then m.observacion
            when 'frecuencia' then m.frecuencia
            when 'area' then (select nombre from public.areas where id = m.area_id) end;
          if v_val is null and not (k = any(p_vaciar)) then continue; end if;  -- vacío no borra
          if k in ('tipo','grupo','fabricante','ubicacion') then
            if public.normalizar(v_val) is not distinct from public.normalizar(v_antes) then continue; end if;
          elsif k = 'especial' and v_val is null then
            if v_antes = 'false' then continue; end if;
          elsif v_val is not distinct from v_antes then continue;
          end if;
          v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_object('antes', v_antes, 'despues', v_val));
        end loop;
        v_resultado := case when v_cambios = '{}'::jsonb then 'sin_cambios' when v_flag_rev and not m.requiere_revision then 'revision' else 'modificado' end;
      end if;

      if p_aplicar and v_aplicar_fila then
        if m.id is null then
          insert into public.maquinas (asset_id, qr, serie, modelo, tipo_id, grupo_id, fabricante_id, ubicacion_id, puesto,
            estado_inventario, es_critica, fecha_compra_registro, actualizado_origen, operacion, estilo, observacion,
            campos_origen_numerico, requiere_revision, motivo_revision, origen_importacion_id, origen_archivo, origen_hoja, origen_fila,
            frecuencia, area_id, modulo_id)
          values (v_asset, v_nuevo->>'qr', v_nuevo->>'serie', v_nuevo->>'modelo',
            public.catalogo_id('tipos_maquina', v_nuevo->>'tipo', v_crear_cat), public.catalogo_id('grupos_maquina', v_nuevo->>'grupo', v_crear_cat),
            public.catalogo_id('fabricantes', v_nuevo->>'fabricante', v_crear_cat), public.catalogo_id('ubicaciones', v_nuevo->>'ubicacion', v_crear_cat),
            v_nuevo->>'puesto', v_nuevo->>'estado', coalesce((v_nuevo->>'especial')::boolean, false),
            (v_nuevo->>'fecha_compra')::date, v_actualizado, v_nuevo->>'operacion', v_nuevo->>'estilo', v_nuevo->>'observacion',
            v_numericos, v_flag_rev, v_motivo_rev, v_imp, p_archivo, p_hoja, v_fila,
            v_frec, v_area.id, v_area.modulo_id)
          returning id into v_id;
        else
          v_id := m.id;
          if v_cambios <> '{}'::jsonb or (v_flag_rev and not m.requiere_revision) then
            update public.maquinas set
              tipo_id = case when v_cambios ? 'tipo' then public.catalogo_id('tipos_maquina', v_nuevo->>'tipo', v_crear_cat) else tipo_id end,
              grupo_id = case when v_cambios ? 'grupo' then public.catalogo_id('grupos_maquina', v_nuevo->>'grupo', v_crear_cat) else grupo_id end,
              fabricante_id = case when v_cambios ? 'fabricante' then public.catalogo_id('fabricantes', v_nuevo->>'fabricante', v_crear_cat) else fabricante_id end,
              ubicacion_id = case when v_cambios ? 'ubicacion' then public.catalogo_id('ubicaciones', v_nuevo->>'ubicacion', v_crear_cat) else ubicacion_id end,
              serie = case when v_cambios ? 'serie' then v_nuevo->>'serie' else serie end,
              modelo = case when v_cambios ? 'modelo' then v_nuevo->>'modelo' else modelo end,
              puesto = case when v_cambios ? 'puesto' then v_nuevo->>'puesto' else puesto end,
              estado_inventario = case when v_cambios ? 'estado' then v_nuevo->>'estado' else estado_inventario end,
              actualizado_origen = case when v_cambios ? 'actualizado' then v_actualizado else actualizado_origen end,
              fecha_compra_registro = case when v_cambios ? 'fecha_compra' then (v_nuevo->>'fecha_compra')::date else fecha_compra_registro end,
              qr = case when v_cambios ? 'qr' then v_nuevo->>'qr' else qr end,
              es_critica = case when v_cambios ? 'especial' then coalesce((v_nuevo->>'especial')::boolean, false) else es_critica end,
              operacion = case when v_cambios ? 'operacion' then v_nuevo->>'operacion' else operacion end,
              estilo = case when v_cambios ? 'estilo' then v_nuevo->>'estilo' else estilo end,
              observacion = case when v_cambios ? 'observacion' then v_nuevo->>'observacion' else observacion end,
              frecuencia = case when v_cambios ? 'frecuencia' then v_frec else frecuencia end,
              area_id = case when v_cambios ? 'area' then v_area.id else area_id end,
              modulo_id = case when v_cambios ? 'area' then v_area.modulo_id else modulo_id end,
              campos_origen_numerico = v_numericos,
              requiere_revision = requiere_revision or v_flag_rev,
              motivo_revision = case when v_flag_rev and not requiere_revision then v_motivo_rev else motivo_revision end,
              origen_importacion_id = v_imp, origen_archivo = p_archivo, origen_hoja = p_hoja, origen_fila = v_fila
            where id = m.id;
          end if;
        end if;
      end if;
    end if;

    case v_resultado when 'nuevo' then c_nuevos := c_nuevos + 1; when 'modificado' then c_mod := c_mod + 1;
      when 'sin_cambios' then c_igual := c_igual + 1; when 'error' then c_err := c_err + 1; else c_rev := c_rev + 1; end case;

    if p_aplicar then
      insert into public.importacion_filas (importacion_id, fila_origen, clave, resultado, mensajes, cambios, datos_originales, registro_id)
        values (v_imp, v_fila, v_asset, v_resultado, v_msgs, nullif(v_cambios, '{}'::jsonb), f, v_id);
    end if;
    v_res := array_append(v_res, jsonb_build_object('fila', v_fila, 'clave', v_asset, 'resultado', v_resultado,
               'aplicable', v_aplicar_fila, 'mensajes', to_jsonb(v_msgs), 'cambios', v_cambios));
  end loop;

  if p_aplicar then
    update public.importaciones set total_filas = jsonb_array_length(p_filas), nuevos = c_nuevos, modificados = c_mod,
      sin_cambios = c_igual, errores = c_err, en_revision = c_rev where id = v_imp;
  end if;

  return jsonb_build_object('importacion_id', v_imp, 'aplicado', p_aplicar,
    'archivo_repetido', (p_hash is not null and exists (select 1 from public.importaciones where hash_archivo = p_hash and tipo = 'maquinaria' and id is distinct from v_imp)),
    'resumen', jsonb_build_object('total', jsonb_array_length(p_filas), 'nuevos', c_nuevos, 'modificados', c_mod,
                                  'sin_cambios', c_igual, 'errores', c_err, 'revision', c_rev),
    'filas', to_jsonb(v_res));
end $$;


revoke execute on function public.calcular_proximo(timestamptz, text), public.recalcular_proximo(uuid),
  public.tg_mantenimientos_proximo(), public.tg_maquinas_frecuencia() from public, anon, authenticated;
grant execute on function public.importar_maquinas(jsonb, text, text, text, jsonb, text[], jsonb, boolean),
  public.buscar_por_codigo(text) to authenticated;
