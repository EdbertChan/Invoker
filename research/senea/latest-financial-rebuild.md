# SENEA Latest Financial Rebuild

This is a thin but real Invoker-generated financial rebuild for SENEA fiscal 2025. It fetches SEC source data and calculates current LIFO/FIFO, tangible book, and NCAV metrics. It is not investment advice and is not the full hedge-fund diligence model.

## Source URLs

- SEC company facts: https://data.sec.gov/api/xbrl/companyfacts/CIK0000088948.json
- FY2025 10-K: https://www.sec.gov/Archives/edgar/data/88948/000143774925020197/senea20250331_10k.htm

## Key Extracted Disclosures

- LIFO reserve: $359.3 million
- Deferred taxes on LIFO reserve: $89.5 million
- Statutory tax rate: 24.9%
- FY2025 adjusted net earnings: $67.1 million
- FY2025 FIFO EBITDA: $171.4 million

## Current Balance Sheet Calculations

- Reported tangible book value: $633.0 million
- Adjusted tangible book before LIFO tax recapture: $992.3 million
- Adjusted tangible book after LIFO tax recapture: $902.8 million
- Reported NCAV: $207.2 million
- FIFO-adjusted NCAV before LIFO tax recapture: $566.5 million
- FIFO-adjusted NCAV after LIFO tax recapture: $477.0 million

## Next Verification Steps

- Add share-count extraction and per-share calculations.
- Add multi-year filing history and 20-year compounding.
- Reconcile buybacks, net debt, maintenance capex proxies, ROE, and ROIC.
- Add market price input so price-to-adjusted-book and price-to-NCAV can be tested directly.
