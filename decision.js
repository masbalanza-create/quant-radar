function normalizeStrategy(input) {
  if (!input || typeof input.idea !== 'string'
      || !['all', 'EE. UU.', 'Europa', 'Asia', 'Forex', 'ETF', 'Materias primas', 'Crypto'].includes(input.market)
      || !['1day', '1week', '1h', '1min'].includes(input.horizon)
      || !Number.isFinite(input.capital) || input.capital < 0.01 || input.capital > 1e9
      || !Number.isFinite(input.limit) || input.limit < 0.1 || input.limit > 100) return null;
  const {idea, market, horizon, capital, limit} = input;
  return {idea: idea.trim().slice(0, 400), market, horizon, capital, limit};
}

/* Quant Decision Protocol: diagnostics and evidence gates for the virtual radar. */
function evaluateQuantDecision(prices, state) {
  const signalAt = t => {
    if (t < 19) return 'hold';
    const window = prices.slice(t - 19, t + 1);
    const mean = window.reduce((sum, price) => sum + price, 0) / window.length;
    if (prices[t] > mean && prices[t] > prices[t - 10]) return 'buy';
    if (prices[t] < mean && prices[t] < prices[t - 10]) return 'sell';
    return 'hold';
  };
  // Fixed exploratory rule. At close t, use only observations through t.
  // Enter at the next observed close and evaluate one bar later.
  const cutoff = Math.max(19, Math.floor(prices.length * 0.6));
  const observations = [];
  const benchmark = [];
  const trades = [];
  for (let t = cutoff; t + 2 < prices.length; t += 2) {
    const gross = prices[t + 2] / prices[t + 1] - 1;
    benchmark.push(gross);
    if (signalAt(t) === 'buy') {
      observations.push(gross);
      trades.push({index: t, entry: prices[t + 1], exit: prices[t + 2], gross});
    }
  }
  const sum = observations.reduce((total, value) => total + value, 0);
  const mean = observations.length ? sum / observations.length : null;
  const benchmarkMean = benchmark.length
    ? benchmark.reduce((total, value) => total + value, 0) / benchmark.length : null;
  const positive = observations.filter(value => value > 0).length;
  const tradesByIndex = new Map(trades.map(trade => [trade.index, trade]));
  const windowCount = Math.min(3, benchmark.length);
  const windows = Array.from({length:windowCount}, (_, window) => {
    const start = Math.floor(window * benchmark.length / windowCount);
    const end = Math.floor((window + 1) * benchmark.length / windowCount);
    const eligible = benchmark.slice(start, end);
    const first = cutoff + start * 2;
    const selected = eligible.map((_, index) => tradesByIndex.get(first + index * 2)).filter(Boolean);
    return {first, lastExit:cutoff + end * 2, eligible:eligible.length, trades:selected.length,
      ruleMean:selected.length ? selected.reduce((sum, trade) => sum + trade.gross, 0) / selected.length : null,
      referenceMean:eligible.reduce((sum, value) => sum + value, 0) / eligible.length};
  });
  const ordered = observations.slice().sort((a, b) => a - b);
  const quantile = p => ordered.length ? ordered[Math.ceil(p * ordered.length) - 1] : null;
  const profile = state.strategyProfile;
  const concentration = profile
    ? 'Tope declarado por activo: ' + new Intl.NumberFormat('es-ES', {
      style: 'currency', currency: 'EUR'
    }).format(profile.capital * profile.limit / 100) + '. '
    : '';
  const checks = [
    ['Activo y horizonte', 'definidos', 'Evaluación exploratoria de una vela, con entrada en el cierre siguiente.'],
    ['Datos y sesión', state.usable ? 'disponibles' : 'bloqueados', state.dataReason],
    ['Diagnóstico y señal', 'exploratorios', 'Se conserva el diagnóstico técnico y de titulares. Régimen, macro y fundamentales requieren evidencia adicional.'],
    ['Distribución de resultados', observations.length ? 'histórica' : 'sin casos', 'Se mide la frecuencia de subidas y el rango de los resultados observados. La calibración para predicción sigue pendiente.'],
    ['Validación', benchmark.length ? 'comparación exploratoria' : 'histórico insuficiente', 'Se compara la regla con entrar en todas las fechas de evaluación del mismo activo. El paso 19 estima la incertidumbre frente a esa referencia.'],
    ['Costes y utilidad', 'simulación disponible', 'El coste de la operación se puede introducir como supuesto.'],
    ['Riesgo y cartera', profile ? 'tope calculado' : 'requiere perfil', concentration + 'Faltan posiciones, otros límites de exposición y escenarios de estrés verificados.'],
    ['Ejecución y seguimiento', 'simulación virtual', 'Los pasos 27 a 30 simulan la ejecución, siguen posiciones registradas y evalúan sus cierres.']
  ];
  const currentSignal = signalAt(prices.length - 1);
  return {
    usable:state.usable, dataReason:state.dataReason,
    longSignal:currentSignal === 'buy', exitSignal:currentSignal === 'sell',
    checks,
    historicalTest: {observations: observations.length, meanGrossReturn: mean, sumGrossReturn: sum, cutoff, benchmarkCount: benchmark.length, benchmarkMean, benchmarkReturns:benchmark, positive, trades, windows, p10: quantile(.1), p90: quantile(.9)}
  };
}

