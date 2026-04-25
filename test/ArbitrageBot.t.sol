// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/ArbitrageBot.sol";
import "../src/DEXRegistry.sol";
import {IPoolAddressesProvider} from "../src/interfaces/IAave.sol";

contract ArbitrageBotTest is Test {
    ArbitrageBot public bot;
    DEXRegistry public registry;
    address public owner = address(0x1);
    address public vault = address(0x2);
    address public provider = address(0x3);
    address public usdc = address(0x4);

    function setUp() public {
        vm.startPrank(owner);
        registry = new DEXRegistry(owner);
        bot = new ArbitrageBot(IPoolAddressesProvider(provider), vault, address(registry), usdc);
        vm.stopPrank();
    }

    function test_Initialization() public view {
        assertEq(address(bot.poolAddressesProvider()), provider);
        assertEq(bot.vaultAddress(), vault);
        assertEq(address(bot.stablecoin()), usdc);
        assertEq(bot.owner(), owner);
    }

    function test_SetVaultAddress_OnlyOwner() public {
        address newVault = address(0x5);
        vm.startPrank(address(0xdead));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xdead)));
        bot.setVaultAddress(newVault);
        vm.stopPrank();

        vm.startPrank(owner);
        bot.setVaultAddress(newVault);
        assertEq(bot.vaultAddress(), newVault);
        vm.stopPrank();
    }
}
