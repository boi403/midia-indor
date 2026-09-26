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

function getOrCreate(camId, rtspUrl) {
  const key = String(camId);
  let s = camStreams.get(key);
  if (s) return s;

  const proc = spawn(ffmpegPath, [
    '-rtsp_transport', 'tcp',
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
        res.write(head);
        res.write(frame);
        res.write('\r\n');
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
    camStreams.delete(key);
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

function serve(req, res, cam) {
  const s = getOrCreate(cam.id, cam.url);
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

module.exports = { serve, stop };
