-- =====================================================================
-- Migración 5: permisos (GRANT), políticas RLS, Storage y datos base.
-- El proyecto se creó con "exponer tablas automáticamente" desactivado:
-- aquí se concede explícitamente solo lo necesario. anon no recibe nada.
-- =====================================================================

-- Quitar cualquier privilegio por defecto y conceder lo mínimo.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Lectura (las filas visibles las filtra RLS)
grant select on public.modulos, public.areas, public.ubicaciones, public.tipos_maquina, public.grupos_maquina, public.fabricantes,
  public.maquinas, public.maquina_ubicacion_historial, public.empleados, public.empleado_areas,
  public.usuarios, public.usuario_alcance,
  public.mantenimientos, public.mantenimiento_periodos, public.mantenimiento_eventos, public.mantenimiento_comentarios,
  public.mantenimiento_actividades, public.mantenimiento_fotos, public.validaciones, public.paros_maquina,
  public.planes_preventivos, public.plan_actividades, public.programaciones,
  public.importaciones, public.importacion_filas, public.auditoria,
  public.inventarios_origen, public.consumos_repuestos, public.consumo_movimientos, public.cola_integracion
  to authenticated;
grant select on public.v_maquinas to authenticated;

-- Escritura directa solo en catálogos/maestros (RLS la limita al administrador).
grant insert, update on public.modulos, public.areas, public.ubicaciones, public.tipos_maquina, public.grupos_maquina,
  public.fabricantes, public.empleados, public.planes_preventivos, public.plan_actividades to authenticated;
grant update (condicion_operativa, es_critica, modelo, serie, qr, puesto, operacion, estilo, observacion, activo,
              tipo_id, grupo_id, fabricante_id, ubicacion_id) on public.maquinas to authenticated;
grant insert, delete on public.empleado_areas to authenticated;

-- Funciones que puede llamar un usuario con sesión (cada una valida permisos por dentro).
grant execute on function
  public.normalizar(text), public.codigo_sin_ceros(text), public.semana_appsheet(timestamptz),
  public.usuario_activo(), public.es_admin(), public.perfil_actual(), public.mi_empleado_id(),
  public.tiene_acceso(uuid, uuid), public.puede_ver_mantenimiento(uuid), public.puede_trabajar_mantenimiento(uuid),
  public.mi_sesion(), public.buscar_por_codigo(text), public.buscar_mecanico(text, uuid),
  public.iniciar_mantenimiento(uuid, text, text, text, uuid, uuid), public.agregar_comentario(uuid, text, uuid),
  public.registrar_foto(uuid, text, bigint, text), public.finalizar_mantenimiento(uuid, uuid),
  public.reanudar_mantenimiento(uuid), public.validar_mantenimiento(uuid, text, text),
  public.cancelar_mantenimiento(uuid, text), public.reabrir_mantenimiento(uuid, text),
  public.admin_guardar_usuario(uuid, text, text, uuid, boolean, jsonb), public.admin_activar_usuario(uuid, boolean, text),
  public.admin_listar_usuarios(), public.admin_clasificar_maquinas(uuid[], uuid, uuid, text),
  public.admin_regla_ubicacion(uuid, uuid, text, boolean), public.admin_regla_tipo(uuid, uuid, boolean),
  public.admin_marcar_revisada(uuid[], text), public.admin_habilitar_mecanicos_por_cargo(text[], boolean),
  public.importar_maquinas(jsonb, text, text, text, jsonb, text[], jsonb, boolean),
  public.importar_personal(jsonb, text, text, text, jsonb, text[], jsonb, boolean),
  public.nombres_usuarios(uuid[])
to authenticated;
-- Las funciones de uso interno quedan sin permiso para el navegador:
-- bootstrap_admin, recalcular_tiempos, catalogo_id, tg_*, fallar, exigir_*, resumen_mantenimiento, regla_clasificacion.

