"""Compare two long-only portfolios on the same evaluated crypto signals."""
import json
from collections import defaultdict
from datetime import datetime

from signal_evaluator import POLICY

PAIRS = ('BTC/USD', 'ETH/USD')
STARTING_CASH = 2000
STAKE = 500


def load_simulation(db, mark):
    rows = db.execute(f"""
        SELECT s.symbol, s.snapshot, o.outcome
        FROM hourly_signals s
        JOIN hourly_signal_outcomes o ON o.symbol = s.symbol AND o.session = s.session
        WHERE o.policy = {mark} AND s.symbol IN ({mark}, {mark})
        ORDER BY s.session, s.symbol
    """, (POLICY, *PAIRS))
    entries = []
    for pair, snapshot, outcome in rows:
        features = json.loads(snapshot)['features']
        result = json.loads(outcome)
        entries.append({
            'pair': pair,
            'entry': datetime.fromisoformat(result['entry_at']),
            'exit': datetime.fromisoformat(result['exit_at']),
            'net': result['net_long_return'],
            'motor': result['signal'] == 'buy',
            'baseline': features['close'] > features['sma20'],
        })
    return {
        'cases': len(entries),
        'initial_cash': STARTING_CASH,
        'stake': STAKE,
        'from': min((row['entry'].isoformat() for row in entries), default=None),
        'through': max((row['exit'].isoformat() for row in entries), default=None),
        'motor': simulate(entries, 'motor'),
        'baseline': simulate(entries, 'baseline'),
    }


def simulate(entries, strategy):
    opens = defaultdict(list)
    closes = defaultdict(list)
    for number, row in enumerate(entries):
        if row[strategy]:
            opens[row['entry']].append((number, row))
            closes[row['exit']].append((number, row))

    cash = peak = STARTING_CASH
    drawdown = 0
    trades = 0
    positions = {}
    for timestamp in sorted(opens.keys() | closes.keys()):
        for number, row in closes.get(timestamp, ()):
            pair = row['pair']
            if positions.get(pair) == number:
                del positions[pair]
                cash += STAKE * (1 + row['net'])
                trades += 1
        equity = cash + len(positions) * STAKE
        peak = max(peak, equity)
        drawdown = max(drawdown, 1 - equity / peak)
        for number, row in opens.get(timestamp, ()):
            pair = row['pair']
            if pair not in positions and cash >= STAKE:
                cash -= STAKE
                positions[pair] = number

    return {'net_return': cash / STARTING_CASH - 1, 'closed_drawdown': drawdown,
            'trades': trades}
