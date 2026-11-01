-- =====================================================================
-- Migración 4: importación de maquinaria y personal desde Excel.
-- El navegador lee el archivo y envía las filas como texto; el servidor valida,
-- compara y (solo si p_aplicar = true) aplica todo en una transacción.
-- Reglas: no borra ni desactiva lo que falte; las celdas vacías no borran valores
-- salvo que la columna esté en p_vaciar; conserva id interno e historial.
-- =====================================================================

-- Índice para detectar nombres repetidos al importar personal.
create index if not exists empleados_nombre_norm on public.empleados (public.normalizar(nombre));

create or replace function public.texto(j jsonb, k text)
returns text language sql immutable as $$ select nullif(btrim(j->>k), '') $$;

-- Fecha ISO (YYYY-MM-DD o YYYY-MM-DDTHH:MM:SS) en hora local de Tegucigalpa.
create or replace function public.leer_fecha(t text)
returns timestamptz language plpgsql immutable as $$
begin
  if t is null then return null; end if;
  if t !~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$' then raise exception 'fecha'; end if;
  return (t::timestamp) at time zone 'America/Tegucigalpa';
end $$;

create or replace function public.catalogo_id(p_tabla text, p_nombre text, p_crear boolean)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  if public.normalizar(p_nombre) is null then return null; end if;
  execute format('select id from public.%I where nombre_norm = public.normalizar($1)', p_tabla) into v using p_nombre;
  if v is null and p_crear then
    execute format('insert into public.%I (nombre) values ($1) returning id', p_tabla) into v using regexp_replace(btrim(p_nombre), '\s+', ' ', 'g');
  end if;
  return v;
end $$;

-- Valores que no identifican nada (no se usan para detectar duplicados).
create or replace function public.codigo_generico(t text)
returns boolean language sql immutable as $$
  select public.normalizar(t) is null or public.normalizar(t) in ('N/T','NT','NA','N/A','0','-','S/N','SN','SIN SERIE')
$$;

-- ---------------------------------------------------------------------
-- MAQUINARIA · clave: Asset ID
-- Campos de cada fila (texto): fila, asset_id, tipo, grupo, serie, fabricante, modelo, ubicacion,
-- puesto, estado, actualizado, fecha_compra, qr, especial, operacion, estilo, observacion,
-- numericos (arreglo con los campos que en Excel eran número).
-- ---------------------------------------------------------------------
create or replace function public.importar_maquinas(
  p_filas jsonb, p_archivo text, p_hoja text, p_hash text, p_mapeo jsonb,
  p_vaciar text[] default '{}', p_opciones jsonb default '{}', p_aplicar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f jsonb; v_res jsonb[] := '{}'; v_fila int; v_asset text; m public.maquinas;
  v_msgs text[]; v_resultado text; v_aplicar_fila boolean; v_cambios jsonb; v_nuevo jsonb; v_id uuid;
  v_imp uuid; k text; v_val text; v_antes text; c_nuevos int := 0; c_mod int := 0; c_igual int := 0; c_err int := 0; c_rev int := 0;
  v_actualizado timestamptz; v_compra timestamptz; v_numericos text[]; v_flag_rev boolean; v_motivo_rev text;
  v_campos text[] := array['tipo','grupo','fabricante','ubicacion','serie','modelo','puesto','estado','actualizado','fecha_compra','qr','especial','operacion','estilo','observacion'];
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
    v_flag_rev := false; v_motivo_rev := null;
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
      if v_flag_rev then v_msgs := array_append(v_msgs, (v_motivo_rev)::text); end if;

      -- Valores nuevos (texto) para comparar
      v_nuevo := jsonb_build_object(
        'tipo', public.texto(f,'tipo'), 'grupo', public.texto(f,'grupo'), 'fabricante', public.texto(f,'fabricante'),
        'ubicacion', public.texto(f,'ubicacion'), 'serie', public.texto(f,'serie'), 'modelo', public.texto(f,'modelo'),
        'puesto', public.texto(f,'puesto'), 'estado', public.normalizar(f->>'estado'),
        'actualizado', v_actualizado::text, 'fecha_compra', (v_compra at time zone 'America/Tegucigalpa')::date::text,
        'qr', public.texto(f,'qr'),
        'especial', case when public.texto(f,'especial') is null then null else (public.normalizar(f->>'especial') = 'CRITICA')::text end,
        'operacion', public.texto(f,'operacion'), 'estilo', public.texto(f,'estilo'), 'observacion', public.texto(f,'observacion'));

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
            when 'estilo' then m.estilo when 'observacion' then m.observacion end;
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
            campos_origen_numerico, requiere_revision, motivo_revision, origen_importacion_id, origen_archivo, origen_hoja, origen_fila)
          values (v_asset, v_nuevo->>'qr', v_nuevo->>'serie', v_nuevo->>'modelo',
            public.catalogo_id('tipos_maquina', v_nuevo->>'tipo', v_crear_cat), public.catalogo_id('grupos_maquina', v_nuevo->>'grupo', v_crear_cat),
            public.catalogo_id('fabricantes', v_nuevo->>'fabricante', v_crear_cat), public.catalogo_id('ubicaciones', v_nuevo->>'ubicacion', v_crear_cat),
            v_nuevo->>'puesto', v_nuevo->>'estado', coalesce((v_nuevo->>'especial')::boolean, false),
            (v_nuevo->>'fecha_compra')::date, v_actualizado, v_nuevo->>'operacion', v_nuevo->>'estilo', v_nuevo->>'observacion',
            v_numericos, v_flag_rev, v_motivo_rev, v_imp, p_archivo, p_hoja, v_fila)
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

