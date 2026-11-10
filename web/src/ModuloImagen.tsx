/** Nombre corto de cada módulo para los cuadros (\n = dos renglones). */
export const ETIQUETA_MODULO: Record<string, string> = {
  COSTURA_PD: 'COSTURA Y PD',
  SERIGRAFIA_BORDADO_SUBLIMADO: 'SERIGRAFÍA, BORDADO\nY SUBLIMADO',
  CORTE_BODEGA_STAGING: 'CORTE Y BODEGA',
};

// Ilustraciones propias de cada módulo (SVG en línea, sin archivos externos).
// Colores de marca Pinehurst: Azul #0067B8 · Verde #43AF2A · Navy #002B49.
const AZUL = '#0067B8', CLARO = '#5aa8ff', VERDE = '#43AF2A', FONDO = '#002B49';

function Costura() {
  return (
    <g>
      <rect x="26" y="58" width="108" height="14" rx="4" fill={CLARO} />
      <path d="M40 58 V30 a10 10 0 0 1 10 -10 H112 a10 10 0 0 1 10 10 V44 H96 V58 Z" fill={AZUL} />
      <rect x="98" y="44" width="10" height="16" fill={CLARO} />
      <line x1="103" y1="60" x2="103" y2="70" stroke="#e8f1ff" strokeWidth="3" />
      <circle cx="58" cy="40" r="9" fill={VERDE} />
      <circle cx="58" cy="40" r="3.5" fill={FONDO} />
      <path d="M118 22 C138 26 136 50 120 54" stroke={VERDE} strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="66" y="10" width="14" height="10" rx="2" fill={VERDE} />
    </g>
  );
}

function Serigrafia() {
  return (
    <g>
      <rect x="30" y="36" width="100" height="34" rx="3" fill={AZUL} />
      <rect x="38" y="42" width="84" height="22" rx="2" fill={CLARO} opacity=".55" />
      <path d="M52 16 L122 24 L118 34 L48 26 Z" fill={VERDE} />
      <rect x="82" y="8" width="8" height="14" rx="2" fill={VERDE} transform="rotate(8 86 15)" />
      <circle cx="62" cy="75" r="3" fill={VERDE} /><circle cx="80" cy="78" r="3" fill={VERDE} /><circle cx="98" cy="75" r="3" fill={VERDE} />
    </g>
  );
}

function Corte() {
  return (
    <g>
      <rect x="22" y="50" width="70" height="22" rx="11" fill={AZUL} />
      <ellipse cx="92" cy="61" rx="7" ry="11" fill={CLARO} />
      <ellipse cx="92" cy="61" rx="2.5" ry="4" fill={FONDO} />
      <circle cx="108" cy="22" r="9" fill="none" stroke={VERDE} strokeWidth="4" />
      <circle cx="132" cy="38" r="9" fill="none" stroke={VERDE} strokeWidth="4" />
      <path d="M114 28 L76 44 M124 32 L80 50" stroke="#e8f1ff" strokeWidth="4" strokeLinecap="round" />
    </g>
  );
}

function Mantenimiento() {
  return (
    <g>
      <path d="M58 22 a16 16 0 0 0 20 20 L112 76 a6 6 0 0 1 -8 8 L70 50 a16 16 0 0 1 -20 -20 l10 10 l8 -2 l2 -8 Z" fill={CLARO} />
      <circle cx="112" cy="30" r="14" fill="none" stroke={VERDE} strokeWidth="6" strokeDasharray="7 4" />
      <circle cx="112" cy="30" r="5" fill={VERDE} />
    </g>
  );
}

function Inventario() {
  return (
    <g>
      <rect x="34" y="44" width="32" height="30" rx="2" fill={AZUL} /><rect x="70" y="44" width="32" height="30" rx="2" fill={CLARO} />
      <rect x="52" y="12" width="32" height="30" rx="2" fill={CLARO} opacity=".8" /><rect x="106" y="44" width="22" height="30" rx="2" fill={VERDE} />
      <line x1="34" y1="54" x2="66" y2="54" stroke={FONDO} strokeWidth="2" /><line x1="70" y1="54" x2="102" y2="54" stroke={FONDO} strokeWidth="2" />
    </g>
  );
}

function Generico() {
  return (
    <g>
      <circle cx="80" cy="44" r="22" fill="none" stroke={CLARO} strokeWidth="8" strokeDasharray="10 6" />
      <circle cx="80" cy="44" r="8" fill={VERDE} />
    </g>
  );
}

export default function ModuloImagen({ codigo, etiqueta }: { codigo: string; etiqueta: string }) {
  const Dibujo = codigo === 'COSTURA_PD' ? Costura : codigo === 'SERIGRAFIA_BORDADO_SUBLIMADO' ? Serigrafia : codigo === 'CORTE_BODEGA_STAGING' ? Corte
    : codigo === 'MANTENIMIENTO' ? Mantenimiento : codigo === 'INVENTARIO' ? Inventario : Generico;
  // Un salto de línea (\n) en la etiqueta la muestra en dos renglones.
  const lineas = etiqueta.split('\n');
  return (
    <svg viewBox="0 0 160 120" className="mod-img" role="img" aria-label={etiqueta}>
      <rect width="160" height="120" rx="14" fill={FONDO} />
      <rect y="112" width="160" height="8" fill={VERDE} />
      <Dibujo />
      {lineas.length > 1 ? (
        <>
          <rect x="8" y="84" width="144" height="27" rx="4" fill={AZUL} />
          {lineas.map((l, i) => <text key={i} x="80" y={95 + i * 11} textAnchor="middle" fill="#fff" fontSize="9.5" fontWeight="700" fontFamily="system-ui, sans-serif">{l}</text>)}
        </>
      ) : (
        <>
          <rect x="14" y="88" width="132" height="20" rx="4" fill={AZUL} />
          <text x="80" y="102" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif">{etiqueta}</text>
        </>
      )}
    </svg>
  );
}
