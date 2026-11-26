"""Deterministic USD valuation for the Quant Radar equity universe."""
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import json
from math import isfinite
from statistics import median
from zoneinfo import ZoneInfo

VERSION = '1.0.0'
NY = ZoneInfo('America/New_York')
SCENARIOS = (
    ('prudente', -.03, -.02, .01, .015, .10),
    ('base', 0, 0, 0, .02, .12),
    ('favorable', .03, .02, -.01, .025, .14),
)


def number(value):
    return type(value) in (float, int) and isfinite(value)


def project(inputs, growth, margin, wacc, terminal_growth, terminal_roic, fixed_years=None):
    if (not -.15 <= growth <= .25 or margin <= 0 or wacc - terminal_growth < .01 - 1e-12
            or terminal_roic <= 0 or not 0 <= terminal_growth / terminal_roic <= 1):
        raise ValueError('Supuestos fuera del dominio del modelo')
    sales, working_capital = inputs['sales'], inputs['working_capital']
    years = []
    for year in range(1, 6):
        rate = growth + (terminal_growth - growth) * (year - 1) / 4
        sales *= 1 + rate
        nopat = sales * margin * (1 - inputs['tax'])
        da, capex = (sales * inputs[key] for key in ('da_ratio', 'capex_ratio'))
        next_wc = sales * inputs['wc_ratio']
        change = next_wc - working_capital
        working_capital = next_wc
        years.append(dict(year=year, growth=rate, sales=sales, ebit=sales * margin, nopat=nopat,
                          da=da, capex=capex, delta_onwc=change, fcff=nopat + da - capex - change))
    if fixed_years is not None:
        years = [{**row} for row in fixed_years]
    for row in years:
        row['pv'] = row['fcff'] / (1 + wacc) ** row['year']
    terminal_nopat = years[-1]['sales'] * (1 + terminal_growth) * margin * (1 - inputs['tax'])
    terminal_reinvestment = terminal_nopat * terminal_growth / terminal_roic
    terminal_fcff = terminal_nopat - terminal_reinvestment
    terminal = terminal_fcff / (wacc - terminal_growth)
    pv_terminal = terminal / (1 + wacc) ** 5
    ev = sum(row['pv'] for row in years) + pv_terminal
    bridge = inputs['bridge']
    equity = ev + bridge['cash'] + bridge['investments'] - sum(
        bridge[key] for key in ('debt', 'preferred', 'minorities', 'other_claims'))
    value = equity / inputs['shares'] if equity >= 0 else None
    price = inputs['price']
    return dict(growth=growth, margin=margin, wacc=wacc, terminal_growth=terminal_growth,
                terminal_roic=terminal_roic, years=years, terminal_nopat=terminal_nopat,
                terminal_reinvestment=terminal_reinvestment, terminal_fcff=terminal_fcff,
                terminal_value=terminal, pv_terminal=pv_terminal, enterprise_value=ev,
                terminal_weight=pv_terminal / ev if ev > 0 else None, bridge=bridge,
                equity_value=equity, value_per_share=value,
                upside=value / price - 1 if value is not None else None,
                margin_of_safety=1 - price / value if value else None)


def calculate(inputs):
    scenarios = {}
    errors = []
    for name, growth_shift, margin_shift, wacc_shift, terminal_growth, roic in SCENARIOS:
        try:
            scenarios[name] = project(inputs, inputs['growth'] + growth_shift,
                                      inputs['margin'] + margin_shift, inputs['wacc'] + wacc_shift,
                                      terminal_growth, roic)
        except ValueError as exc:
            errors.append(dict(code='scenario_invalid', field=name, message=str(exc)))
    base = scenarios.get('base')
    wacc_axis, growth_axis, cells = [], [], []
    reverse = dict(growth=None, reason='Escenario base no disponible')
    if base:
        wacc_axis = [base['wacc'] + step / 100 for step in (-2, -1, 0, 1, 2)]
        growth_axis = [base['terminal_growth'] + step / 100 for step in (-1, -.5, 0, .5, 1)]
        for wacc in wacc_axis:
            row = []
            for growth in growth_axis:
                try:
                    row.append(project(inputs, base['growth'], base['margin'], wacc, growth,
                                       base['terminal_roic'], base['years'])['value_per_share'])
                except ValueError:
                    row.append(None)
            cells.append(row)
        reverse = implied_growth(inputs, base)
    values = [row['value_per_share'] for row in scenarios.values()]
    classification = None
    if len(values) == 3:
        if any(value is None for value in values) or values != sorted(values):
            errors.append(dict(code='invalid_range', field='scenarios',
                               message='El patrimonio es negativo o el rango de escenarios está desordenado.'))
        else:
            classification = ('below_range' if inputs['price'] < values[0] else
                              'above_range' if inputs['price'] > values[-1] else 'within_range')
    return dict(scenarios=scenarios, sensitivity=dict(wacc=wacc_axis, terminal_growth=growth_axis, values=cells),
                reverse_dcf=reverse, classification=classification, reasons=errors)


