"""Point-in-time input selection for the valuation service."""
import csv
from datetime import date, datetime, time, timedelta, timezone
from io import StringIO
from pathlib import Path
import json
import os
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from valuation import NY, VERSION, calculate, cost_of_capital, number, operating_inputs, seal, weekly_beta

FORMS = {'10-K', '10-K/A', '10-Q', '10-Q/A'}
ANNUAL = {'10-K', '10-K/A'}
TAGS = {
    'sales': ('RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'),
    'ebit': ('OperatingIncomeLoss',),
    'da': ('DepreciationDepletionAndAmortization', 'DepreciationDepletionAndAmortizationPropertyPlantAndEquipment'),
    'capex': ('PaymentsToAcquirePropertyPlantAndEquipment',),
    'cfo': ('NetCashProvidedByUsedInOperatingActivities',),
    'pretax': ('IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',),
    'tax_expense': ('IncomeTaxExpenseBenefit',),
    'net_income': ('NetIncomeLossAvailableToCommonStockholdersBasic', 'NetIncomeLoss'),
    'assets': ('Assets',),
    'equity': ('StockholdersEquity',),
    'eps': ('EarningsPerShareDiluted',),
    'interest': ('InterestExpense', 'InterestAndDebtExpense'),
    'long_operating_assets': ('PropertyPlantAndEquipmentNet',),
    'cash': ('CashAndCashEquivalentsAtCarryingValue',),
    'shares': ('EntityCommonStockSharesOutstanding',),
}
BRIDGE_FIELDS = ('cash_reserve', 'investments', 'debt', 'preferred', 'minorities', 'other_claims',
                 'incremental_shares')
PROFILES = Path('valuation-inputs.json')


class Missing(ValueError):
    def __init__(self, field, message):
        self.field = field
        super().__init__(message)


def parse_cutoff(value):
    if value is None:
        return datetime.now(timezone.utc).replace(microsecond=0)
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None or stamp.utcoffset() != timedelta(0) or stamp > datetime.now(timezone.utc):
        raise ValueError('as_of debe ser una fecha UTC pasada o presente.')
    return stamp.astimezone(timezone.utc)


def acceptance(recent):
    return {acc: datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            for acc, stamp in zip(recent.get('accessionNumber', []), recent.get('acceptanceDateTime', []))
            if stamp and ('+' in stamp or stamp.endswith('Z'))}


def facts_at(payload, accepted, cutoff, cik):
    facts = payload.get('facts') or {}
    selected = {}
    for taxonomy in ('us-gaap', 'dei'):
        for concept, item in facts.get(taxonomy, {}).items():
            unit = 'shares' if concept == TAGS['shares'][0] else 'USD/shares' if concept == TAGS['eps'][0] else 'USD'
            entries = {}
            for row in item.get('units', {}).get(unit, []):
                if row.get('form') not in FORMS or not number(row.get('val')) or not row.get('filed') or not row.get('end'):
                    continue
                acc = row['accn']
                available = accepted.get(acc)
                precise = available is not None
                if available is None:
                    available = datetime.combine(date.fromisoformat(row['filed']) + timedelta(days=1), time(), NY)
                if available > cutoff or row['end'] > cutoff.astimezone(NY).date().isoformat():
                    continue
                available = available.astimezone(timezone.utc)
                key = (row.get('start'), row['end'])
                current = entries.get(key)
                if current is None or (available.isoformat(), acc) > (current['published_at'], current['accession']):
                    entries[key] = dict(value=row['val'], unit=unit, concept=concept, start=key[0],
                                        end=key[1], published_at=available.astimezone(timezone.utc).isoformat(),
                                        filed=row['filed'], accession=acc, form=row['form'],
                                        precision='timestamp' if precise else 'day',
                                        url=f'https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace("-", "")}/{acc}-index.html')
            selected[concept] = entries
    return selected


def read_fact(facts, aliases, end, start=None):
    for alias in aliases:
        if (start, end) in facts.get(alias, {}):
            return facts[alias][start, end]
    return None


def record_at(rows, cutoff, label, period=None):
    candidates = []
    for row in rows:
        stamp = datetime.fromisoformat(row['published_at'].replace('Z', '+00:00'))
        if stamp.tzinfo is None:
            raise Missing(label, 'La entrada revisada necesita fecha de publicación con zona horaria.')
        if stamp <= cutoff and (period is None or row.get('period_end') == period):
            candidates.append((stamp, row))
    return max(candidates, key=lambda pair: pair[0])[1] if candidates else {}


