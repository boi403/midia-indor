import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router-dom';
import { ArrowLeft, GripVertical, Plus, Trash2, ChevronDown, ChevronUp, ArrowUp, ArrowDown, Film, Image as ImageIcon, Presentation, Camera, Newspaper, Save, AlertTriangle } from 'lucide-react';
import api, { errorMessage } from '../api';
import { useAuth } from '../auth';
import { Loading, Empty, Toggle, useToast, fmtDuration, ORIENTATION_LABEL } from '../ui';

let keySeq = 0;
const withKey = (it) => ({ ...it, _key: ++keySeq });

function slideLabel(s) {
  if (s.type === 'widget') {
    try { return `QR: ${JSON.parse(s.config_json || '{}').title || 'QR Code'}`; } catch { return 'QR Code'; }
  }
  return (s.title || s.kick || s.variant || 'Slide').replace(/<[^>]+>/g, ' ');
}

export default function PlaylistEditor() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const [pl, setPl] = useState(null);
  const [items, setItems] = useState([]);
  const [lib, setLib] = useState(null);
  const [libError, setLibError] = useState('');
  const [tab, setTab] = useState('media');
  const [open, setOpen] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const dragFrom = useRef(null);

  const load = useCallback(() => {
    api.get(`/playlists/${id}`).then((r) => { setPl(r.data); setItems(r.data.items.map(withKey)); setDirty(false); })
      .catch((e) => toast(errorMessage(e), 'error'));
    api.get('/playlists/library').then((r) => { setLib(r.data); setLibError(''); }).catch((e) => setLibError(errorMessage(e)));
  }, [id, toast]);
  useEffect(load, [load]);

  // aviso ao sair com alterações não salvas
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Há alterações não salvas nesta playlist. Sair mesmo assim?')) blocker.proceed(); else blocker.reset();
    }
  }, [blocker]);

  const index = useMemo(() => {
    if (!lib) return null;
    return {
      media: new Map(lib.media.map((m) => [String(m.id), m])),
      slide: new Map(lib.slides.map((s) => [String(s.id), s])),
      camera: new Map(lib.cameras.map((c) => [String(c.id), c])),
    };
  }, [lib]);

  const describe = (it) => {
    if (it.kind === 'news') return { label: 'Notícias (tela cheia)', icon: Newspaper, sub: 'Lista das notícias do ticker' };
    const ref = index?.[it.kind]?.get(String(it.ref_id));
    if (!ref) return { label: 'Conteúdo removido', icon: Trash2, missing: true };
    if (it.kind === 'media') return { label: ref.title || ref.original_name || `Mídia ${ref.id}`, icon: ref.type === 'video' ? Film : ImageIcon, thumb: ref, sub: `${ref.type === 'video' ? 'Vídeo' : 'Imagem'} · ${ORIENTATION_LABEL[ref.orientation]}` };
    if (it.kind === 'slide') return { label: slideLabel(ref), icon: Presentation, sub: ref.type === 'widget' ? 'QR Code' : `Slide ${ref.variant}` };
    return { label: ref.label, icon: Camera, sub: ref.enabled ? 'Câmera ao vivo' : 'Câmera desativada (não aparece)' };
  };

  const update = (next) => { setItems(next); setDirty(true); };
  const change = (key, patch) => update(items.map((it) => (it._key === key ? { ...it, ...patch } : it)));
  const insert = (entry, at = items.length) => {
    const next = [...items];
    next.splice(at, 0, withKey({ enabled: 1, repeat: 1, ...entry }));
    update(next);
  };
  const move = (from, to) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    update(next);
  };

  const libEntry = (kind, ref) => {
    if (kind === 'news') return { kind: 'news', ref_id: null, duration_ms: 15000 };
    return { kind, ref_id: String(ref.id), duration_ms: ref.duration_ms || 10000 };
  };

  const save = async () => {
    setSaving(true);
    try {
      if (pl.name.trim()) await api.put(`/playlists/${id}`, { name: pl.name });
      await api.put(`/playlists/${id}/items`, {
        items: items.map((it) => ({
          kind: it.kind, ref_id: it.ref_id, portrait_ref_id: it.portrait_ref_id, duration_ms: it.duration_ms, enabled: !!it.enabled,
          repeat: it.repeat, start_date: it.start_date, end_date: it.end_date, start_time: it.start_time, end_time: it.end_time,
        })),
      });
      toast('Playlist salva. As TVs recebem a nova ordem em segundos.');
      setDirty(false);
    } catch (err) { toast(errorMessage(err), 'error'); } finally { setSaving(false); }
  };

  if (!pl) return <Loading />;
  if (!lib) {
    if (libError) {
      return (
        <Empty icon={AlertTriangle} title="Não foi possível carregar a biblioteca de mídias">
          <p>{libError}</p>
          <div className="btn-row"><button className="btn btn-primary" onClick={load}>Tentar novamente</button></div>
        </Empty>
      );
    }
    return <Loading />;
  }
  const total = items.filter((i) => i.enabled).reduce((s, i) => s + i.duration_ms * (i.repeat || 1), 0);

  const onDropList = (e, at) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-lib');
    if (raw) { insert(JSON.parse(raw), at); return; }
    if (dragFrom.current != null) move(dragFrom.current, Math.min(at, items.length - 1));
    dragFrom.current = null;
  };

  const libTabs = [
    ['media', 'Mídias', lib.media.length],
    ['slide', 'Slides', lib.slides.length],
    can('cameras') && ['camera', 'Câmeras', lib.cameras.length],
    ['news', 'Notícias', 1],
  ].filter(Boolean);
  const libList = tab === 'media' ? lib.media : tab === 'slide' ? lib.slides : tab === 'camera' ? lib.cameras : [{ id: 'news' }];

  return (
    <div>
      <Link to=".." relative="path" className="back"><ArrowLeft size={16} /> Playlists</Link>
      <div className="page-header">
        <div className="grow">
          <input className="title-input" value={pl.name} onChange={(e) => { setPl({ ...pl, name: e.target.value }); setDirty(true); }} aria-label="Nome da playlist" />
          <p className="muted">{items.length} item(ns) · ciclo de {fmtDuration(total)} {pl.is_default ? '· playlist padrão' : ''}</p>
        </div>
        <div className="page-actions">
          {dirty && <span className="badge badge-warn">Alterações não salvas</span>}
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}><Save size={16} /> {saving ? 'Salvando…' : 'Salvar playlist'}</button>
        </div>
      </div>

      <div className="editor">
        <aside className="card library">
          <div className="tabs">
            {libTabs.map(([k, l, n]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} <span className="muted">{n}</span></button>)}
          </div>
          <p className="muted small">Arraste para a lista ou clique em +.</p>
          <ul className="lib-list">
            {libList.length === 0 && <li className="muted small">Nada cadastrado ainda.</li>}
            {libList.map((ref) => {
              const entry = libEntry(tab, ref);
              const d = describe(entry);
              return (
                <li key={ref.id} draggable onDragStart={(e) => { dragFrom.current = null; e.dataTransfer.setData('application/x-lib', JSON.stringify(entry)); }}>
                  <Thumb d={d} />
                  <div className="grow truncate"><div className="truncate">{d.label}</div><div className="muted small">{d.sub}</div></div>
                  <button className="icon-btn" title="Adicionar ao fim" onClick={() => insert(entry)}><Plus size={16} /></button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="card sequence" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDropList(e, items.length)}>
          {items.length === 0 && <div className="drop-hint">Arraste conteúdos da biblioteca para cá.</div>}
          <ol className="seq-list">
            {items.map((it, i) => {
              const d = describe(it);
              const expanded = open === it._key;
              const hasRules = it.start_date || it.end_date || it.start_time || it.end_time || it.repeat > 1 || it.portrait_ref_id;
              return (
                <li key={it._key} className={`seq-item ${it.enabled ? '' : 'is-off'} ${d.missing ? 'is-missing' : ''}`}
                  draggable onDragStart={() => { dragFrom.current = i; }}
                  onDragOver={(e) => { e.preventDefault(); if (dragFrom.current != null && dragFrom.current !== i) { move(dragFrom.current, i); dragFrom.current = i; } }}
                  onDrop={(e) => { e.stopPropagation(); onDropList(e, i); }}>
                  <div className="seq-row">
                    <span className="grip" aria-hidden="true"><GripVertical size={16} /></span>
                    <span className="seq-n">{i + 1}</span>
                    <Thumb d={d} />
                    <div className="grow truncate">
                      <div className="truncate"><strong>{d.label}</strong></div>
                      <div className="muted small">{d.sub}{hasRules ? ' · regras ⚙' : ''}</div>
                    </div>
                    <label className="mini-field" title="Duração">
                      <input type="number" min="1" max="3600" value={Math.round(it.duration_ms / 1000)} onChange={(e) => change(it._key, { duration_ms: Math.max(1, Number(e.target.value)) * 1000 })} />s
                    </label>
                    <Toggle checked={!!it.enabled} onChange={(v) => change(it._key, { enabled: v ? 1 : 0 })} />
                    <span className="seq-move">
                      <button className="icon-btn" title="Subir" onClick={() => move(i, i - 1)} disabled={i === 0}><ArrowUp size={14} /></button>
                      <button className="icon-btn" title="Descer" onClick={() => move(i, i + 1)} disabled={i === items.length - 1}><ArrowDown size={14} /></button>
                    </span>
                    <button className="icon-btn" title="Regras" onClick={() => setOpen(expanded ? null : it._key)}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
                    <button className="icon-btn danger" title="Remover da playlist" onClick={() => update(items.filter((x) => x._key !== it._key))}><Trash2 size={15} /></button>
                  </div>
                  {expanded && (
                    <div className="seq-rules">
                      <label>Repetir por ciclo
                        <select className="input input-sm" value={it.repeat || 1} onChange={(e) => change(it._key, { repeat: Number(e.target.value) })}>
                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}×</option>)}
                        </select>
                      </label>
                      <label>De (data)<input className="input input-sm" type="date" value={it.start_date || ''} onChange={(e) => change(it._key, { start_date: e.target.value || null })} /></label>
                      <label>Até (data)<input className="input input-sm" type="date" value={it.end_date || ''} onChange={(e) => change(it._key, { end_date: e.target.value || null })} /></label>
                      <label>Das (hora)<input className="input input-sm" type="time" value={it.start_time || ''} onChange={(e) => change(it._key, { start_time: e.target.value || null })} /></label>
                      <label>Até (hora)<input className="input input-sm" type="time" value={it.end_time || ''} onChange={(e) => change(it._key, { end_time: e.target.value || null })} /></label>
                      {it.kind === 'media' && (
                        <label className="span-all">Versão para TV vertical (opcional)
                          <select className="input input-sm" value={it.portrait_ref_id || ''} onChange={(e) => change(it._key, { portrait_ref_id: e.target.value || null })}>
                            <option value="">Usar a mesma mídia</option>
                            {lib.media.filter((m) => String(m.id) !== String(it.ref_id)).map((m) => <option key={m.id} value={m.id}>{m.title || m.original_name} ({ORIENTATION_LABEL[m.orientation]})</option>)}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </div>
  );
}

function Thumb({ d }) {
  const Icon = d.icon;
  if (d.thumb) {
    return d.thumb.type === 'video'
      ? <video className="mini-thumb" src={d.thumb.full_url} muted preload="none" />
      : <img className="mini-thumb" src={d.thumb.full_url} alt="" loading="lazy" />;
  }
  return <span className="mini-thumb mini-icon"><Icon size={16} /></span>;
}
