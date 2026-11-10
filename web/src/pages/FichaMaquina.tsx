import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { duracion, fecha, fechaHora, FRECUENCIAS, Maquina, Mantenimiento, mensajeError, nuevaClave, rpc, supabase, TIPOS } from '../lib';
import { useSesion } from '../sesion';
import { Aviso, Cargando, Campo, Dato, Insignia, Titulo } from '../ui';
import LectorQR from '../LectorQR';

type Mecanico = { encontrado: boolean; id?: string; codigo?: string; nombre?: string; cargo?: string; autorizado?: boolean; mensaje: string };

export default function FichaMaquina() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { sesion } = useSesion();
  const [m, setM] = useState<Maquina | null>(null);
  const [trabajos, setTrabajos] = useState<Mantenimiento[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [codigoMec, setCodigoMec] = useState(sesion?.empleado?.codigo ?? '');
  const [mec, setMec] = useState<Mecanico | null>(null);
  const [tipo, setTipo] = useState<'preventivo' | 'correctivo' | ''>('');
  const [clave, setClave] = useState(nuevaClave);
  const [iniciando, setIniciando] = useState(false);
  const [errInicio, setErrInicio] = useState<string | null>(null);
  const puedeOtros = sesion?.usuario?.perfil !== 'tecnico' || sesion?.usuario?.puede_registrar_otros;

  const cargar = useCallback(async () => {
    setError(null);
    const r = await supabase.from('v_maquinas').select('*').eq('id', id).maybeSingle();
    if (r.error) { setError(mensajeError(r.error)); return; }
    if (!r.data) { setError('La máquina no existe o no está en sus áreas autorizadas.'); return; }
    setM(r.data as Maquina);
    const t = await supabase.from('mantenimientos').select('*').eq('maquina_id', id).order('creado_en', { ascending: false }).limit(15);
    setTrabajos((t.data ?? []) as Mantenimiento[]);
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]);

  const verificarMecanico = useCallback(async (codigo: string) => {
    setMec(null); setErrInicio(null);
    if (!codigo.trim() || !id) return;
    try { setMec(await rpc<Mecanico>('buscar_mecanico', { p_codigo: codigo.trim(), p_maquina_id: id })); }
    catch (e) { setErrInicio((e as Error).message); }
  }, [id]);
  useEffect(() => { if (sesion?.empleado?.codigo && id) verificarMecanico(sesion.empleado.codigo); }, [sesion?.empleado?.codigo, id, verificarMecanico]);

  async function iniciar(e: FormEvent) {
    e.preventDefault(); setErrInicio(null);
    if (!tipo) { setErrInicio('Seleccione preventivo o correctivo.'); return; }
    if (!mec?.autorizado) { setErrInicio('Identifique un mecánico autorizado.'); return; }
    setIniciando(true);
    try {
      const r = await rpc<{ id: string }>('iniciar_mantenimiento', {
        p_maquina_id: id, p_tipo: tipo, p_codigo_mecanico: codigoMec.trim(), p_qr_leido: params.get('qr') ?? '', p_idempotency_key: clave,
      });
      setClave(nuevaClave());
      nav(`/trabajo/${r.id}?nuevo=1`);
    } catch (e) { setErrInicio((e as Error).message); }   // misma clave al reintentar: no se duplica
    finally { setIniciando(false); }
  }

  if (error) return <main className="contenido"><Aviso tipo="error" onReintentar={cargar}>{error}</Aviso></main>;
  if (!m) return <Cargando />;
  const abiertos = trabajos.filter(t => t.estado === 'en_proceso');

  return (
    <main className="contenido">
      <Titulo sub={<>{m.modulo ?? 'Sin módulo'} · {m.area ?? 'Sin área'}{m.es_critica && <span className="insignia critica">CRÍTICA</span>}</>}>
        {m.tipo ?? 'Máquina'} {m.fabricante ? `· ${m.fabricante}` : ''}
      </Titulo>
      {m.requiere_revision && <Aviso tipo="alerta">Registro en revisión: {m.motivo_revision}</Aviso>}
      <dl className="datos tarjeta">
        <Dato k="QR" v={m.qr} /><Dato k="Serie" v={m.serie} /><Dato k="Asset ID" v={m.asset_id} />
        <Dato k="Modelo" v={m.modelo} /><Dato k="Grupo" v={m.grupo} />
        <Dato k="Ubicación / línea" v={m.ubicacion} /><Dato k="Puesto" v={m.puesto} />
        <Dato k="Estado inventario" v={m.estado_inventario} />
        <Dato k="Condición operativa" v={(m.condicion_operativa ?? '').replace(/_/g, ' ')} />
        <Dato k="Compra / registro" v={fecha(m.fecha_compra_registro)} />
        <Dato k="Frecuencia de mantenimiento" v={m.frecuencia ? FRECUENCIAS[m.frecuencia] ?? m.frecuencia : 'Sin definir'} />
        <Dato k="Último mantenimiento" v={fechaHora(m.ultimo_mantenimiento_en)} />
        <Dato k="Próximo mantenimiento" v={fecha(m.proximo_mantenimiento)} />
      </dl>

      {abiertos.length > 0 && (
        <Aviso tipo="info">Trabajos en proceso en esta máquina: {abiertos.map(t => <Link key={t.id} to={`/trabajo/${t.id}`}> #{t.folio} ({t.snap_mecanico_nombre})</Link>)}</Aviso>
      )}

      {m.sin_clasificar ? (
        <Aviso tipo="alerta">Esta máquina no tiene módulo asignado. El administrador debe clasificarla antes de registrar trabajos.</Aviso>
      ) : (
        <form className="tarjeta" onSubmit={iniciar}>
          <h2>Nuevo mantenimiento</h2>
          <Campo etiqueta="Código del mecánico" ayuda={puedeOtros ? 'Escanee el QR del gafete o escriba el código.' : 'Solo puede registrar trabajos a su nombre.'}>
            <div className="fila-input">
              <input value={codigoMec} inputMode="numeric" disabled={!puedeOtros && !!sesion?.empleado}
                onChange={e => { setCodigoMec(e.target.value); setMec(null); }} onBlur={() => verificarMecanico(codigoMec)} />
              {puedeOtros && <LectorQR texto="Escanear gafete" onLeido={t => { setCodigoMec(t); verificarMecanico(t); }} />}
            </div>
          </Campo>
          {mec && <Aviso tipo={mec.autorizado ? 'ok' : 'error'}>{mec.encontrado ? <><b>{mec.nombre}</b> ({mec.codigo}) · {mec.mensaje}</> : mec.mensaje}</Aviso>}
          <div className="opciones-tipo" role="radiogroup" aria-label="Tipo de mantenimiento">
            {(['preventivo', 'correctivo'] as const).map(t => (
              <button type="button" key={t} role="radio" aria-checked={tipo === t} className={`btn btn-opcion ${tipo === t ? 'activo' : ''}`} onClick={() => setTipo(t)}>
                Mantenimiento {TIPOS[t].toLowerCase()}
              </button>
            ))}
          </div>
          {errInicio && <Aviso tipo="error">{errInicio}</Aviso>}
          <button className="btn btn-pri btn-gigante" disabled={iniciando}>{iniciando ? 'Registrando inicio…' : 'Iniciar mantenimiento'}</button>
          <p className="nota">La fecha y hora de inicio las registra el servidor.</p>
        </form>
      )}

      <section className="tarjeta">
        <h2>Historial de la máquina</h2>
        {trabajos.length === 0 && <p className="nota">Sin trabajos registrados visibles para usted.</p>}
        <ul className="lista">
          {trabajos.map(t => (
            <li key={t.id}><Link to={`/trabajo/${t.id}`} className="item">
              <b>#{t.folio}</b> {TIPOS[t.tipo]} <Insignia estado={t.estado} />
              <span className="item-sub">{fechaHora(t.inicio_en)} · {t.snap_mecanico_nombre} · {duracion(t.duracion_min)}</span>
            </Link></li>
          ))}
        </ul>
      </section>
    </main>
  );
}
