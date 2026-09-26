/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

// ---------- formatação ----------
// datas do SQLite vêm como "YYYY-MM-DD HH:MM:SS" (UTC); as do Node, ISO.
export function parseDate(v) {
  if (!v) return null;
  const d = new Date(/T/.test(v) ? v : `${v.replace(' ', 'T')}Z`);
  return isNaN(d) ? null : d;
}
export const fmtDateTime = (v) => { const d = parseDate(v); return d ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'; };
export const fmtDate = (v) => { const d = parseDate(v); return d ? d.toLocaleDateString('pt-BR') : '—'; };
export const fmtTime = (v) => { const d = parseDate(v); return d ? d.toLocaleTimeString('pt-BR') : '—'; };

export function fmtAgo(v) {
  const d = parseDate(v);
  if (!d) return 'nunca';
  const s = Math.max(0, Math.round((Date.now() - d) / 1000));
  if (s < 60) return 'agora há pouco';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min`;
  return `há ${Math.floor(s / 86400)} dia(s)`;
}
export function fmtUptime(seconds) {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}min`;
}
export function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min ${s % 60 ? `${s % 60}s` : ''}`.trim();
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min`;
}
export const fmtMoney = (cents) => ((cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const ORIENTATION_LABEL = { auto: 'Automática', landscape: 'Horizontal 16:9', portrait: 'Vertical 9:16', any: 'Qualquer' };
export const RESOLUTIONS = {
  landscape: ['1280x720', '1920x1080', '2560x1440', '3840x2160'],
  portrait: ['720x1280', '1080x1920', '1440x2560', '2160x3840'],
};
export const DAY_NAMES =['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

// ---------- toasts ----------
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, tone = 'success') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === 'error' ? <AlertTriangle size={16} /> : t.tone === 'info' ? <Info size={16} /> : <CheckCircle2 size={16} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---------- estrutura ----------
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Stat({ icon: Icon, label, value, hint, tone = 'default' }) {
  return (
    <div className={`stat stat-${tone}`}>
      <div className="stat-top">{Icon && <Icon size={16} />}<span>{label}</span></div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="empty">
      {Icon && <Icon size={32} />}
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Loading({ text = 'Carregando…' }) {
  return <div className="loading">{text}</div>;
}

// Status da TV com ícone + texto (nunca só a cor).
export function DeviceStatus({ device }) {
  if (device.status === 'blocked') return <span className="badge badge-muted">⛔ Bloqueada</span>;
  if (device.online) return <span className="badge badge-ok"><i className="dot dot-ok" /> Online</span>;
  return <span className="badge badge-danger"><i className="dot dot-danger" /> Offline</span>;
}

export function Modal({ open, title, onClose, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Alerts({ alerts }) {
  if (!alerts?.length) return <p className="muted">Nenhum alerta no momento. ✅</p>;
  const icon = { danger: '🔴', warning: '🟡', info: '🔵' };
  return (
    <ul className="alerts">
      {alerts.map((a, i) => (
        <li key={i} className={`alert alert-${a.level}`}><span aria-hidden="true">{icon[a.level]}</span> {a.text}</li>
      ))}
    </ul>
  );
}

export function UsageBar({ used, limit, label }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = !limit ? 'ok' : pct >= 100 ? 'danger' : pct >= 90 ? 'warn' : 'ok';
  return (
    <div className="usage">
      <div className="usage-text"><span>{label}</span><strong>{used} / {limit ?? '∞'}</strong></div>
      {limit ? <div className="usage-bar"><div className={`usage-fill usage-${tone}`} style={{ width: `${pct}%` }} /></div> : null}
    </div>
  );
}
