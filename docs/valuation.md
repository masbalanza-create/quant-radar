# Valoración fundamental

La pestaña del activo consulta `GET /api/valuation?symbol=AAPL`. El campo opcional
`as_of` acepta una fecha y hora UTC ISO 8601. La API responde en USD con escenarios,
flujos, puente, indicadores, sensibilidad y valoración inversa. El resumen de una
valoración consultada puede viajar en el contexto de análisis con su identificador.
Cada resultado deja visibles las causas de datos insuficientes o de revisión.

## Uso en la decisión

La vista **Largo plazo** usa la valoración cuando el servidor devuelve `ok`.
Compara el cierre con el valor prudente, el ROIC con el WACC y la deuda neta
con 3× EBITDA. El margen mínimo de entrada es 15 %. La salida requiere una
posición registrada. Si no se puede publicar el DCF, la tarjeta usa velas
semanales y lo indica. La pestaña de valoración conserva el motivo del fallo.

## Datos revisados por emisor

EDGAR aporta los estados financieros y las acciones básicas. La serie de mercado
procede de Yahoo Finance, con SPY ajustado como referencia de retorno total, y la
tasa libre de riesgo se toma de la serie DGS10 de FRED. Configura
`SEC_USER_AGENT` con el nombre y el correo de contacto del operador.

Crea un archivo local `valuation-inputs.json` junto a `server.py` o establece
`QR_VALUATION_INPUTS` con la ruta del archivo. Guarda las revisiones históricas.
Cada registro usa `published_at` en ISO 8601 con zona horaria y `source` con
el origen verificable. La fecha indica cuándo estuvo disponible la cifra o la
revisión. Los importes y acciones se guardan en unidades, las tasas en decimales.

- `erp` es una lista de registros con `value`, `published_at` y `source`.
  Registra la prima implícita publicada y archívala por fecha.
- `companies` se indexa por símbolo. Cada emisor puede tener cuatro listas,
  `annual`, `balance`, `capital` y `peers`.
- `annual` requiere `period_end` y `onwc` conciliado para cada uno de los cuatro
  ejercicios. Acepta `invested_capital` para ROIC y ajustes revisados
  `ebit`, `da` y `capex`. Vincula a los estados o a una conciliación que
  explique cada ajuste.
- `balance` requiere `period_end`, `cash_reserve`, `investments`, `debt`,
  `preferred`, `minorities`, `other_claims` e `incremental_shares`.
  Registra ceros cuando estén documentados. Puede incluir `market_debt`.
  Si la dilución es positiva, `share_basis_date` debe coincidir con el
  cierre usado para valorar.
- `capital` requiere `marginal_tax`. Para deuda añade `debt_yield` o
  `debt_spread`. `tax_shield: true` indica que se espera poder aprovechar el
  escudo. `sector_unlevered_beta` sirve de respaldo cuando falte beta de mercado.
- `peers` es opcional. Registra `basis: "FY"`, `selection` con los criterios
  aplicados y `companies` con símbolo, `pe` y `ev_ebitda`. La cohorte debe
  estar calculada con información disponible al corte.

Actualiza ERP, deuda y dilución cuando cambie su base. La API acepta varias
revisiones por periodo y usa la última disponible a la fecha de corte. Para
evaluar retrospectivamente el proceso hay que archivar revisiones y fuentes
externas disponibles entonces. Las cotizaciones actuales de un proveedor por
sí solas no constituyen un archivo histórico de publicaciones.

## Verificación

Ejecuta `python3 -m unittest discover -s tests -p 'check*.py'`. El caso
reproducible del manual comprueba los resultados de 11,13, 16,45 y 24,84 USD
por acción. Las pruebas de integración simulan respuestas de proveedores y
revisiones del balance, sin usar credenciales ni red.