def onwc(end, review):
    # Current totals minus explicitly reviewed non-operating components.
    if number(review.get('onwc')) and review.get('source'):
        return review['onwc'], [review]
    raise Missing('onwc', f'Falta conciliar el circulante operativo del ejercicio {end}.')


def ledger(facts, profile, cutoff):
    annual_keys = {}
    for tag in TAGS['sales']:
        for (start, end), fact in facts.get(tag, {}).items():
            if start and 350 <= (date.fromisoformat(end) - date.fromisoformat(start)).days <= 380:
                if end not in annual_keys or (fact['form'] in ANNUAL and annual_keys[end][1] not in ANNUAL):
                    annual_keys[end] = (start, fact['form'])
    endpoints = sorted(annual_keys)[-4:]
    if len(endpoints) < 4 or any(not 350 <= (date.fromisoformat(b) - date.fromisoformat(a)).days <= 380
                                 for a, b in zip(endpoints, endpoints[1:])):
        raise Missing('annual_history', 'Se necesitan cuatro ejercicios consecutivos comparables.')
    years, sources = [], []
    for end in endpoints:
        start, _ = annual_keys[end]
        row = {'end': end}
        for field in ('sales', 'ebit', 'da', 'capex', 'pretax', 'tax_expense', 'net_income', 'eps', 'cfo', 'interest',
                      'assets', 'equity'):
            fact = read_fact(facts, TAGS[field], end, None if field in ('assets', 'equity') else start)
            sources.extend([fact] if fact else [])
            row[field] = fact['value'] if fact else None
        review = record_at(profile.get('annual', []), cutoff, 'annual_review', end)
        if review and review.get('source'):
            for field in ('ebit', 'da', 'capex'):
                if number(review.get(field)):
                    row[field] = review[field]
        if any(not number(row[field]) for field in ('sales', 'ebit', 'da', 'capex')) or row['sales'] <= 0 or min(row['da'], row['capex']) < 0:
            raise Missing('annual_financials', f'Cifras operativas principales incompletas para {end}.')
        row['onwc'], provenance = onwc(end, review)
        row['capital'] = review.get('invested_capital')
        sources.extend(provenance)
        years.append(row)
    return years, sources


def indicators(years, tax, price, market_ev, wacc, bridge):
    a, b = years[-2:]
    nopat = b['ebit'] * (1 - tax)
    fcff = nopat + b['da'] - b['capex'] - (b['onwc'] - a['onwc'])
    def ratio(n, d):
        return n / d if number(n) and number(d) and d > 0 else None
    def average(key):
        return (a[key] + b[key]) / 2 if number(a[key]) and number(b[key]) else None
    roic = ratio(nopat, average('capital'))
    ebitda = b['ebit'] + b['da']
    return dict(period_end=b['end'], revenue_growth=b['sales']/a['sales']-1,
                revenue_cagr_3y=(b['sales']/years[0]['sales'])**(1/3)-1,
                ebit_margin=b['ebit']/b['sales'], fcff=fcff, fcff_margin=fcff/b['sales'],
                roic=roic, roic_spread=roic-wacc if roic is not None else None,
                roa=ratio(b['net_income'], average('assets')), roe=ratio(b['net_income'], average('equity')),
                net_debt_ebitda=ratio(bridge['debt']-bridge['cash'], ebitda),
                interest_coverage=ratio(b['ebit'], b['interest']), pe=ratio(price, b['eps']),
                ev_ebitda=ratio(market_ev, ebitda), fcff_yield=ratio(fcff, market_ev),
                cfo_less_capex=b['cfo']-b['capex'] if number(b['cfo']) else None)


