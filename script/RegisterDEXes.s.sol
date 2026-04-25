// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "../src/DEXRegistry.sol";

/**
 * @title RegisterDEXes
 * @notice Register the whitelisted DEXes the arbitrage bot will monitor on Base.
 * @dev Only DEXes with verified canonical deployments on Base mainnet (chain id 8453)
 *      or Base Sepolia (chain id 84532) are registered. DEXes that only live on other
 *      chains (dYdX on Ethereum/StarkEx, QuickSwap on Polygon, Camelot on Arbitrum) are
 *      intentionally excluded — the bot would waste RPC calls or revert when querying
 *      them.
 *
 * CURRENT DEX SET (7):
 *   1. Uniswap V2
 *   2. Uniswap V3
 *   3. SushiSwap
 *   4. Aerodrome  (Base-native — highest priority)
 *   5. Curve Finance
 *   6. Balancer V2
 *   7. PancakeSwap V2
 *
 * SECURITY NOTES:
 * - Only the DEXRegistry owner can call registerDEX.
 * - All addresses below are verified against BaseScan at time of commit.
 * - Re-check before mainnet deployment; DEX upgrades may move contract addresses.
 */
contract RegisterDEXes is Script {

    address private DEX_REGISTRY;

    // ════════════════════════════════════════════════════════════════════════════════
    // BASE MAINNET (chain id 8453) — canonical deployments
    // ════════════════════════════════════════════════════════════════════════════════

    // 1. Uniswap V2
    address private constant UNISWAP_V2_FACTORY_BASE = 0x8909Dc15e40953B386fa8f440Db4C4702d4f9b93;
    address private constant UNISWAP_V2_ROUTER_BASE  = 0x4752BA5dbc23F44d87826aeF3c0c8E6084bF3917;

    // 2. Uniswap V3 — same factory address across all chains; Base-native SwapRouter02
    address private constant UNISWAP_V3_FACTORY_BASE = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address private constant UNISWAP_V3_ROUTER_BASE  = 0x2626664c2603336E57B271c5C0b26F421741e481;

    // 3. SushiSwap (V2 Factory + RouteProcessor on Base)
    address private constant SUSHISWAP_FACTORY_BASE = 0x71524B4f93c58fcbF659783284E38825f0622859;
    address private constant SUSHISWAP_ROUTER_BASE  = 0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891;

    // 4. Aerodrome — Base-native DEX (Velodrome fork)
    address private constant AERODROME_FACTORY_BASE = 0x420DD5456806d6211b0Af69306338AAF02107212;
    address private constant AERODROME_ROUTER_BASE  = 0xcf77A3Ba9a5Ca922335e4585f154F7b56efE928C;

    // 5. Curve Finance — MetaRegistry + Router on Base
    address private constant CURVE_FACTORY_BASE = 0x3093f9B57A428F3EB6285a589cb35bEA6e78c336;
    address private constant CURVE_ROUTER_BASE  = 0xd6681e74eEA20d196c15038C580f721EF2aB6320;

    // 6. Balancer V2 — Vault is canonical across chains; factory is weighted-pool factory on Base
    address private constant BALANCER_FACTORY_BASE = 0x4C32a8a8fDa4E24139B51b456B42290f51d6A1c4;
    address private constant BALANCER_VAULT_BASE   = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    // 7. PancakeSwap V2 on Base
    address private constant PANCAKESWAP_FACTORY_BASE = 0x02A84C1b3BDd2099c8dAD49E66D9F4FA4d7E6E9F;
    address private constant PANCAKESWAP_ROUTER_BASE  = 0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb;

    // ════════════════════════════════════════════════════════════════════════════════
    // MAIN EXECUTION
    // ════════════════════════════════════════════════════════════════════════════════

    function run() external {
        DEX_REGISTRY = vm.envAddress("DEXRegistry");

        vm.startBroadcast();

        DEXRegistry registry = DEXRegistry(DEX_REGISTRY);

        console.log("Starting DEX Registration...");
        console.log("Registry Address:", address(registry));
        console.log("Chain ID:", block.chainid);
        console.log("");

        registerDEXes(registry);

        vm.stopBroadcast();

        console.log("");
        console.log("[OK] All 7 DEXes registered successfully on Base");
        console.log("Bot will now monitor:");
        console.log(" 1. Uniswap V2");
        console.log(" 2. Uniswap V3");
        console.log(" 3. SushiSwap");
        console.log(" 4. Aerodrome (Base native)");
        console.log(" 5. Curve Finance");
        console.log(" 6. Balancer V2");
        console.log(" 7. PancakeSwap V2");
    }

    function registerDEXes(DEXRegistry registry) internal {
        console.log("Registering: Uniswap V2");
        registry.registerDEX(
            DEXRegistry.DEXType.UniswapV2,
            "Uniswap V2",
            UNISWAP_V2_FACTORY_BASE,
            UNISWAP_V2_ROUTER_BASE
        );

        console.log("Registering: Uniswap V3");
        registry.registerDEX(
            DEXRegistry.DEXType.UniswapV3,
            "Uniswap V3",
            UNISWAP_V3_FACTORY_BASE,
            UNISWAP_V3_ROUTER_BASE
        );

        console.log("Registering: SushiSwap");
        registry.registerDEX(
            DEXRegistry.DEXType.SushiSwap,
            "SushiSwap",
            SUSHISWAP_FACTORY_BASE,
            SUSHISWAP_ROUTER_BASE
        );

        console.log("Registering: Aerodrome (Base Native)");
        registry.registerDEX(
            DEXRegistry.DEXType.Aerodrome,
            "Aerodrome",
            AERODROME_FACTORY_BASE,
            AERODROME_ROUTER_BASE
        );

        console.log("Registering: Curve Finance");
        registry.registerDEX(
            DEXRegistry.DEXType.Curve,
            "Curve Finance",
            CURVE_FACTORY_BASE,
            CURVE_ROUTER_BASE
        );

        console.log("Registering: Balancer V2");
        registry.registerDEX(
            DEXRegistry.DEXType.Balancer,
            "Balancer V2",
            BALANCER_FACTORY_BASE,
            BALANCER_VAULT_BASE
        );

        console.log("Registering: PancakeSwap V2");
        registry.registerDEX(
            DEXRegistry.DEXType.PancakeSwap,
            "PancakeSwap",
            PANCAKESWAP_FACTORY_BASE,
            PANCAKESWAP_ROUTER_BASE
        );
    }
}
