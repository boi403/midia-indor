import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Wallet, FolderOpen, Building2 } from 'lucide-react';
import api, { errorMessage } from '../../api';
import { useAuth } from '../../auth';
import { PageHeader, Modal, Field, Loading, Empty, useToast, fmtMoney, fmtDate, fmtAgo } from '../../ui';

const EMPTY = { name: '', plan_id: '', max_tvs_override: '', monthly_fee: '', due_day: 10, status: 'active', contact_email: '', contact_phone: '', notes: '', user_name: '', user_email: '', user_password: '' };
const PAYMENT = { em_dia: ['badge-ok', 'Em dia'], pendente: ['badge-warn', 'A vencer'], atrasado: ['badge-danger', 'Atrasado'], isento: ['badge-muted', 'Isento'] };

export default function Clients() {
  const [clients, setClients] = useState(null);
  const [plans, setPlans] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const { selectClient } = useAuth();
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.get('/admin/clients').then((r) => setClients(r.data)).catch((e) => toast(errorMessage(e), 'error'));
    api.get('/admin/plans').then((r) => setPlans(r.data)).catch(() => {});
  }, [toast]);
  useEffect(load, [load]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const edit = (c) => setForm({
    ...EMPTY, ...c, plan_id: c.plan_id || '', max_tvs_override: c.max_tvs_override ?? '',
    monthly_fee: c.monthly_fee_cents ? (c.monthly_fee_cents / 100).toFixed(2) : '', contact_email: c.contact_email || '', contact_phone: c.contact_phone || '', notes: c.notes || '',
  });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = { ...form, monthly_fee_cents: Math.round(parseFloat(String(form.monthly_fee).replace(',', '.') || '0') * 100) };
    try {
      if (form.id) await api.put(`/admin/clients/${form.id}`, payload);
      else await api.post('/admin/clients', payload);
      toast(form.id ? 'Cliente atualizado.' : 'Cliente criado.');
      setForm(null);
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const payment = async (c) => {
    try {
      await api.post(`/admin/clients/${c.id}/payment`, {});
      toast(`Pagamento de ${c.name} registrado hoje.`);
      load();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Excluir o cliente "${c.name}"?\n\nIsso apaga TVs, usuários, mídias, playlists e campanhas dele. Não dá para desfazer.`)) return;
    try {
      await api.delete(`/admin/clients/${c.id}`);
      toast('Cliente excluído.');
      load();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const manage = (c) => { selectClient(c.id); navigate('/admin/midias'); };

  if (!clients) return <Loading />;
  const selectedPlan = plans.find((p) => String(p.id) === String(form?.plan_id));

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle="Quem paga pelo serviço, qual plano e quantas TVs pode usar."
        actions={<button className="btn btn-primary" onClick={() => setForm({ ...EMPTY, plan_id: plans[0]?.id || '' })}><Plus size={16} /> Novo cliente</button>}
      />

      {clients.length === 0 ? <Empty icon={Building2} title="Nenhum cliente cadastrado" /> : (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Cliente</th><th>Plano</th><th>TVs</th><th>Ativas</th><th>Mensalidade</th><th>Vencimento</th><th>Último pagamento</th><th>Situação</th><th>Status</th><th>Cadastro</th><th /></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong><div className="muted small">{c.contact_email || ''}</div></td>
                  <td>{c.plan_name || '—'}</td>
                  <td>{c.tv_limit ?? '∞'}</td>
                  <td>{c.tvs}<span className="muted small"> ({c.tvs_online} online)</span></td>
                  <td>{fmtMoney(c.fee_cents)}</td>
                  <td>dia {c.due_day}</td>
                  <td>{c.last_payment_at ? fmtDate(c.last_payment_at) : '—'}</td>
                  <td><span className={`badge ${PAYMENT[c.payment_status][0]}`}>{PAYMENT[c.payment_status][1]}</span></td>
                  <td>{c.status === 'active' ? <span className="badge badge-ok">Ativo</span> : <span className="badge badge-muted">Inativo</span>}</td>
                  <td className="small">{fmtDate(c.created_at)}<div className="muted">acesso {c.last_access ? fmtAgo(c.last_access) : 'nunca'}</div></td>
                  <td className="row-actions">
                    <button className="icon-btn" title="Gerenciar conteúdo" onClick={() => manage(c)}><FolderOpen size={16} /></button>
                    <button className="icon-btn" title="Registrar pagamento de hoje" onClick={() => payment(c)}><Wallet size={16} /></button>
                    <button className="icon-btn" title="Editar" onClick={() => edit(c)}><Pencil size={16} /></button>
                    <button className="icon-btn danger" title="Excluir" onClick={() => remove(c)}><Trash2 size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} title={form?.id ? `Editar ${form.name}` : 'Novo cliente'} onClose={() => setForm(null)} wide
        footer={<><button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn btn-primary" form="client-form" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button></>}>
        {form && (
          <form id="client-form" onSubmit={save} className="form-grid">
            <Field label="Nome do cliente" className="span-2"><input className="input" value={form.name} onChange={set('name')} required placeholder="Ex.: Araguaia Palace Hotel" /></Field>
            <Field label="Plano">
              <select className="input" value={form.plan_id} onChange={set('plan_id')}>
                <option value="">Sem plano</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.max_tvs ?? '∞'} TVs · {fmtMoney(p.price_cents)}</option>)}
              </select>
            </Field>
            <Field label="Limite de TVs" hint={`Vazio = usa o do plano (${selectedPlan ? (selectedPlan.max_tvs ?? 'ilimitado') : '—'})`}>
              <input className="input" type="number" min="0" value={form.max_tvs_override} onChange={set('max_tvs_override')} />
            </Field>
            <Field label="Mensalidade (R$)" hint={`Vazio = preço do plano (${selectedPlan ? fmtMoney(selectedPlan.price_cents) : '—'})`}>
              <input className="input" inputMode="decimal" value={form.monthly_fee} onChange={set('monthly_fee')} placeholder="0,00" />
            </Field>
            <Field label="Dia do vencimento"><input className="input" type="number" min="1" max="28" value={form.due_day} onChange={set('due_day')} /></Field>
            <Field label="Status" hint="Inativo: o cliente não entra no painel e as TVs mostram “serviço suspenso”.">
              <select className="input" value={form.status} onChange={set('status')}><option value="active">Ativo</option><option value="inactive">Inativo</option></select>
            </Field>
            <Field label="E-mail de contato"><input className="input" type="email" value={form.contact_email} onChange={set('contact_email')} /></Field>
            <Field label="Telefone"><input className="input" value={form.contact_phone} onChange={set('contact_phone')} /></Field>
            <Field label="Observações" className="span-2"><textarea className="input" rows="2" value={form.notes} onChange={set('notes')} /></Field>
            {!form.id && (
              <fieldset className="span-2 fieldset">
                <legend>Acesso do cliente ao painel (opcional)</legend>
                <div className="form-grid">
                  <Field label="Nome do usuário"><input className="input" value={form.user_name} onChange={set('user_name')} /></Field>
                  <Field label="E-mail de login"><input className="input" type="email" value={form.user_email} onChange={set('user_email')} /></Field>
                  <Field label="Senha inicial" hint="Mínimo 6 caracteres"><input className="input" type="text" value={form.user_password} onChange={set('user_password')} minLength={form.user_email ? 6 : undefined} required={!!form.user_email} /></Field>
                </div>
              </fieldset>
            )}
          </form>
        )}
      </Modal>
    </div>
  );
}
