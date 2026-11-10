-- =====================================================================
-- Migración 9: servicio externo en el mantenimiento.
-- Si el trabajo lo hizo (o apoyó) un proveedor externo se registra:
-- proveedor, costo con su moneda y la cotización o factura (foto o archivo).
-- =====================================================================

create table public.mantenimiento_servicio_externo (
  mantenimiento_id uuid primary key references public.mantenimientos(id),
  proveedor text not null check (length(btrim(proveedor)) > 0),
  costo numeric(14,2) not null check (costo >= 0),
  moneda text not null default 'USD' check (moneda in ('USD', 'HNL')),
  registrado_por uuid not null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.mantenimiento_documentos (
  id uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references public.mantenimientos(id),
  tipo text not null default 'cotizacion_factura' check (tipo in ('cotizacion_factura')),
  ruta text not null unique,            -- mant-evidencias/{mantenimiento_id}/docs/{archivo}
  nombre_original text,
  tipo_mime text,
  tamano_bytes bigint,
  usuario_id uuid not null,
  creado_en timestamptz not null default now()
);
create index on public.mantenimiento_documentos (mantenimiento_id);

alter table public.mantenimiento_servicio_externo enable row level security;
alter table public.mantenimiento_documentos enable row level security;
grant select on public.mantenimiento_servicio_externo, public.mantenimiento_documentos to authenticated;
create policy leer on public.mantenimiento_servicio_externo for select to authenticated using (public.puede_ver_mantenimiento(mantenimiento_id));
create policy leer on public.mantenimiento_documentos for select to authenticated using (public.puede_ver_mantenimiento(mantenimiento_id));

create trigger mantenimiento_servicio_externo_auditoria after insert or update or delete on public.mantenimiento_servicio_externo
  for each row execute function public.tg_auditar();

-- Guarda (o corrige) el servicio externo de un trabajo en proceso. Repetir la llamada no duplica.
create or replace function public.registrar_servicio_externo(p_mantenimiento_id uuid, p_proveedor text, p_costo numeric, p_moneda text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; v_estado text;
begin
  u := public.exigir_usuario();
  if not public.puede_trabajar_mantenimiento(p_mantenimiento_id) then perform public.fallar('sin_acceso', 'No puede registrar en este trabajo.'); end if;
  select estado into v_estado from public.mantenimientos where id = p_mantenimiento_id;
  if v_estado <> 'en_proceso' then perform public.fallar('estado', 'Solo se puede registrar el servicio externo en un trabajo en proceso.'); end if;
  if length(btrim(coalesce(p_proveedor, ''))) = 0 then perform public.fallar('proveedor', 'Escriba el nombre del proveedor.'); end if;
  if p_costo is null or p_costo < 0 then perform public.fallar('costo', 'Escriba el costo del servicio (0 o mayor).'); end if;
  if coalesce(p_moneda, '') not in ('USD', 'HNL') then perform public.fallar('moneda', 'Moneda no válida.'); end if;
  insert into public.mantenimiento_servicio_externo (mantenimiento_id, proveedor, costo, moneda, registrado_por)
  values (p_mantenimiento_id, btrim(p_proveedor), round(p_costo, 2), p_moneda, u.id)
  on conflict (mantenimiento_id) do update set proveedor = excluded.proveedor, costo = excluded.costo, moneda = excluded.moneda,
    registrado_por = excluded.registrado_por, actualizado_en = now();
  insert into public.mantenimiento_eventos (mantenimiento_id, evento, usuario_id, datos)
    values (p_mantenimiento_id, 'servicio_externo', u.id, jsonb_build_object('proveedor', btrim(p_proveedor), 'costo', round(p_costo, 2), 'moneda', p_moneda));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.registrar_documento(p_mantenimiento_id uuid, p_ruta text, p_nombre text, p_mime text, p_tamano bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; v_estado text; v_id uuid;
begin
  u := public.exigir_usuario();
  if not public.puede_trabajar_mantenimiento(p_mantenimiento_id) then perform public.fallar('sin_acceso', 'No puede registrar en este trabajo.'); end if;
  select estado into v_estado from public.mantenimientos where id = p_mantenimiento_id;
  if v_estado <> 'en_proceso' then perform public.fallar('estado', 'Solo se pueden agregar documentos a trabajos en proceso.'); end if;
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

revoke execute on function public.registrar_servicio_externo(uuid, text, numeric, text), public.registrar_documento(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.registrar_servicio_externo(uuid, text, numeric, text), public.registrar_documento(uuid, text, text, text, bigint) to authenticated;

-- El bucket privado ahora acepta PDF (cotizaciones y facturas digitales), hasta 10 MB por archivo.
update storage.buckets set allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'], file_size_limit = 10485760
 where id = 'mant-evidencias';
