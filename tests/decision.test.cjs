const assert = require('node:assert/strict');
const test = require('node:test');
const { auditForecastInputs, evaluateQuantDecision, integratedVerdict } = require('../decision.js');

const profile = { capital: 10_000, limit: 10 };
const sizing = { lossBudget: 40, stop: 5, cash: 500, exposure: 0 };
const report = {
  usable: true,
  longSignal: true,
  uncertainty: { interval: [0.01, 0.03] },
  historicalTest: { meanGrossReturn: 0.03 }
};
const cases = [
  ['Comprar', 'buy', report, 'buy', 1, 5],
  ['Vender', 'sell', { ...report, exitSignal: true }, 'sell', null, 0],
  ['Esperar', 'hold', report, 'buy', 3, 0],
  ['Datos insuficientes', 'pending', report, 'buy', null, 0],
  ['Mercado cerrado', 'pending', { ...report, usable: false, dataReason: 'mercado cerrado' }, 'buy', 1, 0]
];
for (const [stance, action, input, signal, cost, percent] of cases) {
  test(stance, () => {
    const result = integratedVerdict(input, signal, cost, profile, sizing);
    assert.deepEqual([result.stance, result.action, result.percent], [stance, action, percent]);
    assert.ok(result.reason);
  });
}

test('El motor usa la duración de la vela y detecta la señal histórica', () => {
  const data = [{ datetime:'2025-01-01T00:00:00Z', close:100 }];
  const report = auditForecastInputs(data, { interval:'1day', now:Date.parse('2025-01-01T12:00:00Z') });
  assert.equal(report.open, 1);
  assert.equal(evaluateQuantDecision(Array.from({ length: 40 }, (_, i) => i + 100), {}).longSignal, true);
});
