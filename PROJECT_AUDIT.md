# PROJECT_AUDIT.md

> **Audit Date:** 2026-04-19  
> **Auditor:** Claude Code (automated static analysis — no code changes made)  
> **Repo Root:** `/home/blockchain_/mev`  
> **Scope:** Every file in the repository (excluding compiled artifacts in `out/`, `dist/`, `node_modules/`, `.git/`)

---

## 1. Project Overview

### What is this project?

A **MEV arbitrage SaaS platform** that allows multiple users to pool ETH, have it traded for profit by an automated bot, and receive proportional profit distributions in USDC.

The system has three distinct layers:

1. **On-chain (Solidity)** — Three smart contracts handle trade execution, profit distribution, and DEX discovery
2. **Off-chain backend (TypeScript/Node.js)** — Monitors DEX pools, detects arbitrage opportunities, submits trades, distributes profit to vault
3. **Frontend (Next.js)** — User dashboard to deposit ETH, track earnings, and manage account security

### What chains is it targeting?

- **Primary target:** Base Sepolia (chain ID 84532) — current testnet deployment
- **Production target:** Base Mainnet (chain ID 8453)
- **Secondary target:** Arbitrum One (chain ID 42161) — factory addresses coded but not deployed

All three contracts are currently deployed to Base Sepolia.

### Current state

**Functionally complete MVP.** All three contracts are deployed and wired, the backend is fully implemented with 21 source files (~6,300 lines of TypeScript), and the frontend has 9 source files covering all major user flows. A CI pipeline runs `forge test` on every push.

**Known gaps (detailed in Section 7):**
- Private key is committed to the repo (testnet key, but still a security anti-pattern)
- Frontend requires the backend to be running to discover the vault address; no fallback env var is set
- UniswapV3Adapter's `getAmountOut/In()` always returns 0 (quoter contract unused)
- Curve and Balancer pool discovery handlers are stubs
- ArbitrageBot test coverage is minimal (2 tests)

---

## 2. Full Directory Tree

```
mev/
├── .agents/
│   └── workflows/
│       └── review-changes.md
├── .claude/
│   ├── settings.json
│   └── settings.local.json
├── .env                                  ← active deployment addresses + private key
├── .gitignore
├── .github/
│   └── workflows/
│       └── test.yml                      ← CI: forge build + forge test
├── AGENTS.md
├── CLAUDE.md
├── PLAN.md
├── README.md                             ← boilerplate (not project-specific)
├── foundry.toml
├── foundry.lock
├── lib/
│   ├── forge-std/                        ← Foundry standard library (submodule)
│   ├── openzeppelin-contracts/           ← OZ v5 (submodule)
│   └── v3-core/                          ← Uniswap V3 core (submodule)
├── src/
│   ├── ArbitrageBot.sol
│   ├── ArbitrageVault.sol
│   ├── DEXRegistry.sol
│   ├── adapters/
│   │   ├── IDEXAdapter.sol
│   │   ├── UniswapV2Adapter.sol
│   │   └── UniswapV3Adapter.sol
│   └── interfaces/
│       └── IAave.sol
├── test/
│   ├── ArbitrageBot.t.sol
│   ├── ArbitrageVaultSecurity.t.sol
│   └── RealScenarios.t.sol
├── script/
│   ├── Deploy.s.sol                      ← old standalone bot deploy (superseded)
│   ├── DeployAll.s.sol                   ← primary unified deploy script
│   ├── DeployAdapters.s.sol
│   ├── DeployDEXRegistry.s.sol           ← old standalone registry deploy (superseded)
│   ├── DeployVault.s.sol
│   ├── DeployVaultOnly.s.sol
│   ├── RegisterDEXes.s.sol
│   └── RegisterPools.s.sol
├── broadcast/
│   ├── Deploy.s.sol/84532/               ← stale (old bot 0x571c...)
│   ├── DeployAdapters.s.sol/84532/       ← current adapter addresses
│   ├── DeployAll.s.sol/84532/            ← current canonical deployment
│   ├── DeployDEXRegistry.s.sol/84532/    ← stale (old registry 0x15f0...)
│   ├── DeployVaultOnly.s.sol/84532/      ← stale (old vault 0xb1a8...)
│   ├── RegisterDEXes.s.sol/84532/
│   └── RegisterPools.s.sol/84532/
├── arbitrage-bot-backend/
│   ├── .env                              ← full config (20 variables)
│   ├── package.json
│   ├── tsconfig.json
│   ├── public/
│   │   └── sw.js                         ← Web Push service worker
│   ├── src/
│   │   ├── index.ts                      ← main ArbitrageBot class
│   │   ├── config/
│   │   │   └── index.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── utils/
│   │   │   └── logger.ts
│   │   ├── core/
│   │   │   ├── eventListener.ts
│   │   │   ├── opportunityDetector.ts
│   │   │   ├── poolDiscoveryService.ts
│   │   │   └── routeCalculator.ts
│   │   ├── execution/
│   │   │   ├── gasOptimizer.ts
│   │   │   ├── transactionBuilder.ts
│   │   │   └── transactionSubmitter.ts
│   │   ├── monitoring/
│   │   │   ├── dashboard.ts
│   │   │   └── profitTracker.ts
│   │   └── services/
│   │       ├── NotificationService.ts
│   │       ├── RegistryService.ts
│   │       ├── StorageService.ts
│   │       └── VaultService.ts
│   └── tests/                            ← empty directory
└── saas-frontend/
    ├── package.json
    ├── tsconfig.json
    ├── next.config.ts
    ├── README.md                         ← boilerplate
    └── src/
        ├── app/
        │   ├── favicon.ico
        │   ├── globals.css
        │   ├── layout.tsx
        │   └── page.tsx
        ├── components/
        │   └── dashboard/
        │       ├── BotActivity.tsx
        │       ├── Overview.tsx
        │       ├── SecurityDashboard.tsx
        │       └── VaultActions.tsx
        ├── hooks/
        │   └── useWeb3.ts
        └── lib/
            └── constants.ts
```

---

## 3. File-by-File Breakdown

---

### ROOT LEVEL

---

**`.env`**
- **Type:** Environment configuration
- **Purpose:** Active deployment addresses and secrets for the Foundry deploy scripts (not the backend)
- **Key values:**
  - `BASE_SEPOLIA_RPC_URL=https://sepolia.base.org`
  - `AAVE_POOL_ADDRESS=0x9E0Fd28470Aae30D95b4eE3cc72cB42f75b80F40` (Aave V3 PoolAddressesProvider, Base Sepolia)
  - `DEXRegistry=0x3C76b15812a24cd94e03EEE5347b84Cea2059C68`
  - `ArbitrageVault=0x1801eEa533d4362A1893Cb5D7f25BF04d1305b01`
  - `ArbitrageBot=0xcadDED8434819D70b97922A8B5FF84Cf6Ba6fE86`
  - `PRIVATE_KEY=cffdd4ecf740fb6b7b26aa9379be7ad059c890bb50140da6a39755095b76d6dc` (**WARNING: committed private key**)
  - `LOG_LEVEL=info`
- **Imports / Dependencies:** Read by Foundry scripts via `vm.envString()`
- **Connected to:** All `script/*.s.sol` files
- **Status:** Complete — but `.env` is not in `.gitignore` (the entry is for relative `./arbitrage-bot-backend/.env`), meaning this file **may be tracked by git**

---

**`.gitignore`**
- **Type:** Git configuration
- **Purpose:** Excludes build artifacts and sensitive files from version control
- **Key entries:** `cache/`, `out/`, `/broadcast/**/dry-run/`, `docs/`, `.env`
- **Imports / Dependencies:** None
- **Connected to:** Entire repo
- **Status:** Complete — note `.env` IS listed but the root `.env` is 7 lines while the backend `.env` is 66 lines; unclear which `.env` path the ignore covers

---

**`foundry.toml`** (15 lines)
- **Type:** Foundry build config
- **Purpose:** Configure Solidity compiler, optimizer, and remappings
- **Key values:**
  - `src = "src"`, `out = "out"`, `libs = ["lib"]`
  - `via_ir = true` — required for complex contracts, increases compile time
  - `optimizer = true`, `optimizer_runs = 200`
  - `gas_limit = 30_000_000`
  - Remappings: `@uniswap/v3-core/=lib/v3-core/`, `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/`
- **Imports / Dependencies:** None
- **Connected to:** All `.sol` files via remappings
- **Status:** Complete

---

**`foundry.lock`**
- **Type:** Foundry dependency lockfile
- **Purpose:** Pins submodule commit hashes for reproducible builds
- **Key functions / exports:** Locks forge-std, openzeppelin-contracts, v3-core versions
- **Status:** Complete

---

**`CLAUDE.md`** (~150 lines)
- **Type:** Documentation / AI guidance
- **Purpose:** Instructions for Claude Code when working in this repo — architecture overview, build commands, deployment workflow, known issues
- **Key content:** Contract roles, adapter pattern explanation, deploy order (DeployAll → RegisterDEXes → DeployAdapters → RegisterPools), known issue that adapters are NOT in DeployAll
- **Status:** Complete, up to date

---

**`AGENTS.md`** (58 lines)
- **Type:** Documentation
- **Purpose:** Project overview and commands for AI agents
- **Key content:** Build/test commands, deploy instructions, backend/frontend setup
- **Status:** Complete

---

**`PLAN.md`** (583 lines)
- **Type:** Development roadmap
- **Purpose:** Detailed implementation plan covering 6 objectives: multi-DEX support, front-run removal, vault profit model, SaaS architecture, security audit, user-led security
- **Status:** Historical reference — most items appear implemented

