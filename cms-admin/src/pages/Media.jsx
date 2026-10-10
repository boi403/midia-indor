import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Upload, Image as ImageIcon, Film } from 'lucide-react';
import api, { errorMessage } from '../api';
import { PageHeader, Loading, Empty, useToast, ORIENTATION_LABEL } from '../ui';

export default function Media() {
  const [items, setItems] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [uploading, setUploading] = useState(null);
  const [orientation, setOrientation] = useState('any');
  const [addTo, setAddTo] = useState('');
  const [filter, setFilter] = useState('all');
  const fileRef = useRef(null);
  const toast = useToast();

  const load = useCallback(() => {
    api.get('/midia').then((r) => setItems(r.data)).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);
  useEffect(() => {
    load();
    api.get('/playlists').then((r) => setPlaylists(r.data)).catch(() => {});
  }, [load]);

  const upload = async (files) => {
    for (const [i, file] of [...files].entries()) {
      const fd = new FormData();
      fd.append('orientation', orientation);
      if (addTo) fd.append('add_to_playlist', addTo);
      fd.append('file', file);
      setUploading({ name: file.name, n: i + 1, total: files.length, pct: 0 });
      try {
        await api.post('/midia', fd, { onUploadProgress: (e) => setUploading((u) => ({ ...u, pct: e.total ? Math.round((e.loaded / e.total) * 100) : 0 })) });
      } catch (err) {
        toast(`${file.name}: ${errorMessage(err, 'falha no envio')}`, 'error');
        break;
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = '';
    load();
  };

  const patch = async (m, changes, msg) => {
    try { await api.patch(`/midia/${m.id}`, changes); if (msg) toast(msg); load(); } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const remove = async (m) => {
    const warn = m.usage ? `\n\nEla está em ${m.usage} item(ns) de playlist e será removida de lá também.` : '';
    if (!window.confirm(`Excluir "${m.title || m.original_name || m.filename}"?${warn}`)) return;
    try { await api.delete(`/midia/${m.id}`); toast('Mídia excluída.'); load(); } catch (err) { toast(errorMessage(err), 'error'); }
  };

  if (!items) return <Loading />;
  const shown = items.filter((m) => filter === 'all' || m.type === filter || m.orientation === filter);

  return (
    <div>
      <PageHeader title="Mídias" subtitle="Imagens e vídeos do cliente. Depois de enviar, monte a ordem de exibição em Playlists." />

      <section className="card upload-box"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}>
        <Upload size={22} />
        <div className="upload-main">
          <strong>Arraste imagens ou vídeos aqui</strong>
          <span className="muted small">JPG, PNG, WEBP, MP4. Vídeos em H.264 1080p rodam melhor em TV Box.</span>
        </div>
        <div className="inline-form">
          <select className="input" value={orientation} onChange={(e) => setOrientation(e.target.value)} title="Para qual orientação de TV é esta arte">
            <option value="any">Serve para qualquer TV</option>
            <option value="landscape">Só TVs horizontais</option>
            <option value="portrait">Só TVs verticais</option>
          </select>
          <select className="input" value={addTo} onChange={(e) => setAddTo(e.target.value)}>
            <option value="">Não adicionar a playlist</option>
            {playlists.map((p) => <option key={p.id} value={p.id}>Adicionar a: {p.name}</option>)}
          </select>
          <input ref={fileRef} type="file" id="media-file" hidden multiple accept="image/*,video/*" onChange={(e) => e.target.files.length && upload(e.target.files)} />
          <label htmlFor="media-file" className="btn btn-primary">Escolher arquivos</label>
        </div>
        {uploading && (
          <div className="upload-progress">
            Enviando {uploading.n}/{uploading.total}: {uploading.name} — {uploading.pct}%
            <div className="usage-bar"><div className="usage-fill usage-ok" style={{ width: `${uploading.pct}%` }} /></div>
          </div>
        )}
      </section>

      <div className="filters">
        {[['all', 'Todas'], ['image', 'Imagens'], ['video', 'Vídeos'], ['landscape', 'Horizontais'], ['portrait', 'Verticais']].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
        <span className="muted small">{shown.length} de {items.length}</span>
      </div>

      {shown.length === 0 ? <Empty icon={ImageIcon} title="Nenhuma mídia aqui" /> : (
        <div className="media-grid">
          {shown.map((m) => (
            <article key={m.id} className="media-card">
              <div className={`thumb ${m.orientation === 'portrait' ? 'thumb-portrait' : ''}`}>
                {m.type === 'video' ? <video src={m.full_url} muted preload="none" /> : <img src={m.full_url} alt="" loading="lazy" />}
                <span className="thumb-tag">{m.type === 'video' ? <><Film size={12} /> vídeo</> : 'imagem'}</span>
              </div>
              <div className="media-body">
                <input className="input input-sm" defaultValue={m.title || m.original_name || ''} aria-label="Título"
                  onBlur={(e) => e.target.value !== (m.title || '') && patch(m, { title: e.target.value })} />
                <div className="media-row">
                  <label className="mini-field" title="Duração padrão ao adicionar em playlists">
                    ⏱ <input type="number" min="1" max="3600" defaultValue={Math.round(m.duration_ms / 1000)}
                      onBlur={(e) => Number(e.target.value) * 1000 !== m.duration_ms && patch(m, { duration_ms: Number(e.target.value) * 1000 }, 'Duração salva.')} />s
                  </label>
                  <select className="input input-sm" value={m.orientation} onChange={(e) => patch(m, { orientation: e.target.value })} aria-label="Orientação">
                    {['any', 'landscape', 'portrait'].map((o) => <option key={o} value={o}>{ORIENTATION_LABEL[o]}</option>)}
                  </select>
                </div>
                <div className="media-row">
                  <span className="muted small">{m.usage ? `em ${m.usage} playlist(s)` : 'fora de playlists'}</span>
                  <button className="icon-btn danger" title="Excluir" onClick={() => remove(m)}><Trash2 size={15} /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
