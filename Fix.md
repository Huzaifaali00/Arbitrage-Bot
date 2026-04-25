# MEV Arbitrage Bot — Base Sepolia Integration Fix

## ABSOLUTE RULES
- Always ask clarifying questions until you're fully aware with each task
- Do NOT redeploy any contracts — all five are already on Base Sepolia
- Do NOT change mainnet addresses anywhere — they are correct and needed for future mainnet deployment
- The fix for wrong addresses is always chain-aware logic in code, NOT hardcoding testnet values into .env
- After EVERY file edit, read the file back to confirm the change exists
- After EVERY `forge script --broadcast`, wait for output and report the tx hash
- If any command errors, STOP and report the exact error — do not continue
- "Task complete" means you have READ the result and it is verified correct, not just that you wrote the code

## CONTEXT

This is a MEV arbitrage SaaS platform targeting Base Mainnet as the production chain.
Base Sepolia is the current testnet for development and testing ONLY.

All three Solidity contracts are ALREADY DEPLOYED on Base Sepolia. Do NOT redeploy them.
Your job is to fix broken configuration connections and register pools so the bot can
detect and execute arbitrage on Base Sepolia, WITHOUT breaking the mainnet configuration
that will be used later.

**Deployed contracts (Base Sepolia, chain ID 84532):**
- DEXRegistry:    0x3C76b15812a24cd94e03EEE5347b84Cea2059C68
- ArbitrageVault: 0x1801eEa533d4362A1893Cb5D7f25BF04d1305b01
- ArbitrageBot:   0xcadDED8434819D70b97922A8B5FF84Cf6Ba6fE86
- V3Adapter:      0x1309e302267a6838acfcfe1f4872f9f4f29e3148
- V2Adapter:      0xbcf225ddd56ecad0191d5c1d5c912866ad877e15

**Token addresses:**
| Token | Base Sepolia | Base Mainnet |
|-------|-------------|--------------|
| WETH  | 0x4200000000000000000000000000000000000006 | 0x4200000000000000000000000000000000000006 |
| USDC  | 0x036CbD53842c5426634e7929541eC2318f3dCF7e | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |

**Uniswap addresses (Base Sepolia):**
- V3 Factory:  0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24
- V3 Router:   0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4
- V3 QuoterV2: 0xC5290058841028F1614F3A6F0F5816cAd0df5E27
- V2 Factory:  0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e
- V2 Router:   0x1689E7B1F10000AE47eBfE339a4f69dECd19F602

**Uniswap addresses (Base Mainnet — for reference, DO NOT CHANGE):**
- V3 Factory:  0x33128a8fC17869897dcE68Ed026d694621f6FDfD
- V3 Router:   0x2626664c2603336E57B271c5C0b26F421741e481
- V2 Factory:  0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6
- V2 Router:   0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24

**Known WETH/USDC V3 pool addresses on Base Sepolia (computed via CREATE2):**
- 0.05% (fee=500):   0x94bfc0574ff48e92ce43d495376c477b1d0eeec0  (token0=USDC, token1=WETH)
- 0.30% (fee=3000):  0x46880b404cd35c165eddeff7421019f8dd25f4ad  (token0=USDC, token1=WETH)
- 1.00% (fee=10000): 0x4664755562152edda3a3073850fb62835451926a  (token0=USDC, token1=WETH)

**Aave V3 PoolAddressesProvider:**
- Base Sepolia:  0x9E0Fd28470Aae30D95b4eE3cc72cB42f75b80F40
- Base Mainnet:  0xe20fCBdBfFC4Dd138cE8b440322649382F89F21A  (DO NOT CHANGE — needed for mainnet)

---

## THE CORE PROBLEM

The backend config (`arbitrage-bot-backend/src/config/index.ts`) reads `CHAIN=baseSepolia`
from the env, then resolves chain-specific values. The issue is that
`arbitrage-bot-backend/.env` sets `AAVE_POOL_ADDRESS` and `PROFIT_TOKEN_ADDRESS` as global
overrides — and those values are currently pointing to Base Mainnet addresses.

The correct fix is NOT to change the .env values to testnet addresses permanently.
The correct fix is to make `config/index.ts` resolve AAVE and USDC addresses
from its own per-chain mapping based on `CHAIN`, and treat the .env values as
optional manual overrides (used only if explicitly set AND matching the active chain).

This preserves the mainnet values in .env for when the chain is switched to `base`.

---

## YOUR TASKS

