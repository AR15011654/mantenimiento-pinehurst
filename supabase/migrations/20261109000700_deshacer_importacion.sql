-- =====================================================================
-- Migración 7: ver y deshacer importaciones (solo administrador).
-- Deshacer = borrar los registros que esa importación CREÓ (si nadie los usa)
-- y devolver a su valor anterior los campos que MODIFICÓ.
-- Solo se puede deshacer la última importación vigente de cada tipo, para que
-- los valores "anteriores" sigan siendo válidos.
-- =====================================================================

alter table public.importaciones drop constraint if exists importaciones_estado_check;
alter table public.importaciones add constraint importaciones_estado_check check (estado in ('aplicada', 'fallida', 'anulada'));
alter table public.importaciones
  add column anulada_por uuid,
  add column anulada_en timestamptz,
  add column motivo_anulacion text,
  add column resultado_anulacion jsonb;

create or replace function public.admin_deshacer_importacion(p_id uuid, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  imp public.importaciones; f record; c jsonb; k text; v_antes text;
  n_borrados int := 0; n_revertidos int := 0; v_conservados jsonb := '[]'::jsonb;
begin
  perform public.exigir_admin();
  if length(btrim(coalesce(p_motivo, ''))) = 0 then perform public.fallar('motivo', 'Indique el motivo para deshacer la importación.'); end if;
  select * into imp from public.importaciones where id = p_id for update;
  if imp.id is null then perform public.fallar('no_existe', 'La importación no existe.'); end if;
  if imp.estado <> 'aplicada' then perform public.fallar('estado', 'Esta importación ya fue deshecha o no se aplicó.'); end if;
  if exists (select 1 from public.importaciones i where i.tipo = imp.tipo and i.estado = 'aplicada' and i.creado_en > imp.creado_en) then
    perform public.fallar('no_ultima', 'Solo se puede deshacer la última importación de este tipo. Deshaga primero las más recientes.');
  end if;

  perform set_config('app.motivo', 'Deshacer importación ' || imp.archivo || ': ' || btrim(p_motivo), true);
  perform set_config('app.origen', 'importacion', true);

  for f in select * from public.importacion_filas where importacion_id = imp.id and registro_id is not null order by id desc loop
    if f.resultado in ('nuevo', 'revision') and not exists (
         select 1 from public.importacion_filas o join public.importaciones i on i.id = o.importacion_id
          where o.registro_id = f.registro_id and i.estado = 'aplicada' and i.creado_en < imp.creado_en) then
      -- Registro creado por esta importación
      if imp.tipo = 'personal' then
        if exists (select 1 from public.mantenimientos where mecanico_id = f.registro_id)
           or exists (select 1 from public.usuarios where empleado_id = f.registro_id)
           or exists (select 1 from public.programaciones where responsable_id = f.registro_id) then
          v_conservados := v_conservados || jsonb_build_object('clave', f.clave, 'motivo', 'Tiene trabajos o una cuenta vinculada');
        else
          delete from public.empleado_areas where empleado_id = f.registro_id;
          delete from public.empleados where id = f.registro_id;
          n_borrados := n_borrados + 1;
        end if;
      else
        if exists (select 1 from public.mantenimientos where maquina_id = f.registro_id)
           or exists (select 1 from public.programaciones where maquina_id = f.registro_id)
           or exists (select 1 from public.paros_maquina where maquina_id = f.registro_id)
           or exists (select 1 from public.planes_preventivos where maquina_id = f.registro_id)
           or exists (select 1 from public.consumos_repuestos where maquina_id = f.registro_id) then
          v_conservados := v_conservados || jsonb_build_object('clave', f.clave, 'motivo', 'Tiene mantenimientos registrados');
        else
          delete from public.maquina_ubicacion_historial where maquina_id = f.registro_id;
          delete from public.maquinas where id = f.registro_id;
          n_borrados := n_borrados + 1;
        end if;
      end if;
    elsif f.cambios is not null and f.cambios <> '{}'::jsonb then
      -- Registro modificado: devolver cada campo a su valor anterior
      c := f.cambios;
      if imp.tipo = 'personal' then
        update public.empleados set
          nombre = case when c ? 'nombre' then coalesce(c->'nombre'->>'antes', nombre) else nombre end,
          cargo = case when c ? 'cargo' then c->'cargo'->>'antes' else cargo end,
          especialidad = case when c ? 'especialidad' then c->'especialidad'->>'antes' else especialidad end
        where id = f.registro_id;
      else
        for k in select jsonb_object_keys(c) loop
          v_antes := c->k->>'antes';
          case k
            when 'tipo' then update public.maquinas set tipo_id = public.catalogo_id('tipos_maquina', v_antes, true) where id = f.registro_id;
            when 'grupo' then update public.maquinas set grupo_id = public.catalogo_id('grupos_maquina', v_antes, true) where id = f.registro_id;
            when 'fabricante' then update public.maquinas set fabricante_id = public.catalogo_id('fabricantes', v_antes, true) where id = f.registro_id;
            when 'ubicacion' then update public.maquinas set ubicacion_id = public.catalogo_id('ubicaciones', v_antes, true) where id = f.registro_id;
            when 'serie' then update public.maquinas set serie = v_antes where id = f.registro_id;
            when 'modelo' then update public.maquinas set modelo = v_antes where id = f.registro_id;
            when 'puesto' then update public.maquinas set puesto = v_antes where id = f.registro_id;
            when 'qr' then update public.maquinas set qr = v_antes where id = f.registro_id;
            when 'estado' then update public.maquinas set estado_inventario = v_antes where id = f.registro_id;
            when 'actualizado' then update public.maquinas set actualizado_origen = v_antes::timestamptz where id = f.registro_id;
            when 'fecha_compra' then update public.maquinas set fecha_compra_registro = v_antes::date where id = f.registro_id;
            when 'especial' then update public.maquinas set es_critica = coalesce(v_antes::boolean, false) where id = f.registro_id;
            when 'operacion' then update public.maquinas set operacion = v_antes where id = f.registro_id;
            when 'estilo' then update public.maquinas set estilo = v_antes where id = f.registro_id;
            when 'observacion' then update public.maquinas set observacion = v_antes where id = f.registro_id;
            when 'frecuencia' then update public.maquinas set frecuencia = v_antes where id = f.registro_id;
            when 'area' then update public.maquinas set area_id = (select id from public.areas where nombre = v_antes),
                               modulo_id = coalesce((select modulo_id from public.areas where nombre = v_antes), modulo_id)
                              where id = f.registro_id;
            else null;
          end case;
        end loop;
      end if;
      n_revertidos := n_revertidos + 1;
    end if;
  end loop;

  update public.importaciones set estado = 'anulada', anulada_por = auth.uid(), anulada_en = now(),
    motivo_anulacion = btrim(p_motivo),
    resultado_anulacion = jsonb_build_object('borrados', n_borrados, 'revertidos', n_revertidos, 'conservados', v_conservados)
  where id = imp.id;
  insert into public.auditoria (tabla, registro_id, accion, antes, despues, motivo, usuario_id)
  values ('importaciones', imp.id::text, 'deshacer', to_jsonb(imp), null, btrim(p_motivo), auth.uid());

  return jsonb_build_object('borrados', n_borrados, 'revertidos', n_revertidos, 'conservados', v_conservados);
end $$;

revoke execute on function public.admin_deshacer_importacion(uuid, text) from public, anon;
grant execute on function public.admin_deshacer_importacion(uuid, text) to authenticated;
