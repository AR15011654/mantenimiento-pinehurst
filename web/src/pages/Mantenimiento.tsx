import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { duracion, fecha, fechaHora, FRECUENCIAS, mensajeError, nuevaClave, rpc, supabase, todas } from '../lib';
import { descargarExcel } from '../excel';
import { useSesion } from '../sesion';
import { Aviso, Cargando, Dato, Titulo } from '../ui';
import ModuloImagen, { ETIQUETA_MODULO } from '../ModuloImagen';

type MaqProg = {
  id: string; asset_id: string; qr: string | null; serie: string | null; tipo: string | null; fabricante: string | null;
  ubicacion: string | null; puesto: string | null; modulo_id: string | null; area_id: string | null; area: string | null;
  frecuencia: string | null; ultimo_mantenimiento_en: string | null; proximo_mantenimiento: string | null; activo: boolean; estado_inventario: string | null;
};
type Trab = {
  id: string; folio: number; tipo: string; estado: string; maquina_id: string; mecanico_id: string | null; area_id: string | null;
  snap_area: string | null; snap_maquina: string | null; snap_asset_id: string | null; snap_qr: string | null; snap_ubicacion: string | null;
  snap_mecanico_nombre: string | null; fin_en: string | null; duracion_min: number | null;
};
type Periodo = 'mes' | 'mes_anterior' | 'dias30' | 'anio';

const ZONA = 'America/Tegucigalpa';
const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
const sumarDias = (iso: string, d: number) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const diasEntre = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 864e5);
const fechaLocal = (ts: string) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date(ts));

function rango(p: Periodo): { desde: string; hasta: string; nombre: string } {
  const hoy = hoyISO(); const [a, m] = hoy.split('-').map(Number);
  const mes = (y: number, mm: number) => `${y}-${String(mm).padStart(2, '0')}-01`;
  if (p === 'mes') return { desde: mes(a, m), hasta: hoy, nombre: 'Este mes' };
  if (p === 'mes_anterior') { const y = m === 1 ? a - 1 : a, mm = m === 1 ? 12 : m - 1; return { desde: mes(y, mm), hasta: sumarDias(mes(a, m), -1), nombre: 'Mes anterior' }; }
  if (p === 'dias30') return { desde: sumarDias(hoy, -29), hasta: hoy, nombre: 'Últimos 30 días' };
  return { desde: `${a}-01-01`, hasta: hoy, nombre: 'Este año' };
}

type Estado = 'vencida' | 'por_vencer' | 'al_dia' | 'sin_registro' | 'sin_frecuencia';
const ESTADO_PROG: Record<Estado, string> = {
  vencida: 'Vencida', por_vencer: 'Vence en 7 días', al_dia: 'Al día', sin_registro: 'Sin mantenimiento registrado', sin_frecuencia: 'Sin frecuencia',
};
function estadoProg(m: MaqProg, hoy: string): Estado {
  if (!m.frecuencia) return 'sin_frecuencia';
  if (!m.proximo_mantenimiento) return 'sin_registro';
  if (m.proximo_mantenimiento < hoy) return 'vencida';
  if (m.proximo_mantenimiento <= sumarDias(hoy, 7)) return 'por_vencer';
  return 'al_dia';
}

function Barra({ valor, max, texto }: { valor: number; max: number; texto?: string }) {
  return (
    <div className="barra-fila">
      <div className="barra-fondo"><div className="barra-valor" style={{ width: `${max ? Math.max(2, (valor / max) * 100) : 0}%` }} /></div>
      <span className="barra-num">{texto ?? valor}</span>
    </div>
  );
}

