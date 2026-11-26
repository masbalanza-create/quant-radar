const forecastMinutes = {'1min':1, '5min':5, '15min':15, '30min':30, '1h':60, '1day':1440, '1week':10080};

function hasFreshIntradayData(asset, interval, now = Date.now()) {
  const minutes = forecastMinutes[interval];
  if (!minutes || minutes >= 1440 || asset.stale ||
      !['public_rest', 'alpaca_iex', 'alpaca_sip'].includes(asset.meta.quality)) return false;
  const receivedAge = now - asset.fetched * 1000;
  const quote = asset.meta.quote_time;
  const quoteAge = now - (typeof quote === 'number' ? quote * 1000 : Date.parse(quote));
  const duration = minutes * 60000;
  const sessionStart = asset.meta.session?.start * 1000;
  const anchor = Number.isFinite(sessionStart) && sessionStart <= now ? sessionStart : 0;
  const receiptGrace = 15000;
  const expectedClosedStart = anchor + (Math.floor((now - receiptGrace - anchor) / duration) - 1) * duration;
  if (!(receivedAge >= -5000 && receivedAge < 75000 && quoteAge >= -5000 && quoteAge < 60000)) return false;
  return asset.values.some(row => {
    const start = Date.parse(row.datetime);
    return start >= expectedClosedStart && start + duration <= now && Number.isFinite(Number(row.close)) && Number(row.close) > 0;
  });
}

const fundamentalPolicy = {minimumMargin: .15, maximumNetDebtEbitda: 3};

function fundamentalDecision(report, hasPosition) {
  const wait = reason => ({state:'wait', title:'Esperar', reason});
  if (!report) return wait('Consultando los datos financieros y el rango de valor por acción.');
  if (report.status !== 'ok') return wait(report.reasons?.[0]?.message || report.error ||
    'Hace falta una valoración fundamental válida para evaluar este activo a largo plazo.');
  const prudent = report.scenarios?.prudente;
  const favorable = report.scenarios?.favorable?.value_per_share;
  const price = report.quote?.value;
  const spread = report.ratios?.roic_spread;
  const leverage = report.ratios?.net_debt_ebitda;
  const margin = prudent?.margin_of_safety;
  if (![price, prudent?.value_per_share, margin, favorable, spread, leverage].every(Number.isFinite) ||
      price <= 0 || prudent.value_per_share <= 0) {
    return wait('Faltan datos para comprobar el valor prudente, el ROIC frente al coste de capital o la deuda neta.');
  }
  if (hasPosition && (price > favorable || spread <= 0 || leverage > fundamentalPolicy.maximumNetDebtEbitda)) {
    const reason = price > favorable ? 'El precio supera el valor del escenario favorable.' :
      spread <= 0 ? 'La rentabilidad del capital ya no supera su coste.' : 'La deuda neta supera 3 veces el EBITDA.';
    return {state:'sell', title:'Vender', reason:'Tienes una posición en cartera. '+reason};
  }
  if (spread <= 0) return wait('El ROIC debe superar el coste de capital.');
  if (leverage > fundamentalPolicy.maximumNetDebtEbitda) return wait('La deuda neta supera 3 veces el EBITDA.');
  if (margin < fundamentalPolicy.minimumMargin) {
    return wait('El precio no ofrece un margen de seguridad del 15 % respecto al escenario prudente.');
  }
  return {state:'buy', title:'Comprar',
    reason:'El margen frente al escenario prudente alcanza el 15 %, el ROIC supera el coste de capital y la deuda neta está dentro del límite.'};
}

function weeklyDecision(asset, hasPosition, now) {
  const method = 'weekly';
  const wait = (reason, metrics) => ({state:'wait', title:'Esperar', reason, method, metrics});
  if (asset?.interval !== '1week' || asset.stale) return wait('Falta un histórico semanal actualizado.');
  const week = 7 * 86400000;
  const byDate = new Map();
  for (const row of asset.values || []) {
    const date = Date.parse(row.datetime);
    const close = row.close == null ? NaN : Number(row.close);
    if (date + week <= now && Number.isFinite(close) && close > 0) byDate.set(date, close);
  }
  const bars = [...byDate].sort(([a], [b]) => a-b).slice(-40);
  if (bars.length < 40 || now - bars.at(-1)[0] > 2 * week + 2 * 86400000 ||
      bars.some(([date], i) => i > 0 && Math.abs(date - bars[i-1][0] - week) > 2 * 86400000)) {
    return wait('Se necesitan 40 velas semanales completas, consecutivas y recientes.');
  }
  const [date, close] = bars.at(-1);
  const average = bars.reduce((sum, [,value]) => sum + value, 0)/bars.length;
  const momentum = close / bars.at(-27)[1] - 1;
  const metrics = {date,close,average,momentum};
  if (close > average && momentum > 0) return {state:'buy', title:'Comprar', method, metrics,
    reason:'El cierre semanal supera la media de 40 semanas y el rendimiento de 26 semanas es positivo.'};
  if (close < average && momentum < 0) {
    const reason = 'El cierre semanal está por debajo de la media de 40 semanas y el rendimiento de 26 semanas es negativo.';
    return hasPosition ? {state:'sell', title:'Vender', method, metrics, reason} :
      wait(reason+' No hay una posición registrada que cerrar.', metrics);
  }
  return wait('El cierre semanal y el rendimiento de 26 semanas no confirman la misma dirección.', metrics);
}

