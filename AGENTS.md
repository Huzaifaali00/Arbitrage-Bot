# MEV Arbitrage Bot - Agent Instructions

## Project Structure

- `src/ArbitrageBot.sol` - Main smart contract (Solidity/Foundry)
- `arbitrage-bot-backend/` - TypeScript backend (Node.js)
- `test/ArbitrageBot.t.sol` - Contract tests

#Before executing any plan, Keep in context that i want to make this bot a Saas Model.
## Build Commands

```bash
# Solidity contracts
forge build

# TypeScript backend
cd arbitrage-bot-backend && npm run build
```

## Contract Deployment

The `ArbitrageBot` constructor requires an Aave lending pool address:
```bash
forge script script/Deploy.s.sol --rpc-url <RPC> --private-key <KEY> --broadcast
```

## Backend Setup

1. Copy `.env.example` to `.env` and set:
   - `PRIVATE_KEY` - Wallet private key (required for execution)
   - `CONTRACT_ADDRESS` - Deployed contract address
   - `CHAIN` - baseSepolia, base, arbitrumSepolia, or arbitrum

2. Build and run:
   ```bash
   cd arbitrage-bot-backend
   npm install
   npm run build
   npm start
   ```

## Common Issues

- **tsconfig errors**: Use `"moduleResolution": "node16"` and `"module": "Node16"` in `arbitrage-bot-backend/tsconfig.json`
- **Invalid private key**: Backend runs in read-only mode without valid key
- **ArbHop struct**: Has 2 fields (`pool`, `zeroForOne`) - tests must include both
- **Contract constructor**: Requires `_aaveLendingPool` address argument

## Testing

```bash
# Run all tests
forge test

# Run specific test
forge test --match "test_name"
```
