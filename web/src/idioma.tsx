import { useEffect, useState } from 'react';
import EN from './i18n_en.json';

/**
 * Idioma de la interfaz (español / inglés) para cualquier usuario.
 * La app está escrita en español; en inglés se traducen los textos visibles en pantalla
 * (texto, placeholder, title, aria-label, alt) con un diccionario y patrones para frases con datos.
 * Los datos guardados (nombres de máquinas, comentarios, descripciones) no se traducen.
 * La elección se guarda en este dispositivo.
 */
export type Idioma = 'es' | 'en';
const CLAVE = 'idioma';
const DICC = EN as Record<string, string>;
let idioma: Idioma = (() => { try { return localStorage.getItem(CLAVE) === 'en' ? 'en' : 'es'; } catch { return 'es'; } })();
export const idiomaActual = () => idioma;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// Frases con datos variables (los grupos se traducen de nuevo si son texto conocido).
const PATRONES: [RegExp, (m: string[]) => string][] = [
  [/^(.*) Nada se perdió: presione de nuevo "Finalizar mantenimiento"\.$/, m => `${tr(m[1])} Nothing was lost: press "Finish maintenance" again.`],
  [/^✓ (.+) · Servicio externo$/, m => `✓ ${m[1]} · External service`],
  [/^(.+) \(mecánico externo\)$/, m => `${m[1]} (external mechanic)`],
  [/^(.+) \(servicio externo\)$/, m => `${m[1]} (external service)`],
  [/^No existe un empleado con el código (.+?)\.?$/, m => `No employee exists with code ${m[1]}.`],
  [/^No se encontró la máquina (.+) en esta área\.$/, m => `Machine ${m[1]} was not found in this area.`],
  [/^Solo hay (.+) en existencia de (.+)\.$/, m => `Only ${m[1]} in stock of ${m[2]}.`],
  [/^(Entrada|Salida) registrada: (.+?) de (.+?) \((.*)\)\. Existencia actual: (.+)\.$/, m => `${m[1] === 'Entrada' ? 'Receipt' : 'Issue'} recorded: ${m[2]} of ${m[3]} (${m[4]}). Current stock: ${m[5]}.`],
  [/^Catálogo: (.+)$/, m => `Catalog: ${m[1]}`],
  [/^Movimiento eliminado\. Existencia actual de (.+): (.+)\.$/, m => `Movement deleted. Current stock of ${m[1]}: ${m[2]}.`],
  [/^En la hoja "(.+)" no se encontraron las columnas "Codigo Articulo" y "# Parte"\.$/, m => `The columns "Codigo Articulo" and "# Parte" were not found in sheet "${m[1]}".`],
  [/^Vista previa de (.+)$/, m => `Preview of ${m[1]}`],
  [/^Editar (.+)$/, m => `Edit ${m[1]}`],
  [/^Etiquetas de todo el catálogo \((\d+)\)$/, m => `Labels for the whole catalog (${m[1]})`],
  [/^Etiquetas seleccionadas \((\d+)\)$/, m => `Selected labels (${m[1]})`],
  [/^Seleccionar (.+)$/, m => `Select ${m[1]}`],
  [/^El código "(.+)" tiene caracteres que no se pueden imprimir en código de barras\.$/, m => `Code "${m[1]}" has characters that cannot be printed as a barcode.`],
  [/^Usuario actualizado\. Ahora inicia sesión con (.+)\.$/, m => `User updated. They now sign in with ${m[1]}.`],
  [/^¿Cambiar el correo de inicio de sesión de (.+) a (.+)\?$/, m => `Change the sign-in email from ${m[1]} to ${m[2]}?`],
  [/^Se cambió el correo de inicio de sesión, pero no en la lista de usuarios: (.+)$/, m => `The sign-in email was changed, but not in the user list: ${m[1]}`],
  [/^\(sin contar (\d+) sin precio\)$/, m => `(not counting ${m[1]} without price)`],
  [/^(\d+) días$/, m => `${m[1]} days`],
  [/^(\d+) sin costo$/, m => `${m[1]} without cost`],
  [/^Esa máquina pertenece a otro módulo \((.+)\)\.$/, m => `That machine belongs to another module (${tr(m[1])}).`],
  [/^No se encontró ninguna máquina con el código (.+) en sus áreas\.$/, m => `No machine with code ${m[1]} was found in your areas.`],
  [/^(.+): el archivo pasa de 10 MB\.$/, m => `${m[1]}: the file is larger than 10 MB.`],
  [/^(.+): solo se aceptan fotos o PDF\.$/, m => `${m[1]}: only photos or PDF are accepted.`],
  [/^Se retomó el trabajo #(\d+), que ya estaba en proceso\.$/, m => `Resumed job #${m[1]}, which was already in progress.`],
  [/^Trabajo #(\d+) en proceso\.$/, m => `Job #${m[1]} in progress.`],
  [/^(.+) \(en curso\)$/, m => `${m[1]} (in progress)`],
  [/^No enviado \((.+)\):$/, m => `Not sent (${tr(m[1])}):`],
  [/^· Final (.+)$/, m => `· End ${m[1]}`],
  [/^Se guardaron (\d+) reglas y se clasificaron (\d+) máquinas sin área\.$/, m => `${m[1]} rules were saved and ${m[2]} machines without an area were classified.`],
  [/^Regla guardada para (.+)\. (\d+) máquinas sin área clasificadas\.$/, m => `Rule saved for ${m[1]}. ${m[2]} machines without an area classified.`],
  [/^Regla guardada para (.+)\. (\d+) máquinas actualizadas\.$/, m => `Rule saved for ${m[1]}. ${m[2]} machines updated.`],
  [/^(\d+) máquinas clasificadas\. El cambio quedó en el historial de ubicaciones\.$/, m => `${m[1]} machines classified. The change was recorded in the location history.`],
  [/^Importación deshecha\. Registros borrados: (\d+) · devueltos a su valor anterior: (\d+)(?: · conservados por tener trabajos: (.+))?$/, m => `Import undone. Records deleted: ${m[1]} · restored to previous value: ${m[2]}${m[3] ? ` · kept because they have jobs: ${m[3]}` : ''}`],
  [/^(\d+) empleados habilitados como mecánicos\. Ahora asígneles sus áreas\.$/, m => `${m[1]} employees enabled as mechanics. Now assign their areas.`],
  [/^Invitación enviada a (.+)\. La persona debe abrir el enlace del correo y crear su contraseña\.$/, m => `Invitation sent to ${m[1]}. The person must open the email link and create their password.`],
  [/^Motivo para desactivar a (.+):$/, m => `Reason for deactivating ${m[1]}:`],
  [/^(.+) \(completo\)$/, m => `${tr(m[1])} (whole)`],
  [/^\(se muestran los primeros (\d+); reduzca el período\)$/, m => `(showing the first ${m[1]}; narrow the period)`],
  [/^No hay suficiente existencia de (.+) \((.*)\): hay (.+) y se piden (.+)\.$/, m => `Not enough stock of ${m[1]} (${m[2]}): ${m[3]} available and ${m[4]} requested.`],
  [/^No se puede eliminar esta entrada de (.+): la existencia quedaría en (.+)\. Elimine primero las salidas que usaron esas piezas\.$/, m => `This receipt of ${m[1]} cannot be deleted: stock would be ${m[2]}. First delete the issues that used those parts.`],
  [/^El empleado (.+) está inactivo\.$/, m => `Employee ${m[1]} is inactive.`],
  [/^El repuesto (.+) está dado de baja\.$/, m => `Part ${m[1]} is retired.`],
  [/^Ya existe un artículo con el código (.+)\.$/, m => `An item with code ${m[1]} already exists.`],
  [/^Código repetido en el archivo: (.+)$/, m => `Code repeated in the file: ${m[1]}`],
  [/^Precio no numérico: (.+)$/, m => `Non-numeric price: ${m[1]}`],
  [/^Eliminar (la ENTRADA|la SALIDA) de (.+) × (.+) \((.+)\)\.$/, m => `Delete ${m[1] === 'la ENTRADA' ? 'the RECEIPT' : 'the ISSUE'} of ${m[2]} × ${m[3]} (${m[4]}).`],
  [/^Deshacer la importación "(.+)" \((.+)\)\.$/, m => `Undo the import "${m[1]}" (${m[2]}).`],
  [/^Se borrarán los (\d+) registros que creó \(si no tienen trabajos registrados\) y se devolverán a su valor anterior los (\d+) que modificó\.$/, m => `The ${m[1]} records it created will be deleted (if they have no recorded jobs) and the ${m[2]} it modified will be restored to their previous value.`],
  [/^¿Aplicar la importación\? Nuevos: (\d+), modificados: (\d+)\. No se borrará ni desactivará ningún registro\.$/, m => `Apply the import? New: ${m[1]}, modified: ${m[2]}. No record will be deleted or deactivated.`],
  [/^¿Habilitar como mecánicos a todos los empleados con cargo: (.+)\?$/, m => `Enable as mechanics all employees with position: ${m[1]}?`],
  [/^Sistema de inventario · (\d+) repuestos$/, m => `Inventory system · ${m[1]} parts`],
  [/^INVENTARIO (.+)$/, m => `INVENTORY ${tr(m[1])}`],
  [/^MANTTO\. (.+)$/, m => `MAINT. ${tr(m[1])}`],
  [/^Mantenimiento · (.+)$/, m => `Maintenance · ${tr(m[1])}`],
  [/^Inventario · (.+)$/, m => `Inventory · ${tr(m[1])}`],
  [/^Descargar compra sugerida \((\d+)\)$/, m => `Download suggested purchase (${m[1]})`],
  [/^Aplicar importación \((\d+) artículos\)$/, m => `Apply import (${m[1]} items)`],
  [/^Cotización o factura adjunta \((\d+)\)\.$/, m => `Quote or invoice attached (${m[1]}).`],
  [/^REPUESTOS USADOS \((\d+)\)$/, m => `PARTS USED (${m[1]})`],
  [/^(\d+) servicio\(s\) externo\(s\) sin costo registrado\. Regístrelo en el detalle del trabajo para que se sume aquí\.$/, m => `${m[1]} external service(s) without a recorded cost. Record it in the job detail so it is included here.`],
];

/** Traduce un texto al idioma actual (solo cuando es inglés). */
export function tr(s: string): string {
  if (idioma === 'es' || !s) return s;
  const k = norm(s);
  if (!k) return s;
  let r = DICC[k];
  if (r === undefined) {
    for (const [re, f] of PATRONES) { const m = k.match(re); if (m) { r = f(m); break; } }
  }
  if (r === undefined) return s;
  const ini = s.match(/^\s*/)![0], fin = s.match(/\s*$/)![0];
  return ini + r + fin;
}

// ---------------------------------------------------------------- Traducción del DOM
const ATRIBUTOS = ['placeholder', 'title', 'aria-label', 'alt'];
const textos = new WeakMap<Text, { es: string; out: string }>();
const attrs = new WeakMap<Element, Record<string, { es: string; out: string }>>();
const OMITIR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);

function procesarTexto(n: Text) {
  const p = n.parentElement;
  if (!p || OMITIR.has(p.tagName) || p.closest('[data-sin-traducir]')) return;
  const actual = n.nodeValue ?? '';
  const prev = textos.get(n);
  const es = prev && actual === prev.out ? prev.es : actual;
  const out = idioma === 'en' ? tr(es) : es;
  if (out !== actual) n.nodeValue = out;
  textos.set(n, { es, out });
}
function procesarAtributos(el: Element) {
  if (el.closest('[data-sin-traducir]')) return;
  let reg = attrs.get(el);
  for (const a of ATRIBUTOS) {
    const actual = el.getAttribute(a);
    if (actual === null) continue;
    reg = reg ?? {};
    const prev = reg[a];
    const es = prev && actual === prev.out ? prev.es : actual;
    const out = idioma === 'en' ? tr(es) : es;
    if (out !== actual) el.setAttribute(a, out);
    reg[a] = { es, out };
  }
  if (reg) attrs.set(el, reg);
}
function recorrer(raiz: Node) {
  if (raiz.nodeType === Node.TEXT_NODE) { procesarTexto(raiz as Text); return; }
  if (raiz.nodeType !== Node.ELEMENT_NODE) return;
  const el = raiz as Element;
  if (OMITIR.has(el.tagName)) return;
  procesarAtributos(el);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null = w.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) procesarTexto(n as Text); else procesarAtributos(n as Element);
    n = w.nextNode();
  }
}

