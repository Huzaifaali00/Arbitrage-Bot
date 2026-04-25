"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionBuilder = void 0;
const ethers_1 = require("ethers");
const types_1 = require("../types");
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
class TransactionBuilder {
    constructor(provider) {
        this.poolFeeCache = {};
        this.tokenDecimalsCache = {};
        // Uniswap V3 SwapRouter02 addresses (Base-native on mainnet)
        this.uniswapV3Router = {
            base: "0x2626664c2603336E57B271c5C0b26F421741e481", // Base mainnet SwapRouter02
            sepolia: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4", // Base Sepolia SwapRouter02
        };
        // Curve router / meta-registry on Base
        this.curveRegistry = {
            base: "0xd6681e74eEA20d196c15038C580f721EF2aB6320", // Curve Router on Base mainnet
            sepolia: "0xd6681e74eEA20d196c15038C580f721EF2aB6320",
        };
        // Balancer V2 Vault (same canonical address on every chain it's deployed to)
        this.balancerVault = {
            base: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
            sepolia: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
        };
        // Uniswap V3 Router ABI (partial)
        this.uniswapV3RouterAbi = [
            "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut)",
            "function exactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn)",
        ];
        // Curve Exchange ABI (minimal)
        this.curveExchangeAbi = [
            "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) returns (uint256)",
        ];
        // Balancer Vault ABI (partial)
        this.balancerVaultAbi = [
            "function batchSwap(uint8 kind, tuple(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[] swaps, address[] assets, tuple(address sender, bool fromInternalBalance, address recipient, bool toInternalBalance) funds, int256[] limits, uint256 deadline) returns (int256[])",
        ];
        // UniswapV2-style Router ABI
        this.uniswapV2RouterAbi = [
            "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
        ];
        // UniswapV2-style router addresses on Base mainnet (canonical deployments only)
        this.uniswapV2Routers = {
            [types_1.DEXType.UniswapV2]: "0x4752BA5dbc23F44d87826aeF3c0c8E6084bF3917", // Uniswap V2 Router on Base
            [types_1.DEXType.SushiSwap]: "0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891", // SushiSwap RouteProcessor on Base
            [types_1.DEXType.Aerodrome]: "0xcF77a3Ba9A5CA922335E4585f154F7b56eFE928C", // Aerodrome Router on Base
            [types_1.DEXType.PancakeSwap]: "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb", // PancakeSwap V2 Router on Base
        };
        // Chain-aware Uniswap V2 router (Base Sepolia uses a different deployment)
        this.uniswapV2RouterByChain = {
            base: "0x4752BA5dbc23F44d87826aeF3c0c8E6084bF3917",
            sepolia: "0x1689E7B1F10000AE47eBfE339a4f69dECd19F602",
        };
        // ArbitrageBot contract ABI — must mirror ArbitrageBot.sol exactly.
        // BackrunParams:      pool, zeroForOne, amountIn (uint256), minProfitUSDC (uint256), deadline, useFlashLoan
        // MultiHopArbParams:  hops[(pool,zeroForOne)], tokenIn, amountIn (uint256), minProfitUSDC, deadline, useFlashLoan
        this.arbitrageBotAbi = [
            "function executeBackrun((address pool, bool zeroForOne, uint256 amountIn, uint256 minProfitUSDC, uint256 deadline, bool useFlashLoan) params)",
            "function executeMultiHopArb(((address pool, bool zeroForOne)[] hops, address tokenIn, uint256 amountIn, uint256 minProfitUSDC, uint256 deadline, bool useFlashLoan) params)",
            "function distributeToVault(uint256 amount)",
        ];
        this.v3QuoterV2Abi = [
            "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
        ];
        this.v2PoolAbi = [
            "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
            "function token0() view returns (address)",
            "function token1() view returns (address)",
        ];
        this.v3PoolAbi = ["function fee() view returns (uint24)"];
        this.erc20DecimalsAbi = ["function decimals() view returns (uint8)"];
        this.wrappedNativeByChain = {
            base: "0x4200000000000000000000000000000000000006",
            baseSepolia: "0x4200000000000000000000000000000000000006",
            arbitrum: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
            arbitrumSepolia: "0x980b62da83eff3d4576c6479938c2e87f5f3bc7a",
        };
        this.v3QuoterByChain = {
            baseSepolia: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
        };
        this.provider = provider;
    }
    getStableToken() {
        return config_1.default.profitTokenAddress.toLowerCase();
    }
    getWrappedNativeToken() {
        return this.wrappedNativeByChain[config_1.default.chain].toLowerCase();
    }
    async getTokenDecimals(tokenAddress) {
        const key = tokenAddress.toLowerCase();
        if (this.tokenDecimalsCache[key] !== undefined) {
            return this.tokenDecimalsCache[key];
        }
        try {
            const token = new ethers_1.ethers.Contract(tokenAddress, this.erc20DecimalsAbi, this.provider);
            const raw = await token.decimals();
            const decimals = typeof raw === "number" ? raw : Number(raw);
            this.tokenDecimalsCache[key] = Number.isFinite(decimals)
                ? decimals
                : 18;
        }
        catch {
            this.tokenDecimalsCache[key] = 18;
        }
        return this.tokenDecimalsCache[key];
    }
    async resolvePoolFee(poolAddress) {
        const key = poolAddress.toLowerCase();
        if (this.poolFeeCache[key] !== undefined) {
            return this.poolFeeCache[key];
        }
        const pool = new ethers_1.ethers.Contract(poolAddress, this.v3PoolAbi, this.provider);
        const rawFee = await pool.fee();
        const fee = typeof rawFee === "number" ? rawFee : Number(rawFee);
        this.poolFeeCache[key] = fee;
        return fee;
    }
    async quoteV2Hop(poolAddress, tokenIn, tokenOut, amountIn) {
        const pair = new ethers_1.ethers.Contract(poolAddress, this.v2PoolAbi, this.provider);
        const [[reserve0, reserve1], token0, token1] = await Promise.all([
            pair.getReserves(),
            pair.token0(),
            pair.token1(),
        ]);
        const inKey = tokenIn.toLowerCase();
        const outKey = tokenOut.toLowerCase();
        const token0Key = String(token0).toLowerCase();
        const token1Key = String(token1).toLowerCase();
        if (!((inKey === token0Key && outKey === token1Key) ||
            (inKey === token1Key && outKey === token0Key))) {
            throw new Error(`V2 quote token ordering mismatch for pool ${poolAddress}`);
        }
        const reserveIn = inKey === token0Key ? BigInt(reserve0) : BigInt(reserve1);
        const reserveOut = inKey === token0Key ? BigInt(reserve1) : BigInt(reserve0);
        if (reserveIn <= 0n || reserveOut <= 0n) {
            throw new Error(`V2 quote missing reserves for pool ${poolAddress}`);
        }
        const amountInWithFee = amountIn * 997n;
        const numerator = amountInWithFee * reserveOut;
        const denominator = reserveIn * 1000n + amountInWithFee;
        return numerator / denominator;
    }
    async quoteV3Hop(poolAddress, tokenIn, tokenOut, amountIn) {
        const quoterAddress = this.v3QuoterByChain[config_1.default.chain];
        if (!quoterAddress) {
            throw new Error(`No Uniswap V3 quoter configured for ${config_1.default.chain}`);
        }
        const fee = await this.resolvePoolFee(poolAddress);
        const quoter = new ethers_1.ethers.Contract(quoterAddress, this.v3QuoterV2Abi, this.provider);
        const result = await quoter.quoteExactInputSingle.staticCall({
            tokenIn,
            tokenOut,
            amountIn,
            fee,
            sqrtPriceLimitX96: 0n,
        });
        return BigInt(result.amountOut);
    }
    async quoteRouteExactInput(opportunity, initialAmount) {
        let currentAmount = initialAmount;
        for (const hop of opportunity.route) {
            currentAmount =
                hop.dexType === types_1.DEXType.UniswapV2 ||
                    hop.dexType === types_1.DEXType.SushiSwap ||
                    hop.dexType === types_1.DEXType.Aerodrome ||
                    hop.dexType === types_1.DEXType.PancakeSwap
                    ? await this.quoteV2Hop(hop.pool, hop.tokenIn, hop.tokenOut, currentAmount)
                    : await this.quoteV3Hop(hop.pool, hop.tokenIn, hop.tokenOut, currentAmount);
        }
        const startToken = opportunity.route[0]?.tokenIn.toLowerCase();
        const stableToken = this.getStableToken();
        return {
            finalAmount: currentAmount,
            stableProfitUSDC: startToken === stableToken && currentAmount > initialAmount
                ? currentAmount - initialAmount
                : 0n,
        };
    }
    /**
     * Build swap calldata for Uniswap V3
     */
    buildUniswapV3SwapData(tokenIn, tokenOut, amountIn, minAmountOut, fee = 3000, // 0.3% default
    deadline = Math.floor(Date.now() / 1000) + 60) {
        const iface = new ethers_1.Interface(this.uniswapV3RouterAbi);
        const params = {
            tokenIn,
            tokenOut,
            fee,
            recipient: ethers_1.ethers.ZeroAddress, // Will be replaced by caller
            deadline,
            amountIn,
            amountOutMinimum: minAmountOut,
            sqrtPriceLimitX96: 0n,
        };
        return iface.encodeFunctionData("exactInputSingle", [params]);
    }
    /**
     * Build swap calldata for Curve
     */
    buildCurveSwapData(tokenIn, tokenOut, amountIn, minAmountOut, indexIn = 0, indexOut = 1) {
        const iface = new ethers_1.Interface(this.curveExchangeAbi);
        return iface.encodeFunctionData("exchange", [
            indexIn,
            indexOut,
            amountIn,
            minAmountOut,
        ]);
    }
    /**
     * Build swap calldata for UniswapV2-style routers (swapExactTokensForTokens)
     */
    buildUniswapV2SwapData(tokenIn, tokenOut, amountIn, minAmountOut, routerAddress, deadline = Math.floor(Date.now() / 1000) + 60) {
        const iface = new ethers_1.Interface(this.uniswapV2RouterAbi);
        return iface.encodeFunctionData("swapExactTokensForTokens", [
            amountIn,
            minAmountOut,
            [tokenIn, tokenOut],
            ethers_1.ethers.ZeroAddress, // recipient — replaced by caller
            deadline,
        ]);
    }
    /**
     * Build batch swap calldata for Balancer
     */
    buildBalancerBatchSwapData(swapPaths, deadline = Math.floor(Date.now() / 1000) + 60) {
        const iface = new ethers_1.Interface(this.balancerVaultAbi);
        // Build swaps array
        const swaps = swapPaths.map((path, index) => ({
            poolId: "0x" + "0".repeat(64), // Placeholder - would be actual pool ID
            assetInIndex: index,
            assetOutIndex: index + 1,
            amount: path.amountIn,
            userData: "0x",
        }));
        // Build assets array
        const assets = [swapPaths[0].tokenIn];
        swapPaths.forEach((path) => {
            if (!assets.includes(path.tokenOut)) {
                assets.push(path.tokenOut);
            }
        });
        // Build funds tuple
        const funds = {
            sender: ethers_1.ethers.ZeroAddress,
            fromInternalBalance: false,
            recipient: ethers_1.ethers.ZeroAddress,
            toInternalBalance: false,
        };
        // Build limits array
        const limits = swapPaths.map((path) => -Number(path.minAmountOut)); // Negative for out
        return iface.encodeFunctionData("batchSwap", [
            0, // SwapKind.GIVEN_IN
            swaps,
            assets,
            funds,
            limits,
            deadline,
        ]);
    }
    /**
     * Build calldata for executeBackrun — single-pool back-run with slippage protection.
     * Called when the bot detects a price inefficiency on one pool and wants to
     * capture it with a single directional swap.
     */
    async buildBackrunTransaction(pool, zeroForOne, amountIn, minProfitUSDC, arbitrageBotAddress, gasPrice, useFlashLoan = false) {
        useFlashLoan = config_1.default.flashLoanEnabled ?? false;
        const deadline = Math.floor(Date.now() / 1000) + 60;
        const iface = new ethers_1.Interface(this.arbitrageBotAbi);
        const calldata = iface.encodeFunctionData("executeBackrun", [
            {
                pool,
                zeroForOne,
                amountIn,
                minProfitUSDC,
                deadline,
                useFlashLoan,
            },
        ]);
        const estimatedGas = 180000n; // Back-run is one hop: base 80k + V3 swap ~100k
        return {
            to: arbitrageBotAddress,
            data: calldata,
            value: "0",
            gasLimit: estimatedGas.toString(),
            gasPrice: gasPrice.toString(),
        };
    }
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
    async buildOpportunityTransaction(opportunity, arbitrageBotAddress, initialAmount, gasPrice, useFlashLoan = false) {
        try {
            useFlashLoan = config_1.default.flashLoanEnabled ?? false;
            // Guard: only enforce token balance when self-funded execution is used.
            const tokenIn = opportunity.route[0].tokenIn;
            const stableToken = this.getStableToken();
            const wrappedNativeToken = this.getWrappedNativeToken();
            if (!useFlashLoan) {
                const erc20 = new ethers_1.ethers.Contract(tokenIn, ["function balanceOf(address) view returns (uint256)"], this.provider);
                const tokenBalance = await erc20.balanceOf(arbitrageBotAddress);
                if (tokenBalance < initialAmount) {
                    logger_1.default.warn("Skipping: amountIn exceeds bot tokenIn balance", {
                        tokenIn,
                        balance: tokenBalance.toString(),
                        amountIn: initialAmount.toString(),
                    });
                    return null;
                }
            }
            if (!useFlashLoan && tokenIn.toLowerCase() !== stableToken) {
                logger_1.default.warn("Skipping self-funded route without on-chain stablecoin guard", {
                    opportunityId: opportunity.id,
                    tokenIn,
                });
                return null;
            }
            let quotedRoute;
            try {
                quotedRoute = await this.quoteRouteExactInput(opportunity, initialAmount);
            }
            catch (quoteError) {
                logger_1.default.warn("Skipping route that failed exact-quote validation", {
                    opportunityId: opportunity.id,
                    error: quoteError instanceof Error
                        ? quoteError.message
                        : String(quoteError),
                });
                return null;
            }
            if (quotedRoute.finalAmount <= initialAmount) {
                const decimals = await this.getTokenDecimals(tokenIn);
                logger_1.default.warn("Skipping unprofitable quoted route", {
                    opportunityId: opportunity.id,
                    tokenIn,
                    initialAmount: ethers_1.ethers.formatUnits(initialAmount, decimals),
                    quotedFinalAmount: ethers_1.ethers.formatUnits(quotedRoute.finalAmount, decimals),
                });
                return null;
            }
            const deadline = Math.floor(Date.now() / 1000) + 60;
            const minProfitUSDC = tokenIn.toLowerCase() === stableToken &&
                quotedRoute.stableProfitUSDC > 0n
                ? (quotedRoute.stableProfitUSDC * 70n) / 100n
                : 0n;
            const iface = new ethers_1.Interface(this.arbitrageBotAbi);
            const firstHop = opportunity.route[0];
            let calldata;
            if (opportunity.route.length >= 2) {
                // Multi-hop arb — route through executeMultiHopArb
                const hops = opportunity.route.map((hop) => ({
                    pool: hop.pool,
                    // token0 < token1 in every AMM pool (sorted by address).
                    // zeroForOne=true ↔ tokenOut is token1 (higher address).
                    zeroForOne: hop.tokenOut.toLowerCase() > hop.tokenIn.toLowerCase(),
                }));
                calldata = iface.encodeFunctionData("executeMultiHopArb", [
                    {
                        hops,
                        tokenIn: firstHop.tokenIn,
                        amountIn: initialAmount,
                        minProfitUSDC,
                        deadline,
                        useFlashLoan,
                    },
                ]);
            }
            else {
                // Single-hop back-run — route through executeBackrun
                calldata = iface.encodeFunctionData("executeBackrun", [
                    {
                        pool: firstHop.pool,
                        zeroForOne: true,
                        amountIn: initialAmount,
                        minProfitUSDC,
                        deadline,
                        useFlashLoan,
                    },
                ]);
            }
            let gasLimit;
            try {
                const signerAddress = new ethers_1.ethers.Wallet(config_1.default.privateKey).address;
                const estimated = await this.provider.estimateGas({
                    to: arbitrageBotAddress,
                    data: calldata,
                    from: signerAddress,
                });
                gasLimit = (estimated * 2n) / 1n;
                logger_1.default.debug("Gas estimated", {
                    estimated: estimated.toString(),
                    withBuffer: gasLimit.toString(),
                });
                // Gas cost check — skip if gas cost exceeds expected profit
                const feeData = await this.provider.getFeeData();
                const gasCostWei = gasLimit * (feeData.gasPrice ?? 1000000000n);
                const quotedStableProfit = tokenIn.toLowerCase() === stableToken
                    ? Number(ethers_1.ethers.formatUnits(quotedRoute.stableProfitUSDC, 6))
                    : Math.max(opportunity.estimatedProfit, 0);
                const profitWei = ethers_1.ethers.parseEther(Math.max(quotedStableProfit, 0).toFixed(18));
                if (gasCostWei >= profitWei) {
                    logger_1.default.warn("Skipping: gas cost exceeds estimated profit", {
                        gasCostWei: gasCostWei.toString(),
                        profitWei: profitWei.toString(),
                    });
                    return null;
                }
            }
            catch (err) {
                const message = err?.shortMessage || err?.message || "estimateGas failed";
                const isRevert = err?.code === "CALL_EXCEPTION" ||
                    String(message).toLowerCase().includes("execution reverted");
                if (isRevert) {
                    logger_1.default.warn("estimateGas reverted, aborting opportunity", {
                        opportunityId: opportunity.id,
                        code: err?.code,
                        reason: err?.reason,
                        message,
                    });
                    return null;
                }
                logger_1.default.warn("estimateGas non-revert failure, using static fallback", {
                    opportunityId: opportunity.id,
                    code: err?.code,
                    message,
                });
                gasLimit = this.estimateGasForSwap(opportunity.route.length, useFlashLoan);
            }
            logger_1.default.debug("Building tx", {
                useFlashLoan,
                flashLoanEnabled: config_1.default.flashLoanEnabled,
                hopCount: opportunity.route.length,
                opportunityId: opportunity.id,
            });
            const tx = {
                to: arbitrageBotAddress,
                data: calldata,
                value: "0",
                gasLimit: gasLimit.toString(),
                gasPrice: gasPrice.toString(),
                tracking: {
                    botAddress: arbitrageBotAddress,
                    tokenIn,
                    stableToken: config_1.default.profitTokenAddress,
                    wrappedNativeToken,
                },
            };
            logger_1.default.info("Built opportunity transaction", {
                opportunityId: opportunity.id,
                dexType: firstHop.dexType,
                routeLength: opportunity.route.length,
                useFlashLoan,
                estimatedGas: gasLimit.toString(),
                minProfitUSDC: minProfitUSDC.toString(),
                quotedFinalAmount: quotedRoute.finalAmount.toString(),
            });
            return tx;
        }
        catch (error) {
            logger_1.default.error("Failed to build opportunity transaction", {
                error,
                opportunity: opportunity.id,
            });
            throw error;
        }
    }
    /**
     * Estimate gas for a swap based on number of hops and flash-loan usage.
     * Base: 80k. Per-hop: 110k (adapter swap + ERC20 approvals).
     * Flash-loan overhead: +140k (Aave V3 flashLoanSimple wrap).
     * Profit → USDC conversion: +120k (single V3 swap via adapter).
     */
    estimateGasForSwap(hopCount, useFlashLoan = false) {
        const baseGas = 80000n;
        const perHopGas = 110000n;
        const conversionGas = 120000n;
        const flashLoanOverhead = useFlashLoan ? 140000n : 0n;
        return baseGas + perHopGas * BigInt(hopCount) + conversionGas + flashLoanOverhead;
    }
    /**
     * Simulate transaction to validate it before sending
     */
    async simulateTransaction(tx, from) {
        try {
            const result = await this.provider.call({
                to: tx.to,
                data: tx.data,
                from,
                gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
            });
            logger_1.default.debug("Transaction simulation successful", { result });
            return {
                success: true,
                result,
            };
        }
        catch (error) {
            logger_1.default.warn("Transaction simulation failed", {
                reason: error?.reason,
                message: error?.message,
                data: error?.data,
                code: error?.code,
            });
            return {
                success: false,
                error: error?.reason ?? error?.message,
            };
        }
    }
    /**
     * Update DEX router addresses (useful for multichain support)
     */
    setDexAddresses(chain, addresses) {
        if (addresses.uniswapV3Router) {
            this.uniswapV3Router[chain] = addresses.uniswapV3Router;
        }
        if (addresses.uniswapV2Router) {
            this.uniswapV2RouterByChain[chain] = addresses.uniswapV2Router;
        }
        if (addresses.curveRegistry) {
            this.curveRegistry[chain] = addresses.curveRegistry;
        }
        if (addresses.balancerVault) {
            this.balancerVault[chain] = addresses.balancerVault;
        }
    }
    /**
     * Get current DEX addresses
     */
    getDexAddresses(chain) {
        return {
            uniswapV3Router: this.uniswapV3Router[chain],
            uniswapV2Router: this.uniswapV2RouterByChain[chain],
            curveRegistry: this.curveRegistry[chain],
            balancerVault: this.balancerVault[chain],
        };
    }
}
exports.TransactionBuilder = TransactionBuilder;
exports.default = TransactionBuilder;
//# sourceMappingURL=transactionBuilder.js.map