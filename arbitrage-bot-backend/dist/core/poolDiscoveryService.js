"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PoolDiscoveryService = void 0;
const events_1 = require("events");
const ethers_1 = require("ethers");
const logger_1 = __importDefault(require("../utils/logger"));
const types_1 = require("../types");
// Maps the Solidity DEXType enum (uint8) to the TypeScript DEXType string enum.
// Order must match DEXRegistry.sol: UniswapV2=0, UniswapV3=1, SushiSwap=2, Curve=3,
// Balancer=4, dYdX=5, Aerodrome=6, PancakeSwap=7 (8–12 unsupported here).
const SOLIDITY_DEX_TYPE_MAP = {
    0: types_1.DEXType.UniswapV2,
    1: types_1.DEXType.UniswapV3,
    2: types_1.DEXType.SushiSwap,
    3: types_1.DEXType.Curve,
    4: types_1.DEXType.Balancer,
    6: types_1.DEXType.Aerodrome,
    7: types_1.DEXType.PancakeSwap,
};
// Per-chain factory addresses. Only chains/DEXes with canonical deployments are listed.
const FACTORY_ADDRESSES_BY_CHAIN = {
    base: {
        [types_1.DEXType.UniswapV2]: "0x8909Dc15e40953B386fa8f440Db4C4702d4f9b93",
        [types_1.DEXType.UniswapV3]: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
        [types_1.DEXType.SushiSwap]: "0x71524B4f93c58fcbF659783284E38825f0622859",
        [types_1.DEXType.Aerodrome]: "0x420DD5456806d6211b0Af69306338AAF02107212",
        [types_1.DEXType.PancakeSwap]: "0x02A84C1b3BdD2099c8dAD49E66D9F4fA4d7e6e9F",
        [types_1.DEXType.Curve]: "0x3093f9B57A428F3EB6285a589cb35bEA6e78c336",
        [types_1.DEXType.Balancer]: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    },
    // Base Sepolia (chainId 84532) — factories differ from mainnet.
    baseSepolia: {
        [types_1.DEXType.UniswapV3]: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
        [types_1.DEXType.UniswapV2]: "0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e",
    },
    arbitrum: {
        [types_1.DEXType.UniswapV2]: "0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9",
        [types_1.DEXType.UniswapV3]: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        [types_1.DEXType.SushiSwap]: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
    },
    arbitrumSepolia: {
        [types_1.DEXType.UniswapV3]: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
    },
};
const PAIR_CREATED_TOPIC = "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9";
const POOL_CREATED_TOPIC = "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118";
const LOG_BATCH_SIZE = 2000;
class UniswapV2DiscoveryHandler {
    constructor(factoryAddress) {
        this.name = "UniswapV2Handler";
        this.factoryAddress = factoryAddress;
    }
    async discoverPools(provider, startBlock, endBlock) {
        const results = [];
        try {
            for (let from = startBlock; from <= endBlock; from += LOG_BATCH_SIZE) {
                const to = Math.min(from + LOG_BATCH_SIZE - 1, endBlock);
                let logs;
                try {
                    logs = await provider.getLogs({
                        address: this.factoryAddress,
                        topics: [PAIR_CREATED_TOPIC],
                        fromBlock: from,
                        toBlock: to,
                    });
                }
                catch (err) {
                    logger_1.default.error("UniswapV2DiscoveryHandler: getLogs failed", {
                        from,
                        to,
                        err,
                    });
                    continue;
                }
                if (logs.length === 0)
                    continue;
                const uniqueBlocks = new Set(logs.map((l) => l.blockNumber));
                const blockTimestamps = new Map();
                for (const blockNum of uniqueBlocks) {
                    try {
                        const block = await provider.getBlock(blockNum);
                        if (block)
                            blockTimestamps.set(blockNum, block.timestamp);
                    }
                    catch {
                        blockTimestamps.set(blockNum, 0);
                    }
                }
                for (const log of logs) {
                    try {
                        // PairCreated(address indexed token0, address indexed token1, address pair, uint allPairsLength)
                        // topics[1]=token0, topics[2]=token1, data[0:32]=pair, data[32:64]=allPairsLength
                        const token0 = "0x" + log.topics[1].slice(-40);
                        const token1 = "0x" + log.topics[2].slice(-40);
                        const pair = "0x" + log.data.slice(2, 66).slice(-40);
                        const blockTimestamp = blockTimestamps.get(log.blockNumber) ?? 0;
                        results.push({
                            address: ethers_1.ethers.getAddress(pair),
                            token0: ethers_1.ethers.getAddress(token0),
                            token1: ethers_1.ethers.getAddress(token1),
                            tvl: 0,
                            volume24h: 0,
                            createdAt: blockTimestamp,
                            fee: 3000,
                        });
                    }
                    catch (err) {
                        logger_1.default.warn("UniswapV2DiscoveryHandler: failed to decode log", { err });
                    }
                }
            }
        }
        catch (err) {
            logger_1.default.error("UniswapV2DiscoveryHandler: discoverPools failed", {
                err,
            });
            return [];
        }
        return results;
    }
    async fetchPoolMetrics(provider, poolAddress) {
        const abi = [
            "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
        ];
        const contract = new ethers_1.ethers.Contract(poolAddress, abi, provider);
        const [reserve0, reserve1, blockTimestampLast] = await contract.getReserves();
        return {
            reserve0,
            reserve1,
            lastUpdate: Number(blockTimestampLast) * 1000,
        };
    }
    async validatePool(provider, poolAddress) {
        try {
            const abi = [
                "function token0() external view returns (address)",
                "function token1() external view returns (address)",
            ];
            const contract = new ethers_1.ethers.Contract(poolAddress, abi, provider);
            const [token0, token1] = await Promise.all([
                contract.token0(),
                contract.token1(),
            ]);
            const [code0, code1] = await Promise.all([
                provider.getCode(token0),
                provider.getCode(token1),
            ]);
            return code0 !== "0x" && code1 !== "0x";
        }
        catch {
            return false;
        }
    }
}
class UniswapV3DiscoveryHandler {
    constructor(factoryAddress) {
        this.name = "UniswapV3Handler";
        this.factoryAddress = factoryAddress;
    }
    async discoverPools(provider, startBlock, endBlock) {
        const results = [];
        try {
            for (let from = startBlock; from <= endBlock; from += LOG_BATCH_SIZE) {
                const to = Math.min(from + LOG_BATCH_SIZE - 1, endBlock);
                let logs;
                try {
                    logs = await provider.getLogs({
                        address: this.factoryAddress,
                        topics: [POOL_CREATED_TOPIC],
                        fromBlock: from,
                        toBlock: to,
                    });
                }
                catch (err) {
                    logger_1.default.error("UniswapV3DiscoveryHandler: getLogs failed", {
                        from,
                        to,
                        err,
                    });
                    continue;
                }
                if (logs.length === 0)
                    continue;
                const uniqueBlocks = new Set(logs.map((l) => l.blockNumber));
                const blockTimestamps = new Map();
                for (const blockNum of uniqueBlocks) {
                    try {
                        const block = await provider.getBlock(blockNum);
                        if (block)
                            blockTimestamps.set(blockNum, block.timestamp);
                    }
                    catch {
                        blockTimestamps.set(blockNum, 0);
                    }
                }
                for (const log of logs) {
                    try {
                        // PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)
                        // topics[1]=token0, topics[2]=token1, topics[3]=fee, data[0:32]=tickSpacing, data[32:64]=pool
                        const token0 = "0x" + log.topics[1].slice(-40);
                        const token1 = "0x" + log.topics[2].slice(-40);
                        const fee = Number(BigInt(log.topics[3]));
                        const pool = "0x" + log.data.slice(66).slice(-40);
                        const blockTimestamp = blockTimestamps.get(log.blockNumber) ?? 0;
                        results.push({
                            address: ethers_1.ethers.getAddress(pool),
                            token0: ethers_1.ethers.getAddress(token0),
                            token1: ethers_1.ethers.getAddress(token1),
                            tvl: 0,
                            volume24h: 0,
                            createdAt: blockTimestamp,
                            fee,
                        });
                    }
                    catch (err) {
                        logger_1.default.warn("UniswapV3DiscoveryHandler: failed to decode log", { err });
                    }
                }
            }
        }
        catch (err) {
            logger_1.default.error("UniswapV3DiscoveryHandler: discoverPools failed", {
                err,
            });
            return [];
        }
        return results;
    }
    async fetchPoolMetrics(provider, poolAddress) {
        const abi = [
            "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
        ];
        const contract = new ethers_1.ethers.Contract(poolAddress, abi, provider);
        const result = await contract.slot0();
        return { sqrtPriceX96: result[0], tick: result[1] };
    }
    async validatePool(provider, poolAddress) {
        try {
            const abi = [
                "function token0() external view returns (address)",
                "function token1() external view returns (address)",
            ];
            const contract = new ethers_1.ethers.Contract(poolAddress, abi, provider);
            const [token0, token1] = await Promise.all([
                contract.token0(),
                contract.token1(),
            ]);
            const [code0, code1] = await Promise.all([
                provider.getCode(token0),
                provider.getCode(token1),
            ]);
            return code0 !== "0x" && code1 !== "0x";
        }
        catch {
            return false;
        }
    }
}
class CurveDiscoveryHandler {
    constructor() {
        this.name = "CurveHandler";
    }
    async discoverPools(_provider, _startBlock, _endBlock) {
        logger_1.default.warn("CurveDiscoveryHandler: not fully implemented, skipping discovery");
        return [];
    }
    async fetchPoolMetrics(_provider, _poolAddress) {
        logger_1.default.warn("CurveDiscoveryHandler: fetchPoolMetrics not fully implemented");
        return {};
    }
    async validatePool(_provider, _poolAddress) {
        logger_1.default.warn("CurveDiscoveryHandler: validatePool not fully implemented");
        return false;
    }
}
class BalancerDiscoveryHandler {
    constructor() {
        this.name = "BalancerHandler";
    }
    async discoverPools(_provider, _startBlock, _endBlock) {
        logger_1.default.warn("BalancerDiscoveryHandler: not fully implemented, skipping discovery");
        return [];
    }
    async fetchPoolMetrics(_provider, _poolAddress) {
        logger_1.default.warn("BalancerDiscoveryHandler: fetchPoolMetrics not fully implemented");
        return {};
    }
    async validatePool(_provider, _poolAddress) {
        logger_1.default.warn("BalancerDiscoveryHandler: validatePool not fully implemented");
        return false;
    }
}
class PoolDiscoveryService extends events_1.EventEmitter {
    constructor(rpcUrl, registryAddress, config = {}) {
        super();
        this.circuitBreakerTriggered = false;
        this.provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
        this.registryContractAddress = registryAddress;
        this.discoveredPools = new Map();
        this.dexHandlers = new Map();
        this.dexConfigs = new Map();
        this.lastProcessedBlocks = new Map();
        this._chain = config.chain ?? "base";
        this.config = {
            minTVL: 1000 * 1e18,
            minVolume24h: 100 * 1e18,
            minPoolAge: 3600,
            maxPoolsPerBatch: 100,
            discoveryInterval: 60000,
            metricsRefreshInterval: 300000,
            maxFailuresBeforeCircuitBreaker: 10,
            rpcRetries: 3,
            rpcRetryDelay: 1000,
            ...config,
        };
        this.registryABI = [
            "function addPool(address poolAddress, uint8 dexType, address token0, address token1, uint256 fee, uint256 tvl, uint256 poolName) external",
            "function updatePool(address poolAddress, uint256 tvl, uint256 volume24h) external",
            "function getHighOpportunityPools() external view returns (address[])",
            "function getDEXPools(uint8 dexType) external view returns (address[])",
        ];
        this.stats = {
            poolsDiscovered: 0,
            poolsApproved: 0,
            poolsRejected: 0,
            totalTVLMonitored: 0,
            avgOpportunityScore: 0,
            lastDiscoveryTime: 0,
            failureCount: 0,
            isOperational: true,
        };
        this._registerDefaultHandlers();
        logger_1.default.info("PoolDiscoveryService initialized", {
            rpcUrl,
            registryAddress,
            minTVL: this.config.minTVL,
            minVolume24h: this.config.minVolume24h,
        });
    }
    _registerDefaultHandlers() {
        const FACTORY_ADDRESSES = FACTORY_ADDRESSES_BY_CHAIN[this._chain] ?? FACTORY_ADDRESSES_BY_CHAIN["base"];
        logger_1.default.info("PoolDiscoveryService: loading factory addresses", { chain: this._chain, count: Object.keys(FACTORY_ADDRESSES).length });
        // V2-style AMMs (PairCreated + Sync events)
        const v2Pairs = [
            [types_1.DEXType.UniswapV2, FACTORY_ADDRESSES[types_1.DEXType.UniswapV2]],
            [types_1.DEXType.SushiSwap, FACTORY_ADDRESSES[types_1.DEXType.SushiSwap]],
            [types_1.DEXType.Aerodrome, FACTORY_ADDRESSES[types_1.DEXType.Aerodrome]],
            [types_1.DEXType.PancakeSwap, FACTORY_ADDRESSES[types_1.DEXType.PancakeSwap]],
        ];
        for (const [dexType, factoryAddress] of v2Pairs) {
            if (!factoryAddress)
                continue;
            const handler = new UniswapV2DiscoveryHandler(factoryAddress);
            this.dexHandlers.set(dexType, handler);
            this.dexConfigs.set(dexType, { factoryAddress, handler });
        }
        // Uniswap V3 (concentrated liquidity)
        const v3Factory = FACTORY_ADDRESSES[types_1.DEXType.UniswapV3];
        if (v3Factory) {
            const v3Handler = new UniswapV3DiscoveryHandler(v3Factory);
            this.dexHandlers.set(types_1.DEXType.UniswapV3, v3Handler);
            this.dexConfigs.set(types_1.DEXType.UniswapV3, {
                factoryAddress: v3Factory,
                handler: v3Handler,
            });
        }
        // Curve (stablecoin pools)
        const curveFactory = FACTORY_ADDRESSES[types_1.DEXType.Curve];
        if (curveFactory) {
            const curveHandler = new CurveDiscoveryHandler();
            this.dexHandlers.set(types_1.DEXType.Curve, curveHandler);
            this.dexConfigs.set(types_1.DEXType.Curve, {
                factoryAddress: curveFactory,
                handler: curveHandler,
            });
        }
        // Balancer V2 (multi-asset weighted pools)
        const balancerFactory = FACTORY_ADDRESSES[types_1.DEXType.Balancer];
        if (balancerFactory) {
            const balancerHandler = new BalancerDiscoveryHandler();
            this.dexHandlers.set(types_1.DEXType.Balancer, balancerHandler);
            this.dexConfigs.set(types_1.DEXType.Balancer, {
                factoryAddress: balancerFactory,
                handler: balancerHandler,
            });
        }
    }
    /**
     * Start the pool discovery service.
     * Verifies registry contract reachability, seeds local cache from on-chain registry,
     * then starts discovery and metrics loops.
     */
    async start() {
        logger_1.default.info("Starting PoolDiscoveryService...");
        try {
            const registryCode = await this.provider.getCode(this.registryContractAddress);
            if (registryCode === "0x") {
                throw new Error("Registry contract not found at specified address");
            }
            // Seed local pool cache from the on-chain registry immediately so
            // the dashboard shows registered pools without waiting for the scan loop.
            await this._loadPoolsFromRegistry();
            // Prime lastProcessedBlocks so the first discovery scan starts from
            // a recent block instead of block 0 (scanning from 0 is prohibitively slow).
            const currentBlock = await this.provider.getBlockNumber();
            const recentStart = Math.max(0, currentBlock - 100000);
            for (const dexType of this.dexHandlers.keys()) {
                if (!this.lastProcessedBlocks.has(dexType)) {
                    this.lastProcessedBlocks.set(dexType, recentStart);
                }
            }
            this._startDiscoveryLoop();
            this._startMetricsRefreshLoop();
            logger_1.default.info("PoolDiscoveryService started successfully");
        }
        catch (error) {
            logger_1.default.error("Failed to start PoolDiscoveryService", { error });
            throw error;
        }
    }
    /**
     * Stop all discovery and metrics loops.
     */
    async stop() {
        logger_1.default.info("Stopping PoolDiscoveryService...");
        if (this.discoveryLoop)
            clearInterval(this.discoveryLoop);
        if (this.metricsRefreshLoop)
            clearInterval(this.metricsRefreshLoop);
        logger_1.default.info("PoolDiscoveryService stopped");
    }
    /**
     * Register a DEX-specific discovery handler at runtime.
     */
    registerDEXHandler(dexType, handler) {
        this.dexHandlers.set(dexType, handler);
        logger_1.default.info("DEX handler registered", {
            dexType,
            handler: handler.name,
        });
    }
    /**
     * Discover new pools on a specific DEX from startBlock to current chain head.
     * Validates each discovered pool before adding it to the registry.
     */
    async discoverPoolsOnDEX(dexType, startBlock = 0) {
        const handler = this.dexHandlers.get(dexType);
        if (!handler) {
            logger_1.default.warn("No handler registered for DEX type", { dexType });
            return;
        }
        try {
            logger_1.default.info("Starting pool discovery on DEX", {
                dexType,
                startBlock,
            });
            const currentBlock = await this.provider.getBlockNumber();
            const pools = await handler.discoverPools(this.provider, startBlock, currentBlock);
            logger_1.default.info("Found pool candidates", {
                dexType,
                count: pools.length,
            });
            const validatedPools = [];
            for (const pool of pools) {
                try {
                    const candidate = await this._validatePool(pool, dexType);
                    if (candidate)
                        validatedPools.push(candidate);
                }
                catch (error) {
                    logger_1.default.warn("Pool validation failed", {
                        pool: pool.address,
                        error,
                    });
                    this.stats.poolsRejected++;
                }
            }
            if (validatedPools.length > 0) {
                await this._registerPoolsWithRegistry(validatedPools);
            }
            this.stats.lastDiscoveryTime = Date.now();
            this.stats.poolsDiscovered += validatedPools.length;
            this.lastProcessedBlocks.set(dexType, currentBlock);
        }
        catch (error) {
            logger_1.default.error("Error discovering pools on DEX", { dexType, error });
            this._handleDiscoveryFailure();
        }
    }
    /**
     * Returns a snapshot of current discovery statistics.
     */
    getStats() {
        return { ...this.stats };
    }
    /**
     * Returns all pools currently held in the local registry.
     */
    getDiscoveredPools() {
        return Array.from(this.discoveredPools.values());
    }
    /**
     * Returns pools sorted by opportunity score, filtered to those above minScore.
     */
    getHighOpportunityPools(minScore = 50) {
        return Array.from(this.discoveredPools.values())
            .filter((pool) => pool.opportunityScore >= minScore)
            .sort((a, b) => b.opportunityScore - a.opportunityScore);
    }
    /**
     * Returns a map of DEXType to factory address for all configured DEXes.
     */
    getFactoryAddresses() {
        const result = new Map();
        for (const [dexType, cfg] of this.dexConfigs) {
            result.set(dexType, cfg.factoryAddress);
        }
        return result;
    }
    /**
     * Query the on-chain DEXRegistry for all high-opportunity pools and seed
     * the local in-memory cache. Runs once on startup before the scan loop.
     */
    async _loadPoolsFromRegistry() {
        try {
            const poolInfoABI = [
                "function getHighOpportunityPools() external view returns (address[])",
                "function poolInfo(address pool) external view returns (address poolAddress, uint8 dexType, address token0, address token1, uint256 fee, uint256 tvl, uint256 volume24h, uint256 createdAt, uint256 lastUpdated, bool isActive, uint256 opportunityScore)",
            ];
            const registryContract = new ethers_1.ethers.Contract(this.registryContractAddress, poolInfoABI, this.provider);
            const poolAddresses = await registryContract.getHighOpportunityPools();
            if (poolAddresses.length === 0) {
                logger_1.default.info("PoolDiscoveryService: no pools in on-chain registry yet");
                return;
            }
            let seeded = 0;
            for (const addr of poolAddresses) {
                if (this.discoveredPools.has(addr))
                    continue;
                try {
                    const info = await registryContract.poolInfo(addr);
                    const candidate = {
                        address: addr,
                        dexType: SOLIDITY_DEX_TYPE_MAP[Number(info.dexType)] ?? types_1.DEXType.UniswapV3,
                        token0: info.token0,
                        token1: info.token1,
                        fee: Number(info.fee),
                        tvl: Number(info.tvl),
                        volume24h: Number(info.volume24h),
                        createdAt: Number(info.createdAt),
                        opportunityScore: Number(info.opportunityScore),
                    };
                    this.discoveredPools.set(addr, candidate);
                    this.stats.poolsDiscovered++;
                    this.stats.poolsApproved++;
                    this.emit("poolDiscovered", candidate);
                    seeded++;
                }
                catch (err) {
                    logger_1.default.warn("PoolDiscoveryService: failed to fetch poolInfo", { addr, err });
                }
            }
            logger_1.default.info("PoolDiscoveryService: seeded pools from on-chain registry", { seeded });
        }
        catch (error) {
            logger_1.default.warn("PoolDiscoveryService: _loadPoolsFromRegistry failed (non-fatal)", { error });
        }
    }
    async _validatePool(pool, dexType) {
        try {
            if (this.discoveredPools.has(pool.address)) {
                return null;
            }
            const token0Code = await this.provider.getCode(pool.token0);
            const token1Code = await this.provider.getCode(pool.token1);
            if (token0Code === "0x" || token1Code === "0x") {
                logger_1.default.warn("Invalid token address in pool", {
                    pool: pool.address,
                });
                return null;
            }
            if (pool.tvl < this.config.minTVL) {
                logger_1.default.debug("Pool TVL below minimum", {
                    pool: pool.address,
                    tvl: pool.tvl,
                    minTVL: this.config.minTVL,
                });
                return null;
            }
            if (pool.volume24h < this.config.minVolume24h) {
                logger_1.default.debug("Pool 24h volume below minimum", {
                    pool: pool.address,
                    volume24h: pool.volume24h,
                    minVolume24h: this.config.minVolume24h,
                });
                return null;
            }
            const poolAge = Math.floor(Date.now() / 1000) - pool.createdAt;
            if (poolAge < this.config.minPoolAge) {
                logger_1.default.debug("Pool too new", {
                    pool: pool.address,
                    age: poolAge,
                    minAge: this.config.minPoolAge,
                });
                return null;
            }
            const opportunityScore = this._calculateOpportunityScore(pool);
            const candidate = {
                address: pool.address,
                dexType,
                token0: pool.token0,
                token1: pool.token1,
                fee: pool.fee,
                tvl: pool.tvl,
                volume24h: pool.volume24h,
                createdAt: pool.createdAt,
                opportunityScore,
            };
            logger_1.default.info("Pool validated and approved", {
                pool: candidate.address,
                dexType,
                tvl: candidate.tvl,
                score: candidate.opportunityScore,
            });
            return candidate;
        }
        catch (error) {
            logger_1.default.error("Error validating pool", {
                pool: pool.address,
                error,
            });
            return null;
        }
    }
    _calculateOpportunityScore(pool) {
        const maxTVL = 1000000 * 1e18;
        const tvlScore = Math.min(100, (pool.tvl / maxTVL) * 100);
        const maxVolume = 10000000 * 1e18;
        const volumeScore = Math.min(100, (pool.volume24h / maxVolume) * 100);
        const ageInDays = (Date.now() / 1000 - pool.createdAt) / (24 * 3600);
        let ageScore = 100;
        if (ageInDays > 30)
            ageScore = 60;
        else if (ageInDays > 7)
            ageScore = 80;
        return Math.floor(tvlScore * 0.4 + volumeScore * 0.4 + ageScore * 0.2);
    }
    async _registerPoolsWithRegistry(pools) {
        try {
            for (const pool of pools) {
                this.discoveredPools.set(pool.address, pool);
                this.stats.poolsApproved++;
                this.stats.totalTVLMonitored += pool.tvl;
                this.emit("poolDiscovered", pool);
            }
            logger_1.default.info("Pools registered with registry", {
                count: pools.length,
                totalTVL: pools.reduce((sum, p) => sum + p.tvl, 0),
            });
        }
        catch (error) {
            logger_1.default.error("Error registering pools with registry", { error });
            this._handleDiscoveryFailure();
        }
    }
    async _refreshPoolMetrics() {
        const pools = Array.from(this.discoveredPools.values());
        if (pools.length === 0)
            return;
        try {
            logger_1.default.debug("Refreshing pool metrics", {
                poolCount: pools.length,
            });
            for (const pool of pools) {
                try {
                    pool.opportunityScore =
                        this._calculateOpportunityScore(pool);
                }
                catch (error) {
                    logger_1.default.warn("Error refreshing pool metrics", {
                        pool: pool.address,
                        error,
                    });
                }
            }
            const avgScore = pools.reduce((sum, p) => sum + p.opportunityScore, 0) /
                pools.length;
            this.stats.avgOpportunityScore = Math.floor(avgScore);
            logger_1.default.debug("Pool metrics refreshed", {
                poolCount: pools.length,
                avgOpportunityScore: this.stats.avgOpportunityScore,
            });
        }
        catch (error) {
            logger_1.default.error("Error refreshing pool metrics", { error });
            this._handleDiscoveryFailure();
        }
    }
    _handleDiscoveryFailure() {
        this.stats.failureCount++;
        if (this.stats.failureCount >=
            this.config.maxFailuresBeforeCircuitBreaker) {
            this.stats.isOperational = false;
            this.circuitBreakerTriggered = true;
            logger_1.default.error("CIRCUIT BREAKER TRIGGERED: Pool discovery service disabled", {
                failureCount: this.stats.failureCount,
                maxFailures: this.config.maxFailuresBeforeCircuitBreaker,
            });
        }
    }
    _startDiscoveryLoop() {
        this.discoveryLoop = setInterval(async () => {
            if (!this.stats.isOperational) {
                logger_1.default.warn("Discovery loop paused: circuit breaker active");
                return;
            }
            try {
                for (const [dexType] of this.dexHandlers) {
                    const lastBlock = this.lastProcessedBlocks.get(dexType) ?? 0;
                    await this.discoverPoolsOnDEX(dexType, lastBlock);
                }
                this.stats.failureCount = Math.max(0, this.stats.failureCount - 1);
            }
            catch (error) {
                logger_1.default.error("Error in discovery loop", { error });
                this._handleDiscoveryFailure();
            }
        }, this.config.discoveryInterval);
    }
    _startMetricsRefreshLoop() {
        this.metricsRefreshLoop = setInterval(async () => {
            if (!this.stats.isOperational)
                return;
            try {
                await this._refreshPoolMetrics();
            }
            catch (error) {
                logger_1.default.error("Error in metrics refresh loop", { error });
                this._handleDiscoveryFailure();
            }
        }, this.config.metricsRefreshInterval);
    }
}
exports.PoolDiscoveryService = PoolDiscoveryService;
//# sourceMappingURL=poolDiscoveryService.js.map