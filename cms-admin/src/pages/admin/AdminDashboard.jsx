import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Tv, Wallet, Megaphone } from 'lucide-react';
import api, { errorMessage } from '../../api';
import { useLive } from '../../live';
import { useAuth } from '../../auth';
import { PageHeader, Stat, Alerts, Loading, fmtMoney, fmtAgo } from '../../ui';
import OnlineChart from '../../components/OnlineChart';
import ScreenWall from '../../components/ScreenWall';

const PAYMENT = { em_dia: ['badge-ok', 'Em dia'], pendente: ['badge-warn', 'A vencer'], atrasado: ['badge-danger', 'Atrasado'], isento: ['badge-muted', 'Isento'] };

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const { selectClient } = useAuth();
  const seqRef = useRef(0);
  const liveTimer = useRef(null);

  const load = useCallback(() => {
    const seq = ++seqRef.current;
    api.get('/dashboard/admin').then((r) => {
      if (seq !== seqRef.current) return;
      setData(r.data);
      setError('');
    }).catch((e) => {
      if (seq !== seqRef.current) return;
      setError(errorMessage(e));
    });
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => () => clearTimeout(liveTimer.current), []);
  useLive((msg) => {
    if (msg.type === 'device.online' || msg.type === 'device.offline') {
      clearTimeout(liveTimer.current);
      liveTimer.current = setTimeout(load, 1500);
    }
  });

  if (error) return <div className="form-error">{error}</div>;
  if (!data) return <Loading />;
  const s = data.stats;

  return (
    <div>
      <PageHeader title="Visão geral" subtitle="Todos os clientes e TVs, atualizado em tempo real." />

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Telas</h2>
          <div className="wall-summary">
            <span className="on"><b>{s.online}</b> no ar</span>
            {s.offline > 0 && <span className="off"><b>{s.offline}</b> sem sinal</span>}
          </div>
        </div>
        <ScreenWall devices={data.devices} showClient
          linkFor={(d) => `/admin/dispositivos/${d.id}`} onOpen={(d) => selectClient(d.client_id)}
          empty="Nenhuma TV cadastrada ainda. Ligue uma TV em /tv e vincule o código em Dispositivos." />
      </section>

      <div className="stats">
        <Stat icon={Users} label="Clientes" value={s.clients} />
        <Stat icon={Tv} label="TVs cadastradas" value={s.tvs} hint={[s.pending && `${s.pending} aguardando ativação`, s.blocked && `${s.blocked} bloqueada(s)`].filter(Boolean).join(' · ') || null} />
        <Stat icon={Wallet} label="Pagantes" value={s.paying} hint={`${fmtMoney(s.revenue_cents)}/mês`} />
        <Stat icon={Megaphone} label="Campanhas ativas" value={s.campaigns} />
      </div>

      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">TVs no ar nas últimas 24 horas</h2>
          <OnlineChart series={data.series} />
        </section>
        <section className="card">
          <h2 className="card-title">Alertas</h2>
          <Alerts alerts={data.alerts} />
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Clientes</h2>
          <Link to="/admin/clientes" className="btn btn-ghost">Gerenciar clientes</Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Cliente</th><th>Plano</th><th>TVs</th><th>Online</th><th>Mensalidade</th><th>Pagamento</th><th>Último acesso</th><th>Status</th></tr></thead>
            <tbody>
              {data.clients.map((c) => (
                <tr key={c.id}>
                  <td><Link to="/admin/dispositivos" onClick={() => selectClient(c.id)}><strong>{c.name}</strong></Link></td>
                  <td>{c.plan_name || '—'}</td>
                  <td>{c.tvs}{c.tv_limit ? ` / ${c.tv_limit}` : ''}</td>
                  <td>{c.tvs_online}</td>
                  <td>{fmtMoney(c.fee_cents)}</td>
                  <td><span className={`badge ${PAYMENT[c.payment_status][0]}`}>{PAYMENT[c.payment_status][1]}</span></td>
                  <td>{c.last_access ? fmtAgo(c.last_access) : 'nunca'}</td>
                  <td>{c.status === 'active' ? <span className="badge badge-ok">Ativo</span> : <span className="badge badge-muted">Inativo</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
