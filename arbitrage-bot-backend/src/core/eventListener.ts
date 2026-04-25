import { ethers } from "ethers";
import { EventEmitter } from "events";
import logger from "../utils/logger";
import {
    Pool,
    PriceCache,
    PriceUpdate,
    DEXType,
    DEX_PROTOCOL_MAP,
    DEXProtocol,
} from "../types";
import config from "../config";

const SLOT0_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
    "function liquidity() view returns (uint128)",
];
const GET_RESERVES_ABI = ["function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)"];
const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];

const POLL_INTERVAL_MS = 3_000;
const LOG_BLOCK_RANGE = 50;

export class EventListener extends EventEmitter {
    private provider: ethers.JsonRpcProvider;
    private pools: Pool[];
    private priceCache: PriceCache = {};
    private isConnected: boolean = false;
    private pollTimer?: NodeJS.Timeout;
    private lastBlock: number = 0;
    private tokenDecimalsCache: Record<string, number> = {};
    private blacklistedPools = new Set(config.blacklistedPools);

    private readonly UNISWAP_V3_SWAP_TOPIC =
        "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
    private readonly UNISWAP_V2_SYNC_TOPIC =
        "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";

    // Accept wsUrl for API compatibility but use rpcUrl (HTTP) for reliable polling
    constructor(wsUrlOrRpcUrl: string, pools: Pool[], rpcUrl?: string) {
        super();
        const httpUrl = rpcUrl ?? wsUrlOrRpcUrl.replace(/^wss?:\/\//, "https://");
        this.provider = new ethers.JsonRpcProvider(httpUrl);
        this.pools = pools;
    }

    addPool(pool: Pool): void {
        if (this.blacklistedPools.has(pool.address.toLowerCase())) {
            logger.info("EventListener: blacklisted pool, skipping", {
                address: pool.address,
            });
            return;
        }
        if (!this.pools.find(p => p.address === pool.address)) {
            this.pools.push(pool);
            logger.info("EventListener: pool added", { address: pool.address, dexType: pool.dexType });
            this._seedPoolPrice(pool).catch(e =>
                logger.warn("EventListener: seed price failed", { address: pool.address, error: e.message })
            );
        }
    }

    updatePools(pools: Pool[]): void {
        this.pools = pools;
    }

    private async _seedPoolPrice(pool: Pool): Promise<void> {
        try {
            const [dec0, dec1] = await Promise.all([
                this.getTokenDecimals(pool.token0),
                this.getTokenDecimals(pool.token1),
            ]);
            const protocol = DEX_PROTOCOL_MAP[pool.dexType];
            if (protocol === DEXProtocol.UniswapV3Style) {
                const contract = new ethers.Contract(pool.address, SLOT0_ABI, this.provider);
                const [slot0, poolLiquidity] = await Promise.all([
                    contract.slot0(),
                    contract.liquidity().catch(() => 0n),
                ]);
                const [sqrtPriceX96] = slot0;
                const price = this.computeV3Price(sqrtPriceX96 as bigint, dec0, dec1);
                if (price > 0) {
                    const now = Date.now();
                    this.priceCache[pool.address] = {
                        token0: pool.token0,
                        token1: pool.token1,
                        price,
                        liquidity: Number(poolLiquidity),
                        lastUpdate: now,
                    };
                    logger.debug("EventListener: seeded V3 price", { address: pool.address, price });
                    this.emit("priceUpdate", {
                        pool: pool.address,
                        dexType: pool.dexType,
                        token0: pool.token0,
                        token1: pool.token1,
                        price,
                        liquidity: Number(poolLiquidity),
                        timestamp: now,
                    } as PriceUpdate);
                }
            } else if (protocol === DEXProtocol.UniswapV2Style) {
                const contract = new ethers.Contract(pool.address, GET_RESERVES_ABI, this.provider);
                const [reserve0, reserve1] = await contract.getReserves();
                const r0 = Number(ethers.formatUnits(reserve0 as bigint, dec0));
                const r1 = Number(ethers.formatUnits(reserve1 as bigint, dec1));
                if (r0 > 0 && r1 > 0) {
                    const price = r1 / r0;
                    const liquidity = (r0 + r1) / 2;
                    const now = Date.now();
                    this.priceCache[pool.address] = {
                        token0: pool.token0,
                        token1: pool.token1,
                        price,
                        liquidity,
                        lastUpdate: now,
                    };
                    logger.debug("EventListener: seeded V2 price", { address: pool.address, price });
                    this.emit("priceUpdate", {
                        pool: pool.address,
                        dexType: pool.dexType,
                        token0: pool.token0,
                        token1: pool.token1,
                        price,
                        liquidity,
                        timestamp: now,
                    } as PriceUpdate);
                }
            }
        } catch (e: any) {
            logger.warn("EventListener: _seedPoolPrice error", { address: pool.address, error: e.message });
        }
    }

    async startMonitoring(): Promise<void> {
        logger.info(`Starting monitoring for ${this.pools.length} pools`);

        if (this.pollTimer) return;

        try {
            this.lastBlock = await this.provider.getBlockNumber();
        } catch (e: any) {
            logger.error("EventListener: failed to get starting block", { error: e.message });
        }

        // Seed prices for all pools already registered before polling begins
        await Promise.all(
            this.pools
                .filter((p) => {
                    const isBlacklisted = this.blacklistedPools.has(
                        p.address.toLowerCase(),
                    );
                    if (isBlacklisted) {
                        logger.info("EventListener: blacklisted pool, skipping", {
                            address: p.address,
                        });
                    }
                    return !isBlacklisted;
                })
                .map(p => this._seedPoolPrice(p).catch(e =>
            logger.warn("EventListener: seed price failed", { address: p.address, error: e.message })
                )),
        );
        logger.info("EventListener: initial price seed complete", { pools: this.pools.length });

        const poll = async () => {
            if (!this.isConnected) return;
            if (this.pools.length === 0) return;

            try {
                const currentBlock = await this.provider.getBlockNumber();
                if (currentBlock <= this.lastBlock) return;

                const fromBlock = Math.max(this.lastBlock + 1, currentBlock - LOG_BLOCK_RANGE);
                const toBlock = currentBlock;

                const v2Pools = this.pools.filter(
                    p =>
                        DEX_PROTOCOL_MAP[p.dexType] === DEXProtocol.UniswapV2Style &&
                        !this.blacklistedPools.has(p.address.toLowerCase())
                );
                const v3Pools = this.pools.filter(
                    p =>
                        DEX_PROTOCOL_MAP[p.dexType] === DEXProtocol.UniswapV3Style &&
                        !this.blacklistedPools.has(p.address.toLowerCase())
                );

                const promises: Promise<void>[] = [];

                if (v2Pools.length > 0) {
                    promises.push(
                        this.provider.getLogs({
                            address: v2Pools.map(p => p.address),
                            topics: [this.UNISWAP_V2_SYNC_TOPIC],
                            fromBlock,
                            toBlock,
                        }).then(logs => {
                            for (const log of logs) {
                                const pool = v2Pools.find(
                                    p => p.address.toLowerCase() === log.address.toLowerCase()
                                );
                                if (pool) this._handleUniswapV2Sync(log, pool);
                            }
                        })
                    );
                }

                if (v3Pools.length > 0) {
                    promises.push(
                        this.provider.getLogs({
                            address: v3Pools.map(p => p.address),
                            topics: [this.UNISWAP_V3_SWAP_TOPIC],
                            fromBlock,
                            toBlock,
                        }).then(logs => {
                            for (const log of logs) {
                                const pool = v3Pools.find(
                                    p => p.address.toLowerCase() === log.address.toLowerCase()
                                );
                                if (pool) this._handleUniswapV3Swap(log, pool);
                            }
                        })
                    );
                }

                await Promise.all(promises);
                this.lastBlock = toBlock;
            } catch (error: any) {
                logger.error("EventListener: poll error", {
                    message: error?.message,
                    stack: error?.stack,
                    code: error?.code,
                    cause: error?.cause,
                });
            }
        };

        this.isConnected = true;
        this.pollTimer = setInterval(poll, POLL_INTERVAL_MS);
        logger.info("EventListener: polling started", { intervalMs: POLL_INTERVAL_MS });
    }

    private _handleUniswapV3Swap(log: ethers.Log, pool: Pool): void {
        try {
            const [, , sqrtPriceX96, liquidity] =
                ethers.AbiCoder.defaultAbiCoder().decode(
                    ["int256", "int256", "uint160", "uint128", "int24"],
                    log.data,
                );

            const dec0 = this.tokenDecimalsCache[pool.token0.toLowerCase()] ?? 18;
            const dec1 = this.tokenDecimalsCache[pool.token1.toLowerCase()] ?? 18;
            const price = this.computeV3Price(sqrtPriceX96 as bigint, dec0, dec1);

            this.priceCache[pool.address] = {
                token0: pool.token0,
                token1: pool.token1,
                price,
                liquidity: Number(liquidity),
                lastUpdate: Date.now(),
            };

            this.emit("priceUpdate", {
                pool: pool.address,
                dexType: pool.dexType,
                token0: pool.token0,
                token1: pool.token1,
                price,
                liquidity: Number(liquidity),
                timestamp: Date.now(),
            } as PriceUpdate);
        } catch (error) {
            logger.error("Error handling V3 swap event", { error, pool: pool.address });
        }
    }

    private _handleUniswapV2Sync(log: ethers.Log, pool: Pool): void {
        try {
            const [reserve0, reserve1] =
                ethers.AbiCoder.defaultAbiCoder().decode(
                    ["uint112", "uint112"],
                    log.data,
                );

            const dec0 = this.tokenDecimalsCache[pool.token0.toLowerCase()] ?? 18;
            const dec1 = this.tokenDecimalsCache[pool.token1.toLowerCase()] ?? 18;
            const normalizedReserve0 = Number(ethers.formatUnits(reserve0 as bigint, dec0));
            const normalizedReserve1 = Number(ethers.formatUnits(reserve1 as bigint, dec1));
            if (normalizedReserve0 <= 0 || normalizedReserve1 <= 0) return;
            const price = normalizedReserve1 / normalizedReserve0;
            const liquidity = (normalizedReserve0 + normalizedReserve1) / 2;

            this.priceCache[pool.address] = {
                token0: pool.token0,
                token1: pool.token1,
                price,
                liquidity,
                lastUpdate: Date.now(),
            };

            this.emit("priceUpdate", {
                pool: pool.address,
                dexType: pool.dexType,
                token0: pool.token0,
                token1: pool.token1,
                price,
                liquidity,
                timestamp: Date.now(),
            } as PriceUpdate);
        } catch (error) {
            logger.error("Error handling V2 sync event", { error, pool: pool.address });
        }
    }

    getPrice(poolAddress: string): number | null {
        const cached = this.priceCache[poolAddress];
        if (!cached) return null;
        if (Date.now() - cached.lastUpdate > 60000) return null;
        return cached.price;
    }

    getPriceCache(): PriceCache {
        return this.priceCache;
    }

    async stop(): Promise<void> {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        this.isConnected = false;
        logger.info("Event listener stopped");
    }

    private async getTokenDecimals(tokenAddress: string): Promise<number> {
        const key = tokenAddress.toLowerCase();
        if (this.tokenDecimalsCache[key] !== undefined) {
            return this.tokenDecimalsCache[key];
        }

        try {
            const token = new ethers.Contract(tokenAddress, ERC20_DECIMALS_ABI, this.provider);
            const raw = await token.decimals();
            const decimals = typeof raw === "number" ? raw : Number(raw);
            this.tokenDecimalsCache[key] = Number.isFinite(decimals) ? decimals : 18;
            return this.tokenDecimalsCache[key];
        } catch {
            this.tokenDecimalsCache[key] = 18;
            return 18;
        }
    }

    private computeV3Price(
        sqrtPriceX96: bigint,
        token0Decimals: number,
        token1Decimals: number,
    ): number {
        const ratioX192 = sqrtPriceX96 * sqrtPriceX96;
        const scale = 10n ** 18n;
        const rawRatioScaled = (ratioX192 * scale) / (2n ** 192n);
        const rawRatio = Number(ethers.formatUnits(rawRatioScaled, 18));
        const decimalScale = Math.pow(10, token0Decimals - token1Decimals);
        return rawRatio * decimalScale;
    }
}