def market_history(get_json, symbol, cutoff):
    start = (cutoff - timedelta(days=760)).replace(hour=0, minute=0, second=0, microsecond=0)
    now = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    # Later splits must be visible to reconstruct the historical as-traded closing price.
    query = urlencode(dict(period1=int(start.timestamp()), period2=int(now.timestamp()) + 86400,
                           interval='1d', events='splits', includeAdjustedClose='true'))
    for host in ('query1.finance.yahoo.com', 'query2.finance.yahoo.com'):
        url = f'https://{host}/v8/finance/chart/{symbol}?{query}'
        try:
            result = get_json(url)['chart']['result'][0]
            if result['meta']['currency'] != 'USD':
                raise ValueError('Moneda de mercado distinta de USD')
            ts = result['timestamp']
            raw = result['indicators']['quote'][0]['close']
            adjusted = result['indicators']['adjclose'][0]['adjclose']
            break
        except (OSError, KeyError, TypeError, IndexError, ValueError):
            continue
    else:
        raise OSError('Histórico de mercado no disponible')
    split_events = result.get('events', {}).get('splits', {}).values()
    splits = {}
    for event in split_events:
        split_day = datetime.fromtimestamp(event['date'], NY).date()
        splits[split_day] = event['numerator'] / event['denominator']
    closes, returns = {}, {}
    for stamp, price, adj in zip(ts, raw, adjusted):
        day = datetime.fromtimestamp(stamp, NY).date()
        # At 16:00 New York a regular session (including abbreviated sessions) has ended.
        if datetime.combine(day, time(16), NY) > cutoff:
            continue
        if number(price) and price > 0:
            for split_day, ratio in splits.items():
                if split_day > day:
                    price *= ratio
            closes[day] = price
        if number(adj) and adj > 0:
            returns[day] = adj
    return closes, returns, splits, url


def risk_free(cutoff):
    day = cutoff.astimezone(NY).date()
    url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?' + urlencode(
        dict(id='DGS10', cosd=day-timedelta(days=14), coed=day))
    with urlopen(Request(url, headers={'User-Agent': 'QuantRadar/1.0'}), timeout=10) as response:
        rows = list(csv.DictReader(StringIO(response.read(50000).decode('utf-8-sig'))))
    for row in reversed(rows):
        observation = date.fromisoformat(next(iter(row.values())))
        # Use from the next local midnight when the precise publication time isn't archived.
        published = datetime.combine(observation + timedelta(days=1), time(), NY)
        try:
            value = float(row['DGS10']) / 100
        except (KeyError, ValueError):
            continue
        if published <= cutoff and number(value):
            return dict(value=value, observation=observation.isoformat(),
                        published_at=published.isoformat(), source=url)
    raise Missing('risk_free', 'FRED no entregó una observación elegible.')


def compare(profile, cutoff, latest, bridge):
    rows = record_at(profile.get('peers', []), cutoff, 'comparables')
    if not rows.get('source') or rows.get('basis') != 'FY' or not rows.get('selection'):
        return dict(reason='Falta una cohorte sectorial revisada con base FY.')
    peers = {row['symbol']: row for row in rows.get('companies', []) if row.get('symbol')}
    def summarize(key, label, adjustment):
        vals = sorted(row[key] for row in peers.values() if number(row.get(key)) and row[key] > 0)
        if len(vals) < 3 or not number(label) or label <= 0:
            return None
        def percentile(q):
            index = (len(vals)-1)*q
            i = int(index)
            return vals[i] + (vals[min(i+1,len(vals)-1)]-vals[i])*(index-i)
        return dict(count=len(vals), p25=percentile(.25), median=percentile(.5),
                    p75=percentile(.75), value_per_share=adjustment(percentile(.5)*label),
                    excluded=[symbol for symbol, row in peers.items() if not number(row.get(key)) or row[key] <= 0])
    net = bridge['cash'] + bridge['investments'] - sum(
        bridge[key] for key in ('debt','preferred','minorities','other_claims'))
    return dict(source=rows, pe=summarize('pe', latest['eps'], lambda value: value),
                ev_ebitda=summarize('ev_ebitda', latest['ebit']+latest['da'],
                                    lambda value: (value+net)/bridge['shares']))


