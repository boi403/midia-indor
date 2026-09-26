import { useCallback, useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAuth } from '../auth';
import { PageHeader, Loading, Empty, Stat, useToast, fmtDuration } from '../ui';

const ymd = (d) => d.toISOString().slice(0, 10);

function Table({ title, rows, labelKey, labelHead }) {
  const max = Math.max(1, ...rows.map((r) => r.plays));
  return (
    <section className="card">
      <h2 className="card-title">{title}</h2>
      {rows.length === 0 ? <p className="muted">Sem exibições no período.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{labelHead}</th><th>Exibições</th><th>Tempo em tela</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r[labelKey]}>
                  <td className="truncate">{r[labelKey] || '—'}</td>
                  <td>
                    <div className="bar-cell"><span className="bar-fill" style={{ width: `${(r.plays / max) * 100}%` }} /><span>{r.plays}</span></div>
                  </td>
                  <td>{fmtDuration(r.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Reports() {
  const { can } = useAuth();
  const [range, setRange] = useState({ from: ymd(new Date(Date.now() - 6 * 86400000)), to: ymd(new Date()) });
  const [data, setData] = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    api.get('/reports/playback', { params: range }).then((r) => setData(r.data)).catch((e) => toast(errorMessage(e), 'error'));
  }, [range, toast]);
  useEffect(() => { if (can('reports')) load(); }, [load, can]);

  if (!can('reports')) return <Empty icon={BarChart3} title="Relatórios não fazem parte do seu plano" />;

  return (
    <div>
      <PageHeader title="Relatórios de exibição" subtitle="O que cada TV realmente exibiu (proof-of-play). As TVs enviam o histórico a cada 2 minutos, inclusive o que ficou guardado enquanto estavam sem internet."
        actions={(
          <div className="inline-form">
            <input className="input" type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="De" />
            <input className="input" type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="Até" />
          </div>
        )} />
      {!data ? <Loading /> : (
        <>
          <div className="stats">
            <Stat label="Exibições" value={data.total.plays.toLocaleString('pt-BR')} />
            <Stat label="Tempo total em tela" value={fmtDuration(data.total.ms)} />
            <Stat label="Interrompidas" value={data.total.failed} tone={data.total.failed ? 'warn' : 'default'} />
            <Stat label="Dias com exibição" value={data.by_day.length} />
          </div>
          <div className="grid-2">
            <Table title="Por conteúdo" rows={data.by_item} labelKey="label" labelHead="Conteúdo" />
            <Table title="Por TV" rows={data.by_device} labelKey="name" labelHead="TV" />
          </div>
          <Table title="Por dia" rows={data.by_day} labelKey="day" labelHead="Dia" />
        </>
      )}
    </div>
  );
}