---

**`README.md`** (67 lines)
- **Type:** Documentation
- **Purpose:** Generic Foundry/Next.js boilerplate — does NOT describe this project
- **Status:** Unused / Boilerplate — should be replaced with project-specific README

---

**`.gitignore`** (15 lines) — already described above

---

**`.github/workflows/test.yml`** (38 lines)
- **Type:** GitHub Actions CI workflow
- **Purpose:** Runs on every push/PR — installs Foundry, runs `forge fmt --check`, `forge build --sizes`, `forge test -vvv`
- **Key functions:** `forge fmt --check` will fail if code is not formatted; `forge test -vvv` runs all 3 test contracts
- **Hardcoded values:** `FOUNDRY_PROFILE: ci`
- **Status:** Complete

---

**`.claude/settings.json`** (8 lines)
- **Type:** Claude Code configuration
- **Purpose:** Configures Playwright MCP server for browser automation
- **Key values:** `mcpServers.playwright` with executable path
- **Status:** Complete

---

**`.claude/settings.local.json`**
- **Type:** Local Claude Code config (gitignored)
- **Purpose:** Local permission overrides for Claude Code
- **Status:** Present, local-only

---

**`.agents/workflows/review-changes.md`** (7 lines)
- **Type:** Agent workflow instruction
- **Purpose:** Instructs agents to review all changes before completing tasks
- **Status:** Complete

---

### SOLIDITY CONTRACTS (`src/`)

---

**`src/ArbitrageBot.sol`** (327 lines)
- **Type:** Solidity contract
- **Purpose:** The trading executor. Called by backend hot-wallet to perform backrun and multi-hop arbitrage trades, optionally using Aave V3 flash loans. Converts profits to USDC and pushes to vault.
- **Key functions:**
  - `executeBackrun(BackrunParams)` — `onlyOwner`, `nonReentrant`: validates pool, fetches adapter, executes swap with optional flash loan, converts profit to USDC
  - `executeMultiHopArb(MultiHopArbParams)` — `onlyOwner`, `nonReentrant`: chains multiple swaps across different pools, verifies net profit in original token
  - `executeOperation(asset, amount, premium, initiator, params)` — Aave flash loan callback; routes to backrun or multi-hop depending on encoded action string
  - `distributeToVault(amount)` — `onlyOwner`, `nonReentrant`: approves vault and calls `vault.distributeProfit(amount)`
  - `setAdapter(dexType, adapter)` — `onlyOwner`: registers DEX-specific adapter
  - `_convertToUSDC(token, amount)` — internal: converts any token to stablecoin via Uniswap V3 swap; returns 0 on failure (try/catch, best-effort)
  - `uniswapV3SwapCallback(...)` — minimal V3 callback (required by interface but mostly pass-through)
  - `transferOwnership(newOwner)` / `acceptOwnership()` — two-step ownership transfer override
  - `withdrawProfit(token)` — `onlyOwner`: emergency token withdrawal to owner
- **Hardcoded values:** `MAX_SLIPPAGE_BPS = 500` (5%)
- **Imports / Dependencies:** `IERC20`, `SafeERC20`, `ReentrancyGuard`, `Ownable` (OZ); `IAave`, `IDEXAdapter`, `DEXRegistry`
- **Connected to:** Called by backend `transactionBuilder.ts`; calls `ArbitrageVault.distributeProfit()`; delegates swaps to `UniswapV2Adapter`/`UniswapV3Adapter`; reads pool info from `DEXRegistry`
- **Status:** Complete

---

**`src/ArbitrageVault.sol`** (644 lines)
- **Type:** Solidity contract
- **Purpose:** Multi-user profit-sharing vault. Users deposit ETH as principal; bot distributes USDC profits proportionally using a MasterChef-style accumulator. Implements multiple security layers including withdrawal delays, account freezing, guardian recovery, and rate limiting.
- **Key functions:**
  - `deposit()` — `payable`, `nonReentrant`: accepts 0.005–50 ETH, tracks per-user principal, settles pending profit
  - `requestWithdrawal(profitAmount, principalAmount)` — Step 1 of 2-step withdrawal; stores request with 12-hour timestamp
  - `executeWithdrawal()` — Step 2: executes after delay, enforces 25% daily principal rate limit
  - `distributeProfit(profitTotal)` — `onlyExecutor`, `nonReentrant`: pulls USDC from sender, deducts operator fee, updates `accProfitPerUnit` accumulator
  - `freezeAccount(user)` — callable by user or their designated guardian
  - `initiateUnfreeze()` / `completeUnfreeze()` — 3-day cooling-off period after freeze
  - `setGuardian(guardian)` — designate trusted address for recovery
  - `nominateNewOwner(user, newOwner)` — guardian starts 7-day recovery countdown
  - `completeRecovery(user)` — transfers all assets to new address after delay
  - `proposeSetPerformanceFee(newFeeBps)` / `executeSetPerformanceFee(newFeeBps)` — 24-hour timelock for fee changes
  - `getMyAccount()` — returns 13-field struct: principal, pendingProfit, claimableProfit, totalBalance, isPaused, totalDeposited, totalWithdrawn, pendingRequest details, isFrozen, guardian
  - `getVaultStats()` — returns vault-wide stats for dashboard
- **Hardcoded values:**
  - `MIN_DEPOSIT = 0.005 ether`
  - `MAX_DEPOSIT_PER_USER = 50 ether`
  - `MIN_PERFORMANCE_FEE_BPS = 1500` (15%), `MAX_PERFORMANCE_FEE_BPS = 2500` (25%)
  - `DAILY_WITHDRAW_LIMIT_BPS = 2500` (25% of principal per 24h)
  - `TIMELOCK_DURATION = 24 hours`
  - `MAX_USERS = 10_000`
  - `RECOVERY_DELAY = 7 days` (fixed, non-configurable)
  - Default `withdrawalDelay = 12 hours` (configurable 1h–7d)
  - Default `unfreezeDelay = 3 days` (configurable 1d–30d)
  - Default `performanceFeeBps = 1500` (constructor parameter)
- **Imports / Dependencies:** `Ownable`, `ReentrancyGuard`, `IERC20`, `SafeERC20` (OZ)
- **Connected to:** Called by `ArbitrageBot.distributeToVault()`; ABI embedded in `VaultService.ts`; ABI embedded in `saas-frontend/src/lib/constants.ts`; called directly by frontend via MetaMask
- **Status:** Complete

---

**`src/DEXRegistry.sol`** (751 lines)
- **Type:** Solidity contract
- **Purpose:** Centralized on-chain registry for DEX integrations and pools. Backend queries it for high-opportunity pools; bot validates trades against it; scripts register new DEXes and pools.
- **Key functions:**
  - `registerDEX(dexType, name, factory, router)` — `onlyOwner`: add DEX configuration
  - `addPool(poolAddr, dexType, token0, token1, fee, tvl, volume24h)` — `onlyAuthorizedUpdater`: register a pool with metadata
  - `updatePool(poolAddr, tvl, volume24h)` — `onlyAuthorizedUpdater`: refresh metrics, recalculate opportunity score
  - `getHighOpportunityPools()` — view: returns pools with `opportunityScore >= minOpportunityScore` and `isActive == true`
  - `getPoolInfo(poolAddr)` — view: returns full `PoolInfo` struct
  - `approvePool(poolAddr)` / `revokePool(poolAddr)` — whitelist management
  - `authorizeUpdater(updater)` — whitelist backend accounts to push pool metrics
  - `_calculateOpportunityScore(tvl, volume24h, createdAt)` — internal: TVL(40%) + Volume(40%) + Age(20%), result 0–100
- **Hardcoded values:**
  - `MAX_POOLS_PER_DEX = 10_000`
  - `minOpportunityScore = 30` (default, configurable)
  - `minTVL = 1000 ether` (default, configurable — lowered to 1 ETH for testnet via `RegisterPools.s.sol`)
  - `DEXType` enum: UniswapV2(0), UniswapV3(1), SushiSwap(2), Curve(3), Balancer(4), dYdX(5), Aerodrome(6), PancakeSwap(7), Quickswap(8), TraderJoe(9), CamelotDEX(10), Orca(11), Raydium(12)
- **Imports / Dependencies:** `Ownable`, `ReentrancyGuard` (OZ)
- **Connected to:** Read by `ArbitrageBot.sol` to validate pools before trading; read by `poolDiscoveryService.ts` via `RegistryService.ts`; written to by `RegisterPools.s.sol` and `RegisterDEXes.s.sol`
- **Status:** Complete

---

**`src/adapters/IDEXAdapter.sol`** (77 lines)
- **Type:** Solidity interface
- **Purpose:** DEX-agnostic swap interface. Every adapter must implement this. `ArbitrageBot` uses this interface to delegate trades without knowing the underlying protocol.
- **Key functions / exports:**
  - `swap(SwapParams) external payable returns (SwapResult)` — execute swap
  - `getAmountOut(tokenIn, tokenOut, amountIn)` — estimate output
  - `getAmountIn(tokenIn, tokenOut, amountOut)` — estimate input
  - `getPool(tokenIn, tokenOut)` — lookup pool address
  - `poolExists(tokenIn, tokenOut, minLiquidity)` — check pool with minimum liquidity
  - `getReserves(pool, token0, token1)` — reserve inspection
  - `getDEXName()` / `getDEXVersion()` — metadata
  - `validateSwapParams(SwapParams)` — parameter validation
