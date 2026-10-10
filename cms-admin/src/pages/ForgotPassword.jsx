import { useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errorMessage } from '../api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/forgot-password', { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível enviar o link.'));
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
        <p className="login-lead">Vamos recuperar o acesso à sua conta.</p>
      </section>

      <div className="login-side">
        {sent ? (
          <div className="login-card">
            <h1>Verifique seu e-mail</h1>
            <p className="muted">Se esse e-mail estiver cadastrado, enviamos um link para redefinir a senha. Verifique sua caixa de entrada (e o spam).</p>
            <p className="muted small center"><Link to="/login">Voltar para o login</Link></p>
          </div>
        ) : (
          <form className="login-card" onSubmit={submit}>
            <h1>Esqueci minha senha</h1>
            <p className="muted small" style={{ margin: 0 }}>Informe seu e-mail e enviaremos um link para redefinir a senha.</p>

            <label className="field">
              <span className="field-label">E-mail</span>
              <input type="email" className="input" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </label>

            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button>
            <p className="muted small center"><Link to="/login">Voltar para o login</Link></p>
          </form>
        )}
      </div>
    </div>
  );
}
