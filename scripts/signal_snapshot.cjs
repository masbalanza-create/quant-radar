const {readFileSync} = require('node:fs');
const {compute, assetDecision} = require('../market-data.js');

const {symbol, market, series} = JSON.parse(readFileSync(0, 'utf8'));
const asset = compute([symbol, symbol, market], series);
const {p, ma, mom, macd, rsi, vol, volumeRatio, atr} = asset;
const decision = assetDecision(null, 'open', asset);
process.stdout.write(JSON.stringify({
  features: {close: p, sma20: ma, momentum10Pct: mom, macd, rsi,
    volatilityPct: vol, volumeRatio, atr},
  decision
}));
