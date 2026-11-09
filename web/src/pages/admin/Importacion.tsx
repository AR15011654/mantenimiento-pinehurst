import { useMemo, useState } from 'react';
import { descargarExcel, Hoja, leerLibro, textoCelda } from '../../excel';
import { rpc } from '../../lib';
import { Aviso, Campo, Titulo } from '../../ui';
import HistorialImportaciones from './HistorialImportaciones';

type Tipo = 'maquinaria' | 'personal';
type CampoDef = { clave: string; nombre: string; requerido?: boolean; fecha?: boolean; sugerencias: string[] };

const CAMPOS: Record<Tipo, CampoDef[]> = {
  maquinaria: [
    { clave: 'asset_id', nombre: 'Asset ID (clave)', requerido: true, sugerencias: ['ASSET ID'] },
    { clave: 'tipo', nombre: 'Tipo de máquina', sugerencias: ['TIPO DE MAQUINA'] },
    { clave: 'grupo', nombre: 'Grupo de máquina', sugerencias: ['GRUPO DE MAQUINA'] },
    { clave: 'serie', nombre: 'Serie', sugerencias: ['SERIE'] },
    { clave: 'fabricante', nombre: 'Fabricante', sugerencias: ['FABRICANTE'] },
    { clave: 'modelo', nombre: 'Modelo', sugerencias: ['MODEL', 'MODELO'] },
    { clave: 'ubicacion', nombre: 'Ubicación / línea (HOME LOCATION)', sugerencias: ['HOME LOCATION', 'UBICACION'] },
    { clave: 'puesto', nombre: 'Puesto (STATION)', sugerencias: ['STATION', 'PUESTO'] },
    { clave: 'estado', nombre: 'Estado del inventario', sugerencias: ['ESTADO'] },
    { clave: 'actualizado', nombre: 'Actualizado por última vez', fecha: true, sugerencias: ['ACTUALIZADO POR ULTIMA VEZ'] },
    { clave: 'fecha_compra', nombre: 'Fecha de compra/registro', fecha: true, sugerencias: ['FECHA DE COMPRA/REGISTRO'] },
    { clave: 'qr', nombre: 'QR', sugerencias: ['QR'] },
    { clave: 'especial', nombre: 'Máquina especial (CRITICA)', sugerencias: ['MAQUINA ESPECIAL'] },
    { clave: 'operacion', nombre: 'Operación (nota)', sugerencias: ['OPERACION'] },
    { clave: 'estilo', nombre: 'Estilo (nota)', sugerencias: ['ESTILO'] },
    { clave: 'observacion', nombre: 'Observación (nota)', sugerencias: ['OBSERVACION'] },
    { clave: 'frecuencia', nombre: 'Frecuencia de mantenimiento', sugerencias: ['FRECUENCIA DE MANTENIMIENTO', 'FRECUENCIA', 'PERIODICIDAD'] },
    { clave: 'area', nombre: 'Área', sugerencias: ['AREA'] },
  ],
  personal: [
    { clave: 'codigo', nombre: 'Código de empleado (clave)', requerido: true, sugerencias: ['COD_PERSONAL', 'CODIGO'] },
    { clave: 'nombre', nombre: 'Nombre', requerido: true, sugerencias: ['NOMBRE'] },
    { clave: 'cargo', nombre: 'Cargo', sugerencias: ['CARGO'] },
    { clave: 'especialidad', nombre: 'Especialidad', sugerencias: ['ESPECIALIDAD'] },
  ],
};

type FilaRes = { fila: number; clave: string | null; resultado: string; aplicable: boolean; mensajes: string[]; cambios: Record<string, { antes: string | null; despues: string | null }> };
type Respuesta = { importacion_id: string | null; aplicado: boolean; archivo_repetido: boolean; resumen: Record<string, number>; filas: FilaRes[] };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const RESULTADOS: Record<string, string> = { nuevo: 'Nuevos', modificado: 'Modificados', sin_cambios: 'Sin cambios', revision: 'En revisión', error: 'Con errores' };

