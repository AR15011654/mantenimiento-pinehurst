// Etiquetas con código de barras (Code 128) para imprimir los repuestos del inventario.
// El código de barras contiene el CÓDIGO del artículo, que es lo que el escáner busca en Entrada/Salida.
import type { Articulo } from './inventario';

// Anchos (barra, espacio, ...) de los 107 símbolos de Code 128; el último es el de parada.
const PATRONES = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');
const INICIO_B = 104, PARADA = 106;

/** Anchos de módulo (barra, espacio, barra…) del código en Code 128 B. Solo admite ASCII imprimible. */
export function code128(texto: string): number[] {
  const valores = [...texto].map(c => {
    const v = c.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error(`El código "${texto}" tiene caracteres que no se pueden imprimir en código de barras.`);
    return v;
  });
  const control = (INICIO_B + valores.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  return [INICIO_B, ...valores, control, PARADA].flatMap(v => [...PATRONES[v]].map(Number));
}

/** Siguiente código del catálogo con el mismo prefijo y relleno que los existentes (p. ej. SSB0110 → SSB0111). */
export function siguienteCodigo(codigos: string[], prefijoPorDefecto = 'ART'): string {
  const conteo = new Map<string, { n: number; max: number; ancho: number }>();
  for (const c of codigos) {
    const m = /^([A-Za-z-]*)(\d+)$/.exec(c.trim());
    if (!m) continue;
    const k = m[1].toUpperCase();
    const x = conteo.get(k) ?? { n: 0, max: 0, ancho: m[2].length };
    x.n++; x.max = Math.max(x.max, Number(m[2])); x.ancho = Math.max(x.ancho, m[2].length);
    conteo.set(k, x);
  }
  const usados = new Set(codigos.map(c => c.trim().toUpperCase()));
  const [prefijo, info] = [...conteo.entries()].sort((a, b) => b[1].n - a[1].n)[0] ?? [prefijoPorDefecto, { n: 0, max: 0, ancho: 4 }];
  let n = info.max + 1, cod: string;
  do { cod = prefijo + String(n).padStart(info.ancho, '0'); n++; } while (usados.has(cod));
  return cod;
}

export type Formato = 'carta' | 'seis_por_cuatro';
export const FORMATOS: Record<Formato, string> = {
  carta: 'Hoja carta · 6 etiquetas horizontales de 4 × 3.5 pulg.',
  seis_por_cuatro: 'Etiqueta 6 × 4 pulg. horizontal · una por página',
};

type Art = Pick<Articulo, 'codigo' | 'descripcion' | 'codigo_ax' | 'ubicacion'>;
const PULG = 25.4;

/** Genera y descarga un PDF de etiquetas. `copias` repite cada etiqueta. */
export async function descargarEtiquetas(arts: Art[], formato: Formato, nombreArchivo: string, copias = 1) {
  (await crearPdfEtiquetas(arts, formato, copias)).save(nombreArchivo);
}

export async function crearPdfEtiquetas(arts: Art[], formato: Formato, copias = 1) {
  if (!arts.length) throw new Error('No hay artículos para imprimir.');
  const { jsPDF } = await import('jspdf');
  const lista = arts.flatMap(a => Array.from({ length: Math.max(1, copias) }, () => a));
  const carta = formato === 'carta';
  // Medidas en milímetros. 6 × 4 pulg. exacto; en carta, 6 por hoja (2 columnas × 3 filas) de 4 × 3.5 pulg.
  const W = carta ? 4 * PULG : 6 * PULG, H = carta ? 3.5 * PULG : 4 * PULG;
  const doc = carta
    ? new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' })
    : new jsPDF({ unit: 'mm', format: [W, H], orientation: 'landscape' });
  const x0 = carta ? (8.5 * PULG - 2 * W) / 2 : 0, y0 = carta ? (11 * PULG - 3 * H) / 2 : 0;
  lista.forEach((a, i) => {
    const k = carta ? i % 6 : 0;
    if (i > 0 && k === 0) doc.addPage();
    const x = x0 + (k % 2) * W, y = y0 + Math.floor(k / 2) * H;
    if (carta) {           // línea de corte
      doc.setDrawColor(170, 180, 190); doc.setLineWidth(0.2); doc.setLineDashPattern([1.5, 1.5], 0);
      doc.rect(x, y, W, H, 'S'); doc.setLineDashPattern([], 0);
    }
    dibujar(doc, a, x, y, W, H);
  });
  return doc;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dibujar(doc: any, a: Art, x: number, y: number, W: number, H: number) {
  const f = Math.min(W / 152.4, H / 101.6);       // escala respecto a 6 × 4 pulg.
  const m = 7 * f;                                 // margen interior (mm)
  const anchos = code128(a.codigo);
  const modulos = anchos.reduce((s, v) => s + v, 0) + 20;   // 10 módulos de zona libre a cada lado
  const anchoBarras = Math.min(W - 2 * m, modulos * 0.9);   // módulo de hasta 0.9 mm
  const mod = anchoBarras / modulos;
  const xb = x + (W - anchoBarras) / 2;
  // Descripción: hasta 2 líneas arriba.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17 * f); doc.setTextColor(0, 43, 73);
  const lineas: string[] = doc.splitTextToSize(a.descripcion ?? '', W - 2 * m).slice(0, 2);
  lineas.forEach((l, i) => doc.text(l, x + m, y + m + 5 * f + i * 7 * f));
  // Pie: código AX y ubicación.
  const yPie = y + H - m + 1 * f;
  const pie = [a.codigo_ax ? `AX ${a.codigo_ax}` : '', a.ubicacion ? `Ubicación: ${a.ubicacion}` : ''].filter(Boolean).join('   ·   ');
  if (pie) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12 * f); doc.setTextColor(60, 70, 80);
    doc.text(doc.splitTextToSize(pie, W - 2 * m)[0], x + W / 2, yPie, { align: 'center' });
  }
  // Código legible grande y barras entre la descripción y el pie.
  const yCodigo = yPie - 9 * f;
  const yb = y + m + 17 * f, altoBarras = yCodigo - 10 * f - yb;
  doc.setFillColor(0, 0, 0);
  let cx = xb + 10 * mod;
  anchos.forEach((w, i) => { if (i % 2 === 0) doc.rect(cx, yb, w * mod, altoBarras, 'F'); cx += w * mod; });
  doc.setFont('courier', 'bold'); doc.setFontSize(26 * f); doc.setTextColor(0, 0, 0);
  doc.text(a.codigo, x + W / 2, yCodigo, { align: 'center' });
}
