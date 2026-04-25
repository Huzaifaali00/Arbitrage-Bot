// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/ArbitrageVault.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000 * 1e6);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract ArbitrageVaultSecurityTest is Test {
    ArbitrageVault vault;
    MockUSDC usdc;
    
    address owner = address(0x1);
    address user1 = address(0x100);
    address user2 = address(0x101);
    address guardian = address(0x200);

    function setUp() public {
        usdc = new MockUSDC();
        vm.prank(owner);
        vault = new ArbitrageVault(owner, 1500, address(usdc));
        
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);
    }

    function test_Withdrawal_Delay_Pipeline() public {
        vm.startPrank(user1);
        vault.deposit{value: 10 ether}();
        
        // Initial state
        (uint256 principal,,,,,,,,,,,,) = vault.getMyAccount();
        assertEq(principal, 10 ether);

        // Step 1: Request
        vault.requestWithdrawal(0, 2 ether);
        
        // Try to execute immediately (should fail)
        vm.expectRevert("Vault: delay active");
        vault.executeWithdrawal();

        // Warp 6 hours (still should fail)
        vm.warp(block.timestamp + 6 hours);
        vm.expectRevert("Vault: delay active");
        vault.executeWithdrawal();

        // Warp to 12.1 hours
        vm.warp(block.timestamp + 6 hours + 1);
        
        uint256 balBefore = user1.balance;
        vault.executeWithdrawal();
        assertEq(user1.balance - balBefore, 2 ether);
        
        (principal,,,,,,,,,,,,) = vault.getMyAccount();
        assertEq(principal, 8 ether);
        vm.stopPrank();
    }

    function test_Self_Freeze_Blocks_Withdrawal() public {
        vm.startPrank(user1);
        vault.deposit{value: 10 ether}();
        vault.requestWithdrawal(0, 5 ether);
        
        // User notices suspicious activity or just wants to freeze
        vault.freezeAccount(user1);
        
        // Warp past delay
        vm.warp(block.timestamp + 13 hours);
        
        // Should fail despite delay because account is frozen
        vm.expectRevert("Vault: account frozen");
        vault.executeWithdrawal();
        
        vm.stopPrank();
    }

    function test_Guardian_Freeze() public {
        vm.prank(user1);
        vault.setGuardian(guardian);

        vm.prank(user1);
        vault.deposit{value: 10 ether}();
        
        // Attacker (user1 compromised) requests withdrawal
        vm.prank(user1);
        vault.requestWithdrawal(0, 10 ether);

        // Guardian sees this and freezes
        vm.prank(guardian);
        vault.freezeAccount(user1);

        // Warp past delay
        vm.warp(block.timestamp + 13 hours);

        // Execute withdrawal should fail
        vm.prank(user1);
        vm.expectRevert("Vault: account frozen");
        vault.executeWithdrawal();
    }

    function test_Unfreeze_CoolingOff_Period() public {
        vm.startPrank(user1);
        vault.deposit{value: 10 ether}();
        vault.freezeAccount(user1);
        
        // Try to initiate unfreeze
        vault.initiateUnfreeze();
        
        // Try to complete immediately
        vm.expectRevert("Vault: delay active");
        vault.completeUnfreeze();

        // Warp 2 days
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert("Vault: delay active");
        vault.completeUnfreeze();

        // Warp to 3.1 days
        vm.warp(block.timestamp + 1 days + 1);
        vault.completeUnfreeze();
        
        // Now can withdraw (request first)
        vault.requestWithdrawal(0, 1 ether);
        vm.warp(block.timestamp + 13 hours);
        vault.executeWithdrawal();
        vm.stopPrank();
    }

    function test_Recovery_Process() public {
        vm.prank(user1);
        vault.setGuardian(guardian);
        
        vm.prank(user1);
        vault.deposit{value: 10 ether}();

        // Guardian nominates user2 (new hardware wallet)
        vm.prank(guardian);
        vault.nominateNewOwner(user1, user2);

        // Check delay
        vm.warp(block.timestamp + 6 days);
        vm.prank(guardian);
        vm.expectRevert("Vault: delay active");
        vault.completeRecovery(user1);

        // Complete after 7 days
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(guardian);
        vault.completeRecovery(user1);

        // User2 now owns the funds, User1 is empty
        vm.prank(user2);
        (uint256 principal,,,,,,,,,,,,) = vault.getMyAccount();
        assertEq(principal, 10 ether);

        vm.prank(user1);
        (principal,,,,,,,,,,,,) = vault.getMyAccount();
        assertEq(principal, 0);
    }

    function test_Recovery_Cancellation_By_User() public {
        vm.prank(user1);
        vault.setGuardian(guardian);
        
        // Bogus nomination by compromised guardian
        vm.prank(guardian);
        vault.nominateNewOwner(user1, user2);

        // User cancels it
        vm.prank(user1);
        vault.cancelRecovery();

        // Wait 8 days
        vm.warp(block.timestamp + 8 days);
        vm.prank(guardian);
        vm.expectRevert("Vault: no nomination");
        vault.completeRecovery(user1);
    }

    /**
     * @dev Regression test: after a successful recovery the guardian must NOT be
     *      able to call completeRecovery on the new account to wipe its funds.
     *      Before the fix, accounts[newAccount] inherited recoveryNewOwner=newAccount
     *      and an already-expired recoveryAvailableAt, so the guardian could
     *      immediately delete the recovered account.
     */
    function test_Recovery_Cannot_Delete_Recovered_Account() public {
        vm.prank(user1);
        vault.setGuardian(guardian);

        vm.prank(user1);
        vault.deposit{value: 10 ether}();

        // Guardian nominates user2 and completes after delay
        vm.prank(guardian);
        vault.nominateNewOwner(user1, user2);

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(guardian);
        vault.completeRecovery(user1);

        // user2 should own the 10 ETH
        vm.prank(user2);
        (uint256 principal,,,,,,,,,,,,) = vault.getMyAccount();
        assertEq(principal, 10 ether);

        // Guardian must NOT be able to re-trigger recovery on the new account
        vm.prank(guardian);
        vm.expectRevert("Vault: no nomination");
        vault.completeRecovery(user2);

        // Funds must still be intact
        vm.prank(user2);
        (principal,,,,,,,,,,,,) = vault.getMyAccount();
        assertEq(principal, 10 ether);
    }

    function test_Frozen_Account_Cannot_Deposit() public {
        vm.startPrank(user1);
        vault.deposit{value: 1 ether}();
        vault.freezeAccount(user1);
        
        vm.expectRevert("Vault: account frozen");
        vault.deposit{value: 1 ether}();
        vm.stopPrank();
    }
}
