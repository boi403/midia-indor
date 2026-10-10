import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Tv, KeyRound, AlertTriangle } from 'lucide-react';
import api, { errorMessage, API_ROOT } from '../api';
import { useAuth } from '../auth';
import { useLive } from '../live';
import { PageHeader, Modal, Field, Loading, Empty, DeviceStatus, useToast, fmtTime, fmtAgo, fmtUptime, parseDate, ORIENTATION_LABEL, RESOLUTIONS } from '../ui';
import DeviceActions from '../components/DeviceActions';

function onlineFor(d) {
  const since = parseDate(d.online_since);
  return d.online && since ? fmtUptime(Math.round((Date.now() - since) / 1000)) : '—';
}

export function DeviceCard({ device: d, onChange, showClient }) {
  const { isAdmin, base } = useAuth();
  const path = isAdmin ? `${base}/dispositivos/${d.id}` : `${base}/tvs/${d.id}`;
  return (
    <article className={`card device ${d.status === 'blocked' ? 'is-blocked' : ''}`}>
      <div className="device-head">
        <div className={`screen-icon ${d.orientation === 'portrait' || (d.orientation === 'auto' && d.reported_orientation === 'portrait') ? 'portrait' : ''}`} aria-hidden="true" />
        <div className="device-title">
          <Link to={path}><strong>{d.name}</strong></Link>
          <span className="muted small">{showClient && d.client_name ? `${d.client_name} · ` : ''}{d.location || 'Sem local'}</span>
        </div>
        <DeviceStatus device={d} />
      </div>
      <dl className="kv">
        <dt>Orientação</dt><dd>{ORIENTATION_LABEL[d.orientation]}{d.orientation === 'auto' && d.reported_orientation ? ` (${ORIENTATION_LABEL[d.reported_orientation]})` : ''}</dd>
        <dt>Resolução</dt><dd>{d.resolution.replace('x', ' × ')}</dd>
        <dt>Playlist</dt><dd>{d.playlist_name || 'Padrão do cliente'}</dd>
        <dt>Exibindo</dt><dd className="truncate">{d.online ? (d.current_item || '—') : '—'}</dd>
        <dt>Última sincronização</dt><dd>{d.last_seen_at ? `${fmtTime(d.last_seen_at)} (${fmtAgo(d.last_seen_at)})` : 'nunca'}</dd>
        <dt>Tempo online</dt><dd>{onlineFor(d)}</dd>
      </dl>
      {d.pinned_camera_label && <div className="note">📷 Câmera fixada: {d.pinned_camera_label}</div>}
      <DeviceActions device={d} onChange={onChange} />
    </article>
  );
}

export default function Devices() {
  const { isAdmin, clientId } = useAuth();
  const [devices, setDevices] = useState(null);
  const [pending, setPending] = useState([]);
  const [scope, setScope] = useState(isAdmin && clientId ? 'client' : 'all');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const seqRef = useRef(0);
  const lastErrorRef = useRef('');
  const liveTimer = useRef(null);

  const load = useCallback(() => {
    const seq = ++seqRef.current;
    const headers = isAdmin && scope === 'all' ? { 'X-Client-Id': '' } : undefined;
    api.get('/devices', { headers }).then((r) => {
      if (seq !== seqRef.current) return;
      setDevices(r.data);
      setError('');
      lastErrorRef.current = '';
    }).catch((e) => {
      if (seq !== seqRef.current) return;
      const msg = errorMessage(e);
      setError(msg);
      if (msg !== lastErrorRef.current) { toast(msg, 'error'); lastErrorRef.current = msg; }
    });
    if (isAdmin) api.get('/devices/pending').then((r) => { if (seq === seqRef.current) setPending(r.data); }).catch(() => {});
  }, [isAdmin, scope, toast]);

  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);
  useEffect(() => () => clearTimeout(liveTimer.current), []);
  useLive((msg) => {
    if (msg.type?.startsWith('device.') || msg.device_id) {
      clearTimeout(liveTimer.current);
      liveTimer.current = setTimeout(load, 1500);
    }
  });

  if (error && !devices) {
    return (
      <Empty icon={AlertTriangle} title="Não foi possível carregar os dispositivos">
        <p>{error}</p>
        <div className="btn-row"><button className="btn btn-primary" onClick={load}>Tentar novamente</button></div>
      </Empty>
    );
  }
  if (!devices) return <Loading />;
  const online = devices.filter((d) => d.online && d.status === 'active').length;

  return (
    <div>
      <PageHeader
        title={isAdmin ? 'Dispositivos' : 'Minhas TVs'}
        subtitle={`${devices.length} TV(s) · ${online} online · ${devices.length - online} offline/bloqueada(s)`}
        actions={isAdmin && (
          <>
            <div className="segmented segmented-sm">
              <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Todos os clientes</button>
              <button className={scope === 'client' ? 'on' : ''} onClick={() => setScope('client')} disabled={!clientId}>Cliente selecionado</button>
            </div>
            <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> Adicionar dispositivo</button>
          </>
        )}
      />

      {isAdmin && pending.length > 0 && (
        <div className="card pending">
          <KeyRound size={18} />
          <div>
            <strong>{pending.length} TV(s) exibindo código de ativação:</strong>{' '}
            {pending.map((p) => <code key={p.id} className="code">{p.pairing_code}</code>)}
            <div className="muted small">Clique em “Adicionar dispositivo” e informe o código mostrado na tela.</div>
          </div>
        </div>
      )}

      {devices.length === 0 ? (
        <Empty icon={Tv} title="Nenhuma TV cadastrada">
          {isAdmin
            ? <>Abra <code>{API_ROOT}/tv</code> no navegador da TV/TV Box. Ela vai mostrar um código de ativação — informe-o em “Adicionar dispositivo”.</>
            : 'Fale com o administrador para ativar suas telas.'}
        </Empty>
      ) : (
        <div className="device-grid">
          {devices.map((d) => <DeviceCard key={d.id} device={d} onChange={load} showClient={isAdmin && scope === 'all'} />)}
        </div>
      )}

      {adding && <ClaimModal pending={pending} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
    </div>
  );
}

