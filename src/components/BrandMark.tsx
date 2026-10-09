/** Logo de Vault Local: dial de bóveda con ojo de cerradura (mismo dibujo que el ícono de la app). */
export function BrandMark({ size = 32, detailed = false, className }: { size?: number; detailed?: boolean; className?: string }) {
  if (!detailed) {
    return (
      <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
        <rect x="2" y="2" width="96" height="96" rx="24" fill="#0E1729" />
        <circle cx="50" cy="50" r="29" fill="none" stroke="#3D7BF5" strokeWidth="11" />
        <circle cx="50" cy="45" r="8.5" fill="#FFFFFF" />
        <path d="M45 49 L42.5 64 H57.5 L55 49 Z" fill="#FFFFFF" />
      </svg>
    );
  }
  const ticks = [
    [50, 11, 50, 17], [50, 83, 50, 89], [11, 50, 17, 50], [83, 50, 89, 50],
    [22.4, 22.4, 26.6, 26.6], [73.4, 73.4, 77.6, 77.6], [77.6, 22.4, 73.4, 26.6], [26.6, 73.4, 22.4, 77.6],
  ];
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect x="2" y="2" width="96" height="96" rx="24" fill="#0E1729" />
      <g stroke="#3D7BF5" strokeWidth="3.2" strokeLinecap="round">
        {ticks.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>
      <circle cx="50" cy="50" r="26" fill="none" stroke="#3D7BF5" strokeWidth="7" />
      <circle cx="50" cy="45.5" r="6.5" fill="#FFFFFF" />
      <path d="M46.2 49 L44 62 H56 L53.8 49 Z" fill="#FFFFFF" />
    </svg>
  );
}
