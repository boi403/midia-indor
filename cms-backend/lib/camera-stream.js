// CÂMERAS AO VIVO (RTSP -> MJPEG sob demanda)
//
// O navegador não sabe abrir rtsp:// diretamente. Este proxy usa o ffmpeg pra
// converter o stream RTSP do DVR em MJPEG (multipart/x-mixed-replace), que o
// <img> do player já sabe exibir.
//
// Um único processo ffmpeg por câmera atende todas as TVs e previews que estão
// assistindo ao mesmo tempo; quando o último cliente desconecta, o processo é
// encerrado — assim não transcodificamos câmeras 24h por dia sem necessidade.
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const camStreams = new Map(); // camera id (string) -> { proc, buf, clients: Set<res> }
const JPEG_SOI = Buffer.from([0xFF, 0xD8]);
const JPEG_EOI = Buffer.from([0xFF, 0xD9]);
const MJPEG_BOUNDARY = 'midiaindoorframe';
// Clientes lentos: marca quem está esperando o evento 'drain' pra não
// empilhar frames indefinidamente no buffer interno do Node.
const pausedClients = new WeakMap(); // res -> true enquanto aguarda 'drain'

// Só RTSP é aceito (sem file://, concat:, http(s) etc.) — evita SSRF e leitura
// de arquivo local via ffmpeg.
const RTSP_URL_RE = /^rtsps?:\/\//i;

function getOrCreate(camId, rtspUrl) {
  const key = String(camId);
  let s = camStreams.get(key);
  if (s) return s;

  if (!RTSP_URL_RE.test(rtspUrl || '')) {
    throw new Error('URL de câmera inválida: apenas RTSP é permitido.');
  }

  const proc = spawn(ffmpegPath, [
    '-rtsp_transport', 'tcp',
    '-protocol_whitelist', 'rtsp,rtp,tcp,udp,tls', // trava truques de "protocol juggling" mesmo dentro de um rtsp:// válido
    '-stimeout', '15000000', // 15s: desiste se o DVR estiver inacessível em vez de travar pra sempre
    '-i', rtspUrl,
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', '6',
    '-r', '8',        // poucos fps: é sinalização, não precisa de fluidez de vídeo
    '-s', '854x480',  // resolução baixa: mais leve pra CPU e pra rede
    '-an',
    'pipe:1',
  ]);

  s = { proc, buf: Buffer.alloc(0), clients: new Set() };
  camStreams.set(key, s);

  proc.stdout.on('data', (chunk) => {
    s.buf = Buffer.concat([s.buf, chunk]);
    let start;
    while ((start = s.buf.indexOf(JPEG_SOI)) !== -1) {
      const end = s.buf.indexOf(JPEG_EOI, start + 2);
      if (end === -1) break; // frame incompleto ainda, espera mais dados
      const frame = s.buf.slice(start, end + 2);
      s.buf = s.buf.slice(end + 2);
      const head = `--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`;
      s.clients.forEach((res) => {
        if (pausedClients.get(res)) return; // cliente lento: pula este frame até drenar o buffer
        const ok = res.write(head) && res.write(frame) && res.write('\r\n');
        if (!ok) {
          pausedClients.set(res, true);
          res.once('drain', () => pausedClients.delete(res));
        }
      });
    }
    // evita crescimento sem limite caso o stream pare de mandar marcadores válidos
    if (s.buf.length > 5 * 1024 * 1024) s.buf = Buffer.alloc(0);
  });

  // mantém só as últimas linhas do stderr do ffmpeg — se o processo cair, ajuda a saber por quê
  let stderrTail = '';
  proc.stderr.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString()).slice(-2000); });

  const stop = () => {
    // código != 0 = erro real (ex.: 401 do DVR); null = encerrado por nós mesmos (kill), não loga
    if (proc.exitCode) console.error(`[câmera ${camId}] ffmpeg encerrou com erro (code ${proc.exitCode}). Últimas linhas:\n` + stderrTail);
    // 'error' e 'exit' podem disparar os dois pro mesmo processo, e um novo
    // stream pode já ter sido criado pra essa chave nesse meio-tempo — só
    // apaga do mapa se ele ainda apontar pra esta mesma instância, senão
    // orfanamos/apagamos o processo novo por engano.
    if (camStreams.get(key) === s) camStreams.delete(key);
    s.clients.forEach((res) => { try { res.end(); } catch { /* conexão já fechada */ } });
    s.clients.clear();
  };
  proc.on('error', stop);
  proc.on('exit', stop);
  return s;
}

function stop(camId) {
  const s = camStreams.get(String(camId));
  if (s) { try { s.proc.kill(); } catch { /* já encerrado */ } }
}

// Quantos clientes assistem esta câmera agora (0 se não há stream ativo).
// Usado pela rota pra limitar espectadores simultâneos por câmera — o link
// assinado não é de uso único, então sem isso um link vazado sustentaria
// qualquer número de conexões até expirar.
function clientCount(camId) {
  return camStreams.get(String(camId))?.clients.size || 0;
}

function serve(req, res, cam) {
  let s;
  try {
    s = getOrCreate(cam.id, cam.url);
  } catch (err) {
    res.status(400).end(err.message);
    return;
  }
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'close',
  });
  res.flushHeaders(); // manda os headers já, sem esperar o 1º frame (o DVR pode levar alguns segundos)
  s.clients.add(res);
  req.on('close', () => {
    s.clients.delete(res);
    if (s.clients.size === 0) stop(cam.id);
  });
}

module.exports = { serve, stop, clientCount };
