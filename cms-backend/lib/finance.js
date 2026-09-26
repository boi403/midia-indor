// Cotações exibidas na barra "Mercados" do player (compartilhadas por todos os clientes).
let quotes = [];
let revision = 0;

async function yahoo(symbol, label) {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(8000) });
  const meta = (await res.json()).chart.result[0].meta;
  const change = ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
  return { symbol: label, price: Math.round(meta.regularMarketPrice).toLocaleString('pt-BR'), changePct: change.toFixed(2) };
}

async function refresh() {
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL', { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const next = [];
    if (data.USDBRL) next.push({ symbol: 'DÓLAR', price: parseFloat(data.USDBRL.bid).toFixed(2), changePct: parseFloat(data.USDBRL.pctChange) });
    if (data.EURBRL) next.push({ symbol: 'EURO', price: parseFloat(data.EURBRL.bid).toFixed(2), changePct: parseFloat(data.EURBRL.pctChange) });
    for (const [sym, label] of [['^BVSP', 'IBOVESPA'], ['^IXIC', 'NASDAQ']]) {
      try { next.push(await yahoo(sym, label)); } catch { /* índice indisponível: omite em vez de inventar valor */ }
    }
    if (JSON.stringify(next) !== JSON.stringify(quotes)) { quotes = next; revision++; }
  } catch (err) {
    console.error('[finance] falha ao atualizar cotações:', err.message);
  }
}

function start() {
  refresh();
  setInterval(refresh, 10 * 60 * 1000);
}

module.exports = { start, getQuotes: () => quotes, getRevision: () => revision };
