-- Migración 16: nueva área PLOTTER en el módulo Serigrafía, Bordado y Sublimado.
-- Los usuarios con el módulo completo la ven de inmediato; a quien tenga áreas sueltas se le agrega desde Admin → Usuarios.
insert into public.areas (modulo_id, codigo, nombre)
select m.id, 'PLOTTER', 'Plotter' from public.modulos m where m.codigo = 'SERIGRAFIA_BORDADO_SUBLIMADO'
on conflict (codigo) do nothing;