function backtestUncertainty(history) {
  const {benchmarkReturns:returns, cutoff, trades, meanGrossReturn, benchmarkMean} = history;
  const count = returns.length;
  if (count < 20 || trades.length < 5) return null;
  const selected = new Set(trades.map(trade => (trade.index - cutoff) / 2));
  const blockSize = Math.round(Math.cbrt(count));
  const repetitions = 2000;
  const differences = [];
  let seed = 19;
  for (let repetition = 0; repetition < repetitions; repetition++) {
    let referenceSum = 0;
    let ruleSum = 0;
    let ruleCount = 0;
    for (let offset = 0; offset < count; offset += blockSize) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const start = Math.floor(seed / 2 ** 32 * count);
      for (let step = 0; step < Math.min(blockSize, count - offset); step++) {
        const index = (start + step) % count;
        referenceSum += returns[index];
        if (selected.has(index)) {
          ruleSum += returns[index];
          ruleCount++;
        }
      }
    }
    if (ruleCount) differences.push(ruleSum / ruleCount - referenceSum / count);
  }
  differences.sort((a, b) => a - b);
  const interval = differences.length >= repetitions * .95
    ? [.025, .975].map(p => differences[Math.ceil(p * differences.length) - 1]) : null;
  return {difference:meanGrossReturn - benchmarkMean, interval, blockSize, repetitions, valid:differences.length};
}

function integratedVerdict(report, signal, cost, profile, sizing) {
  const wait = reason => ({action:'hold', percent:0, stance:'Esperar', reason});
  const pending = reason => ({action:'pending', percent:0, stance:'Datos insuficientes', reason});
  if (!report.usable) return pending(report.dataReason);
  if (signal === 'sell' && report.exitSignal) {
    return {action:'sell', percent:0, stance:'Vender',
      reason:'Si tienes una posición larga virtual, la señal bajista y un cierre por debajo de la media de 20 velas y del cierre de hace 10 velas indican una salida técnica. Esta regla de salida es exploratoria. Si no tienes posición, espera.'};
  }
  if (signal !== 'buy') return wait('La señal y los cierres no confirman una compra ni una salida técnica.');
  if (!report.longSignal) return wait('El último cierre todavía no activa la regla probada: superar la media de 20 cierres y el cierre de hace 10 velas.');
  const lower = report.uncertainty?.interval?.[0];
  if (lower == null) return pending('La muestra del paso 19 todavía no permite estimar un intervalo de ventaja frente a la referencia.');
  if (lower <= 0) return wait('El intervalo del paso 19 incluye ventajas nulas o negativas frente a la referencia.');
  if (cost === null) return pending('Completa el escenario de costes del paso 21.');
  const gross = report.historicalTest.meanGrossReturn;
  const net = gross === null ? null : gross - cost / 100;
  if (!(net > 0)) return wait('La rentabilidad media histórica del paso 22 es nula o negativa después de costes.');
  const size = profile && sizing && virtualPositionSize({...profile, ...sizing, cost});
  if (!size) return pending('La prueba histórica y los costes son favorables. Completa el perfil y el tamaño de posición del paso 24.');
  if (size.amount <= 0) return wait('Los límites de riesgo, efectivo y exposición del paso 24 dejan un tamaño adicional de cero.');
  const f = value => value.toLocaleString('es-ES', {maximumFractionDigits:4});
  return {action:'buy', percent:size.portfolioWeight * 100, stance:'Comprar',
    reason:'La señal activa la regla histórica. El límite inferior de la ventaja bruta es '
      + f(lower * 100) + ' puntos porcentuales y la media neta simulada es ' + f(net * 100)
      + '%. El paso 24 limita el importe adicional a ' + f(size.amount) + ' EUR.'};
}

const forecastMinutes = {'1min':1, '5min':5, '15min':15, '30min':30, '1h':60, '1day':1440, '1week':10080};

function auditForecastInputs(values, {interval, now, source, stale, continuous}) {
  const duration = forecastMinutes[interval] * 60000;
  const byTime = new Map();
  let invalid = 0, open = 0, duplicates = 0, conflicts = 0, unordered = 0;
  let previous = -Infinity;
  for (const row of values) {
    const time = Date.parse(row?.datetime);
    const close = Number(row?.close);
    if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0 || time > now) {
      invalid++;
      continue;
    }
    if (time < previous) unordered++;
    previous = time;
    if (time + duration > now) {
      open++;
      continue;
    }
    const high = Number(row.high ?? NaN), low = Number(row.low ?? NaN);
    if (byTime.has(time)) {
      duplicates++;
      if (byTime.get(time).close !== close) conflicts++;
      continue;
    }
    byTime.set(time, {time, close, high, low, volume: Number(row.volume ?? NaN), adjusted: Number(row.adjusted_close ?? NaN)});
  }
  const bars = [...byTime.values()].sort((a,b)=>a.time-b.time);
  const gaps = bars.slice(1).flatMap((bar,i)=>bar.time-bars[i].time > duration*1.5
    ? [{from:bars[i].time, to:bar.time}] : []);
  const recent = bars.slice(-21);
  const recentGaps = continuous && recent.length > 1
    ? gaps.filter(gap=>gap.from >= recent[0].time).length : 0;
  const adxReady = bars.length >= 28 && bars.every(bar =>
    Number.isFinite(bar.high) && Number.isFinite(bar.low)
    && bar.low > 0 && bar.low <= bar.close && bar.close <= bar.high);
  const blockers = [];
  if (!source) blockers.push('Falta identificar la fuente.');
  if (!Number.isFinite(duration) || !Number.isFinite(now)) blockers.push('No se puede verificar el cierre de las velas.');
  if (stale) blockers.push('La consulta usa una copia antigua.');
  if (bars.length < 21) blockers.push('Se necesitan 21 cierres válidos. Faltan ' + (21-bars.length) + '.');
  if (conflicts) blockers.push('Hay cierres distintos para la misma fecha.');
  if (recentGaps) blockers.push('Hay ' + recentGaps + ' saltos de intervalo en las últimas 21 velas de este mercado continuo.');
  return {bars, invalid, open, duplicates, conflicts, unordered, gaps, adxReady, blockers,
    ready: blockers.length === 0};
}

