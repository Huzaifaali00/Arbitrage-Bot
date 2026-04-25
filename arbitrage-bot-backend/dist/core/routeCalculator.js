"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteCalculator = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
const types_1 = require("../types");
/**
 * Advanced route calculator supporting multi-DEX routing
 * Finds optimal paths across Uniswap V3, Curve, Balancer, dYdX
 */
class RouteCalculator {
    constructor(pools) {
        this.maxHops = 10;
        this.pools = pools;
        this.priceCache = {};
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
     * Calculate optimal route from tokenIn to tokenOut
     * Uses modified Dijkstra's algorithm for best output
     */
    findOptimalRoute(tokenIn, tokenOut, amountIn) {
        if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
            return null;
        }
        const routes = this.findAllRoutes(tokenIn.toLowerCase(), tokenOut.toLowerCase(), this.maxHops);
        if (routes.length === 0) {
            logger_1.default.warn("No routes found", { tokenIn, tokenOut });
            return null;
        }
        let bestRoute = null;
        let bestOutput = 0;
        for (const route of routes) {
            const output = this.calculateRouteOutput(route, amountIn);
            if (output > bestOutput) {
                bestOutput = output;
                bestRoute = route;
            }
        }
        return bestRoute;
    }
    findAllRoutes(tokenIn, tokenOut, maxHops, visited = new Set(), currentPath = []) {
        if (currentPath.length >= maxHops) {
            return [];
        }
        const routes = [];
        visited.add(tokenIn);
        const availablePools = this.pools.filter((pool) => (pool.token0.toLowerCase() === tokenIn ||
            pool.token1.toLowerCase() === tokenIn) &&
            !visited.has(pool.token0.toLowerCase() === tokenIn
                ? pool.token1.toLowerCase()
                : pool.token0.toLowerCase()));
        for (const pool of availablePools) {
            const nextToken = pool.token0.toLowerCase() === tokenIn
                ? pool.token1.toLowerCase()
                : pool.token0.toLowerCase();
            const hop = {
                pool: pool.address,
                dexType: pool.dexType,
                tokenIn,
                tokenOut: nextToken,
                expectedOutput: 0,
                slippage: this.getSlippageForDex(pool.dexType),
            };
            currentPath.push(hop);
            if (nextToken === tokenOut) {
                routes.push([...currentPath]);
            }
            else {
                const subRoutes = this.findAllRoutes(nextToken, tokenOut, maxHops, new Set(visited), [...currentPath]);
                routes.push(...subRoutes);
            }
            currentPath.pop();
        }
        return routes;
    }
    calculateRouteOutput(route, amountIn) {
        let currentAmount = amountIn;
        for (const hop of route) {
            const price = this.priceCache[hop.pool];
            if (!price) {
                return 0;
            }
            const output = currentAmount * price.price * (1 - hop.slippage / 100);
            currentAmount = output;
        }
        return currentAmount;
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
    rankRoutesByProfitability(routes, amountIn) {
        return routes
            .map((route) => ({
            route,
            profit: this.calculateRouteOutput(route, amountIn),
        }))
            .sort((a, b) => b.profit - a.profit);
    }
    findFlashLoanRoute(tokenBorrow, borrowAmount, arbitrageRoute) {
        const finalAmount = this.calculateRouteOutput(arbitrageRoute, borrowAmount);
        const aavePremium = (borrowAmount * 0.09) / 100;
        const profit = finalAmount - borrowAmount - aavePremium;
        if (profit <= 0) {
            logger_1.default.debug("Flash loan route not profitable", { profit });
            return null;
        }
        logger_1.default.debug("Flash loan route viable", {
            profit,
            profitRatio: profit / borrowAmount,
        });
        return arbitrageRoute;
    }
    getAvailableTokens() {
        const tokens = new Set();
        this.pools.forEach((pool) => {
            tokens.add(pool.token0.toLowerCase());
            tokens.add(pool.token1.toLowerCase());
        });
        return Array.from(tokens);
    }
    getLiquidityDepth(poolAddress) {
        const pool = this.pools.find((p) => p.address.toLowerCase() === poolAddress.toLowerCase());
        if (!pool)
            return 0;
        const price = this.priceCache[poolAddress];
        if (!price)
            return 0;
        return price.liquidity;
    }
}
exports.RouteCalculator = RouteCalculator;
//# sourceMappingURL=routeCalculator.js.map