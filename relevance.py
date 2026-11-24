import re, time, email.utils
from datetime import datetime
from difflib import SequenceMatcher
RULES=[('Resultados y previsiones',r'earnings|profit|revenue|guidance|outlook|forecast|resultados|beneficios',r'beats?|exceeds?|raises?|upgrades?|above expectations|record profit',r'misses?|cuts?|lowers?|below expectations|loss|warning'),('Regulación y litigios',r'lawsuit|antitrust|regulat|sanction|fine|investigat|ban\b|recall',r'cleared|approved|dismissed|settlement approved',r'fine[ds]?|banned|lawsuit|probe|recall|sanction'),('Contratos y operaciones',r'acquisition|merger|contract|deal\b|bankruptcy|default|layoffs|factory closure',r'wins? .*contract|secures? .*deal',r'bankruptcy|default|factory closure|loses? .*contract'),('Productos y demanda',r'launch|product|chip|deliveries|orders|sales|demand',r'sales surge|demand surge|orders rise|record sales',r'sales fall|demand falls|weak demand|delivery decline'),('Política monetaria y macro',r'interest rate|rate cut|rate hike|inflation|tariff|central bank|federal reserve|ecb|bank of japan|oil supply',r'(?!)',r'(?!)')]
TRUST=r'reuters|bloomberg|financial times|wall street journal|associated press|\bsec\b|cnmv|federal reserve|european central bank|bank of japan'
RUMOR=r'rumou?r|speculat|could|might|reportedly|unconfirmed|sources say|potential|may\b'
NOISE=r'price prediction|should you buy|stocks to buy|technical analysis|price target|opinion:|motley fool|why .* stock .* today|what .* investors .* know'
ALIASES={'AAPL':'apple|iphone','NVDA':'nvidia','MSFT':'microsoft','TSLA':'tesla','AMZN':'amazon','ASML:Euronext Amsterdam':'asml','SAP:XETR':'\\bsap\\b','SAN:BME':'santander','7203:JPX':'toyota','9984:JPX':'softbank','EUR/USD':'euro|ecb|federal reserve|inflation|interest rate','USD/JPY':'yen|bank of japan|federal reserve|interest rate','SPY':'s&p|s\&p|federal reserve|inflation|tariff','QQQ':'nasdaq|tech stocks|federal reserve|inflation','XAU/USD':'gold|bullion','XAG/USD':'silver','BTC/USD':'bitcoin|\\bbtc\\b','ETH/USD':'ethereum|\\beth\\b'}
def classify(symbol,items,now=None):
 now=now or time.time(); kept=[]; rejected=[]; seen=[]
 for item in items:
  title=str(item.get('title','')); t=title.lower(); summary=str(item.get('summary','')).lower(); source=str(item.get('source','')); text=t+' '+summary
  try:
   try: dt=datetime.fromisoformat(str(item.get('date')).replace('Z','+00:00'))
   except ValueError: dt=email.utils.parsedate_to_datetime(item['date'])
   age=(now-dt.timestamp())/3600
  except Exception: age=9999
  normalized=re.sub(r'[^a-z0-9 ]','',t.split(' - ')[0]); words=set(normalized.split())
  duplicate=any(SequenceMatcher(None,normalized,x).ratio()>.82 or (len(words)>3 and len(words & set(x.split()))/max(len(words|set(x.split())),1)>.68) for x in seen)
  reason=None; match=next((r for r in RULES if re.search(r[1],text)),None)
  direct=bool(re.search(ALIASES.get(symbol,r'(?!)'),text))
  if duplicate:reason='Titular parecido a otro ya considerado'
  elif age<-.25 or age>72:reason='Fecha no verificable o noticia antigua (más de 72 h)'
  elif re.search(NOISE,t):reason='Opinión, predicción o comentario de mercado'
  elif not direct:reason='No se identifica una relación directa con el activo'
  elif not match:reason='No se identifica un acontecimiento económico concreto'
  elif re.search(RUMOR,t):reason='Hipótesis o rumor sin confirmación'
  if reason:rejected.append({**item,'reason':reason});continue
  seen.append(normalized); trusted=bool(re.search(TRUST,source.lower())); pos=bool(re.search(match[2],text)); neg=bool(re.search(match[3],text)); direction=1 if pos and not neg else -1 if neg and not pos else 0
  # Unknown publishers and ambiguous events are context only; never presume confirmation.
  weight=(5 if age<=24 else 2) if trusted else 0
  if match[0]=='Productos y demanda' and not re.search(r'\d|record sales|sales fall|demand surge|weak demand',text):weight=0
  kept.append({**item,'category':match[0],'direction':direction,'impact':direction*weight,'trusted':trusted,'reason':'Fuente prioritaria; impacto orientativo' if trusted else 'Fuente no prioritaria; solo contexto','age_hours':round(age,1)})
 return {'relevant':kept,'discarded':rejected,'adjustment':max(-12,min(12,sum(x['impact'] for x in kept))),'total':len(items),'method':'Reglas de titulares; no verifica artículos completos ni confirmación independiente.'}
