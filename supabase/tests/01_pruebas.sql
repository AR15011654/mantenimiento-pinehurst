-- Pruebas locales (requiere 00_stub_supabase.sql y las migraciones).
-- maq.json y per.json se generan a partir de los Excel (contienen datos del personal: NO se suben al repositorio).
\set maq `cat tests/datos/maq.json`
\set per `cat tests/datos/per.json`
\set ON_ERROR_STOP 0
\pset pager off
\set QUIET 1
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@pinehurstmfg.com'),
 ('00000000-0000-0000-0000-0000000000b1','super.seri@pinehurstmfg.com'),
 ('00000000-0000-0000-0000-0000000000c1','tec.seri@pinehurstmfg.com'),
 ('00000000-0000-0000-0000-0000000000c2','tec.costura@pinehurstmfg.com'),
 ('00000000-0000-0000-0000-0000000000d1','intruso@gmail.com');

\echo '--- P1 bootstrap: anon/authenticated no pueden ejecutarlo'
set role authenticated; select public.bootstrap_admin('admin@pinehurstmfg.com'); reset role;
\echo '--- P1b bootstrap desde rol dueño'
select public.bootstrap_admin('admin@pinehurstmfg.com');
select public.bootstrap_admin('admin@pinehurstmfg.com');

create or replace function pg_temp.como(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;

\echo '--- P2 importación maquinaria (vista previa y aplicar) como admin'
select pg_temp.como('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select r->'resumen' as vista_previa from (select public.importar_maquinas(:'maq'::jsonb,'INVENTARIO MAQUINAS.xlsx','MAQUINAS','hash1','{}'::jsonb,'{}','{}',false) r) x;
select count(*) as maquinas_tras_vista_previa from public.maquinas;
select r->'resumen' as aplicada from (select public.importar_maquinas(:'maq'::jsonb,'INVENTARIO MAQUINAS.xlsx','MAQUINAS','hash1','{}'::jsonb,'{}','{}',true) r) x;
select r->'resumen' as repetida, r->'archivo_repetido' as archivo_repetido from (select public.importar_maquinas(:'maq'::jsonb,'INVENTARIO MAQUINAS.xlsx','MAQUINAS','hash1','{}'::jsonb,'{}','{}',false) r) x;
select count(*) total, count(*) filter (where requiere_revision) en_revision, count(*) filter (where modulo_id is null) sin_clasificar from public.maquinas;
select x->>'fila' fila, x->>'clave' clave, x->'mensajes' msg from jsonb_array_elements((select public.importar_maquinas(:'maq'::jsonb,'a','MAQUINAS',null,'{}'::jsonb,'{}','{}',false))->'filas') x where x->>'resultado' in ('revision','error') and not (x->>'aplicable')::boolean limit 12;
\echo '--- P2b serie/QR como texto con ceros: ejemplo'
select asset_id, qr, serie from public.maquinas where serie like '0%' limit 3;
\echo '--- P2c calderas en Costura y PD por regla de tipo'
select mo.nombre, count(*) from public.maquinas m join public.tipos_maquina t on t.id=m.tipo_id left join public.modulos mo on mo.id=m.modulo_id where t.nombre_norm='STEAM BOILER' group by 1;
reset role;

\echo '--- P3 personal'
select pg_temp.como('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
select r->'resumen' from (select public.importar_personal(:'per'::jsonb,'personal.xlsx','personal','h2','{}'::jsonb,'{}','{}',true) r) x;
select r->'resumen' as repetida from (select public.importar_personal(:'per'::jsonb,'personal.xlsx','personal','h2','{}'::jsonb,'{}','{}',false) r) x;
select codigo, codigo_sin_ceros, nombre from public.empleados where codigo='012745';
select public.admin_habilitar_mecanicos_por_cargo(array['Mecánico','Técnico(a)','Tecnico Certificado','Mecanico Jr.'], true) as mecanicos_habilitados;

\echo '--- P4 reglas de ubicación: SERIGRAFIA -> Serigrafía, LINE 11 -> Costura'
select public.admin_regla_ubicacion((select id from public.ubicaciones where nombre_norm='SERIGRAFIA'), (select id from public.areas where codigo='SERIGRAFIA'), 'area', true) as aplicadas_seri;
select public.admin_regla_ubicacion((select id from public.ubicaciones where nombre_norm='LINE 11'), (select id from public.areas where codigo='COSTURA'), 'linea', true) as aplicadas_l11;

\echo '--- P5 usuarios y alcance'
select public.admin_guardar_usuario('00000000-0000-0000-0000-0000000000b1','supervisor','Supervisor Seri',null,false,
  jsonb_build_array(jsonb_build_object('modulo_id',(select id from public.modulos where codigo='SERIGRAFIA_BORDADO_SUBLIMADO'),'area_id',(select id from public.areas where codigo='SERIGRAFIA'))));
select public.admin_guardar_usuario('00000000-0000-0000-0000-0000000000c1','tecnico','Técnico Seri',(select id from public.empleados where codigo='012745'),false,
  jsonb_build_array(jsonb_build_object('modulo_id',(select id from public.modulos where codigo='SERIGRAFIA_BORDADO_SUBLIMADO'),'area_id',(select id from public.areas where codigo='SERIGRAFIA'))));
insert into public.empleado_areas values ((select id from public.empleados where codigo='012745'), (select id from public.areas where codigo='SERIGRAFIA'));
\echo '--- P5b el admin no puede quitarse el perfil siendo el único'
select public.admin_guardar_usuario('00000000-0000-0000-0000-0000000000a1','tecnico',null,null,false,'[]');
reset role;

\echo '--- P6 intruso (cuenta sin registro en usuarios) no ve nada'
select pg_temp.como('00000000-0000-0000-0000-0000000000d1'); set role authenticated;
select (select count(*) from public.maquinas) maq, (select count(*) from public.empleados) emp, (select count(*) from public.modulos) mods, public.mi_sesion();
select public.importar_maquinas('[]','x','x',null,'{}'::jsonb,'{}','{}',false);
reset role;

\echo '--- P7 técnico de Serigrafía'
select pg_temp.como('00000000-0000-0000-0000-0000000000c1'); set role authenticated;
select count(*) as maquinas_visibles, count(distinct area_id) areas from public.maquinas;
select count(*) as empleados_visibles from public.empleados;
\echo 'intento de elevar privilegios (debe fallar)'
update public.usuarios set perfil='admin' where id=auth.uid();
insert into public.usuario_alcance (usuario_id, modulo_id) select auth.uid(), id from public.modulos;
select public.admin_guardar_usuario(auth.uid(),'admin',null,null,false,'[]');
insert into public.mantenimientos (tipo, estado, maquina_id, creado_por) select 'correctivo','completado', id, auth.uid() from public.maquinas limit 1;
update public.maquinas set es_critica = true;
\echo 'buscar por QR del ejemplo de AppSheet (tgdgtgi7)'
select asset_id, tipo, area from public.buscar_por_codigo('TGDGTGI7');
select public.buscar_mecanico('12745', (select id from public.maquinas where qr='tgdgtgi7'));
\echo 'iniciar (con clave repetida devuelve el mismo)'
select public.iniciar_mantenimiento((select id from public.maquinas where qr='tgdgtgi7'),'preventivo','12745','tgdgtgi7','11111111-1111-1111-1111-111111111111');
select public.iniciar_mantenimiento((select id from public.maquinas where qr='tgdgtgi7'),'preventivo','12745','tgdgtgi7','11111111-1111-1111-1111-111111111111');
select public.iniciar_mantenimiento((select id from public.maquinas where qr='tgdgtgi7'),'preventivo','12745','tgdgtgi7','11111111-1111-1111-1111-111111111112');
\echo 'otro mecánico (no permitido para técnico)'
select public.iniciar_mantenimiento((select id from public.maquinas where qr='tgdgtgi7'),'correctivo','000018','x','11111111-1111-1111-1111-111111111113');
\echo 'máquina de otra área'
select public.iniciar_mantenimiento((select id from public.maquinas where asset_id='http://gkd.bz/23RGQB6M'),'correctivo','12745','x','11111111-1111-1111-1111-111111111114');
select public.agregar_comentario((select id from public.mantenimientos where folio=1),'Limpieza de resistencias','22222222-2222-2222-2222-222222222221');
select public.agregar_comentario((select id from public.mantenimientos where folio=1),'Limpieza de resistencias','22222222-2222-2222-2222-222222222221');
select estado from public.mantenimientos where folio=1;
select public.finalizar_mantenimiento((select id from public.mantenimientos where folio=1),'33333333-3333-3333-3333-333333333331');
select public.finalizar_mantenimiento((select id from public.mantenimientos where folio=1),'33333333-3333-3333-3333-333333333331');
select public.finalizar_mantenimiento((select id from public.mantenimientos where folio=1),'33333333-3333-3333-3333-333333333332');
\echo 'técnico no puede validar'
select public.validar_mantenimiento((select id from public.mantenimientos where folio=1),'aprobado',null);
reset role;

\echo '--- P8 supervisor devuelve, técnico reanuda y finaliza, supervisor aprueba'
select pg_temp.como('00000000-0000-0000-0000-0000000000b1'); set role authenticated;
select public.validar_mantenimiento((select id from public.mantenimientos where folio=1),'devuelto','');
select public.validar_mantenimiento((select id from public.mantenimientos where folio=1),'devuelto','Falta foto de la resistencia');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000c1'); set role authenticated;
select public.finalizar_mantenimiento((select id from public.mantenimientos where folio=1),'33333333-3333-3333-3333-333333333339');
select public.reanudar_mantenimiento((select id from public.mantenimientos where folio=1));
select public.finalizar_mantenimiento((select id from public.mantenimientos where folio=1),'33333333-3333-3333-3333-33333333333a');
reset role;
select pg_temp.como('00000000-0000-0000-0000-0000000000b1'); set role authenticated;
select public.validar_mantenimiento((select id from public.mantenimientos where folio=1),'aprobado','OK');
select folio, estado, snap_maquina, snap_area, snap_mecanico_nombre, duracion_min is not null dur, semana, anio, mes from public.mantenimientos;
select evento, estado_anterior, estado_nuevo, motivo from public.mantenimiento_eventos order by id;
select count(*) periodos from public.mantenimiento_periodos;
\echo 'supervisor no puede cancelar un completado'
select public.cancelar_mantenimiento((select id from public.mantenimientos where folio=1),'x');
reset role;

\echo '--- P9 cambiar ubicación de la máquina no altera el historial del mantenimiento'
select pg_temp.como('00000000-0000-0000-0000-0000000000a1'); set role authenticated;
update public.maquinas set ubicacion_id = (select id from public.ubicaciones where nombre_norm='BODEGA DE MAQUINAS') where qr='tgdgtgi7';
select m.area_id is null as area_nula, m.requiere_revision, m.motivo_revision from public.maquinas m where qr='tgdgtgi7';
select snap_area, snap_ubicacion, area_id is not null from public.mantenimientos where folio=1;
select count(*) as filas_historial_ubicacion from public.maquina_ubicacion_historial h join public.maquinas m on m.id=h.maquina_id where m.qr='tgdgtgi7';
reset role;

\echo '--- P10 semana estilo AppSheet'
select public.semana_appsheet('2026-01-01 10:00-06'), public.semana_appsheet('2026-01-04 10:00-06'), public.semana_appsheet('2026-11-01 23:30-06'), public.semana_appsheet('2026-11-02 05:00+00') as cruce_medianoche_utc;

\echo '--- P11 anon no tiene acceso'
set role anon; select count(*) from public.maquinas; select public.mi_sesion(); reset role;
