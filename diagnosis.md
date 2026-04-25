FULL DIAGNOSTIC REPORT
CONTRACT CODE — key functions
_executeMultiHopArbInternal (ArbitrageBot.sol:218–252):

Gets info = registry.getPoolInfo(hop.pool) — uses the registry's dexType, ignoring what the backend sent in the hop struct
Does forceApprove(address(adapter), currentAmount) — approves the adapter (not the pool)
Calls adapter.swap(...) with data: abi.encode(hop.pool)
UniswapV3Adapter.swap() (UniswapV3Adapter.sol:59–89):

Decodes the pool address from params.data ✓
Calls v3Pool.swap(recipient=msg.sender=ArbitrageBot, ...)
The pool callback pulls tokens via transferFrom(ArbitrageBot, pool, amount) — requires ArbitrageBot to have approved the adapter (not the pool) ✓
UniswapV2Adapter.swap() (UniswapV2Adapter.sol:189–234):

Completely ignores params.data — re-derives pair from factory via getPool(tokenIn, tokenOut)
Does safeTransferFrom(msg.sender=ArbitrageBot, pair, amountIn) — requires ArbitrageBot to have approved the adapter ✓
Has onlyAuthorizedCaller modifier — requires ArbitrageBot to be in authorizedCallers
ALLOWANCES
Spender	Allowance
WETH → V2 pool (0x46880b)	0
WETH → V3 pool (0x94bfc0)	0
V2Adapter authorizedCallers[ArbitrageBot]	true ✓
Allowances to the pools are zero — but this is not the bug because V3 pulls via the adapter (which IS approved), not the pool directly.

DEXRegistry pool info
Both pools are dexType=1 (UniswapV3):

Pool	dexType	token0	token1	fee
0x46880b...	1 (UniswapV3)	USDC	WETH	3000
0x94bfc0...	1 (UniswapV3)	USDC	WETH	500
The backend's calldata called hop[0] as dexType=0 (V2), but the registry knows it as V3. The contract ignores the hop's dexType field — it reads from the registry. Both hops use the V3 adapter. This is correct behavior.

TRACE REVERT LOCATION
With --from (owner): transaction succeeds end-to-end with gas = 2,109,337.


executeMultiHopArb
  ├─ hop[0]: V3Adapter.swap(WETH→USDC) → 0x46880b pool → consumed ~160k gas
  │    callback: WETH.transferFrom(ArbitrageBot, pool, 0.117 WETH) ✓
  ├─ hop[1]: V3Adapter.swap(USDC→WETH) → 0x94bfc0 pool → consumed ~1,857,581 gas ← MASSIVE
  │    callback: USDC.transferFrom(ArbitrageBot, pool, 18467586) ✓
  └─ balAfter (0.037 WETH) < balBefore (0.13 WETH) → no profit block → returns
The on-chain swap logic is correct. But two critical problems surface:

ROOT CAUSE — Gas Limit Underestimate → OOG revert → data=null
estimateGasForSwap(hopCount=2, flashLoan=false) in transactionBuilder.ts:359–365:


const baseGas     = 80_000n;
const perHopGas   = 110_000n;   // ← assumes 110k per hop
const conversionGas = 120_000n;
// Result: 80k + 220k + 120k = 420,000
Actual gas consumed: 2,109,337 — the fee=500 V3 pool alone consumed 1,857,581 gas crossing many sparse tick boundaries on testnet.

simulateTransaction() passes gasLimit: BigInt(tx.gasLimit) (420k) directly into provider.call():


const result = await this.provider.call({
    to: tx.to,
    data: tx.data,
    from,
    gasPrice: ...,
    gasLimit: BigInt(tx.gasLimit),   // ← 420k cap applied to eth_call too
});
The simulation hits the 420k gas cap mid-execution → OOG → EVM reverts with empty return data → ethers.js logs data: null. This is why the error appears as data=null with no reason string — OOG has no revert message.

Secondary finding: The trade loses money (0.117 WETH in → 0.024 WETH out). The balAfter < balBefore branch in the contract silently skips the profit check. No on-chain protection against unprofitable execution.

PROPOSED FIXES
Fix 1 — Remove gasLimit cap from simulation (transactionBuilder.ts:simulateTransaction):

The simulation should use uncapped gas (let the node default to 30M) to get an accurate revert reason. Gas enforcement belongs only in the submitted tx.


// simulateTransaction: remove gasLimit from the call object
const result = await this.provider.call({
    to: tx.to,
    data: tx.data,
    from,
    // gasLimit intentionally omitted — use node default (30M)
});
Fix 2 — Use provider.estimateGas() for real gas limit (transactionBuilder.ts:buildOpportunityTransaction):

After building calldata, call estimateGas with the owner address and apply a 50% buffer. Fall back to hardcoded only if the estimate fails.


let gasLimit: bigint;
try {
    const estimated = await this.provider.estimateGas({
        to: arbitrageBotAddress,
        data: calldata,
        from: new ethers.Wallet(config.privateKey).address,
    });
    gasLimit = (estimated * 3n) / 2n; // 50% buffer for V3 tick traversal variance
} catch {
    gasLimit = this.estimateGasForSwap(opportunity.route.length, useFlashLoan);
}
Fix 3 — Guard against loss-making trades (ArbitrageBot.sol:_executeMultiHopArbInternal):

The if (balAfter > balBefore) block already exists but silently swallows losses. Add a revert when the trade finishes at a loss, or at minimum require balAfter >= balBefore:


require(balAfter >= balBefore, "ArbitrageBot: trade resulted in loss");
This prevents real-money execution of zero-profit/loss routes.

Ready to apply fixes on your go.
