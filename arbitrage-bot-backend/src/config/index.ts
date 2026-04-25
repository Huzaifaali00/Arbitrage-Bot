import dotenv from "dotenv";
import { BotConfig, ChainType } from "../types";
import logger from "../utils/logger";

dotenv.config();

const chain = (process.env.CHAIN || "base") as ChainType;

const USDC_BY_CHAIN: Record<string, string> = {
    base:            '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    baseSepolia:     '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    arbitrum:        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    arbitrumSepolia: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
};

const chainConfigs: Record<ChainType, Partial<BotConfig>> = {
    [ChainType.BASE_MAINNET]: {
        rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
        wsUrl: process.env.BASE_WS_URL || "wss://base-rpc.publicnode.com",
        // Aave V3 PoolAddressesProvider on Base mainnet
        aaveLendingPool: "0xe20fCBdBfFC4Dd138cE8b440322649382F89F21A",
    },
    [ChainType.BASE_SEPOLIA]: {
        rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
        wsUrl: process.env.BASE_SEPOLIA_WS_URL || "wss://sepolia.base.org",
        // Aave V3 PoolAddressesProvider on Base Sepolia (pre-launch smoke tests only)
        aaveLendingPool: "0x9E0fD28470aae30d95b4eE3cC72Cb42f75b80f40",
    },
    [ChainType.ARBITRUM_MAINNET]: {
        rpcUrl: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
        wsUrl: process.env.ARBITRUM_WS_URL || "wss://arb1.arbitrum.io/rpc",
        aaveLendingPool: "0x794a61358D6845594F94aDc1855b3b6A8E0B5a89",
    },
    [ChainType.ARBITRUM_SEPOLIA]: {
        rpcUrl:
            process.env.ARBITRUM_SEPOLIA_RPC_URL ||
            "https://sepolia-rollup.arbitrum.io/rpc",
        wsUrl:
            process.env.ARBITRUM_SEPOLIA_WS_URL ||
            "wss://sepolia-rollup.arbitrum.io/rpc",
        aaveLendingPool: "0x25259f38E4A48a7F3A48d5e1E0e0F37a9aFd30D",
    },
};

const config: BotConfig = {
    chain,
    rpcUrl: chainConfigs[chain]?.rpcUrl || "",
    wsUrl: chainConfigs[chain]?.wsUrl || "",
    privateKey: process.env.PRIVATE_KEY || "",
    contractAddress: process.env.CONTRACT_ADDRESS || "",
    dexRegistryAddress:
        process.env.DEX_REGISTRY_ADDRESS ||
        "0x15f0E004f2191Fc208091091B2E18e1404aBe9d1",
    vaultAddress: process.env.VAULT_ADDRESS || "",
    aaveLendingPool: chainConfigs[chain]?.aaveLendingPool || "",
    profitTokenAddress: USDC_BY_CHAIN[chain] ?? process.env.PROFIT_TOKEN_ADDRESS ?? '',
    minProfitBps: parseInt(process.env.MIN_PROFIT_BPS || "20"),
    maxGasPriceGwei: parseInt(process.env.MAX_GAS_PRICE || "100"),
    flashLoanEnabled: process.env.FLASH_LOAN_ENABLED !== "false",
    batchOperations: process.env.BATCH_OPERATIONS !== "false",
    monitoringInterval: parseInt(process.env.MONITORING_INTERVAL || "1000"),
    executionDelay: parseInt(process.env.EXECUTION_DELAY || "100"),
    blacklistedPools: (process.env.BLACKLISTED_POOLS || "")
        .split(",")
        .map((pool) => pool.trim().toLowerCase())
        .filter((pool) => pool.length > 0),
    maxPlausibleProfitUsd: Number(process.env.MAX_PLAUSIBLE_PROFIT_USD || "10"),
    profitSanityCapPct: Number(process.env.PROFIT_SANITY_CAP_PCT || "1000"),
    maxTradeSizeUsdc: BigInt(process.env.MAX_TRADE_SIZE_USDC || "5000000"),
    maxTradeSizeWeth: BigInt(
        process.env.MAX_TRADE_SIZE_WETH || "10000000000000000",
    ),
};

if (!config.privateKey || config.privateKey === "0x" + "0".repeat(64)) {
    logger.warn(
        "PRIVATE_KEY not set or is placeholder. Execution features will not work.",
    );
}

if (!config.contractAddress) {
    throw new Error("CONTRACT_ADDRESS environment variable is required");
}

if (!config.vaultAddress) {
    logger.warn(
        "VAULT_ADDRESS not set. Profit distribution to vault will be disabled.",
    );
}

export default config;
