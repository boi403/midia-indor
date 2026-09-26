import { useState } from 'react';
import api, { errorMessage } from '../api';
import { useAuth } from '../auth';
import { PageHeader, Field, useToast } from '../ui';

export default function Account() {
  const { user } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const toast = useToast();

  const save = async (e) => {
    e.preventDefault();
    if (form.next !== form.confirm) return toast('A confirmação não confere com a nova senha.', 'error');
    try {
      await api.post('/auth/password', form);
      toast('Senha alterada.');
      setForm({ current: '', next: '', confirm: '' });
    } catch (err) { toast(errorMessage(err), 'error'); }
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div>
      <PageHeader title="Minha conta" subtitle={`${user.name} · ${user.email} · ${user.role === 'admin' ? 'Administrador' : `Cliente ${user.client?.name}`}`} />
      <section className="card narrow">
        <h2 className="card-title">Trocar senha</h2>
        <form onSubmit={save} className="stack">
          <Field label="Senha atual"><input className="input" type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required /></Field>
          <Field label="Nova senha" hint="Mínimo 6 caracteres"><input className="input" type="password" autoComplete="new-password" minLength={6} value={form.next} onChange={set('next')} required /></Field>
          <Field label="Confirmar nova senha"><input className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required /></Field>
          <div><button className="btn btn-primary">Salvar nova senha</button></div>
        </form>
      </section>
    </div>
  );
}
