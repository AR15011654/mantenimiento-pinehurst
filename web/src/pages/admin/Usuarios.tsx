import { FormEvent, useCallback, useEffect, useState } from 'react';
import { fechaHora, mensajeError, rpc, supabase } from '../../lib';
import { useSesion } from '../../sesion';
import { Aviso, Campo, Titulo } from '../../ui';

type Alc = { modulo_id: string; area_id: string | null; modulo?: string; area?: string | null };
type Usuario = { id: string; email: string; nombre: string | null; perfil: string; activo: boolean; empleado_id: string | null; empleado_codigo: string | null; empleado_nombre: string | null; puede_registrar_otros: boolean; alcance: Alc[]; ultimo_acceso: string | null; invitacion_aceptada: boolean };
type Mod = { id: string; nombre: string; areas: { id: string; nombre: string }[] };
type Form = { id?: string; email: string; nombre: string; perfil: string; empleadoCodigo: string; puedeOtros: boolean; alcance: Alc[] };

const vacio: Form = { email: '', nombre: '', perfil: 'tecnico', empleadoCodigo: '', puedeOtros: false, alcance: [] };
const PERFILES: Record<string, string> = { admin: 'Administrador', supervisor: 'Supervisor', tecnico: 'Técnico' };

async function llamarFuncion(cuerpo: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-usuarios', { body: cuerpo });
  if (error) {
    let detalle = error.message;
    try { const ctx = (error as { context?: Response }).context; if (ctx) detalle = (await ctx.json()).error ?? detalle; } catch { /* sin detalle */ }
    throw new Error(mensajeError({ message: detalle }));
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function Usuarios() {
  const { sesion } = useSesion();
  const [lista, setLista] = useState<Usuario[]>([]);
  const [mods, setMods] = useState<Mod[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error'; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try { setLista(await rpc<Usuario[]>('admin_listar_usuarios')); } catch (e) { setMsg({ tipo: 'error', t: (e as Error).message }); }
  }, []);
  useEffect(() => {
    cargar();
    (async () => {
      const m = await supabase.from('modulos').select('id, nombre, areas(id, nombre)').order('orden');
      setMods((m.data ?? []) as Mod[]);
    })();
  }, [cargar]);

  const tieneAlc = (mod: string, area: string | null) => form?.alcance.some(a => a.modulo_id === mod && (a.area_id ?? null) === area);
  function alternar(mod: string, area: string | null) {
    if (!form) return;
    const sin = form.alcance.filter(a => !(a.modulo_id === mod && (a.area_id ?? null) === area));
    setForm({ ...form, alcance: sin.length === form.alcance.length ? [...form.alcance, { modulo_id: mod, area_id: area }] : sin });
  }

  async function resolverEmpleado(codigo: string) {
    if (!codigo.trim()) return null;
    const c = codigo.trim().replace(/[^0-9A-Za-z]/g, '');
    if (!c) throw new Error('Código de empleado no válido.');
    const { data } = await supabase.from('empleados').select('id, nombre, codigo').or(`codigo.eq.${c},codigo_sin_ceros.eq.${c.replace(/^0+/, '')}`).limit(1);
    if (!data?.length) throw new Error(`No existe un empleado con el código ${c}.`);
    return data[0].id as string;
  }

  async function guardar(e: FormEvent) {
    e.preventDefault(); if (!form) return;
    setOcupado(true); setMsg(null);
    try {
      if (form.perfil !== 'admin' && form.alcance.length === 0) throw new Error('Asigne al menos un módulo o un área.');
      const empleadoId = await resolverEmpleado(form.empleadoCodigo);
      if (form.id) {
        await rpc('admin_guardar_usuario', { p_id: form.id, p_perfil: form.perfil, p_nombre: form.nombre, p_empleado_id: empleadoId, p_puede_registrar_otros: form.puedeOtros, p_alcance: form.alcance });
        setMsg({ tipo: 'ok', t: 'Usuario actualizado.' });
      } else {
        await llamarFuncion({ accion: 'invitar', email: form.email.trim().toLowerCase(), nombre: form.nombre, perfil: form.perfil, empleado_id: empleadoId, puede_registrar_otros: form.puedeOtros, alcance: form.alcance, redirectTo: window.location.origin + window.location.pathname });
        setMsg({ tipo: 'ok', t: `Invitación enviada a ${form.email}. La persona debe abrir el enlace del correo y crear su contraseña.` });
      }
      setForm(null); cargar();
    } catch (e) { setMsg({ tipo: 'error', t: (e as Error).message }); }
    finally { setOcupado(false); }
  }

  async function activar(u: Usuario, activo: boolean) {
    const motivo = activo ? 'Reactivado' : prompt(`Motivo para desactivar a ${u.email}:`);
    if (motivo === null) return;
    setOcupado(true); setMsg(null);
    try { await llamarFuncion({ accion: activo ? 'activar' : 'desactivar', id: u.id, motivo }); setMsg({ tipo: 'ok', t: activo ? 'Usuario reactivado.' : 'Usuario desactivado: ya no puede iniciar sesión.' }); cargar(); }
    catch (e) { setMsg({ tipo: 'error', t: (e as Error).message }); }
    finally { setOcupado(false); }
  }

  return (
    <main className="contenido">
      <Titulo sub="Solo el administrador crea cuentas, asigna perfiles, módulos y áreas, y desactiva usuarios. No existe registro público.">Usuarios y permisos</Titulo>
      {msg && <Aviso tipo={msg.tipo}>{msg.t}</Aviso>}
      {!form && <button className="btn btn-pri btn-grande" onClick={() => setForm({ ...vacio })}>Invitar usuario</button>}

      {form && (
        <form className="tarjeta" onSubmit={guardar}>
          <h2>{form.id ? `Editar ${form.email}` : 'Invitar usuario'}</h2>
          {!form.id && <Campo etiqueta="Correo"><input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Campo>}
          <Campo etiqueta="Nombre para mostrar"><input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} /></Campo>
          <Campo etiqueta="Perfil">
            <select value={form.perfil} onChange={e => setForm({ ...form, perfil: e.target.value })} disabled={form.id === sesion?.usuario?.id}>
              {Object.entries(PERFILES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Código de empleado vinculado (opcional)" ayuda="Relaciona la cuenta con el catálogo de personal. Un técnico vinculado solo registra trabajos a su nombre.">
            <input value={form.empleadoCodigo} onChange={e => setForm({ ...form, empleadoCodigo: e.target.value })} inputMode="numeric" />
          </Campo>
          {form.perfil === 'tecnico' && <label className="mini"><input type="checkbox" checked={form.puedeOtros} onChange={e => setForm({ ...form, puedeOtros: e.target.checked })} /> Puede registrar trabajos de otros mecánicos</label>}
          {form.perfil !== 'admin' ? (
            <fieldset className="alcance">
              <legend>Módulos y áreas autorizados</legend>
              {mods.map(m => (
                <div key={m.id} className="alcance-mod">
                  <label className="mini"><input type="checkbox" checked={!!tieneAlc(m.id, null)} onChange={() => alternar(m.id, null)} /> <b>{m.nombre}</b> (todo el módulo)</label>
                  <div className="chips-mini">{m.areas.map(a => <button type="button" key={a.id} className={`chip chip-mini ${tieneAlc(m.id, a.id) ? 'activo' : ''}`} onClick={() => alternar(m.id, a.id)}>{a.nombre}</button>)}</div>
                </div>
              ))}
            </fieldset>
          ) : <p className="nota">El administrador tiene acceso a los tres módulos.</p>}
          <div className="fila-botones">
            <button className="btn btn-pri" disabled={ocupado}>{ocupado ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Enviar invitación'}</button>
            <button type="button" className="btn btn-sec" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="tabla-scroll"><table className="tabla">
        <thead><tr><th>Usuario</th><th>Perfil</th><th>Empleado</th><th>Alcance</th><th>Último acceso</th><th>Estado</th><th></th></tr></thead>
        <tbody>{lista.map(u => (
          <tr key={u.id} className={u.activo ? '' : 'inactivo'}>
            <td>{u.nombre ?? ''}<br /><span className="nota">{u.email}</span></td>
            <td>{PERFILES[u.perfil]}</td>
            <td>{u.empleado_codigo ? `${u.empleado_codigo} · ${u.empleado_nombre}` : '—'}</td>
            <td>{u.perfil === 'admin' ? 'Todos' : u.alcance.map(a => a.area ?? `${a.modulo} (completo)`).join(', ')}</td>
            <td>{u.ultimo_acceso ? fechaHora(u.ultimo_acceso) : 'Invitación pendiente'}</td>
            <td>{u.activo ? 'Activo' : 'Desactivado'}</td>
            <td className="acciones-celda">
              <button className="btn btn-link" onClick={() => setForm({ id: u.id, email: u.email, nombre: u.nombre ?? '', perfil: u.perfil, empleadoCodigo: u.empleado_codigo ?? '', puedeOtros: u.puede_registrar_otros, alcance: u.alcance.map(a => ({ modulo_id: a.modulo_id, area_id: a.area_id })) })}>Editar</button>
              {u.id !== sesion?.usuario?.id && <button className="btn btn-link" disabled={ocupado} onClick={() => activar(u, !u.activo)}>{u.activo ? 'Desactivar' : 'Reactivar'}</button>}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
    </main>
  );
}