function prepareForecastSeries(bars, market) {
  const equity = ['EE. UU.', 'Europa', 'Asia', 'ETF'].includes(market);
  const adjustedCount = bars.filter(bar=>Number.isFinite(bar.adjusted) && bar.adjusted > 0).length;
  const useAdjusted = equity && bars.length > 0 && adjustedCount === bars.length;
  const last = bars.at(-1);
  const anchor = useAdjusted ? last.close/last.adjusted : 1;
  const prepared = useAdjusted ? bars.map(bar=>{
    const factor = bar.adjusted/bar.close*anchor;
    return {...bar, close:bar.adjusted*anchor, high:bar.high*factor, low:bar.low*factor};
  }) : bars;
  const returns = prepared.slice(1).map((bar,i)=>Math.log(bar.close/prepared[i].close));
  const median = values=>{
    const sorted = values.slice().sort((a,b)=>a-b);
    const middle = Math.floor(sorted.length/2);
    return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
  };
  const anomalies = [];
  let checked = 0, flat = 0;
  for (let i = 20; i < returns.length; i++) {
    const window = returns.slice(i-20,i);
    const center = median(window);
    const mad = median(window.map(value=>Math.abs(value-center)));
    const delta = Math.abs(returns[i]-center);
    if (mad <= 1e-12) {
      flat++;
      if (delta > 1e-12) anomalies.push({time:prepared[i+1].time, value:returns[i], score:null});
      continue;
    }
    checked++;
    const score = .67448975*(returns[i]-center)/mad;
    if (Math.abs(score)>3.5) anomalies.push({time:prepared[i+1].time, value:returns[i], score});
  }
  const corporate = equity ? (useAdjusted ? 'adjusted' : 'unverified')
    : market === 'Materias primas' ? 'roll' : 'notApplicable';
  return {bars:prepared, corporate, adjustedCount, checked, flat, anomalies,
    current:prepared.at(-1)?.close, previous:prepared.at(-2)?.close};
}

function wilderAdx(bars, period = 14) {
  if (bars.length < 2*period || bars.some(b => !Number.isFinite(b.high) || !Number.isFinite(b.low) || b.low <= 0 || b.low > b.close || b.close > b.high)) return null;
  let tr = 0, plus = 0, minus = 0;
  const dx = [];
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i-1], b = bars[i];
    const range = Math.max(b.high-b.low, Math.abs(b.high-a.close), Math.abs(b.low-a.close));
    const up = b.high-a.high, down = a.low-b.low;
    const smooth = (previous, value) => (i <= period ? previous : previous*(1-1/period)) + value;
    tr = smooth(tr, range);
    plus = smooth(plus, up > Math.max(0, down) ? up : 0);
    minus = smooth(minus, down > Math.max(0, up) ? down : 0);
    if (i >= period) dx.push(tr && plus+minus ? 100*Math.abs(plus-minus)/(plus+minus) : 0);
  }
  let adx = dx.slice(0,period).reduce((sum,value)=>sum+value,0)/period;
  for (const value of dx.slice(period)) adx = ((period-1)*adx+value)/period;
  return adx;
}

function ewmaVariance(returns, lambda) {
  return returns.slice(1).reduce((v,r)=>lambda*v+(1-lambda)*r*r, returns[0]**2);
}

function marketRegime(bars, {volatility, lambda, slope, mean, adx}) {
  const returns = bars.slice(1).map((bar,i)=>Math.log(bar.close/bars[i].close));
  const baseline = [];
  // Reference windows end before the current 20-return window begins.
  for (let end = 20; end <= returns.length-20; end++) {
    baseline.push(Math.sqrt(ewmaVariance(returns.slice(end-20,end),lambda)));
  }
  baseline.sort((a,b)=>a-b);
  const middle = Math.floor(baseline.length/2);
  const typical = baseline.length < 5 ? null
    : (baseline[middle]+baseline[Math.floor((baseline.length-1)/2)])/2;
  const relative = typical > 0 ? volatility/typical : null;
  const elevated = typical === null ? null : typical === 0 ? volatility > 0 : relative >= 1.5;
  const normalizedSlope = slope/mean;
  const limit = volatility/10;
  const direction = normalizedSlope > limit ? 'alcista' : normalizedSlope < -limit ? 'bajista' : 'lateral';
  const trend = direction === 'lateral' || (adx !== null && adx < 25)
    ? 'Lateral' : 'Tendencia ' + direction;
  return {trend, normalizedSlope, limit, adx, typical, relative, elevated,
    baselineCount:baseline.length, complete:adx !== null && typical !== null};
}

function commonForecast(bars) {
  if (bars.length < 21) return null;
  const recent = bars.slice(-21);
  const last = recent.at(-1);
  const returns = recent.slice(1).map((bar,i)=>Math.log(bar.close/recent[i].close));
  const lambda = .94;
  const variance = ewmaVariance(returns,lambda);
  const volatility = Math.sqrt(variance);
  const prices = recent.slice(1).map(bar=>bar.close);
  const mean = prices.reduce((sum,price)=>sum+price,0)/prices.length;
  const midpoint = (prices.length-1)/2;
  const numerator = prices.reduce((sum,price,i)=>sum+(i-midpoint)*(price-mean),0);
  const denominator = prices.reduce((sum,_,i)=>sum+(i-midpoint)**2,0);
  const slope = numerator/denominator;
  const priceVariation = prices.reduce((sum,price)=>sum+(price-mean)**2,0);
  const rSquared = priceVariation > 0 ? Math.min(1,numerator**2/(denominator*priceVariation)) : null;
  const momentum = Math.log(last.close/recent.at(-11).close)/10;
  const drift = (momentum+slope/mean)/2;
  const threshold = volatility/4;
  let peak = 0, drawdown = 0;
  for (const bar of bars) {
    peak = Math.max(peak,bar.close);
    drawdown = Math.max(drawdown,1-bar.close/peak);
  }
  const adx = wilderAdx(bars);
  const regime = marketRegime(bars, {volatility, lambda, slope, mean, adx});
  return {reference:last.close, origin:last.time, mean, numerator, denominator, slope, momentum, priceVariation, rSquared, prior10:recent.at(-11).close,
    lambda, variance, volatility, drift, threshold, drawdown, adx, regime,
    direction: drift > threshold ? 'Alcista' : drift < -threshold ? 'Bajista' : 'Lateral',
    center:last.close*Math.exp(drift), low:last.close*Math.exp(drift-volatility),
    high:last.close*Math.exp(drift+volatility)};
}

