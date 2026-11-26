const assert = require('node:assert/strict');
const test = require('node:test');
const {hasFreshIntradayData} = require('../market-data.js');

test('La frescura admite cada horizonte y requiere una vela cerrada', () => {
  const now = Date.parse('2026-11-26T12:00:30Z');
  for (const [interval, minutes] of Object.entries({'1min':1,'5min':5,'15min':15,'30min':30,'1h':60})) {
    const row = {datetime: new Date(now - 30_000 - minutes * 60_000).toISOString(), close: 100};
    const asset = {fetched: now / 1000, meta:{quality:'public_rest', quote_time:now / 1000}, values:[row]};
    assert.equal(hasFreshIntradayData(asset, interval, now), true, interval);
    assert.equal(hasFreshIntradayData({...asset, values:[{...row, datetime:'2026-11-26T12:00:00Z'}]}, interval, now), false);
    assert.equal(hasFreshIntradayData({...asset, meta:{...asset.meta, quote_time:now / 1000 - 90}}, interval, now), false);
  }
});

test('La decisión devuelve comprar, vender o esperar según los datos y la sesión', () => {
  const {assetDecision} = require('../market-data.js');
  const bullish = {p:210, ma:203.32, mom:1, macd:.5};
  const bearish = {p:192.9, ma:203.32, mom:-9.24, macd:-3.55};
  assert.equal(assetDecision(null, 'open', bullish).title, 'Comprar');
  assert.equal(assetDecision({status:'unsupported'}, 'open', bearish).title, 'Vender');
  assert.equal(assetDecision(null, 'open', {...bearish, macd:1}).title, 'Esperar');
  assert.equal(assetDecision(null, 'open', {...bearish, stale:true}).title, 'Esperar');
  assert.equal(assetDecision(null, 'closed', bullish).reason.startsWith('Mercado cerrado'), true);
  assert.equal(assetDecision(null, 'unknown', bullish).title, 'Esperar');
  assert.equal(assetDecision({status:'ok', classification:'above_range'}, 'open', bullish).title, 'Esperar');
  assert.equal(assetDecision({status:'review_required', classification:'above_range'}, 'open', bullish).title, 'Comprar');
});

test('Largo plazo decide por valor, calidad y posición, sin depender del gráfico', () => {
  const {assetDecision} = require('../market-data.js');
  const long = {fundamental:true};
  const quote = {value:70};
  const technical = {p:60, ma:80, mom:-2, macd:-1};
  const report = {status:'ok', quote, scenarios:{prudente:{value_per_share:100,margin_of_safety:.3},
    favorable:{value_per_share:130}}, ratios:{roic_spread:.04, net_debt_ebitda:1}};
  assert.equal(assetDecision(report,'closed',technical,long).title, 'Comprar');
  assert.equal(assetDecision(null,'open',technical,long).title, 'Esperar');
  assert.equal(assetDecision({...report, ratios:{}},'open',technical,long).title,'Esperar');
  const weaker = {...report, ratios:{...report.ratios, roic_spread:-.01}};
  assert.equal(assetDecision(weaker,'open',technical,long).title,'Esperar');
  assert.equal(assetDecision(weaker,'open',technical,{...long,hasPosition:true}).title,'Vender');
  assert.equal(assetDecision({...report, status:'review_required'}, 'open', technical,long).title,'Esperar');
});

test('Largo plazo semanal cubre cripto y los demás instrumentos sin DCF', () => {
  const {assetDecision} = require('../market-data.js');
  const week = 7*86400000;
  const now = Date.parse('2026-11-26T12:00:00Z');
  const bars = sign => Array.from({length:41}, (_,i) => ({
    datetime:new Date(now-(40-i)*week).toISOString(), close:i === 40 ? 5000 : 100+sign*i
  }));
  const options = {fundamental:true, now};
  const unsupported = {status:'unsupported'};
  const rising = {interval:'1week',values:bars(1)};
  const falling = {interval:'1week',values:bars(-1)};
  assert.equal(assetDecision(unsupported,'open',rising,options).title,'Comprar');
  assert.equal(assetDecision(unsupported,'open',falling,options).title,'Esperar');
  const sell = assetDecision(unsupported,'open',falling,{...options,hasPosition:true});
  assert.equal(sell.title,'Vender');
  assert.equal(sell.metrics.close,61);
  assert.equal(assetDecision(null,'open',{...rising,stale:true},options).title,'Esperar');
  assert.equal(assetDecision(null,'open',{...rising,values:rising.values.slice(1)},options).title,'Esperar');
});
