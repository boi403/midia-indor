import { useCallback, useEffect, useState } from 'react';
import { Trash2, Newspaper } from 'lucide-react';
import api, { errorMessage } from '../api';
import { PageHeader, Loading, Empty, Toggle, useToast } from '../ui';

export default function News() {
  const [items, setItems] = useState(null);
  const [text, setText] = useState('');
  const toast = useToast();

  const load = useCallback(() => {
    api.get('/noticias').then((r) => setItems(r.data)).catch((e) => toast(errorMessage(e), 'error'));
  }, [toast]);
  useEffect(load, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    try { await api.post('/noticias', { texto: text }); setText(''); load(); } catch (err) { toast(errorMessage(err), 'error'); }
  };
  const patch = async (n, changes) => {
    try { await api.patch(`/noticias/${n.id}`, changes); load(); } catch (err) { toast(errorMessage(err), 'error'); }
  };
  const remove = async (n) => {
    if (!window.confirm('Excluir esta notícia?')) return;
    try { await api.delete(`/noticias/${n.id}`); load(); } catch (err) { toast(errorMessage(err), 'error'); }
  };

  if (!items) return <Loading />;

  return (
    <div>
      <PageHeader title="Notícias (ticker)" subtitle="Avisos que passam na barra inferior de todas as TVs do cliente. Também podem entrar em playlists como tela cheia (item “Notícias”)." />
      <section className="card">
        <form onSubmit={add} className="inline-form">
          <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: Café da manhã das 6h às 10h no salão térreo" maxLength={200} />
          <button className="btn btn-primary">Adicionar</button>
        </form>
      </section>
      {items.length === 0 ? <Empty icon={Newspaper} title="Nenhuma notícia cadastrada" /> : (
        <section className="card">
          <ul className="list">
            {items.map((n) => (
              <li key={n.id} className={n.enabled ? '' : 'is-off'}>
                <input className="input input-plain grow" defaultValue={n.texto} aria-label="Texto da notícia"
                  onBlur={(e) => e.target.value.trim() !== n.texto && patch(n, { texto: e.target.value })} />
                <Toggle checked={n.enabled} onChange={(v) => patch(n, { enabled: v })} label={n.enabled ? 'No ar' : 'Oculta'} />
                <button className="icon-btn danger" title="Excluir" onClick={() => remove(n)}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
