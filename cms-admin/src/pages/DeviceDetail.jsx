import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, SkipForward, Pause, Play, Camera, ListVideo, Trash2, Zap } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAuth } from '../auth';
import { useLive } from '../live';
import {
  PageHeader, Field, Loading, DeviceStatus, useToast, fmtDateTime, fmtAgo, fmtTime, fmtUptime, fmtDuration, parseDate,
  ORIENTATION_LABEL, RESOLUTIONS,
} from '../ui';
import DeviceActions from '../components/DeviceActions';

const COMMAND_LABEL = { reload: 'Reiniciar', sync: 'Sincronizar', next: 'Próximo', play: 'Retomar', pause: 'Pausar', clear_cache: 'Limpar cache', reboot: 'Reboot' };

export default function DeviceDetail() {
  const { id } = useParams();
  const { isAdmin, base, can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [clients, setClients] = useState([]);
  const [now, setNow] = useState({ playlist_id: '', minutes: 30 });
  const listPath = isAdmin ? `${base}/dispositivos` : `${base}/tvs`;

  const load = useCallback(() => {
    api.get(`/devices/${id}`).then((r) => {
      setD(r.data);
      setForm((f) => f || {
        name: r.data.name, location: r.data.location || '', orientation: r.data.orientation, resolution: r.data.resolution,
        playlist_id: r.data.playlist_id || '', volume: r.data.volume, brightness: r.data.brightness, client_id: r.data.client_id,
      });
    }).catch((e) => { toast(errorMessage(e), 'error'); navigate(listPath); });
  }, [id, toast, navigate, listPath]);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useLive((msg) => { if (msg.device_id === Number(id)) load(); });

  const deviceClient = d?.client_id;
  useEffect(() => {
    if (!deviceClient) return;
    const headers = { 'X-Client-Id': String(deviceClient) };
    api.get('/playlists', { headers }).then((r) => setPlaylists(r.data)).catch(() => {});
    if (can('cameras')) api.get('/cameras', { headers }).then((r) => setCameras(r.data.cameras)).catch(() => {});
    if (isAdmin) api.get('/admin/clients').then((r) => setClients(r.data)).catch(() => {});
  }, [deviceClient, isAdmin, can]);

  if (!d || !form) return <Loading />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/devices/${d.id}`, form);
      toast('Configuração salva e enviada para a TV.');
      load();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const command = async (command, payload, ok) => {
    try {
      const r = await api.post(`/devices/${d.id}/command`, { command, payload });
      toast(ok || (r.data.delivered ? 'Enviado para a TV.' : 'TV sem conexão em tempo real: recebe no próximo contato.'), r.data.delivered === false ? 'info' : 'success');
      load();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const playNow = async () => {
    if (!now.playlist_id) return toast('Escolha a playlist.', 'error');
    try {
      await api.post(`/playlists/${now.playlist_id}/play-now`, { device_ids: [d.id], minutes: now.minutes }, { headers: { 'X-Client-Id': String(d.client_id) } });
      toast(`Exibindo por ${now.minutes} min; depois volta à programação normal.`);
      load();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };
  const stopNow = async () => {
    try {
      await api.post('/playlists/stop-now', { device_ids: [d.id] }, { headers: { 'X-Client-Id': String(d.client_id) } });
      toast('Voltou à programação normal.');
      load();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const remove = async () => {
    if (!window.confirm(`Remover "${d.name}"? A TV volta para a tela de código de ativação.`)) return;
    try { await api.delete(`/devices/${d.id}`); toast('TV removida.'); navigate(listPath); } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const since = parseDate(d.online_since);
  const overrideActive = d.override_playlist_id && parseDate(d.override_until) > new Date();
  const resolutions = form.orientation === 'portrait' ? RESOLUTIONS.portrait : form.orientation === 'landscape' ? RESOLUTIONS.landscape : [...RESOLUTIONS.landscape, ...RESOLUTIONS.portrait];

  return (
    <div>
      <Link to={listPath} className="back"><ArrowLeft size={16} /> {isAdmin ? 'Dispositivos' : 'Minhas TVs'}</Link>
      <PageHeader title={d.name} subtitle={<><DeviceStatus device={d} /> {d.ws_connected && <span className="badge badge-info">⚡ tempo real</span>} {isAdmin && d.client_name}</>} />
      <div className="card"><DeviceActions device={d} onChange={load} showConfigure={false} /></div>

      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">Situação</h2>
          <dl className="kv kv-wide">
            <dt>Local</dt><dd>{d.location || '—'}</dd>
            <dt>Orientação</dt><dd>{ORIENTATION_LABEL[d.orientation]}{d.reported_orientation ? ` · TV reporta ${ORIENTATION_LABEL[d.reported_orientation]}` : ''}</dd>
            <dt>Resolução</dt><dd>{d.resolution.replace('x', ' × ')}{d.screen_w ? ` · tela física ${d.screen_w} × ${d.screen_h}` : ''}</dd>
            <dt>Playlist</dt><dd>{d.playlist_name || 'Padrão do cliente'}</dd>
            <dt>Exibindo agora</dt><dd>{d.online ? `${d.current_item || '—'}${d.current_playlist ? ` (${d.current_playlist})` : ''}` : '—'}</dd>
            <dt>Volume · Brilho</dt><dd>{d.volume}% · {d.brightness}%</dd>
            <dt>Última sincronização</dt><dd>{d.last_seen_at ? `${fmtTime(d.last_seen_at)} (${fmtAgo(d.last_seen_at)})` : 'nunca'}</dd>
            <dt>Tempo online</dt><dd>{d.online && since ? fmtUptime(Math.round((Date.now() - since) / 1000)) : `offline ${d.offline_since ? fmtAgo(d.offline_since) : ''}`}</dd>
            <dt>Player ligado há</dt><dd>{fmtUptime(d.uptime_s)}</dd>
            <dt>IP · versão</dt><dd>{d.ip || '—'} · {d.app_version || '—'}</dd>
            <dt>Cadastro</dt><dd>{fmtDateTime(d.created_at)}</dd>
          </dl>
        </section>

        <section className="card">
          <h2 className="card-title">Controle ao vivo</h2>
          <div className="btn-row">
            <button className="btn btn-ghost btn-sm" onClick={() => command('next')}><SkipForward size={15} /> Próximo</button>
            <button className="btn btn-ghost btn-sm" onClick={() => command('pause')}><Pause size={15} /> Pausar</button>
            <button className="btn btn-ghost btn-sm" onClick={() => command('play')}><Play size={15} /> Retomar</button>
          </div>

          <h3 className="sub-title"><Zap size={15} /> Exibir playlist agora</h3>
          {overrideActive ? (
            <div className="note">Exibindo playlist especial até {fmtTime(d.override_until)}. <button className="link" onClick={stopNow}>Voltar à programação normal</button></div>
          ) : (
            <div className="inline-form">
              <select className="input" value={now.playlist_id} onChange={(e) => setNow({ ...now, playlist_id: e.target.value })}>
                <option value="">— playlist —</option>
                {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className="input" value={now.minutes} onChange={(e) => setNow({ ...now, minutes: Number(e.target.value) })}>
                {[5, 15, 30, 60, 120, 240].map((m) => <option key={m} value={m}>por {m < 60 ? `${m} min` : `${m / 60}h`}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" onClick={playNow}>Exibir</button>
            </div>
          )}

          {can('cameras') && (
            <>
              <h3 className="sub-title"><Camera size={15} /> Câmera em tela cheia</h3>
              {d.pinned_camera_id ? (
                <div className="note">📷 {d.pinned_camera_label} fixada nesta TV. <button className="link" onClick={() => command('hide_camera', {}, 'Câmera removida da tela.')}>Parar de exibir</button></div>
              ) : cameras.length ? (
                <div className="btn-row">
                  {cameras.filter((c) => c.enabled).map((c) => (
                    <button key={c.id} className="btn btn-ghost btn-sm" onClick={() => command('show_camera', { camera_id: c.id }, `${c.label} na tela.`)}>{c.label}</button>
                  ))}
                </div>
              ) : <p className="muted small">Nenhuma câmera cadastrada.</p>}
            </>
          )}
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2 className="card-title">Configurar</h2>
          <form onSubmit={save} className="form-grid">
            <Field label="Nome"><input className="input" value={form.name} onChange={set('name')} required /></Field>
            <Field label="Local"><input className="input" value={form.location} onChange={set('location')} /></Field>
            <Field label="Orientação" hint="Automática: detecta pela proporção da tela. Manual: gira o conteúdo se a TV estiver montada no outro sentido.">
              <select className="input" value={form.orientation} onChange={(e) => {
                const o = e.target.value;
                const fits = o === 'auto' || RESOLUTIONS[o].includes(form.resolution);
                setForm({ ...form, orientation: o, resolution: fits ? form.resolution : RESOLUTIONS[o][1] });
              }}>
                <option value="auto">Automática</option><option value="landscape">Horizontal 16:9</option><option value="portrait">Vertical 9:16</option>
              </select>
            </Field>
            <Field label="Resolução">
              <select className="input" value={form.resolution} onChange={set('resolution')}>
                {resolutions.map((r) => <option key={r} value={r}>{r.replace('x', ' × ')}</option>)}
              </select>
            </Field>
            <Field label="Playlist" className="span-2">
              <select className="input" value={form.playlist_id} onChange={set('playlist_id')}>
                <option value="">Padrão do cliente</option>
                {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label={`Volume: ${form.volume}%`} hint="0% = mudo. Som automático pode exigir o player em modo quiosque.">
              <input type="range" min="0" max="100" step="5" value={form.volume} onChange={set('volume')} />
            </Field>
            <Field label={`Brilho: ${form.brightness}%`} hint="Escurece o conteúdo na tela (não altera o backlight da TV).">
              <input type="range" min="10" max="100" step="5" value={form.brightness} onChange={set('brightness')} />
            </Field>
            {isAdmin && (
              <Field label="Cliente" hint="Mover a TV para outro cliente respeita o limite do plano dele." className="span-2">
                <select className="input" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value, playlist_id: '' })}>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
            <div className="span-2 btn-row">
              <button className="btn btn-primary">Salvar configuração</button>
              {isAdmin && <button type="button" className="btn btn-danger-ghost" onClick={remove}><Trash2 size={15} /> Remover TV</button>}
            </div>
          </form>
        </section>

        <section className="card">
          <h2 className="card-title"><ListVideo size={16} /> Últimas exibições</h2>
          {d.plays.length === 0 ? <p className="muted">Nenhuma exibição registrada ainda (a TV envia a cada 2 minutos).</p> : (
            <ul className="list list-compact">
              {d.plays.map((p, i) => <li key={i}><span>{p.item_label || '—'}</span><span className="muted small">{fmtTime(p.started_at)} · {fmtDuration(p.duration_ms)}{p.completed ? '' : ' · interrompida'}</span></li>)}
            </ul>
          )}
          <h3 className="sub-title">Comandos enviados</h3>
          {d.commands.length === 0 ? <p className="muted small">Nenhum comando ainda.</p> : (
            <ul className="list list-compact">
              {d.commands.map((c) => (
                <li key={c.id}><span>{COMMAND_LABEL[c.command] || c.command}</span>
                  <span className="muted small">{fmtDateTime(c.issued_at)} · {c.acked_at ? '✔ executado' : c.delivered_at ? 'entregue' : 'aguardando TV'}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