- **Structs:** `SwapParams { tokenIn, tokenOut, amountIn, minAmountOut, data (DEX-specific bytes), deadline }`, `SwapResult { amountIn, amountOut, tokenIn, tokenOut, success }`
- **Imports / Dependencies:** None
- **Connected to:** Implemented by `UniswapV2Adapter.sol`, `UniswapV3Adapter.sol`; referenced by `ArbitrageBot.sol`
- **Status:** Complete

---

**`src/adapters/UniswapV2Adapter.sol`** (504 lines)
- **Type:** Solidity contract
- **Purpose:** Adapter for all Uniswap V2-compatible AMMs (UniswapV2, SushiSwap, etc.). Implements `IDEXAdapter`. Includes pair address caching, authorized caller whitelist, and a circuit breaker.
- **Key functions:**
  - `swap(params)` — transfers `tokenIn` to pair, calls `pair.swap()` directly (low-level, not through router)
  - `getAmountOut(tokenIn, tokenOut, amountIn)` — uses V2 formula: `(amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)`
  - `getPool(tokenIn, tokenOut)` — checks pair cache first, then queries factory
  - `authorizeCaller(caller)` — `onlyOwner`: whitelist addresses allowed to call `swap()`
  - `toggleCircuitBreaker()` — `onlyOwner`: emergency pause
- **Hardcoded values:** `DEX_NAME = "Uniswap V2"`, `DEX_VERSION = "2.0"`; 0.3% fee baked into AMM formula
- **Imports / Dependencies:** `Ownable` (OZ); inline interfaces for `IUniswapV2Factory`, `IUniswapV2Pair`
- **Connected to:** Called by `ArbitrageBot.sol` via `IDEXAdapter`; deployed by `DeployAdapters.s.sol`; wired with `authorizeCaller(bot)` in `DeployAdapters.s.sol`
- **Status:** Complete

---

**`src/adapters/UniswapV3Adapter.sol`** (147 lines)
- **Type:** Solidity contract
- **Purpose:** Adapter for Uniswap V3 pools. Implements `IDEXAdapter`. Executes swaps directly against V3 pool contracts (not through SwapRouter). Pool address must be ABI-encoded in `SwapParams.data`.
- **Key functions:**
  - `swap(params)` — decodes pool from `params.data`, calls `pool.swap()`, handles V3 callback
  - `uniswapV3SwapCallback(amount0Delta, amount1Delta, data)` — pulls tokenIn from payer to pool
  - `getPool(tokenIn, tokenOut)` — queries factory with hardcoded 0.3% fee tier
  - `getAmountOut(...)` / `getAmountIn(...)` — **always return 0** (quoter contract is stored but not called)
  - `getReserves(...)` — always returns `(0, 0)` (V3 has no traditional reserves)
- **Hardcoded values:** `MIN_SQRT_RATIO = 4295128739`, `MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342`; hardcoded `fee = 3000` (0.3%) in `getPool()`
- **Imports / Dependencies:** Inline interfaces for `IUniswapV3Pool`, `IUniswapV3Factory`, `IUniswapV3SwapCallback`
- **Connected to:** Called by `ArbitrageBot.sol`; deployed by `DeployAdapters.s.sol`
- **Status:** Partial — functional for direct pool swaps but `getAmountOut/In` return 0, meaning the backend cannot estimate expected V3 output on-chain. Only queries 0.3% fee tier.

---

**`src/interfaces/IAave.sol`** (42 lines)
- **Type:** Solidity interface file
- **Purpose:** Minimal Aave V3 interface definitions needed for flash loan integration
- **Key functions / exports:**
  - `IPoolAddressesProvider.getPool()` — get Aave pool address
  - `IPool.flashLoanSimple(receiverAddress, asset, amount, params, referralCode)` — initiate flash loan
  - `IFlashLoanSimpleReceiver.executeOperation(...)` — callback interface that `ArbitrageBot` must implement
- **Imports / Dependencies:** None
- **Connected to:** Imported by `ArbitrageBot.sol`
- **Status:** Complete

---

### TEST FILES (`test/`)

---

**`test/ArbitrageBot.t.sol`** (44 lines)
- **Type:** Solidity test contract (Foundry)
- **Purpose:** Basic sanity tests for `ArbitrageBot` constructor and access control
- **Key functions:**
  - `test_Initialization()` — verifies constructor sets vault, registry, stablecoin correctly
  - `test_SetVaultAddress_OnlyOwner()` — tests `onlyOwner` modifier and vault address update
- **Setup:** Mock addresses `address(0x1)` through `address(0x4)` for owner, vault, provider, USDC
- **Imports / Dependencies:** `forge-std/Test.sol`, `ArbitrageBot.sol`, `DEXRegistry.sol`
- **Connected to:** `src/ArbitrageBot.sol`
- **Status:** Minimal — only 2 tests; zero coverage of `executeBackrun`, flash loan path, multi-hop, `_convertToUSDC`, or `distributeToVault`

---

**`test/ArbitrageVaultSecurity.t.sol`** (238 lines)
- **Type:** Solidity test contract (Foundry)
- **Purpose:** Comprehensive security scenario tests for `ArbitrageVault`
- **Key functions (11 tests):**
  - `test_Withdrawal_Delay_Pipeline()` — verifies request → 12h `vm.warp` → execute works; pre-delay reverts
  - `test_Self_Freeze_Blocks_Withdrawal()` — user freezes own account, pending withdrawal blocked
  - `test_Guardian_Freeze()` — guardian freezes compromised account
  - `test_Unfreeze_CoolingOff_Period()` — 3-day unfreeze delay enforced
  - `test_Recovery_Process()` — guardian nominates, 7-day delay, assets transferred
  - `test_Recovery_Cancellation_By_User()` — user cancels bogus recovery
  - `test_Recovery_Cannot_Delete_Recovered_Account()` — regression: recovered account can't be immediately reattacked
  - `test_Frozen_Account_Cannot_Deposit()` — frozen account blocks new deposits
- **Setup:** MockUSDC (6 decimals), `ArbitrageVault` at 15% fee, two users with 100 ETH each, guardian address
- **Imports / Dependencies:** `forge-std/Test.sol`, `ArbitrageVault.sol`, inline `MockUSDC`
- **Connected to:** `src/ArbitrageVault.sol`
- **Status:** Complete

---

**`test/RealScenarios.t.sol`** (100 lines)
- **Type:** Solidity test contract (Foundry)
- **Purpose:** End-to-end integration tests covering the full profit distribution flow
- **Key functions:**
  - `test_SaaS_EndToEnd_BotDistribution()` — bot distributes $100 USDC profit, operator claims 15% fee ($15), user net is $85
  - `test_SaaS_Withdrawal_RateLimit_Fixed()` — two-step withdrawal with rate limiting: user cannot withdraw >25% in first 24h
- **Setup:** MockUSDC, DEXRegistry, ArbitrageBot, ArbitrageVault; bot authorized as vault executor; user deposits 100 ETH
- **Imports / Dependencies:** `forge-std/Test.sol`, `ArbitrageVault.sol`, `ArbitrageBot.sol`, `DEXRegistry.sol`
- **Connected to:** All three main contracts
- **Status:** Complete

---

### DEPLOY SCRIPTS (`script/`)

---

**`script/DeployAll.s.sol`** (193 lines)
- **Type:** Foundry deploy script
- **Purpose:** Primary unified deployment — deploys DEXRegistry, ArbitrageVault, and ArbitrageBot in a single broadcast, predicts all addresses before deploying, and wires vault authorization automatically
- **Key functions:**
  - `run()` — validates env, predicts all three CREATE addresses, deploys in order, calls `vault.authorizeExecutor(bot)`, prints summary
  - Address prediction via `vm.computeCreateAddress(deployer, nonce + N)` — prevents `address(0)` wiring bugs
  - Sanity `require` checks: predicted address must match actual after each deploy
- **Hardcoded values:**
  - Deployer: `0xf9cBC41849dB34cA64D2e3a9120020Bf3Ef76F5C`
  - USDC by chain: Base mainnet `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, Arbitrum `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
  - Default `performanceFeeBps = 2000` (20%)
- **Imports / Dependencies:** `forge-std/Script.sol`, `DEXRegistry`, `ArbitrageVault`, `ArbitrageBot`
- **Connected to:** Reads `PRIVATE_KEY`, `AAVE_POOL_ADDRESS` from env; optional `EXECUTOR_ADDRESS`, `PERFORMANCE_FEE_BPS`
- **Status:** Complete — this is the script used to produce the current deployment (broadcast confirmed)

---

**`script/Deploy.s.sol`** (55 lines)
- **Type:** Foundry deploy script (superseded)
- **Purpose:** Old standalone bot deployment — does not wire vault automatically
- **Hardcoded values:** None (all from env)
- **Connected to:** Reads `PRIVATE_KEY`, `AAVE_PROVIDER_ADDRESS`, `DEX_REGISTRY_ADDRESS`, `PROFIT_TOKEN_ADDRESS`, optional `VAULT_ADDRESS`
- **Status:** Complete but superseded by `DeployAll.s.sol` — produces stale broadcast at `broadcast/Deploy.s.sol/84532/`

---

**`script/DeployDEXRegistry.s.sol`** (50 lines)
- **Type:** Foundry deploy script (superseded)
- **Purpose:** Standalone registry deployment
- **Status:** Complete but superseded; produced stale broadcast at `broadcast/DeployDEXRegistry.s.sol/84532/`

---

