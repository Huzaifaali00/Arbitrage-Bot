import logger from "../utils/logger";
import { Pool, RouteHop, DEXType, PriceCache } from "../types";

/**
 * Advanced route calculator supporting multi-DEX routing
 * Finds optimal paths across Uniswap V3, Curve, Balancer, dYdX
 */
export class RouteCalculator {
    private pools: Pool[];
    private priceCache: PriceCache;
    private maxHops: number = 10;

    constructor(pools: Pool[]) {
        this.pools = pools;
        this.priceCache = {};
    }

    updatePriceCache(cache: PriceCache): void {
        this.priceCache = cache;
    }

    updatePools(pools: Pool[]): void {
        this.pools = pools;
    }

    addPool(pool: Pool): void {
        this.pools.push(pool);
    }

    /**
     * Calculate optimal route from tokenIn to tokenOut
     * Uses modified Dijkstra's algorithm for best output
     */
    findOptimalRoute(
        tokenIn: string,
        tokenOut: string,
        amountIn: number,
    ): RouteHop[] | null {
        if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
            return null;
        }

        const routes = this.findAllRoutes(
            tokenIn.toLowerCase(),
            tokenOut.toLowerCase(),
            this.maxHops,
        );

        if (routes.length === 0) {
            logger.warn("No routes found", { tokenIn, tokenOut });
            return null;
        }

        let bestRoute: RouteHop[] | null = null;
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

    private findAllRoutes(
        tokenIn: string,
        tokenOut: string,
        maxHops: number,
        visited: Set<string> = new Set(),
        currentPath: RouteHop[] = [],
    ): RouteHop[][] {
        if (currentPath.length >= maxHops) {
            return [];
        }

        const routes: RouteHop[][] = [];
        visited.add(tokenIn);

        const availablePools = this.pools.filter(
            (pool) =>
                (pool.token0.toLowerCase() === tokenIn ||
                    pool.token1.toLowerCase() === tokenIn) &&
                !visited.has(
                    pool.token0.toLowerCase() === tokenIn
                        ? pool.token1.toLowerCase()
                        : pool.token0.toLowerCase(),
                ),
        );

        for (const pool of availablePools) {
            const nextToken =
                pool.token0.toLowerCase() === tokenIn
                    ? pool.token1.toLowerCase()
                    : pool.token0.toLowerCase();

            const hop: RouteHop = {
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
            } else {
                const subRoutes = this.findAllRoutes(
                    nextToken,
                    tokenOut,
                    maxHops,
                    new Set(visited),
                    [...currentPath],
                );
                routes.push(...subRoutes);
            }

            currentPath.pop();
        }

        return routes;
    }

    private calculateRouteOutput(route: RouteHop[], amountIn: number): number {
        let currentAmount = amountIn;

        for (const hop of route) {
            const price = this.priceCache[hop.pool];
            if (!price) {
                return 0;
            }

            const output =
                currentAmount * price.price * (1 - hop.slippage / 100);
            currentAmount = output;
        }

        return currentAmount;
    }

    private getSlippageForDex(dexType: DEXType): number {
        switch (dexType) {
            case DEXType.UniswapV2:
                return 0.5;
            case DEXType.SushiSwap:
                return 0.5;
            case DEXType.Aerodrome:
                return 0.3;
            case DEXType.UniswapV3:
                return 0.3;
            case DEXType.Curve:
                return 0.2;
            case DEXType.Balancer:
                return 0.4;
            case DEXType.PancakeSwap:
                return 0.4;
            default:
                return 0.5;
        }
    }

    rankRoutesByProfitability(
        routes: RouteHop[][],
        amountIn: number,
    ): { route: RouteHop[]; profit: number }[] {
        return routes
            .map((route) => ({
                route,
                profit: this.calculateRouteOutput(route, amountIn),
            }))
            .sort((a, b) => b.profit - a.profit);
    }

    findFlashLoanRoute(
        tokenBorrow: string,
        borrowAmount: number,
        arbitrageRoute: RouteHop[],
    ): RouteHop[] | null {
        const finalAmount = this.calculateRouteOutput(
            arbitrageRoute,
            borrowAmount,
        );
        const aavePremium = (borrowAmount * 0.09) / 100;
        const profit = finalAmount - borrowAmount - aavePremium;

        if (profit <= 0) {
            logger.debug("Flash loan route not profitable", { profit });
            return null;
        }

        logger.debug("Flash loan route viable", {
            profit,
            profitRatio: profit / borrowAmount,
        });
        return arbitrageRoute;
    }

    getAvailableTokens(): string[] {
        const tokens = new Set<string>();
        this.pools.forEach((pool) => {
            tokens.add(pool.token0.toLowerCase());
            tokens.add(pool.token1.toLowerCase());
        });
        return Array.from(tokens);
    }

    getLiquidityDepth(poolAddress: string): number {
        const pool = this.pools.find(
            (p) => p.address.toLowerCase() === poolAddress.toLowerCase(),
        );
        if (!pool) return 0;

        const price = this.priceCache[poolAddress];
        if (!price) return 0;

        return price.liquidity;
    }
}
