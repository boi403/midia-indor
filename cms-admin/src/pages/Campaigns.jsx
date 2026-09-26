import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, CalendarClock } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAuth } from '../auth';
import { PageHeader, Modal, Field, Loading, Empty, Toggle, useToast, DAY_NAMES } from '../ui';

const STATUS = { ativa: 'badge-ok', agendada: 'badge-info', encerrada: 'badge-muted', pausada: 'badge-warn' };
const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtStamp = (s) => { const [d, t] = s.split('T'); const [y, m, dd] = d.split('-'); return `${dd}/${m}/${y} ${t}`; };

function blank(playlists) {
  const start = new Date(); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return { name: '', playlist_id: playlists[0]?.id || '', start_at: localInput(start), end_at: localInput(end), days: [1, 2, 3, 4, 5], daily_from: '00:00', daily_to: '23:59', all_devices: true, device_ids: [], priority: 10, enabled: true, allDay: true };
}

// Agenda da semana: para cada dia, as faixas de horário das campanhas não encerradas.
function WeekAgenda({ campaigns }) {
  const live = campaigns.filter((c) => c.status === 'ativa' || c.status === 'agendada');
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() + i); return d; });
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (
    <div className="agenda">
      <div className="agenda-hours" aria-hidden="true">{[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{h}h</span>)}</div>
      {days.map((d) => {
        const ymd = localInput(d).slice(0, 10);
        const hits = live.filter((c) => c.days.includes(d.getDay()) && c.start_at.slice(0, 10) <= ymd && c.end_at.slice(0, 10) >= ymd);
        return (
          <div key={ymd} className="agenda-row">
            <div className="agenda-day">{DAY_NAMES[d.getDay()].slice(0, 3)} {d.getDate()}/{d.getMonth() + 1}</div>
            <div className="agenda-track">
              {hits.map((c, i) => {
                const a = toMin(c.daily_from); const b = toMin(c.daily_to);
                const segs = a <= b ? [[a, b]] : [[a, 1440], [0, b]];
                return segs.map(([x, y], k) => (
                  <div key={`${c.id}-${k}`} className="agenda-bar" style={{ left: `${(x / 1440) * 100}%`, width: `${Math.max(1, ((y - x) / 1440) * 100)}%`, top: `${4 + (i % 3) * 10}px` }}
                    title={`${c.name}: ${c.daily_from}–${c.daily_to} (${c.playlist_name})`} />
                ));
              })}
              {hits.length > 0 && <span className="agenda-label">{hits.map((c) => c.name).join(' · ')}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Campaigns() {
  const { can } = useAuth();
  const [items, setItems] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [devices, setDevices] = useState([]);
  const [form, setForm] = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    api.get('/campaigns').then((r) => setItems(r.data)).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);
  useEffect(() => {
    if (!can('scheduling')) return;
    load();
    api.get('/playlists').then((r) => setPlaylists(r.data)).catch(() => {});
    api.get('/devices').then((r) => setDevices(r.data)).catch(() => {});
  }, [load, can]);

  if (!can('scheduling')) return <Empty icon={CalendarClock} title="Agendamento não faz parte do seu plano">Fale com o administrador para liberar campanhas agendadas.</Empty>;
  if (!items) return <Loading />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggleDay = (d) => setForm({ ...form, days: form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d] });
  const toggleDevice = (id) => setForm({ ...form, device_ids: form.device_ids.includes(id) ? form.device_ids.filter((x) => x !== id) : [...form.device_ids, id] });

  const save = async (e) => {
    e.preventDefault();
    const payload = { ...form, daily_from: form.allDay ? '00:00' : form.daily_from, daily_to: form.allDay ? '23:59' : form.daily_to };
    try {
      if (form.id) await api.put(`/campaigns/${form.id}`, payload);
      else await api.post('/campaigns', payload);
      toast('Campanha salva. As TVs já receberam a programação.');
      setForm(null);
      load();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };
  const remove = async (c) => {
    if (!window.confirm(`Excluir a campanha "${c.name}"?`)) return;
    try { await api.delete(`/campaigns/${c.id}`); toast('Campanha excluída.'); load(); } catch (err) { toast(errorMessage(err), 'error'); }
  };
  const edit = (c) => setForm({ ...c, all_devices: !!c.all_devices, enabled: !!c.enabled, allDay: c.daily_from === '00:00' && c.daily_to === '23:59' });

  return (
    <div>
      <PageHeader title="Campanhas e agenda" subtitle="Uma campanha coloca uma playlist no ar em um período, dias e horários. Fora da janela, as TVs voltam sozinhas para a playlist normal."
        actions={<button className="btn btn-primary" onClick={() => setForm(blank(playlists))} disabled={!playlists.length}><Plus size={16} /> Nova campanha</button>} />

      <section className="card">
        <h2 className="card-title">Próximos 7 dias</h2>
        <WeekAgenda campaigns={items} />
      </section>

      {items.length === 0 ? <Empty icon={CalendarClock} title="Nenhuma campanha">Crie uma playlist com o conteúdo da promoção e agende aqui.</Empty> : (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Campanha</th><th>Playlist</th><th>Período</th><th>Dias</th><th>Horário</th><th>TVs</th><th>Status</th><th /></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.playlist_name}</td>
                  <td className="small">{fmtStamp(c.start_at)}<br />{fmtStamp(c.end_at)}</td>
                  <td className="small">{c.days.length === 7 ? 'Todos' : c.days.map((d) => DAY_NAMES[d].slice(0, 3)).join(', ')}</td>
                  <td>{c.daily_from === '00:00' && c.daily_to === '23:59' ? 'Dia todo' : `${c.daily_from}–${c.daily_to}`}</td>
                  <td>{c.all_devices ? 'Todas' : `${c.device_ids.length} TV(s)`}</td>
                  <td><span className={`badge ${STATUS[c.status]}`}>{c.status}</span></td>
                  <td className="row-actions">
                    <button className="icon-btn" title="Editar" onClick={() => edit(c)}><Pencil size={15} /></button>
                    <button className="icon-btn danger" title="Excluir" onClick={() => remove(c)}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} title={form?.id ? 'Editar campanha' : 'Nova campanha'} onClose={() => setForm(null)} wide
        footer={<><button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn btn-primary" form="camp-form">Salvar campanha</button></>}>
        {form && (
          <form id="camp-form" onSubmit={save} className="form-grid">
            <Field label="Nome"><input className="input" value={form.name} onChange={set('name')} placeholder="Promoção Café da Manhã" required /></Field>
            <Field label="Playlist exibida">
              <select className="input" value={form.playlist_id} onChange={set('playlist_id')} required>
                {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Início"><input className="input" type="datetime-local" value={form.start_at} onChange={set('start_at')} required /></Field>
            <Field label="Fim"><input className="input" type="datetime-local" value={form.end_at} onChange={set('end_at')} required /></Field>
            <fieldset className="span-2 fieldset">
              <legend>Dias da semana</legend>
              <div className="day-picks">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d} className={`day-pick ${form.days.includes(d) ? 'on' : ''}`}>
                    <input type="checkbox" checked={form.days.includes(d)} onChange={() => toggleDay(d)} /> {DAY_NAMES[d]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="span-2"><Toggle checked={form.allDay} onChange={(v) => setForm({ ...form, allDay: v })} label="O dia todo" /></div>
            {!form.allDay && (
              <>
                <Field label="Das"><input className="input" type="time" value={form.daily_from} onChange={set('daily_from')} /></Field>
                <Field label="Até" hint="Depois desse horário a TV volta à playlist normal."><input className="input" type="time" value={form.daily_to} onChange={set('daily_to')} /></Field>
              </>
            )}
            <fieldset className="span-2 fieldset">
              <legend>TVs</legend>
              <label className="check"><input type="checkbox" checked={form.all_devices} onChange={(e) => setForm({ ...form, all_devices: e.target.checked })} /> Todas as TVs do cliente</label>
              {!form.all_devices && (
                <div className="check-list">
                  {devices.map((d) => <label key={d.id} className="check"><input type="checkbox" checked={form.device_ids.includes(d.id)} onChange={() => toggleDevice(d.id)} /> {d.name}{d.location ? ` — ${d.location}` : ''}</label>)}
                </div>
              )}
            </fieldset>
            <Field label="Prioridade" hint="Se duas campanhas coincidirem, a de maior prioridade vence.">
              <input className="input" type="number" min="0" max="100" value={form.priority} onChange={set('priority')} />
            </Field>
            <div className="align-end"><Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Campanha ativa" /></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