**`script/DeployVault.s.sol`** (80 lines)
- **Type:** Foundry deploy script
- **Purpose:** Flexible vault deployment — wires to existing bot and authorizes executor if provided
- **Hardcoded values:** Default fee 2000 bps; validates fee range 1500–2500
- **Connected to:** Reads `PRIVATE_KEY`, `PROFIT_TOKEN_ADDRESS`, optional `ARBITRAGE_BOT_ADDRESS`, `EXECUTOR_ADDRESS`
- **Status:** Complete

---

**`script/DeployVaultOnly.s.sol`** (59 lines)
- **Type:** Foundry deploy script
- **Purpose:** Fallback — deploys vault only when `DeployAll` failed partway through
- **Hardcoded values:** USDC Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`; deployer `0xf9cBC41849dB34cA64D2e3a9120020Bf3Ef76F5C`
- **Connected to:** Reads `ArbitrageBot` address from env
- **Status:** Complete — produced a stale broadcast (0xb1a8...) from an intermediate deployment

---

**`script/DeployAdapters.s.sol`** (105 lines)
- **Type:** Foundry deploy script
- **Purpose:** Deploys UniswapV3Adapter and UniswapV2Adapter, wires them into ArbitrageBot, authorizes bot on V2 adapter
- **Hardcoded values:**
  - V3 Factory Mainnet: `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`
  - V3 Factory Sepolia: `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24`
  - V2 Factory: `0x8909Dc15e40953B386fa8f440Db4C4702d4f9b93`
  - V2 Router: `0x4752BA5dbc23F44d87826aeF3c0c8E6084bF3917`
- **Connected to:** Reads `ArbitrageBot` from env; sets V2 adapter for both `UniswapV2` and `SushiSwap` DEX types
- **Status:** Complete — must be run after `DeployAll` (not included in it)

---

**`script/RegisterDEXes.s.sol`** (155 lines)
- **Type:** Foundry deploy script
- **Purpose:** Registers 7 canonical DEXes in the registry: UniswapV2, UniswapV3, SushiSwap, Aerodrome, Curve, Balancer, PancakeSwap — all with Base mainnet and Sepolia addresses
- **Hardcoded values:** All factory and router addresses for Base mainnet (8453) and Base Sepolia (84532)
- **Connected to:** Reads `DEX_REGISTRY_ADDRESS` from env
- **Status:** Complete

---

**`script/RegisterPools.s.sol`** (160 lines)
- **Type:** Foundry deploy script
- **Purpose:** Discovers and registers Uniswap V3 WETH/USDC pools from the on-chain factory; lowers testnet thresholds for easier testing
- **Hardcoded values:**
  - WETH: `0x4200000000000000000000000000000000000006`
  - USDC Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
  - V3 Factory Sepolia: `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24`
  - Sets `minTVL = 1 ether`, `minOpportunityScore = 0` (testnet only)
  - Synthetic TVL: 1 ether, Volume: 0
- **Connected to:** Reads `DEX_REGISTRY_ADDRESS` from env; queries Uniswap V3 factory on-chain
- **Status:** Complete — includes warning if pool address is `address(0)` (pool not deployed on that network)

---

### BACKEND (`arbitrage-bot-backend/`)

---

**`arbitrage-bot-backend/.env`** (66 lines)
- **Type:** Environment configuration
- **Purpose:** All 20 configuration variables for the backend process
- **Key values (complete list):**

| Variable | Value | Purpose |
|---|---|---|
| `CHAIN` | `baseSepolia` | Active chain |
| `BASE_RPC_URL` | `https://mainnet.base.org` | Base mainnet HTTP RPC |
| `BASE_WS_URL` | `wss://base-rpc.publicnode.com` | Base mainnet WebSocket |
| `BASE_SEPOLIA_RPC_URL` | `https://sepolia.base.org` | Base Sepolia HTTP RPC |
| `BASE_SEPOLIA_WS_URL` | `wss://sepolia.base.org` | Base Sepolia WebSocket |
| `PRIVATE_KEY` | `0xcffdd4ec...` (66 chars) | Hot wallet for transactions (**testnet key**) |
| `CONTRACT_ADDRESS` | `0xcadDED8434819D70b97922A8B5FF84Cf6Ba6fE86` | ArbitrageBot address |
| `VAULT_ADDRESS` | `0x1801eEa533d4362A1893Cb5D7f25BF04d1305b01` | ArbitrageVault address |
| `DEX_REGISTRY_ADDRESS` | `0x3C76b15812a24cd94e03EEE5347b84Cea2059C68` | DEXRegistry address |
| `AAVE_POOL_ADDRESS` | `0xe20fCBdBfFC4Dd138cE8b440322649382F89F21A` | Aave V3 PoolAddressesProvider (Base **mainnet**) |
| `PROFIT_TOKEN_ADDRESS` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Native USDC on Base **mainnet** |
| `MIN_PROFIT_BPS` | `20` | Min profit threshold (0.20%) |
| `MAX_GAS_PRICE` | `100` | Max gas price in Gwei |
| `FLASH_LOAN_ENABLED` | `true` | Enable Aave V3 flash loans |
| `BATCH_OPERATIONS` | `true` | Batch flag |
| `MONITORING_INTERVAL` | `1000` | Main loop interval (ms) |
| `PERFORMANCE_FEE_BPS` | `2000` | Vault performance fee (20%) |
| `VAPID_PUBLIC_KEY` | `BC...` | Web Push public key |
| `VAPID_PRIVATE_KEY` | `Fz...` | Web Push private key |
| `VAPID_SUBJECT` | `mailto:admin@mevbot.io` | Web Push sender |

- **WARNING:** `AAVE_POOL_ADDRESS` and `PROFIT_TOKEN_ADDRESS` here point to **Base mainnet** addresses, while `CHAIN=baseSepolia`. This is a configuration mismatch — the Aave and USDC addresses should be the Sepolia equivalents when running on testnet.
- **Status:** Partially misconfigured (mainnet Aave/USDC addresses while targeting Sepolia)

---

**`arbitrage-bot-backend/package.json`** (44 lines)
- **Type:** Node.js package config
- **Purpose:** Dependency manifest and npm scripts
- **Key scripts:** `dev` (ts-node), `start` (compiled), `build` (tsc), `testnet` (CHAIN=baseSepolia), `mainnet` (CHAIN=base), `monitor` (standalone dashboard)
- **Key dependencies:** `ethers@6.10.0`, `better-sqlite3@9.2.2`, `express@4.18.2`, `socket.io@4.7.2`, `web-push@3.6.7`, `winston@3.11.0`, `axios@1.6.2`, `ws@8.15.0`
- **Status:** Complete

---

**`arbitrage-bot-backend/tsconfig.json`** (25 lines)
- **Type:** TypeScript compiler config
- **Purpose:** Configure TypeScript compilation
- **Key values:** `target: ES2020`, `module: Node16`, `outDir: ./dist`, `rootDir: ./src`, `strict: true`, `sourceMap: true`
- **Status:** Complete

---

**`arbitrage-bot-backend/src/index.ts`** (616 lines)
- **Type:** TypeScript module — main entry point
- **Purpose:** Orchestrates all backend services. Main `ArbitrageBot` class (backend, not the contract) coordinates pool discovery, opportunity detection, transaction execution, and profit tracking in a continuous loop.
- **Key functions / exports:**
  - `ArbitrageBot` class (default export)
  - `constructor()` — instantiates all services
  - `start()` — boots, verifies contract deployment, wires event streams, starts 3 loops (execution, metrics, maintenance)
  - `_startExecutionLoop()` — main loop every `monitoringInterval` ms: detects 2-hop/3-hop opportunities, validates gas, builds tx, simulates, submits
  - `_processOpportunity(opportunity)` — validates profit > gas, builds and submits transaction
  - `stop()` / `pause()` / `resume()` — lifecycle management
  - `getStats()` — returns runtime metrics + vault stats
- **Imports / Dependencies:** All services in src/; ethers; config
- **Connected to:** Reads config from `config/index.ts`; calls all service classes
- **Status:** Complete

---

**`arbitrage-bot-backend/src/config/index.ts`** (74 lines)
- **Type:** TypeScript module
- **Purpose:** Loads and validates all environment variables, maps chain names to RPC URLs and Aave addresses
- **Key functions / exports:** `config: BotConfig` (singleton)
- **Hardcoded values:**
  - Aave V3 PoolAddressesProvider: Base mainnet `0xe20fCBdBfFC4Dd138cE8b440322649382F89F21A`, Base Sepolia `0x9E0fD28470aae30d95b4eE3cC72Cb42f75b80f40`, Arbitrum `0x794a61358D6845594F94aDc1855b3b6A8E0B5a89`, Arbitrum Sepolia `0x25259f38E4A48a7F3A48d5e1E0e0F37a9aFd30D`
- **Imports / Dependencies:** `dotenv`, `BotConfig` type, `ChainType` enum, `logger`
- **Connected to:** Every other backend module imports `config`
- **Status:** Complete

---

**`arbitrage-bot-backend/src/types/index.ts`** (188 lines)
- **Type:** TypeScript type definitions
- **Purpose:** All shared TypeScript interfaces and enums
- **Key exports:**
  - Enums: `DEXType` (7 types), `DEXProtocol` (4 styles), `ChainType` (4 chains)
  - Interfaces: `Pool`, `Token`, `ArbitrageOpportunity`, `RouteHop`, `TransactionParams`, `ExecutionResult`, `GasMetrics`, `BotConfig`, `BotMetrics`, `ProfitRecord`, and 6 others
- **Status:** Complete

---

