// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {DEXRegistry}     from "../src/DEXRegistry.sol";
import {ArbitrageVault}  from "../src/ArbitrageVault.sol";
import {ArbitrageBot}    from "../src/ArbitrageBot.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";

/**
 * @title DeployAll
 * @notice Single-shot deployment of DEXRegistry → ArbitrageVault → ArbitrageBot.
 *
 * Problem solved
 * ──────────────
 * The old separate scripts allowed deploying ArbitrageBot with vaultAddress = address(0)
 * (silent loss of all USDC profits) and ArbitrageBot with registry/stablecoin = address(0)
 * (silent failures at runtime).  They also required manual env-var hand-off between runs,
 * where one missed export left the vault executor un-wired.
 *
 * How address prediction works
 * ────────────────────────────
 * Every CREATE opcode deterministically derives the new contract address from
 * keccak256(RLP(deployer, nonce)).  The deployer's nonce increments by exactly 1
 * for each contract deployed.  We read the current nonce with vm.getNonce() BEFORE
 * vm.startBroadcast(), then call vm.computeCreateAddress() for each slot.
 * After deployment we assert the actual addresses match to catch any nonce drift.
 *
 * Required env vars
 * ─────────────────
 *   AAVE_POOL_ADDRESS  – Aave V3 Pool on the target chain (set in .env)
 *
 * Optional env vars
 * ─────────────────
 *   EXECUTOR_ADDRESS       – additional hot-wallet to authorise on the vault
 *   PERFORMANCE_FEE_BPS    – vault performance fee (1500–2500, default 2000 = 20%)
 *   PROFIT_TOKEN_ADDRESS   – USDC override for chains not built into this script
 *
 * After this script
 * ─────────────────
 *   Run script/RegisterDEXes.s.sol with DEX_REGISTRY_ADDRESS=<printed address>
 *   to populate the registry with pool configurations.
 */
