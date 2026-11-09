// ExcelJS se carga solo cuando se usa (importar/exportar), para que la app abra rápido en el celular.
const cargarExcelJS = async () => {
  try { return (await import('exceljs')).default; }
  catch (e) {
    // Versión nueva publicada: recargar la página (una vez) para obtener los archivos actuales.
    if (/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String((e as Error)?.message ?? e))) {
      try { if (Date.now() - Number(sessionStorage.getItem('recarga-version') ?? 0) > 60000) { sessionStorage.setItem('recarga-version', String(Date.now())); window.location.reload(); } } catch { window.location.reload(); }
      throw new Error('Se publicó una versión nueva de la aplicación. La página se está recargando; vuelva a seleccionar el archivo.');
    }
    throw e;
  }
};

export type Hoja = { nombre: string; encabezados: string[]; filas: { fila: number; celdas: Record<string, unknown> }[] };

/** Lee todas las hojas. Conserva el valor crudo de cada celda; la conversión a texto la hace aTexto(). */
export async function leerLibro(archivo: File): Promise<{ hojas: Hoja[]; hash: string }> {
  const buf = await archivo.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const hash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const ExcelJS = await cargarExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const hojas: Hoja[] = [];
  wb.eachSheet(ws => {
    const encabezados: string[] = [];
    const h = ws.getRow(1);
    h.eachCell({ includeEmpty: true }, (c, col) => { encabezados[col - 1] = String(textoCelda(c.value).texto ?? '').trim(); });
    const filas: Hoja['filas'] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const celdas: Record<string, unknown> = {};
      let alguna = false;
      encabezados.forEach((enc, i) => {
        if (!enc) return;
        const v = row.getCell(i + 1).value;
        if (v !== null && v !== undefined && v !== '') alguna = true;
        celdas[enc] = v;
      });
      if (alguna) filas.push({ fila: n, celdas });
    });
    hojas.push({ nombre: ws.name, encabezados: encabezados.filter(Boolean), filas });
  });
  return { hojas, hash };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha de Excel (ExcelJS entrega la hora "de pared" en UTC) → texto ISO local sin zona. */
function fechaIso(d: Date) {
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const conHora = d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds();
  return conHora ? `${base}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` : base;
}

/** Número de serie de Excel (sistema 1900) → ISO. */
export function serialExcel(n: number) {
  const ms = Math.round((n - 25569) * 86400 * 1000); // 25569 = días entre 1899-12-30 y 1970-01-01
  return fechaIso(new Date(ms));
}

/**
 * Convierte cualquier valor de celda a texto sin perder información:
 * - números enteros sin decimales ni notación científica (marcados como "numérico")
 * - fechas a ISO; hipervínculos y texto enriquecido a su texto; fórmulas a su resultado.
 */
export function textoCelda(v: unknown, esFecha = false): { texto: string | null; numerico: boolean } {
  if (v === null || v === undefined) return { texto: null, numerico: false };
  if (v instanceof Date) return { texto: fechaIso(v), numerico: false };
  if (typeof v === 'number') {
    if (esFecha) return { texto: serialExcel(v), numerico: false };
    const t = Number.isInteger(v) ? BigInt(v).toString() : String(v);
    return { texto: t, numerico: true };
  }
  if (typeof v === 'boolean') return { texto: v ? 'VERDADERO' : 'FALSO', numerico: false };
  if (typeof v === 'string') { const t = v.trim(); return { texto: t === '' ? null : t, numerico: false }; }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('richText' in o) return textoCelda((o.richText as { text: string }[]).map(r => r.text).join(''), esFecha);
    if ('text' in o && 'hyperlink' in o) return textoCelda(o.text, esFecha);
    if ('result' in o) return textoCelda(o.result, esFecha);
    if ('formula' in o || 'sharedFormula' in o) return { texto: null, numerico: false };
    if ('error' in o) return { texto: null, numerico: false };
  }
  return { texto: String(v), numerico: false };
}

export type Columna = { titulo: string; clave: string; ancho?: number };

/** Genera y descarga un .xlsx. Todos los códigos se escriben como texto. */
export async function descargarExcel(nombreArchivo: string, hoja: string, columnas: Columna[], filas: Record<string, unknown>[]) {
  const ExcelJS = await cargarExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(hoja.slice(0, 31));
  ws.columns = columnas.map(c => ({ header: c.titulo, key: c.clave, width: c.ancho ?? 18, style: { numFmt: '@' } }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  filas.forEach(f => ws.addRow(Object.fromEntries(columnas.map(c => {
    const v = f[c.clave];
    return [c.clave, v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v)];
  }))));
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
