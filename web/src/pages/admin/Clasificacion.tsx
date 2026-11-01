import { useCallback, useEffect, useMemo, useState } from 'react';
import { rpc, supabase, todas } from '../../lib';
import { Aviso, Cargando, Campo, Titulo } from '../../ui';

type Ub = { id: string; nombre: string; tipo: string; area_id: string | null };
type Tipo = { id: string; nombre: string; modulo_id: string | null };
type Mod = { id: string; nombre: string };
type Ar = { id: string; nombre: string; codigo: string; modulo_id: string };
type MaqLite = { id: string; ubicacion_id: string | null; tipo_id: string | null; modulo_id: string | null; area_id: string | null };
type MaqSin = { id: string; asset_id: string; qr: string | null; tipo: string | null; ubicacion: string | null; puesto: string | null; estado_inventario: string | null };

// Sugerencias por nombre de ubicación (el administrador las confirma antes de aplicarlas).
function sugerir(nombre: string): { area: string; tipo: string } | null {
  const n = nombre.toUpperCase().replace(/\s+/g, ' ').trim();
  if (/^LINE \d+$/.test(n)) return { area: 'COSTURA', tipo: 'linea' };
  const mapa: Record<string, string> = { PD: 'PD', SERIGRAFIA: 'SERIGRAFIA', SUBLIMADO: 'SUBLIMADO', CORTE: 'CORTE', STAGING: 'STAGING', 'BODEGA DE TELAS': 'BODEGA_TELAS', BORDADO: 'BORDADO' };
  return mapa[n] ? { area: mapa[n], tipo: 'area' } : null;
}

