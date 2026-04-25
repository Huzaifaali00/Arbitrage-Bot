"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventListener = void 0;
const ethers_1 = require("ethers");
const events_1 = require("events");
const logger_1 = __importDefault(require("../utils/logger"));
const types_1 = require("../types");
const config_1 = __importDefault(require("../config"));
const SLOT0_ABI = [
    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
    "function liquidity() view returns (uint128)",
];
const GET_RESERVES_ABI = ["function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32)"];
const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];
const POLL_INTERVAL_MS = 3000;
const LOG_BLOCK_RANGE = 50;
class EventListener extends events_1.EventEmitter {
    // Accept wsUrl for API compatibility but use rpcUrl (HTTP) for reliable polling
    constructor(wsUrlOrRpcUrl, pools, rpcUrl) {
        super();
        this.priceCache = {};
        this.isConnected = false;
        this.lastBlock = 0;
        this.tokenDecimalsCache = {};
        this.blacklistedPools = new Set(config_1.default.blacklistedPools);
        this.UNISWAP_V3_SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
        this.UNISWAP_V2_SYNC_TOPIC = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
        const httpUrl = rpcUrl ?? wsUrlOrRpcUrl.replace(/^wss?:\/\//, "https://");
        this.provider = new ethers_1.ethers.JsonRpcProvider(httpUrl);
        this.pools = pools;
    }
    addPool(pool) {
        if (this.blacklistedPools.has(pool.address.toLowerCase())) {
            logger_1.default.info("EventListener: blacklisted pool, skipping", {
                address: pool.address,
            });
            return;
        }
        if (!this.pools.find(p => p.address === pool.address)) {
            this.pools.push(pool);
            logger_1.default.info("EventListener: pool added", { address: pool.address, dexType: pool.dexType });
            this._seedPoolPrice(pool).catch(e => logger_1.default.warn("EventListener: seed price failed", { address: pool.address, error: e.message }));
        }
    }
    updatePools(pools) {
        this.pools = pools;
    }
    async _seedPoolPrice(pool) {
        try {
            const [dec0, dec1] = await Promise.all([
                this.getTokenDecimals(pool.token0),
                this.getTokenDecimals(pool.token1),
            ]);
            const protocol = types_1.DEX_PROTOCOL_MAP[pool.dexType];
            if (protocol === types_1.DEXProtocol.UniswapV3Style) {
                const contract = new ethers_1.ethers.Contract(pool.address, SLOT0_ABI, this.provider);
                const [slot0, poolLiquidity] = await Promise.all([
                    contract.slot0(),
                    contract.liquidity().catch(() => 0n),
                ]);
                const [sqrtPriceX96] = slot0;
                const price = this.computeV3Price(sqrtPriceX96, dec0, dec1);
                if (price > 0) {
                    const now = Date.now();
                    this.priceCache[pool.address] = {
                        token0: pool.token0,
                        token1: pool.token1,
                        price,
                        liquidity: Number(poolLiquidity),
                        lastUpdate: now,
                    };
                    logger_1.default.debug("EventListener: seeded V3 price", { address: pool.address, price });
                    this.emit("priceUpdate", {
                        pool: pool.address,
                        dexType: pool.dexType,
                        token0: pool.token0,
                        token1: pool.token1,
                        price,
                        liquidity: Number(poolLiquidity),
                        timestamp: now,
                    });
                }
            }
            else if (protocol === types_1.DEXProtocol.UniswapV2Style) {
                const contract = new ethers_1.ethers.Contract(pool.address, GET_RESERVES_ABI, this.provider);
                const [reserve0, reserve1] = await contract.getReserves();
                const r0 = Number(ethers_1.ethers.formatUnits(reserve0, dec0));
                const r1 = Number(ethers_1.ethers.formatUnits(reserve1, dec1));
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
                    logger_1.default.debug("EventListener: seeded V2 price", { address: pool.address, price });
                    this.emit("priceUpdate", {
                        pool: pool.address,
                        dexType: pool.dexType,
                        token0: pool.token0,
                        token1: pool.token1,
                        price,
                        liquidity,
                        timestamp: now,
                    });
                }
            }
        }
        catch (e) {
            logger_1.default.warn("EventListener: _seedPoolPrice error", { address: pool.address, error: e.message });
        }
    }
    async startMonitoring() {
        logger_1.default.info(`Starting monitoring for ${this.pools.length} pools`);
        if (this.pollTimer)
            return;
        try {
            this.lastBlock = await this.provider.getBlockNumber();
        }
        catch (e) {
            logger_1.default.error("EventListener: failed to get starting block", { error: e.message });
        }
        // Seed prices for all pools already registered before polling begins
        await Promise.all(this.pools
            .filter((p) => {
            const isBlacklisted = this.blacklistedPools.has(p.address.toLowerCase());
            if (isBlacklisted) {
                logger_1.default.info("EventListener: blacklisted pool, skipping", {
                    address: p.address,
                });
            }
            return !isBlacklisted;
        })
            .map(p => this._seedPoolPrice(p).catch(e => logger_1.default.warn("EventListener: seed price failed", { address: p.address, error: e.message }))));
        logger_1.default.info("EventListener: initial price seed complete", { pools: this.pools.length });
        const poll = async () => {
            if (!this.isConnected)
                return;
            if (this.pools.length === 0)
                return;
            try {
                const currentBlock = await this.provider.getBlockNumber();
                if (currentBlock <= this.lastBlock)
                    return;
                const fromBlock = Math.max(this.lastBlock + 1, currentBlock - LOG_BLOCK_RANGE);
                const toBlock = currentBlock;
                const v2Pools = this.pools.filter(p => types_1.DEX_PROTOCOL_MAP[p.dexType] === types_1.DEXProtocol.UniswapV2Style &&
                    !this.blacklistedPools.has(p.address.toLowerCase()));
                const v3Pools = this.pools.filter(p => types_1.DEX_PROTOCOL_MAP[p.dexType] === types_1.DEXProtocol.UniswapV3Style &&
                    !this.blacklistedPools.has(p.address.toLowerCase()));
                const promises = [];
                if (v2Pools.length > 0) {
                    promises.push(this.provider.getLogs({
                        address: v2Pools.map(p => p.address),
                        topics: [this.UNISWAP_V2_SYNC_TOPIC],
                        fromBlock,
                        toBlock,
                    }).then(logs => {
                        for (const log of logs) {
                            const pool = v2Pools.find(p => p.address.toLowerCase() === log.address.toLowerCase());
                            if (pool)
                                this._handleUniswapV2Sync(log, pool);
                        }
                    }));
                }
                if (v3Pools.length > 0) {
                    promises.push(this.provider.getLogs({
                        address: v3Pools.map(p => p.address),
                        topics: [this.UNISWAP_V3_SWAP_TOPIC],
                        fromBlock,
                        toBlock,
                    }).then(logs => {
                        for (const log of logs) {
                            const pool = v3Pools.find(p => p.address.toLowerCase() === log.address.toLowerCase());
                            if (pool)
                                this._handleUniswapV3Swap(log, pool);
                        }
                    }));
                }
                await Promise.all(promises);
                this.lastBlock = toBlock;
            }
            catch (error) {
                logger_1.default.error("EventListener: poll error", {
                    message: error?.message,
                    stack: error?.stack,
                    code: error?.code,
                    cause: error?.cause,
                });
            }
        };
        this.isConnected = true;
        this.pollTimer = setInterval(poll, POLL_INTERVAL_MS);
        logger_1.default.info("EventListener: polling started", { intervalMs: POLL_INTERVAL_MS });
    }
    _handleUniswapV3Swap(log, pool) {
        try {
            const [, , sqrtPriceX96, liquidity] = ethers_1.ethers.AbiCoder.defaultAbiCoder().decode(["int256", "int256", "uint160", "uint128", "int24"], log.data);
            const dec0 = this.tokenDecimalsCache[pool.token0.toLowerCase()] ?? 18;
            const dec1 = this.tokenDecimalsCache[pool.token1.toLowerCase()] ?? 18;
            const price = this.computeV3Price(sqrtPriceX96, dec0, dec1);
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
            });
        }
        catch (error) {
            logger_1.default.error("Error handling V3 swap event", { error, pool: pool.address });
        }
    }
    _handleUniswapV2Sync(log, pool) {
        try {
            const [reserve0, reserve1] = ethers_1.ethers.AbiCoder.defaultAbiCoder().decode(["uint112", "uint112"], log.data);
            const dec0 = this.tokenDecimalsCache[pool.token0.toLowerCase()] ?? 18;
            const dec1 = this.tokenDecimalsCache[pool.token1.toLowerCase()] ?? 18;
            const normalizedReserve0 = Number(ethers_1.ethers.formatUnits(reserve0, dec0));
            const normalizedReserve1 = Number(ethers_1.ethers.formatUnits(reserve1, dec1));
            if (normalizedReserve0 <= 0 || normalizedReserve1 <= 0)
                return;
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
            });
        }
        catch (error) {
            logger_1.default.error("Error handling V2 sync event", { error, pool: pool.address });
        }
    }
    getPrice(poolAddress) {
        const cached = this.priceCache[poolAddress];
        if (!cached)
            return null;
        if (Date.now() - cached.lastUpdate > 60000)
            return null;
        return cached.price;
    }
    getPriceCache() {
        return this.priceCache;
    }
    async stop() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        this.isConnected = false;
        logger_1.default.info("Event listener stopped");
    }
    async getTokenDecimals(tokenAddress) {
        const key = tokenAddress.toLowerCase();
        if (this.tokenDecimalsCache[key] !== undefined) {
            return this.tokenDecimalsCache[key];
        }
        try {
            const token = new ethers_1.ethers.Contract(tokenAddress, ERC20_DECIMALS_ABI, this.provider);
            const raw = await token.decimals();
            const decimals = typeof raw === "number" ? raw : Number(raw);
            this.tokenDecimalsCache[key] = Number.isFinite(decimals) ? decimals : 18;
            return this.tokenDecimalsCache[key];
        }
        catch {
            this.tokenDecimalsCache[key] = 18;
            return 18;
        }
    }
    computeV3Price(sqrtPriceX96, token0Decimals, token1Decimals) {
        const ratioX192 = sqrtPriceX96 * sqrtPriceX96;
        const scale = 10n ** 18n;
        const rawRatioScaled = (ratioX192 * scale) / (2n ** 192n);
        const rawRatio = Number(ethers_1.ethers.formatUnits(rawRatioScaled, 18));
        const decimalScale = Math.pow(10, token0Decimals - token1Decimals);
        return rawRatio * decimalScale;
    }
}
exports.EventListener = EventListener;
//# sourceMappingURL=eventListener.js.map