**`arbitrage-bot-backend/src/utils/logger.ts`** (43 lines)
- **Type:** TypeScript module
- **Purpose:** Winston logger singleton with console + file transports
- **Key exports:** `logger`
- **Key values:** Log files: `logs/bot.log` (10MB, 5 rotations), `logs/error.log`; level from `LOG_LEVEL` env
- **Status:** Complete

---

**`arbitrage-bot-backend/src/core/eventListener.ts`** (212 lines)
- **Type:** TypeScript module
- **Purpose:** Monitors DEX pool events (Uniswap V2 Sync, Uniswap V3 Swap) via HTTP polling; emits `priceUpdate` events
- **Key functions / exports:** `EventListener extends EventEmitter`; `startMonitoring()`, `getPrice(poolAddress)`, `stop()`
- **Hardcoded values:**
  - Uniswap V3 Swap topic: `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`
  - Uniswap V2 Sync topic: `0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1`
  - `POLL_INTERVAL_MS = 3_000`, `LOG_BLOCK_RANGE = 50`
- **Status:** Complete

---

**`arbitrage-bot-backend/src/core/opportunityDetector.ts`** (362 lines)
- **Type:** TypeScript module
- **Purpose:** Detects arbitrage opportunities using Bellman-Ford (cycle detection) and 2-hop/3-hop pattern matching
- **Key functions / exports:** `OpportunityDetector`; `detectArbitrageCycles(startToken)`, `detectSimpleOpportunities()`
- **Hardcoded values:** DEX-specific slippage: UniswapV2/SushiSwap 0.5%, UniswapV3/Aerodrome 0.3%, Curve 0.2%, Balancer/PancakeSwap 0.4%
- **Status:** Complete

---

**`arbitrage-bot-backend/src/core/routeCalculator.ts`** (224 lines)
- **Type:** TypeScript module
- **Purpose:** Finds optimal routes between tokens using a Dijkstra-variant; calculates flash loan feasibility
- **Key functions / exports:** `RouteCalculator`; `findOptimalRoute(tokenIn, tokenOut, amountIn)`, `findFlashLoanRoute(...)`, `rankRoutesByProfitability(...)`
- **Hardcoded values:** `maxHops = 10`; Aave 0.09% flash loan premium baked into feasibility check
- **Status:** Complete

---

**`arbitrage-bot-backend/src/core/poolDiscoveryService.ts`** (991 lines)
- **Type:** TypeScript module — largest file in backend
- **Purpose:** Discovers pools from on-chain factory events; seeds from DEXRegistry on startup; runs continuous discovery loop
- **Key functions / exports:** `PoolDiscoveryService extends EventEmitter`; `start()`, `getHighOpportunityPools(minScore)`, `discoverPoolsOnDEX(dexType)`
- **Hardcoded values:**
  - Factory addresses for Base mainnet, Base Sepolia, Arbitrum (UniswapV2, V3, SushiSwap, Aerodrome, PancakeSwap, Curve, Balancer)
  - PairCreated topic: `0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9`
  - PoolCreated topic: `0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118`
  - `LOG_BATCH_SIZE = 2000`, discovery interval 120s, metrics refresh 300s
- **Imports / Dependencies:** `ethers`, `config`, `logger`, `RegistryService`, `types`
- **Connected to:** Feeds discovered pools to `EventListener` and `OpportunityDetector`
- **Status:** Partial — `CurveDiscoveryHandler` and `BalancerDiscoveryHandler` are stub classes (not implemented)

---

**`arbitrage-bot-backend/src/execution/gasOptimizer.ts`** (299 lines)
- **Type:** TypeScript module
- **Purpose:** Validates that opportunity profit exceeds estimated gas cost; manages a circuit breaker and daily loss limit
- **Key functions / exports:** `GasOptimizer`; `shouldExecuteOpportunity(opportunity)`, `recordExecution(result)`, `getCircuitBreakerStatus()`
- **Hardcoded values:** Per-DEX gas estimates (UniswapV3: 100k, Curve: 80k, Balancer: 120k, dYdX: 150k); circuit breaker at 5 consecutive failures
- **Status:** Complete

---

**`arbitrage-bot-backend/src/execution/transactionBuilder.ts`** (415 lines)
- **Type:** TypeScript module
- **Purpose:** Builds calldata for ArbitrageBot contract calls, encoding DEX-specific swap paths
- **Key functions / exports:** `TransactionBuilder`; `buildOpportunityTransaction(opportunity, botAddress, initialAmount, gasPrice, useFlashLoan?)`, `simulateTransaction(tx, from)`
- **Hardcoded values:**
  - Router addresses for all 7 DEXes on Base mainnet and Base Sepolia
  - Inline ABIs for UniswapV3 Router, Curve, Balancer, UniswapV2, ArbitrageBot
  - Gas estimate formula: `80k + (110k × hops) + 120k conversion + 140k flash loan overhead`
  - Default slippage: 100 bps (1%)
- **Status:** Complete

---

**`arbitrage-bot-backend/src/execution/transactionSubmitter.ts`** (207 lines)
- **Type:** TypeScript module
- **Purpose:** Signs and broadcasts transactions; supports direct broadcast and MEV relay submission; parses `ArbExecuted`/`BackrunExecuted` events from receipts
- **Key functions / exports:** `TransactionSubmitter`; `submitTransaction(txParams)`, `submitBatchTransactions(txParamsList)`
- **Hardcoded values:**
  - MEV relay URLs: Flashbots `https://relay.flashbots.net`, bloXroute `https://api.bloxroute.com/ethereum/public/tx`
  - Event signatures: `ArbExecuted(uint256 profitUSDC)`, `BackrunExecuted(address indexed pool, uint256 profitUSDC)`
  - `maxRetries = 3`, `retryDelay = 1000ms`
  - USDC decimals: 6
- **Status:** Complete

---

**`arbitrage-bot-backend/src/monitoring/profitTracker.ts`** (531 lines)
- **Type:** TypeScript module
- **Purpose:** SQLite database for trade history, daily summaries, and metrics snapshots; provides CSV export
- **Key functions / exports:** `ProfitTracker`; `recordTrade(trade)`, `getMetrics()`, `getDailySummary(date)`, `exportTradesCSV(start, end)`, `cleanOldData(daysToKeep=90)`
- **Hardcoded values:** DB path `./bot-data.db`; metrics cache TTL 60s; data retention 90 days
- **Connected to:** Creates `bot-data.db` in backend working directory (file exists: `arbitrage-bot-backend/bot-data.db`)
- **Status:** Complete

---

**`arbitrage-bot-backend/src/monitoring/dashboard.ts`** (811 lines)
- **Type:** TypeScript module — largest file in monitoring
- **Purpose:** Express.js + Socket.io real-time dashboard server; serves HTML dashboard, REST API, and WebSocket events; supports Web Push notifications
- **Key functions / exports:** `Dashboard`; `start()`, `broadcastMetricsUpdate(metrics)`, `broadcastTradeUpdate(trade)`, `broadcastAlert(alert)`
- **REST endpoints:** `GET /api/health`, `/api/config` (returns vaultAddress), `/api/bot/state`, `/api/metrics`, `/api/trades/recent`, `/api/alerts`, `/api/dexes`; `POST /api/bot/pause`, `/api/bot/resume`, `/api/push/subscribe`
- **Hardcoded values:** Default port 3000, rate limit 100 req/15min per IP
- **Connected to:** Frontend `useWeb3.ts` calls `GET /api/config` to get `vaultAddress`
- **Status:** Complete

---

**`arbitrage-bot-backend/src/services/VaultService.ts`** (329 lines)
- **Type:** TypeScript module
- **Purpose:** Manages profit distribution to ArbitrageVault; batches small amounts; listens for vault events
- **Key functions / exports:** `VaultService extends EventEmitter`; `distributeProfit(profitUnits)`, `accumulateAndDistribute(profitUnits)`, `getVaultStats()`
- **Hardcoded values:** `MIN_DISTRIBUTION_UNITS = 1_000_000` (1 USDC); inline ABI for vault and bot; `POLL_INTERVAL_MS = 15_000`
- **Status:** Complete

---

**`arbitrage-bot-backend/src/services/RegistryService.ts`** (90 lines)
- **Type:** TypeScript module
- **Purpose:** Writes pool data to the on-chain DEXRegistry contract
- **Key functions / exports:** `RegistryService`; `addPool(...)`, `updatePool(...)`
- **Hardcoded values:** Inline ABI for DEXRegistry `addPool` and `updatePool`
- **Status:** Complete

---

**`arbitrage-bot-backend/src/services/NotificationService.ts`** (99 lines)
- **Type:** TypeScript module
- **Purpose:** Sends Web Push notifications for alerts; singleton pattern
- **Key functions / exports:** `NotificationService`; `notify(payload)`
- **Connected to:** Reads VAPID keys from env; uses `StorageService` for subscriptions
- **Status:** Complete

---

**`arbitrage-bot-backend/src/services/StorageService.ts`** (80 lines)
- **Type:** TypeScript module
- **Purpose:** Manages Web Push subscription persistence in SQLite
- **Key functions / exports:** `StorageService`; `addSubscription(sub)`, `getAllSubscriptions()`, `removeSubscription(endpoint)`
- **Status:** Complete

---

**`arbitrage-bot-backend/public/sw.js`** (29 lines)
- **Type:** JavaScript service worker
- **Purpose:** Handles Web Push `push` events in the browser; displays notification and handles click-to-open
- **Status:** Complete

---

**`arbitrage-bot-backend/tests/`**
- **Type:** Directory
- **Purpose:** Backend test directory
- **Status:** Empty — no backend tests exist

---

### FRONTEND (`saas-frontend/`)

---