function recordForecast(entries, key, bars, forecast, now) {
  const matching = entries.filter(entry=>entry.key===key && entry.result == null);
  const indices = new Map(bars.map((bar,i)=>[bar.time,i]));
  for (const entry of matching) {
    const next = bars[indices.get(entry.origin)+1];
    if (next) entry.result = {time:next.time, close:next.close};
  }
  if (!entries.some(entry=>entry.key===key && entry.origin===forecast.origin)) {
    entries.push({key, ...forecast, issuedAt:now});
  }
  return entries.slice(-500);
}

function forecastEvaluation(entries, key, bars, interval) {
  const duration = forecastMinutes[interval] * 60000;
  const indices = new Map(bars.map((bar, index) => [bar.time, index]));
  let count = 0, covered = 0, directionHits = 0, error = 0, referenceError = 0;
  for (const entry of entries) {
    if (entry.key !== key || !entry.result) continue;
    const index = indices.get(entry.origin);
    const origin = bars[index], target = bars[index + 1];
    if (!origin || !target || target.time !== entry.result.time
        || !(entry.issuedAt >= origin.time + duration && entry.issuedAt < target.time + duration)
        || ![entry.reference, entry.center, entry.low, entry.high, entry.threshold].every(Number.isFinite)
        || entry.reference <= 0 || entry.low <= 0 || entry.low > entry.high || entry.threshold < 0
        || !['Alcista', 'Bajista', 'Lateral'].includes(entry.direction)) continue;
    const relative = target.close / origin.close;
    const observed = relative * entry.reference;
    const logReturn = Math.log(relative);
    const direction = logReturn > entry.threshold ? 'Alcista'
      : logReturn < -entry.threshold ? 'Bajista' : 'Lateral';
    count++;
    covered += Number(observed >= entry.low && observed <= entry.high);
    directionHits += Number(direction === entry.direction);
    error += Math.abs(entry.center / entry.reference - relative);
    referenceError += Math.abs(relative - 1);
  }
  return {count, covered, directionHits, error:count ? error / count : null,
    referenceError:count ? referenceError / count : null};
}

const trendReferences = {
  AAPL:'SPY', NVDA:'SPY', MSFT:'SPY', TSLA:'SPY', AMZN:'SPY', SPY:'QQQ', QQQ:'SPY',
  'ASML:Euronext Amsterdam':'SAP:XETR', 'SAP:XETR':'ASML:Euronext Amsterdam', 'SAN:BME':'SAP:XETR',
  '7203:JPX':'9984:JPX', '9984:JPX':'7203:JPX',
  'EUR/USD':'USD/JPY', 'USD/JPY':'EUR/USD',
  'BTC/USD':'ETH/USD', 'ETH/USD':'BTC/USD',
  'XAU/USD':'XAG/USD', 'XAG/USD':'XAU/USD'
};

function trendDateKey(time, interval) {
  return interval === '1day' || interval === '1week' ? new Date(time).toISOString().slice(0,10) : time;
}

function relativeMomentum(assetBars, referenceBars, interval, invert = false) {
  const key = time => trendDateKey(time, interval);
  const sameDates = new Map(referenceBars.map(bar=>[key(bar.time),bar.close]));
  const recent = assetBars.slice(-11);
  if (recent.length < 11 || recent.some(bar=>!sameDates.has(key(bar.time)))) return null;
  const first = recent[0], last = recent.at(-1);
  const refFirst = sameDates.get(key(first.time)), refLast = sameDates.get(key(last.time));
  const asset = last.close/first.close-1;
  const reference = (invert ? refFirst/refLast : refLast/refFirst)-1;
  return {asset, reference, difference:asset-reference, from:first.time, to:last.time};
}

