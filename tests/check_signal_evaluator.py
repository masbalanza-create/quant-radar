import json
import sqlite3
import unittest
from contextlib import closing
from datetime import datetime, timedelta

from signal_evaluator import evaluate_pending


class SignalEvaluatorChecks(unittest.TestCase):
    def test_wait_outcome_uses_only_consecutive_post_signal_bars(self):
        delay = timedelta(minutes=5)
        with closing(sqlite3.connect(':memory:')) as db:
            db.execute('CREATE TABLE hourly_signals (symbol, session, recorded_at, snapshot)')
            db.execute('CREATE TABLE hourly_candles (symbol, provider, bar_start, candle)')
            db.execute('INSERT INTO hourly_signals VALUES (?, ?, ?, ?)', (
                'BTC/USD', '2026-11-26T09:00:00+00:00', '2026-11-26T10:12:00+00:00',
                json.dumps({'decision': {'state': 'wait'}, 'market_data': {'source': 'Kraken'}})))
            for hour in (10, 11, 12, 14):
                db.execute('INSERT INTO hourly_candles VALUES (?, ?, ?, ?)', (
                    'BTC/USD', 'Kraken', f'2026-11-26T{hour}:00:00+00:00',
                    json.dumps({'open': 200 if hour == 10 else 100, 'close': 105})))
            early = datetime.fromisoformat('2026-11-26T15:04:00+00:00')
            self.assertEqual(evaluate_pending(db, '?', early, delay)['evaluated'], 0)
            ready = early + timedelta(minutes=1)
            self.assertEqual(evaluate_pending(db, '?', ready, delay)['missing_candles'], 1)
            db.execute('INSERT INTO hourly_candles VALUES (?, ?, ?, ?)', (
                'BTC/USD', 'Kraken', '2026-11-26T13:00:00+00:00', '{}'))
            self.assertEqual(evaluate_pending(db, '?', ready, delay)['evaluated'], 1)
            self.assertEqual(evaluate_pending(db, '?', ready, delay)['evaluated'], 0)
            outcome = json.loads(db.execute('SELECT outcome FROM hourly_signal_outcomes').fetchone()[0])
            self.assertEqual(outcome['entry_price'], 100)
            self.assertAlmostEqual(outcome['missed_long_gain'], 0.048)