**`saas-frontend/package.json`**
- **Type:** Node.js package config
- **Purpose:** Next.js 16.2.3 app dependencies
- **Key dependencies:** `next@16.2.3`, `react@19.2.4`, `ethers@6.16.0`, `framer-motion@12.38.0`, `lucide-react@1.8.0`, `tailwindcss@4`
- **Status:** Complete

---

**`saas-frontend/tsconfig.json`**
- **Type:** TypeScript compiler config
- **Key values:** `module: ESNext`, `moduleResolution: bundler`, `strict: true`; `@/*` path alias → `./src/*`
- **Status:** Complete

---

**`saas-frontend/next.config.ts`**
- **Type:** Next.js config
- **Purpose:** Empty config (no custom webpack, no rewrites)
- **Status:** Complete (minimal / boilerplate)

---

**`saas-frontend/src/app/layout.tsx`** (33 lines)
- **Type:** React component — Next.js root layout
- **Purpose:** Root layout wrapper; sets `<html lang="en">`, imports Geist font, applies global CSS
- **Status:** Complete

---

**`saas-frontend/src/app/page.tsx`** (258 lines)
- **Type:** React component — main page
- **Purpose:** Top-level dashboard page; renders wallet connection UI and all four dashboard tabs (Overview, Bot Activity, Vault Actions, Security)
- **Key functions / components:** Default export `Home`; uses `useWeb3()` hook; tab switching between 4 panels; displays wallet address, vault address, connection error
- **Connected to:** `useWeb3.ts` hook; `Overview`, `BotActivity`, `VaultActions`, `SecurityDashboard` components
- **Status:** Complete

---

**`saas-frontend/src/app/globals.css`** (26 lines)
- **Type:** CSS
- **Purpose:** TailwindCSS v4 base styles and CSS variables
- **Status:** Complete

---

**`saas-frontend/src/hooks/useWeb3.ts`** (106 lines)
- **Type:** React hook
- **Purpose:** Core Web3 integration — MetaMask connection, vault contract instantiation, config fetching from backend
- **Key functions / exports:** `useWeb3()` — returns `{ account, signer, provider, vaultContract, vaultAddress, connectWallet, disconnectWallet, loading, error }`
- **Hardcoded values:** Backend URL resolution: `NEXT_PUBLIC_VAULT_ADDRESS` env var as fallback; calls `http://localhost:3000/api/config` to get vault address
- **Connected to:** `saas-frontend/src/lib/constants.ts` (VAULT_ABI, BACKEND_URL); calls backend `/api/config`; creates `ethers.Contract(vaultAddress, VAULT_ABI, signer)`
- **Status:** Complete — but vault address discovery fails silently if backend is offline and `NEXT_PUBLIC_VAULT_ADDRESS` is not set

---

**`saas-frontend/src/lib/constants.ts`** (23 lines)
- **Type:** TypeScript module
- **Purpose:** Central config — VAULT_ABI (human-readable) and BACKEND_URL
- **Key exports:**
  - `VAULT_ABI` — 19-function ABI for ArbitrageVault (inline strings, not from compiled artifacts)
  - `BACKEND_URL = "http://localhost:3000"` — **hardcoded**, no env override
- **Hardcoded values:** `BACKEND_URL = "http://localhost:3000"` (production would need `NEXT_PUBLIC_BACKEND_URL`)
- **Connected to:** `useWeb3.ts`, all dashboard components
- **Status:** Complete for local dev; not production-ready (BACKEND_URL hardcoded)

---

**`saas-frontend/src/components/dashboard/Overview.tsx`** (73 lines)
- **Type:** React component
- **Purpose:** Displays vault-wide stats (active principal, paused principal, user count, lifetime profit, fees accrued, performance fee %, vault balance, pending operator fees)
- **Key functions:** Renders data from `getVaultStats()` response; formats ETH and USDC amounts
- **Connected to:** Called by `page.tsx`; uses `vaultContract.getVaultStats()` via parent
- **Status:** Complete

---

**`saas-frontend/src/components/dashboard/VaultActions.tsx`** (265 lines)
- **Type:** React component
- **Purpose:** Deposit/withdraw/pause UI; handles 2-step withdrawal flow (request → execute); displays account state
- **Key functions:** `handleDeposit()`, `handleRequestWithdrawal()`, `handleExecuteWithdrawal()`, `handleCancelWithdrawal()`, `handlePause()`, `handleUnpause()`; calls `getMyAccount()` on load
- **Connected to:** Uses `vaultContract` from `useWeb3()`; calls all user-facing vault functions
- **Status:** Complete

---

**`saas-frontend/src/components/dashboard/SecurityDashboard.tsx`** (265 lines)
- **Type:** React component
- **Purpose:** Guardian, freeze, and account recovery UI
- **Key functions:** `handleSetGuardian()`, `handleFreezeAccount()`, `handleInitiateUnfreeze()`, `handleCompleteUnfreeze()`, `handleNominateRecovery()`, `handleCompleteRecovery()`, `handleCancelRecovery()`
- **Connected to:** Uses `vaultContract` from `useWeb3()`; calls all security functions
- **Status:** Complete

---

**`saas-frontend/src/components/dashboard/BotActivity.tsx`** (295 lines)
- **Type:** React component
- **Purpose:** Displays bot metrics and recent trade history by polling backend API
- **Key functions:** Polls `GET /api/bot/state`, `/api/metrics`, `/api/trades/recent` every 5s; renders performance stats (total profit, success rate, ROI, etc.) and a table of recent trades
- **Hardcoded values:** Poll interval 5000ms; `BACKEND_URL` from constants
- **Connected to:** Calls backend dashboard API; uses `BACKEND_URL` from `constants.ts`
- **Status:** Complete

---

## 4. Architecture Map

### End-to-End Flow

```
User (Browser + MetaMask)
  │
  ├── connects wallet via MetaMask
  ├── calls GET http://localhost:3000/api/config  ← gets vaultAddress from backend
  └── calls ArbitrageVault directly via ethers.js
        │
        ├── deposit() → ETH locked in vault
        ├── getMyAccount() → profit balance
        ├── requestWithdrawal() → 12h timer starts
        └── executeWithdrawal() → ETH + USDC sent back

Backend (Node.js, port 3000)
  │
  ├── pools ← DEXRegistry.getHighOpportunityPools() [on-chain]
  ├── price events ← polls ETH logs for Sync/Swap events every 3s
  ├── detects opportunity (2-hop or 3-hop price discrepancy)
  ├── estimates gas cost vs profit
  ├── builds calldata → ArbitrageBot.executeBackrun() or executeMultiHopArb()
  ├── submits via signer wallet (hot-wallet private key)
  └── profit accumulated in bot as USDC
        │
        └── ArbitrageBot.distributeToVault(amount)
              └── ArbitrageVault.distributeProfit(amount) ← splits profit to users

ArbitrageBot.sol (trade execution)
  │
  ├── optional: Aave V3 flashLoanSimple() ← borrows capital
  ├── DEXRegistry.getPoolInfo(pool) ← validates pool + gets DEXType
  ├── adapters[dexType].swap(SwapParams) ← UniswapV2Adapter or UniswapV3Adapter
  └── _convertToUSDC(profit) ← sells profit token for USDC via V3 pool

ArbitrageVault.sol (profit sharing)
  │
  ├── distributeProfit(amount) ← pulls USDC from bot, deducts operator fee
  ├── updates accProfitPerUnit accumulator (MasterChef-style)
  └── users claim proportional share on withdrawal
```

### Connection Points (File A references File B)

| File A | Location | References | Target |
|---|---|---|---|
| `arbitrage-bot-backend/.env` | line 3 | `CONTRACT_ADDRESS=0xcadDED...` | ArbitrageBot on Base Sepolia |
| `arbitrage-bot-backend/.env` | line 4 | `VAULT_ADDRESS=0x1801eEa...` | ArbitrageVault on Base Sepolia |
| `arbitrage-bot-backend/.env` | line 5 | `DEX_REGISTRY_ADDRESS=0x3C76b...` | DEXRegistry on Base Sepolia |
| `arbitrage-bot-backend/src/config/index.ts` | ~line 20 | reads `CONTRACT_ADDRESS` env | ArbitrageBot address |
| `arbitrage-bot-backend/src/config/index.ts` | ~line 25 | reads `VAULT_ADDRESS` env | ArbitrageVault address |
| `arbitrage-bot-backend/src/execution/transactionBuilder.ts` | inline ABI | `executeBackrun`, `executeMultiHopArb`, `distributeToVault` | ArbitrageBot.sol ABI (not from `out/`) |
| `arbitrage-bot-backend/src/services/VaultService.ts` | inline ABI | `distributeProfit`, `getVaultStats`, `getUserAccount` | ArbitrageVault.sol ABI (not from `out/`) |
| `arbitrage-bot-backend/src/monitoring/dashboard.ts` | `GET /api/config` | returns `config.vaultAddress` | exposes vault address to frontend |
| `saas-frontend/src/lib/constants.ts` | line 22 | `BACKEND_URL = "http://localhost:3000"` | backend dashboard server |
| `saas-frontend/src/hooks/useWeb3.ts` | line 27 | `fetch(BACKEND_URL + "/api/config")` | backend `/api/config` endpoint |
| `saas-frontend/src/hooks/useWeb3.ts` | line 58 | `new ethers.Contract(vaultAddress, VAULT_ABI, signer)` | ArbitrageVault on-chain |
| `saas-frontend/src/lib/constants.ts` | lines 1–20 | `VAULT_ABI` inline strings | ArbitrageVault.sol ABI (not from `out/`) |
| `saas-frontend/src/components/dashboard/BotActivity.tsx` | poll | `GET http://localhost:3000/api/...` | backend API |
| `script/DeployAll.s.sol` | ~line 55 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | USDC on Base Sepolia |
| `script/DeployAll.s.sol` | ~line 30 | deployer `0xf9cBC41849dB34cA64D2e3a9120020Bf3Ef76F5C` | hardcoded deployer wallet |
| `src/ArbitrageBot.sol` | constructor | `DEXRegistry` parameter | DEXRegistry.sol |
| `src/ArbitrageBot.sol` | `distributeToVault()` | `vaultAddress` state var | ArbitrageVault.sol |
| `src/ArbitrageBot.sol` | `_convertToUSDC()` | Uniswap V3 pool direct call | on-chain V3 pool |
| `src/adapters/UniswapV3Adapter.sol` | `swap()` | pool address from `params.data` | on-chain V3 pool |

