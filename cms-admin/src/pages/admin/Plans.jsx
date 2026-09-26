import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Check, Minus } from 'lucide-react';
import api, { errorMessage } from '../../api';
import { PageHeader, Modal, Field, Loading, Toggle, useToast, fmtMoney } from '../../ui';

const FEATURES = [['feat_scheduling', 'Agendamento de campanhas'], ['feat_cameras', 'Câmeras ao vivo'], ['feat_reports', 'Relatórios'], ['feat_api', 'API']];
const EMPTY = { name: '', max_tvs: '', max_media: '', max_playlists: '', price: '', feat_scheduling: 0, feat_cameras: 0, feat_reports: 0, feat_api: 0 };
const lim = (v, unit) => (v == null ? `${unit} ilimitadas` : `Até ${v} ${unit}`);

export default function Plans() {
  const [plans, setPlans] = useState(null);
  const [form, setForm] = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    api.get('/admin/plans').then((r) => setPlans(r.data)).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);
  useEffect(load, [load]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const payload = { ...form, price_cents: Math.round(parseFloat(String(form.price).replace(',', '.') || '0') * 100) };
    try {
      if (form.id) await api.put(`/admin/plans/${form.id}`, payload);
      else await api.post('/admin/plans', payload);
      toast('Plano salvo.');
      setForm(null);
      load();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const remove = async (p) => {
    if (!window.confirm(`Excluir o plano ${p.name}?`)) return;
    try { await api.delete(`/admin/plans/${p.id}`); toast('Plano excluído.'); load(); } catch (err) { toast(errorMessage(err), 'error'); }
  };

  if (!plans) return <Loading />;

  return (
    <div>
      <PageHeader title="Planos" subtitle="Limites e recursos de cada plano. Valores configuráveis; o limite de TVs pode ser ajustado por cliente."
        actions={<button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}><Plus size={16} /> Novo plano</button>} />
      <div className="plans">
        {plans.map((p) => (
          <article key={p.id} className="card plan">
            <div className="card-head">
              <h2 className="card-title">{p.name}</h2>
              <div className="row-actions">
                <button className="icon-btn" title="Editar" onClick={() => setForm({ ...p, max_tvs: p.max_tvs ?? '', max_media: p.max_media ?? '', max_playlists: p.max_playlists ?? '', price: (p.price_cents / 100).toFixed(2) })}><Pencil size={16} /></button>
                <button className="icon-btn danger" title="Excluir" onClick={() => remove(p)}><Trash2 size={16} /></button>
              </div>
            </div>
            <div className="plan-price">{fmtMoney(p.price_cents)}<span>/mês</span></div>
            <ul className="plan-list">
              <li><Check size={14} /> {lim(p.max_tvs, 'TVs')}</li>
              <li><Check size={14} /> {lim(p.max_media, 'mídias')}</li>
              <li><Check size={14} /> {lim(p.max_playlists, 'playlists')}</li>
              {FEATURES.map(([k, label]) => (
                <li key={k} className={p[k] ? '' : 'off'}>{p[k] ? <Check size={14} /> : <Minus size={14} />} {label}</li>
              ))}
            </ul>
            <div className="muted small">{p.clients} cliente(s) neste plano</div>
          </article>
        ))}
      </div>

      <Modal open={!!form} title={form?.id ? `Editar plano ${form.name}` : 'Novo plano'} onClose={() => setForm(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn btn-primary" form="plan-form">Salvar</button></>}>
        {form && (
          <form id="plan-form" onSubmit={save} className="form-grid">
            <Field label="Nome"><input className="input" value={form.name} onChange={set('name')} required /></Field>
            <Field label="Preço mensal (R$)"><input className="input" inputMode="decimal" value={form.price} onChange={set('price')} /></Field>
            <Field label="Máximo de TVs" hint="Vazio = ilimitado"><input className="input" type="number" min="0" value={form.max_tvs} onChange={set('max_tvs')} /></Field>
            <Field label="Máximo de mídias" hint="Vazio = ilimitado"><input className="input" type="number" min="0" value={form.max_media} onChange={set('max_media')} /></Field>
            <Field label="Máximo de playlists" hint="Vazio = ilimitado"><input className="input" type="number" min="0" value={form.max_playlists} onChange={set('max_playlists')} /></Field>
            <div className="span-2 stack">
              {FEATURES.map(([k, label]) => <Toggle key={k} checked={!!form[k]} onChange={(v) => setForm({ ...form, [k]: v ? 1 : 0 })} label={label} />)}
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
