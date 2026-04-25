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