export default function Clasificacion() {
  const [ubs, setUbs] = useState<Ub[]>([]);
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [mods, setMods] = useState<Mod[]>([]);
  const [areas, setAreas] = useState<Ar[]>([]);
  const [maqs, setMaqs] = useState<MaqLite[] | null>(null);
  const [sin, setSin] = useState<MaqSin[]>([]);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [filtroUb, setFiltroUb] = useState('');
  const [destMod, setDestMod] = useState('');
  const [destArea, setDestArea] = useState('');
  const [motivo, setMotivo] = useState('');

  const cargar = useCallback(async () => {
    const [u, t, m, a] = await Promise.all([
      supabase.from('ubicaciones').select('id, nombre, tipo, area_id').order('nombre'),
      supabase.from('tipos_maquina').select('id, nombre, modulo_id').order('nombre'),
      supabase.from('modulos').select('id, nombre').order('orden'),
      supabase.from('areas').select('id, nombre, codigo, modulo_id').order('nombre'),
    ]);
    setUbs((u.data ?? []) as Ub[]); setTipos((t.data ?? []) as Tipo[]); setMods((m.data ?? []) as Mod[]); setAreas((a.data ?? []) as Ar[]);
    setMaqs(await todas<MaqLite>(() => supabase.from('maquinas').select('id, ubicacion_id, tipo_id, modulo_id, area_id').order('id')));
    setSin(await todas<MaqSin>(() => supabase.from('v_maquinas').select('id, asset_id, qr, tipo, ubicacion, puesto, estado_inventario').is('modulo_id', null).order('ubicacion').order('asset_id')));
    setSel([]);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const porUb = useMemo(() => {
    const c: Record<string, { total: number; sin: number }> = {};
    (maqs ?? []).forEach(m => { const k = m.ubicacion_id ?? '-'; c[k] ??= { total: 0, sin: 0 }; c[k].total++; if (!m.area_id) c[k].sin++; });
    return c;
  }, [maqs]);
  const porTipo = useMemo(() => {
    const c: Record<string, number> = {};
    (maqs ?? []).forEach(m => { if (m.tipo_id) c[m.tipo_id] = (c[m.tipo_id] ?? 0) + 1; });
    return c;
  }, [maqs]);
  const areaPorCodigo = (c: string) => areas.find(a => a.codigo === c);
  const sugerencias = ubs.map(u => ({ u, s: sugerir(u.nombre) })).filter(x => x.s && x.u.area_id !== areaPorCodigo(x.s.area)?.id);

  async function ejecutar(fn: () => Promise<string>) {
    setOcupado(true); setMsg(null);
    try { const t = await fn(); setMsg({ tipo: 'ok', t }); await cargar(); }
    catch (e) { setMsg({ tipo: 'error', t: (e as Error).message }); }
    finally { setOcupado(false); }
  }

  const aplicarSugerencias = () => ejecutar(async () => {
    let n = 0;
    for (const { u, s } of sugerencias) n += await rpc<number>('admin_regla_ubicacion', { p_ubicacion_id: u.id, p_area_id: areaPorCodigo(s!.area)!.id, p_tipo: s!.tipo, p_aplicar: true });
    return `Se guardaron ${sugerencias.length} reglas y se clasificaron ${n} máquinas sin área.`;
  });

  if (!maqs) return <Cargando />;
  const sinVisibles = sin.filter(m => !filtroUb || (m.ubicacion ?? '(vacía)') === filtroUb);

  return (
    <main className="contenido">
      <Titulo sub="La aplicación no asigna áreas por suposición: cada regla se confirma aquí y queda en la auditoría.">Clasificar módulos y áreas</Titulo>
      {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}

      {sugerencias.length > 0 && (
        <section className="tarjeta">
          <h2>Reglas sugeridas por nombre de ubicación</h2>
          <ul className="lista-simple">{sugerencias.map(({ u, s }) => <li key={u.id}>{u.nombre} → <b>{areaPorCodigo(s!.area)?.nombre}</b> ({porUb[u.id]?.total ?? 0} máquinas)</li>)}</ul>
          <button className="btn btn-pri" disabled={ocupado} onClick={() => { if (confirm('¿Guardar estas reglas y clasificar las máquinas sin área de esas ubicaciones?')) aplicarSugerencias(); }}>Confirmar y aplicar sugerencias</button>
        </section>
      )}

      <section className="tarjeta">
        <h2>Reglas por ubicación</h2>
        <div className="tabla-scroll alto"><table className="tabla">
          <thead><tr><th>Ubicación</th><th>Máquinas</th><th>Sin área</th><th>Área por regla</th></tr></thead>
          <tbody>{ubs.map(u => (
            <tr key={u.id}><td>{u.nombre}</td><td>{porUb[u.id]?.total ?? 0}</td><td>{porUb[u.id]?.sin ?? 0}</td>
              <td><select value={u.area_id ?? ''} disabled={ocupado} onChange={e => {
                const area = e.target.value || null;
                ejecutar(async () => { const n = await rpc<number>('admin_regla_ubicacion', { p_ubicacion_id: u.id, p_area_id: area, p_tipo: null, p_aplicar: true }); return `Regla guardada para ${u.nombre}. ${n} máquinas sin área clasificadas.`; });
              }}><option value="">— Sin regla —</option>{mods.map(m => <optgroup key={m.id} label={m.nombre}>{areas.filter(a => a.modulo_id === m.id).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}</optgroup>)}</select></td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="tarjeta">
        <h2>Reglas por tipo de máquina</h2>
        <p className="nota">Una regla por tipo fija el módulo aunque la máquina esté en bodega (ej. calderas → Costura y PD). Tiene prioridad sobre la ubicación.</p>
        <div className="tabla-scroll alto"><table className="tabla">
          <thead><tr><th>Tipo</th><th>Máquinas</th><th>Módulo por regla</th></tr></thead>
          <tbody>{tipos.map(t => (
            <tr key={t.id}><td>{t.nombre}</td><td>{porTipo[t.id] ?? 0}</td>
              <td><select value={t.modulo_id ?? ''} disabled={ocupado} onChange={e => {
                const mod = e.target.value || null;
                ejecutar(async () => { const n = await rpc<number>('admin_regla_tipo', { p_tipo_id: t.id, p_modulo_id: mod, p_aplicar: true }); return `Regla guardada para ${t.nombre}. ${n} máquinas actualizadas.`; });
              }}><option value="">— Sin regla —</option>{mods.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></td></tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="tarjeta">
        <h2>Bandeja: máquinas sin clasificar ({sin.length})</h2>
        <Campo etiqueta="Filtrar por ubicación">
          <select value={filtroUb} onChange={e => { setFiltroUb(e.target.value); setSel([]); }}>
            <option value="">Todas</option>{Array.from(new Set(sin.map(m => m.ubicacion ?? '(vacía)'))).sort().map(u => <option key={u}>{u}</option>)}
          </select>
        </Campo>
        <div className="fila-botones">
          <button className="btn btn-sec btn-chico" onClick={() => setSel(sinVisibles.map(m => m.id))}>Seleccionar visibles ({sinVisibles.length})</button>
          <button className="btn btn-sec btn-chico" onClick={() => setSel([])}>Quitar selección</button>
        </div>
        <div className="tabla-scroll alto"><table className="tabla">
          <thead><tr><th></th><th>Asset ID</th><th>QR</th><th>Tipo</th><th>Ubicación</th><th>Puesto</th><th>Estado</th></tr></thead>
          <tbody>{sinVisibles.slice(0, 400).map(m => (
            <tr key={m.id}><td><input type="checkbox" checked={sel.includes(m.id)} onChange={e => setSel(s => e.target.checked ? [...s, m.id] : s.filter(x => x !== m.id))} /></td>
              <td>{m.asset_id}</td><td>{m.qr}</td><td>{m.tipo}</td><td>{m.ubicacion}</td><td>{m.puesto}</td><td>{m.estado_inventario}</td></tr>
          ))}</tbody>
        </table></div>
        <div className="filtros">
          <Campo etiqueta="Módulo"><select value={destMod} onChange={e => { setDestMod(e.target.value); setDestArea(''); }}><option value="">Seleccione…</option>{mods.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Área (opcional)"><select value={destArea} onChange={e => setDestArea(e.target.value)} disabled={!destMod}><option value="">Todo el módulo (sin área)</option>{areas.filter(a => a.modulo_id === destMod).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Motivo"><input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej.: confirmado con jefe de mantenimiento" /></Campo>
        </div>
        <button className="btn btn-pri" disabled={ocupado || !sel.length || !destMod} onClick={() => ejecutar(async () => {
          const n = await rpc<number>('admin_clasificar_maquinas', { p_ids: sel, p_modulo_id: destMod, p_area_id: destArea || null, p_motivo: motivo });
          return `${n} máquinas clasificadas. El cambio quedó en el historial de ubicaciones.`;
        })}>Clasificar {sel.length} seleccionadas</button>
      </section>
    </main>
  );
}
