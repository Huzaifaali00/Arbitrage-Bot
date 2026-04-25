export declare enum DEXType {
    UniswapV2 = "uniswapv2",
    UniswapV3 = "uniswapv3",
    SushiSwap = "sushiswap",
    Aerodrome = "aerodrome",
    Curve = "curve",
    Balancer = "balancer",
    PancakeSwap = "pancakeswap"
}
export declare enum DEXProtocol {
    UniswapV2Style = "v2_style",// PairCreated + Sync events
    UniswapV3Style = "v3_style",// PoolCreated + Swap events
    CurveStyle = "curve_style",
    BalancerStyle = "balancer_style"
}
export declare enum ChainType {
    BASE_MAINNET = "base",
    BASE_SEPOLIA = "baseSepolia",
    ARBITRUM_MAINNET = "arbitrum",
    ARBITRUM_SEPOLIA = "arbitrumSepolia"
}
export declare const DEX_PROTOCOL_MAP: Record<DEXType, DEXProtocol>;
export interface DEXConfig {
    dexType: DEXType;
    protocol: DEXProtocol;
    factoryAddress: string;
    routerAddress: string;
    name: string;
    isActive: boolean;
}
export interface Pool {
    address: string;
    dexType: DEXType;
    token0: string;
    token1: string;
    fee?: number;
    reserves0?: bigint;
    reserves1?: bigint;
    lastUpdated: number;
}
export interface Token {
    address: string;
    symbol: string;
    decimals: number;
    name: string;
}
export interface PriceCache {
    [poolAddress: string]: {
        token0: string;
        token1: string;
        price: number;
        liquidity: number;
        lastUpdate: number;
    };
}
export interface ArbitrageOpportunity {
    id: string;
    tokenIn: string;
    tokenOut: string;
    route: RouteHop[];
    profitPercentage: number;
    estimatedProfit: number;
    estimatedGasCost: number;
    netProfit: number;
    confidence: number;
    detectedAt: number;
    expiresAt: number;
}
export interface RouteHop {
    pool: string;
    dexType: DEXType;
    tokenIn: string;
    tokenOut: string;
    expectedOutput: number;
    slippage: number;
}
export interface TransactionParams {
    to: string;
    data: string;
    value: string;
    gasLimit: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    tracking?: {
        botAddress: string;
        tokenIn: string;
        stableToken: string;
        wrappedNativeToken?: string;
    };
}
export interface ExecutionResult {
    hash: string;
    status: "success" | "failed" | "pending";
    profitMade: number;
    gasCostActual: number;
    netProfit: number;
    timestamp: number;
    gasCostUsd?: number;
    realizedToken?: string;
    realizedTokenSymbol?: string;
    realizedDelta?: number;
    realizedUsdEquivalent?: number;
    profitSource?: "balance_delta" | "event" | "unknown";
}
export interface GasMetrics {
    currentGasPrice: number;
    baseFee: number;
    priorityFee: number;
    estimatedCostPerSwap: number;
    profitThreshold: number;
}
export interface CycleDetectionResult {
    cycleFound: boolean;
    cycle: string[];
    profitRatio: number;
}
export interface BotConfig {
    chain: ChainType;
    rpcUrl: string;
    wsUrl: string;
    privateKey: string;
    contractAddress: string;
    dexRegistryAddress: string;
    vaultAddress: string;
    aaveLendingPool: string;
    profitTokenAddress: string;
    minProfitBps: number;
    maxGasPriceGwei: number;
    flashLoanEnabled: boolean;
    batchOperations: boolean;
    monitoringInterval: number;
    executionDelay: number;
    blacklistedPools: string[];
    maxPlausibleProfitUsd: number;
    maxTradeSizeUsdc: bigint;
    maxTradeSizeWeth: bigint;
}
export interface PoolEvent {
    pool: string;
    token0: string;
    token1: string;
    reserve0: bigint;
    reserve1: bigint;
    fee?: number;
    timestamp: number;
    blockNumber: number;
}
export interface PriceUpdate {
    pool: string;
    dexType: DEXType;
    token0: string;
    token1: string;
    price: number;
    liquidity: number;
    timestamp: number;
}
export interface ProfitRecord {
    timestamp: number;
    profit: number;
    token: string;
    txHash: string;
    gasCost: number;
}
export interface BotMetrics {
    totalProfit: number;
    totalTrades: number;
    successRate: number;
    averageProfitPerTrade: number;
    totalGasCost: number;
    roi: number;
    uptime: number;
    lastTradeTime: number;
}
//# sourceMappingURL=index.d.ts.map