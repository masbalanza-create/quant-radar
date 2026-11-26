"""Evaluate recorded hourly signals without submitting orders."""
import json
import math
from contextlib import closing
from datetime import datetime, timedelta

HOUR = timedelta(hours=1)
HORIZON = 4
ROUND_TRIP_COST = 0.002
POLICY = 'four-hour-long-v1'


def evaluation_window(recorded_at):
    recorded = datetime.fromisoformat(recorded_at)
    entry = recorded.replace(minute=0, second=0, microsecond=0)
    if entry < recorded:
        entry += HOUR
    return entry, entry + HOUR * HORIZON


def evaluate_pending(db, mark, now, publication_delay):
    db.execute("""
        CREATE TABLE IF NOT EXISTS hourly_signal_outcomes (
            symbol TEXT NOT NULL, session TEXT NOT NULL, policy TEXT NOT NULL,
            evaluated_at TEXT NOT NULL, outcome TEXT NOT NULL,
            PRIMARY KEY (symbol, session, policy)
        )
    """)
    cutoff = (now - publication_delay - HOUR * HORIZON).isoformat()
    signals = db.execute(f"""
        SELECT s.symbol, s.session, s.recorded_at, s.snapshot
        FROM hourly_signals s
        WHERE s.recorded_at <= {mark} AND NOT EXISTS (
            SELECT 1 FROM hourly_signal_outcomes o
            WHERE o.symbol = s.symbol AND o.session = s.session AND o.policy = {mark}
        )
    """, (cutoff, POLICY)).fetchall()
    summary = {'evaluated': 0, 'missing_candles': 0}
    with closing(db.cursor()) as cursor:
        for symbol, session, recorded_at, raw in signals:
            entry, end = evaluation_window(recorded_at)
            if end + publication_delay > now:
                continue
            snapshot = json.loads(raw)
            source = snapshot['market_data']
            provider = source.get('source') or source['quality']
            cursor.execute(f"""
                SELECT bar_start, candle FROM hourly_candles
                WHERE symbol = {mark} AND provider = {mark}
                  AND bar_start >= {mark} AND bar_start < {mark}
                ORDER BY bar_start
            """, (symbol, provider, entry.isoformat(), end.isoformat()))
            rows = cursor.fetchall()
            expected = [(entry + HOUR * i).isoformat() for i in range(HORIZON)]
            if [date for date, _ in rows] != expected:
                summary['missing_candles'] += 1
                continue
            try:
                entry_price = float(json.loads(rows[0][1])['open'])
                exit_price = float(json.loads(rows[-1][1])['close'])
            except (KeyError, TypeError, ValueError):
                summary['missing_candles'] += 1
                continue
            if not all(math.isfinite(price) and price > 0 for price in (entry_price, exit_price)):
                summary['missing_candles'] += 1
                continue
            gross = exit_price / entry_price - 1
            net = gross - ROUND_TRIP_COST
            signal = snapshot['decision']['state']
            outcome = {
                'signal': signal, 'entry_at': entry.isoformat(), 'exit_at': end.isoformat(),
                'entry_price': entry_price, 'exit_price': exit_price, 'currency': source.get('currency'),
                'gross_long_return': gross, 'net_long_return': net,
                'round_trip_cost': ROUND_TRIP_COST,
                'missed_long_gain': max(net, 0) if signal == 'wait' else None,
                'sell_vs_hold_gross': -gross if signal == 'sell' else None,
            }
            cursor.execute(f"""
                INSERT INTO hourly_signal_outcomes VALUES ({", ".join([mark] * 5)})
                ON CONFLICT(symbol, session, policy) DO NOTHING
            """, (symbol, session, POLICY, now.isoformat(), json.dumps(outcome, allow_nan=False)))
            summary['evaluated'] += cursor.rowcount
    return summary
