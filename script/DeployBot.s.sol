// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {ArbitrageBot} from "../src/ArbitrageBot.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";

contract DeployBot is Script {
    function run() external {
        address aaveProvider = vm.envAddress("AAVE_POOL_ADDRESS");
        address vault = _envAddressWithFallback("VAULT_ADDRESS", "ArbitrageVault");
        address registry = _envAddressWithFallback("DEX_REGISTRY_ADDRESS", "DEXRegistry");
        address stable = _envAddressWithFallback("PROFIT_TOKEN_ADDRESS", "PROFIT_TOKEN_ADDRESS");

        vm.startBroadcast();
        ArbitrageBot bot = new ArbitrageBot(
            IPoolAddressesProvider(aaveProvider),
            vault,
            registry,
            stable
        );
        vm.stopBroadcast();

        console.log("ArbitrageBot deployed:", address(bot));
    }

    function _envAddressWithFallback(
        string memory primary,
        string memory fallbackKey
    ) internal view returns (address) {
        try vm.envAddress(primary) returns (address val) {
            return val;
        } catch {
            return vm.envAddress(fallbackKey);
        }
    }
}
