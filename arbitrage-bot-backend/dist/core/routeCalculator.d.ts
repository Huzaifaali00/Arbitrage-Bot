import { Pool, RouteHop, PriceCache } from "../types";
/**
 * Advanced route calculator supporting multi-DEX routing
 * Finds optimal paths across Uniswap V3, Curve, Balancer, dYdX
 */
export declare class RouteCalculator {
    private pools;
    private priceCache;
    private maxHops;
    constructor(pools: Pool[]);
    updatePriceCache(cache: PriceCache): void;
    updatePools(pools: Pool[]): void;
    addPool(pool: Pool): void;
    /**
     * Calculate optimal route from tokenIn to tokenOut
     * Uses modified Dijkstra's algorithm for best output
     */
    findOptimalRoute(tokenIn: string, tokenOut: string, amountIn: number): RouteHop[] | null;
    private findAllRoutes;
    private calculateRouteOutput;
    private getSlippageForDex;
    rankRoutesByProfitability(routes: RouteHop[][], amountIn: number): {
        route: RouteHop[];
        profit: number;
    }[];
    findFlashLoanRoute(tokenBorrow: string, borrowAmount: number, arbitrageRoute: RouteHop[]): RouteHop[] | null;
    getAvailableTokens(): string[];
    getLiquidityDepth(poolAddress: string): number;
}
//# sourceMappingURL=routeCalculator.d.ts.map