import { ethers } from "ethers";
import logger from "../utils/logger";
import config from "../config";

export class RegistryService {
    private contract: ethers.Contract;
    private signer: ethers.Wallet;

    constructor(rpcUrl: string, privateKey: string, registryAddress: string) {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        this.signer = new ethers.Wallet(privateKey, provider);
        
        const abi = [
            "function addPool(address poolAddress, uint8 dexType, address token0, address token1, uint256 fee, uint256 tvl, uint256 volume24h) external",
            "function updatePool(address poolAddress, uint256 tvl, uint256 volume24h) external",
            "function isRegistered(uint8 dexType) external view returns (bool)",
            "function poolInfo(address pool) external view returns (address poolAddress, uint8 dexType, address token0, address token1, uint256 fee, uint256 tvl, uint256 volume24h, uint256 createdAt, uint256 lastUpdated, bool isActive, uint256 opportunityScore)"
        ];
        
        this.contract = new ethers.Contract(registryAddress, abi, this.signer);
    }

    /**
     * Register a new pool on-chain
     */
    async addPool(
        poolAddress: string,
        dexType: number,
        token0: string,
        token1: string,
        fee: number,
        tvl: bigint,
        volume24h: bigint
    ): Promise<void> {
        try {
            // Check if already registered to avoid reverts
            const info = await this.contract.poolInfo(poolAddress);
            if (info.poolAddress !== ethers.ZeroAddress) {
                logger.debug("RegistryService: Pool already registered", { poolAddress });
                return;
            }

            const tx = await this.contract.addPool(
                poolAddress,
                dexType,
                token0,
                token1,
                fee,
                tvl,
                volume24h
            );
            
            logger.info("RegistryService: Submitting addPool transaction", { txHash: tx.hash, poolAddress });
            await tx.wait();
            logger.info("RegistryService: Pool registered on-chain", { poolAddress });
        } catch (error: any) {
            logger.error("RegistryService: Failed to add pool", { poolAddress, error: error.message });
        }
    }

    /**
     * Update pool metrics on-chain
     */
    async updatePool(
        poolAddress: string,
        tvl: bigint,
        volume24h: bigint
    ): Promise<void> {
        try {
            const tx = await this.contract.updatePool(poolAddress, tvl, volume24h);
            logger.debug("RegistryService: Updating pool metrics", { poolAddress, txHash: tx.hash });
            await tx.wait();
        } catch (error: any) {
            logger.error("RegistryService: Failed to update pool", { poolAddress, error: error.message });
        }
    }
}

// Only export a singleton if both the private key and a valid registry address are present.
// If PRIVATE_KEY is missing the bot runs in read-only mode and RegistryService is unused.
let _instance: RegistryService | null = null;
try {
    if (config.privateKey && config.privateKey.startsWith("0x") && config.privateKey.length === 66 && config.dexRegistryAddress) {
        _instance = new RegistryService(config.rpcUrl, config.privateKey, config.dexRegistryAddress);
    }
} catch {
    // Silently skip — bot continues without registry write access
}
export default _instance;
