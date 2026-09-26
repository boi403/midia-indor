import { useCallback, useEffect, useState } from 'react';
import { Camera, Eye, EyeOff, Pencil, Trash2, Tv } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAuth } from '../auth';
import { PageHeader, Field, Loading, Empty, Modal, Toggle, useToast } from '../ui';

const EMPTY = { label: '', url: '', duration_s: 15, add_to_playlist: '' };

export default function Cameras() {
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    api.get('/cameras').then((r) => setData(r.data)).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);
  useEffect(() => {
    if (!can('cameras')) return;
    load();
    api.get('/playlists').then((r) => setPlaylists(r.data)).catch(() => {});
  }, [load, can]);

  if (!can('cameras')) return <Empty icon={Camera} title="Câmeras não fazem parte do seu plano">Fale com o administrador para incluir câmeras ao vivo.</Empty>;
  if (!data) return <Loading />;

  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); load(); } catch (err) { toast(errorMessage(err), 'error'); } };
  const add = (e) => {
    e.preventDefault();
    act(async () => {
      await api.post('/cameras', { label: form.label, url: form.url, duration_ms: form.duration_s * 1000, add_to_playlist: form.add_to_playlist || null });
      setForm({ ...EMPTY });
    }, 'Câmera adicionada.');
  };
  const saveEdit = (e) => {
    e.preventDefault();
    act(async () => {
      await api.put(`/cameras/${editing.id}`, { label: editing.label, url: editing.url, duration_ms: editing.duration_s * 1000 });
      setEditing(null);
    }, 'Câmera atualizada.');
  };
  const pinned = data.cameras.find((c) => c.id === data.pinned_camera_id);

  return (
    <div>
      <PageHeader title="Câmeras ao vivo" subtitle="Streams RTSP do DVR/NVR convertidos pelo servidor para as TVs. Uma conversão por câmera atende várias TVs ao mesmo tempo." />

      {pinned && (
        <div className="card banner-live">
          <span>🔴 <strong>{pinned.label}</strong> está fixada em <strong>todas as TVs</strong>, no lugar da programação normal.</span>
          <button className="btn btn-primary" onClick={() => act(() => api.post('/cameras/unpin'), 'Programação normal restaurada.')}>Voltar à programação normal</button>
        </div>
      )}

      <section className="card">
        <h2 className="card-title">Adicionar câmera</h2>
        <form onSubmit={add} className="form-grid">
          <Field label="Nome da câmera"><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Câmera 1 - Recepção" required /></Field>
          <Field label="Tempo na playlist (segundos)"><input className="input" type="number" min="5" max="300" value={form.duration_s} onChange={(e) => setForm({ ...form, duration_s: Number(e.target.value) })} /></Field>
          <Field label="URL RTSP" className="span-2"><input className="input mono" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="rtsp://admin:senha@192.168.1.100:554/cam/realmonitor?channel=1&subtype=1" required /></Field>
          <Field label="Entrar na playlist" hint="Ex.: Publicidade → Câmera 01 (15s) → Publicidade. Você pode reordenar depois.">
            <select className="input" value={form.add_to_playlist} onChange={(e) => setForm({ ...form, add_to_playlist: e.target.value })}>
              <option value="">Não adicionar agora</option>
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <div className="align-end"><button className="btn btn-primary">+ Adicionar câmera</button></div>
        </form>
      </section>

      {data.cameras.length === 0 ? <Empty icon={Camera} title="Nenhuma câmera cadastrada" /> : (
        <div className="stack">
          {data.cameras.map((cam) => (
            <article key={cam.id} className={`card camera-row ${cam.enabled ? '' : 'is-off'} ${pinned?.id === cam.id ? 'is-live' : ''}`}>
              <div className="grow">
                <strong>📷 {cam.label}</strong>
                {pinned?.id === cam.id && <span className="badge badge-danger">● ao vivo em todas as TVs</span>}
                <div className="mono small muted truncate">{cam.url}</div>
                <div className="small muted">{cam.duration_ms / 1000}s quando entra na playlist</div>
              </div>
              <div className="btn-row">
                <Toggle checked={cam.enabled} onChange={() => act(() => api.post(`/cameras/${cam.id}/toggle`))} label="Ativa" />
                {pinned?.id === cam.id
                  ? <button className="btn btn-ghost btn-sm" onClick={() => act(() => api.post('/cameras/unpin'), 'Programação normal restaurada.')}>Parar de exibir</button>
                  : <button className="btn btn-danger btn-sm" onClick={() => act(() => api.post(`/cameras/${cam.id}/pin`), `${cam.label} fixada em todas as TVs.`)}><Tv size={15} /> Exibir agora em todas</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => setPreview(preview === cam.id ? null : cam.id)}>{preview === cam.id ? <><EyeOff size={15} /> Fechar</> : <><Eye size={15} /> Preview</>}</button>
                <button className="icon-btn" title="Editar" onClick={() => setEditing({ ...cam, duration_s: cam.duration_ms / 1000 })}><Pencil size={15} /></button>
                <button className="icon-btn danger" title="Excluir" onClick={() => window.confirm(`Remover ${cam.label}?`) && act(() => api.delete(`/cameras/${cam.id}`), 'Câmera removida.')}><Trash2 size={15} /></button>
              </div>
              {preview === cam.id && (
                <div className="camera-preview">
                  <img src={cam.stream_url} alt={`Ao vivo: ${cam.label}`} onError={(e) => { e.currentTarget.replaceWith(Object.assign(document.createElement('div'), { className: 'muted', textContent: '⚠️ Não foi possível carregar o stream. Verifique a URL e se o DVR está acessível pelo servidor.' })); }} />
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <section className="card help">
        <h2 className="card-title">Como montar a URL RTSP (Intelbras)</h2>
        <ol>
          <li>Descubra o <strong>IP do DVR/NVR</strong> na rede (menu Rede do DVR, roteador ou Intelbras SIM Next).</li>
          <li>Formato: <code>rtsp://usuario:senha@IP:554/cam/realmonitor?channel=N&amp;subtype=1</code></li>
          <li>Troque <code>channel=N</code> pelo número do canal da câmera (1, 2, 3…). <code>subtype=1</code> é o sub-stream, mais leve para a TV.</li>
          <li>Câmeras do mesmo DVR usam o mesmo IP e trocam só o <code>channel</code>; outro DVR, outro IP.</li>
          <li>Senha com caracteres especiais precisa ser codificada (ex.: <code>#</code> vira <code>%23</code>).</li>
        </ol>
        <p className="muted small">O servidor converte RTSP → MJPEG sob demanda (só enquanto alguém assiste). Para dezenas de TVs ou acesso pela internet, o próximo passo é um servidor de mídia com HLS/WebRTC.</p>
      </section>

      <Modal open={!!editing} title="Editar câmera" onClose={() => setEditing(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancelar</button><button className="btn btn-primary" form="cam-form">Salvar</button></>}>
        {editing && (
          <form id="cam-form" onSubmit={saveEdit} className="form-grid">
            <Field label="Nome" className="span-2"><input className="input" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} required /></Field>
            <Field label="URL RTSP" className="span-2"><input className="input mono" value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} required /></Field>
            <Field label="Tempo padrão (s)"><input className="input" type="number" min="5" max="300" value={editing.duration_s} onChange={(e) => setEditing({ ...editing, duration_s: Number(e.target.value) })} /></Field>
          </form>
        )}
      </Modal>
    </div>
  );
}
