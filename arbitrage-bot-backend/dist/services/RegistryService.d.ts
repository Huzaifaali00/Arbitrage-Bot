export declare class RegistryService {
    private contract;
    private signer;
    constructor(rpcUrl: string, privateKey: string, registryAddress: string);
    /**
     * Register a new pool on-chain
     */
    addPool(poolAddress: string, dexType: number, token0: string, token1: string, fee: number, tvl: bigint, volume24h: bigint): Promise<void>;
    /**
     * Update pool metrics on-chain
     */
    updatePool(poolAddress: string, tvl: bigint, volume24h: bigint): Promise<void>;
}
declare let _instance: RegistryService | null;
export default _instance;
//# sourceMappingURL=RegistryService.d.ts.map