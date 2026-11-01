-- =====================================================================
-- Sistema de Mantenimiento Pinehurst · Migración 1: estructura
-- Proyecto Supabase exclusivo (mantenimiento-pinehurst). Esquema public.
-- Todas las fechas/horas son timestamptz y se muestran en America/Tegucigalpa.
-- =====================================================================

create extension if not exists pgcrypto;

-- Normaliza texto de catálogos: sin espacios dobles, sin espacios en extremos, MAYÚSCULAS.
create or replace function public.normalizar(t text)
returns text language sql immutable parallel safe as $$
  select nullif(upper(regexp_replace(btrim(coalesce(t, '')), '\s+', ' ', 'g')), '')
$$;

-- Código de empleado sin ceros iniciales (AppSheet guarda 12745 y el Excel 012745).
create or replace function public.codigo_sin_ceros(t text)
returns text language sql immutable parallel safe as $$
  select nullif(ltrim(btrim(coalesce(t, '')), '0'), '')
$$;

-- Semana estilo WEEKNUM de AppSheet/Excel (tipo 1): inicia domingo; la semana 1 contiene el 1 de enero.
create or replace function public.semana_appsheet(ts timestamptz)
returns int language sql immutable parallel safe as $$
  select ((extract(doy from (ts at time zone 'America/Tegucigalpa'))::int - 1
          + extract(dow from date_trunc('year', ts at time zone 'America/Tegucigalpa'))::int) / 7) + 1
$$;

-- ---------------------------------------------------------------------
-- Organización
-- ---------------------------------------------------------------------
create table public.modulos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  orden int not null default 0,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  modulo_id uuid not null references public.modulos(id),
  codigo text not null unique,
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
create index on public.areas(modulo_id);

