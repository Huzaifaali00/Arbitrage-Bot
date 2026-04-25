import { EventEmitter } from "events";
import { Pool, PriceCache } from "../types";
export declare class EventListener extends EventEmitter {
    private provider;
    private pools;
    private priceCache;
    private isConnected;
    private pollTimer?;
    private lastBlock;
    private tokenDecimalsCache;
    private blacklistedPools;
    private readonly UNISWAP_V3_SWAP_TOPIC;
    private readonly UNISWAP_V2_SYNC_TOPIC;
    constructor(wsUrlOrRpcUrl: string, pools: Pool[], rpcUrl?: string);
    addPool(pool: Pool): void;
    updatePools(pools: Pool[]): void;
    private _seedPoolPrice;
    startMonitoring(): Promise<void>;
    private _handleUniswapV3Swap;
    private _handleUniswapV2Sync;
    getPrice(poolAddress: string): number | null;
    getPriceCache(): PriceCache;
    stop(): Promise<void>;
    private getTokenDecimals;
    private computeV3Price;
}
//# sourceMappingURL=eventListener.d.ts.map