---

## 5. Deployed Contracts

| Contract | Address | Chain | Source File |
|---|---|---|---|
| DEXRegistry | `0x3C76b15812a24cd94e03EEE5347b84Cea2059C68` | Base Sepolia (84532) | root `.env` line 4; `broadcast/DeployAll.s.sol/84532/run-latest.json` |
| ArbitrageVault | `0x1801eEa533d4362A1893Cb5D7f25BF04d1305b01` | Base Sepolia (84532) | root `.env` line 5; `broadcast/DeployAll.s.sol/84532/run-latest.json` |
| ArbitrageBot | `0xcadDED8434819D70b97922A8B5FF84Cf6Ba6fE86` | Base Sepolia (84532) | root `.env` line 6; `broadcast/DeployAll.s.sol/84532/run-latest.json` |
| UniswapV3Adapter | `0x1309e302267a6838acfcfe1f4872f9f4f29e3148` | Base Sepolia (84532) | `broadcast/DeployAdapters.s.sol/84532/run-latest.json` |
| UniswapV2Adapter | `0xbcf225ddd56ecad0191d5c1d5c912866ad877e15` | Base Sepolia (84532) | `broadcast/DeployAdapters.s.sol/84532/run-latest.json` |
| DEXRegistry (stale) | `0x15f0e004f2191fc208091091b2e18e1404abe9d1` | Base Sepolia (84532) | `broadcast/DeployDEXRegistry.s.sol/84532/run-latest.json` (superseded) |
| ArbitrageVault (stale) | `0xb1a807af0b9c725570492cd7692e886513e2d083` | Base Sepolia (84532) | `broadcast/DeployVaultOnly.s.sol/84532/run-latest.json` (superseded) |
| ArbitrageBot (stale) | `0x571c5967e476a7f241cb2a7e6da73a5227c95e88` | Base Sepolia (84532) | `broadcast/Deploy.s.sol/84532/run-latest.json` (superseded) |

**Note:** The stale addresses are from a prior piecemeal deployment. The canonical current deployment was done via `DeployAll.s.sol` and is confirmed by `broadcast/DeployAll.s.sol/84532/run-latest.json`.

---

## 6. Environment Variables

### Root `.env` (for Foundry scripts)

| Variable | Used In | Purpose | Currently Set? |
|---|---|---|---|
| `BASE_SEPOLIA_RPC_URL` | `foundry.toml`, all scripts | RPC for testnet broadcasts | Yes: `https://sepolia.base.org` |
| `AAVE_POOL_ADDRESS` | `DeployAll.s.sol`, `Deploy.s.sol` | Aave V3 PoolAddressesProvider | Yes: Base Sepolia `0x9E0Fd28...` |
| `DEXRegistry` | All scripts needing registry address | DEXRegistry contract address | Yes: `0x3C76b...` |
| `ArbitrageVault` | `DeployAdapters.s.sol`, `DeployVaultOnly.s.sol` | Vault contract address | Yes: `0x1801eEa...` |
| `ArbitrageBot` | `DeployAdapters.s.sol`, `DeployVaultOnly.s.sol`, `RegisterDEXes.s.sol` | Bot contract address | Yes: `0xcadDED...` |
| `PRIVATE_KEY` | All scripts (signer) | Deployer/operator private key | Yes — **committed to git, security risk** |
| `LOG_LEVEL` | N/A (backend var here) | Log verbosity | Yes: `info` |

### `arbitrage-bot-backend/.env`

| Variable | Used In | Purpose | Currently Set? |
|---|---|---|---|
| `CHAIN` | `config/index.ts` | Target chain | Yes: `baseSepolia` |
| `BASE_RPC_URL` | `config/index.ts` | Base mainnet HTTP RPC | Yes |
| `BASE_WS_URL` | `config/index.ts` | Base mainnet WebSocket | Yes |
| `BASE_SEPOLIA_RPC_URL` | `config/index.ts` | Base Sepolia HTTP RPC | Yes |
| `BASE_SEPOLIA_WS_URL` | `config/index.ts` | Base Sepolia WebSocket | Yes |
| `ARBITRUM_RPC_URL` | `config/index.ts` | Arbitrum mainnet RPC | **Not set** |
| `ARBITRUM_WS_URL` | `config/index.ts` | Arbitrum mainnet WS | **Not set** |
| `ARBITRUM_SEPOLIA_RPC_URL` | `config/index.ts` | Arbitrum Sepolia RPC | **Not set** |
| `ARBITRUM_SEPOLIA_WS_URL` | `config/index.ts` | Arbitrum Sepolia WS | **Not set** |
| `PRIVATE_KEY` | `config/index.ts`, all execution | Hot wallet private key | Yes — testnet key |
| `CONTRACT_ADDRESS` | `config/index.ts` | ArbitrageBot address (**required**) | Yes: `0xcadDED...` |
| `VAULT_ADDRESS` | `config/index.ts` | ArbitrageVault address | Yes: `0x1801eEa...` |
| `DEX_REGISTRY_ADDRESS` | `config/index.ts` | DEXRegistry address | Yes: `0x3C76b...` |
| `AAVE_POOL_ADDRESS` | `config/index.ts` (fallback) | Aave provider address | Yes: **Base mainnet** address (mismatch with `CHAIN=baseSepolia`) |
| `PROFIT_TOKEN_ADDRESS` | indirectly via config | USDC address | Yes: **Base mainnet** USDC (mismatch with testnet) |
| `MIN_PROFIT_BPS` | `config/index.ts` | Minimum profit threshold | Yes: `20` |
| `MAX_GAS_PRICE` | `config/index.ts` | Max gas in Gwei | Yes: `100` |
| `FLASH_LOAN_ENABLED` | `config/index.ts` | Enable Aave flash loans | Yes: `true` |
| `BATCH_OPERATIONS` | `config/index.ts` | Batch transactions | Yes: `true` |
| `MONITORING_INTERVAL` | `config/index.ts` | Main loop interval ms | Yes: `1000` |
| `EXECUTION_DELAY` | `config/index.ts` | Delay before execution | **Not set** (defaults to 100ms) |
| `LOG_LEVEL` | `logger.ts` | Log level | **Not set in backend .env** (defaults to `info`) |
| `VAPID_PUBLIC_KEY` | `NotificationService.ts` | Web Push VAPID key | Yes |
| `VAPID_PRIVATE_KEY` | `NotificationService.ts` | Web Push VAPID key | Yes |
| `VAPID_SUBJECT` | `NotificationService.ts` | Web Push sender | Yes: `mailto:admin@mevbot.io` |
| `PERFORMANCE_FEE_BPS` | N/A (deploy artifact, not read by backend) | Fee reference | Yes: `2000` |

### `saas-frontend` Environment Variables

| Variable | Used In | Purpose | Currently Set? |
|---|---|---|---|
| `NEXT_PUBLIC_VAULT_ADDRESS` | `useWeb3.ts` line 14 | Vault address fallback if backend offline | **Not set** — frontend completely depends on backend being online |

---

## 7. Missing Pieces & Broken Connections

### Critical

