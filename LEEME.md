# Sistema de Mantenimiento Pinehurst

Aplicación web (celular y computadora) para registrar el mantenimiento preventivo y correctivo de la maquinaria de Pinehurst. Tiene tres módulos:

- Costura y PD
- Serigrafía, Bordado y Sublimado
- Corte, Bodega de Telas y Staging

Usa un proyecto de Supabase exclusivo, `mantenimiento-pinehurst`. La interfaz está en español y la zona horaria es America/Tegucigalpa.

## Estado: Etapa 2

| Implementado y probado en una base local | Pendiente |
| --- | --- |
| Autenticación por invitación, sin registro público | Programación preventiva y listas de verificación (Etapa 3) |
| Perfiles Administrador, Supervisor y Técnico, con permisos por módulo y área aplicados con RLS | Indicadores, cumplimiento preventivo y Machine Down (Etapa 3) |
| Importación de maquinaria y personal desde Excel, con vista previa, validación y auditoría | Conexión con los inventarios de repuestos (etapa futura, ver `docs/integracion-inventarios.md`) |
| Clasificación de máquinas por módulo y área con reglas, historial de ubicaciones y bandeja "Sin clasificar" | Migrar el historial de AppSheet (requiere exportar sus tablas) |
| Flujo completo del trabajo: escanear QR → iniciar → comentar y subir fotos → finalizar → validar o devolver → completar o cancelar | |
| Historial con filtros y exportación a Excel | |

Las pruebas de `supabase/tests` se ejecutaron sobre PostgreSQL 16 local, simulando Supabase, con los archivos Excel reales. Las pruebas en el proyecto real de Supabase y en celulares se registran en la sección "Pruebas".

## Estructura

```
supabase/migrations/   Migraciones SQL (aplicar en orden)
supabase/functions/    Edge Function admin-usuarios (invitar, desactivar y reactivar cuentas)
supabase/tests/        Pruebas locales de permisos, importación y flujo
web/                   Aplicación React + Vite + TypeScript
docs/                  Diseño de la integración con inventarios
.github/workflows/     Publicación automática en GitHub Pages
```

## Instalación

### 1. Base de datos

**Ya aplicada el 1 nov 2026 en `mantenimiento-pinehurst`.** Para otro proyecto: en Supabase, abre **SQL Editor** y ejecuta los 5 archivos de `supabase/migrations/` en orden de nombre. Cada archivo debe terminar sin errores antes de ejecutar el siguiente. Si después instalas la CLI de Supabase, puedes aplicarlos con `supabase db push`.

### 2. Configuración de Auth (Authentication → Sign In / Providers y URL Configuration)

- **Allow new users to sign up: desactivado.** Las cuentas solo se crean por invitación.
- **Site URL:** la dirección de GitHub Pages, por ejemplo `https://USUARIO.github.io/REPOSITORIO/`.
- **Redirect URLs:** la misma dirección. Para desarrollo, agrega también `http://localhost:5173/`.

### 3. Edge Function `admin-usuarios`

Ve a **Edge Functions → Deploy a new function → Via Editor**. Pon el nombre `admin-usuarios`, pega el contenido de `supabase/functions/admin-usuarios/index.ts` y publícala. Si usas la CLI, el comando es `supabase functions deploy admin-usuarios`.

Supabase entrega la clave de servicio a la función como variable de entorno. No hay que copiarla en ningún archivo.

**Ya publicada el 1 nov 2026** en `mantenimiento-pinehurst`. La opción *Verify JWT with legacy secret* quedó activada. Si al invitar usuarios aparece el error "Invalid JWT" (401), desactívala en *Edge Functions → admin-usuarios → Settings* y guarda. Es seguro hacerlo porque la función verifica por sí misma que quien llama es administrador.

### 4. Primer administrador (una sola vez)

