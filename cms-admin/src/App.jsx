import { Navigate, Route, RouterProvider, createBrowserRouter, createRoutesFromElements, useRouteError } from 'react-router-dom';
import { AuthProvider, RequireRole, useAuth } from './auth';
import { ToastProvider } from './ui';
import Shell from './layout/Shell';
import NeedClient from './components/NeedClient';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AdminDashboard from './pages/admin/AdminDashboard';
import Clients from './pages/admin/Clients';
import Users from './pages/admin/Users';
import Plans from './pages/admin/Plans';
import ClientDashboard from './pages/ClientDashboard';
import Devices from './pages/Devices';
import DeviceDetail from './pages/DeviceDetail';
import Media from './pages/Media';
import Slides from './pages/Slides';
import Playlists from './pages/Playlists';
import PlaylistEditor from './pages/PlaylistEditor';
import Campaigns from './pages/Campaigns';
import News from './pages/News';
import Cameras from './pages/Cameras';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Account from './pages/Account';
import Invoices from './pages/Invoices';

const scoped = (el) => <NeedClient>{el}</NeedClient>;

// rotas de conteúdo, iguais para administrador e cliente
const contentRoutes = [
  <Route key="m" path="midias" element={scoped(<Media />)} />,
  <Route key="s" path="slides" element={scoped(<Slides />)} />,
  <Route key="p" path="playlists" element={scoped(<Playlists />)} />,
  <Route key="pe" path="playlists/:id" element={scoped(<PlaylistEditor />)} />,
  <Route key="c" path="campanhas" element={scoped(<Campaigns />)} />,
  <Route key="n" path="noticias" element={scoped(<News />)} />,
  <Route key="cam" path="cameras" element={scoped(<Cameras />)} />,
  <Route key="r" path="relatorios" element={scoped(<Reports />)} />,
  <Route key="cfg" path="configuracoes" element={scoped(<Settings />)} />,
  <Route key="acc" path="conta" element={<Account />} />,
  <Route key="fat" path="faturas" element={scoped(<Invoices />)} />,
];

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/cliente'} replace />;
}

// Rede de segurança: um erro de render em qualquer página não deve derrubar
// o painel inteiro para uma tela branca — mostra um aviso com opção de recarregar.
function RouteError() {
  const error = useRouteError();
  console.error('Erro não tratado na rota:', error);
  return (
    <div className="boot">
      <p>Ocorreu um erro inesperado nesta página.</p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>Recarregar</button>
    </div>
  );
}

const router = createBrowserRouter(createRoutesFromElements(
  <Route errorElement={<RouteError />}>
            <Route path="/login" element={<Login />} />
            <Route path="/cadastro" element={<SignUp />} />
            <Route path="/esqueci-senha" element={<ForgotPassword />} />
            <Route path="/redefinir-senha" element={<ResetPassword />} />
            <Route path="/admin" element={<RequireRole role="admin"><Shell /></RequireRole>}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="clientes" element={<Clients />} />
              <Route path="usuarios" element={<Users />} />
              <Route path="planos" element={<Plans />} />
              <Route path="dispositivos" element={<Devices />} />
              <Route path="dispositivos/:id" element={<DeviceDetail />} />
              {contentRoutes}
            </Route>
            <Route path="/cliente" element={<RequireRole role="client"><Shell /></RequireRole>}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<ClientDashboard />} />
              <Route path="tvs" element={<Devices />} />
              <Route path="tvs/:id" element={<DeviceDetail />} />
              {contentRoutes}
            </Route>
            <Route path="*" element={<Home />} />
  </Route>,
));

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  );
}
