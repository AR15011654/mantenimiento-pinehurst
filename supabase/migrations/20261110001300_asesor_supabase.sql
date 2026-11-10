-- Migración 13: correcciones del Asesor de Supabase (seguridad y rendimiento). Sin cambios de datos.

-- 1) Funciones auxiliares con search_path fijo (aviso "Function Search Path Mutable").
alter function public.codigo_generico(text) set search_path = public, pg_temp;
alter function public.codigo_sin_ceros(text) set search_path = public, pg_temp;
alter function public.fallar(text,text) set search_path = public, pg_temp;
alter function public.leer_fecha(text) set search_path = public, pg_temp;
alter function public.normalizar(text) set search_path = public, pg_temp;
alter function public.semana_appsheet(timestamp with time zone) set search_path = public, pg_temp;
alter function public.texto(jsonb,text) set search_path = public, pg_temp;
alter function public.tg_actualizado_en() set search_path = public, pg_temp;

-- 2) Políticas: auth.uid() evaluado una vez por consulta, no por fila (aviso "auth_rls_initplan").
drop policy if exists leer on public.usuarios;
create policy leer on public.usuarios for select to authenticated using (id = (select auth.uid()) or public.es_admin());
drop policy if exists leer on public.usuario_alcance;
create policy leer on public.usuario_alcance for select to authenticated using (usuario_id = (select auth.uid()) or public.es_admin());

-- 3) Índices para llaves foráneas sin índice (sugerencia "Unindexed foreign keys").
create index if not exists ix_maquina_ubicacion_historial_area_id on public.maquina_ubicacion_historial (area_id);
create index if not exists ix_mantenimiento_fotos_mantenimiento_id on public.mantenimiento_fotos (mantenimiento_id);
create index if not exists ix_validaciones_mantenimiento_id on public.validaciones (mantenimiento_id);
create index if not exists ix_paros_maquina_maquina_id on public.paros_maquina (maquina_id);
create index if not exists ix_paros_maquina_mantenimiento_id on public.paros_maquina (mantenimiento_id);
create index if not exists ix_ubicaciones_area_id on public.ubicaciones (area_id);
create index if not exists ix_tipos_maquina_modulo_id on public.tipos_maquina (modulo_id);
create index if not exists ix_maquinas_tipo_id on public.maquinas (tipo_id);
create index if not exists ix_maquinas_grupo_id on public.maquinas (grupo_id);
create index if not exists ix_maquinas_fabricante_id on public.maquinas (fabricante_id);
create index if not exists ix_maquina_ubicacion_historial_ubicacion_id on public.maquina_ubicacion_historial (ubicacion_id);
create index if not exists ix_maquina_ubicacion_historial_modulo_id on public.maquina_ubicacion_historial (modulo_id);
create index if not exists ix_empleado_areas_area_id on public.empleado_areas (area_id);
create index if not exists ix_usuario_alcance_modulo_id on public.usuario_alcance (modulo_id);
create index if not exists ix_usuario_alcance_area_id on public.usuario_alcance (area_id);
create index if not exists ix_planes_preventivos_tipo_id on public.planes_preventivos (tipo_id);
create index if not exists ix_planes_preventivos_maquina_id on public.planes_preventivos (maquina_id);
create index if not exists ix_planes_preventivos_area_id on public.planes_preventivos (area_id);
create index if not exists ix_plan_actividades_plan_id on public.plan_actividades (plan_id);
create index if not exists ix_programaciones_maquina_id on public.programaciones (maquina_id);
create index if not exists ix_programaciones_responsable_id on public.programaciones (responsable_id);
create index if not exists ix_mantenimientos_programacion_id on public.mantenimientos (programacion_id);
create index if not exists ix_mantenimientos_ubicacion_id on public.mantenimientos (ubicacion_id);
create index if not exists ix_mantenimiento_actividades_mantenimiento_id on public.mantenimiento_actividades (mantenimiento_id);
create index if not exists ix_mantenimiento_actividades_plan_actividad_id on public.mantenimiento_actividades (plan_actividad_id);
create index if not exists ix_inventarios_origen_area_id on public.inventarios_origen (area_id);
create index if not exists ix_consumos_repuestos_mantenimiento_id on public.consumos_repuestos (mantenimiento_id);
create index if not exists ix_consumos_repuestos_maquina_id on public.consumos_repuestos (maquina_id);
create index if not exists ix_consumos_repuestos_modulo_id on public.consumos_repuestos (modulo_id);
create index if not exists ix_consumos_repuestos_area_id on public.consumos_repuestos (area_id);
create index if not exists ix_consumos_repuestos_inventario_origen_id on public.consumos_repuestos (inventario_origen_id);
create index if not exists ix_consumos_repuestos_consumo_relacionado_id on public.consumos_repuestos (consumo_relacionado_id);
create index if not exists ix_consumo_movimientos_consumo_id on public.consumo_movimientos (consumo_id);
create index if not exists ix_maquinas_frecuencia on public.maquinas (frecuencia);
create index if not exists ix_inv_movimientos_empleado_id on public.inv_movimientos (empleado_id);
