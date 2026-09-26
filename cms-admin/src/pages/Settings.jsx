import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import { PageHeader, Field, Loading, useToast } from '../ui';

// Aparência das TVs do cliente (antigo "Dashboard e Configurações Gerais").
export default function Settings() {
  const [cfg, setCfg] = useState(null);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get('/config').then((r) => setCfg(r.data)).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);

  if (!cfg) return <Loading />;
  const set = (k) => (e) => setCfg({ ...cfg, [k]: e.target.value });

  const uploadLogo = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.post('/upload', fd);
      setCfg({ ...cfg, logo_url: r.data.url, logo_full_url: r.data.full_url });
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setUploading(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    try { await api.put('/config', cfg); toast('Aparência salva. As TVs atualizam em segundos.'); } catch (err) { toast(errorMessage(err), 'error'); }
  };

  return (
    <div>
      <PageHeader title="Aparência da tela" subtitle="Identidade visual, previsão do tempo e feed de notícias exibidos em todas as TVs deste cliente." />
      <form onSubmit={save}>
        <section className="card">
          <h2 className="card-title">Identidade</h2>
          <div className="form-grid">
            <Field label="Nome exibido na tela"><input className="input" value={cfg.name} onChange={set('name')} required /></Field>
            <Field label="Slogan"><input className="input" value={cfg.tagline || ''} onChange={set('tagline')} /></Field>
            <Field label="Cor principal"><input className="input input-color" type="color" value={cfg.primary_color} onChange={set('primary_color')} /></Field>
            <Field label="Cor de destaque"><input className="input input-color" type="color" value={cfg.accent_color} onChange={set('accent_color')} /></Field>
            <Field label="Logo" className="span-2">
              <div className="logo-row">
                {cfg.logo_full_url && <img src={cfg.logo_full_url} alt="Logo atual" className="logo-preview" />}
                <input type="file" accept="image/*" onChange={uploadLogo} disabled={uploading} />
                {cfg.logo_url && <button type="button" className="link danger" onClick={() => setCfg({ ...cfg, logo_url: null, logo_full_url: null })}>Remover logo</button>}
                {uploading && <span className="muted small">Enviando…</span>}
              </div>
            </Field>
            <Field label="Fuso horário" hint="Usado nas campanhas agendadas.">
              <select className="input" value={cfg.timezone} onChange={set('timezone')}>
                {['America/Cuiaba', 'America/Sao_Paulo', 'America/Campo_Grande', 'America/Manaus', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Noronha'].map((z) => <option key={z} value={z}>{z.replace('America/', '').replace('_', ' ')}</option>)}
              </select>
            </Field>
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Previsão do tempo</h2>
          <div className="form-grid">
            <Field label="Cidade (aparece na tela)" className="span-2"><input className="input" value={cfg.weather_city || ''} onChange={set('weather_city')} placeholder="Alto Araguaia" /></Field>
            <Field label="Latitude"><input className="input" type="number" step="any" value={cfg.weather_lat ?? ''} onChange={set('weather_lat')} /></Field>
            <Field label="Longitude"><input className="input" type="number" step="any" value={cfg.weather_lon ?? ''} onChange={set('weather_lon')} /></Field>
          </div>
          <p className="muted small">No Google Maps, clique com o botão direito sobre a cidade: as coordenadas aparecem no topo do menu.</p>
        </section>

        <section className="card">
          <h2 className="card-title">Feed de notícias (RSS)</h2>
          <Field label="URL do feed" hint="WordPress: adicione /feed/ ao endereço do site. G1: https://g1.globo.com/rss/g1/">
            <input className="input" type="url" value={cfg.news_feed_url || ''} onChange={set('news_feed_url')} placeholder="https://www.prefeitura.gov.br/feed/" />
          </Field>
        </section>

        <div className="sticky-actions"><button className="btn btn-primary">Salvar aparência</button></div>
      </form>
    </div>
  );
}