-- ---------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------
-- Catálogos: lectura para usuarios activos; escritura solo admin.
do $$
declare t text;
begin
  foreach t in array array['modulos','areas','ubicaciones','tipos_maquina','grupos_maquina','fabricantes'] loop
    execute format('create policy leer_activos on public.%I for select to authenticated using (public.usuario_activo())', t);
    execute format('create policy admin_insertar on public.%I for insert to authenticated with check (public.es_admin())', t);
    execute format('create policy admin_actualizar on public.%I for update to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

-- Maquinaria: admin todo; los demás, las de sus módulos/áreas.
create policy leer_por_alcance on public.maquinas for select to authenticated
  using (public.tiene_acceso(modulo_id, area_id));
create policy admin_actualizar on public.maquinas for update to authenticated
  using (public.es_admin()) with check (public.es_admin());
create policy leer_por_alcance on public.maquina_ubicacion_historial for select to authenticated
  using (exists (select 1 from public.maquinas m where m.id = maquina_id));

-- Personal: admin y supervisores ven el catálogo; técnico solo su propio registro.
create policy leer on public.empleados for select to authenticated
  using (public.es_admin() or public.perfil_actual() = 'supervisor' or id = public.mi_empleado_id());
create policy admin_insertar on public.empleados for insert to authenticated with check (public.es_admin());
create policy admin_actualizar on public.empleados for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy leer on public.empleado_areas for select to authenticated
  using (public.es_admin() or public.perfil_actual() = 'supervisor' or empleado_id = public.mi_empleado_id());
create policy admin_insertar on public.empleado_areas for insert to authenticated with check (public.es_admin());
create policy admin_borrar on public.empleado_areas for delete to authenticated using (public.es_admin());

-- Cuentas: cada quien ve la suya; admin todas. Sin políticas de escritura (solo RPC de admin).
create policy leer on public.usuarios for select to authenticated using (id = auth.uid() or public.es_admin());
create policy leer on public.usuario_alcance for select to authenticated using (usuario_id = auth.uid() or public.es_admin());

-- Mantenimientos y detalle: solo lectura; escritura por RPC.
create policy leer on public.mantenimientos for select to authenticated using (public.puede_ver_mantenimiento(id));
do $$
declare t text;
begin
  foreach t in array array['mantenimiento_periodos','mantenimiento_eventos','mantenimiento_comentarios',
                           'mantenimiento_actividades','mantenimiento_fotos','validaciones'] loop
    execute format('create policy leer on public.%I for select to authenticated using (public.puede_ver_mantenimiento(mantenimiento_id))', t);
  end loop;
end $$;
create policy leer on public.paros_maquina for select to authenticated
  using (exists (select 1 from public.maquinas m where m.id = maquina_id));

-- Preventivo (Etapa 3): lectura para usuarios activos; escritura admin.
create policy leer on public.planes_preventivos for select to authenticated using (public.usuario_activo());
create policy admin_insertar on public.planes_preventivos for insert to authenticated with check (public.es_admin());
create policy admin_actualizar on public.planes_preventivos for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy leer on public.plan_actividades for select to authenticated using (public.usuario_activo());
create policy admin_insertar on public.plan_actividades for insert to authenticated with check (public.es_admin());
create policy admin_actualizar on public.plan_actividades for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy leer on public.programaciones for select to authenticated
  using (exists (select 1 from public.maquinas m where m.id = maquina_id));

-- Importación, auditoría e integración: solo admin.
do $$
declare t text;
begin
  foreach t in array array['importaciones','importacion_filas','auditoria','inventarios_origen',
                           'consumos_repuestos','consumo_movimientos','cola_integracion'] loop
    execute format('create policy solo_admin on public.%I for select to authenticated using (public.es_admin())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Storage: fotos privadas en mant-evidencias/{mantenimiento_id}/archivo
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mant-evidencias', 'mant-evidencias', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy mant_fotos_leer on storage.objects for select to authenticated
  using (bucket_id = 'mant-evidencias'
         and public.puede_ver_mantenimiento(((storage.foldername(name))[1])::uuid));
create policy mant_fotos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'mant-evidencias'
              and public.puede_trabajar_mantenimiento(((storage.foldername(name))[1])::uuid)
              and exists (select 1 from public.mantenimientos m where m.id = ((storage.foldername(name))[1])::uuid and m.estado = 'en_proceso'));
-- Sin políticas de update/delete: las fotos no se reemplazan ni se borran desde la app.

-- ---------------------------------------------------------------------
-- Datos base definidos por Pinehurst (módulos y áreas) y regla confirmada de calderas
-- ---------------------------------------------------------------------
insert into public.modulos (codigo, nombre, orden) values
  ('COSTURA_PD', 'Costura y PD', 1),
  ('SERIGRAFIA_BORDADO_SUBLIMADO', 'Serigrafía, Bordado y Sublimado', 2),
  ('CORTE_BODEGA_STAGING', 'Corte, Bodega de Telas y Staging', 3);

insert into public.areas (modulo_id, codigo, nombre)
select m.id, a.codigo, a.nombre from (values
  ('COSTURA_PD', 'COSTURA', 'Costura'),
  ('COSTURA_PD', 'PD', 'PD'),
  ('SERIGRAFIA_BORDADO_SUBLIMADO', 'SERIGRAFIA', 'Serigrafía'),
  ('SERIGRAFIA_BORDADO_SUBLIMADO', 'BORDADO', 'Bordado'),
  ('SERIGRAFIA_BORDADO_SUBLIMADO', 'SUBLIMADO', 'Sublimado'),
  ('CORTE_BODEGA_STAGING', 'CORTE', 'Corte'),
  ('CORTE_BODEGA_STAGING', 'BODEGA_TELAS', 'Bodega de Telas'),
  ('CORTE_BODEGA_STAGING', 'STAGING', 'Staging')
) as a(modulo, codigo, nombre) join public.modulos m on m.codigo = a.modulo;

-- Confirmado por el usuario el 2026-11-01: las calderas pertenecen al módulo Costura y PD.
insert into public.tipos_maquina (nombre, modulo_id)
select 'STEAM BOILER', id from public.modulos where codigo = 'COSTURA_PD';