-- ---------------------------------------------------------------------
-- Catálogos (los nombres originales se conservan; la unicidad usa el nombre normalizado)
-- ---------------------------------------------------------------------
create table public.ubicaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,                          -- como se muestra
  nombre_norm text generated always as (public.normalizar(nombre)) stored unique,
  tipo text not null default 'otra' check (tipo in ('linea','bodega','area','otra')),
  area_id uuid references public.areas(id),     -- regla de clasificación (opcional)
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.tipos_maquina (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nombre_norm text generated always as (public.normalizar(nombre)) stored unique,
  modulo_id uuid references public.modulos(id), -- regla por tipo (ej. STEAM BOILER -> Costura y PD); tiene prioridad sobre la ubicación
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.grupos_maquina (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nombre_norm text generated always as (public.normalizar(nombre)) stored unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table public.fabricantes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nombre_norm text generated always as (public.normalizar(nombre)) stored unique,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Maquinaria
-- ---------------------------------------------------------------------
create table public.maquinas (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null unique check (asset_id = btrim(asset_id) and asset_id <> ''),
  qr text,
  serie text,
  modelo text,
  tipo_id uuid references public.tipos_maquina(id),
  grupo_id uuid references public.grupos_maquina(id),
  fabricante_id uuid references public.fabricantes(id),
  ubicacion_id uuid references public.ubicaciones(id),
  puesto text,                                   -- STATION: posición en línea o rack
  modulo_id uuid references public.modulos(id),
  area_id uuid references public.areas(id),
  estado_inventario text,                        -- ACTIVO / INACTIVO / DESCARTADO (del Excel)
  condicion_operativa text not null default 'operativa'
    check (condicion_operativa in ('operativa','en_reparacion','fuera_de_servicio')),
  es_critica boolean not null default false,
  fecha_compra_registro date,
  actualizado_origen timestamptz,                -- ACTUALIZADO POR ULTIMA VEZ (Excel)
  operacion text, estilo text, observacion text, -- notas libres del Excel
  campos_origen_numerico text[] not null default '{}', -- columnas que venían como número en Excel
  requiere_revision boolean not null default false,
  motivo_revision text,
  origen_importacion_id uuid,
  origen_archivo text, origen_hoja text, origen_fila int,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index on public.maquinas (public.normalizar(qr));
create index on public.maquinas (public.normalizar(serie));
create index on public.maquinas (area_id);
create index on public.maquinas (modulo_id);
create index on public.maquinas (ubicacion_id);

create table public.maquina_ubicacion_historial (
  id bigint generated always as identity primary key,
  maquina_id uuid not null references public.maquinas(id),
  desde timestamptz not null default now(),
  hasta timestamptz,
  ubicacion_id uuid references public.ubicaciones(id),
  puesto text,
  modulo_id uuid references public.modulos(id),
  area_id uuid references public.areas(id),
  origen text not null default 'manual',         -- manual / importacion / regla
  motivo text,
  usuario_id uuid
);
create index on public.maquina_ubicacion_historial (maquina_id, desde desc);

-- ---------------------------------------------------------------------
-- Personal (catálogo) — separado de las cuentas de acceso
-- ---------------------------------------------------------------------
create table public.empleados (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo = btrim(codigo) and codigo <> ''),
  codigo_sin_ceros text generated always as (public.codigo_sin_ceros(codigo)) stored,
  nombre text not null,                          -- normalizado (espacios simples)
  nombre_original text,
  cargo text,
  especialidad text,
  es_mecanico boolean not null default false,    -- habilitado por el administrador
  activo boolean not null default true,
  origen_importacion_id uuid,
  origen_archivo text, origen_hoja text, origen_fila int,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index on public.empleados (codigo_sin_ceros);

create table public.empleado_areas (
  empleado_id uuid not null references public.empleados(id),
  area_id uuid not null references public.areas(id),
  primary key (empleado_id, area_id)
);

-- ---------------------------------------------------------------------
-- Cuentas y permisos
-- ---------------------------------------------------------------------
create table public.usuarios (
  id uuid primary key references auth.users(id),
  email text not null,
  nombre text,
  perfil text not null check (perfil in ('admin','supervisor','tecnico')),
  empleado_id uuid unique references public.empleados(id),
  puede_registrar_otros boolean not null default false, -- técnico puede registrar a otro mecánico
  activo boolean not null default true,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  desactivado_por uuid,
  desactivado_en timestamptz
);

create table public.usuario_alcance (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id),
  modulo_id uuid not null references public.modulos(id),
  area_id uuid references public.areas(id),     -- null = todo el módulo
  creado_por uuid,
  creado_en timestamptz not null default now()
);
create unique index usuario_alcance_unico on public.usuario_alcance (usuario_id, modulo_id, coalesce(area_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------------
-- Preventivo (estructura; la lógica completa llega en la Etapa 3)
-- ---------------------------------------------------------------------
create table public.planes_preventivos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo_id uuid references public.tipos_maquina(id),
  maquina_id uuid references public.maquinas(id),
  area_id uuid references public.areas(id),
  frecuencia_valor int check (frecuencia_valor > 0),
  frecuencia_unidad text check (frecuencia_unidad in ('dias','semanas','meses')),
  tolerancia_dias int not null default 0 check (tolerancia_dias >= 0),
  estado text not null default 'propuesto' check (estado in ('propuesto','activo','inactivo')),
  origen text not null default 'manual',          -- 'Sheet1' / 'manual'
  texto_origen text,                              -- texto tal cual del Excel
  creado_por uuid, creado_en timestamptz not null default now(),
  check (tipo_id is not null or maquina_id is not null)
);

create table public.plan_actividades (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planes_preventivos(id),
  orden int not null default 0,
  descripcion text not null,
  obligatoria boolean not null default true,
  activo boolean not null default true
);

create table public.programaciones (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planes_preventivos(id),
  maquina_id uuid not null references public.maquinas(id),
  fecha_programada date not null,
  fecha_vencimiento date not null,
  responsable_id uuid references public.empleados(id),
  estado text not null default 'pendiente' check (estado in ('pendiente','en_proceso','completada','cancelada')),
  motivo_cancelacion text,
  creado_por uuid, creado_en timestamptz not null default now(),
  unique (plan_id, maquina_id, fecha_programada)  -- evita órdenes duplicadas
);

-- ---------------------------------------------------------------------
-- Mantenimiento
-- ---------------------------------------------------------------------
create table public.mantenimientos (
  id uuid primary key default gen_random_uuid(),
  folio bigint generated always as identity unique,
  tipo text not null check (tipo in ('preventivo','correctivo')),
  estado text not null check (estado in ('programado','en_proceso','pendiente_validacion','completado','cancelado')),
  maquina_id uuid not null references public.maquinas(id),
  mecanico_id uuid references public.empleados(id),
  programacion_id uuid references public.programaciones(id),
  -- Copia histórica: no cambia si luego cambian la máquina o el empleado.
  modulo_id uuid references public.modulos(id),
  area_id uuid references public.areas(id),
  ubicacion_id uuid references public.ubicaciones(id),
  snap_asset_id text, snap_qr text, snap_serie text, snap_maquina text, snap_fabricante text, snap_modelo text,
  snap_ubicacion text, snap_puesto text, snap_modulo text, snap_area text,
  snap_mecanico_codigo text, snap_mecanico_nombre text,
  qr_leido text,                  -- lo que se escaneó/escribió para encontrar la máquina
  codigo_mecanico_leido text,     -- lo que se escaneó/escribió del mecánico
  inicio_en timestamptz,          -- hora del servidor del primer inicio
  fin_en timestamptz,             -- hora del servidor del último final
  duracion_min numeric(10,2),     -- suma de los períodos trabajados
  semana int, anio int, mes int, semana_iso int,  -- calculados sobre fin_en (Tegucigalpa)
  creado_por uuid not null,
  iniciado_por uuid,
  finalizado_por uuid,
  validado_por uuid, validado_en timestamptz,
  cancelado_por uuid, cancelado_en timestamptz, motivo_cancelacion text,
  idempotency_key uuid unique,
  appsheet_id text unique,        -- MANTENIMIENTOSUBID si se migra historial
  creado_en timestamptz not null default now(),
  check (fin_en is null or inicio_en is null or fin_en >= inicio_en)
);
create index on public.mantenimientos (maquina_id, creado_en desc);
create index on public.mantenimientos (estado);
create index on public.mantenimientos (area_id, estado);
create index on public.mantenimientos (modulo_id, estado);
create index on public.mantenimientos (mecanico_id);
create index on public.mantenimientos (fin_en);
-- Un mecánico no puede tener dos trabajos en proceso en la misma máquina.
create unique index mant_un_en_proceso on public.mantenimientos (maquina_id, mecanico_id) where estado = 'en_proceso';

create table public.mantenimiento_periodos (
  id bigint generated always as identity primary key,
  mantenimiento_id uuid not null references public.mantenimientos(id),
  inicio_en timestamptz not null,
  fin_en timestamptz,
  iniciado_por uuid, finalizado_por uuid,
  check (fin_en is null or fin_en >= inicio_en)
);
create unique index mant_periodo_abierto on public.mantenimiento_periodos (mantenimiento_id) where fin_en is null;

create table public.mantenimiento_eventos (
  id bigint generated always as identity primary key,
  mantenimiento_id uuid not null references public.mantenimientos(id),
  evento text not null,           -- creado, iniciado, comentario, foto, finalizado, validado, devuelto, reanudado, cancelado, reabierto
  estado_anterior text, estado_nuevo text,
  motivo text,
  datos jsonb,
  usuario_id uuid,
  creado_en timestamptz not null default now()
);
create index on public.mantenimiento_eventos (mantenimiento_id, id);

create table public.mantenimiento_comentarios (
  id uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references public.mantenimientos(id),
  texto text not null check (length(btrim(texto)) > 0),
  usuario_id uuid not null,
  idempotency_key uuid unique,
  creado_en timestamptz not null default now()
);
create index on public.mantenimiento_comentarios (mantenimiento_id, creado_en);

create table public.mantenimiento_actividades (
  id uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references public.mantenimientos(id),
  plan_actividad_id uuid references public.plan_actividades(id),
  descripcion text not null,
  resultado text check (resultado in ('ok','no_ok','na')),
  nota text,
  usuario_id uuid,
  actualizado_en timestamptz not null default now()
);

create table public.mantenimiento_fotos (
  id uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references public.mantenimientos(id),
  ruta text not null unique,      -- mant-evidencias/{mantenimiento_id}/{archivo}
  tamano_bytes bigint,
  tipo_mime text,
  usuario_id uuid not null,
  creado_en timestamptz not null default now()
);

create table public.validaciones (
  id uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references public.mantenimientos(id),
  resultado text not null check (resultado in ('aprobado','devuelto')),
  observacion text,
  supervisor_id uuid not null,
  creado_en timestamptz not null default now()
);

-- Paros de máquina: base para Machine Down (separado de la duración del mantenimiento).
create table public.paros_maquina (
  id uuid primary key default gen_random_uuid(),
  maquina_id uuid not null references public.maquinas(id),
  mantenimiento_id uuid references public.mantenimientos(id),
  inicio_en timestamptz not null,
  fin_en timestamptz,
  causa text,
  registrado_por uuid not null,
  creado_en timestamptz not null default now(),
  check (fin_en is null or fin_en >= inicio_en)
);

-- ---------------------------------------------------------------------
-- Importaciones y auditoría
-- ---------------------------------------------------------------------
create table public.importaciones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('maquinaria','personal')),
  archivo text not null,
  hash_archivo text,
  hoja text not null,
  mapeo jsonb,
  opciones jsonb,
  estado text not null default 'aplicada' check (estado in ('aplicada','fallida')),
  total_filas int, nuevos int, modificados int, sin_cambios int, errores int, en_revision int,
  usuario_id uuid not null,
  creado_en timestamptz not null default now()
);

create table public.importacion_filas (
  id bigint generated always as identity primary key,
  importacion_id uuid not null references public.importaciones(id),
  fila_origen int,
  clave text,
  resultado text not null check (resultado in ('nuevo','modificado','sin_cambios','error','revision')),
  mensajes text[],
  cambios jsonb,                  -- {campo: {antes, despues}}
  datos_originales jsonb,
  registro_id uuid
);
create index on public.importacion_filas (importacion_id);

create table public.auditoria (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id text,
  accion text not null,
  antes jsonb, despues jsonb,
  motivo text,
  usuario_id uuid,
  creado_en timestamptz not null default now()
);
create index on public.auditoria (tabla, registro_id);

-- ---------------------------------------------------------------------
-- Integración futura con inventarios de repuestos (solo estructura; sin conexión)
-- ---------------------------------------------------------------------
create table public.inventarios_origen (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nombre text not null,
  area_id uuid references public.areas(id),
  url_base text,                                  -- las credenciales van en secretos de Edge Functions, nunca aquí
  moneda_base text check (moneda_base ~ '^[A-Z]{3}$'),
  estado text not null default 'diseno' check (estado in ('diseno','pruebas','activo','inactivo')),
  creado_en timestamptz not null default now()
);

create table public.consumos_repuestos (
  id uuid primary key default gen_random_uuid(),
  mantenimiento_id uuid not null references public.mantenimientos(id),
  maquina_id uuid not null references public.maquinas(id),
  modulo_id uuid references public.modulos(id),
  area_id uuid references public.areas(id),
  inventario_origen_id uuid not null references public.inventarios_origen(id),
  repuesto_id_origen text not null,
  repuesto_codigo text,
  descripcion text,
  cantidad numeric(14,4) not null check (cantidad <> 0),
  unidad text not null,
  costo_unitario numeric(14,4),                    -- null = costo desconocido (nunca 0 por defecto)
  moneda text check (moneda ~ '^[A-Z]{3}$'),
  costo_total numeric(16,4),
  costo_conocido boolean not null default false,
  tipo_movimiento text not null check (tipo_movimiento in ('salida','devolucion','correccion')),
  consumo_relacionado_id uuid references public.consumos_repuestos(id),
  estado_integracion text not null default 'borrador'
    check (estado_integracion in ('borrador','pendiente','confirmado','rechazado','en_conciliacion')),
  movimiento_id_origen text,
  idempotency_key uuid not null unique,
  registrado_por uuid not null,
  creado_en timestamptz not null default now(),
  confirmado_en timestamptz,
  check (costo_conocido = (costo_unitario is not null)),
  check (costo_unitario is null or moneda is not null)
);

create table public.consumo_movimientos (
  id bigint generated always as identity primary key,
  consumo_id uuid not null references public.consumos_repuestos(id),
  intento int not null,
  solicitud jsonb, respuesta jsonb, codigo_respuesta int,
  creado_en timestamptz not null default now()
);

create table public.cola_integracion (
  consumo_id uuid primary key references public.consumos_repuestos(id),
  proximo_intento timestamptz not null default now(),
  intentos int not null default 0,
  ultimo_error text
);