/** Dashboard de mantenimiento (administrador y gerentes). Todo se limita a las áreas autorizadas de cada usuario (RLS). */
export default function Mantenimiento() {
  const { sesion } = useSesion();
  const modulos = useMemo(() => sesion?.modulos ?? [], [sesion?.modulos]);
  const [params] = useSearchParams();
  const desdeArea = modulos.find(m => m.codigo === params.get('m'));
  const [modulo, setModulo] = useState(desdeArea?.id ?? '');
  const actual = modulos.find(m => m.id === modulo);
  const [area, setArea] = useState('');
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [maqs, setMaqs] = useState<MaqProg[] | null>(null);
  const [trabs, setTrabs] = useState<Trab[] | null>(null);
  const [abiertos, setAbiertos] = useState<{ en_proceso: number }>({ en_proceso: 0 });
  const [error, setError] = useState<string | null>(null);
  const [listaProg, setListaProg] = useState<Estado>('vencida');
  const [costos, setCostos] = useState<{ rep: Record<string, number>; usd: Record<string, number>; hnl: Record<string, number>; pendiente: Record<string, number> } | null>(null);
  const areas = modulos.find(m => m.id === modulo)?.areas ?? [];
  // Al llegar desde un área (o volver al menú general) se ajusta el filtro.
  const codigoArea = params.get('m');
  useEffect(() => { setModulo(desdeArea?.id ?? ''); setArea(''); }, [codigoArea]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = rango(periodo);
  const hoy = hoyISO();

  const [maqSel, setMaqSel] = useState<string | null>(null);
  // silencioso: recarga sin vaciar la pantalla (después de guardar un costo o una factura).
  const cargar = useCallback(async (silencioso = false) => {
    setError(null); if (!silencioso) { setMaqs(null); setTrabs(null); }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filtro = (q: any) => { let x = q; if (modulo) x = x.eq('modulo_id', modulo); if (area) x = x.eq('area_id', area); return x; };
      const [m, t] = await Promise.all([
        todas<MaqProg>(() => filtro(supabase.from('v_maquinas')
          .select('id, asset_id, qr, serie, tipo, fabricante, ubicacion, puesto, modulo_id, area_id, area, frecuencia, ultimo_mantenimiento_en, proximo_mantenimiento, activo, estado_inventario')
          .eq('activo', true)).order('asset_id')),
        todas<Trab>(() => filtro(supabase.from('mantenimientos')
          .select('id, folio, tipo, estado, maquina_id, mecanico_id, area_id, snap_area, snap_maquina, snap_asset_id, snap_qr, snap_ubicacion, snap_mecanico_nombre, fin_en, duracion_min')
          .in('estado', ['pendiente_validacion', 'completado'])
          .gte('fin_en', `${r.desde}T00:00:00-06:00`).lte('fin_en', `${r.hasta}T23:59:59.999-06:00`)).order('fin_en')),
      ]);
      // Las máquinas descartadas no cuentan para la programación.
      setMaqs(m.filter(x => (x.estado_inventario ?? '').toUpperCase() !== 'DESCARTADO'));
      setTrabs(t);
      // Costos de los trabajos finalizados en el período: repuestos usados (inventario) + servicio externo.
      if (!silencioso) setCostos(null);
      const ids = t.map(x => x.id);
      const porTrab = new Map(t.map(x => [x.id, x.maquina_id]));
      const rep: Record<string, number> = {}, usd: Record<string, number> = {}, hnl: Record<string, number> = {}, pendiente: Record<string, number> = {};
      for (let i = 0; i < ids.length; i += 150) {
        const lote = ids.slice(i, i + 150);
        const [mv, se] = await Promise.all([
          supabase.from('inv_v_movimientos').select('mantenimiento_id, costo_total').eq('tipo', 'salida').in('mantenimiento_id', lote),
          supabase.from('v_servicio_externo').select('mantenimiento_id, costo, moneda').in('mantenimiento_id', lote),
        ]);
        if (mv.error) throw mv.error;
        if (se.error) throw se.error;
        (mv.data ?? []).forEach((x: { mantenimiento_id: string; costo_total: number | null }) => {
          const mq = porTrab.get(x.mantenimiento_id)!; rep[mq] = (rep[mq] ?? 0) + Number(x.costo_total ?? 0);
        });
        (se.data ?? []).forEach((x: { mantenimiento_id: string; costo: number | null; moneda: string | null }) => {
          const mq = porTrab.get(x.mantenimiento_id)!;
          if (x.costo === null) pendiente[mq] = (pendiente[mq] ?? 0) + 1;
          else if (x.moneda === 'HNL') hnl[mq] = (hnl[mq] ?? 0) + Number(x.costo);
          else usd[mq] = (usd[mq] ?? 0) + Number(x.costo);
        });
      }
      setCostos({ rep, usd, hnl, pendiente });
      const ab = await filtro(supabase.from('mantenimientos').select('estado').eq('estado', 'en_proceso'));
      setAbiertos({ en_proceso: (ab.data ?? []).length });
    } catch (e) { setError(mensajeError(e)); }
  }, [modulo, area, r.desde, r.hasta]);
  useEffect(() => { cargar(); }, [cargar]);

  // ---- Programación ----
  const prog = useMemo(() => {
    if (!maqs) return null;
    const cuenta: Record<Estado, number> = { vencida: 0, por_vencer: 0, al_dia: 0, sin_registro: 0, sin_frecuencia: 0 };
    const porArea: Record<string, Record<Estado, number>> = {};
    // Todas las áreas del alcance aparecen, aunque todavía no tengan máquinas.
    const cero = (): Record<Estado, number> => ({ vencida: 0, por_vencer: 0, al_dia: 0, sin_registro: 0, sin_frecuencia: 0 });
    modulos.filter(mo => !modulo || mo.id === modulo).forEach(mo => mo.areas.filter(a => !area || a.id === area).forEach(a => { porArea[a.nombre] = cero(); }));
    const lista: Record<Estado, (MaqProg & { dias: number | null })[]> = { vencida: [], por_vencer: [], al_dia: [], sin_registro: [], sin_frecuencia: [] };
    maqs.forEach(m => {
      const e = estadoProg(m, hoy);
      cuenta[e]++;
      const a = m.area ?? 'Sin área';
      porArea[a] = porArea[a] ?? cero();
      porArea[a][e]++;
      lista[e].push({ ...m, dias: m.proximo_mantenimiento ? diasEntre(hoy, m.proximo_mantenimiento) : null });
    });
    lista.vencida.sort((x, y) => (x.dias ?? 0) - (y.dias ?? 0));
    lista.por_vencer.sort((x, y) => (x.dias ?? 0) - (y.dias ?? 0));
    const conFrec = maqs.length - cuenta.sin_frecuencia;
    const cumplimiento = conFrec ? Math.round(((cuenta.al_dia + cuenta.por_vencer) / conFrec) * 100) : 0;
    return { cuenta, porArea, lista, conFrec, cumplimiento };
  }, [maqs, hoy, modulos, modulo, area]);

  // ---- Avance, mecánicos y máquinas ----
  const avance = useMemo(() => {
    if (!trabs) return null;
    const prev = trabs.filter(t => t.tipo === 'preventivo').length;
    const horas = trabs.reduce((s, t) => s + Number(t.duracion_min ?? 0), 0) / 60;
    const porDia: Record<string, number> = {};
    trabs.forEach(t => { if (t.fin_en) { const d = fechaLocal(t.fin_en); porDia[d] = (porDia[d] ?? 0) + 1; } });
    // Agrupar por semana (lunes) si el período es largo.
    const largo = diasEntre(r.desde, r.hasta) > 35;
    const grupos: Record<string, number> = {};
    Object.entries(porDia).forEach(([d, n]) => {
      let k = d;
      if (largo) { const x = new Date(d + 'T12:00:00Z'); const dia = (x.getUTCDay() + 6) % 7; k = sumarDias(d, -dia); }
      grupos[k] = (grupos[k] ?? 0) + n;
    });
    const serie = Object.entries(grupos).sort(([a], [b]) => a.localeCompare(b));
    const porArea: Record<string, { prev: number; corr: number }> = {};
    trabs.forEach(t => { const a = t.snap_area ?? 'Sin área'; porArea[a] = porArea[a] ?? { prev: 0, corr: 0 }; porArea[a][t.tipo === 'preventivo' ? 'prev' : 'corr']++; });
    const mec: Record<string, { nombre: string; n: number; prev: number; corr: number; min: number }> = {};
    trabs.forEach(t => {
      const k = t.mecanico_id ?? (t.snap_mecanico_nombre ? `ext:${t.snap_mecanico_nombre}` : '-');
      mec[k] = mec[k] ?? { nombre: t.snap_mecanico_nombre ?? 'Sin mecánico', n: 0, prev: 0, corr: 0, min: 0 };
      mec[k].n++; mec[k][t.tipo === 'preventivo' ? 'prev' : 'corr']++; mec[k].min += Number(t.duracion_min ?? 0);
    });
    // Máquinas con mantenimientos (preventivos y correctivos), la más recientemente registrada primero.
    const maq: Record<string, { id: string; nombre: string; asset: string; area: string; prev: number; corr: number; min: number; ultimo: string }> = {};
    trabs.forEach(t => {
      maq[t.maquina_id] = maq[t.maquina_id] ?? { id: t.maquina_id, nombre: `${t.snap_maquina ?? ''}`, asset: t.snap_qr ?? t.snap_asset_id ?? '', area: t.snap_area ?? '', prev: 0, corr: 0, min: 0, ultimo: '' };
      const x = maq[t.maquina_id];
      x[t.tipo === 'preventivo' ? 'prev' : 'corr']++; x.min += Number(t.duracion_min ?? 0);
      if (t.fin_en && t.fin_en > x.ultimo) x.ultimo = t.fin_en;
    });
    return {
      total: trabs.length, prev, corr: trabs.length - prev, horas, largo, serie,
      porArea: Object.entries(porArea).sort((a, b) => (b[1].prev + b[1].corr) - (a[1].prev + a[1].corr)),
      mecanicos: Object.values(mec).sort((a, b) => b.n - a.n),
      maquinas: Object.values(maq).sort((a, b) => b.ultimo.localeCompare(a.ultimo)),
    };
  }, [trabs, r.desde, r.hasta]);

  async function exportarProgramacion() {
    if (!maqs) return;
    await descargarExcel(`programacion_${hoy}.xlsx`, 'Programación', [
      { titulo: 'ESTADO', clave: 'estado', ancho: 26 }, { titulo: 'AREA', clave: 'area' }, { titulo: 'TIPO', clave: 'tipo', ancho: 22 },
      { titulo: 'QR', clave: 'qr' }, { titulo: 'SERIE', clave: 'serie' }, { titulo: 'Asset ID', clave: 'asset_id', ancho: 26 },
      { titulo: 'UBICACION', clave: 'ubicacion' }, { titulo: 'FRECUENCIA', clave: 'frecuencia' },
      { titulo: 'ULTIMO MANTENIMIENTO', clave: 'ultimo' }, { titulo: 'PROXIMO MANTENIMIENTO', clave: 'proximo_mantenimiento' }, { titulo: 'DIAS (negativo = atraso)', clave: 'dias' },
    ], maqs.map(m => ({ ...m, estado: ESTADO_PROG[estadoProg(m, hoy)], ultimo: m.ultimo_mantenimiento_en ? fechaLocal(m.ultimo_mantenimiento_en) : '',
      dias: m.proximo_mantenimiento ? diasEntre(hoy, m.proximo_mantenimiento) : '' })));
  }

  const maxSerie = Math.max(1, ...(avance?.serie.map(s => s[1]) ?? [1]));
  const maxArea = Math.max(1, ...(avance?.porArea.map(([, v]) => v.prev + v.corr) ?? [1]));
  const visibles = prog?.lista[listaProg] ?? [];

  return (
    <main className="contenido">
      {desdeArea ? (
        <div className="form-cabecera">
          <Link to={`/area/${desdeArea.codigo}`} className="volver" aria-label="Volver al área">←</Link>
          <h1>Mantenimiento · {actual?.nombre ?? 'Todos los módulos'}</h1>
        </div>
      ) : <Titulo sub="Programación, avance y desempeño de sus áreas.">Mantenimiento</Titulo>}

      <div className="filtros-dash">
        <select value={modulo} onChange={e => { setModulo(e.target.value); setArea(''); }} aria-label="Módulo">
          <option value="">Todos los módulos</option>
          {modulos.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
        <select value={area} onChange={e => setArea(e.target.value)} disabled={!modulo} aria-label="Área">
          <option value="">Todas las áreas</option>
          {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <select value={periodo} onChange={e => setPeriodo(e.target.value as Periodo)} aria-label="Período">
          <option value="mes">Este mes</option><option value="mes_anterior">Mes anterior</option>
          <option value="dias30">Últimos 30 días</option><option value="anio">Este año</option>
        </select>
      </div>

      <div className="accesos">
        <Link to="/trabajos?e=en_proceso" className="acceso"><b>{abiertos.en_proceso}</b> En proceso</Link>
        <Link to="/trabajos?e=completado" className="acceso">Completados</Link>
        <Link to="/historial" className="acceso">Historial y exportación</Link>
      </div>

      <h2 className="seccion">Registrar mantenimiento</h2>
      <div className="rejilla-app chica">
        {modulos.filter(m => !modulo || m.id === modulo).map(m => (
          <Link key={m.id} to={`/m/${m.codigo}`} className="tile">
            <ModuloImagen codigo={m.codigo} etiqueta={ETIQUETA_MODULO[m.codigo] ?? m.nombre.toUpperCase()} />
          </Link>
        ))}
      </div>

      {error && <Aviso tipo="error" onReintentar={() => cargar()}>{error}</Aviso>}
      {(!prog || !avance) && !error && <Cargando texto="Calculando indicadores…" />}

      {prog && (
        <section className="tarjeta">
          <h2>Programación de mantenimiento (hoy {fecha(hoy)})</h2>
          <div className="rejilla-kpi">
            <div className="kpi"><span>{prog.cumplimiento}%</span>Sin vencer (de {prog.conFrec} con frecuencia)</div>
            <button className={`kpi kpi-btn ${listaProg === 'vencida' ? 'sel' : ''} ${prog.cuenta.vencida ? 'malo' : ''}`} onClick={() => setListaProg('vencida')}><span>{prog.cuenta.vencida}</span>Vencidas</button>
            <button className={`kpi kpi-btn ${listaProg === 'por_vencer' ? 'sel' : ''} ${prog.cuenta.por_vencer ? 'alerta' : ''}`} onClick={() => setListaProg('por_vencer')}><span>{prog.cuenta.por_vencer}</span>Vencen en 7 días</button>
            <button className={`kpi kpi-btn ${listaProg === 'al_dia' ? 'sel' : ''}`} onClick={() => setListaProg('al_dia')}><span>{prog.cuenta.al_dia}</span>Al día</button>
            <button className={`kpi kpi-btn ${listaProg === 'sin_registro' ? 'sel' : ''}`} onClick={() => setListaProg('sin_registro')}><span>{prog.cuenta.sin_registro}</span>Sin primer mantenimiento</button>
            <button className={`kpi kpi-btn ${listaProg === 'sin_frecuencia' ? 'sel' : ''}`} onClick={() => setListaProg('sin_frecuencia')}><span>{prog.cuenta.sin_frecuencia}</span>Sin frecuencia</button>
          </div>
          <h3>{ESTADO_PROG[listaProg]} ({visibles.length})</h3>
          {visibles.length === 0 && <p className="nota">No hay máquinas en este grupo.</p>}
          {visibles.length > 0 && (
            <div className="tabla-scroll alto"><table className="tabla">
              <thead><tr><th>Máquina</th><th>QR / Serie</th><th>Área · Ubicación</th><th>Frecuencia</th><th>Último</th><th>Próximo</th></tr></thead>
              <tbody>{visibles.slice(0, 300).map(m => (
                <tr key={m.id}>
                  <td><Link to={`/maquina/${m.id}`}>{m.tipo ?? m.asset_id}</Link>{m.fabricante ? <span className="nota"> · {m.fabricante}</span> : null}</td>
                  <td>{m.qr ?? '—'}<br /><span className="nota">{m.serie ?? ''}</span></td>
                  <td>{m.area ?? '—'}<br /><span className="nota">{m.ubicacion ?? ''}{m.puesto ? ` / ${m.puesto}` : ''}</span></td>
                  <td>{m.frecuencia ? FRECUENCIAS[m.frecuencia] ?? m.frecuencia : '—'}</td>
                  <td>{m.ultimo_mantenimiento_en ? fecha(fechaLocal(m.ultimo_mantenimiento_en)) : '—'}</td>
                  <td>{fecha(m.proximo_mantenimiento)}{m.dias !== null && m.dias < 0 && <span className="insignia critica">{-m.dias} días de atraso</span>}{m.dias !== null && m.dias >= 0 && m.dias <= 7 && <span className="nota"> · en {m.dias} días</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {visibles.length > 300 && <p className="nota">Se muestran 300 de {visibles.length}. Descargue el Excel para verlas todas.</p>}
          <button className="btn btn-sec" onClick={exportarProgramacion}>Descargar programación en Excel</button>

          <p className="nota">"Sin primer mantenimiento": la máquina tiene frecuencia, pero todavía no se le ha registrado ningún mantenimiento en esta aplicación; su próxima fecha se calcula al registrar el primero.</p>

          <div className="tabla-scroll"><table className="tabla">
            <thead><tr><th>Área</th><th>Vencidas</th><th>Vencen 7 días</th><th>Al día</th><th>Sin primer mant.</th><th>Sin frecuencia</th></tr></thead>
            <tbody>{Object.entries(prog.porArea).sort(([a], [b]) => a.localeCompare(b)).map(([a, v]) => (
              <tr key={a}><td>{a}</td><td className={v.vencida ? 'num malo' : 'num'}>{v.vencida}</td><td className="num">{v.por_vencer}</td><td className="num">{v.al_dia}</td><td className="num">{v.sin_registro}</td><td className="num">{v.sin_frecuencia}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      {avance && (
        <section className="tarjeta">
          <h2>Máquinas con mantenimientos · {r.nombre}</h2>
          {avance.maquinas.length === 0 ? <p className="nota">Sin mantenimientos finalizados en el período.</p> : (
            <>
              <div className="tabla-scroll"><table className="tabla">
                <thead><tr><th>Máquina</th><th>QR</th><th>Área</th><th>Preventivos</th><th>Correctivos</th><th>Último registro</th><th>Tiempo en mantenimiento</th></tr></thead>
                <tbody>{avance.maquinas.map(m => (
                  <tr key={m.id} className={maqSel === m.id ? 'fila-sel' : ''}>
                    <td><button type="button" className="btn btn-link enlace-celda" aria-expanded={maqSel === m.id}
                      onClick={() => setMaqSel(maqSel === m.id ? null : m.id)}>{m.nombre || m.asset} {maqSel === m.id ? '▲' : '▼'}</button></td>
                    <td>{m.asset}</td><td>{m.area}</td><td className="num">{m.prev}</td><td className="num">{m.corr}</td><td>{fechaHora(m.ultimo)}</td><td>{duracion(m.min)}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <p className="nota">Ordenadas por el registro más reciente. Toque una máquina para ver su información, sus mantenimientos y registrar costos o facturas.</p>
              {maqSel && avance.maquinas.some(m => m.id === maqSel) && (
                <DetalleMaquinaCorrectivos key={maqSel} maquinaId={maqSel} maq={maqs?.find(x => x.id === maqSel) ?? null}
                  trabajos={(trabs ?? []).filter(t => t.maquina_id === maqSel).sort((a, b) => (b.fin_en ?? '').localeCompare(a.fin_en ?? ''))}
                  onCerrar={() => setMaqSel(null)} onGuardado={() => cargar(true)} />
              )}
            </>
          )}
        </section>
      )}

      {avance && (
        <>
          <section className="tarjeta">
            <h2>Avance · {r.nombre} ({fecha(r.desde)} – {fecha(r.hasta)})</h2>
            <div className="rejilla-kpi">
              <div className="kpi"><span>{avance.total}</span>Mantenimientos finalizados</div>
              <div className="kpi"><span>{avance.prev}</span>Preventivos</div>
              <div className="kpi"><span>{avance.corr}</span>Correctivos</div>
              <div className="kpi"><span>{avance.horas.toFixed(1)}</span>Horas de mantenimiento</div>
            </div>
            {avance.total === 0 && <p className="nota">Todavía no hay mantenimientos finalizados en este período.</p>}
            {avance.serie.length > 0 && (
              <>
                <h3>{avance.largo ? 'Por semana (inicia lunes)' : 'Por día'}</h3>
                {avance.serie.map(([d, n]) => <div key={d} className="barra-linea"><span className="barra-etq">{fecha(d)}</span><Barra valor={n} max={maxSerie} /></div>)}
              </>
            )}
            {avance.porArea.length > 0 && (
              <>
                <h3>Por área (preventivo / correctivo)</h3>
                {avance.porArea.map(([a, v]) => (
                  <div key={a} className="barra-linea"><span className="barra-etq">{a}</span><Barra valor={v.prev + v.corr} max={maxArea} texto={`${v.prev} / ${v.corr}`} /></div>
                ))}
              </>
            )}
          </section>

          <section className="tarjeta">
            <h2>Desempeño de mecánicos · {r.nombre}</h2>
            {avance.mecanicos.length === 0 ? <p className="nota">Sin trabajos finalizados en el período.</p> : (
              <div className="tabla-scroll"><table className="tabla">
                <thead><tr><th>Mecánico</th><th>Trabajos</th><th>Preventivos</th><th>Correctivos</th><th>Tiempo total</th><th>Promedio</th></tr></thead>
                <tbody>{avance.mecanicos.map(m => (
                  <tr key={m.nombre}><td>{m.nombre}</td><td className="num">{m.n}</td><td className="num">{m.prev}</td><td className="num">{m.corr}</td><td>{duracion(m.min)}</td><td>{duracion(m.n ? m.min / m.n : 0)}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>

          <CostosMaquina trabs={trabs!} maqs={maqs!} costos={costos} periodo={`${r.nombre} (${fecha(r.desde)} – ${fecha(r.hasta)})`} />

        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- Costo de mantenimiento por máquina
const usd = (n: number) => '$ ' + n.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lps = (n: number) => 'L ' + n.toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function CostosMaquina({ trabs, maqs, costos, periodo }: {
  trabs: Trab[]; maqs: MaqProg[];
  costos: { rep: Record<string, number>; usd: Record<string, number>; hnl: Record<string, number>; pendiente: Record<string, number> } | null; periodo: string;
}) {
  const [todasLasMaq, setTodasLasMaq] = useState(false);
  const filas = useMemo(() => {
    if (!costos) return [];
    const info = new Map(maqs.map(m => [m.id, m]));
    const porMaq: Record<string, { id: string; nombre: string; serie: string; qr: string; area: string; trabajos: number; prev: number; corr: number }> = {};
    trabs.forEach(t => {
      const m = info.get(t.maquina_id);
      porMaq[t.maquina_id] = porMaq[t.maquina_id] ?? {
        id: t.maquina_id,
        nombre: (m ? [m.tipo, m.fabricante].filter(Boolean).join(' · ') : '') || t.snap_maquina || t.snap_asset_id || '—',
        serie: m?.serie ?? '—', qr: m?.qr ?? t.snap_qr ?? t.snap_asset_id ?? '—', area: m?.area ?? t.snap_area ?? '—', trabajos: 0, prev: 0, corr: 0,
      };
      porMaq[t.maquina_id].trabajos++; porMaq[t.maquina_id][t.tipo === 'preventivo' ? 'prev' : 'corr']++;
    });
    return Object.values(porMaq).map(f => {
      const rep = costos.rep[f.id] ?? 0, ext = costos.usd[f.id] ?? 0, extL = costos.hnl[f.id] ?? 0;
      return { ...f, rep, ext, extL, totalUsd: rep + ext, pendientes: costos.pendiente[f.id] ?? 0 };
    }).sort((a, b) => b.totalUsd - a.totalUsd || b.extL - a.extL || b.trabajos - a.trabajos);
  }, [trabs, maqs, costos]);

  const conCosto = filas.filter(f => f.totalUsd > 0 || f.extL > 0);
  const visibles = todasLasMaq ? filas : conCosto;
  const tot = filas.reduce((s, f) => ({ rep: s.rep + f.rep, ext: s.ext + f.ext, extL: s.extL + f.extL, pend: s.pend + f.pendientes }), { rep: 0, ext: 0, extL: 0, pend: 0 });

  return (
    <section className="tarjeta">
      <h2>Costo de mantenimiento por máquina · {periodo}</h2>
      {!costos ? <Cargando texto="Calculando costos…" /> : (
        <>
          <div className="rejilla-kpi">
            <div className="kpi"><span>{usd(tot.rep + tot.ext)}</span>Total en dólares</div>
            <div className="kpi"><span>{usd(tot.rep)}</span>Repuestos usados</div>
            <div className="kpi"><span>{usd(tot.ext)}</span>Servicio externo (USD)</div>
            <div className="kpi"><span>{lps(tot.extL)}</span>Servicio externo (HNL)</div>
          </div>
          {tot.pend > 0 && <Aviso tipo="alerta">{tot.pend} servicio(s) externo(s) sin costo registrado. Regístrelo en el detalle del trabajo para que se sume aquí.</Aviso>}
          <div className="filtros-inv">
            <label className="check"><input type="checkbox" checked={todasLasMaq} onChange={e => setTodasLasMaq(e.target.checked)} /> Mostrar también máquinas con trabajos pero sin costo</label>
            <button className="btn btn-sec btn-chico" disabled={!visibles.length} onClick={() => descargarExcel(`costos_mantenimiento_${hoyISO()}.xlsx`, 'Costos por maquina', [
              { titulo: 'MAQUINA', clave: 'nombre', ancho: 32 }, { titulo: 'SERIE', clave: 'serie', ancho: 18 }, { titulo: 'QR', clave: 'qr' }, { titulo: 'AREA', clave: 'area', ancho: 22 },
              { titulo: 'TRABAJOS', clave: 'trabajos', ancho: 10 }, { titulo: 'PREVENTIVOS', clave: 'prev', ancho: 12 }, { titulo: 'CORRECTIVOS', clave: 'corr', ancho: 12 },
              { titulo: 'REPUESTOS USD', clave: 'rep', ancho: 14 }, { titulo: 'SERVICIO EXTERNO USD', clave: 'ext', ancho: 18 }, { titulo: 'SERVICIO EXTERNO HNL', clave: 'extL', ancho: 18 },
              { titulo: 'TOTAL USD', clave: 'totalUsd', ancho: 12 }, { titulo: 'SERV. EXTERNO SIN COSTO', clave: 'pendientes', ancho: 14 },
            ], visibles.map(f => ({ ...f, rep: Math.round(f.rep * 100) / 100, ext: Math.round(f.ext * 100) / 100, extL: Math.round(f.extL * 100) / 100, totalUsd: Math.round(f.totalUsd * 100) / 100 })))}>Descargar Excel</button>
          </div>
          {visibles.length === 0 ? <p className="nota">{filas.length ? 'Ninguna máquina tiene costos registrados en el período.' : 'Sin trabajos finalizados en el período.'}</p> : (
            <div className="tabla-scroll alto"><table className="tabla">
              <thead><tr><th>Máquina</th><th>Serie</th><th>QR</th><th>Área</th><th>Trabajos</th><th>Repuestos</th><th>Servicio externo</th><th>Total USD</th></tr></thead>
              <tbody>{visibles.map(f => (
                <tr key={f.id}>
                  <td><Link to={`/maquina/${f.id}`}>{f.nombre}</Link></td><td>{f.serie}</td><td>{f.qr}</td><td>{f.area}</td>
                  <td className="num">{f.trabajos}</td><td className="num">{f.rep ? usd(f.rep) : '—'}</td>
                  <td className="num">{[f.ext ? usd(f.ext) : '', f.extL ? lps(f.extL) : '', f.pendientes ? `${f.pendientes} sin costo` : ''].filter(Boolean).join(' + ') || '—'}</td>
                  <td className="num"><b>{usd(f.totalUsd)}</b></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="nota">Incluye los trabajos finalizados en el período. Repuestos: salidas del inventario ligadas al trabajo, al precio del catálogo. Los servicios externos en lempiras se muestran aparte y no se suman al total en dólares.</p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Detalle de una máquina con correctivos
type Externo = { mantenimiento_id: string; proveedor: string; costo: number | null; moneda: string | null };
type Doc = { id: string; mantenimiento_id: string; ruta: string; nombre_original: string | null; tipo_mime: string | null; url?: string };
const TIPOS_FACTURA: Record<string, string> = {
  pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};
const iconoDoc = (mime: string | null) => mime === 'application/pdf' ? '📄' : (mime ?? '').includes('sheet') || mime === 'application/vnd.ms-excel' ? '📊' : '🖼️';

function DetalleMaquinaCorrectivos({ maquinaId, maq, trabajos, onCerrar, onGuardado }: {
  maquinaId: string; maq: MaqProg | null; trabajos: Trab[]; onCerrar: () => void; onGuardado: () => void;
}) {
  const [info, setInfo] = useState<Record<string, string | null> | null>(null);
  const [ext, setExt] = useState<Record<string, Externo>>({});
  const [docs, setDocs] = useState<Record<string, Doc[]>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const ids = trabajos.map(t => t.id).join(',');

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const lista = ids ? ids.split(',') : [];
      const [mq, se, dc] = await Promise.all([
        supabase.from('v_maquinas').select('*').eq('id', maquinaId).maybeSingle(),
        lista.length ? supabase.from('v_servicio_externo').select('mantenimiento_id, proveedor, costo, moneda').in('mantenimiento_id', lista) : Promise.resolve({ data: [], error: null }),
        lista.length ? supabase.from('mantenimiento_documentos').select('id, mantenimiento_id, ruta, nombre_original, tipo_mime').in('mantenimiento_id', lista).order('creado_en') : Promise.resolve({ data: [], error: null }),
      ]);
      if (mq.error) throw mq.error; if (se.error) throw se.error; if (dc.error) throw dc.error;
      setInfo((mq.data ?? null) as Record<string, string | null> | null);
      setExt(Object.fromEntries(((se.data ?? []) as Externo[]).map(x => [x.mantenimiento_id, x])));
      const ds = (dc.data ?? []) as Doc[];
      if (ds.length) {
        const s = await supabase.storage.from('mant-evidencias').createSignedUrls(ds.map(d => d.ruta), 3600);
        ds.forEach((d, i) => { d.url = s.data?.[i]?.signedUrl ?? undefined; });
      }
      const porT: Record<string, Doc[]> = {};
      ds.forEach(d => { (porT[d.mantenimiento_id] ??= []).push(d); });
      setDocs(porT);
    } catch (e) { setError(mensajeError(e)); }
    finally { setCargando(false); }
  }, [maquinaId, ids]);
  useEffect(() => { cargar(); }, [cargar]);

  const v = (k: string) => info?.[k] ?? null;
  const nombre = [v('tipo') ?? maq?.tipo, v('fabricante') ?? maq?.fabricante, v('modelo')].filter(Boolean).join(' · ') || trabajos[0]?.snap_maquina || '—';
  const montoTxt = (x?: Externo) => !x ? '—' : x.costo === null ? `${x.proveedor} · sin costo` : `${x.proveedor} · ${x.moneda === 'HNL' ? lps(Number(x.costo)) : usd(Number(x.costo))}`;

  return (
    <div className="detalle-maquina">
      <div className="detalle-cabecera">
        <h3>{nombre}</h3>
        <button type="button" className="btn btn-link" onClick={onCerrar} aria-label="Cerrar detalle">✕ Cerrar</button>
      </div>
      {error && <Aviso tipo="error" onReintentar={cargar}>{error}</Aviso>}
      {cargando ? <Cargando texto="Cargando máquina…" /> : (
        <>
          <dl className="datos">
            <Dato k="QR / Serie" v={`${v('qr') ?? maq?.qr ?? '—'} / ${v('serie') ?? maq?.serie ?? '—'}`} />
            <Dato k="Asset ID" v={v('asset_id') ?? maq?.asset_id} />
            <Dato k="Área" v={v('area') ?? maq?.area} />
            <Dato k="Ubicación" v={`${v('ubicacion') ?? maq?.ubicacion ?? '—'}${(v('puesto') ?? maq?.puesto) ? ' / ' + (v('puesto') ?? maq?.puesto) : ''}`} />
            <Dato k="Frecuencia" v={(v('frecuencia') ?? maq?.frecuencia) ? FRECUENCIAS[(v('frecuencia') ?? maq?.frecuencia)!] ?? v('frecuencia') : 'Sin definir'} />
            <Dato k="Próximo mantenimiento" v={fecha(v('proximo_mantenimiento') ?? maq?.proximo_mantenimiento)} />
          </dl>
          <p><Link to={`/maquina/${maquinaId}`}>Ver ficha completa de la máquina</Link></p>

          <h3>Mantenimientos del período ({trabajos.length})</h3>
          <div className="lista">
            {trabajos.map(t => (
              <div key={t.id} className="corr-item">
                <div className="corr-linea">
                  <div>
                    <Link to={`/trabajo/${t.id}`}><b>#{t.folio}</b></Link> · <span className={`insignia ${t.tipo === 'correctivo' ? 'tipo-corr' : 'tipo-prev'}`}>{t.tipo === 'correctivo' ? 'Correctivo' : 'Preventivo'}</span> · {fechaHora(t.fin_en)}
                    <br /><span className="nota">{t.snap_mecanico_nombre ?? '—'} · {duracion(t.duracion_min)}</span>
                    <br /><span className="nota">Servicio externo: {montoTxt(ext[t.id])} · Facturas: {docs[t.id]?.length ?? 0}</span>
                  </div>
                  {edit !== t.id && <button type="button" className="btn btn-sec btn-chico" onClick={() => setEdit(t.id)}>Editar</button>}
                </div>
                {(docs[t.id] ?? []).length > 0 && (
                  <div className="doc-lista">{docs[t.id].map(d => d.url
                    ? <a key={d.id} href={d.url} target="_blank" rel="noreferrer">{iconoDoc(d.tipo_mime)} {d.nombre_original ?? 'Factura'}</a>
                    : <span key={d.id}>{d.nombre_original ?? 'Factura'} (no disponible)</span>)}</div>
                )}
                {edit === t.id && (
                  <EditarCostoFactura trabajo={t} externo={ext[t.id]} onCancelar={() => setEdit(null)}
                    onGuardado={async () => { setEdit(null); await cargar(); onGuardado(); }} />
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EditarCostoFactura({ trabajo, externo, onCancelar, onGuardado }: {
  trabajo: Trab; externo?: Externo; onCancelar: () => void; onGuardado: () => void;
}) {
  const [proveedor, setProveedor] = useState(externo?.proveedor ?? '');
  const [costo, setCosto] = useState(externo?.costo === null || externo?.costo === undefined ? '' : String(externo.costo));
  const [moneda, setMoneda] = useState(externo?.moneda ?? 'USD');
  const [archivos, setArchivos] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function agregar(lista: FileList | null) {
    setError(null);
    const nuevos: File[] = [];
    for (const f of Array.from(lista ?? [])) {
      const ext = (f.name.split('.').pop() ?? '').toLowerCase();
      if (!TIPOS_FACTURA[ext]) { setError(`${f.name}: solo se aceptan PDF, Excel (.xlsx, .xls) o imagen.`); continue; }
      if (f.size > 10 * 1024 * 1024) { setError(`${f.name}: el archivo pasa de 10 MB.`); continue; }
      nuevos.push(f);
    }
    setArchivos(a => [...a, ...nuevos]);
  }

  async function guardar() {
    setError(null);
    const txt = costo.replace(/[$,\s]/g, ''); const n = Number(txt);
    if (txt && (!Number.isFinite(n) || n < 0)) { setError('El costo no es válido.'); return; }
    if (txt && !proveedor.trim()) { setError('Escriba el proveedor para registrar el costo.'); return; }
    if (!proveedor.trim() && externo) { setError('El proveedor no puede quedar vacío.'); return; }
    const cambiaCosto = proveedor.trim() !== (externo?.proveedor ?? '') || (txt ? n : null) !== (externo?.costo ?? null) || (txt && moneda !== (externo?.moneda ?? 'USD'));
    if (!cambiaCosto && archivos.length === 0) { setError('No hay cambios que guardar.'); return; }
    setOcupado(true);
    try {
      if (proveedor.trim() && cambiaCosto) {
        await rpc('registrar_servicio_externo', { p_mantenimiento_id: trabajo.id, p_proveedor: proveedor.trim(), p_costo: txt ? n : null, p_moneda: txt ? moneda : null });
      }
      for (const f of archivos) {
        const ext = (f.name.split('.').pop() ?? '').toLowerCase(); const mime = TIPOS_FACTURA[ext];
        const ruta = `${trabajo.id}/docs/${nuevaClave()}.${ext}`;
        const up = await supabase.storage.from('mant-evidencias').upload(ruta, f, { contentType: mime, upsert: false });
        if (up.error) throw new Error(`No se pudo subir ${f.name}: ${mensajeError(up.error)}`);
        await rpc('registrar_documento', { p_mantenimiento_id: trabajo.id, p_ruta: ruta, p_nombre: f.name, p_mime: mime, p_tamano: f.size });
        setArchivos(a => a.filter(x => x !== f));
      }
      onGuardado();
    } catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(false); }
  }

  return (
    <div className="bloque-externo">
      <div className="campo">
        <span className="campo-etiqueta">PROVEEDOR</span>
        <input value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Nombre del proveedor o taller" />
      </div>
      <div className="campo">
        <span className="campo-etiqueta">COSTO</span>
        <div className="campo-costo">
          <input value={costo} inputMode="decimal" placeholder="0.00" onChange={e => setCosto(e.target.value)} />
          <select value={moneda} onChange={e => setMoneda(e.target.value)} aria-label="Moneda">
            <option value="USD">USD $</option><option value="HNL">HNL L</option>
          </select>
        </div>
      </div>
      <div className="campo">
        <span className="campo-etiqueta">FACTURA</span>
        <label className="caja-foto caja-factura">
          <span>📎 Subir factura (PDF, Excel o imagen)</span>
          <input type="file" multiple accept=".pdf,.xlsx,.xls,image/*,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={e => { agregar(e.target.files); e.target.value = ''; }} />
        </label>
        {archivos.length > 0 && (
          <div className="doc-lista">{archivos.map((f, i) => (
            <span key={i}>{iconoDoc(TIPOS_FACTURA[(f.name.split('.').pop() ?? '').toLowerCase()])} {f.name}
              <button type="button" className="btn btn-link peligro" aria-label="Quitar archivo" onClick={() => setArchivos(a => a.filter(x => x !== f))}>✕</button></span>
          ))}</div>
        )}
        <span className="nota">Hasta 10 MB por archivo. Se guarda en el trabajo #{trabajo.folio}.</span>
      </div>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="fila-botones">
        <button type="button" className="btn btn-pri" disabled={ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="btn btn-sec" disabled={ocupado} onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
