import { Building2 } from 'lucide-react';
import { useAuth } from '../auth';
import { Empty } from '../ui';

// Páginas de conteúdo precisam de um cliente definido; o administrador escolhe no topo.
export default function NeedClient({ children }) {
  const { clientId } = useAuth();
  if (!clientId) {
    return (
      <Empty icon={Building2} title="Selecione um cliente">
        Escolha no seletor <strong>Cliente</strong>, no topo da página, de qual cliente você quer gerenciar o conteúdo.
      </Empty>
    );
  }
  return children;
}