-- ---------------------------------------------------------------------
-- PERSONAL · clave: código de empleado (texto, con ceros iniciales)
-- Campos: fila, codigo, nombre, cargo, especialidad, numericos
-- ---------------------------------------------------------------------
create or replace function public.importar_personal(
  p_filas jsonb, p_archivo text, p_hoja text, p_hash text, p_mapeo jsonb,
  p_vaciar text[] default '{}', p_opciones jsonb default '{}', p_aplicar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f jsonb; v_res jsonb[] := '{}'; v_fila int; v_cod text; e public.empleados; v_msgs text[]; v_resultado text;
  v_aplicar_fila boolean; v_cambios jsonb; v_id uuid; v_imp uuid; v_nombre text; k text; v_val text; v_antes text;
  c_nuevos int := 0; c_mod int := 0; c_igual int := 0; c_err int := 0; c_rev int := 0; v_numericos text[];
  v_aceptar_num boolean := coalesce((p_opciones->>'aceptar_codigo_numerico')::boolean, false);
begin
  perform public.exigir_admin();
  if jsonb_typeof(p_filas) <> 'array' then perform public.fallar('formato', 'Formato de filas no válido.'); end if;
  create temp table if not exists _imp_p (fila int, codigo text, nombre text) on commit drop;
  truncate _imp_p;
  create index if not exists _imp_p_codigo on _imp_p (codigo); create index if not exists _imp_p_nombre on _imp_p (nombre);
  insert into _imp_p select (x->>'fila')::int, public.texto(x,'codigo'), public.normalizar(x->>'nombre') from jsonb_array_elements(p_filas) x;

  if p_aplicar then
    insert into public.importaciones (tipo, archivo, hash_archivo, hoja, mapeo, opciones, usuario_id)
      values ('personal', p_archivo, p_hash, p_hoja, p_mapeo, jsonb_build_object('vaciar', p_vaciar) || coalesce(p_opciones,'{}'), auth.uid())
      returning id into v_imp;
    perform set_config('app.motivo', 'Importación ' || p_archivo, true);
  end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    v_fila := (f->>'fila')::int; v_cod := public.texto(f,'codigo'); v_msgs := '{}'; v_resultado := null;
    v_aplicar_fila := true; v_cambios := '{}'::jsonb; v_id := null;
    v_nombre := regexp_replace(coalesce(public.texto(f,'nombre'), ''), '\s+', ' ', 'g');
    v_numericos := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(f->'numericos','[]')) x), '{}');

    if v_cod is null then v_resultado := 'error'; v_msgs := array_append(v_msgs, ('Código vacío')::text); v_aplicar_fila := false;
    elsif v_nombre = '' then v_resultado := 'error'; v_msgs := array_append(v_msgs, ('Nombre vacío')::text); v_aplicar_fila := false;
    elsif (select count(*) from _imp_p where codigo = v_cod) > 1 then
      v_resultado := 'revision'; v_aplicar_fila := false;
      v_msgs := array_append(v_msgs, (('Código repetido en el archivo (filas ' || (select string_agg(fila::text, ', ' order by fila) from _imp_p where codigo = v_cod) || ')'))::text);
    elsif 'codigo' = any(v_numericos) and not v_aceptar_num then
      v_resultado := 'revision'; v_aplicar_fila := false;
      v_msgs := array_append(v_msgs, ('Código guardado como número en Excel: pudo perder ceros iniciales (opción "Aceptar códigos numéricos")')::text);
    end if;

    if v_resultado is null then
      select * into e from public.empleados where codigo = v_cod;
      if e.id is null then
        if exists (select 1 from public.empleados x where public.normalizar(x.nombre) = public.normalizar(v_nombre))
           or (select count(*) from _imp_p where nombre = public.normalizar(v_nombre)) > 1 then
          v_resultado := 'revision'; v_aplicar_fila := false;
          v_msgs := array_append(v_msgs, ('Empleado nuevo con el mismo nombre que otro código: confirme si es la misma persona')::text);
        elsif exists (select 1 from public.empleados x where x.codigo_sin_ceros = public.codigo_sin_ceros(v_cod)) then
          v_resultado := 'revision'; v_aplicar_fila := false;
          v_msgs := array_append(v_msgs, ('Ya existe el mismo código con diferentes ceros iniciales')::text);
        else
          v_resultado := 'nuevo';
        end if;
      else
        foreach k in array array['nombre','cargo','especialidad'] loop
          v_val := case k when 'nombre' then nullif(v_nombre,'') else public.texto(f,k) end;
          v_antes := case k when 'nombre' then e.nombre when 'cargo' then e.cargo else e.especialidad end;
          if v_val is null and not (k = any(p_vaciar)) then continue; end if;
          if v_val is not distinct from v_antes then continue; end if;
          v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_object('antes', v_antes, 'despues', v_val));
        end loop;
        v_resultado := case when v_cambios = '{}'::jsonb then 'sin_cambios' else 'modificado' end;
      end if;

      if p_aplicar and v_aplicar_fila then
        if e.id is null then
          insert into public.empleados (codigo, nombre, nombre_original, cargo, especialidad, origen_importacion_id, origen_archivo, origen_hoja, origen_fila)
            values (v_cod, v_nombre, f->>'nombre', public.texto(f,'cargo'), public.texto(f,'especialidad'), v_imp, p_archivo, p_hoja, v_fila)
            returning id into v_id;
        else
          v_id := e.id;
          if v_cambios <> '{}'::jsonb then
            update public.empleados set
              nombre = case when v_cambios ? 'nombre' then v_nombre else nombre end,
              nombre_original = case when v_cambios ? 'nombre' then f->>'nombre' else nombre_original end,
              cargo = case when v_cambios ? 'cargo' then public.texto(f,'cargo') else cargo end,
              especialidad = case when v_cambios ? 'especialidad' then public.texto(f,'especialidad') else especialidad end,
              origen_importacion_id = v_imp, origen_archivo = p_archivo, origen_hoja = p_hoja, origen_fila = v_fila
            where id = e.id;
          end if;
        end if;
      end if;
    end if;

    case v_resultado when 'nuevo' then c_nuevos := c_nuevos + 1; when 'modificado' then c_mod := c_mod + 1;
      when 'sin_cambios' then c_igual := c_igual + 1; when 'error' then c_err := c_err + 1; else c_rev := c_rev + 1; end case;
    if p_aplicar then
      insert into public.importacion_filas (importacion_id, fila_origen, clave, resultado, mensajes, cambios, datos_originales, registro_id)
        values (v_imp, v_fila, v_cod, v_resultado, v_msgs, nullif(v_cambios, '{}'::jsonb), f, v_id);
    end if;
    v_res := array_append(v_res, jsonb_build_object('fila', v_fila, 'clave', v_cod, 'resultado', v_resultado,
               'aplicable', v_aplicar_fila, 'mensajes', to_jsonb(v_msgs), 'cambios', v_cambios));
  end loop;

  if p_aplicar then
    update public.importaciones set total_filas = jsonb_array_length(p_filas), nuevos = c_nuevos, modificados = c_mod,
      sin_cambios = c_igual, errores = c_err, en_revision = c_rev where id = v_imp;
  end if;
  return jsonb_build_object('importacion_id', v_imp, 'aplicado', p_aplicar,
    'archivo_repetido', (p_hash is not null and exists (select 1 from public.importaciones where hash_archivo = p_hash and tipo = 'personal' and id is distinct from v_imp)),
    'resumen', jsonb_build_object('total', jsonb_array_length(p_filas), 'nuevos', c_nuevos, 'modificados', c_mod,
                                  'sin_cambios', c_igual, 'errores', c_err, 'revision', c_rev),
    'filas', to_jsonb(v_res));
end $$;
