# TASK: Migrate MEV Bot Testing from Live Base Sepolia → Anvil Fork of Base Sepolia

## The Problem Being Solved
The bot is currently pointed at live Base Sepolia (chain ID 84532) for testing. Base
Sepolia pools have near-zero liquidity, drain randomly, and produce no real price
discrepancies — making arbitrage testing impossible.

The solution is to fork Base Sepolia locally using Anvil at a pinned block number.
This preserves:
1. Our deployed contract addresses (ArbitrageBot, ArbitrageVault, DEXRegistry, adapters)
2. All Aave V3 testnet and DEX pool deployments at their Base Sepolia addresses
3. Pool state frozen at fork block — no external volatility or drainage
4. Unlimited ETH/tokens via Anvil cheatcodes
5. evm_snapshot/evm_revert for repeatable, isolated test runs

We do NOT redeploy anything. All existing contract addresses remain the same.
The only change is WHERE the RPC points — from live Base Sepolia to local Anvil fork.

## Architecture Recap (READ ONLY — do not modify contract logic)
- src/ArbitrageBot.sol — flash loan execution engine
- src/ArbitrageVault.sol — SaaS profit vault
- src/DEXRegistry.sol — pool registry with opportunity scoring
- src/adapters/UniswapV2Adapter.sol + UniswapV3Adapter.sol
- arbitrage-bot-backend/src/index.ts — main bot entry (ethers v6)
- arbitrage-bot-backend/src/execution/transactionBuilder.ts — encodes contract calls
- arbitrage-bot-backend/src/services/VaultService.ts — profit distribution bridge

## Pre-requisites (human will do this before running the prompt)
- Run: `cast block-number --rpc-url <BASE_SEPOLIA_RPC>` and note the block number
- This becomes FORK_BLOCK_NUMBER — pin it so state never changes between runs
- Get a Base Sepolia RPC URL from Alchemy or QuickNode (free tier is fine)

## STEP 1 — Create the Anvil startup script

Create file: `scripts/start-anvil-fork.sh`

```bash
#!/bin/bash
# Forks Base Sepolia at a pinned block so pool state is always identical
# USAGE: bash scripts/start-anvil-fork.sh
# Run this in a separate terminal BEFORE starting the bot

source .env

if [ -z "$BASE_SEPOLIA_RPC_URL" ]; then
  echo "ERROR: BASE_SEPOLIA_RPC_URL not set in .env"
  exit 1
fi

if [ -z "$FORK_BLOCK_NUMBER" ]; then
  echo "ERROR: FORK_BLOCK_NUMBER not set in .env"
  echo "Run: cast block-number --rpc-url \$BASE_SEPOLIA_RPC_URL"
  exit 1
fi

echo "Starting Anvil fork of Base Sepolia at block $FORK_BLOCK_NUMBER..."
echo "RPC will be available at: http://127.0.0.1:8545"
echo "Chain ID: 84532 (Base Sepolia preserved)"
echo ""

anvil \
  --fork-url "$BASE_SEPOLIA_RPC_URL" \
  --fork-block-number "$FORK_BLOCK_NUMBER" \
  --chain-id 84532 \
  --block-time 2 \
  --accounts 10 \
  --balance 10000 \
  --port 8545 \
  --host 0.0.0.0
```

Make it executable: `chmod +x scripts/start-anvil-fork.sh`

Important: `--chain-id 84532` is required. This makes Anvil report the same chain ID
as Base Sepolia so all existing contract addresses and ethers.js provider logic work
without any changes.

## STEP 2 — Add new env vars to .env and .env.example

Open the existing .env file. ADD these new variables at the bottom.
DO NOT remove or rename any existing variables — the live Base Sepolia flow must still work.
── Anvil Fork Configuration ───────────────────────────────────────────────
Set USE_ANVIL=true to point the bot at local Anvil fork instead of live testnet
USE_ANVIL=false
ANVIL_RPC_URL=http://127.0.0.1:8545
ANVIL_WS_URL=ws://127.0.0.1:8545
Pin this to the block where your contracts are deployed and pools have liquidity.
Get it with: cast block-number --rpc-url $BASE_SEPOLIA_RPC_URL
FORK_BLOCK_NUMBER=
Anvil default account #0 — safe ONLY for local testing, never production
ANVIL_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ANVIL_ACCOUNT=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

Also add these same lines to .env.example so the pattern is documented.

## STEP 3 — Update the TypeScript backend provider initialization

Open `arbitrage-bot-backend/src/index.ts`.

Find where the ethers provider is created (look for `JsonRpcProvider`, `WebSocketProvider`,
or any reference to `process.env.BASE_SEPOLIA_RPC_URL` or a hardcoded RPC URL).

Replace the provider initialization block with this pattern:

