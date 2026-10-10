import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, Building2 } from 'lucide-react';
import { useAuth } from '../auth';
import { errorMessage } from '../api';

// Telas decorativas do painel esquerdo: ligam uma a uma ao abrir a página;
// uma fica sem sinal, como na vida real.
const WALL = Array.from({ length: 9 }, (_, i) => (i === 5 ? 'off' : 'on'));

export default function Login() {
  const { user, login } = useAuth();
  const [role, setRole] = useState('client');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/cliente'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await login(email, password, role);
      const home = u.role === 'admin' ? '/admin' : '/cliente';
      const from = location.state?.from;
      navigate(from && from.startsWith(home) ? from : home, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível entrar.'));
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
        <div className="login-wall" aria-hidden="true">
          {WALL.map((s, i) => <span key={i} className={`wall-${s}`} style={{ '--i': i }} />)}
        </div>
        <p className="login-lead">O que passa em cada TV, programado e acompanhado daqui.</p>
      </section>

      <div className="login-side">
        <form className="login-card" onSubmit={submit}>
          <h1>Entrar</h1>

          <div className="segmented" role="tablist" aria-label="Tipo de acesso">
            <button type="button" role="tab" aria-selected={role === 'client'} className={role === 'client' ? 'on' : ''} onClick={() => setRole('client')}>
              <Building2 size={16} /> Cliente
            </button>
            <button type="button" role="tab" aria-selected={role === 'admin'} className={role === 'admin' ? 'on' : ''} onClick={() => setRole('admin')}>
              <ShieldCheck size={16} /> Administrador
            </button>
          </div>

          <label className="field">
            <span className="field-label">E-mail</span>
            <input type="email" className="input" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="field">
            <span className="field-label">Senha</span>
            <input type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <p className="muted small" style={{ margin: 0 }}><Link to="/esqueci-senha">Esqueci minha senha</Link></p>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Entrando…' : role === 'admin' ? 'Entrar como administrador' : 'Entrar'}</button>
          <p className="muted small center">A sessão fica salva neste navegador até você sair.</p>
          <p className="muted small center">Ainda não é cliente? <Link to="/cadastro">Assine agora</Link></p>
        </form>
      </div>
    </div>
  );
}
