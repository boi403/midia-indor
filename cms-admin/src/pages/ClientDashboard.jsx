import { useCallback, useEffect, useState } from 'react';
import { Image as ImageIcon, ListVideo, Megaphone } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useLive } from '../live';
import { PageHeader, Stat, Alerts, Loading, UsageBar } from '../ui';
import OnlineChart from '../components/OnlineChart';
import ScreenWall from '../components/ScreenWall';

export default function ClientDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/dashboard/client').then((r) => setData(r.data)).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useLive((msg) => { if (msg.type?.startsWith('device.')) load(); });

  if (error) return <div className="form-error">{error}</div>;
  if (!data) return <Loading />;
  const { client: c, stats: s } = data;

  return (
    <div>
      <PageHeader title={`Olá, ${c.name}`} subtitle={<>Seu plano: <strong>{c.plan || '—'}</strong></>} />

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Minhas TVs</h2>
          <div className="wall-summary">
            <span className="on"><b>{s.online}</b> no ar</span>
            {s.offline > 0 && <span className="off"><b>{s.offline}</b> sem sinal</span>}
          </div>
        </div>
        <ScreenWall devices={data.devices} linkFor={(d) => `../tvs/${d.id}`}
          empty="Nenhuma TV vinculada ainda. Fale com o administrador para ativar suas telas." />
      </section>

      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">Uso do plano</h2>
          <UsageBar label="TVs" used={s.tvs} limit={c.tv_limit} />
          <UsageBar label="Mídias" used={s.media} limit={c.max_media} />
          <UsageBar label="Playlists" used={s.playlists} limit={c.max_playlists} />
        </section>
        <div className="stats stats-2">
          <Stat icon={ImageIcon} label="Mídias" value={s.media} />
          <Stat icon={ListVideo} label="Playlists" value={s.playlists} />
          <Stat icon={Megaphone} label="Campanhas no ar" value={s.campaigns} />
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">Alertas</h2>
          <Alerts alerts={data.alerts} />
        </section>
        <section className="card">
          <h2 className="card-title">TVs no ar nas últimas 24 horas</h2>
          <OnlineChart series={data.series} />
        </section>
      </div>
    </div>
  );
}
