import { useEffect, useRef } from 'react';
import { session, wsUrl } from './api';

// Eventos em tempo real do painel (TV online/offline, conteúdo alterado).
// Reconecta sozinho com backoff; o painel continua funcionando sem ele.
export function useLive(onEvent) {
  const handler = useRef(onEvent);
  useEffect(() => { handler.current = onEvent; });

  useEffect(() => {
    let ws;
    let timer;
    let backoff = 1000;
    let closed = false;
    const connect = () => {
      if (!session.token) return;
      ws = new WebSocket(wsUrl(`/ws/panel?token=${encodeURIComponent(session.token)}`));
      ws.onopen = () => { backoff = 1000; };
      ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type !== 'ping') handler.current?.(msg);
      };
      ws.onclose = () => {
        if (closed) return;
        timer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, []);
}
