# Diseño: integración futura con los inventarios de repuestos por área

**Estado:** solo diseño. Las tablas ya existen en la base de datos, pero están vacías y no tienen conexión activa. Ninguna pantalla las usa todavía.

## Principios

1. Cada sistema de inventario sigue siendo responsable de sus existencias y de sus costos. La app de mantenimiento solo *solicita* la salida de un repuesto y guarda lo que el inventario *confirma*.
2. Un repuesto se identifica con el par `(inventario_origen_id, repuesto_id_origen)`. Así no se confunden repuestos con el mismo código en distintas bases.
3. Las credenciales de cada inventario se guardan como secretos de las Edge Functions. Nunca se guardan en tablas ni en el navegador.
4. Toda salida lleva una `idempotency_key` única. Si se reintenta la solicitud, el inventario devuelve el mismo movimiento y no descuenta las existencias otra vez.

## Tablas (migración 1)

| Tabla | Uso |
| --- | --- |
| `inventarios_origen` | Un registro por cada sistema de inventario: área, URL de su API, moneda base y estado (`diseno` / `pruebas` / `activo` / `inactivo`) |
| `consumos_repuestos` | Cada movimiento de repuesto vinculado a un mantenimiento. Guarda una copia de la máquina, el módulo y el área; el repuesto, la cantidad y la unidad; el costo unitario aplicado, la moneda y el total; el tipo (salida, devolución o corrección), el consumo relacionado, el estado de la integración, el id del movimiento en el inventario, el responsable y la fecha. |
| `consumo_movimientos` | Bitácora de cada intento: solicitud, respuesta y código de respuesta |
| `cola_integracion` | Reintentos pendientes con su próximo intento y último error |

## Estados de un consumo

`borrador` → `pendiente` → `confirmado`, o bien `rechazado` (por ejemplo, sin existencias) o `en_conciliacion`.

Mientras el consumo no esté `confirmado`, la app lo muestra como **"Pendiente de confirmación"** y no lo suma como un costo confirmado.

## Flujo de una salida

1. El técnico busca el repuesto mediante la Edge Function `inventario-buscar`, que consulta el inventario de su área. Indica la cantidad.
2. La función `registrar_consumo` (RPC) crea el consumo con estado `pendiente` y una `idempotency_key` nueva.
3. La Edge Function `inventario-salida` envía al inventario `POST /salidas` con esa clave.
4. **Respuesta correcta:** se guardan `movimiento_id_origen`, `costo_unitario` y `moneda` tal como los aplicó el inventario. El estado pasa a `confirmado`.
5. **Error de red o tiempo agotado:** el consumo sigue `pendiente` y entra a la `cola_integracion`. Un proceso programado lo reintenta con **la misma clave**.
6. **Rechazo del inventario** (sin existencias, repuesto inactivo): el estado pasa a `rechazado` y se muestra el motivo.

## Conciliación (proceso programado)

Para cada consumo `pendiente` o `en_conciliacion`, el proceso consulta `GET /movimientos?idempotency_key=…`:

| Inventario | App de mantenimiento | Acción |
| --- | --- | --- |
| Tiene el movimiento | Pendiente | Confirmar en la app con los datos del inventario |
| No lo tiene | Pendiente | Reintentar. Después de N intentos, pasar a `en_conciliacion` |
| Cantidad o costo distintos | Cualquiera | `en_conciliacion` para que lo revise el administrador; no se cambia nada automáticamente |
| Tiene un movimiento que la app no conoce | — | Se reporta al administrador |

## Devoluciones y correcciones

Un consumo confirmado nunca se edita. Para devolver o corregir, se crea un consumo nuevo de tipo `devolucion` o `correccion`, con `consumo_relacionado_id` apuntando al original. Ese movimiento pasa por el mismo flujo de confirmación.

## Costos y monedas

- El costo se guarda tal como se aplicó en el momento del consumo. Si el inventario cambia el precio después, el historial no cambia.
- Un costo desconocido queda **vacío**, con `costo_conocido = false`, nunca en 0. La base de datos lo valida con un `check`. Los reportes indican cuántos consumos no tienen costo.
- Los importes solo se suman dentro de la misma moneda. Antes de sumar monedas distintas hay que crear `tipos_cambio (fecha, moneda_origen, moneda_destino, tasa, fuente)` y definir la moneda de reporte.
- El reporte se llama **"Costo de repuestos"**. El "Costo total del mantenimiento" solo se mostrará cuando existan `costos_mano_obra` y `costos_servicios`. Cada componente vive en su propia tabla y se suma una sola vez.

## Consultas previstas

- Repuestos usados en un mantenimiento.
- Costo de repuestos por intervención, solo con consumos `confirmado`.
- Costo acumulado de repuestos por máquina.
- Costos por período, área y módulo, separados por moneda.
- Historial de intervenciones y costos de cada máquina.

## Lo que debe ofrecer cada sistema de inventario (API)

- Autenticación de servidor a servidor (clave o token por inventario).
- `GET /repuestos?texto=` con id, código, descripción, unidad, existencia, costo y moneda.
- `POST /salidas` con `idempotency_key`, id del repuesto, cantidad, referencia del mantenimiento y responsable. Si la clave se repite, debe devolver el mismo movimiento.
- `GET /movimientos?idempotency_key=` para la conciliación.
- `POST /devoluciones` vinculada a una salida.

## Pruebas previstas para esa etapa

Salidas, reintentos con la misma clave, doble clic, devoluciones, fallas de conexión en cada paso, conciliación de cada caso de la tabla y conservación de los costos históricos después de cambiar un precio en el inventario.
