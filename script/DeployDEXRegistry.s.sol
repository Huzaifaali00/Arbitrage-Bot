// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import "../src/DEXRegistry.sol";

/**
 * @title DeployDEXRegistry
 * @notice Deploy the DEXRegistry contract
 * @dev This script deploys the DEXRegistry contract which manages all DEX configurations
 */
contract DeployDEXRegistry is Script {

    function run() external {

        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployerAddress = vm.addr(deployerKey);

        // Start broadcast (signs transactions with private key)
        vm.startBroadcast(deployerKey);

        // Deploy DEXRegistry with deployer as initial owner
        DEXRegistry registry = new DEXRegistry(deployerAddress);

        // Stop broadcast
        vm.stopBroadcast();

        // Print deployment info
        console.log("");
        console.log("========================================");
        console.log("DEXRegistry Deployment Complete");
        console.log("========================================");
        console.log("Contract Address:", address(registry));
        console.log("Owner Address:", deployerAddress);
        console.log("Chain ID:", block.chainid);
        console.log("Block Number:", block.number);
        console.log("");
        console.log("NEXT STEP: Register DEXes using RegisterDEXes.s.sol");
        console.log("Export the address above:");
        console.log("export DEX_REGISTRY_ADDRESS=", address(registry));
        console.log("");
        console.log("Then run:");
        console.log("forge script script/RegisterDEXes.s.sol");
        console.log("  --rpc-url $BASE_SEPOLIA_RPC_URL");
        console.log("  --private-key $PRIVATE_KEY");
        console.log("  --broadcast");
        console.log("========================================");
    }
}
