import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, CreditCard, Tv, Image as ImageIcon, ListVideo, CalendarClock,
  Newspaper, Camera, BarChart3, Settings, UserCircle, LogOut, Menu, Presentation, Receipt,
} from 'lucide-react';
import api from '../api';
import { useAuth } from '../auth';

function navFor(isAdmin, can) {
  const content = [
    { to: 'midias', label: 'Mídias', icon: ImageIcon },
    { to: 'slides', label: 'Slides e QR Code', icon: Presentation },
    { to: 'playlists', label: 'Playlists', icon: ListVideo },
    can('scheduling') && { to: 'campanhas', label: 'Campanhas e agenda', icon: CalendarClock },
    { to: 'noticias', label: 'Notícias (ticker)', icon: Newspaper },
    can('cameras') && { to: 'cameras', label: 'Câmeras', icon: Camera },
    can('reports') && { to: 'relatorios', label: 'Relatórios', icon: BarChart3 },
    { to: 'configuracoes', label: 'Aparência da tela', icon: Settings },
    { to: 'faturas', label: 'Faturas', icon: Receipt },
  ].filter(Boolean);
  if (isAdmin) {
    return [
      { title: 'Gestão', items: [
        { to: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
        { to: 'clientes', label: 'Clientes', icon: Building2 },
        { to: 'dispositivos', label: 'Dispositivos', icon: Tv },
        { to: 'usuarios', label: 'Usuários', icon: Users },
        { to: 'planos', label: 'Planos', icon: CreditCard },
      ] },
      { title: 'Conteúdo do cliente', items: content },
    ];
  }
  return [
    { title: null, items: [
      { to: 'dashboard', label: 'Início', icon: LayoutDashboard },
      { to: 'tvs', label: 'Minhas TVs', icon: Tv },
    ] },
    { title: 'Conteúdo', items: content },
  ];
}

function ClientPicker() {
  const { clientId, selectClient } = useAuth();
  const [clients, setClients] = useState([]);
  const location = useLocation();

  // recarrega ao navegar (ex.: depois de criar um cliente novo)
  useEffect(() => {
    api.get('/admin/clients').then((r) => {
      setClients(r.data);
      if (!clientId && r.data.length === 1) selectClient(r.data[0].id);
      if (clientId && !r.data.some((c) => String(c.id) === String(clientId))) selectClient(null);
    }).catch(() => {});
  }, [location.pathname, clientId, selectClient]);

  return (
    <label className="client-picker">
      <span>Cliente</span>
      <select value={clientId || ''} onChange={(e) => selectClient(e.target.value || null)}>
        <option value="">— selecione —</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status !== 'active' ? ' (inativo)' : ''}</option>)}
      </select>
    </label>
  );
}

export default function Shell() {
  const { user, isAdmin, can, logout, clientId } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const groups = navFor(isAdmin, can);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">▣</span>
          <div>
            <strong>Mídia Indoor</strong>
            <small>{isAdmin ? 'Administração' : user?.client?.name}</small>
          </div>
        </div>
        <nav>
          {groups.map((g, i) => (
            <div key={i} className="nav-group">
              {g.title && <div className="nav-title">{g.title}</div>}
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className="nav-link"><Icon size={18} /> {label}</NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink to="conta" className="nav-link"><UserCircle size={18} /> Minha conta</NavLink>
          <button type="button" className="nav-link" onClick={() => { logout(); navigate('/login'); }}><LogOut size={18} /> Sair</button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setOpen(!open)} aria-label="Abrir menu"><Menu size={20} /></button>
          {isAdmin ? <ClientPicker /> : (
            <div className="plan-chip">Plano <strong>{user?.client?.plan || '—'}</strong></div>
          )}
          <div className="topbar-user">{user?.name}</div>
        </header>
        <main className="content">
          {/* trocar de cliente remonta a página e recarrega os dados */}
          <Outlet key={clientId || 'none'} />
        </main>
      </div>
    </div>
  );
}