Complete ALL tasks in order. After each task, read back the modified file to confirm
the change is present. Do NOT declare the overall task complete until Task 7's
checklist shows all PASS.

---

### TASK 1 — Make config/index.ts resolve addresses per-chain

**File:** `arbitrage-bot-backend/src/config/index.ts`

Read this file completely first. Then make the following changes:

The file already has per-chain Aave address mappings. Extend that same pattern to also
cover USDC (profit token) addresses. The goal: when `CHAIN=baseSepolia`, the bot
automatically uses the correct Sepolia USDC and Aave addresses from the hardcoded
per-chain map — WITHOUT needing .env to be manually changed.

1. Add a per-chain USDC address map alongside the existing Aave map:

````typescript
const USDC_BY_CHAIN: Record<string, string> = {
  base:            '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  baseSepolia:     '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  arbitrum:        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  arbitrumSepolia: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
};
````

2. When building the config object, resolve `profitTokenAddress` like this:
````typescript
profitTokenAddress: USDC_BY_CHAIN[chain] ?? process.env.PROFIT_TOKEN_ADDRESS ?? '',
````
This means: use the hardcoded per-chain USDC address first. Only fall back to the
.env value if the chain is unknown. The .env value is ignored when a known chain is
active — so mainnet .env values won't accidentally bleed into testnet runs.

3. Apply the same pattern to `aavePoolAddress` if it's not already doing this.
   Check whether `AAVE_BY_CHAIN` (or equivalent) already exists and is used to
   resolve the address before reading from env. If it IS already doing per-chain
   resolution correctly, leave it alone. If it reads from env first, fix it to
   use the per-chain map first.

4. After the change, the effective values when `CHAIN=baseSepolia` must be:
   - `aavePoolAddress`   → 0x9E0Fd28470Aae30D95b4eE3cc72cB42f75b80F40
   - `profitTokenAddress` → 0x036CbD53842c5426634e7929541eC2318f3dCF7e

   And when `CHAIN=base` (mainnet), they must be:
   - `aavePoolAddress`   → 0xe20fCBdBfFC4Dd138cE8b440322649382F89F21A
   - `profitTokenAddress` → 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913

**Verification:** After editing, read the file back and trace through what
`profitTokenAddress` resolves to when `chain = 'baseSepolia'`. Confirm it is the
Sepolia USDC address, not the mainnet one.

---

### TASK 2 — Fix frontend vault address dependency

**File:** `saas-frontend/src/lib/constants.ts`

Make two changes:

1. Change `BACKEND_URL` to support an env override:
````typescript
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';
````

2. Add a vault address fallback constant directly below it:
````typescript
export const VAULT_ADDRESS_FALLBACK = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? '0x1801eEa533d4362A1893Cb5D7f25BF04d1305b01';
````

**File:** `saas-frontend/src/hooks/useWeb3.ts`

Read this file completely first.

Find the section where `vaultAddress` is fetched from the backend (`GET /api/config`).
Add fallback logic so that if the fetch fails OR the response contains no address,
it uses `VAULT_ADDRESS_FALLBACK`.

The import at the top of the file must be updated to include `VAULT_ADDRESS_FALLBACK`:
````typescript
import { VAULT_ABI, BACKEND_URL, VAULT_ADDRESS_FALLBACK } from '@/lib/constants';
````

The fallback logic must look approximately like:
````typescript
// If backend fetch fails or returns no address, use env fallback
const resolvedAddress = fetchedAddress || VAULT_ADDRESS_FALLBACK;
````

Do NOT remove the existing backend fetch logic — it should still attempt to get
the address from the backend first. The fallback only activates when the backend
is offline or returns nothing.

**File:** `saas-frontend/.env.local` (create if it does not exist)
NEXT_PUBLIC_VAULT_ADDRESS=0x1801eEa533d4362A1893Cb5D7f25BF04d1305b01
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
**Verification:** Read `useWeb3.ts` after editing. Confirm `VAULT_ADDRESS_FALLBACK`
is imported and appears in the catch/fallback path for vault address resolution.

---

### TASK 3 — Register WETH/USDC pools in DEXRegistry

The DEXRegistry is deployed but may have no pools registered, meaning the bot
has nothing to scan for arbitrage opportunities.

**Step 3a — Check what's already registered**

Read `broadcast/RegisterPools.s.sol/84532/run-latest.json`.
Report: how many `addPool` transactions are in the broadcast, and whether any
succeeded. If the file does not exist or is empty, report that clearly.

**Step 3b — Update RegisterPools.s.sol**