```typescript
// Provider selection — respects USE_ANVIL env var
const useAnvil = process.env.USE_ANVIL === 'true';

const rpcUrl = useAnvil
  ? (process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545')
  : (process.env.BASE_SEPOLIA_RPC_URL ?? '');

const wsUrl = useAnvil
  ? (process.env.ANVIL_WS_URL ?? 'ws://127.0.0.1:8545')
  : (process.env.BASE_SEPOLIA_WS_URL ?? '');

if (!rpcUrl) {
  throw new Error('No RPC URL configured. Set BASE_SEPOLIA_RPC_URL or USE_ANVIL=true + ANVIL_RPC_URL');
}

// Use HTTP provider for Anvil (more stable for local fork), WS for live networks
const provider = useAnvil
  ? new ethers.JsonRpcProvider(rpcUrl)
  : new ethers.WebSocketProvider(wsUrl || rpcUrl);

console.log(`[Provider] Connected to: ${rpcUrl} (${useAnvil ? 'Anvil fork' : 'live network'})`);
```

Do NOT change any contract addresses — they are the same on the Anvil fork since we
forked Base Sepolia where those contracts already exist.

## STEP 4 — Fix the gas limit in transactionBuilder.ts

Open `arbitrage-bot-backend/src/execution/transactionBuilder.ts`.

Find the hardcoded gas limit (it is currently 420_000 or similar). This is the root cause
of the simulation vs execution mismatch — flash loan arbitrage through Aave V3 with
two DEX hops requires ~2,100,000 gas minimum.

Replace the hardcoded gas limit with:

```typescript
// Gas limit for flash loan arbitrage:
// - Aave V3 flash loan overhead: ~200k gas
// - UniswapV2 swap: ~150k gas  
// - UniswapV3 swap: ~200k gas
// - Contract overhead + safety margin: ~450k gas
// Total realistic minimum: ~1,000,000 — set to 3M for Anvil testing headroom
// TODO: Replace with eth_estimateGas before mainnet deployment
const GAS_LIMIT = BigInt(3_000_000);
```

Find every place `gasLimit` is set in this file and replace the value with `GAS_LIMIT`.

## STEP 5 — Create the pool seeding and price imbalance script

Create file: `scripts/seed-anvil-pools.ts`

This script does three things:
1. Gives the test wallet unlimited ETH and WETH on the Anvil fork
2. Forces a price imbalance between two pools so the bot has something to detect
3. Prints a summary of pool reserves before and after

The script must use ethers v6 syntax (BigInt, not BigNumber).

```typescript
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config();

// ── Config ─────────────────────────────────────────────────────────────────
const ANVIL_RPC = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';
const ANVIL_KEY = process.env.ANVIL_PRIVATE_KEY!;

// Base Sepolia addresses — same on your Anvil fork since you forked Base Sepolia
// Replace these with your actual deployed pool addresses from DEXRegistry
const WETH_ADDRESS  = '0x4200000000000000000000000000000000000006'; // canonical WETH on Base Sepolia
const USDC_ADDRESS  = '<YOUR_BASE_SEPOLIA_USDC_ADDRESS>';           // fill this in
const V2_POOL       = '<YOUR_V2_WETH_USDC_POOL_ADDRESS>';           // fill from DEXRegistry
const V3_POOL       = '<YOUR_V3_WETH_USDC_POOL_ADDRESS>';           // fill from DEXRegistry

// ABIs — minimal
const WETH_ABI = [
  'function deposit() payable',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
const V2_POOL_ABI = [
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)',
  'function token0() view returns (address)',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(ANVIL_RPC);
  const signer   = new ethers.Wallet(ANVIL_KEY, provider);
  const addr     = await signer.getAddress();

  console.log('=== Anvil Pool Seeding Script ===');
  console.log(`Wallet: ${addr}`);

  // ── 1. Fund wallet with extra ETH via Anvil cheatcode ──
  console.log('\n[1] Setting ETH balance to 10,000 ETH...');
  await provider.send('anvil_setBalance', [
    addr,
    '0x' + (BigInt('10000') * BigInt(10 ** 18)).toString(16),
  ]);
  const ethBal = await provider.getBalance(addr);
  console.log(`    ETH balance: ${ethers.formatEther(ethBal)} ETH`);

  // ── 2. Wrap ETH → WETH ──
  console.log('\n[2] Wrapping 500 ETH to WETH...');
  const weth = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
  const wrapTx = await weth.deposit({ value: ethers.parseEther('500') });
  await wrapTx.wait();
  const wethBal = await weth.balanceOf(addr);
  console.log(`    WETH balance: ${ethers.formatEther(wethBal)} WETH`);

  // ── 3. Read V2 pool reserves before ──
  console.log('\n[3] V2 pool reserves BEFORE imbalance:');
  const v2Pool = new ethers.Contract(V2_POOL, V2_POOL_ABI, provider);
  const [r0_before, r1_before] = await v2Pool.getReserves();
  const token0 = await v2Pool.token0();
  const isWethToken0 = token0.toLowerCase() === WETH_ADDRESS.toLowerCase();
  const wethReserveBefore  = isWethToken0 ? r0_before : r1_before;
  const usdcReserveBefore  = isWethToken0 ? r1_before : r0_before;
  console.log(`    WETH reserve: ${ethers.formatEther(wethReserveBefore)}`);
  console.log(`    USDC reserve: ${ethers.formatUnits(usdcReserveBefore, 6)}`);

  // ── 4. Transfer WETH directly into the V2 pool to skew reserves ──
  // This creates an imbalance WITHOUT going through the router (no swap fees eating into arb)
  console.log('\n[4] Injecting 100 WETH directly into V2 pool to create price imbalance...');
  const transferTx = await weth.transfer(V2_POOL, ethers.parseEther('100'));
  await transferTx.wait();
  
  // Force the pool to sync its reserves by calling sync() or via a tiny swap
  // Note: UniswapV2 requires sync() or a swap to update internal reserves after direct transfer
  const V2_FULL_ABI = [...V2_POOL_ABI, 'function sync()'];
  const v2PoolSigner = new ethers.Contract(V2_POOL, V2_FULL_ABI, signer);
  const syncTx = await v2PoolSigner.sync();
  await syncTx.wait();

  // ── 5. Read V2 pool reserves after ──
  console.log('\n[5] V2 pool reserves AFTER imbalance:');
  const [r0_after, r1_after] = await v2Pool.getReserves();
  const wethReserveAfter = isWethToken0 ? r0_after : r1_after;
  const usdcReserveAfter = isWethToken0 ? r1_after : r0_after;
  console.log(`    WETH reserve: ${ethers.formatEther(wethReserveAfter)}`);
  console.log(`    USDC reserve: ${ethers.formatUnits(usdcReserveAfter, 6)}`);

  // ── 6. Calculate implied prices ──
  const priceBefore = Number(ethers.formatUnits(usdcReserveBefore, 6)) / 
                      Number(ethers.formatEther(wethReserveBefore));
  const priceAfter  = Number(ethers.formatUnits(usdcReserveAfter, 6)) / 
                      Number(ethers.formatEther(wethReserveAfter));
  console.log('\n=== Price Summary ===');
  console.log(`V2 WETH price before: $${priceBefore.toFixed(2)}`);
  console.log(`V2 WETH price after:  $${priceAfter.toFixed(2)}`);
  console.log(`Price moved by: ${((priceAfter / priceBefore - 1) * 100).toFixed(2)}%`);
  console.log('\nArbitrage opportunity created. Start the bot now.');
}

main().catch(console.error);
```

