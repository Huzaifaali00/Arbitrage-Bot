import { ethers } from "ethers";
import { TransactionParams, ArbitrageOpportunity } from "../types";
export declare class TransactionBuilder {
    private provider;
    private poolFeeCache;
    private tokenDecimalsCache;
    private uniswapV3Router;
    private curveRegistry;
    private balancerVault;
    private uniswapV3RouterAbi;
    private curveExchangeAbi;
    private balancerVaultAbi;
    private uniswapV2RouterAbi;
    private uniswapV2Routers;
    private uniswapV2RouterByChain;
    private arbitrageBotAbi;
    private v3QuoterV2Abi;
    private v2PoolAbi;
    private v3PoolAbi;
    private erc20DecimalsAbi;
    private wrappedNativeByChain;
    private v3QuoterByChain;
    constructor(provider: ethers.Provider);
    private getStableToken;
    private getWrappedNativeToken;
    private getTokenDecimals;
    private resolvePoolFee;
    private quoteV2Hop;
    private quoteV3Hop;
    private quoteRouteExactInput;
    /**
     * Build swap calldata for Uniswap V3
     */
    private buildUniswapV3SwapData;
    /**
     * Build swap calldata for Curve
     */
    private buildCurveSwapData;
    /**
     * Build swap calldata for UniswapV2-style routers (swapExactTokensForTokens)
     */
    private buildUniswapV2SwapData;
    /**
     * Build batch swap calldata for Balancer
     */
    private buildBalancerBatchSwapData;
    /**
     * Build calldata for executeBackrun — single-pool back-run with slippage protection.
     * Called when the bot detects a price inefficiency on one pool and wants to
     * capture it with a single directional swap.
     */
    buildBackrunTransaction(pool: string, zeroForOne: boolean, amountIn: bigint, minProfitUSDC: bigint, arbitrageBotAddress: string, gasPrice: bigint, useFlashLoan?: boolean): Promise<TransactionParams>;
    /**
     * Build transaction data for a single arbitrage opportunity.
     *
     * All trades are routed through the ArbitrageBot contract so that:
     *   • profit-to-USDC conversion runs atomically,
     *   • pool whitelisting (DEXRegistry) is enforced,
     *   • flash-loan path can be toggled per-trade via useFlashLoan.
     *
     * @param useFlashLoan  If true, the bot borrows amountIn from Aave V3 instead of
     *                      using its own balance. Enables zero-capital trading.
     */
    buildOpportunityTransaction(opportunity: ArbitrageOpportunity, arbitrageBotAddress: string, initialAmount: bigint, gasPrice: bigint, useFlashLoan?: boolean): Promise<TransactionParams | null>;
    /**
     * Estimate gas for a swap based on number of hops and flash-loan usage.
     * Base: 80k. Per-hop: 110k (adapter swap + ERC20 approvals).
     * Flash-loan overhead: +140k (Aave V3 flashLoanSimple wrap).
     * Profit → USDC conversion: +120k (single V3 swap via adapter).
     */
    private estimateGasForSwap;
    /**
     * Simulate transaction to validate it before sending
     */
    simulateTransaction(tx: TransactionParams, from: string): Promise<{
        success: boolean;
        error?: string;
        result?: string;
    }>;
    /**
     * Update DEX router addresses (useful for multichain support)
     */
    setDexAddresses(chain: "base" | "sepolia", addresses: {
        uniswapV3Router?: string;
        uniswapV2Router?: string;
        curveRegistry?: string;
        balancerVault?: string;
    }): void;
    /**
     * Get current DEX addresses
     */
    getDexAddresses(chain: "base" | "sepolia"): {
        uniswapV3Router: string;
        uniswapV2Router: string;
        curveRegistry: string;
        balancerVault: string;
    };
}
export default TransactionBuilder;
//# sourceMappingURL=transactionBuilder.d.ts.map