1. En **Authentication → Users → Add user → Send invitation**, invita a tu correo.
2. Abre el enlace que llega por correo y crea tu contraseña. Si la app todavía no está publicada, el enlace puede dar error. En ese caso, publica la app (paso 5) y usa "Olvidé mi contraseña".
3. En **SQL Editor**, ejecuta:
   ```sql
   select public.bootstrap_admin('irivera@pinehurstmfg.com');
   ```
   La función solo funciona si todavía no existe ningún administrador. El navegador no tiene permiso para ejecutarla.

A partir de ese momento, los demás usuarios se invitan desde **Administración → Usuarios y permisos**.

### 5. Publicación en GitHub Pages

1. Sube esta carpeta a un repositorio de GitHub.
2. En **Settings → Pages → Source**, elige **GitHub Actions**.
3. En **Settings → Secrets and variables → Actions → Variables**, crea:
   - `VITE_SUPABASE_URL` = `https://wgvroohznlwopbqxclcm.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = la clave *publishable* (o *anon*) de **Project Settings → API Keys**.
4. Haz un cambio en `main` o ejecuta el flujo "Publicar app".

Estas dos claves son públicas por diseño. **Nunca guardes la service_role ni una secret key en GitHub.** Para publicar GitHub Pages desde un repositorio privado se necesita un plan pagado de GitHub. Un repositorio público deja el código visible, pero el código no contiene secretos.

### 6. Desarrollo local

```bash
cd web
cp .env.example .env.local   # completa la URL y la clave publicable
npm install
npm run dev
```

## Uso inicial recomendado

1. **Administración → Importación → Catálogo de personal:** carga `personal.xlsx`, revisa la vista previa y confirma.
2. **Personal → Habilitar cargos de mantenimiento**, y luego asigna las áreas a cada mecánico.
3. **Importación → Inventario de maquinaria:** carga `INVENTARIO MAQUINAS.xlsx` (hoja MAQUINAS). Hay 9 Asset ID que Excel guardó como número: quedan en revisión hasta que confirmes la opción para aceptarlos.
4. **Clasificar módulos y áreas:** confirma las reglas sugeridas (LINE n → Costura, PD, SERIGRAFIA…). Después clasifica la bandeja "Sin clasificar" (Bodega de Máquinas, SMED, Etiqueta, SCHOOL3…). Las calderas ya quedan en Costura y PD por la regla de tipo.
5. **Usuarios y permisos:** invita a supervisores y técnicos, asígnales módulos y áreas, y vincúlalos con su código de empleado.

## Reglas importantes del diseño

- **Identificadores:** cada máquina y cada empleado tiene un `id` interno (UUID). Para importar, la máquina se reconoce por su Asset ID y el empleado por su código. Ambas reglas se verificaron en los archivos actuales: no tienen duplicados.
- **QR y serie no son únicos.** Hay 7 QR repetidos, que se importan marcados "en revisión" sin fusionarse. Si al escanear un QR aparecen varias máquinas, la app las muestra para elegir.
- **Código del mecánico:** se acepta con o sin ceros iniciales (12745 = 012745). El código original se conserva.
- **Tiempos:** inicio y final los registra el servidor (`now()`), como `timestamptz`. El técnico no puede editarlos. Si un trabajo se devuelve, se abre un nuevo período al reanudarlo, y la duración es la suma de todos los períodos.
- **Semana, mes y año:** se calculan sobre el FINAL de la actividad, en hora de Tegucigalpa. `semana` sigue el criterio WEEKNUM de AppSheet (la semana empieza el domingo y la semana 1 contiene el 1 de enero). También se guarda `semana_iso`.
- **Historial inmutable:** cada mantenimiento guarda una copia de los datos de la máquina, el área, la ubicación y el mecánico al momento del trabajo. Actualizar el inventario no cambia los trabajos anteriores. Nada se borra: los trabajos se cancelan con motivo y las máquinas o empleados se desactivan.
- **Duración del mantenimiento ≠ paro de máquina.** Machine Down se calculará con la tabla `paros_maquina` (Etapa 3).
- **Sin conexión:** la app no simula sincronización. Si una operación falla, muestra "No se guardó" y un botón para reintentar. Cada operación usa la misma clave al reintentarse, así que no se duplica.

## Respaldo y recuperación

- **Automático:** el plan Free de Supabase no incluye respaldos descargables. El plan Pro incluye respaldos diarios y, como opción, recuperación a un punto en el tiempo.
- **Manual (recomendado mensualmente y antes de cada importación grande):**
  ```bash
  # Requiere la cadena de conexión de Project Settings > Database (con la contraseña de la base).
  pg_dump "postgresql://postgres.[REF]:[CONTRASEÑA]@aws-0-us-east-1.pooler.supabase.com:5432/postgres" \
    --schema=public --no-owner --no-privileges -Fc -f respaldo_mantenimiento_$(date +%F).dump
  ```
  También se puede usar `supabase db dump --data-only` con la CLI. Guarda el archivo fuera del equipo, en un lugar autorizado por la empresa.
- **Exportaciones de trabajo:** el Historial y la Maquinaria se pueden exportar a Excel desde la app.
- **Recuperación:** se crea un proyecto nuevo, se aplican las migraciones y se restaura con `pg_restore --data-only --disable-triggers -d "<conexión>" archivo.dump`. Luego se vuelve a publicar la Edge Function y se invita al administrador.
- **Fotos:** están en el bucket privado `mant-evidencias`. Respáldalas con la CLI (`supabase storage cp -r ss:///mant-evidencias ./fotos --experimental`) o desde el panel.

