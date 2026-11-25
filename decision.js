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
  // Fixed exploratory rule. At close t, use only observations through t.
  // Enter at the next observed close and evaluate one bar later.
  const cutoff = Math.max(19, Math.floor(prices.length * 0.6));
  const observations = [];
  const benchmark = [];
  const trades = [];
  for (let t = cutoff; t + 2 < prices.length; t += 2) {
    const window = prices.slice(t - 19, t + 1);
    const mean = window.reduce((sum, price) => sum + price, 0) / window.length;
    const gross = prices[t + 2] / prices[t + 1] - 1;
    benchmark.push(gross);
    if (prices[t] > mean && prices[t] > prices[t - 10]) {
      observations.push(gross);
      trades.push({index: t, entry: prices[t + 1], exit: prices[t + 2], gross});
    }
  }
  const sum = observations.reduce((total, value) => total + value, 0);
  const mean = observations.length ? sum / observations.length : null;
  const benchmarkMean = benchmark.length
    ? benchmark.reduce((total, value) => total + value, 0) / benchmark.length : null;
  const positive = observations.filter(value => value > 0).length;
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
    ['Validación', benchmark.length ? 'comparación exploratoria' : 'histórico insuficiente', 'Se compara la regla con entrar en todas las fechas de evaluación del mismo activo. Faltan robustez e incertidumbre estadística.'],
    ['Costes y utilidad', 'simulación disponible', 'El coste de la operación se puede introducir como supuesto.'],
    ['Riesgo y cartera', profile ? 'tope calculado' : 'requiere perfil', concentration + 'Faltan posiciones, otros límites de exposición y escenarios de estrés verificados.'],
    ['Ejecución y seguimiento', 'por implementar', 'Faltan condiciones verificadas de entrada, salida y seguimiento.']
  ];
  return {
    action: 'hold',
    label: state.usable ? 'No operar · validación pendiente' : 'No operar · ' + state.dataReason,
    checks,
    historicalTest: {observations: observations.length, meanGrossReturn: mean, sumGrossReturn: sum, cutoff, benchmarkCount: benchmark.length, benchmarkMean, positive, trades, p10: quantile(.1), p90: quantile(.9)}
  };
}

function virtualOpinion(report, signal) {
  const history = report.historicalTest;
  if (signal === 'sell') {
    return {
      stance: 'Reduciría si ya tuviera una posición virtual',
      reason: 'La puntuación conjunta está en 35/100 o menos. La prueba histórica evalúa entradas largas, así que esta opinión se basa en la debilidad de la señal actual.'
    };
  }
  if (history.meanGrossReturn !== null && history.meanGrossReturn <= 0) {
    return {
      stance: 'Evitaría abrir una posición virtual',
      reason: 'La regla de entrada obtuvo una media histórica bruta del '
        + (history.meanGrossReturn * 100).toLocaleString('es-ES', {maximumFractionDigits: 3})
        + '%. Los costes no mejoran ese resultado.'
    };
  }
  if (signal === 'buy' && history.meanGrossReturn > history.benchmarkMean) {
    return {
      stance: 'Probaría una compra en simulación',
      reason: 'La señal técnica es favorable y la regla superó la referencia bruta en '
        + ((history.meanGrossReturn - history.benchmarkMean) * 100).toLocaleString('es-ES', {maximumFractionDigits: 3})
        + ' puntos porcentuales en ' + history.observations + ' operaciones exploratorias.'
    };
  }
  if (signal === 'buy') {
    return {stance: 'Esperaría antes de comprar', reason: 'La señal actual es favorable, pero la prueba exploratoria no demuestra una ventaja frente a la referencia.'};
  }
  return {stance: 'Mantendría lo que ya tengo en simulación', reason: 'La señal actual no alcanza los criterios de compra ni de reducción. Si partiera de cero, no abriría una posición.'};
}

const forecastMinutes = {'1min':1,'5min':5,'15min':15,'30min':30,'1h':60,'1day':1440,'1week':10080};

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

function technicalAlpha(bars) {
  const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const prices = bars.map(bar => bar.close);
  const features = prices.slice(9).map((close, offset) => {
    const index = offset + 9;
    return [close / prices[index - 1] - 1, close / prices[index - 5] - 1,
      close / average(prices.slice(index - 9, index + 1)) - 1];
  });
  const targets = prices.slice(10).map((close, index) => close / prices[index + 9] - 1);
  const split = Math.floor(targets.length * 0.7);
  if (split < 30 || targets.length - split < 12) return null;
  const training = features.slice(0, split);
  const columns = [0, 1, 2];
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

if (typeof module !== 'undefined') module.exports = {
  evaluateQuantDecision, normalizeStrategy, virtualOpinion, auditForecastInputs, prepareForecastSeries, commonForecast, recordForecast, trendReferences, relativeMomentum, meanReversion, pairAnalysis, microstructure, historicalRisk, technicalAlpha
};