function assetDecision(report, marketSession, asset, {fundamental = false, hasPosition = false, now = Date.now()} = {}) {
  if (fundamental) {
    if (report?.status === 'ok') return {...fundamentalDecision(report, hasPosition), method:'fundamental'};
    return weeklyDecision(asset, hasPosition, now);
  }
  if (marketSession === 'closed') {
    return {state:'wait', title:'Esperar', reason:'Mercado cerrado. Se volverá a evaluar al reabrir.'};
  }
  if (marketSession !== 'open') {
    return {state:'wait', title:'Esperar', reason:'La sesión del mercado está sin verificar.'};
  }
  if (!asset || asset.stale || ![asset.p, asset.ma, asset.mom, asset.macd].every(Number.isFinite) ||
      asset.p <= 0 || asset.ma <= 0) {
    return {state:'wait', title:'Esperar', reason:'Faltan datos técnicos válidos o la cotización está desactualizada.'};
  }
  const bullish = asset.p > asset.ma && asset.mom > 0 && asset.macd > 0;
  const bearish = asset.p < asset.ma && asset.mom < 0 && asset.macd < 0;
  const classification = report?.status === 'ok' ? report.classification : null;
  if (bullish && classification !== 'above_range') return {
    state:'buy', title:'Comprar',
    reason:'En el plazo seleccionado, el cierre supera la media de 20 velas y tanto el rendimiento de 10 velas como el MACD son positivos.'
  };
  if (bearish && classification !== 'below_range') return {
    state:'sell', title:'Vender',
    reason:'El cierre queda por debajo de la media de 20 velas y tanto el rendimiento de 10 velas como el MACD son negativos. Señal de salida si tienes una posición.'
  };
  const conflict = bullish || bearish;
  return {state:'wait', title:'Esperar',
    reason:conflict ? 'La señal técnica entra en conflicto con el rango de valoración fundamental.' :
      'La media de 20 velas, el rendimiento de 10 velas y el MACD no coinciden en una dirección.'};
}

function compute(u,d) {
  const avg = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  let a=d.values.map(v=>Number(v.close)).filter(x=>Number.isFinite(x)&&x>0);if(a.length<21)throw Error('Histórico insuficiente');let p=a.at(-1),ma=avg(a.slice(-20)),mom=(p/a.at(-11)-1)*100,delta=a.slice(1).map((v,i)=>v-a[i]).slice(-14),g=avg(delta.map(v=>Math.max(0,v))),l=avg(delta.map(v=>Math.max(0,-v))),rsi=l===0?(g===0?50:100):100-100/(1+g/l),ret=a.slice(1).map((v,i)=>v/a[i]-1).slice(-20),m=avg(ret),vol=Math.sqrt(avg(ret.map(x=>(x-m)**2)))*100,risk=u[2]==='Crypto'||vol>2?'Alto':vol>.65?'Medio':'Bajo';let ema=(arr,n)=>arr.reduce((v,x,i)=>i===0?x:x*2/(n+1)+v*(1-2/(n+1)),0),macd=ema(a,12)-ema(a,26),sd=Math.sqrt(avg(a.slice(-20).map(x=>(x-ma)**2))),rows=d.values.filter(v=>v.high!=null&&v.low!=null&&v.close!=null),tr=rows.slice(1).map((v,i)=>Math.max(+v.high-+v.low,Math.abs(+v.high-+rows[i].close),Math.abs(+v.low-+rows[i].close))),atr=tr.length>=14?avg(tr.slice(-14)):null,vr=rows.slice(-21,-1).map(v=>+v.volume),volumeRatio=vr.length&&avg(vr)>0?+rows.at(-1).volume/avg(vr):null;return {u,a,values:d.values,p,ma,mom,g,l,returnMean:m,macd,sd,atr,volumeRatio,rsi,vol,risk,change:(p/a.at(-2)-1)*100,meta:d.meta||{},stale:d.stale,fetched:d.fetched_at,date:d.values.at(-1).datetime,low:Math.min(...a.slice(-20)),high:Math.max(...a.slice(-20))}
}

if (typeof module !== "undefined") module.exports = { hasFreshIntradayData, assetDecision, compute };