contract DeployAll is Script {

    uint256 private constant DEFAULT_PERFORMANCE_FEE_BPS = 2000; // 20 %

    // ── Known USDC addresses ──────────────────────────────────────────────
    // The profit/stablecoin token is always native USDC on the target chain.
    // No env var needed — address is resolved from block.chainid at deploy time.
    address private constant USDC_BASE_MAINNET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // chain 8453
    address private constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // chain 84532
    address private constant USDC_ARBITRUM_ONE = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831; // chain 42161

    function run() external {
        address deployer    = 0xf9cBC41849dB34cA64D2e3a9120020Bf3Ef76F5C;

        // ── Required env vars ─────────────────────────────────────────────
        address aaveProvider = vm.envAddress("AAVE_POOL_ADDRESS");

        require(aaveProvider != address(0), "DeployAll: AAVE_POOL_ADDRESS is zero");

        // ── Profit token: USDC resolved from chain ID ─────────────────────
        // For any chain not listed above, set PROFIT_TOKEN_ADDRESS in .env as a fallback.
        address profitToken = _usdcForChain();
        require(profitToken != address(0), "DeployAll: unknown chain - set PROFIT_TOKEN_ADDRESS in .env");

        // ── Optional env vars ─────────────────────────────────────────────
        address executorHotWallet = _envAddressOrZero("EXECUTOR_ADDRESS");
        uint256 feeBps = vm.envOr("PERFORMANCE_FEE_BPS", DEFAULT_PERFORMANCE_FEE_BPS);

        require(feeBps >= 1500 && feeBps <= 2500, "DeployAll: PERFORMANCE_FEE_BPS out of [1500, 2500]");

        // ── Predict all contract addresses before any deployment ──────────
        //
        //   nonce N   → DEXRegistry
        //   nonce N+1 → ArbitrageVault
        //   nonce N+2 → ArbitrageBot
        //
        // vm.getNonce reads the on-chain account nonce (before broadcast starts),
        // which is the nonce that will be consumed by the first CREATE.
        uint256 startNonce = vm.getNonce(deployer);

        address predictedRegistry = vm.computeCreateAddress(deployer, startNonce);
        address predictedVault    = vm.computeCreateAddress(deployer, startNonce + 1);
        address predictedBot      = vm.computeCreateAddress(deployer, startNonce + 2);

        console.log("=== DeployAll: address predictions ===");
        console.log("Deployer                  :", deployer);
        console.log("Nonce at broadcast start  :", startNonce);
        console.log("DEXRegistry  (predicted)  :", predictedRegistry);
        console.log("ArbitrageVault (predicted):", predictedVault);
        console.log("ArbitrageBot (predicted)  :", predictedBot);
        console.log("");
        console.log("Aave Provider             :", aaveProvider);
        console.log("Profit Token              :", profitToken);
        console.log("Performance Fee           :", feeBps, "bps");
        if (executorHotWallet != address(0)) {
            console.log("Extra Executor            :", executorHotWallet);
        }
        console.log("");

        vm.startBroadcast();

        // ── 1. Deploy DEXRegistry ─────────────────────────────────────────
        DEXRegistry registry = new DEXRegistry(deployer);
        require(
            address(registry) == predictedRegistry,
            "DeployAll: DEXRegistry address mismatch - nonce drift?"
        );
        console.log("[1/3] DEXRegistry deployed   :", address(registry));

        // ── 2. Deploy ArbitrageVault ──────────────────────────────────────
        //   Constructor: (initialOwner, performanceFeeBps, profitToken)
        //   No dependency on other contracts — safe to deploy before bot.
        ArbitrageVault vault = new ArbitrageVault(deployer, feeBps, profitToken);
        require(
            address(vault) == predictedVault,
            "DeployAll: ArbitrageVault address mismatch - nonce drift?"
        );
        console.log("[2/3] ArbitrageVault deployed:", address(vault));

        // ── 3. Deploy ArbitrageBot ────────────────────────────────────────
        //   Pass the REAL vault and registry addresses (known from prediction above).
        //   This eliminates vaultAddress = address(0) at construction time.
        ArbitrageBot bot = new ArbitrageBot(
            IPoolAddressesProvider(aaveProvider),
            predictedVault,    // vault address — verified equal to address(vault) above
            predictedRegistry, // registry address — verified equal to address(registry) above
            profitToken
        );
        require(
            address(bot) == predictedBot,
            "DeployAll: ArbitrageBot address mismatch - nonce drift?"
        );
        console.log("[3/3] ArbitrageBot deployed  :", address(bot));

        // ── 4. Wire: authorise bot as executor on vault ───────────────────
        //   The bot calls vault.distributeProfit(); it must be an authorised executor.
        vault.authorizeExecutor(address(bot));
        console.log("[OK]  Bot authorised as vault executor");

        // ── 5. Optionally authorise a separate hot-wallet executor ────────
        if (executorHotWallet != address(0)) {
            vault.authorizeExecutor(executorHotWallet);
            console.log("[OK]  Extra executor authorised:", executorHotWallet);
        }

        vm.stopBroadcast();

        // ── Final summary ─────────────────────────────────────────────────
        console.log("");
        console.log("========================================");
        console.log("  DeployAll Complete");
        console.log("========================================");
        console.log("DEXRegistry   :", address(registry));
        console.log("ArbitrageVault:", address(vault));
        console.log("ArbitrageBot  :", address(bot));
        console.log("Chain ID      :", block.chainid);
        console.log("Block         :", block.number);
        console.log("");
        console.log("NEXT STEP - register DEXes:");
        console.log("  export DEX_REGISTRY_ADDRESS=", address(registry));
        console.log("  forge script script/RegisterDEXes.s.sol \\");
        console.log("    --rpc-url $RPC_URL --broadcast");
        console.log("========================================");
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /// @dev Returns the native USDC address for the current chain.
    ///      Falls back to PROFIT_TOKEN_ADDRESS env var for unlisted chains.
    function _usdcForChain() internal view returns (address) {
        uint256 id = block.chainid;
        if (id == 8453)  return USDC_BASE_MAINNET;
        if (id == 84532) return USDC_BASE_SEPOLIA;
        if (id == 42161) return USDC_ARBITRUM_ONE;
        // Unknown chain — require caller to supply the address explicitly
        try vm.envAddress("PROFIT_TOKEN_ADDRESS") returns (address val) {
            return val;
        } catch {
            return address(0);
        }
    }

    function _envAddressOrZero(string memory key) internal view returns (address) {
        try vm.envAddress(key) returns (address val) {
            return val;
        } catch {
            return address(0);
        }
    }
}
