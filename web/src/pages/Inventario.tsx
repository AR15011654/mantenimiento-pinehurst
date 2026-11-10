import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { fechaHora, Maquina, mensajeError, nuevaClave, rpc, supabase } from '../lib';
import { useModulo, useSesion } from '../sesion';
import { Aviso, Cargando } from '../ui';
import LectorQR from '../LectorQR';
import { descargarExcel, leerLibro, textoCelda } from '../excel';
import { ETIQUETA_MODULO } from '../ModuloImagen';
import { Articulo, cargarArticulos, dinero, num, SelectorArticulo } from '../inventario';

type Pestana = 'existencias' | 'entrada' | 'salida' | 'movimientos' | 'catalogo';
type Mov = {
  id: number; tipo: 'entrada' | 'salida'; cantidad: number; precio_unitario: number | null; costo_total: number | null; existencia_despues: number;
  snap_empleado_codigo: string | null; snap_empleado_nombre: string | null; snap_maquina_qr: string | null; snap_maquina: string | null;
  mantenimiento_id: string | null; observacion: string | null; creado_en: string;
  articulo: { codigo: string; descripcion: string } | null;
};
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const numero = (t: string) => Number(t.replace(/[$,\s]/g, ''));

/** Inventario de repuestos de un área (módulo): existencias, entradas, salidas, movimientos y catálogo. */
export default function Inventario() {
  const { codigo } = useParams();
  const modulo = useModulo(codigo);
  const { sesion } = useSesion();
  const esAdmin = sesion?.usuario?.perfil === 'admin';
  const esTecnico = sesion?.usuario?.perfil === 'tecnico';
  const [pestana, setPestana] = useState<Pestana>('existencias');
  const [articulos, setArticulos] = useState<Articulo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (!modulo) return;
    try { setArticulos(await cargarArticulos(modulo.id, !esAdmin)); } catch (e) { setError(mensajeError(e)); }
  }, [modulo, esAdmin]);
  useEffect(() => { recargar(); }, [recargar]);

  if (!modulo) return <Navigate to="/" replace />;
  const nombre = (ETIQUETA_MODULO[modulo.codigo] ?? modulo.nombre.toUpperCase()).replace('\n', ' ');
  const activos = (articulos ?? []).filter(a => a.activo);
  const PESTANAS: [Pestana, string][] = [['existencias', 'Existencias'], ['entrada', 'Entrada'], ['salida', 'Salida'], ['movimientos', 'Movimientos'],
    ...(esAdmin ? [['catalogo', 'Catálogo'] as [Pestana, string]] : [])];

  return (
    <main className="contenido">
      <div className="form-cabecera">
        <Link to={esTecnico ? '/' : `/area/${modulo.codigo}`} className="volver" aria-label="Volver">←</Link>
        <h1>Inventario · {nombre}</h1>
      </div>
      <div className="chips">
        {PESTANAS.map(([k, t]) => <button key={k} className={`chip ${pestana === k ? 'activo' : ''}`} onClick={() => setPestana(k)}>{t}</button>)}
      </div>
      {error && <Aviso tipo="error" onReintentar={() => { setError(null); recargar(); }}>{error}</Aviso>}
      {!articulos && !error && <Cargando />}
      {articulos && activos.length === 0 && pestana !== 'catalogo' && (
        <Aviso tipo="info">Este inventario todavía no tiene repuestos en el catálogo.{esAdmin ? ' Cárguelos en la pestaña Catálogo.' : ' Pida al administrador que cargue el catálogo.'}</Aviso>
      )}
      {articulos && pestana === 'existencias' && <Existencias articulos={activos} nombre={nombre} />}
      {articulos && pestana === 'entrada' && <Movimiento tipo="entrada" articulos={activos} moduloId={modulo.id} onHecho={recargar} />}
      {articulos && pestana === 'salida' && <Movimiento tipo="salida" articulos={activos} moduloId={modulo.id} onHecho={recargar} />}
      {pestana === 'movimientos' && <Movimientos moduloId={modulo.id} nombre={nombre} />}
      {articulos && pestana === 'catalogo' && esAdmin && <Catalogo moduloId={modulo.id} articulos={articulos} onCambio={recargar} />}
    </main>
  );
}

