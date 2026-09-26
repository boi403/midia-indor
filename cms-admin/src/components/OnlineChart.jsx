import { useMemo, useState } from 'react';

// TVs online nas últimas 24h: uma série só (área + linha de 2px), com
// crosshair e tooltip no hover. O título do card nomeia a série.
const W = 720;
const H = 200;
const PAD = { l: 32, r: 12, t: 12, b: 26 };

export default function OnlineChart({ series }) {
  const [hover, setHover] = useState(null);
  const points = useMemo(() => (series || []).map((p) => ({ ...p, time: new Date(p.t) })), [series]);
  const hasData = points.some((p) => p.online != null);

  const maxY = Math.max(1, ...points.map((p) => p.total ?? p.online ?? 0));
  const x = (i) => PAD.l + (i / Math.max(1, points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / maxY) * (H - PAD.t - PAD.b);

  // segmentos contínuos (buracos = sem amostra, ex.: servidor desligado)
  const segments = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.online == null) { if (cur.length) segments.push(cur); cur = []; } else cur.push([x(i), y(p.online)]);
  });
  if (cur.length) segments.push(cur);

  const ticksY = maxY <= 4 ? Array.from({ length: maxY + 1 }, (_, i) => i) : [0, Math.round(maxY / 2), maxY];
  const ticksX = points.map((p, i) => ({ i, p })).filter(({ i }) => i % 8 === 0);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (points.length - 1));
    setHover(i >= 0 && i < points.length ? i : null);
  };

  if (!hasData) return <p className="muted chart-empty">Sem amostras ainda — o gráfico se preenche a cada 5 minutos com o servidor ligado.</p>;
  const hp = hover != null ? points[hover] : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="TVs online nas últimas 24 horas" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticksY.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={PAD.l - 8} y={y(v) + 4} className="chart-axis" textAnchor="end">{v}</text>
          </g>
        ))}
        {ticksX.map(({ i, p }) => (
          <text key={i} x={x(i)} y={H - 6} className="chart-axis" textAnchor="middle">
            {p.time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </text>
        ))}
        {segments.map((seg, k) => (
          <g key={k}>
            <path className="chart-area" d={`M${seg[0][0]},${y(0)} ${seg.map(([a, b]) => `L${a},${b}`).join(' ')} L${seg[seg.length - 1][0]},${y(0)} Z`} />
            <path className="chart-line" d={seg.map(([a, b], j) => `${j ? 'L' : 'M'}${a},${b}`).join(' ')} />
            {seg.length === 1 && <circle cx={seg[0][0]} cy={seg[0][1]} r={4} className="chart-dot" />}
          </g>
        ))}
        {hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} className="chart-cross" />
            {hp.online != null && <circle cx={x(hover)} cy={y(hp.online)} r={4.5} className="chart-dot" />}
          </g>
        )}
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{hp.time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
          <span>{hp.online == null ? 'sem dados' : `${hp.online} de ${hp.total} TVs online`}</span>
        </div>
      )}
    </div>
  );
}
