// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/ArbitrageBot.sol";
import "../src/ArbitrageVault.sol";
import "../src/DEXRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Mock USDC for testing
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000 * 1e6); // 6 decimals
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract RealScenariosTest is Test {
    ArbitrageVault vault;
    ArbitrageBot bot;
    MockUSDC usdc;
    DEXRegistry registry;
    
    address owner = address(0x1);
    address operator = address(0x2);
    address user1 = address(0x100);
    address botExecutor = address(0x200);

    function setUp() public {
        usdc = new MockUSDC();
        registry = new DEXRegistry(owner);
        
        // Use a dummy address for Aave provider in tests
        address provider = address(0xAAA);
        
        vm.startPrank(owner);
        vault = new ArbitrageVault(owner, 1500, address(usdc));
        bot = new ArbitrageBot(IPoolAddressesProvider(provider), address(vault), address(registry), address(usdc));
        
        // Critical: Bot must be an executor on the vault to call distributeProfit
        vault.authorizeExecutor(address(bot));
        
        vault.proposeSetOperatorAddress(operator);
        vm.warp(block.timestamp + 3 days);
        vault.executeSetOperatorAddress(operator);
        vm.stopPrank();

        vm.deal(user1, 100 ether);
    }

    function test_SaaS_EndToEnd_BotDistribution() public {
        // 1. User deposits
        vm.prank(user1);
        vault.deposit{value: 10 ether}();

        // 2. Bot makes profit (represented by minting USDC to bot)
        uint256 profitAmount = 100 * 1e6; // $100.00
        usdc.mint(address(bot), profitAmount);

        // 3. Executor (Backend) tells bot to push profit to vault
        vm.prank(owner);
        bot.distributeToVault(profitAmount);

        // 4. Verify results
        // 15% fee = $15. Net to users = $85.
        vm.prank(user1);
        (,, uint256 claim,,,,,,,,,,) = vault.getMyAccount();
        assertEq(claim, 85 * 1e6);

        // 5. Operator claims fees
        uint256 opBalBefore = usdc.balanceOf(operator);
        vm.prank(operator);
        vault.claimOperatorFees();
        assertEq(usdc.balanceOf(operator) - opBalBefore, 15 * 1e6);
    }

    function test_SaaS_Withdrawal_RateLimit_Fixed() public {
        vm.startPrank(user1);
        vault.deposit{value: 40 ether}();

        // Withdraw 5 ETH (within 25% of 40 = 10 ETH)
        // This now only requests it
        vault.withdraw(0, 5 ether);
        
        // Warp 13 hours
        vm.warp(block.timestamp + 13 hours);
        
        // Execute it
        vault.executeWithdrawal();
        
        vm.stopPrank();
    }
}
