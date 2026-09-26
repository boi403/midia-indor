import { Link } from 'react-router-dom';
import { fmtAgo } from '../ui';

// Parede de telas: cada TV desenhada como uma tela — acesa e com o que está
// passando quando está no ar, apagada com "sem sinal" quando não. As que
// precisam de atenção vêm primeiro.
const rank = (d) => (d.status === 'blocked' ? 2 : d.online ? 1 : 0);

function isPortrait(d) {
  const o = d.orientation === 'auto' ? d.reported_orientation : d.orientation;
  return o === 'portrait';
}

function Screen({ device: d, to, onOpen, showClient }) {
  const state = d.status === 'blocked' ? 'blocked' : d.online ? 'on' : 'off';
  const place = [d.location, showClient && d.client_name].filter(Boolean).join(' · ');
  const status = state === 'on' ? 'No ar' : state === 'off' ? 'Sem sinal' : 'Bloqueada';
  return (
    <li>
      <Link to={to} onClick={onOpen} className={`screen is-${state} ${isPortrait(d) ? 'is-portrait' : ''}`}
        aria-label={`${d.name}: ${status}${place ? `, ${place}` : ''}`}>
        <span className="screen-frame">
          <span className="screen-glass">
            {state === 'on' && (
              <span className="screen-now">
                <small>Exibindo</small>
                <span className="truncate">{d.current_item || d.current_playlist || d.playlist_name || 'Playlist padrão'}</span>
              </span>
            )}
            {state === 'off' && (
              <span className="screen-nosignal">
                <strong>Sem sinal</strong>
                <small>{d.offline_since || d.last_seen_at ? fmtAgo(d.offline_since || d.last_seen_at) : 'nunca conectou'}</small>
              </span>
            )}
            {state === 'blocked' && <span className="screen-nosignal"><strong>Bloqueada</strong></span>}
            {state === 'on' && <span className="screen-tally">No ar</span>}
          </span>
        </span>
        <span className="screen-caption">
          <strong className="truncate">{d.name}</strong>
          {place && <span className="truncate">{place}</span>}
        </span>
      </Link>
    </li>
  );
}

export default function ScreenWall({ devices, linkFor, onOpen, showClient = false, empty }) {
  if (!devices?.length) return <p className="muted">{empty}</p>;
  const sorted = [...devices].sort((a, b) => rank(a) - rank(b));
  return (
    <ul className="screen-wall">
      {sorted.map((d) => (
        <Screen key={d.id} device={d} to={linkFor(d)} onOpen={onOpen && (() => onOpen(d))} showClient={showClient} />
      ))}
    </ul>
  );
}