// ---------------------------------------------------------------- Existencias
function Existencias({ articulos, nombre }: { articulos: Articulo[]; nombre: string }) {
  const [buscar, setBuscar] = useState('');
  const [soloCon, setSoloCon] = useState(false);
  const lista = useMemo(() => {
    const t = norm(buscar.trim());
    return articulos.filter(a => (!soloCon || a.existencia > 0) && (!t || norm(`${a.codigo} ${a.descripcion} ${a.codigo_ax ?? ''} ${a.ubicacion ?? ''}`).includes(t)));
  }, [articulos, buscar, soloCon]);
  const conExist = articulos.filter(a => a.existencia > 0).length;
  const valor = articulos.reduce((s, a) => s + (a.precio_usd !== null ? a.existencia * a.precio_usd : 0), 0);
  const sinPrecio = articulos.filter(a => a.precio_usd === null).length;

  return (
    <section>
      <div className="rejilla-kpi">
        <div className="kpi"><span>{articulos.length}</span>Repuestos en catálogo</div>
        <div className="kpi"><span>{conExist}</span>Con existencia</div>
        <div className="kpi"><span>{dinero(valor)}</span>Valor en existencia</div>
        <div className={`kpi ${sinPrecio ? 'alerta' : ''}`}><span>{sinPrecio}</span>Sin precio registrado</div>
      </div>
      <div className="filtros-inv">
        <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar código, nombre, AX o ubicación" />
        <label className="check"><input type="checkbox" checked={soloCon} onChange={e => setSoloCon(e.target.checked)} /> Solo con existencia</label>
        <button className="btn btn-sec btn-chico" onClick={() => descargarExcel(`inventario_${nombre.replace(/[^A-Za-z]+/g, '_')}.xlsx`, 'Inventario', [
          { titulo: 'Codigo Articulo', clave: 'codigo', ancho: 14 }, { titulo: '# Parte', clave: 'descripcion', ancho: 42 }, { titulo: 'Codigo AX', clave: 'codigo_ax', ancho: 16 },
          { titulo: 'UBICACION', clave: 'ubicacion' }, { titulo: 'Cantidad', clave: 'existencia', ancho: 10 }, { titulo: 'Precio en Dolares', clave: 'precio_usd', ancho: 16 },
          { titulo: 'Total', clave: 'total', ancho: 14 }, { titulo: 'Notas', clave: 'notas', ancho: 40 },
        ], lista.map(a => ({ ...a, total: a.precio_usd !== null ? Math.round(a.existencia * a.precio_usd * 100) / 100 : '' })))}>Descargar Excel</button>
      </div>
      <p className="nota">{lista.length} de {articulos.length} repuestos</p>
      <ul className="lista inv-lista">
        {lista.map(a => (
          <li key={a.id} className="item">
            <div className="inv-fila">
              <div><b>{a.codigo}</b> · {a.descripcion}
                <span className="item-sub">{a.codigo_ax ? `AX ${a.codigo_ax}` : 'Sin código AX'}{a.ubicacion ? ` · ${a.ubicacion}` : ''} · {dinero(a.precio_usd)}</span>
                {a.notas && <span className="item-sub">Nota: {a.notas}</span>}
              </div>
              <div className={`inv-cant ${a.existencia > 0 ? '' : 'cero'}`}>{num(a.existencia)}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- Entrada / Salida
function Movimiento({ tipo, articulos, moduloId, onHecho }: { tipo: 'entrada' | 'salida'; articulos: Articulo[]; moduloId: string; onHecho: () => Promise<void> }) {
  const { sesion } = useSesion();
  const soloPropio = sesion?.usuario?.perfil === 'tecnico' && !sesion?.usuario?.puede_registrar_otros;
  const [art, setArt] = useState<Articulo | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [precio, setPrecio] = useState('');
  const [codEmp, setCodEmp] = useState(sesion?.empleado?.codigo ?? '');
  const [obs, setObs] = useState('');
  const [qr, setQr] = useState('');
  const [maquina, setMaquina] = useState<Maquina | null>(null);
  const [errMaq, setErrMaq] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [clave, setClave] = useState(nuevaClave);

  // El artículo elegido se refresca con la existencia actual al recargar.
  useEffect(() => { if (art) setArt(articulos.find(a => a.id === art.id) ?? null); }, [articulos]); // eslint-disable-line react-hooks/exhaustive-deps

  async function buscarMaquina(c: string) {
    setMaquina(null); setErrMaq(null);
    if (!c.trim()) return;
    try {
      const r = (await rpc<Maquina[]>('buscar_por_codigo', { p_codigo: c.trim() })).filter(m => m.modulo_id === moduloId);
      if (r.length >= 1) setMaquina(r[0]); else setErrMaq(`No se encontró la máquina ${c.trim()} en esta área.`);
    } catch (e) { setErrMaq(mensajeError(e)); }
  }

  async function guardar() {
    setError(null); setOk(null);
    const cant = numero(cantidad);
    if (!art) { setError('Elija el repuesto: escriba el código completo o toque el repuesto en la lista.'); return; }
    if (!cantidad.trim() || !Number.isFinite(cant) || cant <= 0) { setError('Escriba una cantidad mayor que cero.'); return; }
    if (tipo === 'salida' && cant > art.existencia) { setError(`Solo hay ${num(art.existencia)} en existencia de ${art.codigo}.`); return; }
    if (!codEmp.trim()) { setError('Escriba el código del empleado.'); return; }
    if (tipo === 'salida' && qr.trim() && !maquina) { setError('La máquina escrita no se encontró. Corríjala o deje el campo vacío.'); return; }
    let pre: number | null = null;
    if (tipo === 'entrada' && precio.trim()) {
      pre = numero(precio);
      if (!Number.isFinite(pre) || pre < 0) { setError('El precio no es válido.'); return; }
    }
    setGuardando(true);
    try {
      const r = tipo === 'entrada'
        ? await rpc<{ existencia: number }>('inv_registrar_entrada', { p_articulo_id: art.id, p_cantidad: cant, p_precio_unitario: pre,
            p_codigo_empleado: codEmp.trim(), p_observacion: obs.trim() || null, p_idempotency_key: clave })
        : await rpc<{ existencia: number }>('inv_registrar_salida', { p_articulo_id: art.id, p_cantidad: cant, p_codigo_empleado: codEmp.trim(),
            p_maquina_id: maquina?.id ?? null, p_mantenimiento_id: null, p_observacion: obs.trim() || null, p_idempotency_key: clave });
      setOk(`${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada: ${num(cant)} de ${art.codigo} (${art.descripcion}). Existencia actual: ${num(Number(r.existencia))}.`);
      setArt(null); setCantidad(''); setPrecio(''); setObs(''); setQr(''); setMaquina(null); setClave(nuevaClave());
      await onHecho();
    } catch (e) { setError(mensajeError(e)); }
    finally { setGuardando(false); }
  }

  return (
    <div className="form-app angosto-inv">
      {ok && <Aviso tipo="ok">{ok}</Aviso>}
      {tipo === 'salida' && (
        <div className="campo">
          <span className="campo-etiqueta">QR MÁQUINA (opcional)</span>
          <div className="campo-qr">
            <input value={qr} placeholder="Escanee o escriba el código" autoCapitalize="characters"
              onChange={e => { setQr(e.target.value); setMaquina(null); setErrMaq(null); }}
              onBlur={() => { if (qr.trim() && !maquina) buscarMaquina(qr); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscarMaquina(qr); } }} />
            <LectorQR icono texto="Escanear QR de la máquina" onLeido={t => { setQr(t); buscarMaquina(t); }} />
          </div>
          {maquina && <div className="ok-linea">✓ {[maquina.tipo, maquina.fabricante, maquina.modelo].filter(Boolean).join(' · ') || maquina.asset_id} · {maquina.area ?? ''}</div>}
          {errMaq && <Aviso tipo="error">{errMaq}</Aviso>}
        </div>
      )}
      <div className="campo">
        <span className="campo-etiqueta">REPUESTO<span className="req">*</span></span>
        <SelectorArticulo articulos={articulos} elegido={art} onElegir={setArt} mostrarSinExistencia={tipo === 'entrada'} />
      </div>
      <div className="campo">
        <span className="campo-etiqueta">CANTIDAD<span className="req">*</span></span>
        <input value={cantidad} inputMode="decimal" placeholder="0" onChange={e => setCantidad(e.target.value)} />
        {tipo === 'salida' && art && <span className="nota">Disponible: {num(art.existencia)}</span>}
      </div>
      {tipo === 'entrada' && (
        <div className="campo">
          <span className="campo-etiqueta">PRECIO UNITARIO ($)</span>
          <input value={precio} inputMode="decimal" placeholder={art?.precio_usd !== null && art?.precio_usd !== undefined ? `Catálogo: ${art.precio_usd}` : '0.00'} onChange={e => setPrecio(e.target.value)} />
          <span className="nota">Si lo deja vacío se usa el precio del catálogo.</span>
        </div>
      )}
      <div className="campo">
        <span className="campo-etiqueta">CÓDIGO EMPLEADO<span className="req">*</span></span>
        <input value={codEmp} inputMode="numeric" disabled={soloPropio} placeholder="Código del empleado" onChange={e => setCodEmp(e.target.value)} />
      </div>
      <div className="campo">
        <span className="campo-etiqueta">OBSERVACIÓN</span>
        <textarea rows={2} value={obs} onChange={e => setObs(e.target.value)} placeholder={tipo === 'entrada' ? 'Proveedor, factura, requisición…' : 'Motivo o uso del repuesto'} />
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <button type="button" className="btn btn-fin" disabled={guardando} onClick={guardar}>
        {guardando ? 'Guardando…' : tipo === 'entrada' ? 'REGISTRAR ENTRADA' : 'REGISTRAR SALIDA'}
      </button>
      <p className="nota centrado">La fecha y hora las guarda el servidor.{tipo === 'salida' ? ' No se permite sacar más de lo que hay en existencia.' : ''}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Movimientos
function Movimientos({ moduloId, nombre }: { moduloId: string; nombre: string }) {
  const [movs, setMovs] = useState<Mov[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tipo, setTipo] = useState<'' | 'entrada' | 'salida'>('');
  const [buscar, setBuscar] = useState('');

  useEffect(() => {
    (async () => {
      const r = await supabase.from('inv_movimientos')
        .select('id, tipo, cantidad, precio_unitario, costo_total, existencia_despues, snap_empleado_codigo, snap_empleado_nombre, snap_maquina_qr, snap_maquina, mantenimiento_id, observacion, creado_en, articulo:inv_articulos(codigo, descripcion)')
        .eq('modulo_id', moduloId).order('id', { ascending: false }).limit(1000);
      if (r.error) setError(mensajeError(r.error)); else setMovs(r.data as unknown as Mov[]);
    })();
  }, [moduloId]);

  const lista = useMemo(() => {
    const t = norm(buscar.trim());
    return (movs ?? []).filter(m => (!tipo || m.tipo === tipo) &&
      (!t || norm(`${m.articulo?.codigo} ${m.articulo?.descripcion} ${m.snap_empleado_codigo} ${m.snap_empleado_nombre} ${m.snap_maquina_qr ?? ''} ${m.snap_maquina ?? ''} ${m.observacion ?? ''}`).includes(t)));
  }, [movs, tipo, buscar]);

  function exportar() {
    const filas = lista.map(m => ({
      id: m.id, fecha: fechaHora(m.creado_en), tipo: m.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA', cod_emp: m.snap_empleado_codigo, emp: m.snap_empleado_nombre,
      qr: m.snap_maquina_qr, maquina: m.snap_maquina, cod: m.articulo?.codigo, rep: m.articulo?.descripcion, cant: Number(m.cantidad),
      precio: m.precio_unitario === null ? '' : Number(m.precio_unitario), costo: m.costo_total === null ? '' : Number(m.costo_total),
      exist: Number(m.existencia_despues), obs: m.observacion,
    }));
    return descargarExcel(`movimientos_${nombre.replace(/[^A-Za-z]+/g, '_')}.xlsx`, 'Movimientos', [
      { titulo: 'REGISTROID', clave: 'id', ancho: 10 }, { titulo: 'FECHA', clave: 'fecha', ancho: 20 }, { titulo: 'TIPO', clave: 'tipo', ancho: 10 },
      { titulo: 'CODIGO EMPLEADO', clave: 'cod_emp' }, { titulo: 'EMPLEADO', clave: 'emp', ancho: 32 }, { titulo: 'QR MAQUINA', clave: 'qr' },
      { titulo: 'MAQUINA', clave: 'maquina', ancho: 28 }, { titulo: 'CODIGO REPUESTO', clave: 'cod' }, { titulo: 'REPUESTO', clave: 'rep', ancho: 36 },
      { titulo: 'CANTIDAD', clave: 'cant', ancho: 10 }, { titulo: 'PRECIO UNITARIO', clave: 'precio' }, { titulo: 'COSTO TOTAL', clave: 'costo' },
      { titulo: 'EXISTENCIA DESPUES', clave: 'exist' }, { titulo: 'OBSERVACION', clave: 'obs', ancho: 40 },
    ], filas);
  }

  if (error) return <Aviso tipo="error">{error}</Aviso>;
  if (!movs) return <Cargando />;
  return (
    <section>
      <div className="chips">
        {([['', 'Todos'], ['entrada', 'Entradas'], ['salida', 'Salidas']] as const).map(([k, t]) =>
          <button key={k} className={`chip chip-mini ${tipo === k ? 'activo' : ''}`} onClick={() => setTipo(k)}>{t}</button>)}
        <button className="btn btn-sec btn-chico" onClick={exportar} disabled={!lista.length}>Descargar Excel</button>
      </div>
      <input className="buscar-inv" value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar repuesto, empleado, máquina u observación" />
      {lista.length === 0 && <p className="nota">No hay movimientos{movs.length ? ' con ese filtro' : ' registrados todavía'}.</p>}
      <ul className="lista">
        {lista.map(m => (
          <li key={m.id} className="item">
            <div className="inv-fila">
              <div>
                <span className={`mov-tipo ${m.tipo}`}>{m.tipo === 'entrada' ? 'ENTRADA' : 'SALIDA'}</span> <b>{m.articulo?.codigo}</b> · {m.articulo?.descripcion}
                <span className="item-sub">{fechaHora(m.creado_en)} · {m.snap_empleado_codigo} {m.snap_empleado_nombre}</span>
                {(m.snap_maquina_qr || m.mantenimiento_id) && <span className="item-sub">
                  {m.snap_maquina_qr ? `Máquina ${m.snap_maquina_qr}${m.snap_maquina ? ` · ${m.snap_maquina}` : ''}` : ''}
                  {m.mantenimiento_id && <> · <Link to={`/trabajo/${m.mantenimiento_id}`}>Ver trabajo</Link></>}</span>}
                {m.observacion && <span className="item-sub">{m.observacion}</span>}
                <span className="item-sub">{dinero(m.costo_total)} · Existencia después: {num(Number(m.existencia_despues))}</span>
              </div>
              <div className={`inv-cant ${m.tipo}`}>{m.tipo === 'entrada' ? '+' : '−'}{num(Number(m.cantidad))}</div>
            </div>
          </li>
        ))}
      </ul>
      {movs.length === 1000 && <p className="nota">Se muestran los últimos 1,000 movimientos.</p>}
    </section>
  );
}

// ---------------------------------------------------------------- Catálogo (administrador)
type FilaImp = { fila: number; codigo: string | null; descripcion: string | null; codigo_ax: string | null; ubicacion: string | null; precio: string | null; notas: string | null };
type ResImp = { nuevos: number; modificados: number; sin_cambios: number; errores: { fila: number; mensaje: string }[]; aplicado: boolean };
const COLUMNAS: Record<keyof Omit<FilaImp, 'fila'>, string[]> = {
  codigo: ['codigo articulo', 'codigo'], descripcion: ['# parte', 'parte', 'descripcion', 'repuesto'], codigo_ax: ['codigo ax'],
  ubicacion: ['ubicacion'], precio: ['precio en dolares', 'precio'], notas: ['notas', 'nota'],
};

function Catalogo({ moduloId, articulos, onCambio }: { moduloId: string; articulos: Articulo[]; onCambio: () => Promise<void> }) {
  const [archivo, setArchivo] = useState<string | null>(null);
  const [filas, setFilas] = useState<FilaImp[] | null>(null);
  const [res, setRes] = useState<ResImp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [edit, setEdit] = useState<Partial<Articulo> | null>(null);

  async function leer(f?: File) {
    setError(null); setRes(null); setFilas(null); setArchivo(null);
    if (!f) return;
    try {
      const { hojas } = await leerLibro(f);
      const hoja = hojas.find(h => norm(h.nombre) === 'inventario') ?? hojas[0];
      if (!hoja) throw new Error('El archivo no tiene hojas.');
      const mapa: Partial<Record<keyof typeof COLUMNAS, string>> = {};
      (Object.keys(COLUMNAS) as (keyof typeof COLUMNAS)[]).forEach(k => {
        const enc = hoja.encabezados.find(e => COLUMNAS[k].includes(norm(e).trim()));
        if (enc) mapa[k] = enc;
      });
      if (!mapa.codigo || !mapa.descripcion) throw new Error(`En la hoja "${hoja.nombre}" no se encontraron las columnas "Codigo Articulo" y "# Parte".`);
      const t = (enc: string | undefined, celdas: Record<string, unknown>) => enc ? textoCelda(celdas[enc]).texto : null;
      const out = hoja.filas.map(r => ({
        fila: r.fila, codigo: t(mapa.codigo, r.celdas), descripcion: t(mapa.descripcion, r.celdas), codigo_ax: t(mapa.codigo_ax, r.celdas),
        ubicacion: t(mapa.ubicacion, r.celdas), precio: t(mapa.precio, r.celdas), notas: t(mapa.notas, r.celdas),
      }));
      setArchivo(`${f.name} / ${hoja.nombre}`); setFilas(out);
      setOcupado(true);
      setRes(await rpc<ResImp>('inv_importar_articulos', { p_modulo_id: moduloId, p_filas: out, p_archivo: f.name, p_aplicar: false }));
    } catch (e) { setError((e as Error).message); }
    finally { setOcupado(false); }
  }

  async function aplicar() {
    if (!filas || !archivo) return;
    setOcupado(true); setError(null);
    try {
      setRes(await rpc<ResImp>('inv_importar_articulos', { p_modulo_id: moduloId, p_filas: filas, p_archivo: archivo.split(' / ')[0], p_aplicar: true }));
      setFilas(null);
      await onCambio();
    } catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(false); }
  }

  async function guardarArticulo() {
    if (!edit) return;
    const precio = edit.precio_usd === null || edit.precio_usd === undefined || String(edit.precio_usd).trim() === '' ? null : numero(String(edit.precio_usd));
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) { setError('Precio no válido.'); return; }
    setOcupado(true); setError(null);
    try {
      await rpc('inv_guardar_articulo', { p_id: edit.id ?? null, p_modulo_id: moduloId, p_codigo: edit.codigo ?? '', p_descripcion: edit.descripcion ?? '',
        p_codigo_ax: edit.codigo_ax ?? null, p_ubicacion: edit.ubicacion ?? null, p_precio: precio, p_notas: edit.notas ?? null, p_activo: edit.activo ?? true });
      setEdit(null);
      await onCambio();
    } catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(false); }
  }

  const campo = (k: keyof Articulo, etiqueta: string, extra?: { decimal?: boolean }) => (
    <label className="campo"><span className="campo-etiqueta">{etiqueta}</span>
      <input value={edit?.[k] === null || edit?.[k] === undefined ? '' : String(edit[k])} inputMode={extra?.decimal ? 'decimal' : undefined}
        onChange={e => setEdit(x => ({ ...x, [k]: e.target.value }))} /></label>
  );

  return (
    <section>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="tarjeta">
        <h2>Cargar catálogo desde Excel</h2>
        <p className="nota">Se lee la hoja "Inventario" con las columnas Codigo Articulo, # Parte, Codigo AX, UBICACION, Precio en Dolares y Notas.
          El artículo se identifica por su código: importar otra vez no duplica. La importación nunca cambia las existencias, y una celda vacía no borra lo que ya está guardado.</p>
        <input type="file" accept=".xlsx" disabled={ocupado} onChange={e => { leer(e.target.files?.[0]); e.target.value = ''; }} />
        {ocupado && <Cargando texto="Procesando…" />}
        {res && (
          <div className="res-imp">
            <p><b>{res.aplicado ? 'Importación aplicada' : `Vista previa de ${archivo}`}:</b> {res.nuevos} nuevos · {res.modificados} con cambios · {res.sin_cambios} sin cambios · {res.errores.length} con error</p>
            {res.errores.length > 0 && <ul className="nota">{res.errores.map((x, i) => <li key={i}>Fila {x.fila}: {x.mensaje}</li>)}</ul>}
            {!res.aplicado && filas && (res.nuevos + res.modificados > 0) &&
              <button className="btn btn-pri" disabled={ocupado} onClick={aplicar}>Aplicar importación ({res.nuevos + res.modificados} artículos)</button>}
          </div>
        )}
      </div>

      <div className="tarjeta">
        <div className="fila-titulo"><h2>Artículos ({articulos.length})</h2>
          <button className="btn btn-sec btn-chico" onClick={() => setEdit({ activo: true })}>+ Nuevo artículo</button></div>
        {edit && (
          <div className="form-app">
            <h3>{edit.id ? `Editar ${edit.codigo}` : 'Nuevo artículo'}</h3>
            {campo('codigo', 'CÓDIGO ARTÍCULO *')}{campo('descripcion', 'DESCRIPCIÓN (# PARTE) *')}{campo('codigo_ax', 'CÓDIGO AX')}
            {campo('ubicacion', 'UBICACIÓN')}{campo('precio_usd', 'PRECIO EN DÓLARES', { decimal: true })}{campo('notas', 'NOTAS')}
            <label className="check"><input type="checkbox" checked={edit.activo ?? true} onChange={e => setEdit(x => ({ ...x, activo: e.target.checked }))} /> Activo (desmarque para dar de baja)</label>
            {edit.id && <p className="nota">Existencia actual: {num(edit.existencia)}. La existencia solo cambia con entradas y salidas.</p>}
            <div className="acciones"><button className="btn btn-pri" disabled={ocupado} onClick={guardarArticulo}>Guardar</button>
              <button className="btn btn-sec" onClick={() => setEdit(null)}>Cancelar</button></div>
          </div>
        )}
        <div className="tabla-scroll alto"><table className="tabla">
          <thead><tr><th>Código</th><th>Descripción</th><th>Código AX</th><th>Ubicación</th><th>Precio</th><th>Exist.</th><th></th></tr></thead>
          <tbody>{articulos.map(a => (
            <tr key={a.id} className={a.activo ? '' : 'inactivo'}>
              <td>{a.codigo}</td><td>{a.descripcion}{a.activo ? '' : ' (baja)'}</td><td>{a.codigo_ax ?? '—'}</td><td>{a.ubicacion ?? '—'}</td>
              <td className="num">{dinero(a.precio_usd)}</td><td className="num">{num(a.existencia)}</td>
              <td><button className="btn btn-link" onClick={() => setEdit(a)}>Editar</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </section>
  );
}
