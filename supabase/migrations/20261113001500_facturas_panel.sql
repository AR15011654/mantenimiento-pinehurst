-- Migración 15: facturas de trabajos finalizados (PDF, Excel o imagen) desde el panel de Mantenimiento.
-- El gerente o administrador puede registrar el costo y adjuntar la factura después de cerrar el trabajo.

-- 1) El bucket privado acepta también Excel (.xlsx y .xls), hasta 10 MB.
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel'],
       file_size_limit = 10485760
 where id = 'mant-evidencias';

-- 2) Subir facturas a trabajos ya finalizados: solo gerente/administrador y solo en la carpeta docs/ del trabajo.
drop policy if exists mant_docs_subir_gestion on storage.objects;
create policy mant_docs_subir_gestion on storage.objects for insert to authenticated
  with check (bucket_id = 'mant-evidencias'
              and (storage.foldername(name))[2] = 'docs'
              and public.ve_precios()
              and public.puede_trabajar_mantenimiento(((storage.foldername(name))[1])::uuid)
              and exists (select 1 from public.mantenimientos m where m.id = ((storage.foldername(name))[1])::uuid
                            and m.estado in ('en_proceso', 'pendiente_validacion', 'completado')));

-- 3) Registrar el documento (mismo control de estado que el costo del servicio externo).
create or replace function public.registrar_documento(p_mantenimiento_id uuid, p_ruta text, p_nombre text, p_mime text, p_tamano bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; v_estado text; v_id uuid;
begin
  u := public.exigir_usuario();
  if not public.puede_trabajar_mantenimiento(p_mantenimiento_id) then perform public.fallar('sin_acceso', 'No puede registrar en este trabajo.'); end if;
  select estado into v_estado from public.mantenimientos where id = p_mantenimiento_id;
  -- Técnico: solo en proceso. Gerente/administrador: también en trabajos ya finalizados (factura que llega después).
  if not (v_estado = 'en_proceso' or (public.ve_precios() and v_estado in ('pendiente_validacion', 'completado'))) then
    perform public.fallar('estado', 'Solo se pueden agregar documentos a trabajos en proceso.');
  end if;
  if p_mime is null or p_mime not in ('image/jpeg','image/png','image/webp','application/pdf',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel') then
    perform public.fallar('tipo_archivo', 'Solo se aceptan fotos, PDF o Excel.');
  end if;
  if p_ruta is null or split_part(p_ruta, '/', 1) <> p_mantenimiento_id::text or split_part(p_ruta, '/', 2) <> 'docs' then
    perform public.fallar('ruta', 'Ruta de documento no válida.');
  end if;
  insert into public.mantenimiento_documentos (mantenimiento_id, ruta, nombre_original, tipo_mime, tamano_bytes, usuario_id)
    values (p_mantenimiento_id, p_ruta, left(p_nombre, 200), p_mime, p_tamano, u.id)
    on conflict (ruta) do update set ruta = excluded.ruta returning id into v_id;
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, usuario_id, datos)
    values (p_mantenimiento_id, 'documento', u.id, jsonb_build_object('documento_id', v_id, 'nombre', left(p_nombre, 200)));
  return jsonb_build_object('id', v_id);
end $$;
