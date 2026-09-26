import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Copy, Star, Trash2, Zap, ListVideo } from 'lucide-react';
import api, { errorMessage } from '../api';
import { PageHeader, Modal, Field, Loading, Empty, useToast, fmtDuration, DeviceStatus } from '../ui';

export default function Playlists() {
  const [playlists, setPlaylists] = useState(null);
  const [devices, setDevices] = useState([]);
  const [creating, setCreating] = useState(null);
  const [playNow, setPlayNow] = useState(null);
  const toast = useToast();
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.get('/playlists').then((r) => setPlaylists(r.data)).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);
  useEffect(() => {
    load();
    api.get('/devices').then((r) => setDevices(r.data.filter((d) => d.status === 'active'))).catch(() => {});
  }, [load]);

  const act = async (fn, msg) => { try { await fn(); toast(msg); load(); } catch (err) { toast(errorMessage(err), 'error'); } };

  const create = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/playlists', creating);
      navigate(String(r.data.id));
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const remove = (p) => {
    const extra = [p.devices && `${p.devices} TV(s) voltam para a playlist padrão`, p.campaigns && `${p.campaigns} campanha(s) serão excluídas`].filter(Boolean).join('; ');
    if (window.confirm(`Excluir a playlist "${p.name}"?${extra ? `\n\n${extra}.` : ''}`)) act(() => api.delete(`/playlists/${p.id}`), 'Playlist excluída.');
  };

  const sendNow = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post(`/playlists/${playNow.id}/play-now`, { device_ids: playNow.all ? [] : playNow.device_ids, minutes: playNow.minutes });
      toast(`"${playNow.name}" no ar em ${r.data.devices} TV(s) por ${playNow.minutes} min.`);
      setPlayNow(null);
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  if (!playlists) return <Loading />;

  return (
    <div>
      <PageHeader title="Playlists" subtitle="Sequências de conteúdo. Cada TV toca a sua playlist; campanhas agendadas e “Exibir agora” entram por cima e depois devolvem a tela."
        actions={<button className="btn btn-primary" onClick={() => setCreating({ name: '', copy_from: '' })}><Plus size={16} /> Nova playlist</button>} />

      {playlists.length === 0 ? <Empty icon={ListVideo} title="Nenhuma playlist" /> : (
        <div className="playlist-grid">
          {playlists.map((p) => (
            <article key={p.id} className="card playlist-card">
              <div className="card-head">
                <Link to={String(p.id)}><h2 className="card-title">{p.name}</h2></Link>
                {p.is_default ? <span className="badge badge-info"><Star size={12} /> Padrão</span> : null}
              </div>
              <p className="muted small">{p.items} item(ns) · ciclo de {fmtDuration(p.total_ms)} · {p.devices} TV(s){p.campaigns ? ` · ${p.campaigns} campanha(s)` : ''}</p>
              <div className="btn-row">
                <Link to={String(p.id)} className="btn btn-primary btn-sm">Editar</Link>
                <button className="btn btn-ghost btn-sm" onClick={() => setPlayNow({ ...p, all: true, device_ids: [], minutes: 30 })}><Zap size={15} /> Exibir agora</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setCreating({ name: `${p.name} (cópia)`, copy_from: p.id })}><Copy size={15} /> Duplicar</button>
                {!p.is_default && <button className="btn btn-ghost btn-sm" onClick={() => act(() => api.put(`/playlists/${p.id}`, { is_default: true }), `"${p.name}" agora é a padrão.`)}><Star size={15} /> Tornar padrão</button>}
                <button className="icon-btn danger" title="Excluir" onClick={() => remove(p)}><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={!!creating} title={creating?.copy_from ? 'Duplicar playlist' : 'Nova playlist'} onClose={() => setCreating(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setCreating(null)}>Cancelar</button><button className="btn btn-primary" form="pl-form">Criar e editar</button></>}>
        {creating && (
          <form id="pl-form" onSubmit={create}>
            <Field label="Nome"><input className="input" value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder="Recepção Principal" required autoFocus /></Field>
          </form>
        )}
      </Modal>

      <Modal open={!!playNow} title={`Exibir agora: ${playNow?.name || ''}`} onClose={() => setPlayNow(null)}
        footer={<><button className="btn btn-ghost" onClick={() => setPlayNow(null)}>Cancelar</button><button className="btn btn-primary" form="now-form">Exibir agora</button></>}>
        {playNow && (
          <form id="now-form" onSubmit={sendNow} className="stack">
            <p className="muted">As TVs trocam na hora (via tempo real) e voltam sozinhas à programação normal ao fim do tempo.</p>
            <Field label="Por quanto tempo">
              <select className="input" value={playNow.minutes} onChange={(e) => setPlayNow({ ...playNow, minutes: Number(e.target.value) })}>
                {[5, 15, 30, 60, 120, 240, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutos` : `${m / 60} hora(s)`}</option>)}
              </select>
            </Field>
            <label className="check"><input type="checkbox" checked={playNow.all} onChange={(e) => setPlayNow({ ...playNow, all: e.target.checked })} /> Todas as TVs</label>
            {!playNow.all && (
              <div className="check-list">
                {devices.map((d) => (
                  <label key={d.id} className="check">
                    <input type="checkbox" checked={playNow.device_ids.includes(d.id)}
                      onChange={(e) => setPlayNow({ ...playNow, device_ids: e.target.checked ? [...playNow.device_ids, d.id] : playNow.device_ids.filter((x) => x !== d.id) })} />
                    {d.name} <DeviceStatus device={d} />
                  </label>
                ))}
              </div>
            )}
          </form>
        )}
      </Modal>
    </div>
  );
}
