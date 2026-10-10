import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Presentation } from 'lucide-react';
import api, { errorMessage } from '../api';
import { PageHeader, Modal, Field, Loading, Empty, useToast, ORIENTATION_LABEL } from '../ui';

const VARIANTS = { institucional: 'Institucional', promo: 'Promoção', aviso: 'Aviso', qrcode: 'QR Code' };

function parseConfig(s) {
  try { return JSON.parse(s.config_json || '{}'); } catch { return {}; }
}

export default function Slides() {
  const [slides, setSlides] = useState(null);
  const [form, setForm] = useState(null);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    api.get('/slides').then((r) => setSlides(r.data)).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);
  useEffect(load, [load]);

  const open = (s) => {
    const cfg = s ? parseConfig(s) : {};
    setForm({
      id: s?.id, type_variant: s ? (s.type === 'widget' ? 'qrcode' : s.variant) : 'institucional',
      kick: s?.kick || '', title: s?.title || '', text: s?.text || '', duration_s: Math.round((s?.duration_ms || 10000) / 1000),
      orientation: s?.orientation || 'any', qrData: cfg.data || '', qrTitle: cfg.title || '', qrCaption: cfg.caption || '',
      bg_url: s?.bg_url || null, bg_full_url: s?.bg_full_url || null,
    });
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const uploadBg = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.post('/upload', fd);
      setForm((f) => ({ ...f, bg_url: r.data.url, bg_full_url: r.data.full_url }));
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setUploading(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    const isQR = form.type_variant === 'qrcode';
    const payload = {
      type: isQR ? 'widget' : 'slide', variant: isQR ? null : form.type_variant, widget: isQR ? 'qrcode' : null,
      kick: form.kick, title: form.title, text: form.text, orientation: form.orientation,
      duration_ms: (parseInt(form.duration_s, 10) || 10) * 1000,
      config_json: isQR ? JSON.stringify({ data: form.qrData, title: form.qrTitle, caption: form.qrCaption }) : null,
      bg_url: form.bg_url || null,
    };
    try {
      if (form.id) await api.put(`/slides/${form.id}`, payload);
      else await api.post('/slides', payload);
      toast('Slide salvo. Adicione-o a uma playlist para ir ao ar.');
      setForm(null);
      load();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const remove = async (s) => {
    if (!window.confirm('Excluir este slide? Ele também sai das playlists.')) return;
    try { await api.delete(`/slides/${s.id}`); toast('Slide excluído.'); load(); } catch (err) { toast(errorMessage(err), 'error'); }
  };

  if (!slides) return <Loading />;
  const isQR = form?.type_variant === 'qrcode';

  return (
    <div>
      <PageHeader title="Slides e QR Code" subtitle="Peças de texto geradas pelo sistema, sem precisar criar arte. Use em qualquer playlist."
        actions={<button className="btn btn-primary" onClick={() => open(null)}><Plus size={16} /> Novo slide</button>} />

      {slides.length === 0 ? <Empty icon={Presentation} title="Nenhum slide ainda" /> : (
        <div className="slide-grid">
          {slides.map((s) => {
            const cfg = parseConfig(s);
            const variant = s.type === 'widget' ? 'qrcode' : s.variant;
            return (
              <article key={s.id} className="card slide-card">
                <div className={`slide-preview sp-${variant}`} style={s.bg_full_url ? { backgroundImage: `url(${s.bg_full_url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
                  {variant === 'qrcode' ? (
                    <><div className="sp-qr" aria-hidden="true">▦</div><div><strong>{cfg.title}</strong><small>{cfg.caption}</small></div></>
                  ) : (
                    <div><small>{s.kick}</small><strong dangerouslySetInnerHTML={{ __html: sanitizeTitle(s.title) }} /></div>
                  )}
                </div>
                <div className="slide-meta">
                  <span className="badge badge-muted">{VARIANTS[variant] || variant}</span>
                  <span className="muted small">{Math.round(s.duration_ms / 1000)}s · {ORIENTATION_LABEL[s.orientation || 'any']}</span>
                  <span className="row-actions">
                    <button className="icon-btn" title="Editar" onClick={() => open(s)}><Pencil size={15} /></button>
                    <button className="icon-btn danger" title="Excluir" onClick={() => remove(s)}><Trash2 size={15} /></button>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal open={!!form} title={form?.id ? 'Editar slide' : 'Novo slide'} onClose={() => setForm(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button><button className="btn btn-primary" form="slide-form">Salvar</button></>}>
        {form && (
          <form id="slide-form" onSubmit={save} className="form-grid">
            {!form.id && (
              <Field label="Tipo" className="span-2">
                <select className="input" value={form.type_variant} onChange={set('type_variant')}>
                  <option value="institucional">Institucional (fundo padrão)</option>
                  <option value="promo">Promoção (destaque)</option>
                  <option value="aviso">Aviso (simples e direto)</option>
                  <option value="qrcode">QR Code</option>
                </select>
              </Field>
            )}
            <Field label="Imagem de fundo (opcional)" hint="Substitui o fundo padrão da variante. Recomendado: imagem na orientação da TV." className="span-2">
              <div className="logo-row">
                {form.bg_full_url && <img src={form.bg_full_url} alt="Fundo atual" className="logo-preview" />}
                <input type="file" accept="image/*" onChange={uploadBg} disabled={uploading} />
                {form.bg_url && <button type="button" className="link danger" onClick={() => setForm({ ...form, bg_url: null, bg_full_url: null })}>Remover imagem</button>}
                {uploading && <span className="muted small">Enviando…</span>}
              </div>
            </Field>
            {!isQR ? (
              <>
                <Field label="Chamada" className="span-2"><input className="input" value={form.kick} onChange={set('kick')} placeholder="Promoção do dia" /></Field>
                <Field label="Título" hint="Use <em>texto</em> para destacar na cor de destaque." className="span-2"><input className="input" value={form.title} onChange={set('title')} placeholder="50% de <em>desconto</em>" /></Field>
                <Field label="Descrição" className="span-2"><textarea className="input" rows="3" value={form.text} onChange={set('text')} /></Field>
              </>
            ) : (
              <>
                <Field label="Título ao lado do QR Code" className="span-2"><input className="input" value={form.qrTitle} onChange={set('qrTitle')} placeholder="Siga no Instagram" /></Field>
                <Field label="Subtítulo" className="span-2"><input className="input" value={form.qrCaption} onChange={set('qrCaption')} placeholder="Aponte a câmera" /></Field>
                <Field label="Conteúdo do QR Code" hint="Link, ou Wi-Fi no formato WIFI:T:WPA;S:rede;P:senha;;" className="span-2"><input className="input" value={form.qrData} onChange={set('qrData')} required /></Field>
              </>
            )}
            <Field label="Tempo padrão (segundos)"><input className="input" type="number" min="1" max="600" value={form.duration_s} onChange={set('duration_s')} /></Field>
            <Field label="Orientação">
              <select className="input" value={form.orientation} onChange={set('orientation')}>
                {['any', 'landscape', 'portrait'].map((o) => <option key={o} value={o}>{ORIENTATION_LABEL[o]}</option>)}
              </select>
            </Field>
          </form>
        )}
      </Modal>
    </div>
  );
}

// Só as tags de destaque que o player também aceita.
function sanitizeTitle(t = '') {
  const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/&lt;(\/?(em|b|strong|i)|br\s*\/?)&gt;/gi, '<$1>');
}
