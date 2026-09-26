import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import api, { errorMessage } from '../../api';
import { useAuth } from '../../auth';
import { PageHeader, Modal, Field, Loading, Toggle, useToast, fmtAgo } from '../../ui';

const EMPTY = { name: '', email: '', role: 'client', client_id: '', active: true, password: '' };

export default function Users() {
  const [users, setUsers] = useState(null);
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState(null);
  const toast = useToast();
  const { user: me } = useAuth();

  const load = useCallback(() => {
    api.get('/admin/users').then((r) => setUsers(r.data)).catch((e) => toast(errorMessage(e), 'error'));
    api.get('/admin/clients').then((r) => setClients(r.data)).catch(() => {});
  }, [toast]);
  useEffect(load, [load]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) await api.put(`/admin/users/${form.id}`, form);
      else await api.post('/admin/users', form);
      toast('Usuário salvo.');
      setForm(null);
      load();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const remove = async (u) => {
    if (!window.confirm(`Excluir o usuário ${u.email}?`)) return;
    try { await api.delete(`/admin/users/${u.id}`); toast('Usuário excluído.'); load(); } catch (err) { toast(errorMessage(err), 'error'); }
  };

  if (!users) return <Loading />;

  return (
    <div>
      <PageHeader title="Usuários" subtitle="Administradores veem tudo. Usuários de cliente acessam só as TVs e o conteúdo do próprio cliente."
        actions={<button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}><Plus size={16} /> Novo usuário</button>} />
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Cliente</th><th>Último acesso</th><th>Status</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.name}</strong>{u.id === me.id && <span className="muted small"> (você)</span>}</td>
                <td>{u.email}</td>
                <td>{u.role === 'admin' ? <span className="badge badge-info">Administrador</span> : <span className="badge badge-muted">Cliente</span>}</td>
                <td>{u.client_name || '—'}</td>
                <td>{u.last_login_at ? fmtAgo(u.last_login_at) : 'nunca'}</td>
                <td>{u.active ? <span className="badge badge-ok">Ativo</span> : <span className="badge badge-muted">Desativado</span>}</td>
                <td className="row-actions">
                  <button className="icon-btn" title="Editar" onClick={() => setForm({ ...u, client_id: u.client_id || '', active: !!u.active, password: '' })}><Pencil size={16} /></button>
                  {u.id !== me.id && <button className="icon-btn danger" title="Excluir" onClick={() => remove(u)}><Trash2 size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!form} title={form?.id ? 'Editar usuário' : 'Novo usuário'} onClose={() => setForm(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn btn-primary" form="user-form">Salvar</button></>}>
        {form && (
          <form id="user-form" onSubmit={save} className="form-grid">
            <Field label="Nome" className="span-2"><input className="input" value={form.name} onChange={set('name')} required /></Field>
            <Field label="E-mail" className="span-2"><input className="input" type="email" value={form.email} onChange={set('email')} required /></Field>
            <Field label="Perfil">
              <select className="input" value={form.role} onChange={set('role')}><option value="client">Cliente</option><option value="admin">Administrador</option></select>
            </Field>
            {form.role === 'client' && (
              <Field label="Cliente">
                <select className="input" value={form.client_id} onChange={set('client_id')} required>
                  <option value="">— selecione —</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
            <Field label={form.id ? 'Nova senha' : 'Senha'} hint={form.id ? 'Deixe vazio para manter a atual' : 'Mínimo 6 caracteres'} className="span-2">
              <input className="input" type="text" value={form.password} onChange={set('password')} required={!form.id} minLength={6} />
            </Field>
            <div className="span-2"><Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Usuário ativo" /></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