def implied_growth(inputs, base):
    def gap(growth):
        result = project(inputs, growth, base['margin'], base['wacc'],
                         base['terminal_growth'], base['terminal_roic'])
        return result['equity_value'] / inputs['shares'] - inputs['price']

    grid = [(step / 100, gap(step / 100)) for step in range(-15, 26)]
    if any(a[1] >= b[1] for a, b in zip(grid, grid[1:])) or not grid[0][1] <= 0 <= grid[-1][1]:
        return dict(growth=None, reason='Sin cruce creciente único en el intervalo de búsqueda')
    low, high = grid[0][0], grid[-1][0]
    for _ in range(60):
        middle = (low + high) / 2
        error = gap(middle)
        if abs(error) <= .01:
            return dict(growth=middle, reason=None)
        if error < 0:
            low = middle
        else:
            high = middle
    return dict(growth=None, reason='La búsqueda no alcanzó la tolerancia')


def operating_inputs(years, marginal_tax):
    latest = years[-1]
    ratios = years[-3:]
    taxes = [r['tax_expense'] / r['pretax'] for r in ratios if r['pretax'] and r['pretax'] > 0
             and r['tax_expense'] is not None and 0 <= r['tax_expense'] / r['pretax'] <= .4]
    return dict(sales=latest['sales'], working_capital=latest['onwc'],
                growth=median(b['sales'] / a['sales'] - 1 for a, b in zip(years, years[1:])),
                margin=median(r['ebit'] / r['sales'] for r in ratios),
                da_ratio=median(r['da'] / r['sales'] for r in ratios),
                capex_ratio=median(r['capex'] / r['sales'] for r in ratios),
                wc_ratio=median(r['onwc'] / r['sales'] for r in ratios),
                tax=median(taxes) if len(taxes) >= 2 else marginal_tax)


def cost_of_capital(rf, beta, erp, kd, marginal_tax, equity, debt):
    ke = rf + beta * erp
    return ke, (equity * ke + debt * kd * (1 - marginal_tax)) / (equity + debt)


def weekly_beta(asset, index, cutoff):
    weeks = []
    day = cutoff.astimezone(NY).date()
    monday = day - timedelta(days=day.weekday())
    for offset in range(105, 0, -1):
        start = monday - timedelta(weeks=offset)
        a = max((d for d in asset if start <= d < start + timedelta(days=7)), default=None)
        b = max((d for d in index if start <= d < start + timedelta(days=7)), default=None)
        weeks.append((asset[a], index[b]) if a is not None and a == b else None)
    returns = [(b[0] / a[0] - 1, b[1] / a[1] - 1)
               for a, b in zip(weeks, weeks[1:]) if a is not None and b is not None]
    if len(returns) < 78:
        return None, len(returns)
    x, y = zip(*returns)
    ax, ay = sum(x) / len(x), sum(y) / len(y)
    var = sum((r - ay) ** 2 for r in y)
    beta = sum((a - ax) * (b - ay) for a, b in returns) / var if var else 0
    return (beta if beta > 0 else None), len(returns)


def seal(result):
    payload = json.dumps(result, sort_keys=True, allow_nan=False, ensure_ascii=False)
    return {**result, 'run_id': sha256(payload.encode()).hexdigest()}
