import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import api, { errorMessage } from '../api';

export default function SignUp() {
  const [form, setForm] = useState({ company_name: '', email: '', password: '', phone: '', has_computer: true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/signup', form);
      window.location.href = data.checkout_url;
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível concluir o cadastro.'));
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
        <p className="login-lead">Coloque sua rede de TVs no ar em minutos.</p>
      </section>

      <div className="login-side">
        <form className="login-card" onSubmit={submit}>
          <h1>Criar conta</h1>

          <div className="card" style={{ margin: 0 }}>
            <p className="card-title"><Rocket size={15} /> Assinatura mensal</p>
            <p className="muted small" style={{ margin: 0 }}>
              R$ 250/mês com 1 TV, R$ 500/mês com 2 TVs, R$ 799/mês com 3 ou mais. Cancele quando quiser.
              Pagamento por cartão, PIX ou boleto via Mercado Pago.
            </p>
          </div>

          <fieldset className="field">
            <span className="field-label">Implementação (taxa única)</span>
            <label className="logo-row">
              <input type="radio" name="has_computer" checked={form.has_computer === true} onChange={() => setForm({ ...form, has_computer: true })} />
              <span>Já tenho computador para instalar — <strong>R$ 250,00 + R$ 150,00</strong> de implementação</span>
            </label>
            <label className="logo-row">
              <input type="radio" name="has_computer" checked={form.has_computer === false} onChange={() => setForm({ ...form, has_computer: false })} />
              <span>Não tenho — quero que vocês levem o equipamento — <strong>R$ 2.675,43</strong></span>
            </label>
            <span className="field-hint">Cobrado junto com a 1ª mensalidade (R$ 250,00), discriminado no checkout.</span>
          </fieldset>

          <label className="field">
            <span className="field-label">Nome da empresa</span>
            <input className="input" value={form.company_name} onChange={set('company_name')} required autoFocus />
          </label>
          <label className="field">
            <span className="field-label">E-mail</span>
            <input type="email" className="input" autoComplete="username" value={form.email} onChange={set('email')} required />
          </label>
          <label className="field">
            <span className="field-label">Senha</span>
            <input type="password" className="input" autoComplete="new-password" minLength={10} value={form.password} onChange={set('password')} required />
            <span className="field-hint">Mínimo 10 caracteres</span>
          </label>
          <label className="field">
            <span className="field-label">Telefone</span>
            <input type="tel" className="input" value={form.phone} onChange={set('phone')} />
            <span className="field-hint">Opcional</span>
          </label>

          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Enviando…' : 'Continuar para pagamento'}</button>
          <p className="muted small center">Já tem conta? <Link to="/login">Entrar</Link></p>
        </form>
      </div>
    </div>
  );
}