function ClaimModal({ onClose, onDone, pending }) {
  const { clientId } = useAuth();
  const toast = useToast();
  const [clients, setClients] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [form, setForm] = useState({
    code: pending.length === 1 ? pending[0].pairing_code : '', client_id: clientId || '', name: '', location: '',
    orientation: 'auto', resolution: '1920x1080', playlist_id: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get('/admin/clients').then((r) => setClients(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    if (!form.client_id) { setPlaylists([]); return; }
    api.get('/playlists', { headers: { 'X-Client-Id': String(form.client_id) } }).then((r) => setPlaylists(r.data)).catch(() => setPlaylists([]));
  }, [form.client_id]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const client = clients.find((c) => String(c.id) === String(form.client_id));
  const resolutions = form.orientation === 'portrait' ? RESOLUTIONS.portrait : form.orientation === 'landscape' ? RESOLUTIONS.landscape : [...RESOLUTIONS.landscape, ...RESOLUTIONS.portrait];

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/devices/claim', form);
      toast(`${form.name || 'TV'} vinculada! Ela entra no ar em alguns segundos.`);
      onDone();
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal open title="Adicionar dispositivo" onClose={onClose} wide
      footer={<><button className="btn btn-ghost" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="claim-form" disabled={busy}>{busy ? 'Vinculando…' : 'Vincular TV'}</button></>}>
      <form id="claim-form" onSubmit={submit} className="form-grid">
        <Field label="Código de ativação" hint="O código aparece na tela da TV ao abrir o player." className="span-2">
          <input className="input input-code" value={form.code} onChange={set('code')} placeholder="TV-7F42-K9P1" required autoFocus />
        </Field>
        <Field label="Cliente">
          <select className="input" value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value, playlist_id: '' })} required>
            <option value="">— selecione —</option>
            {clients.filter((c) => c.status === 'active').map((c) => <option key={c.id} value={c.id}>{c.name} ({c.tvs}/{c.tv_limit ?? '∞'} TVs)</option>)}
          </select>
        </Field>
        <Field label="Playlist">
          <select className="input" value={form.playlist_id} onChange={set('playlist_id')}>
            <option value="">Padrão do cliente</option>
            {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Nome"><input className="input" value={form.name} onChange={set('name')} placeholder="TV Recepção 01" required /></Field>
        <Field label="Local"><input className="input" value={form.location} onChange={set('location')} placeholder="Recepção" /></Field>
        <Field label="Orientação" hint="Automática detecta pela proporção da tela.">
          <select className="input" value={form.orientation} onChange={(e) => {
            const o = e.target.value;
            setForm({ ...form, orientation: o, resolution: o === 'portrait' ? '1080x1920' : '1920x1080' });
          }}>
            <option value="auto">Automática</option><option value="landscape">Horizontal 16:9</option><option value="portrait">Vertical 9:16</option>
          </select>
        </Field>
        <Field label="Resolução">
          <select className="input" value={form.resolution} onChange={set('resolution')}>
            {resolutions.map((r) => <option key={r} value={r}>{r.replace('x', ' × ')}</option>)}
          </select>
        </Field>
        {client && client.tv_limit != null && client.tvs >= client.tv_limit && (
          <div className="form-error span-2">{client.name} já usa {client.tvs}/{client.tv_limit} TVs. Aumente o limite em Clientes antes de vincular outra.</div>
        )}
      </form>
    </Modal>
  );
}
