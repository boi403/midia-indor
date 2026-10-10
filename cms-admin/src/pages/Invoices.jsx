import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Receipt } from 'lucide-react';
import api, { errorMessage } from '../api';
import { PageHeader, Loading, Empty, useToast, parseDate, fmtDate, fmtMoney } from '../ui';

const STATUS_BADGE = {
  pending: { label: 'Pendente', cls: 'badge-warn' },
  paid: { label: 'Paga', cls: 'badge-ok' },
  expired: { label: 'Expirada', cls: 'badge-muted' },
};

function StatusBadge({ status }) {
  const s = STATUS_BADGE[status] || { label: status, cls: 'badge-muted' };
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export default function Invoices() {
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState('');
  const [payingId, setPayingId] = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    api.get('/invoices').then((r) => { setInvoices(r.data); setError(''); })
      .catch((e) => { const msg = errorMessage(e); setError(msg); toast(msg, 'error'); });
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const pay = async (id) => {
    setPayingId(id);
    try {
      const r = await api.post(`/invoices/${id}/pay`);
      window.location.href = r.data.checkout_url;
    } catch (err) {
      toast(errorMessage(err), 'error');
      setPayingId(null);
    }
  };

  if (error && !invoices) {
    return (
      <Empty icon={AlertTriangle} title="Não foi possível carregar as faturas">
        <p>{error}</p>
        <div className="btn-row"><button className="btn btn-primary" onClick={load}>Tentar novamente</button></div>
      </Empty>
    );
  }
  if (!invoices) return <Loading />;

  const hasOverdue = invoices.some((inv) => {
    const due = parseDate(inv.due_date);
    return inv.status === 'pending' && due && due < new Date();
  });

  return (
    <div>
      <PageHeader title="Faturas" subtitle="Histórico de cobranças da assinatura mensal." />

      {hasOverdue && (
        <div className="alert alert-warning">Você tem uma fatura vencida. Regularize o pagamento para evitar a suspensão do serviço.</div>
      )}

      {invoices.length === 0 ? (
        <Empty icon={Receipt} title="Nenhuma fatura ainda." />
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Vencimento</th><th>Valor</th><th>Status</th><th /></tr></thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{fmtDate(inv.due_date)}</td>
                  <td>{fmtMoney(inv.amount_cents)}</td>
                  <td><StatusBadge status={inv.status} /></td>
                  <td>
                    {inv.status === 'pending' && (
                      <button type="button" className="btn btn-primary btn-sm" disabled={payingId === inv.id} onClick={() => pay(inv.id)}>
                        {payingId === inv.id ? 'Abrindo…' : 'Pagar agora'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