## Pruebas

`supabase/tests/01_pruebas.sql` se ejecuta sobre una base local que simula Supabase (`00_stub_supabase.sql`). Resultado del 1 nov 2026:

| Prueba | Resultado |
| --- | --- |
| Importar maquinaria (1,457 filas): 1,427 nuevas, 30 en revisión (9 Asset ID numéricos sin aplicar y 21 marcadas por QR o serie compartidos o sin QR) | OK |
| Repetir la misma importación: 0 nuevas, 0 modificadas, 1,448 sin cambios y aviso de archivo repetido | OK |
| Importar personal (1,441): 1,441 nuevos; al repetir, 1,441 sin cambios; 012745 se conserva con su cero inicial | OK |
| Calderas (47) asignadas a Costura y PD por la regla de tipo | OK |
| Usuario sin registro o anónimo: no ve datos ni ejecuta funciones | OK |
| El técnico no puede subir su perfil, darse áreas, insertar mantenimientos directamente ni editar máquinas | OK |
| El técnico solo ve las máquinas de su área (71 de Serigrafía) | OK |
| Doble clic al iniciar, comentar o finalizar: devuelve el mismo registro, sin duplicar | OK |
| No se puede finalizar sin iniciar; no se puede validar un trabajo propio; devolver exige motivo | OK |
| Devolver → reanudar → finalizar → validar: 2 períodos y 7 eventos registrados | OK |
| Mover una máquina a una ubicación sin regla: conserva el área, se marca para revisión y el trabajo anterior conserva su copia | OK |
| Lectura del Excel en el navegador idéntica a la de referencia (1,457 y 1,441 filas) | OK |
| Migraciones aplicadas en el proyecto real `mantenimiento-pinehurst` (1 nov 2026): 30 tablas con RLS, 51 políticas, 2 políticas de Storage, bucket privado, 0 permisos para `anon`, módulos, áreas y regla de calderas | OK |
| Pantalla de inicio de sesión en celular (375 px), sin errores en la consola | OK |
| Publicación en GitHub Pages (https://ar15011654.github.io/mantenimiento-pinehurst/): la compilación termina y la pantalla de inicio de sesión carga | OK |
| Invitaciones con la Edge Function, importación en el proyecto real, flujo completo con usuarios reales y cámara en celular | Pendiente de ejecutar |