## STEP 6 — Update package.json scripts

Open `arbitrage-bot-backend/package.json`. ADD these scripts — do not remove existing ones:

```json
"anvil:start":   "bash ../scripts/start-anvil-fork.sh",
"anvil:seed":    "ts-node ../scripts/seed-anvil-pools.ts",
"dev:anvil":     "USE_ANVIL=true ts-node src/index.ts",
"snapshot":      "cast rpc evm_snapshot --rpc-url http://127.0.0.1:8545",
"revert":        "cast rpc evm_revert --rpc-url http://127.0.0.1:8545"
```

## STEP 7 — Create a README section for the Anvil workflow

Create file: `docs/ANVIL_TESTING.md`

Write a clear step-by-step guide covering:
1. Prerequisites (Foundry installed, BASE_SEPOLIA_RPC_URL set, FORK_BLOCK_NUMBER set)
2. Terminal 1: `bash scripts/start-anvil-fork.sh`
3. Terminal 2: `cd arbitrage-bot-backend && npm run anvil:seed` (to create price imbalance)
4. Terminal 3: `cd arbitrage-bot-backend && npm run dev:anvil` (start bot)
5. How to reset state: call `evm_snapshot` before seeding, `evm_revert` to restore
6. Troubleshooting: "contract not found" means wrong FORK_BLOCK_NUMBER (must be after your deployment tx)

## STEP 8 — Verify everything compiles

After all changes:
1. Run `forge build` — must pass with zero errors
2. Run `cd arbitrage-bot-backend && npx tsc --noEmit` — must pass with zero errors
3. Fix any type errors before marking complete

## Hard Rules — READ BEFORE TOUCHING ANY FILE

1. DO NOT modify any Solidity contract logic — only scripts and TypeScript change
2. DO NOT remove existing env vars or RPC references — live Base Sepolia must still work when USE_ANVIL=false
3. DO NOT use ethers v5 syntax (BigNumber, etc.) — this project uses ethers v6 (BigInt throughout)
4. DO NOT change any deployed contract addresses — the Anvil fork preserves them
5. Read CLAUDE.md before modifying any existing file — it contains the file modification policy
6. Work one step at a time. Show full file content for every file you create or modify.
7. Do not proceed to the next step if the current step has a compile or type error.

## Success Criteria

After completing all steps, this workflow must function:

Terminal 1:
  bash scripts/start-anvil-fork.sh
  → Anvil starts, reports chain 84532, block = FORK_BLOCK_NUMBER

Terminal 2:
  cd arbitrage-bot-backend && npm run anvil:seed
  → Prints WETH/USDC reserves before and after, confirms price moved

Terminal 3:
  cd arbitrage-bot-backend && npm run dev:anvil
  → Bot starts, connects to http://127.0.0.1:8545, finds ArbitrageBot at its
    existing Base Sepolia address, detects price imbalance, attempts execution
  → Flash loan transaction does NOT fail with out-of-gas (gas limit is now 3M)