function technicalAlpha(bars, {quadratic = false} = {}) {
  const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const prices = bars.map(bar => bar.close);
  const features = prices.slice(9).map((close, offset) => {
    const index = offset + 9;
    const last = close / prices[index - 1] - 1;
    const momentum = close / prices[index - 5] - 1;
    const distance = close / average(prices.slice(index - 9, index + 1)) - 1;
    const linear = [last, momentum, distance];
    return quadratic ? [...linear, last ** 2, momentum ** 2, distance ** 2,
      last * momentum, last * distance, momentum * distance] : linear;
  });
  const targets = prices.slice(10).map((close, index) => close / prices[index + 9] - 1);
  const split = Math.floor(targets.length * 0.7);
  if (split < 30 || targets.length - split < 12) return null;
  const training = features.slice(0, split);
  const columns = training[0].map((_, index) => index);
  const means = columns.map(j => average(training.map(row => row[j])));
  const scales = columns.map(j => Math.sqrt(average(training.map(row => (row[j] - means[j]) ** 2))) || 1);
  const standardize = row => row.map((value, j) => (value - means[j]) / scales[j]);
  const standardized = training.map(standardize);
  const baseline = average(targets.slice(0, split));
  const penalty = 1;
  // Solve the ridge normal equations on centered training data. The intercept is unpenalized.
  const matrix = columns.map(i => [
    ...columns.map(j => average(standardized.map(row => row[i] * row[j])) + (i === j ? penalty : 0)),
    average(standardized.map((row, k) => row[i] * (targets[k] - baseline)))
  ]);
  for (const i of columns) {
    const pivot = matrix[i][i];
    matrix[i] = matrix[i].map(value => value / pivot);
    for (const j of columns) {
      if (j === i) continue;
      const factor = matrix[j][i];
      matrix[j] = matrix[j].map((value, k) => value - factor * matrix[i][k]);
    }
  }
  const coefficients = matrix.map(row => row[columns.length]);
  const contributions = row => standardize(row).map((value, j) => value * coefficients[j]);
  const predict = row => baseline + contributions(row).reduce((sum, value) => sum + value, 0);
  const observed = targets.slice(split);
  const predicted = features.slice(split, -1).map(predict);
  const observedMean = average(observed);
  const predictedMean = average(predicted);
  const covariance = average(predicted.map((value, i) => (value - predictedMean) * (observed[i] - observedMean)));
  const variance = (values, mean) => average(values.map(value => (value - mean) ** 2));
  const scale = Math.sqrt(variance(predicted, predictedMean) * variance(observed, observedMean));
  return {estimate:predict(features.at(-1)), contributions:contributions(features.at(-1)),
    baseline, penalty, trainCount:split, testCount:observed.length,
    error:average(predicted.map((value, i) => Math.abs(value - observed[i]))),
    baselineError:average(observed.map(value => Math.abs(value - baseline))),
    correlation:scale > 0 ? covariance / scale : null};
}

function lowerTailMean(ordered) {
  const tailCount = ordered.length * .05;
  const full = Math.floor(tailCount);
  return (ordered.slice(0, full).reduce((sum, value) => sum + value, 0)
    + (tailCount - full) * ordered[full]) / tailCount;
}

function virtualPositionSize({capital, limit, lossBudget, stop, exposure, cash, cost = 0}) {
  if (![capital, limit, lossBudget, stop, exposure, cash, cost].every(Number.isFinite)
      || capital <= 0 || limit <= 0 || limit > 100 || stop <= 0 || stop > 100
      || lossBudget < 0 || exposure < 0 || cash < 0 || cost < 0 || cost > 100) return null;
  const lossRate = (stop + cost) / 100;
  const riskLimit = lossBudget / lossRate;
  const concentrationLimit = Math.max(0, capital * limit / 100 - exposure);
  const amount = Math.floor(Math.min(riskLimit, concentrationLimit, cash) * 100) / 100;
  return {amount, riskLimit, concentrationLimit, lossAtStop:amount * lossRate, portfolioWeight:amount / capital};
}

function executionScenario(bars, signals, {target, stop, horizon}) {
  if (!Number.isFinite(target) || target <= 0 || target > 100
      || !Number.isFinite(stop) || stop <= 0 || stop > 100
      || !Number.isInteger(horizon) || horizon < 1 || horizon > 30) return null;
  const exits = {target:0, stop:0, time:0};
  let sum = 0, lastExit = -1, incomplete = 0, overlapping = 0;
  for (const {index} of signals) {
    const entryIndex = index + 1;
    if (entryIndex + horizon >= bars.length) {
      incomplete++;
      continue;
    }
    if (index < lastExit) {
      overlapping++;
      continue;
    }
    const entry = bars[entryIndex].close;
    for (let step = 1; step <= horizon; step++) {
      const exitIndex = entryIndex + step;
      const gross = bars[exitIndex].close / entry - 1;
      const reason = bars[exitIndex].close >= entry * (1 + target / 100) ? 'target'
        : bars[exitIndex].close <= entry * (1 - stop / 100) ? 'stop'
        : step === horizon ? 'time' : null;
      if (!reason) continue;
      exits[reason]++;
      sum += gross;
      lastExit = exitIndex;
      break;
    }
  }
  const count = exits.target + exits.stop + exits.time;
  return {count, exits, incomplete, overlapping, mean:count ? sum / count : null};
}

function strategyRisk(trades, cost = 0) {
  if (!trades.length) return null;
  const returns = trades.map(trade => trade.gross - cost);
  const count = returns.length;
  const mean = returns.reduce((sum, value) => sum + value, 0) / count;
  const downside = Math.sqrt(returns.reduce((sum, value) => sum + Math.min(value, 0) ** 2, 0) / count);
  let equity = 1, peak = 1, drawdown = 0;
  for (const value of returns) {
    equity *= Math.max(0, 1 + value);
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, 1 - equity / peak);
  }
  const ordered = count >= 20 ? returns.slice().sort((a, b) => a - b) : null;
  return {count, drawdown, downside, sortino:count >= 2 && downside > 0 ? mean / downside : null,
    p5:ordered ? ordered[Math.ceil(count * .05) - 1] : null,
    tailMean:ordered ? lowerTailMean(ordered) : null};
}

function returnDistribution(bars) {
  if (bars.length < 21) return null;
  const ordered = bars.slice(1).map((bar, i) => bar.close / bars[i].close - 1).sort((a, b) => a - b);
  const count = ordered.length;
  const mean = ordered.reduce((sum, value) => sum + value, 0) / count;
  const variance = ordered.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const quantile = probability => ordered[Math.ceil(probability * count) - 1];
  const tailMean = lowerTailMean(ordered);
  const min = ordered[0], max = ordered.at(-1);
  const width = (max - min) / 7;
  const bins = Array.from({length:width > 0 ? 7 : 1}, (_, i) => ({
    low:min + i * width, high:i === 6 ? max : min + (i + 1) * width, count:0
  }));
  for (const value of ordered) {
    const index = width > 0 ? Math.min(6, Math.floor((value - min) / width)) : 0;
    bins[index].count++;
  }
  return {count, mean, variance, tailMean, bins, min, max,
    positive:ordered.filter(value => value > 0).length,
    negative:ordered.filter(value => value < 0).length,
    quantiles:[.05, .1, .5, .9, .95].map(quantile)};
}

