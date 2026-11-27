"""Build a per-pair report for the GitHub Actions run summary."""
import json
from collections import defaultdict
from statistics import mean


def summarize_signals(db, mark, policy, pairs, now, deadline):
    rows = db.execute(f"""
        SELECT s.symbol, s.recorded_at, s.snapshot, o.outcome
        FROM hourly_signals s
        LEFT JOIN hourly_signal_outcomes o
          ON o.symbol = s.symbol AND o.session = s.session AND o.policy = {mark}
    """, (policy,))
    counts = defaultdict(lambda: [0, 0, 0, 0])
    returns = defaultdict(list)
    latest = {}
    for symbol, recorded_at, raw_snapshot, raw_outcome in rows:
        latest[symbol] = max(recorded_at, latest.get(symbol, ''))
        counts[symbol][0] += 1
        if raw_outcome is None:
            counts[symbol][2 if deadline(recorded_at) > now else 3] += 1
            continue
        counts[symbol][1] += 1
        snapshot = json.loads(raw_snapshot)
        outcome = json.loads(raw_outcome)
        features = snapshot['features']
        net = outcome['net_long_return']
        returns[symbol].append((
            outcome['signal'], net, outcome['sell_vs_hold_gross'],
            features['close'] > features['sma20'],
        ))

    report = []
    for pair in pairs:
        results = returns[pair]
        buys = [net for signal, net, _, _ in results if signal == 'buy']
        waits = [net for signal, net, _, _ in results if signal == 'wait']
        sells = [edge for signal, _, edge, _ in results if signal == 'sell']
        report.append({
            'pair': pair, 'latest': latest.get(pair),
            **dict(zip(('signals', 'evaluated', 'pending', 'overdue'), counts[pair])),
            'buys': len(buys), 'buy_mean': mean(buys) if buys else None,
            'waits': len(waits), 'missed': sum(net > 0 for net in waits),
            'sells': len(sells), 'favorable_exits': sum(edge > 0 for edge in sells),
            'motor': mean(net if signal == 'buy' else 0 for signal, net, _, _ in results) if results else None,
            'baseline': mean(net if above else 0 for _, net, _, above in results) if results else None,
        })
    return report


def build_report(db, mark, policy, pairs, now, deadline):
    report = summarize_signals(db, mark, policy, pairs, now, deadline)
    lines = [
        '## Evaluación de señales',
        '',
        f'Corte UTC: {now:%Y-%m-%d %H:%M}. Política: `{policy}`.',
        '',
        '| Par | Señales | Evaluadas | En plazo | Vencidas sin resultado |',
        '|---|---:|---:|---:|---:|',
    ]
    for row in report:
        cells = (row['pair'], row['signals'], row['evaluated'], row['pending'], row['overdue'])
        lines.append('| ' + ' | '.join(map(str, cells)) + ' |')
    lines.extend([
        '',
        '| Par | Comprar: media neta y n | Esperar: compras rentables omitidas | Vender: salidas favorables | Motor: media por caso | Media 20: media por caso |',
        '|---|---:|---:|---:|---:|---:|',
    ])
    for row in report:
        buy_mean = f"{row['buy_mean']:+.2%} ({row['buys']})" if row['buys'] else '—'
        missed = f"{row['missed']}/{row['waits']}" if row['waits'] else '—'
        exits = f"{row['favorable_exits']}/{row['sells']}" if row['sells'] else '—'
        motor = f"{row['motor']:+.2%}" if row['evaluated'] else '—'
        baseline = f"{row['baseline']:+.2%}" if row['evaluated'] else '—'
        lines.append(f"| {row['pair']} | {buy_mean} | {missed} | {exits} | {motor} | {baseline} |")
    lines.extend([
        '',
        'La comparación puntúa entradas largas sobre los mismos casos evaluados. Sin entrada, el resultado es cero.',
        'Las ventanas se pueden solapar. Las medias por caso no representan el rendimiento de una cartera.',
        'Las salidas favorables se comparan en bruto con mantener la posición.',
    ])
    return '\n'.join(lines) + '\n'
