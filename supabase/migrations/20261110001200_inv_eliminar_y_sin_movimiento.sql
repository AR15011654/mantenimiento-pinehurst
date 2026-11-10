-- =====================================================================
-- Migración 12: inventario
-- 1) La vista de artículos expone la fecha del último movimiento (para "sin movimiento").
-- 2) El administrador puede eliminar movimientos (entradas/salidas). La existencia se corrige,
--    se recalcula "existencia después" de los movimientos posteriores y el registro borrado
--    se guarda completo en inv_eliminaciones con el motivo.
-- =====================================================================

create or replace view public.inv_v_articulos as
  select a.id, a.modulo_id, a.codigo, a.descripcion, a.codigo_ax, a.ubicacion,
         case when public.ve_precios() then a.precio_usd end as precio_usd,
         a.notas, a.existencia, a.activo, a.creado_en, a.actualizado_en,
         (select max(m.creado_en) from public.inv_movimientos m where m.articulo_id = a.id) as ultimo_movimiento_en
    from public.inv_articulos a
   where public.inv_puede(a.modulo_id);

create table public.inv_eliminaciones (
  id bigint generated always as identity primary key,
  movimiento_id bigint not null,
  movimiento jsonb not null,          -- copia completa del movimiento borrado
  motivo text not null,
  usuario_id uuid not null,
  creado_en timestamptz not null default now()
);
alter table public.inv_eliminaciones enable row level security;
grant select on public.inv_eliminaciones to authenticated;
create policy solo_admin on public.inv_eliminaciones for select to authenticated using (public.es_admin());

create or replace function public.inv_eliminar_movimiento(p_id bigint, p_motivo text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.usuarios; m public.inv_movimientos; a public.inv_articulos; v_delta numeric;
begin
  u := public.exigir_usuario();
  perform public.exigir_admin();
  if coalesce(btrim(p_motivo), '') = '' then perform public.fallar('motivo', 'Escriba el motivo de la eliminación.'); end if;
  select * into m from public.inv_movimientos where id = p_id;
  if m.id is null then perform public.fallar('no_existe', 'El movimiento ya no existe.'); end if;
  select * into a from public.inv_articulos where id = m.articulo_id for update;
  -- Borrar una entrada resta; borrar una salida devuelve al inventario.
  v_delta := case when m.tipo = 'entrada' then -m.cantidad else m.cantidad end;
  if a.existencia + v_delta < 0 then
    perform public.fallar('sin_existencia', format('No se puede eliminar esta entrada de %s: la existencia quedaría en %s. Elimine primero las salidas que usaron esas piezas.',
      a.codigo, trim_scale(a.existencia + v_delta)));
  end if;
  insert into public.inv_eliminaciones (movimiento_id, movimiento, motivo, usuario_id)
    values (m.id, to_jsonb(m), btrim(p_motivo), u.id);
  delete from public.inv_movimientos where id = m.id;
  update public.inv_articulos set existencia = existencia + v_delta, actualizado_en = now() where id = a.id returning * into a;
  update public.inv_movimientos set existencia_despues = existencia_despues + v_delta
   where articulo_id = a.id and id > m.id;
  if m.mantenimiento_id is not null then
    insert into public.mantenimiento_eventos (mantenimiento_id, evento, usuario_id, motivo, datos)
      values (m.mantenimiento_id, 'repuesto_eliminado', u.id, btrim(p_motivo), jsonb_build_object('codigo', a.codigo, 'cantidad', m.cantidad));
  end if;
  return jsonb_build_object('existencia', a.existencia);
end $$;

revoke execute on function public.inv_eliminar_movimiento(bigint, text) from public, anon;
grant execute on function public.inv_eliminar_movimiento(bigint, text) to authenticated;