**1. Backend `.env` uses mainnet Aave/USDC addresses on testnet**
- `arbitrage-bot-backend/.env` has `AAVE_POOL_ADDRESS=0xe20fCBdBfFC4Dd138cE8b440322649382F89F21A` (Base mainnet Aave V3) and `PROFIT_TOKEN_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Base mainnet USDC)
- But `CHAIN=baseSepolia`
- `config/index.ts` has the correct Sepolia Aave address hardcoded per chain, so `AAVE_POOL_ADDRESS` in the env may be overridden — but `PROFIT_TOKEN_ADDRESS` is used as the stablecoin address for USDC conversion and vault setup
- **Impact:** Flash loan calls and USDC transfers would go to mainnet contract addresses that don't exist on Sepolia → transactions would fail

**2. Private key committed to repository**
- Root `.env` line 7: `PRIVATE_KEY=cffdd4ecf740fb6b7b26aa9379be7ad059c890bb50140da6a39755095b76d6dc` — testnet key but committed to version control
- `arbitrage-bot-backend/.env` has the same key prefixed with `0x`
- **Impact:** Anyone with repo access has the hot wallet private key. On testnet this is low risk, but `.env` should never be committed — the `.gitignore` entry for `.env` should be verified to cover root `.env`

**3. Frontend vault address requires backend to be running**
- `saas-frontend/src/hooks/useWeb3.ts` line 27: `fetch(BACKEND_URL + "/api/config")` to get vault address
- `NEXT_PUBLIC_VAULT_ADDRESS` env var is the fallback but is not set anywhere in the project
- `BACKEND_URL = "http://localhost:3000"` is hardcoded in `constants.ts` with no env override
- **Impact:** If backend is not running, the frontend shows `"Backend offline and NEXT_PUBLIC_VAULT_ADDRESS not set — vault features unavailable."` — users cannot interact with vault at all. For any deployment beyond local dev, `NEXT_PUBLIC_VAULT_ADDRESS` must be set and `BACKEND_URL` must be configurable.

### Significant

**4. Adapters are not included in `DeployAll.s.sol`**
- `DeployAll.s.sol` deploys the three contracts and wires vault/executor, but does NOT deploy adapters
- `DeployAdapters.s.sol` must be run separately after every fresh `DeployAll`
- If adapters are not deployed, `ArbitrageBot` has no swap adapters registered → every `executeBackrun` / `executeMultiHopArb` call will revert with "No adapter for DEX type"
- Documented in `CLAUDE.md` as a known issue, but the ordering is easy to miss

**5. UniswapV3Adapter `getAmountOut/In()` always return 0**
- `src/adapters/UniswapV3Adapter.sol` lines for `getAmountOut` and `getAmountIn` both return `0`
- The quoter address is accepted in constructor but never called
- **Impact:** The backend's `OpportunityDetector` and `RouteCalculator` cannot get accurate V3 price quotes on-chain. They rely on cached event prices from `EventListener` rather than on-chain quoter calls — this means profit estimates for V3 routes may be inaccurate, particularly for illiquid pools or pools with concentrated liquidity.

**6. `UniswapV3Adapter.getPool()` only checks 0.3% fee tier**
- `src/adapters/UniswapV3Adapter.sol`: `getPool(tokenIn, tokenOut)` hardcodes `fee = 3000`
- Most WETH/USDC liquidity on Base is in the 0.05% pool (`fee = 500`)
- **Impact:** `getPool()` may return `address(0)` even when a pool exists on a different fee tier. Swap execution still works because the pool address is encoded in `SwapParams.data` directly, but any code that calls `getPool()` to discover pools will miss non-0.3% pools.

**7. `CurveDiscoveryHandler` and `BalancerDiscoveryHandler` are stubs**
- `arbitrage-bot-backend/src/core/poolDiscoveryService.ts`: both handlers are class definitions with no implemented discovery logic
- **Impact:** Curve and Balancer pools are never automatically discovered; they would need to be manually registered via `RegisterPools.s.sol`. The DEX types are registered in the on-chain registry but no pools will populate them from the backend.

### Minor

**8. ArbitrageBot test coverage is minimal**
- `test/ArbitrageBot.t.sol` has only 2 tests (constructor init + onlyOwner check)
- Zero coverage of: `executeBackrun`, `executeMultiHopArb`, `executeOperation` (flash loan callback), `_convertToUSDC`, `distributeToVault`, `withdrawProfit`, two-step ownership
- **Impact:** CI passes with minimal guarantees about the bot's actual trading logic

**9. Backend has no tests**
- `arbitrage-bot-backend/tests/` is an empty directory
- All 21 TypeScript source files are untested
- **Impact:** No automated verification of opportunity detection logic, gas calculations, or ABI encoding

**10. `README.md` is Foundry boilerplate**
- Neither `README.md` in the repo root nor `saas-frontend/README.md` describes this project
- A new developer has no entry point documentation beyond `CLAUDE.md` and `AGENTS.md`

**11. `BACKEND_URL` hardcoded in frontend**
- `saas-frontend/src/lib/constants.ts` line 22: `export const BACKEND_URL = "http://localhost:3000"`
- No `NEXT_PUBLIC_BACKEND_URL` env var override
- **Impact:** Frontend cannot be deployed to any non-localhost environment without modifying the source code

**12. CI `forge fmt --check` may fail if code is reformatted**
- `.github/workflows/test.yml` runs `forge fmt --check` — any code that doesn't pass Foundry's formatter will block CI
- No `forge fmt` step was run as part of recent changes — unclear if all files pass

**13. `arbitrage-bot-backend/.env` `LOG_LEVEL` is in root `.env` but not in backend `.env`**
- The logger defaults to `info` if unset, so this is low-impact, but inconsistent

---

## 8. Steps to Make This Work End-to-End on Base Sepolia

The following ordered steps take the system from zero to a live, working bot on Base Sepolia.

### Phase 1: Prerequisites

**Step 1 — Fund a testnet wallet**
- Get Base Sepolia ETH from the Base Sepolia faucet
- This wallet's private key will be `PRIVATE_KEY` in all env files
- This address becomes the `owner` of all three contracts

**Step 2 — Get testnet USDC**
- Obtain Base Sepolia USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- The vault `distributeProfit()` call needs USDC approved and transferred from the bot

**Step 3 — Set up environment**
```bash
# Root .env (for Foundry scripts)
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
AAVE_POOL_ADDRESS=0x9E0Fd28470Aae30D95b4eE3cc72cB42f75b80F40   # Sepolia provider
PRIVATE_KEY=<your-testnet-private-key>

# arbitrage-bot-backend/.env — fix the current mainnet mismatch:
CHAIN=baseSepolia
AAVE_POOL_ADDRESS=0x9E0Fd28470Aae30D95b4eE3cc72cB42f75b80F40   # Sepolia (not mainnet!)
PROFIT_TOKEN_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # Sepolia USDC (not mainnet!)
CONTRACT_ADDRESS=<bot address after step 5>
VAULT_ADDRESS=<vault address after step 5>
DEX_REGISTRY_ADDRESS=<registry address after step 5>
PRIVATE_KEY=0x<your-testnet-private-key>
```

### Phase 2: Deploy Contracts

**Step 4 — Build contracts**
```bash
forge build
```

**Step 5 — Deploy all three contracts in one transaction**
```bash
export PRIVATE_KEY=<your-key>
export AAVE_POOL_ADDRESS=0x9E0Fd28470Aae30D95b4eE3cc72cB42f75b80F40
export PROFIT_TOKEN_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
forge script script/DeployAll.s.sol --rpc-url https://sepolia.base.org --broadcast
```
Copy the three printed addresses into both `.env` files.

**Step 6 — Register DEXes in the registry**
```bash
export DEX_REGISTRY_ADDRESS=<from step 5>
forge script script/RegisterDEXes.s.sol --rpc-url https://sepolia.base.org --broadcast
```

**Step 7 — Deploy and wire adapters**
```bash
export ArbitrageBot=<from step 5>
forge script script/DeployAdapters.s.sol --rpc-url https://sepolia.base.org --broadcast
```

**Step 8 — Register pools**
```bash
export DEX_REGISTRY_ADDRESS=<from step 5>
forge script script/RegisterPools.s.sol --rpc-url https://sepolia.base.org --broadcast
```
If the script warns that no pools were found, create a WETH/USDC 0.3% pool on the Sepolia Uniswap V3 interface first.

### Phase 3: Start the Backend

**Step 9 — Install and run the backend**
```bash
cd arbitrage-bot-backend
npm install
npm run testnet    # sets CHAIN=baseSepolia automatically
```
The backend will:
- Connect to Base Sepolia via RPC
- Load pools from the on-chain DEXRegistry
- Start scanning for price events
- Serve the dashboard on `http://localhost:3000`

**Step 10 — Verify backend is running**
```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/config     # should return the vault address
```

### Phase 4: Start the Frontend

**Step 11 — Configure and run the frontend**
```bash
cd saas-frontend
# Create .env.local to avoid depending on backend for vault address:
echo "NEXT_PUBLIC_VAULT_ADDRESS=0x<vault-address>" > .env.local
npm install
npm run dev
```
Open `http://localhost:3001` (or whichever port Next.js picks).

**Step 12 — Connect MetaMask**
- Switch MetaMask to Base Sepolia (chain ID 84532)
- Click "Connect Wallet" in the dashboard
- Deposit ETH to become a vault participant

### Phase 5: Execute a Test Trade

**Step 13 — Manually trigger a backrun (optional smoke test)**

The backend should automatically detect opportunities and call `executeBackrun()` when profitable. To manually trigger one for testing:

```bash
# From within the backend, or via a separate forge script:
# Call ArbitrageBot.executeBackrun() with a known pool address
# that has a price discrepancy >= minProfitUSDC
```

**Step 14 — Distribute profits**
Once the bot accumulates USDC from trades, call:
```solidity
// via backend automatically, or manually:
ArbitrageBot.distributeToVault(amountUSDC)
// this calls ArbitrageVault.distributeProfit(amountUSDC)
```
The vault users can then call `getMyAccount()` to see their claimable profit, then `requestWithdrawal()` followed by `executeWithdrawal()` after 12 hours.

### Summary Checklist

- [ ] Fund deployer wallet with Base Sepolia ETH
- [ ] Fix `arbitrage-bot-backend/.env`: change AAVE and USDC addresses to Sepolia equivalents
- [ ] Run `forge script DeployAll.s.sol` and copy addresses to both `.env` files
- [ ] Run `RegisterDEXes.s.sol`
- [ ] Run `DeployAdapters.s.sol` (without this, bot cannot trade)
- [ ] Run `RegisterPools.s.sol` (if pools not found, create WETH/USDC pool on Uniswap Sepolia first)
- [ ] `npm run testnet` in backend — verify `/api/health` returns 200
- [ ] Set `NEXT_PUBLIC_VAULT_ADDRESS` in `saas-frontend/.env.local`
- [ ] `npm run dev` in frontend — connect MetaMask on Base Sepolia
- [ ] Deposit test ETH through the frontend
- [ ] Monitor bot activity in the dashboard at `http://localhost:3000`
