// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Script.sol";
import {ArbitrageBot} from "../src/ArbitrageBot.sol";

/**
 * @title Deploy Script for ArbitrageBot
 * @notice Deploy contract and setup initial configuration
 */
contract DeployArbitrageBot is Script {
    
    ArbitrageBot public bot;
    
    function run() public {
        vm.startBroadcast();
        
        // Deploy the contract
        bot = new ArbitrageBot();
        console.log("ArbitrageBot deployed at:", address(bot));
        console.log("Owner:", bot.owner());
        
        vm.stopBroadcast();
        
        // Log deployment info
        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("Contract Address:", address(bot));
        console.log("Owner Address:", bot.owner());
        console.log("Paused:", bot.paused());
        console.log("\n=== NEXT STEPS ===");
        console.log("1. Approve pools: cast send <contract> 'approvePool(address)' <pool_address>");
        console.log("2. Approve tokens: cast send <contract> 'approveToken(address)' <token_address>");
        console.log("3. Fund contract: transfer ETH and tokens");
        console.log("4. Execute trades: call executeSandwich or executeMultiHopArb");
    }
}
