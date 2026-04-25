# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Core Working Rules

### File Modification Policy
- **ALWAYS check for existing files before creating new ones.**
- If a file already exists that serves the same purpose (even partially), **edit and fix it** — never create a duplicate.
- Before writing any new file, run: `find . -name "<filename>" 2>/dev/null` or scan the relevant directory.
- If unsure whether a file exists, **ask first** — do not default to creating.
- This applies to: scripts, adapters, config files, services, components, and test files.
- **Only create a new file if no existing file can reasonably serve the purpose.**

## Commands

## Maintenance Rule
At the end of every session, update this file with:
- Any new files/modules added
- Architectural decisions made
- Current active task / next step
- Known issues or TODOs

### Build & Compile
```bash
forge build
```
Uses `via_ir = true` (required for complex contracts) — compile times are longer than typical.

### Test
```bash
forge test                        # all tests
forge test --match-test test_Foo  # single test by name
forge test --match-contract ArbitrageBotTest  # by contract
forge test -vvvv                  # full trace output
```

### Deploy
Use the unified script — it deploys all three contracts in one broadcast and wires them with no manual env-var hand-off.

```bash
# Required env vars
export PRIVATE_KEY=...
export AAVE_PROVIDER_ADDRESS=...   # Aave V3 PoolAddressesProvider on target chain
export PROFIT_TOKEN_ADDRESS=...    # USDC / USDT address on target chain

# Optional
export EXECUTOR_ADDRESS=...        # extra hot-wallet to authorise on vault
export PERFORMANCE_FEE_BPS=2000   # 1500–2500 (default 2000)

# 1. Deploy DEXRegistry + ArbitrageVault + ArbitrageBot (fully wired)
forge script script/DeployAll.s.sol --rpc-url $RPC_URL --broadcast

# 2. Register DEXes (copy DEX_REGISTRY_ADDRESS from step 1 output)
export DEX_REGISTRY_ADDRESS=<from step 1 output>
forge script script/RegisterDEXes.s.sol --rpc-url $RPC_URL --broadcast
```

**Why `DeployAll.s.sol` replaces the old separate scripts:**
- Uses `vm.computeCreateAddress(deployer, nonce + N)` to predict all addresses before any deploy, then passes real addresses into every constructor — eliminates `vaultAddress = address(0)` and `registry = address(0)` risks.
- Immediately calls `vault.authorizeExecutor(bot)` in the same broadcast — no chance of bot being unable to call `distributeProfit()`.
- Sanity `require` checks after each deploy assert the predicted address matched reality (catches nonce drift).

The old individual scripts (`DeployDEXRegistry.s.sol`, `Deploy.s.sol`, `DeployVault.s.sol`) are kept for reference but should not be used for fresh deployments.

### Backend & Frontend
```bash
cd arbitrage-bot-backend && npm install && npm start
cd saas-frontend && npm install && npm run dev
```

### Post-Deployment Wiring (run once after DeployAll)
```bash
# 1. Register DEX factories
export DEXRegistry=<from DeployAll output>
forge script script/RegisterDEXes.s.sol --rpc-url $RPC_URL --broadcast

# 2. Deploy adapters and wire to bot
forge script script/DeployAdapters.s.sol --rpc-url $RPC_URL --broadcast

# 3. Register pools (lowers testnet thresholds, registers real Uniswap V3 pools)
forge script script/RegisterPools.s.sol --rpc-url $RPC_URL --broadcast
```

## Architecture

This is a MEV arbitrage SaaS platform with three on-chain contracts, a TypeScript/Node.js backend, and a Next.js frontend.

### On-chain Contracts (`src/`)

**`ArbitrageBot.sol`** — The trading executor. `onlyOwner` functions `executeBackrun()` and `executeMultiHopArb()` are called by the backend hot-wallet. Each trade can optionally use an Aave V3 flash loan (set `useFlashLoan = true` in params). After each trade, profit is automatically converted to the configured stablecoin via `_convertToUSDC()`. The bot must call `distributeToVault()` to push accumulated USDC to the vault.

**`ArbitrageVault.sol`** — Multi-user profit-sharing vault. Users deposit ETH as principal; ArbitrageBot distributes USDC profits. Profit allocation uses an `accProfitPerUnit` accumulator (similar to a MasterChef-style reward model). Key security layers: 12-hour withdrawal delay (request → execute), per-user freeze/unfreeze with 3-day cooldown, guardian-based account recovery (7-day delay), 25% daily principal withdrawal rate limit, and 24-hour timelock for sensitive admin changes.

**`DEXRegistry.sol`** — Centralized registry for DEX integrations and pools. Supports 13 DEX types (see `DEXType` enum). Tracks pool TVL, volume, and calculates an opportunity score (0–100) using a weighted formula (TVL 40%, volume 40%, age 20%). The backend queries `getHighOpportunityPools()` to discover trading targets.

