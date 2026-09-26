// Limitador simples em memória, por IP (suficiente para uma instância única).
module.exports = function rateLimit({ windowMs, max, message = 'Muitas tentativas. Aguarde um pouco e tente novamente.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    if (++h.n > max) return res.status(429).json({ error: message });
    next();
  };
};
