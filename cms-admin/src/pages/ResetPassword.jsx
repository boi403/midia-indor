import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api, { errorMessage } from '../api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 10) return setError('A senha precisa ter no mínimo 10 caracteres.');
    if (form.password !== form.confirm) return setError('A confirmação não confere com a nova senha.');
    setBusy(true);
    try {
      await api.post('/reset-password', { token, password: form.password });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível redefinir a senha.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-stage">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div><strong>Mídia Indoor</strong><small>CMS de TV corporativa</small></div>
        </div>
        <p className="login-lead">Defina uma nova senha para continuar.</p>
      </section>

      <div className="login-side">
        {!token ? (
          <div className="login-card">
            <h1>Link inválido</h1>
            <p className="muted">Este link de redefinição de senha é inválido ou está incompleto.</p>
            <p className="muted small center"><Link to="/esqueci-senha">Solicitar novo link</Link></p>
          </div>
        ) : done ? (
          <div className="login-card">
            <h1>Senha redefinida</h1>
            <p className="muted">Senha redefinida. Você já pode entrar.</p>
            <Link to="/login" className="btn btn-primary btn-block">Entrar</Link>
          </div>
        ) : (
          <form className="login-card" onSubmit={submit}>
            <h1>Redefinir senha</h1>

            <label className="field">
              <span className="field-label">Nova senha</span>
              <input type="password" className="input" autoComplete="new-password" minLength={10} value={form.password} onChange={set('password')} required autoFocus />
              <span className="field-hint">Mínimo 10 caracteres</span>
            </label>
            <label className="field">
              <span className="field-label">Confirmar senha</span>
              <input type="password" className="input" autoComplete="new-password" minLength={10} value={form.confirm} onChange={set('confirm')} required />
            </label>

            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Salvando…' : 'Redefinir senha'}</button>
            <p className="muted small center"><Link to="/esqueci-senha">Pedir um novo link</Link></p>
          </form>
        )}
      </div>
    </div>
  );
}
