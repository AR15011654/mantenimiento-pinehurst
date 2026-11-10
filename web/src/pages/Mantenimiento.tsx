import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { duracion, fecha, FRECUENCIAS, mensajeError, supabase, todas } from '../lib';
import { descargarExcel } from '../excel';
import { useSesion } from '../sesion';
import { Aviso, Cargando, Titulo } from '../ui';
import ModuloImagen, { ETIQUETA_MODULO } from '../ModuloImagen';

type MaqProg = {
  id: string; asset_id: string; qr: string | null; serie: string | null; tipo: string | null; fabricante: string | null;
  ubicacion: string | null; puesto: string | null; modulo_id: string | null; area_id: string | null; area: string | null;
  frecuencia: string | null; ultimo_mantenimiento_en: string | null; proximo_mantenimiento: string | null; activo: boolean; estado_inventario: string | null;
};
type Trab = {
  id: string; tipo: string; estado: string; maquina_id: string; mecanico_id: string | null; area_id: string | null;
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

/** Dashboard de mantenimiento para gerentes de área y administrador. Todo se limita a las áreas autorizadas (RLS). */
export default function Mantenimiento() {
  const { sesion } = useSesion();
  const modulos = sesion?.modulos ?? [];
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
  const areas = modulos.find(m => m.id === modulo)?.areas ?? [];
  // Al llegar desde un área (o volver al menú general) se ajusta el filtro.
  const codigoArea = params.get('m');
  useEffect(() => { setModulo(desdeArea?.id ?? ''); setArea(''); }, [codigoArea]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = rango(periodo);
  const hoy = hoyISO();

  const cargar = useCallback(async () => {
    setError(null); setMaqs(null); setTrabs(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filtro = (q: any) => { let x = q; if (modulo) x = x.eq('modulo_id', modulo); if (area) x = x.eq('area_id', area); return x; };
      const [m, t] = await Promise.all([
        todas<MaqProg>(() => filtro(supabase.from('v_maquinas')
          .select('id, asset_id, qr, serie, tipo, fabricante, ubicacion, puesto, modulo_id, area_id, area, frecuencia, ultimo_mantenimiento_en, proximo_mantenimiento, activo, estado_inventario')
          .eq('activo', true)).order('asset_id')),
        todas<Trab>(() => filtro(supabase.from('mantenimientos')
          .select('id, tipo, estado, maquina_id, mecanico_id, area_id, snap_area, snap_maquina, snap_asset_id, snap_qr, snap_ubicacion, snap_mecanico_nombre, fin_en, duracion_min')
          .in('estado', ['pendiente_validacion', 'completado'])
          .gte('fin_en', `${r.desde}T00:00:00-06:00`).lte('fin_en', `${r.hasta}T23:59:59.999-06:00`)).order('fin_en')),
      ]);
      // Las máquinas descartadas no cuentan para la programación.
      setMaqs(m.filter(x => (x.estado_inventario ?? '').toUpperCase() !== 'DESCARTADO'));
      setTrabs(t);
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
    const lista: Record<Estado, (MaqProg & { dias: number | null })[]> = { vencida: [], por_vencer: [], al_dia: [], sin_registro: [], sin_frecuencia: [] };
    maqs.forEach(m => {
      const e = estadoProg(m, hoy);
      cuenta[e]++;
      const a = m.area ?? 'Sin área';
      porArea[a] = porArea[a] ?? { vencida: 0, por_vencer: 0, al_dia: 0, sin_registro: 0, sin_frecuencia: 0 };
      porArea[a][e]++;
      lista[e].push({ ...m, dias: m.proximo_mantenimiento ? diasEntre(hoy, m.proximo_mantenimiento) : null });
    });
    lista.vencida.sort((x, y) => (x.dias ?? 0) - (y.dias ?? 0));
    lista.por_vencer.sort((x, y) => (x.dias ?? 0) - (y.dias ?? 0));
    const conFrec = maqs.length - cuenta.sin_frecuencia;
    const cumplimiento = conFrec ? Math.round(((cuenta.al_dia + cuenta.por_vencer) / conFrec) * 100) : 0;
    return { cuenta, porArea, lista, conFrec, cumplimiento };
  }, [maqs, hoy]);

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
      const k = t.mecanico_id ?? '-';
      mec[k] = mec[k] ?? { nombre: t.snap_mecanico_nombre ?? 'Sin mecánico', n: 0, prev: 0, corr: 0, min: 0 };
      mec[k].n++; mec[k][t.tipo === 'preventivo' ? 'prev' : 'corr']++; mec[k].min += Number(t.duracion_min ?? 0);
    });
    const maq: Record<string, { nombre: string; asset: string; area: string; corr: number; min: number }> = {};
    trabs.filter(t => t.tipo === 'correctivo').forEach(t => {
      maq[t.maquina_id] = maq[t.maquina_id] ?? { nombre: `${t.snap_maquina ?? ''}`, asset: t.snap_qr ?? t.snap_asset_id ?? '', area: t.snap_area ?? '', corr: 0, min: 0 };
      maq[t.maquina_id].corr++; maq[t.maquina_id].min += Number(t.duracion_min ?? 0);
    });
    return {
      total: trabs.length, prev, corr: trabs.length - prev, horas, largo, serie,
      porArea: Object.entries(porArea).sort((a, b) => (b[1].prev + b[1].corr) - (a[1].prev + a[1].corr)),
      mecanicos: Object.values(mec).sort((a, b) => b.n - a.n),
      maquinas: Object.values(maq).sort((a, b) => b.corr - a.corr || b.min - a.min).slice(0, 10),
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

      {error && <Aviso tipo="error" onReintentar={cargar}>{error}</Aviso>}
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
          <p className="nota">"Sin primer mantenimiento": la máquina tiene frecuencia, pero todavía no se le ha registrado ningún mantenimiento en esta aplicación; su próxima fecha se calcula al registrar el primero.</p>

          <div className="tabla-scroll"><table className="tabla">
            <thead><tr><th>Área</th><th>Vencidas</th><th>Vencen 7 días</th><th>Al día</th><th>Sin primer mant.</th><th>Sin frecuencia</th></tr></thead>
            <tbody>{Object.entries(prog.porArea).sort(([a], [b]) => a.localeCompare(b)).map(([a, v]) => (
              <tr key={a}><td>{a}</td><td className={v.vencida ? 'num malo' : 'num'}>{v.vencida}</td><td className="num">{v.por_vencer}</td><td className="num">{v.al_dia}</td><td className="num">{v.sin_registro}</td><td className="num">{v.sin_frecuencia}</td></tr>
            ))}</tbody>
          </table></div>

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

          <section className="tarjeta">
            <h2>Máquinas con más correctivos · {r.nombre}</h2>
            {avance.maquinas.length === 0 ? <p className="nota">Sin correctivos en el período.</p> : (
              <div className="tabla-scroll"><table className="tabla">
                <thead><tr><th>Máquina</th><th>QR</th><th>Área</th><th>Correctivos</th><th>Tiempo en mantenimiento</th></tr></thead>
                <tbody>{avance.maquinas.map(m => (
                  <tr key={m.asset + m.nombre}><td>{m.nombre}</td><td>{m.asset}</td><td>{m.area}</td><td className="num">{m.corr}</td><td>{duracion(m.min)}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