def collect(get_json, symbol, cik, cutoff, sec_agent, config, out):
    key = f'CIK{cik:010d}'
    root = 'https://data.sec.gov'
    headers = {'User-Agent': sec_agent}
    submissions = get_json(f'{root}/submissions/{key}.json', headers)
    payload = get_json(f'{root}/api/xbrl/companyfacts/{key}.json', headers)
    facts = facts_at(payload, acceptance(submissions['filings']['recent']), cutoff, cik)
    profile = config.get('companies', {}).get(symbol, {})
    years, sources = ledger(facts, profile, cutoff)
    out['inputs'] = dict(annual=years, provenance=sources)
    balance_dates = [end for (start, end) in facts.get('Assets', {}) if start is None]
    if not balance_dates:
        raise Missing('balance', 'Falta el último balance elegible.')
    balance_end = max(balance_dates)
    cash_fact = read_fact(facts, TAGS['cash'], balance_end)
    share_dates = [end for (start, end) in facts.get(TAGS['shares'][0], {}) if start is None]
    shares_fact = read_fact(facts, TAGS['shares'], max(share_dates)) if share_dates else None
    review = record_at(profile.get('balance', []), cutoff, 'balance_review', balance_end)
    missing = [name for name in BRIDGE_FIELDS if not number(review.get(name)) or review[name] < 0]
    if missing or not review.get('source'):
        raise Missing('balance_review', f'Falta revisar el puente del balance {balance_end}: ' +
                      ', '.join(missing or ['fuente']))
    if not cash_fact or not shares_fact or shares_fact['value'] <= 0:
        raise Missing('cash_or_shares', 'Faltan caja o acciones ordinarias vigentes en EDGAR.')
    params = record_at(profile.get('capital', []), cutoff, 'capital')
    tax = params.get('marginal_tax')
    if not number(tax) or not 0 <= tax <= .5 or not params.get('source'):
        raise Missing('marginal_tax', 'Falta la tasa fiscal marginal combinada y su fuente.')
    erp = record_at(config.get('erp', []), cutoff, 'erp')
    if not number(erp.get('value')) or erp['value'] <= 0 or not erp.get('source'):
        raise Missing('erp', 'Falta una prima de mercado implícita archivada para la fecha.')
    prices, adjusted, splits, asset_url = market_history(get_json, symbol, cutoff)
    benchmark, index_adjusted, _, index_url = market_history(get_json, 'SPY', cutoff)
    if not prices:
        raise Missing('quote', 'No hay un cierre regular elegible para la acción.')
    quote_day = max(prices)
    price = prices[quote_day]
    out['quote'] = dict(value=price, currency='USD', date=quote_day.isoformat(), source=asset_url)
    # If a post-filing split already traded, put shares on the same basis as that close.
    basic_shares = shares_fact['value']
    for day, ratio in splits.items():
        if date.fromisoformat(shares_fact['end']) < day <= quote_day:
            basic_shares *= ratio
    if review.get('incremental_shares') and review.get('share_basis_date') != quote_day.isoformat():
        raise Missing('dilution', 'La dilución revisada debe usar el cierre y la base de acciones de la cotización.')
    rf = risk_free(cutoff)
    debt = review['debt']
    market_debt = review.get('market_debt', debt)
    if not number(market_debt) or market_debt < 0:
        raise Missing('market_debt', 'Valor de mercado de la deuda inválido.')
    equity = price * basic_shares
    beta, sample = weekly_beta(adjusted, index_adjusted, cutoff)
    beta_method = 'weekly_total_return'
    shield = tax if params.get('tax_shield') is True else 0
    if beta is None:
        unlevered = params.get('sector_unlevered_beta')
        if not number(unlevered) or unlevered <= 0:
            raise Missing('beta', 'Muestra semanal insuficiente o beta inválida sin referencia sectorial.')
        beta = unlevered * (1 + (1-tax) * market_debt/equity)
        beta_method = 'sector_unlevered'
    kd = params.get('debt_yield')
    if market_debt and not number(kd):
        spread = params.get('debt_spread')
        if not number(spread) or spread < 0:
            raise Missing('cost_of_debt', 'Falta rendimiento de deuda o diferencial documentado.')
        kd = rf['value'] + spread
    kd = kd if market_debt else 0
    if kd < 0:
        raise Missing('cost_of_debt', 'Coste de deuda inválido.')
    ke, wacc = cost_of_capital(rf['value'], beta, erp['value'], kd, shield, equity, market_debt)
    bridge = {field: review[field] for field in ('debt','investments','preferred','minorities','other_claims')}
    bridge['cash'] = max(0, cash_fact['value'] - review['cash_reserve'])
    shares = basic_shares + review['incremental_shares']
    market_ev = equity + debt + bridge['preferred'] + bridge['minorities'] + bridge['other_claims'] - bridge['cash'] - bridge['investments']
    assumptions = dict(**operating_inputs(years, tax), price=price, shares=shares, wacc=wacc, bridge=bridge)
    sources.extend([cash_fact, shares_fact, review, params, erp, rf])
    out['available_at'] = max(datetime.fromisoformat(record['published_at']) for record in sources).isoformat()
    out['inputs'].update(balance_end=balance_end, basic_shares=basic_shares, diluted_shares=shares,
                         benchmark=dict(symbol='SPY', method='ETF de retorno total ajustado', source=index_url),
                         cost_of_capital=dict(rf=rf, erp=erp, beta=beta, sample=sample, beta_method=beta_method,
                                              ke=ke, kd=kd, equity=equity, debt=market_debt,
                                              tax_shield=shield, marginal_tax=tax))
    out['assumptions'] = assumptions
    out['ratios'] = indicators(years, assumptions['tax'], price, market_ev, wacc, bridge)
    out.update(calculate(assumptions))
    out['comparables'] = compare(profile, cutoff, years[-1], {**bridge, 'shares': shares})
    today = cutoff.astimezone(NY).date()
    freshness = {'balance': (today-date.fromisoformat(balance_end)).days,
                 'fiscal_year': (today-date.fromisoformat(years[-1]['end'])).days,
                 'quote_sessions': sum(day > quote_day for day in benchmark),
                 'erp': (today-datetime.fromisoformat(erp['published_at']).astimezone(NY).date()).days,
                 'rf': (today-date.fromisoformat(rf['observation'])).days}
    out['checks'] = {'age': freshness}
    for field, limit in dict(balance=150, fiscal_year=450, quote_sessions=5, erp=45, rf=7).items():
        if freshness[field] > limit:
            out['reasons'].append(dict(code='stale_data', field=field, message=f'Dato desactualizado: {field}.'))
    for name, scenario in out['scenarios'].items():
        if (scenario['terminal_weight'] or 0) > .75:
            out['warnings'].append(dict(code='terminal_weight', field=name,
                                        message=f'El terminal supera el 75 % del valor operativo en el escenario {name}.'))
    if 'market_debt' not in review and debt:
        out['warnings'].append(dict(code='book_debt', field='debt', message='Ponderación con valor contable de deuda.'))
    out['status'] = 'review_required' if out['reasons'] else 'ok'
    if out['reasons']:
        out['classification'] = None


