import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, RotateCw, RefreshCw, Lock, Unlock, Settings } from 'lucide-react';
import api, { errorMessage, playerUrl } from '../api';
import { useAuth } from '../auth';
import { Modal, useToast } from '../ui';

// Preview | Reiniciar | Sincronizar | Bloquear | Configurar
export default function DeviceActions({ device, onChange, showConfigure = true }) {
  const { isAdmin, base } = useAuth();
  const toast = useToast();
  const [preview, setPreview] = useState(null);

  const command = async (cmd, label) => {
    try {
      const r = await api.post(`/devices/${device.id}/command`, { command: cmd });
      toast(r.data.delivered ? `${label}: enviado agora.` : `${label}: a TV está sem conexão em tempo real; recebe no próximo contato.`, r.data.delivered ? 'success' : 'info');
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const toggleBlock = async () => {
    const blocking = device.status !== 'blocked';
    if (blocking && !window.confirm(`Bloquear "${device.name}"? A TV para de exibir conteúdo e mostra um aviso até ser desbloqueada.`)) return;
    try {
      await api.post(`/devices/${device.id}/${blocking ? 'block' : 'unblock'}`);
      toast(blocking ? 'TV bloqueada.' : 'TV desbloqueada.');
      onChange?.();
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const openPreview = async () => {
    try {
      const r = await api.get(`/devices/${device.id}/preview-token`);
      setPreview(playerUrl(`?preview=${encodeURIComponent(r.data.token)}`));
    } catch (err) { toast(errorMessage(err), 'error'); }
  };

  const portrait = device.orientation === 'portrait' || (device.orientation === 'auto' && device.reported_orientation === 'portrait');
  const path = isAdmin ? `${base}/dispositivos/${device.id}` : `${base}/tvs/${device.id}`;

  return (
    <>
      <div className="btn-row">
        <button className="btn btn-ghost btn-sm" onClick={openPreview}><Eye size={15} /> Preview</button>
        <button className="btn btn-ghost btn-sm" onClick={() => command('reload', 'Reiniciar player')}><RotateCw size={15} /> Reiniciar</button>
        <button className="btn btn-ghost btn-sm" onClick={() => command('sync', 'Sincronizar')}><RefreshCw size={15} /> Sincronizar</button>
        {isAdmin && (
          <button className="btn btn-ghost btn-sm" onClick={toggleBlock}>
            {device.status === 'blocked' ? <><Unlock size={15} /> Desbloquear</> : <><Lock size={15} /> Bloquear</>}
          </button>
        )}
        {showConfigure && <Link className="btn btn-ghost btn-sm" to={path}><Settings size={15} /> Configurar</Link>}
      </div>
      <Modal open={!!preview} title={`Preview — ${device.name}`} onClose={() => setPreview(null)} wide>
        <div className={`preview-frame ${portrait ? 'portrait' : ''}`}>
          {preview && <iframe src={preview} title={`Preview de ${device.name}`} />}
        </div>
        <p className="muted small">O preview mostra exatamente o manifesto desta TV (playlist, campanhas no horário atual e aparência). Ele não conta como exibição nos relatórios.</p>
      </Modal>
    </>
  );
}