export default function Importacion() {
  const [tipo, setTipo] = useState<Tipo>('maquinaria');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [hojas, setHojas] = useState<Hoja[]>([]);
  const [hash, setHash] = useState('');
  const [hojaSel, setHojaSel] = useState('');
  const [mapeo, setMapeo] = useState<Record<string, string>>({});
  const [vaciar, setVaciar] = useState<string[]>([]);
  const [aceptarNum, setAceptarNum] = useState(false);
  const [res, setRes] = useState<Respuesta | null>(null);
  const [filtro, setFiltro] = useState('revision');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [final, setFinal] = useState<Respuesta | null>(null);

  const hoja = hojas.find(h => h.nombre === hojaSel);
  const campos = CAMPOS[tipo];

  function reiniciar(t: Tipo) { setTipo(t); setArchivo(null); setHojas([]); setHojaSel(''); setMapeo({}); setRes(null); setFinal(null); setError(null); setVaciar([]); }

  async function cargarArchivo(f: File | undefined) {
    if (!f) return;
    setError(null); setRes(null); setFinal(null); setOcupado('Leyendo archivo…');
    try {
      const l = await leerLibro(f);
      setArchivo(f); setHojas(l.hojas); setHash(l.hash);
      const prob = l.hojas.find(h => campos.some(c => c.requerido && h.encabezados.some(e => c.sugerencias.includes(norm(e))))) ?? l.hojas[0];
      elegirHoja(prob?.nombre ?? '', l.hojas);
    } catch (e) { setError('No se pudo leer el archivo: ' + (e as Error).message); }
    finally { setOcupado(null); }
  }

  function elegirHoja(nombre: string, lista = hojas) {
    setHojaSel(nombre); setRes(null); setFinal(null);
    const h = lista.find(x => x.nombre === nombre);
    const m: Record<string, string> = {};
    campos.forEach(c => { const e = h?.encabezados.find(x => c.sugerencias.includes(norm(x))); if (e) m[c.clave] = e; });
    setMapeo(m);
  }

  // Filas como texto; las columnas sin mapear no se envían (no modifican nada).
  const filas = useMemo(() => {
    if (!hoja) return [];
    return hoja.filas.map(f => {
      const o: Record<string, unknown> = { fila: f.fila, numericos: [] as string[] };
      campos.forEach(c => {
        const enc = mapeo[c.clave]; if (!enc) return;
        const t = textoCelda(f.celdas[enc], c.fecha);
        o[c.clave] = t.texto;
        if (t.numerico) (o.numericos as string[]).push(c.clave);
      });
      return o;
    });
  }, [hoja, mapeo, campos]);

  const faltan = campos.filter(c => c.requerido && !mapeo[c.clave]);

  async function procesar(aplicar: boolean) {
    if (!archivo || !hoja) return;
    setError(null); setOcupado(aplicar ? 'Aplicando cambios…' : 'Validando…');
    try {
      const r = await rpc<Respuesta>(tipo === 'maquinaria' ? 'importar_maquinas' : 'importar_personal', {
        p_filas: filas, p_archivo: archivo.name, p_hoja: hoja.nombre, p_hash: hash, p_mapeo: mapeo, p_vaciar: vaciar,
        p_opciones: tipo === 'maquinaria' ? { aceptar_asset_numerico: aceptarNum } : { aceptar_codigo_numerico: aceptarNum }, p_aplicar: aplicar,
      });
      if (aplicar) setFinal(r); else setRes(r);
    } catch (e) { setError((e as Error).message + (aplicar ? ' No se aplicó ningún cambio.' : '')); }
    finally { setOcupado(null); }
  }

  async function descargarObservaciones(r: Respuesta) {
    const obs = r.filas.filter(f => f.resultado === 'error' || f.resultado === 'revision');
    await descargarExcel(`observaciones_${tipo}_${new Date().toISOString().slice(0, 10)}.xlsx`, 'Observaciones',
      [{ titulo: 'FILA EXCEL', clave: 'fila', ancho: 10 }, { titulo: 'CLAVE', clave: 'clave', ancho: 28 }, { titulo: 'RESULTADO', clave: 'resultado', ancho: 14 },
       { titulo: '¿SE APLICÓ?', clave: 'aplicado', ancho: 12 }, { titulo: 'MENSAJES', clave: 'mensajes', ancho: 90 }],
      obs.map(f => ({ ...f, aplicado: r.aplicado && f.aplicable ? 'Sí (marcada para revisión)' : 'No', mensajes: f.mensajes.join(' | ') })));
  }

  const visibles = res?.filas.filter(f => f.resultado === filtro) ?? [];

  return (
    <main className="contenido">
      <Titulo sub="Cargue el Excel cuando necesite actualizar. Después de importar, la aplicación trabaja con los datos guardados, sin depender del archivo.">Importación y actualización de datos</Titulo>
      <div className="chips">
        <button className={`chip ${tipo === 'maquinaria' ? 'activo' : ''}`} onClick={() => reiniciar('maquinaria')}>Inventario de maquinaria</button>
        <button className={`chip ${tipo === 'personal' ? 'activo' : ''}`} onClick={() => reiniciar('personal')}>Catálogo de personal</button>
      </div>

      <section className="tarjeta">
        <h2>1. Archivo y hoja</h2>
        <input type="file" accept=".xlsx" onChange={e => cargarArchivo(e.target.files?.[0])} />
        {hojas.length > 0 && (
          <Campo etiqueta="Hoja">
            <select value={hojaSel} onChange={e => elegirHoja(e.target.value)}>
              {hojas.map(h => <option key={h.nombre} value={h.nombre}>{h.nombre} ({h.filas.length} filas)</option>)}
            </select>
          </Campo>
        )}
        <p className="nota">{tipo === 'maquinaria' ? 'Regla de identificación: Asset ID (verificado sin duplicados en el archivo actual). Column1 no se importa.' : 'Regla de identificación: código de empleado como texto, con sus ceros iniciales.'} Importar personal no crea cuentas de acceso.</p>
      </section>

      {hoja && (
        <section className="tarjeta">
          <h2>2. Relacionar columnas</h2>
          <div className="mapeo">
            {campos.map(c => (
              <div key={c.clave} className="mapeo-fila">
                <span>{c.nombre}{c.requerido && ' *'}</span>
                <select value={mapeo[c.clave] ?? ''} onChange={e => { setMapeo(m => ({ ...m, [c.clave]: e.target.value })); setRes(null); }}>
                  <option value="">— No importar —</option>
                  {hoja.encabezados.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                {!c.requerido && mapeo[c.clave] && (
                  <label className="mini"><input type="checkbox" checked={vaciar.includes(c.clave)} onChange={e => setVaciar(v => e.target.checked ? [...v, c.clave] : v.filter(x => x !== c.clave))} /> Celda vacía borra el valor</label>
                )}
              </div>
            ))}
          </div>
          <label className="mini"><input type="checkbox" checked={aceptarNum} onChange={e => { setAceptarNum(e.target.checked); setRes(null); }} />
            {tipo === 'maquinaria' ? ' Aceptar Asset ID que Excel guardó como número (ya verifiqué que están completos)' : ' Aceptar códigos que Excel guardó como número'}</label>
          {faltan.length > 0 && <Aviso tipo="alerta">Falta relacionar: {faltan.map(f => f.nombre).join(', ')}</Aviso>}
          <button className="btn btn-pri btn-grande" disabled={!!ocupado || faltan.length > 0} onClick={() => procesar(false)}>Validar y ver vista previa</button>
        </section>
      )}

      {ocupado && <Aviso tipo="info">{ocupado}</Aviso>}
      {error && <Aviso tipo="error">{error}</Aviso>}

      {res && !final && (
        <section className="tarjeta">
          <h2>3. Vista previa (todavía no se guardó nada)</h2>
          {res.archivo_repetido && <Aviso tipo="alerta">Este mismo archivo ya se importó antes. Repetirlo no duplica registros.</Aviso>}
          <div className="chips">
            {Object.entries(RESULTADOS).map(([k, v]) => (
              <button key={k} className={`chip res-${k} ${filtro === k ? 'activo' : ''}`} onClick={() => setFiltro(k)}>{v}: {res.resumen[k === 'sin_cambios' ? 'sin_cambios' : k === 'nuevo' ? 'nuevos' : k === 'modificado' ? 'modificados' : k === 'error' ? 'errores' : 'revision']}</button>
            ))}
          </div>
          <p className="nota">"En revisión": las filas con Asset ID/código repetido o guardado como número NO se aplican. Las que comparten QR o serie con otra máquina sí se importan, pero quedan marcadas para revisión (no se fusionan).</p>
          <div className="tabla-scroll alto"><table className="tabla">
            <thead><tr><th>Fila</th><th>Clave</th><th>¿Se aplica?</th><th>Detalle</th></tr></thead>
            <tbody>{visibles.slice(0, 500).map(f => (
              <tr key={f.fila}><td>{f.fila}</td><td>{f.clave}</td><td>{f.aplicable ? 'Sí' : 'No'}</td>
                <td>{f.mensajes.join(' · ')}{Object.entries(f.cambios ?? {}).map(([k, v]) => <div key={k} className="cambio"><b>{k}</b>: {v.antes ?? '(vacío)'} → {v.despues ?? '(vacío)'}</div>)}</td></tr>
            ))}</tbody>
          </table></div>
          {visibles.length > 500 && <p className="nota">Se muestran 500 de {visibles.length}.</p>}
          <div className="fila-botones">
            <button className="btn btn-sec" onClick={() => descargarObservaciones(res)}>Descargar errores y revisiones</button>
            <button className="btn btn-pri btn-grande" disabled={!!ocupado} onClick={() => {
              if (confirm(`¿Aplicar la importación? Nuevos: ${res.resumen.nuevos}, modificados: ${res.resumen.modificados}. No se borrará ni desactivará ningún registro.`)) procesar(true);
            }}>Confirmar y aplicar</button>
          </div>
        </section>
      )}

      {final && (
        <section className="tarjeta">
          <h2>Resultado</h2>
          <Aviso tipo="ok">Importación aplicada. Nuevos {final.resumen.nuevos} · Modificados {final.resumen.modificados} · Sin cambios {final.resumen.sin_cambios} · En revisión {final.resumen.revision} · Errores {final.resumen.errores}</Aviso>
          <button className="btn btn-sec" onClick={() => descargarObservaciones(final)}>Descargar errores y revisiones</button>
        </section>
      )}

      <HistorialImportaciones recarga={final ? 1 : 0} />
    </main>
  );
}