function monteCarloScenarios(bars) {
  if (bars.length < 21) return null;
  const returns = bars.slice(1).map((bar, i) => bar.close / bars[i].close - 1);
  const paths = 5000;
  const horizons = [1, 5, 10];
  const steps = horizons.at(-1);
  const barrier = .05;
  const results = new Map(horizons.map(horizon => [horizon, []]));
  const firstHits = {upper:0, lower:0, neither:0};
  let seed = 16;
  for (let path = 0; path < paths; path++) {
    let value = 1;
    let firstHit = 'neither';
    for (let step = 1; step <= steps; step++) {
      // A fixed seed keeps comparisons reproducible when the panel is reopened.
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      value *= 1 + returns[Math.floor(seed / 2 ** 32 * returns.length)];
      const cumulative = value - 1;
      results.get(step)?.push(cumulative);
      if (firstHit === 'neither') {
        if (value >= 1 + barrier) firstHit = 'upper';
        else if (value <= 1 - barrier) firstHit = 'lower';
      }
    }
    firstHits[firstHit]++;
  }
  const summaries = horizons.map(horizon => {
    const ordered = results.get(horizon).sort((a, b) => a - b);
    return {horizon, quantiles:[.05, .5, .95].map(p => ordered[Math.ceil(p * paths) - 1]),
      positive:ordered.filter(value => value > 0).length};
  });
  return {paths, observations:returns.length, steps, barrier, firstHits, summaries};
}

function portfolioRisk(positions, interval) {
  if (!positions.length) return null;
  const totalWeight = positions.reduce((sum, position) => sum + position.weight, 0);
  if (totalWeight > 1 + 1e-12 || positions.some(({weight}) => !Number.isFinite(weight) || weight <= 0)) return null;
  const returnsByAsset = positions.map(({bars}) => {
    const changes = bars.slice(1).map((bar, index) => {
      const previous = bars[index];
      const key = trendDateKey(previous.time, interval) + '|' + trendDateKey(bar.time, interval);
      return [key, bar.close / previous.close - 1];
    });
    return new Map(changes);
  });
  const dates = [...returnsByAsset[0].keys()].filter(key => returnsByAsset.every(series => series.has(key)));
  const count = dates.length;
  if (count < 20) return {count};
  const series = returnsByAsset.map(asset => dates.map(key => asset.get(key)));
  const combined = dates.map((_, i) => positions.reduce((sum, {weight}, j) => sum + weight * series[j][i], 0));
  const average = values => values.reduce((sum, value) => sum + value, 0) / count;
  const mean = average(combined);
  const variance = combined.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1);
  const contributions = series.map((values, j) => {
    const assetMean = average(values);
    const covariance = values.reduce((sum, value, i) => sum + (value - assetMean) * (combined[i] - mean), 0) / (count - 1);
    return variance > 0 ? positions[j].weight * covariance / variance : null;
  });
  return {count, mean, volatility:Math.sqrt(variance), cash:Math.max(0, 1 - totalWeight), contributions};
}

function historicalRisk(bars, referenceBars = [], interval, invertReference = false) {
  if (bars.length < 3) return null;
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const changes = series => series.slice(1).map((bar, index) => ({
    from:trendDateKey(series[index].time, interval), to:trendDateKey(bar.time, interval),
    previous:series[index].close, close:bar.close
  }));
  const assetChanges = changes(bars);
  const returns = assetChanges.map(({previous, close}) => close / previous - 1);
  const average = mean(returns);
  let peak = bars[0].close;
  let drawdown = 0;
  for (const bar of bars) {
    peak = Math.max(peak, bar.close);
    drawdown = Math.min(drawdown, bar.close / peak - 1);
  }
  const deviations = returns.map(value => (value - average) ** 2);
  const referenceReturns = new Map(changes(referenceBars).map(({from, to, previous, close}) =>
    [to, {from, value:(invertReference ? previous / close : close / previous) - 1}]));
  const pairs = assetChanges.flatMap(({from, to}, index) => {
    const reference = referenceReturns.get(to);
    return reference?.from === from ? [[returns[index], reference.value]] : [];
  });
  const result = {
    from:bars[0].time, to:bars.at(-1).time, count:returns.length,
    total:bars.at(-1).close / bars[0].close - 1, average, drawdown,
    volatility:Math.sqrt(mean(deviations) * returns.length / (returns.length - 1)),
    matched:pairs.length, beta:null, correlation:null
  };
  if (pairs.length < 20) return result;
  const assetMean = mean(pairs.map(([asset]) => asset));
  const referenceMean = mean(pairs.map(([, reference]) => reference));
  const assetVariance = mean(pairs.map(([asset]) => (asset - assetMean) ** 2));
  const referenceVariance = mean(pairs.map(([, reference]) => (reference - referenceMean) ** 2));
  if (referenceVariance <= 1e-14) return result;
  const covariance = mean(pairs.map(([asset, reference]) => (asset - assetMean) * (reference - referenceMean)));
  result.beta = covariance / referenceVariance;
  if (assetVariance > 1e-14) result.correlation = covariance / Math.sqrt(assetVariance * referenceVariance);
  return result;
}

