"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistryService = void 0;
const ethers_1 = require("ethers");
const logger_1 = __importDefault(require("../utils/logger"));
const config_1 = __importDefault(require("../config"));
class RegistryService {
    constructor(rpcUrl, privateKey, registryAddress) {
        const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
        this.signer = new ethers_1.ethers.Wallet(privateKey, provider);
        const abi = [
            "function addPool(address poolAddress, uint8 dexType, address token0, address token1, uint256 fee, uint256 tvl, uint256 volume24h) external",
            "function updatePool(address poolAddress, uint256 tvl, uint256 volume24h) external",
            "function isRegistered(uint8 dexType) external view returns (bool)",
            "function poolInfo(address pool) external view returns (address poolAddress, uint8 dexType, address token0, address token1, uint256 fee, uint256 tvl, uint256 volume24h, uint256 createdAt, uint256 lastUpdated, bool isActive, uint256 opportunityScore)"
        ];
        this.contract = new ethers_1.ethers.Contract(registryAddress, abi, this.signer);
    }
    /**
     * Register a new pool on-chain
     */
    async addPool(poolAddress, dexType, token0, token1, fee, tvl, volume24h) {
        try {
            // Check if already registered to avoid reverts
            const info = await this.contract.poolInfo(poolAddress);
            if (info.poolAddress !== ethers_1.ethers.ZeroAddress) {
                logger_1.default.debug("RegistryService: Pool already registered", { poolAddress });
                return;
            }
            const tx = await this.contract.addPool(poolAddress, dexType, token0, token1, fee, tvl, volume24h);
            logger_1.default.info("RegistryService: Submitting addPool transaction", { txHash: tx.hash, poolAddress });
            await tx.wait();
            logger_1.default.info("RegistryService: Pool registered on-chain", { poolAddress });
        }
        catch (error) {
            logger_1.default.error("RegistryService: Failed to add pool", { poolAddress, error: error.message });
        }
    }
    /**
     * Update pool metrics on-chain
     */
    async updatePool(poolAddress, tvl, volume24h) {
        try {
            const tx = await this.contract.updatePool(poolAddress, tvl, volume24h);
            logger_1.default.debug("RegistryService: Updating pool metrics", { poolAddress, txHash: tx.hash });
            await tx.wait();
        }
        catch (error) {
            logger_1.default.error("RegistryService: Failed to update pool", { poolAddress, error: error.message });
        }
    }
}
exports.RegistryService = RegistryService;
// Only export a singleton if both the private key and a valid registry address are present.
// If PRIVATE_KEY is missing the bot runs in read-only mode and RegistryService is unused.
let _instance = null;
try {
    if (config_1.default.privateKey && config_1.default.privateKey.startsWith("0x") && config_1.default.privateKey.length === 66 && config_1.default.dexRegistryAddress) {
        _instance = new RegistryService(config_1.default.rpcUrl, config_1.default.privateKey, config_1.default.dexRegistryAddress);
    }
}
catch {
    // Silently skip — bot continues without registry write access
}
exports.default = _instance;
//# sourceMappingURL=RegistryService.js.map