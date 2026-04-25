"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpportunityDetector = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const ethers_1 = require("ethers");
const types_1 = require("../types");
const config_1 = __importDefault(require("../config"));
/**
 * Advanced opportunity detector using Bellman-Ford negative cycle detection
 * This finds 2-3x more opportunities than simple pattern matching
 */
class OpportunityDetector {
    constructor(pools, provider, minProfitPercentage = 0.3) {
        this.poolFeeCache = {};
        this.tokenDecimalsCache = {};
        this.maxProfitPercentageCap = 1000;
        this.quoterAddress = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
        this.v2PoolAbi = [
            "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)",
            "function token0() view returns (address)",
            "function token1() view returns (address)",
        ];
        this.v3PoolAbi = ["function fee() view returns (uint24)"];
        this.erc20Abi = ["function decimals() view returns (uint8)"];
        this.v3QuoterV2Abi = [
            "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
        ];
        this.preferredStartTokens = new Set([
            // Base WETH (mainnet + sepolia)
            "0x4200000000000000000000000000000000000006",
            // Arbitrum WETH (mainnet)
            "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
            // Arbitrum Sepolia WETH
            "0x980b62da83eff3d4576c6479938c2e87f5f3bc7a",
        ]);
        this.pools = pools;
        this.minProfitPercentage = minProfitPercentage;
        this.priceCache = {};
        this.provider = provider;
        this.blacklistedPools = new Set(config_1.default.blacklistedPools);
        this.maxPlausibleProfitUsd = config_1.default.maxPlausibleProfitUsd;
    }
    updatePriceCache(cache) {
        this.priceCache = cache;
    }
    updatePools(pools) {
        this.pools = pools;
    }
    addPool(pool) {
        this.pools.push(pool);
    }
    /**
     * Bellman-Ford algorithm for detecting arbitrage cycles
     * Time: O(V*E) where V=tokens, E=pools
     * Returns profitable cycles to execute
     */
    detectArbitrageCycles(startToken) {
        const distances = new Map();
        const parents = new Map();
        const allTokens = this.getUniqueTokens();
        allTokens.forEach((token) => {
            distances.set(token, token === startToken ? 0 : Infinity);
        });
        for (let i = 0; i < allTokens.length - 1; i++) {
            for (const pool of this.pools) {
                const token0 = pool.token0.toLowerCase();
                const token1 = pool.token1.toLowerCase();
                const price = this.getPoolPrice(pool.address);
                if (!price)
                    continue;
                const logPrice = Math.log(price);
                const newDist0 = (distances.get(token1) || Infinity) + logPrice;
                const newDist1 = (distances.get(token0) || Infinity) - logPrice;
                if (newDist0 < (distances.get(token0) || Infinity)) {
                    distances.set(token0, newDist0);
                    parents.set(token0, token1);
                }
                if (newDist1 < (distances.get(token1) || Infinity)) {
                    distances.set(token1, newDist1);
                    parents.set(token1, token0);
                }
            }
        }
        const cycle = [];
        let current = startToken;
        for (let i = 0; i < allTokens.length; i++) {
            const next = parents.get(current);
            if (!next)
                break;
            cycle.push(next);
            current = next;
        }
        const cycleFound = cycle.length > 1 && cycle.includes(startToken);
        const profitRatio = cycleFound
            ? Math.exp(distances.get(startToken) || 0)
            : 1;
        return {
            cycleFound: cycleFound && profitRatio > 1 + this.minProfitPercentage / 100,
            cycle: cycleFound ? cycle : [],
            profitRatio,
        };
    }
    /**
     * Detect simple 2-hop and 3-hop arbitrage opportunities
     * Faster than Bellman-Ford for simple patterns
     */
    async detectSimpleOpportunities() {
        const opportunities = [];
        const poolCount = this.pools.length;
        logger_1.default.debug("OpportunityDetector: scan start", {
            poolCount,
            minProfitPercentage: this.minProfitPercentage,
            cachedPrices: Object.keys(this.priceCache).length,
        });
        for (let i = 0; i < poolCount; i++) {
            for (let j = i + 1; j < poolCount; j++) {
                const pool1 = this.pools[i];
                const pool2 = this.pools[j];
                if (this.blacklistedPools.has(pool1.address.toLowerCase()) ||
                    this.blacklistedPools.has(pool2.address.toLowerCase())) {
                    logger_1.default.info("OpportunityDetector: blacklisted pool, skipping", {
                        pool1: pool1.address,
                        pool2: pool2.address,
                    });
                    continue;
                }
                const price1 = this.getPoolPrice(pool1.address);
                const price2 = this.getPoolPrice(pool2.address);
                logger_1.default.debug("OpportunityDetector: checking pool pair", {
                    pool1: pool1.address,
                    dex1: pool1.dexType,
                    price1,
                    pool2: pool2.address,
                    dex2: pool2.dexType,
                    price2,
                });
                if (pool1.token0.toLowerCase() === pool2.token0.toLowerCase() &&
                    pool1.token1.toLowerCase() === pool2.token1.toLowerCase()) {
                    if (!price1 || !price2) {
                        logger_1.default.debug("OpportunityDetector: 2-hop skipped — missing/stale price", {
                            pool1: pool1.address,
                            pool2: pool2.address,
                            price1,
                            price2,
                        });
                    }
                    else {
                        if (this.shouldSkipTwoHopPair(pool1, pool2)) {
                            continue;
                        }
                        // TESTNET NOTE: 500-fee-tier pools have sparse liquidity and cause high gas (1.8M+).
                        // Prefer 3000-fee-tier pools for testnet. Remove this sort for mainnet.
                        const [preferredPool1, preferredPool2] = this.prioritizeTwoHopPools(pool1, pool2);
                        const arb = await this.calculateTwoHopArb(preferredPool1, preferredPool2);
                        if (arb) {
                            const validated = await this.validateOpportunityWithQuote(arb);
                            if (validated) {
                                opportunities.push(validated);
                            }
                        }
                        else {
                            const midAmount = 1 * price1;
                            const finalAmount = midAmount / price2;
                            const profitPct = (finalAmount / 1 - 1) * 100;
                            logger_1.default.debug("OpportunityDetector: 2-hop skipped — profit below threshold", {
                                pool1: pool1.address,
                                pool2: pool2.address,
                                price1,
                                price2,
                                profitPct: profitPct.toFixed(4),
                                minRequired: this.minProfitPercentage,
                            });
                        }
                    }
                }
                for (let k = j + 1; k < poolCount; k++) {
                    const pool3 = this.pools[k];
                    if (this.blacklistedPools.has(pool3.address.toLowerCase())) {
                        logger_1.default.info("OpportunityDetector: blacklisted pool, skipping", {
                            pool3: pool3.address,
                        });
                        continue;
                    }
                    const price3 = this.getPoolPrice(pool3.address);
                    const arb = this.calculateThreeHopTriangle(pool1, pool2, pool3);
                    if (arb) {
                        const validated = await this.validateOpportunityWithQuote(arb);
                        if (validated) {
                            opportunities.push(validated);
                        }
                    }
                    else {
                        logger_1.default.debug("OpportunityDetector: 3-hop skipped", {
                            pool1: pool1.address,
                            pool2: pool2.address,
                            pool3: pool3.address,
                            price1,
                            price2,
                            price3,
                            reason: (!price1 || !price2 || !price3)
                                ? "missing/stale price"
                                : "profit below threshold or no valid triangle",
                        });
                    }
                }
            }
        }
        logger_1.default.debug("OpportunityDetector: scan complete", {
            opportunitiesFound: opportunities.length,
        });
        return opportunities.sort((a, b) => b.profitPercentage - a.profitPercentage);
    }
    async getTokenDecimals(tokenAddress) {
        const key = tokenAddress.toLowerCase();
        if (this.tokenDecimalsCache[key] !== undefined) {
            return this.tokenDecimalsCache[key];
        }
        try {
            const token = new ethers_1.ethers.Contract(tokenAddress, this.erc20Abi, this.provider);
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
        if (!((inKey === token0Key && outKey === token1Key) || (inKey === token1Key && outKey === token0Key))) {
            throw new Error(`V2 quote token mismatch for pool ${poolAddress}`);
        }
        const reserveIn = inKey === token0Key ? BigInt(reserve0) : BigInt(reserve1);
        const reserveOut = inKey === token0Key ? BigInt(reserve1) : BigInt(reserve0);
        if (reserveIn <= 0n || reserveOut <= 0n) {
            throw new Error(`V2 quote missing reserves for ${poolAddress}`);
        }
        const amountInWithFee = amountIn * 997n;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
    }
    async quoteV3Hop(poolAddress, tokenIn, tokenOut, amountIn) {
        const fee = await this.resolvePoolFee(poolAddress);
        const quoter = new ethers_1.ethers.Contract(this.quoterAddress, this.v3QuoterV2Abi, this.provider);
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
        return currentAmount;
    }
    async validateOpportunityWithQuote(opportunity) {
        if (opportunity.profitPercentage > this.maxProfitPercentageCap) {
            logger_1.default.warn("Opportunity rejected: profitPercentage sanity cap exceeded", {
                id: opportunity.id,
                profitPercentage: opportunity.profitPercentage,
            });
            return null;
        }
        try {
            const tokenIn = opportunity.route[0].tokenIn;
            const decimals = await this.getTokenDecimals(tokenIn);
            const oneToken = 10n ** BigInt(Math.max(0, Math.min(decimals, 18)));
            const quotedFinal = await this.quoteRouteExactInput(opportunity, oneToken);
            if (quotedFinal <= oneToken) {
                logger_1.default.debug("Opportunity rejected: quoted output not profitable", {
                    id: opportunity.id,
                    quotedFinal: quotedFinal.toString(),
                    quotedInput: oneToken.toString(),
                });
                return null;
            }
            const quotedProfitRaw = quotedFinal - oneToken;
            const estimatedProfit = Number(ethers_1.ethers.formatUnits(quotedProfitRaw, decimals));
            if (estimatedProfit > this.maxPlausibleProfitUsd) {
                logger_1.default.warn("Opportunity rejected: profit exceeds plausible cap", {
                    id: opportunity.id,
                    estimatedProfit,
                    maxPlausibleProfitUsd: this.maxPlausibleProfitUsd,
                });
                return null;
            }
            const quotedProfitPercentage = (Number(quotedFinal) / Number(oneToken) - 1) * 100;
            if (quotedProfitPercentage > this.maxProfitPercentageCap) {
                logger_1.default.warn("Opportunity rejected: quoted profit percentage too high", {
                    id: opportunity.id,
                    quotedProfitPercentage,
                });
                return null;
            }
            return {
                ...opportunity,
                profitPercentage: quotedProfitPercentage,
                estimatedProfit,
                netProfit: estimatedProfit - opportunity.estimatedGasCost,
            };
        }
        catch (error) {
            logger_1.default.warn("Opportunity rejected: quote simulation failed", {
                id: opportunity.id,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
    prioritizeTwoHopPools(pool1, pool2) {
        const knownFeeByPool = {
            "0x46880b404cd35c165eddeff7421019f8dd25f4ad": 3000,
            "0x94bfc0574ff48e92ce43d495376c477b1d0eeec0": 500,
        };
        const addressPriority = {
            // Prefer this 3000-tier testnet pool first.
            "0x46880b404cd35c165eddeff7421019f8dd25f4ad": 0,
            // Keep unknown fee-tier between preferred and deprioritized pools.
            "0x4664755562152edda3a3073850fb62835451926a": 1,
            // Deprioritize sparse 500-tier pool on testnet.
            "0x94bfc0574ff48e92ce43d495376c477b1d0eeec0": 3,
        };
        const resolveFee = (pool) => {
            if (typeof pool.fee === "number" && pool.fee > 0) {
                return pool.fee;
            }
            return knownFeeByPool[pool.address.toLowerCase()];
        };
        const fee1 = resolveFee(pool1);
        const fee2 = resolveFee(pool2);
        const addrScore1 = addressPriority[pool1.address.toLowerCase()] ?? 2;
        const addrScore2 = addressPriority[pool2.address.toLowerCase()] ?? 2;
        if (addrScore1 !== addrScore2) {
            return addrScore1 < addrScore2 ? [pool1, pool2] : [pool2, pool1];
        }
        const score = (fee) => {
            if (fee === 3000)
                return 0;
            if (fee === 500)
                return 2;
            return 1;
        };
        return score(fee1) <= score(fee2) ? [pool1, pool2] : [pool2, pool1];
    }
    shouldSkipTwoHopPair(pool1, pool2) {
        const a = pool1.address.toLowerCase();
        const b = pool2.address.toLowerCase();
        // Base Sepolia known-bad pair that frequently reverts with empty data during
        // simulation under sparse-liquidity traversal.
        const badA = "0x46880b404cd35c165eddeff7421019f8dd25f4ad";
        const badB = "0x94bfc0574ff48e92ce43d495376c477b1d0eeec0";
        return (a === badA && b === badB) || (a === badB && b === badA);
    }
    calculateTwoHopArb(pool1, pool2) {
        const price1 = this.getPoolPrice(pool1.address);
        const price2 = this.getPoolPrice(pool2.address);
        if (!price1 || !price2)
            return null;
        // price = token1/token0 (e.g. WETH per USDC, since USDC < WETH by address).
        // Forward:  token0 → pool1 → token1 → pool2 → token0   profit = price1/price2
        // Reverse:  token1 → pool1 → token0 → pool2 → token1   profit = price2/price1
        // Only one direction can be profitable at a time; prefer token1-start (WETH) so
        // the bot can execute with its actual holdings.
        const midFwd = price1; // 1 * price1
        const finalFwd = midFwd / price2;
        const profitFwd = (finalFwd - 1) * 100;
        const midRev = 1 / price1; // 1 / price1
        const finalRev = midRev * price2;
        const profitRev = (finalRev - 1) * 100;
        const useFwd = profitFwd > this.minProfitPercentage;
        const useRev = profitRev > this.minProfitPercentage;
        if (!useFwd && !useRev)
            return null;
        const fwdStartsPreferred = this.preferredStartTokens.has(pool1.token0.toLowerCase());
        const revStartsPreferred = this.preferredStartTokens.has(pool1.token1.toLowerCase());
        if (useRev && revStartsPreferred) {
            return this.buildTwoHopReverseOpportunity(pool1, pool2, midRev, finalRev, profitRev);
        }
        if (useFwd && fwdStartsPreferred) {
            return this.buildTwoHopForwardOpportunity(pool1, pool2, midFwd, finalFwd, profitFwd);
        }
        if (useRev) {
            return this.buildTwoHopReverseOpportunity(pool1, pool2, midRev, finalRev, profitRev);
        }
        return this.buildTwoHopForwardOpportunity(pool1, pool2, midFwd, finalFwd, profitFwd);
    }
    buildTwoHopReverseOpportunity(pool1, pool2, midRev, finalRev, profitRev) {
        return {
            id: `2hop-${pool1.address}-${pool2.address}`,
            tokenIn: pool1.token1,
            tokenOut: pool1.token1,
            route: [
                {
                    pool: pool1.address,
                    dexType: pool1.dexType,
                    tokenIn: pool1.token1,
                    tokenOut: pool1.token0,
                    expectedOutput: midRev,
                    slippage: 0.3,
                },
                {
                    pool: pool2.address,
                    dexType: pool2.dexType,
                    tokenIn: pool1.token0,
                    tokenOut: pool1.token1,
                    expectedOutput: finalRev,
                    slippage: 0.3,
                },
            ],
            profitPercentage: profitRev,
            estimatedProfit: finalRev - 1,
            estimatedGasCost: 0.015,
            netProfit: (finalRev - 1) * 0.985,
            confidence: 0.85,
            detectedAt: Date.now(),
            expiresAt: Date.now() + 5000,
        };
    }
    buildTwoHopForwardOpportunity(pool1, pool2, midFwd, finalFwd, profitFwd) {
        return {
            id: `2hop-${pool1.address}-${pool2.address}`,
            tokenIn: pool1.token0,
            tokenOut: pool1.token0,
            route: [
                {
                    pool: pool1.address,
                    dexType: pool1.dexType,
                    tokenIn: pool1.token0,
                    tokenOut: pool1.token1,
                    expectedOutput: midFwd,
                    slippage: 0.3,
                },
                {
                    pool: pool2.address,
                    dexType: pool2.dexType,
                    tokenIn: pool1.token1,
                    tokenOut: pool1.token0,
                    expectedOutput: finalFwd,
                    slippage: 0.3,
                },
            ],
            profitPercentage: profitFwd,
            estimatedProfit: finalFwd - 1,
            estimatedGasCost: 0.015,
            netProfit: (finalFwd - 1) * 0.985,
            confidence: 0.85,
            detectedAt: Date.now(),
            expiresAt: Date.now() + 5000,
        };
    }
    /**
     * Calculate 3-hop triangular arbitrage across all 6 valid traversal orderings.
     * Requires exactly 3 unique tokens across the 3 pools. Returns null if any
     * price cache entry is missing or stale (>5 s), or if no traversal beats
     * minProfitPercentage. Returns the most profitable traversal found.
     */
    calculateThreeHopTriangle(pool1, pool2, pool3) {
        const pools = [pool1, pool2, pool3];
        const tokenSet = new Set();
        for (const p of pools) {
            tokenSet.add(p.token0.toLowerCase());
            tokenSet.add(p.token1.toLowerCase());
        }
        if (tokenSet.size !== 3)
            return null;
        const [tA, tB, tC] = Array.from(tokenSet);
        const findPool = (ta, tb) => pools.find((p) => {
            const t0 = p.token0.toLowerCase();
            const t1 = p.token1.toLowerCase();
            return (t0 === ta && t1 === tb) || (t0 === tb && t1 === ta);
        });
        const directionalPrice = (pool, fromToken, rawPrice) => pool.token0.toLowerCase() === fromToken ? rawPrice : 1 / rawPrice;
        // All 6 traversal orderings of the 3 tokens (3 starting points × 2 directions)
        const traversals = [
            [tA, tB, tC],
            [tA, tC, tB],
            [tB, tA, tC],
            [tB, tC, tA],
            [tC, tA, tB],
            [tC, tB, tA],
        ];
        let best = null;
        for (const [start, mid, end] of traversals) {
            const p1Pool = findPool(start, mid);
            const p2Pool = findPool(mid, end);
            const p3Pool = findPool(end, start);
            if (!p1Pool || !p2Pool || !p3Pool)
                continue;
            const raw1 = this.getPoolPrice(p1Pool.address);
            const raw2 = this.getPoolPrice(p2Pool.address);
            const raw3 = this.getPoolPrice(p3Pool.address);
            // Abort entirely if any cache entry is absent or stale
            if (raw1 === null || raw2 === null || raw3 === null)
                return null;
            const sl1 = this.getSlippageForDex(p1Pool.dexType);
            const sl2 = this.getSlippageForDex(p2Pool.dexType);
            const sl3 = this.getSlippageForDex(p3Pool.dexType);
            const after1 = directionalPrice(p1Pool, start, raw1) * (1 - sl1 / 100);
            const after2 = after1 * directionalPrice(p2Pool, mid, raw2) * (1 - sl2 / 100);
            const after3 = after2 * directionalPrice(p3Pool, end, raw3) * (1 - sl3 / 100);
            const profitPercentage = (after3 - 1) * 100;
            if (profitPercentage < this.minProfitPercentage)
                continue;
            if (!best || profitPercentage > best.profitPercentage) {
                const gasCost = this.estimateGasCost(3);
                const route = [
                    {
                        pool: p1Pool.address,
                        dexType: p1Pool.dexType,
                        tokenIn: start,
                        tokenOut: mid,
                        expectedOutput: after1,
                        slippage: sl1,
                    },
                    {
                        pool: p2Pool.address,
                        dexType: p2Pool.dexType,
                        tokenIn: mid,
                        tokenOut: end,
                        expectedOutput: after2,
                        slippage: sl2,
                    },
                    {
                        pool: p3Pool.address,
                        dexType: p3Pool.dexType,
                        tokenIn: end,
                        tokenOut: start,
                        expectedOutput: after3,
                        slippage: sl3,
                    },
                ];
                best = {
                    id: `3hop-${pool1.address}-${pool2.address}-${pool3.address}`,
                    tokenIn: start,
                    tokenOut: start,
                    route,
                    profitPercentage,
                    estimatedProfit: after3 - 1,
                    estimatedGasCost: gasCost,
                    netProfit: after3 - 1 - gasCost,
                    confidence: 0.75,
                    detectedAt: Date.now(),
                    expiresAt: Date.now() + 5000,
                };
            }
        }
        return best;
    }
    getSlippageForDex(dexType) {
        switch (dexType) {
            case types_1.DEXType.UniswapV2:
                return 0.5;
            case types_1.DEXType.SushiSwap:
                return 0.5;
            case types_1.DEXType.Aerodrome:
                return 0.3;
            case types_1.DEXType.UniswapV3:
                return 0.3;
            case types_1.DEXType.Curve:
                return 0.2;
            case types_1.DEXType.Balancer:
                return 0.4;
            case types_1.DEXType.PancakeSwap:
                return 0.4;
            default:
                return 0.5;
        }
    }
    getPoolPrice(poolAddress) {
        const cached = this.priceCache[poolAddress];
        if (!cached)
            return null;
        if (Date.now() - cached.lastUpdate > 60000)
            return null;
        if (cached.liquidity <= 0)
            return null;
        return cached.price;
    }
    getUniqueTokens() {
        const tokens = new Set();
        this.pools.forEach((pool) => {
            tokens.add(pool.token0.toLowerCase());
            tokens.add(pool.token1.toLowerCase());
        });
        return Array.from(tokens);
    }
    estimateGasCost(hopCount) {
        const baseGas = 21000;
        let totalGas = baseGas;
        totalGas += hopCount * 60000;
        const gasPrice = 0.0001;
        return (totalGas * gasPrice) / 1e9;
    }
}
exports.OpportunityDetector = OpportunityDetector;
//# sourceMappingURL=opportunityDetector.js.map