### Adapter Pattern (`src/adapters/`)

`IDEXAdapter` defines a common interface. `ArbitrageBot` holds a mapping `DEXType → IDEXAdapter`. Before executing a trade, it looks up the pool's `DEXType` in the registry, fetches the corresponding adapter, and delegates the swap. Currently implemented: `UniswapV2Adapter`, `UniswapV3Adapter`.

The `SwapParams.data` field is DEX-specific ABI-encoded calldata — for V3 adapters it encodes the pool address directly.

### Contract Interaction Flow

```
Backend hot-wallet
  → ArbitrageBot.executeBackrun() / executeMultiHopArb()
    → (optional) Aave V3 flashLoanSimple()
      → executeOperation() callback
    → DEXRegistry.getPoolInfo(pool) — validate pool, get DEXType
    → adapters[dexType].swap(...)   — execute trade
    → _convertToUSDC(profit)        — sell profit token for stablecoin
  → ArbitrageBot.distributeToVault(amount)
    → ArbitrageVault.distributeProfit(amount)  — push to vault
```

### Roles & Access Control

| Role | Contract | Capability |
|------|----------|------------|
| `owner` (deployer/operator) | ArbitrageBot | Execute trades, set adapters, withdraw |
| `owner` | ArbitrageVault | Admin: fee changes, executor management |
| `executor` | ArbitrageVault | Call `distributeProfit()` (set to ArbitrageBot address) |
| `operatorAddress` | ArbitrageVault | Collect performance fees |
| `guardian` | ArbitrageVault | Freeze account, initiate recovery |

`ArbitrageBot` uses a two-step ownership transfer (`transferOwnership` + `acceptOwnership`), overriding OpenZeppelin's default.

### Key Constants (ArbitrageVault)
- Performance fee: 15–25% (default 20%)
- Min deposit: 0.005 ETH; max per user: 50 ETH
- Max users: 10,000
- Withdrawal delay: 12 hours (configurable 1h–7d)
- Unfreeze delay: 3 days (configurable 1d–30d)
- Recovery delay: 7 days (fixed)
- Daily principal withdrawal cap: 25%

### Off-chain Components
- `arbitrage-bot-backend/` — Node.js/TypeScript backend; monitors mempool, calls the bot contract, stores state in SQLite (`bot-data.db`)
- `saas-frontend/` — Next.js dashboard for users to manage vault deposits and view performance

### New Scripts (2025-04-18)
- `script/DeployAdapters.s.sol` — Deploys UniswapV2Adapter + UniswapV3Adapter and calls `bot.setAdapter()` + `v2Adapter.authorizeCaller(bot)`. Must run after DeployAll.
- `script/RegisterPools.s.sol` — Lowers testnet thresholds (minTVL → 1 ETH, minOpportunityScore → 0), then registers real WETH/USDC Uniswap V3 pools from the on-chain factory.

### Known Issues / TODOs
- Adapters are NOT deployed as part of DeployAll — must always run DeployAdapters.s.sol separately after fresh deploy.
- RegisterPools.s.sol will log a WARNING if the Uniswap V3 factory returns address(0) for a pool (pool doesn't exist on that network yet). In that case create the pool via Uniswap interface first.
- `poolDiscoveryService.ts` now seeds from the on-chain registry on startup and starts block scanning from `currentBlock - 100_000` to avoid full-chain scans.

### Session Updates (2026-04-22)
- New file added: `script/DeployBot.s.sol` for redeploying only `ArbitrageBot` against existing vault/registry.
- Architectural decisions:
  - Opportunity emission now requires route-level quote validation before execution (V3 QuoterV2 + V2 reserve math), plus hard sanity caps.
  - Testnet blacklisted pools are environment-driven (`BLACKLISTED_POOLS`) and skipped in both detector and price seeding.
  - Trade sizing is testnet-capped to conservative fixed maximums (`MAX_TRADE_SIZE_USDC`, `MAX_TRADE_SIZE_WETH`) after applying a 30% balance cap.
  - `estimateGas` call reverts now abort opportunities; static gas fallback is allowed only for non-revert failures.
  - Execution P&L recording is balance-delta-driven; pre-trade estimates are no longer treated as realized profit.
  - `ArbitrageBot.executeMultiHopArb` now enforces `require(balAfter > balBefore, "ArbitrageBot: no profit")`.
- Active task / next step:
  - Re-wire adapter authorizations for the new bot address and run a controlled dry-run route that cleanly reaches the no-profit guard for direct on-chain revert proof.
- Known issues / TODOs:
  - Current Base Sepolia adapter/route preconditions often revert earlier (`caller not authorized` / `zero amount`) before the new no-profit guard, so explicit guard-proof calls need a pre-funded, authorized test route.