Read `script/RegisterPools.s.sol` completely first.

Update it to register all three WETH/USDC fee tier pools. The script must:

1. Use the correct DEXRegistry address from env:
````solidity
   address registry = vm.envAddress("DEXRegistry");
````

2. Set testnet-friendly thresholds before registering pools. Call these
   if the functions exist on DEXRegistry (check the contract ABI first):
````solidity
   DEXRegistry(registry).setMinTVL(1 ether);
   DEXRegistry(registry).setMinOpportunityScore(0);
````

3. Register all three pools using try/catch so already-registered pools
   don't revert the whole script:
````solidity
   // Pool 1: WETH/USDC 0.05%
   try DEXRegistry(registry).addPool(
       0x94bfc0574ff48e92ce43d495376c477b1d0eeec0, // pool address
       1,                                            // DEXType.UniswapV3
       0x036CbD53842c5426634e7929541eC2318f3dCF7e, // token0 (USDC)
       0x4200000000000000000000000000000000000006, // token1 (WETH)
       500,                                          // fee tier
       1 ether,                                      // tvl (meets 1 ether threshold)
       0                                             // volume24h
   ) {} catch { console.log("Pool 1 already registered or failed"); }

   // Pool 2: WETH/USDC 0.30%
   try DEXRegistry(registry).addPool(
       0x46880b404cd35c165eddeff7421019f8dd25f4ad,
       1,
       0x036CbD53842c5426634e7929541eC2318f3dCF7e,
       0x4200000000000000000000000000000000000006,
       3000,
       1 ether,
       0
   ) {} catch { console.log("Pool 2 already registered or failed"); }

   // Pool 3: WETH/USDC 1.00%
   try DEXRegistry(registry).addPool(
       0x4664755562152edda3a3073850fb62835451926a,
       1,
       0x036CbD53842c5426634e7929541eC2318f3dCF7e,
       0x4200000000000000000000000000000000000006,
       10000,
       1 ether,
       0
   ) {} catch { console.log("Pool 3 already registered or failed"); }
````

   IMPORTANT: Before writing this, read `src/DEXRegistry.sol` to confirm the exact
   function signature of `addPool` — use the actual parameter order from the contract,
   not the order above if they differ.

**Step 3c — Run the script**

````bash
cd /home/blockchain_/mev
forge script script/RegisterPools.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast \
  --private-key $(grep "^PRIVATE_KEY" .env | cut -d= -f2)
````

Wait for completion. Report the transaction hash and whether the broadcast succeeded.
If it fails, report the exact error message — do NOT proceed past a failure.

**Verification:** After broadcast completes, read `broadcast/RegisterPools.s.sol/84532/run-latest.json`
and confirm transactions for all three pool registrations are present.

---

### TASK 4 — Fix UniswapV3Adapter fee tier coverage

**File:** `src/adapters/UniswapV3Adapter.sol`

Read this file completely first.

The `getPool(tokenIn, tokenOut)` function currently hardcodes `fee = 3000` (0.3%).
The most liquid WETH/USDC pool on Base Sepolia uses fee=500 (0.05%). This causes
`getPool()` to return `address(0)` even when a pool exists on a different fee tier.

Replace the `getPool` implementation with a multi-tier lookup:

````solidity
function getPool(address tokenIn, address tokenOut) external view override returns (address) {
    uint24[3] memory feeTiers = [uint24(500), uint24(3000), uint24(10000)];
    for (uint256 i = 0; i < feeTiers.length; i++) {
        address pool = IUniswapV3Factory(factory).getPool(tokenIn, tokenOut, feeTiers[i]);
        if (pool != address(0)) return pool;
    }
    return address(0);
}
````

After editing, run:
````bash
cd /home/blockchain_/mev
forge build
````

**Verification:** `forge build` must complete with zero compilation errors.
If there are errors, fix them before proceeding.

---

### TASK 5 — Verify all backend router/factory addresses for Base Sepolia

Read these two files completely and check every address against the reference values
provided in the CONTEXT section above.

**File 1:** `arbitrage-bot-backend/src/execution/transactionBuilder.ts`

Check the router addresses used when `CHAIN=baseSepolia`:
- UniswapV3 SwapRouter: must be `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`
- UniswapV2 Router: must be `0x1689E7B1F10000AE47eBfE339a4f69dECd19F602`

If either is wrong, fix it. Do NOT touch the mainnet addresses.

**File 2:** `arbitrage-bot-backend/src/core/poolDiscoveryService.ts`