function meanReversion(bars) {
  const windowSize = 20;
  const average = values => values.reduce((sum,value)=>sum+value,0)/values.length;
  const series = bars.slice(windowSize).map((bar,index)=>{
    const prior = bars.slice(index,index+windowSize).map(item=>item.close);
    const mean = average(prior);
    const deviation = Math.sqrt(average(prior.map(price=>(price-mean)**2)));
    return {close:bar.close, mean, deviation, relative:bar.close/mean-1};
  });
  const latest = series.at(-1);
  const result = {latest, evidence:false};
  if (!latest) return {...result, reason:'Se necesitan al menos 21 velas cerradas para medir la desviación.'};
  result.z = latest.deviation > 0 ? (latest.close-latest.mean)/latest.deviation : null;
  const pairs = series.slice(1).map((point,index)=>[series[index].relative,point.relative]);
  const split = Math.floor(pairs.length*.6);
  const train = pairs.slice(0,split);
  const test = pairs.slice(split);
  if (train.length < 20 || test.length < 10) {
    return {...result, reason:'Hay ' + train.length + ' pares de ajuste y ' + test.length
      + ' de prueba. Se necesitan al menos 20 y 10, respectivamente.'};
  }
  const meanX = average(train.map(([x])=>x));
  const meanY = average(train.map(([,y])=>y));
  const covariance = average(train.map(([x,y])=>(x-meanX)*(y-meanY)));
  const variance = average(train.map(([x])=>(x-meanX)**2));
  if (variance <= 1e-14) return {...result, reason:'Las desviaciones del tramo de ajuste son prácticamente constantes.'};
  const phi = covariance/variance;
  const alpha = meanY-phi*meanX;
  const next = alpha+phi*latest.relative;
  const modelError = average(test.map(([x,y])=>Math.abs(y-(alpha+phi*x))));
  const baselineError = average(test.map(([x,y])=>Math.abs(y-x)));
  const gradual = phi > 0 && phi < 1;
  const evidence = gradual && modelError < baselineError;
  return {...result, phi, alpha, next, covariance, variance,
    equilibrium:gradual ? alpha/(1-phi) : null,
    halfLife:gradual ? Math.log(.5)/Math.log(phi) : null,
    modelError, baselineError, trainCount:train.length, testCount:test.length, evidence,
    reason:!gradual ? 'El coeficiente está fuera del intervalo (0, 1) de reversión gradual.'
      : !evidence ? 'El modelo no mejora al supuesto de persistencia en el tramo posterior.'
      : 'El modelo estima reversión gradual y obtiene menor error en el tramo posterior.'};
}

function pairAnalysis(assetBars, referenceBars, interval, invert = false) {
  const dates = new Map(referenceBars.map(bar=>[trendDateKey(bar.time,interval),bar.close]));
  const aligned = assetBars.flatMap(bar=>{
    const reference = dates.get(trendDateKey(bar.time,interval));
    return reference === undefined ? [] : [[Math.log(reference)*(invert ? -1 : 1),Math.log(bar.close)]];
  });
  const count = aligned.length;
  const split = Math.floor(count*.6);
  const testCount = count-split;
  const unavailable = reason => ({count, evidence:false, reason});
  if (split < 30 || testCount < 20) {
    return unavailable('Hay ' + count + ' cierres comunes. Se necesitan al menos 30 de ajuste y 20 de prueba.');
  }
  const average = values=>values.reduce((sum,value)=>sum+value,0)/values.length;
  const fit = rows=>{
    const xMean = average(rows.map(([x])=>x));
    const yMean = average(rows.map(([,y])=>y));
    const covariance = average(rows.map(([x,y])=>(x-xMean)*(y-yMean)));
    const xVariance = average(rows.map(([x])=>(x-xMean)**2));
    const yVariance = average(rows.map(([,y])=>(y-yMean)**2));
    if (xVariance <= 1e-14) return null;
    const beta = covariance/xVariance;
    return {alpha:yMean-beta*xMean, beta, covariance, xVariance,
      correlation:yVariance > 1e-14 ? covariance/Math.sqrt(xVariance*yVariance) : null};
  };
  const hedge = fit(aligned.slice(0,split));
  if (!hedge) return unavailable('La referencia apenas varía en el tramo de ajuste.');
  const spread = aligned.map(([x,y])=>y-(hedge.alpha+hedge.beta*x));
  const initial = spread.slice(0,split);
  const spreadMean = average(initial);
  const spreadSd = Math.sqrt(average(initial.map(value=>(value-spreadMean)**2)));
  const current = spread.at(-1);
  const z = spreadSd > 1e-7 ? (current-spreadMean)/spreadSd : null;
  const transitions = spread.slice(1).map((y,i)=>[spread[i],y]);
  const model = fit(transitions.slice(0,split-1));
  const evaluation = transitions.slice(split-1);
  const benchmarkError = average(evaluation.map(([x,y])=>Math.abs(y-x)));
  const modelError = model ? average(evaluation.map(([x,y])=>Math.abs(y-(model.alpha+model.beta*x)))) : null;
  const phi = model?.beta ?? null;
  const stable = phi !== null && Math.abs(phi) < 1;
  const improves = modelError !== null && modelError < benchmarkError;
  const evidence = stable && improves;
  const pattern = phi === null ? null : phi < 0 ? 'oscilante' : phi === 0 ? 'inmediata según el modelo' : 'gradual';
  const returns = aligned.slice(1).map(([x,y],i)=>[x-aligned[i][0],y-aligned[i][1]]);
  const correlation = fit(returns)?.correlation ?? null;
  return {count, split, testCount, hedge, current, spreadMean, spreadSd, z, correlation,
    last:aligned.at(-1), phi, modelError, benchmarkError, stable, improves, evidence,
    reason:!model ? 'El diferencial del tramo de ajuste es prácticamente constante.'
      : evidence ? 'El ajuste estima reversión ' + pattern + ' y mejora a la persistencia en el tramo posterior.'
      : !stable && !improves ? 'El coeficiente no indica un ajuste estable y el error no mejora a la persistencia.'
      : !stable ? 'El error mejora a la persistencia, pero el coeficiente queda fuera del intervalo estable (−1, 1).'
      : 'El coeficiente está en el intervalo estable (−1, 1), pero el modelo no mejora a la persistencia en el tramo posterior.'};
}