def valuation_response(get_json, symbol, raw_cutoff, known, covered, sec_agent):
    try:
        cutoff = parse_cutoff(raw_cutoff)
    except ValueError as exc:
        return {'error': str(exc)}, 400
    if not symbol:
        return {'error': 'Indica el símbolo del activo.'}, 400
    if symbol not in known:
        return {'error': 'Símbolo desconocido.'}, 404
    out = dict(schema_version=1, model_version=VERSION, as_of=cutoff.isoformat(),
               instrument=dict(symbol=symbol, cik=covered.get(symbol), currency='USD' if symbol in covered else None),
               status='unsupported', reasons=[], warnings=[], missing_fields=[], quote=None, available_at=None,
               inputs=None, ratios=None, assumptions=None, classification=None, scenarios={}, checks={},
               sensitivity=None, reverse_dcf=None, comparables=None)
    if symbol not in covered:
        out['reasons'].append(dict(code='unsupported', field='symbol',
                                   message='Disponible para acciones ordinarias estadounidenses cubiertas en USD.'))
        return seal(out), 200
    try:
        profile_file = Path(os.getenv('QR_VALUATION_INPUTS') or PROFILES)
        config = json.loads(profile_file.read_text()) if profile_file.is_file() else {}
        collect(get_json, symbol, covered[symbol], cutoff, sec_agent, config, out)
    except Missing as exc:
        out['status'] = 'insufficient_data'
        out['missing_fields'].append(exc.field)
        out['reasons'].append(dict(code='missing_field', field=exc.field, message=str(exc)))
    except (OSError, KeyError, IndexError, TypeError, ValueError):
        out.update(status='insufficient_data', classification=None, scenarios={})
        out['reasons'].append(dict(code='source_unavailable', field='sources',
                                   message='No se pudo leer una fuente de valoración o su configuración.'))
        return seal(out), 503
    return seal(out), 200
