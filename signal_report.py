"""Build a per-pair report for the GitHub Actions run summary."""
import json
from collections import defaultdict
from statistics import mean


def build_report(db, mark, policy, pairs, now, deadline):
    rows = db.execute(f"""
        SELECT s.symbol, s.recorded_at, s.snapshot, o.outcome
        FROM hourly_signals s
        LEFT JOIN hourly_signal_outcomes o
          ON o.symbol = s.symbol AND o.session = s.session AND o.policy = {mark}
    """, (policy,))
    counts = defaultdict(lambda: [0, 0, 0, 0])
    returns = defaultdict(list)
    for symbol, recorded_at, raw_snapshot, raw_outcome in rows:
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

    lines = [
        '## Evaluación de señales',
        '',
        f'Corte UTC: {now:%Y-%m-%d %H:%M}. Política: `{policy}`.',
        '',
        '| Par | Señales | Evaluadas | En plazo | Vencidas sin resultado |',
        '|---|---:|---:|---:|---:|',
    ]
    for pair in pairs:
        lines.append('| ' + ' | '.join([pair, *map(str, counts[pair])]) + ' |')
    lines.extend([
        '',
        '| Par | Comprar: media neta y n | Esperar: compras rentables omitidas | Vender: salidas favorables | Motor: media por caso | Media 20: media por caso |',
        '|---|---:|---:|---:|---:|---:|',
    ])
    for pair in pairs:
        results = returns[pair]
        buys = [net for signal, net, _, _ in results if signal == 'buy']
        waits = [net for signal, net, _, _ in results if signal == 'wait']
        sells = [edge for signal, _, edge, _ in results if signal == 'sell']
        buy_mean = f'{mean(buys):+.2%} ({len(buys)})' if buys else '—'
        missed = f'{sum(net > 0 for net in waits)}/{len(waits)}' if waits else '—'
        exits = f'{sum(edge > 0 for edge in sells)}/{len(sells)}' if sells else '—'
        motor = f'{mean(net if signal == "buy" else 0 for signal, net, _, _ in results):+.2%}' if results else '—'
        baseline = f'{mean(net if above else 0 for _, net, _, above in results):+.2%}' if results else '—'
        lines.append(f'| {pair} | {buy_mean} | {missed} | {exits} | {motor} | {baseline} |')
    lines.extend([
        '',
        'La comparación puntúa entradas largas sobre los mismos casos evaluados. Sin entrada, el resultado es cero.',
        'Las ventanas se pueden solapar. Las medias por caso no representan el rendimiento de una cartera.',
        'Las salidas favorables se comparan en bruto con mantener la posición.',
    ])
    return '\n'.join(lines) + '\n'