function microstructure(bars, quote, market) {
  const recent = bars.slice(-20);
  const valid = bar => Number.isFinite(bar.volume) && bar.volume >= 0
    && bar.low > 0 && bar.high >= bar.close && bar.close >= bar.low;
  const volume = recent.reduce((sum,bar)=>sum+bar.volume,0);
  const weighted = recent.reduce((sum,bar)=>sum+(bar.high+bar.low+bar.close)/3*bar.volume,0);
  const candleProxy = market !== 'Forex' && recent.length===20 && recent.every(valid) && volume>0
    ? {volume, weighted, mean:weighted/volume} : null;
  const volumeWindow = bars.slice(-21).map(bar=>bar.volume);
  const priorVolume = volumeWindow.slice(0,-1).reduce((sum,value)=>sum+value,0)/20;
  const relativeVolume = market !== 'Forex' && volumeWindow.length===21
    && volumeWindow.every(value=>Number.isFinite(value) && value>=0) && priorVolume>0
    ? {latest:volumeWindow.at(-1), previousMean:priorVolume, ratio:volumeWindow.at(-1)/priorVolume} : null;
  const bid = Number(quote?.bid), ask = Number(quote?.ask);
  if (quote?.reason || !Number.isFinite(bid) || !Number.isFinite(ask) || bid<=0 || ask<bid) {
    return {candleProxy, relativeVolume, book:null, reason:quote?.reason ?? 'Bid y ask ausentes o incoherentes.'};
  }
  const middle = (bid+ask)/2;
  const spread = ask-bid;
  const bidSize = Number(quote.bidSize), askSize = Number(quote.askSize);
  const size = Number.isFinite(bidSize) && Number.isFinite(askSize) && bidSize>0 && askSize>0;
  return {candleProxy, relativeVolume, book:{bid,ask,middle,spread,bps:spread/middle*10000,bidSize,askSize,
    imbalance:size ? (bidSize-askSize)/(bidSize+askSize) : null,
    microprice:size ? (ask*bidSize+bid*askSize)/(bidSize+askSize) : null}};
}

function executionSchedule(bars, quantity, periods, participation, market) {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(periods)
    || periods < 1 || periods > 30 || !Number.isFinite(participation)
    || participation <= 0 || participation > 100) return null;
  const replay = bars.slice(-periods);
  if (replay.length !== periods || !replay.every(bar => Number.isFinite(bar.close) && bar.close > 0)) return null;
  const reference = bars.slice(-2 * periods, -periods);
  const hasVolume = window => market !== 'Forex' && window.length === periods
    && window.every(bar => Number.isFinite(bar.volume) && bar.volume >= 0);
  const referenceVolume = reference.reduce((sum, bar) => sum + bar.volume, 0);
  const summarize = allocations => {
    const filled = allocations.reduce((sum, amount) => sum + amount, 0);
    const value = replay.reduce((sum, bar, index) => sum + bar.close * allocations[index], 0);
    return {filled, pending: Math.max(0, quantity - filled), mean: filled > 0 ? value / filled : null};
  };
  const twap = summarize(replay.map(() => quantity / periods));
  const vwap = hasVolume(reference) && referenceVolume > 0
    ? summarize(reference.map(bar => quantity * (bar.volume / referenceVolume))) : null;
  let remaining = quantity;
  const pov = hasVolume(replay) ? summarize(replay.map(bar => {
    const amount = Math.min(remaining, bar.volume * (participation / 100));
    remaining -= amount;
    return amount;
  })) : null;
  return {twap, vwap, pov};
}

function closedPositionReview(positions, bars) {
  const valid = positions.filter(position => position
    && [position.units, position.entry, position.exit].every(value => Number.isFinite(value) && value > 0)
    && Number.isFinite(position.entryTime) && Number.isFinite(position.exitTime)
    && position.entryTime < position.exitTime
    && Number.isFinite(position.units * (position.exit - position.entry)));
  if (!valid.length) return null;
  const pnl = valid.map(position => (position.exit - position.entry) * position.units);
  const wins = pnl.filter(value => value > 0);
  const losses = pnl.filter(value => value < 0);
  const gains = wins.reduce((sum, value) => sum + value, 0);
  const lost = -losses.reduce((sum, value) => sum + value, 0);
  const last = valid.at(-1);
  const path = bars.filter(bar => bar.time >= last.entryTime && bar.time <= last.exitTime);
  const excursions = path[0]?.time === last.entryTime && path.at(-1)?.time === last.exitTime
    ? path.slice(1, -1).reduce((range, bar) => {
      const move = bar.close / last.entry - 1;
      return {favorable:Math.max(range.favorable, move), adverse:Math.max(range.adverse, -move)};
    }, {favorable:Math.max(0, last.exit / last.entry - 1), adverse:Math.max(0, 1 - last.exit / last.entry)})
    : null;
  return {count:valid.length, wins:wins.length, losses:losses.length, total:gains - lost,
    expectancy:(gains - lost) / valid.length, profitFactor:lost > 0 ? gains / lost : null,
    lastReturn:last.exit / last.entry - 1, excursions};
}

if (typeof module !== 'undefined') module.exports = {
  evaluateQuantDecision, normalizeStrategy, integratedVerdict, auditForecastInputs, prepareForecastSeries, commonForecast, recordForecast, trendReferences, relativeMomentum, meanReversion, pairAnalysis, microstructure, historicalRisk, technicalAlpha, returnDistribution, monteCarloScenarios, backtestUncertainty, forecastEvaluation, strategyRisk, virtualPositionSize, portfolioRisk, executionScenario, executionSchedule, closedPositionReview
};
