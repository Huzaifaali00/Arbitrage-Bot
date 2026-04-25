# TASK: Fix 3 MEV Bot Issues Found During Anvil Fork Testing

## Context
The bot is running on Anvil fork of Base Sepolia (USE_ANVIL=true). It is detecting
opportunities but rejecting all of them due to 3 bugs. The bot is NOT executing any
trades. All 3 issues must be fixed without breaking existing logic.

## Issue 1 — Sanity cap rejecting legitimate Anvil test opportunities

Log evidence:
warn: Opportunity rejected: profitPercentage sanity cap exceeded
{"id":"2hop-0x46880b...-0x0B9Ab...","profitPercentage":14258.459558863884}
warn: Opportunity rejected: profitPercentage sanity cap exceeded
{"id":"2hop-0x4664755...-0x0B9Ab...","profitPercentage":8815.610819175245}

The seed script intentionally creates a large price imbalance for testing purposes.
The sanity cap is correctly rejecting it as "too good to be true" — but for Anvil
testing this is expected and valid.

Fix required:
- Find the profitPercentage sanity cap check in OpportunityDetector (or wherever
  opportunities are filtered)
- Make the cap configurable via env var: PROFIT_SANITY_CAP_PCT
- Default value (production): keep whatever it currently is
- Anvil override: when USE_ANVIL=true, use a much higher cap (e.g. 100000%)
- Add the env var to .env with PROFIT_SANITY_CAP_PCT=100000 when USE_ANVIL=true
- Do NOT hardcode the Anvil value — read it from env

## Issue 2 — V3 pool 0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0 is blacklisted

Log evidence:
info: EventListener: blacklisted pool, skipping
{"address":"0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0"}
info: OpportunityDetector: blacklisted pool, skipping
{"pool1":"0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0"}

This is the WETH/USDC V3 pool on Base Sepolia — it should NOT be blacklisted.
It was likely added to the blacklist during a previous failed test run.

Fix required:
- Find where the blacklist is defined/stored (could be in-memory array, DB, or
  hardcoded constant in source)
- Remove 0x94bfc0574FF48E92cE43d495376C477B1d0EEeC0 from the blacklist
- If the blacklist is stored in SQLite DB (bot-data-baseSepolia.db), add a
  startup routine that clears the blacklist when USE_ANVIL=true so stale
  blacklist entries from previous runs never carry over
- If hardcoded: just remove it

## Issue 3 — V3 Quoter reverts on pool 0x46880b404CD35c165EDdefF7421019F8dD25F4Ad

Log evidence:
warn: Opportunity rejected: quote simulation failed
{"error":"execution reverted...require(false)...
"to": "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24""}

The bot is calling quoteExactInputSingle on the V3 factory address
0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24 which is the FACTORY, not the
QUOTER. On Base Sepolia the Quoter contract is either undeployed or at a
different address, causing require(false) reverts.

Fix required:
- Find where the V3 quote call is made (likely UniswapV3Adapter or
  OpportunityDetector)
- Add a try/catch around the V3 quote call if not already present
- When the quote call reverts, do NOT blacklist the pool — instead:
  - Log a warning: "V3 quote unavailable for pool X, skipping this cycle"
  - Return null/undefined from the quote function (treat as no opportunity)
  - Let the pool remain active for future cycles
- Additionally: when USE_ANVIL=true, skip V3 quote simulation entirely for
  pools where the quoter is address(0) or known to be unavailable
- The V3 pool should remain in the monitored pool list — just skip it when
  quoting fails rather than blacklisting it permanently

## Hard Rules
1. DO NOT modify any Solidity contracts
2. DO NOT remove or rename existing env vars
3. DO NOT break the live Base Sepolia flow (USE_ANVIL=false must still work)
4. DO NOT change contract addresses anywhere
5. Read CLAUDE.md before modifying any existing file
6. Use ethers v6 syntax throughout (BigInt, not BigNumber)
7. Work one file at a time — show full modified file content for every change
8. After all changes: run `npx tsc --noEmit` — must pass with zero errors

## Investigation Steps (do these FIRST before making any changes)
1. grep -r "sanity\|profitPercentage\|PROFIT" src/ --include="*.ts" -n
2. grep -r "blacklist\|blackList" src/ --include="*.ts" -n
3. grep -r "94bfc" src/ --include="*.ts" -n
4. grep -r "quoteExact\|quoter\|getAmountOut" src/ --include="*.ts" -n
5. Read every file that contains matches before touching anything

## Success Criteria
After all fixes, running `npm run dev:anvil` must show:
- NO "sanity cap exceeded" rejections for profit% under 100000%
- NO "blacklisted pool" skips for 0x94bfc...
- NO permanent blacklisting of any pool due to V3 quote failure
- At least one opportunity passing through all filters and reaching the
  execution stage (even if execution itself fails — that is a separate issue)