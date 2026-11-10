import { Component, ReactNode } from 'react';

/**
 * Si una pantalla falla, muestra un aviso con salida al inicio en lugar de dejar la app en blanco.
 * Se reinicia sola al cambiar de ruta (prop `clave`).
 */
export default class ErrorPantalla extends Component<{ clave: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { clave: string }) { if (prev.clave !== this.props.clave && this.state.error) this.setState({ error: null }); }
  componentDidCatch(error: Error) { console.error('Error en pantalla:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="contenido">
        <div className="aviso aviso-error" role="alert">
          <strong>No se pudo mostrar esta pantalla.</strong>
          <div>Intente de nuevo. Si el problema continúa, avise al administrador.</div>
          <div className="nota">{this.state.error.message}</div>
        </div>
        <div className="fila-botones">
          <button type="button" className="btn btn-pri" onClick={() => location.reload()}>Reintentar</button>
          <a className="btn btn-sec" href="#/">Ir al inicio</a>
        </div>
      </main>
    );
  }
}