let iniciado = false;
export function iniciarTraduccion() {
  if (iniciado) return; iniciado = true;
  document.documentElement.lang = idioma;
  // Ventanas del navegador (confirmar, motivo, aviso).
  const traducirMensaje = (m?: string) => (m ?? '').split('\n').map(l => tr(l)).join('\n');
  const conf = window.confirm.bind(window), prom = window.prompt.bind(window), ale = window.alert.bind(window);
  window.confirm = (m?: string) => conf(traducirMensaje(m));
  window.prompt = (m?: string, d?: string) => prom(traducirMensaje(m), d);
  window.alert = (m?: string) => ale(traducirMensaje(m));
  new MutationObserver(lista => {
    for (const r of lista) {
      if (r.type === 'characterData') procesarTexto(r.target as Text);
      else if (r.type === 'attributes') procesarAtributos(r.target as Element);
      else r.addedNodes.forEach(recorrer);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS });
  recorrer(document.body);
}

export function cambiarIdioma(nuevo: Idioma) {
  idioma = nuevo;
  try { localStorage.setItem(CLAVE, nuevo); } catch { /* sin almacenamiento */ }
  document.documentElement.lang = nuevo;
  recorrer(document.body);
  window.dispatchEvent(new Event('idioma'));
}

/** Botón ES | EN para la barra superior. */
export function SelectorIdioma() {
  const [, forzar] = useState(0);
  useEffect(() => { const f = () => forzar(x => x + 1); window.addEventListener('idioma', f); return () => window.removeEventListener('idioma', f); }, []);
  return (
    <div className="idioma" role="group" aria-label="Idioma / Language" data-sin-traducir>
      {(['es', 'en'] as const).map(i => (
        <button key={i} type="button" className={idioma === i ? 'activo' : ''} aria-pressed={idioma === i} onClick={() => cambiarIdioma(i)}>{i.toUpperCase()}</button>
      ))}
    </div>
  );
}
