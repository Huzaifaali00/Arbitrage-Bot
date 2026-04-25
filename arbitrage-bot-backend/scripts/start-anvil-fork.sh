#!/bin/bash
# Forks Base Sepolia at a pinned block so pool state is always identical
# USAGE: bash scripts/start-anvil-fork.sh
# Run this in a separate terminal BEFORE starting the bot

source .env

# FORK_RPC_URL must be a real remote Base Sepolia endpoint (Alchemy/QuickNode/public).
# BASE_SEPOLIA_RPC_URL is kept as http://127.0.0.1:8545 so the bot talks to the
# local fork — do NOT use it here or Anvil will try to fork from itself.
if [ -z "$FORK_RPC_URL" ]; then
  echo "ERROR: FORK_RPC_URL not set in .env"
  echo "Set it to a real Base Sepolia RPC, e.g.:"
  echo "  FORK_RPC_URL=https://sepolia.base.org"
  echo "  FORK_RPC_URL=https://base-sepolia.g.alchemy.com/v2/<KEY>"
  exit 1
fi

if [ -z "$FORK_BLOCK_NUMBER" ]; then
  echo "ERROR: FORK_BLOCK_NUMBER not set in .env"
  echo "Run: cast block-number --rpc-url \$FORK_RPC_URL"
  exit 1
fi

echo "Starting Anvil fork of Base Sepolia at block $FORK_BLOCK_NUMBER..."
echo "Fork source: $FORK_RPC_URL"
echo "RPC will be available at: http://127.0.0.1:8545"
echo "Chain ID: 84532 (Base Sepolia preserved)"
echo ""

anvil \
  --fork-url "$FORK_RPC_URL" \
  --fork-block-number "$FORK_BLOCK_NUMBER" \
  --chain-id 84532 \
  --block-time 2 \
  --accounts 10 \
  --balance 10000 \
  --port 8545 \
  --host 0.0.0.0
