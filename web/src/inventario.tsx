import { useEffect, useMemo, useState } from 'react';
import { supabase, todas } from './lib';

export type Articulo = {
  id: string; modulo_id: string; codigo: string; descripcion: string; codigo_ax: string | null; ubicacion: string | null;
  precio_usd: number | null; notas: string | null; existencia: number; activo: boolean;
};

export async function cargarArticulos(moduloId: string, soloActivos = true): Promise<Articulo[]> {
  const r = await todas<Articulo>(() => {
    let q = supabase.from('inv_articulos').select('id, modulo_id, codigo, descripcion, codigo_ax, ubicacion, precio_usd, notas, existencia, activo')
      .eq('modulo_id', moduloId);
    if (soloActivos) q = q.eq('activo', true);
    return q.order('codigo');
  });
  return r.map(a => ({ ...a, existencia: Number(a.existencia), precio_usd: a.precio_usd === null ? null : Number(a.precio_usd) }));
}

export const num = (n: number | null | undefined) => n === null || n === undefined ? '—' : Number(n).toLocaleString('es-HN', { maximumFractionDigits: 2 });
export const dinero = (n: number | null | undefined) => n === null || n === undefined ? '—' : '$ ' + Number(n).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Buscador de repuestos por código, descripción o código AX. */
export function SelectorArticulo({ articulos, elegido, onElegir, disabled, mostrarSinExistencia = true }:
  { articulos: Articulo[]; elegido: Articulo | null; onElegir: (a: Articulo | null) => void; disabled?: boolean; mostrarSinExistencia?: boolean }) {
  const [texto, setTexto] = useState('');
  const resultados = useMemo(() => {
    const t = norm(texto.trim());
    if (!t) return [];
    return articulos.filter(a => norm(`${a.codigo} ${a.descripcion} ${a.codigo_ax ?? ''}`).includes(t)).slice(0, 8);
  }, [texto, articulos]);
  // Si lo escrito (o escaneado) es exactamente un código o código AX único, se elige solo.
  const exacto = useMemo(() => {
    const t = texto.trim().toUpperCase();
    if (!t) return null;
    const porCodigo = articulos.filter(a => a.codigo.toUpperCase() === t);
    const lista = porCodigo.length ? porCodigo : articulos.filter(a => (a.codigo_ax ?? '').toUpperCase() === t);
    return lista.length === 1 ? lista[0] : null;
  }, [texto, articulos]);
  const elegible = (a: Articulo) => mostrarSinExistencia || a.existencia > 0;
  useEffect(() => { if (exacto && !elegido && elegible(exacto)) { onElegir(exacto); setTexto(''); } }, [exacto]); // eslint-disable-line react-hooks/exhaustive-deps

  if (elegido) {
    return (
      <div className="art-elegido">
        <div><b>{elegido.codigo}</b> · {elegido.descripcion}
          <span className="item-sub">Existencia: <b>{num(elegido.existencia)}</b> · Precio: {dinero(elegido.precio_usd)}{elegido.codigo_ax ? ` · AX ${elegido.codigo_ax}` : ''}</span>
        </div>
        {!disabled && <button type="button" className="btn btn-link" onClick={() => { onElegir(null); setTexto(''); }}>Cambiar</button>}
      </div>
    );
  }
  return (
    <div className="art-buscar">
      <input value={texto} disabled={disabled} onChange={e => setTexto(e.target.value)} placeholder="Buscar por código, nombre o código AX"
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const disponibles = resultados.filter(elegible);
          if (disponibles.length === 1) { onElegir(disponibles[0]); setTexto(''); }
        }} />
      {resultados.length > 0 && <span className="nota">Toque el repuesto para elegirlo.</span>}
      {exacto && !elegible(exacto) && <span className="nota">{exacto.codigo} no tiene existencia.</span>}
      {resultados.length > 0 && (
        <div className="art-resultados">
          {resultados.map(a => {
            const sin = !mostrarSinExistencia && a.existencia <= 0;
            return (
              <button type="button" key={a.id} className="item" disabled={sin} onClick={() => { onElegir(a); setTexto(''); }}>
                <b>{a.codigo}</b> · {a.descripcion}
                <span className="item-sub">Existencia: {num(a.existencia)}{sin ? ' (sin existencia)' : ''} · {dinero(a.precio_usd)}</span>
              </button>
            );
          })}
        </div>
      )}
      {texto.trim() && resultados.length === 0 && <span className="nota">No se encontró ningún repuesto con “{texto.trim()}”.</span>}
    </div>
  );
}
