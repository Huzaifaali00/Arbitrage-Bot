// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "../src/ArbitrageBot.sol";
import "../src/DEXRegistry.sol";
import "../src/adapters/UniswapV2Adapter.sol";
import "../src/adapters/UniswapV3Adapter.sol";

/**
 * @title DeployAdapters
 * @notice Deploy UniswapV2Adapter + UniswapV3Adapter and wire them to ArbitrageBot.
 *
 * What this script does
 * ─────────────────────
 * 1. Deploys UniswapV3Adapter(factory, quoter=address(0))
 *    — quoter is unused at runtime; getAmountOut() returns 0 by design.
 * 2. Deploys UniswapV2Adapter(factory, router) for Uniswap V2 style DEXes.
 * 3. Calls bot.setAdapter() for UniswapV3 and UniswapV2.
 * 4. Calls v2Adapter.authorizeCaller(bot) so ArbitrageBot can execute V2 swaps.
 *    (UniswapV3Adapter has no caller whitelist — it validates via pool address.)
 *
 * Required env vars
 * ─────────────────
 *   ArbitrageBot  — deployed bot address (from DeployAll output)
 *
 * Run
 * ───
 * forge script script/DeployAdapters.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployAdapters is Script {

    // ── Chain-specific Uniswap V3 factory ────────────────────────────────────
    address private constant UNISWAP_V3_FACTORY_MAINNET = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD; // Base mainnet (8453)
    address private constant UNISWAP_V3_FACTORY_SEPOLIA = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24; // Base Sepolia (84532)
    // quoter is stored but never called in UniswapV3Adapter; safe to set address(0) on testnet
    address private constant UNISWAP_V3_QUOTER  = address(0);

    address private constant UNISWAP_V2_FACTORY_MAINNET = 0x8909Dc15e40953B386fa8f440Db4C4702d4f9b93; // Base mainnet
    address private constant UNISWAP_V2_FACTORY_SEPOLIA = 0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e; // Base Sepolia
    address private constant UNISWAP_V2_ROUTER_MAINNET  = 0x4752BA5dbc23F44d87826aeF3c0c8E6084bF3917; // Base mainnet
    address private constant UNISWAP_V2_ROUTER_SEPOLIA  = 0x1689E7B1F10000AE47eBfE339a4f69dECd19F602; // Base Sepolia

    function run() external {
        address payable botAddr = payable(vm.envAddress("ArbitrageBot"));

        // Resolve chain-specific addresses
        address v3Factory  = block.chainid == 84532 ? UNISWAP_V3_FACTORY_SEPOLIA : UNISWAP_V3_FACTORY_MAINNET;
        address v2Factory  = block.chainid == 84532 ? UNISWAP_V2_FACTORY_SEPOLIA : UNISWAP_V2_FACTORY_MAINNET;
        address v2Router   = block.chainid == 84532 ? UNISWAP_V2_ROUTER_SEPOLIA  : UNISWAP_V2_ROUTER_MAINNET;

        vm.startBroadcast();

        ArbitrageBot bot = ArbitrageBot(botAddr);

        console.log("DeployAdapters: bot     =", botAddr);
        console.log("DeployAdapters: chain   =", block.chainid);
        console.log("DeployAdapters: v3Fctry =", v3Factory);
        console.log("DeployAdapters: v2Fctry =", v2Factory);
        console.log("DeployAdapters: v2Router=", v2Router);
        console.log("");

        // ── 1. Deploy UniswapV3Adapter ────────────────────────────────────────
        UniswapV3Adapter v3Adapter = new UniswapV3Adapter(
            v3Factory,
            UNISWAP_V3_QUOTER
        );
        console.log("[1/4] UniswapV3Adapter deployed:", address(v3Adapter));

        // ── 2. Deploy UniswapV2Adapter ────────────────────────────────────────
        UniswapV2Adapter v2Adapter = new UniswapV2Adapter(
            v2Factory,
            v2Router
        );
        console.log("[2/4] UniswapV2Adapter deployed:", address(v2Adapter));

        // ── 3. Wire adapters into ArbitrageBot ────────────────────────────────
        bot.setAdapter(DEXRegistry.DEXType.UniswapV3, address(v3Adapter));
        console.log("[3/4] bot.setAdapter(UniswapV3) set");

        bot.setAdapter(DEXRegistry.DEXType.UniswapV2, address(v2Adapter));
        console.log("      bot.setAdapter(UniswapV2) set");

        // SushiSwap is V2-compatible — reuse the same adapter contract
        bot.setAdapter(DEXRegistry.DEXType.SushiSwap, address(v2Adapter));
        console.log("      bot.setAdapter(SushiSwap)  set (reuses V2 adapter)");

        // ── 4. Authorize ArbitrageBot as a caller on UniswapV2Adapter ─────────
        // UniswapV2Adapter.swap() is restricted to authorizedCallers.
        // ArbitrageBot is not the owner of the adapter, so it must be whitelisted.
        v2Adapter.authorizeCaller(botAddr);
        console.log("[4/4] v2Adapter.authorizeCaller(bot) done");

        vm.stopBroadcast();

        console.log("");
        console.log("===========================================");
        console.log("  DeployAdapters complete");
        console.log("===========================================");
        console.log("  UniswapV3Adapter :", address(v3Adapter));
        console.log("  UniswapV2Adapter :", address(v2Adapter));
        console.log("  Bot              :", botAddr);
        console.log("===========================================");
        console.log("");
        console.log("NEXT STEP: run RegisterPools.s.sol to register");
        console.log("  trading pools in the DEXRegistry.");
    }
}