Check the factory addresses used for Base Sepolia discovery:
- UniswapV3 Factory: must be `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24`
- UniswapV2 Factory: must be `0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e`

If either is wrong, fix it. Do NOT touch the mainnet factory addresses.

**File 3:** `saas-frontend/src/lib/constants.ts`

Verify `VAULT_ABI` contains at minimum these function signatures:
`deposit`, `requestWithdrawal`, `executeWithdrawal`, `getMyAccount`, `getVaultStats`

If any are missing, add them by reading `src/ArbitrageVault.sol` for the correct
signatures and appending them to the ABI array.

Report each check as: PASS (correct) / FIXED (was wrong, now corrected) / FAIL (broken and couldn't fix).

---

### TASK 6 — Document the deposit situation

Create `DEPOSIT_STATUS.md` in the repo root:

````markdown
# Deposit & Trading Capital — How It Works

## What your ETH deposit in the vault does
- ETH deposited via `vault.deposit()` is **principal** — it determines your
  proportional share of profits distributed by the bot
- The vault holds ETH as your "stake" — it does NOT use it for trading
- Example: you deposit 1 ETH out of 10 total ETH in vault → you receive 10% of all profits

## What the bot uses to trade
- The bot executes trades using **Aave V3 flash loans** (borrowed + repaid in 1 tx)
- Flash loans require NO upfront capital — the bot borrows, arbs, repays, keeps profit
- Profits are converted to USDC and pushed to the vault via `distributeToVault()`

## Your current situation
- ArbitrageVault: 0x1801eEa533d4362A1893Cb5D7f25BF04d1305b01
- ArbitrageBot:   0xcadDED8434819D70b97922A8B5FF84Cf6Ba6fE86
- Your Base Sepolia ETH deposit → recorded, profit share is active ✓
- Your WETH in MetaMask → NOT needed in the vault, keep it separate

## To test the bot on Base Sepolia

**Step 1 — Start the backend**
```bash
cd arbitrage-bot-backend
npm run testnet
```
Verify it starts without errors and http://localhost:3000/api/health returns 200.

**Step 2 — Start the frontend**
```bash
cd saas-frontend
npm run dev
```
Open http://localhost:3001. Your deposit should appear in the dashboard.

**Step 3 — Create a price imbalance (required for testnet)**
Testnet pools have no organic trading activity, so the bot will find no opportunities
on its own. You must create an artificial price discrepancy:
1. Go to https://basex-test.vercel.app/swap (Uniswap V3 testnet UI on Base Sepolia)
2. Swap a meaningful amount of WETH → USDC (this pushes the pool price up)
3. The bot should detect the resulting price delta vs the V2 pool and execute a backrun

**Step 4 — Watch the bot**
- Backend logs: watch for "Opportunity detected" and "executeBackrun submitted"
- Frontend BotActivity tab: shows recent trades and profit
- BaseScan: https://sepolia.basescan.org/address/0xcadDED8434819D70b97922A8B5FF84Cf6Ba6fE86

## Mainnet deployment (future)
When ready to go live on Base Mainnet:
1. Run `forge script script/DeployAll.s.sol --rpc-url https://mainnet.base.org --broadcast`
2. Update `arbitrage-bot-backend/.env`: set `CHAIN=base` and new contract addresses
3. The USDC and Aave addresses will automatically resolve to mainnet values via config/index.ts
````

---

### TASK 7 — Final verification checklist

Run each check and report PASS or FAIL with one line of evidence:

1. `forge build` — zero compilation errors
2. `arbitrage-bot-backend/src/config/index.ts` — when `chain='baseSepolia'`,
   `profitTokenAddress` resolves to `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
3. `arbitrage-bot-backend/src/config/index.ts` — when `chain='base'`,
   `profitTokenAddress` resolves to `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   (mainnet value preserved)
4. `saas-frontend/.env.local` exists and contains `NEXT_PUBLIC_VAULT_ADDRESS`
5. `saas-frontend/src/hooks/useWeb3.ts` uses `VAULT_ADDRESS_FALLBACK` in fallback path
6. `src/adapters/UniswapV3Adapter.sol` `getPool()` tries fee tiers 500, 3000, 10000
7. `broadcast/RegisterPools.s.sol/84532/run-latest.json` contains pool registration transactions
8. `DEPOSIT_STATUS.md` exists in repo root

Do NOT mark this task complete if any item is FAIL. Fix the failing item first,
then re-run that specific check.

---

