// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ArbitrageBot
 * @notice Enhanced MEV arbitrage bot with security hardening
 * @dev Supports multi-hop arbitrage on Uniswap V3 with sandwich attack capabilities
 */
contract ArbitrageBot is ReentrancyGuard, Ownable {
    
    // ============ Constants ============
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
    
    uint256 private constant MAX_HOPS = 10; // Prevent unbounded gas consumption
    
    // ============ State Variables ============
    
    /// @notice Tracks total profit accumulated per token
    mapping(address => uint256) public totalProfit;
    
    /// @notice Approved pool addresses for trading
    mapping(address => bool) public approvedPools;
    
    /// @notice Approved tokens for trading
    mapping(address => bool) public approvedTokens;
    
    /// @notice Whether contract is paused (emergency stop)
    bool public paused;
    
    /// @notice Pending owner for two-step ownership transfer
    address public pendingOwner;
    
    // ============ Events ============
    
    event SandwichExecuted(
        address indexed pool,
        bool zeroForOne,
        int256 amountIn,
        uint256 profitMade,
        uint256 builderTip
    );
    
    event ArbExecuted(
        uint256 hopsLength,
        address indexed tokenIn,
        int256 amountIn,
        uint256 profitMade,
        uint256 builderTip
    );
    
    event ProfitWithdrawn(address indexed token, uint256 amount);
    event ETHWithdrawn(uint256 amount);
    event PoolApproved(address indexed pool);
    event PoolRevoked(address indexed pool);
    event TokenApproved(address indexed token);
    event TokenRevoked(address indexed token);
    event Paused();
    event Unpaused();
    
    // ============ Modifiers ============
    
    modifier whenNotPaused() {
        require(!paused, "ArbitrageBot: contract is paused");
        _;
    }
    
    modifier onlyApprovedPool(address pool) {
        require(approvedPools[pool], "ArbitrageBot: pool not approved");
        _;
    }
    
    modifier onlyApprovedToken(address token) {
        require(approvedTokens[token], "ArbitrageBot: token not approved");
        _;
    }
    
    // ============ Constructor ============
    
    constructor() Ownable(msg.sender) {
        paused = false;
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Add a pool to the whitelist
     * @param pool Address of Uniswap V3 pool
     */
    function approvePool(address pool) external onlyOwner {
        require(pool != address(0), "ArbitrageBot: invalid pool address");
        require(!approvedPools[pool], "ArbitrageBot: pool already approved");
        
        // Basic validation - check if pool has necessary functions
        // This is a basic check; more rigorous validation could be added
        try IUniswapV3Pool(pool).factory() {} catch {
            revert("ArbitrageBot: invalid Uniswap V3 pool");
        }
        
        approvedPools[pool] = true;
        emit PoolApproved(pool);
    }
    
    /**
     * @notice Remove a pool from the whitelist
     * @param pool Address of Uniswap V3 pool
     */
    function revokePool(address pool) external onlyOwner {
        require(approvedPools[pool], "ArbitrageBot: pool not approved");
        approvedPools[pool] = false;
        emit PoolRevoked(pool);
    }
    
    /**
     * @notice Add a token to the whitelist
     * @param token Address of ERC20 token
     */
    function approveToken(address token) external onlyOwner {
        require(token != address(0), "ArbitrageBot: invalid token address");
        require(!approvedTokens[token], "ArbitrageBot: token already approved");
        
        // Validate token has transfer function
        try IERC20(token).balanceOf(address(this)) {} catch {
            revert("ArbitrageBot: invalid ERC20 token");
        }
        
        approvedTokens[token] = true;
        emit TokenApproved(token);
    }
    
    /**
     * @notice Remove a token from the whitelist
     * @param token Address of ERC20 token
     */
    function revokeToken(address token) external onlyOwner {
        require(approvedTokens[token], "ArbitrageBot: token not approved");
        approvedTokens[token] = false;
        emit TokenRevoked(token);
    }
    
    /**
     * @notice Emergency pause function
     */
    function pause() external onlyOwner {
        require(!paused, "ArbitrageBot: already paused");
        paused = true;
        emit Paused();
    }
    
    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        require(paused, "ArbitrageBot: already unpaused");
        paused = false;
        emit Unpaused();
    }
    
    // ============ Ownership Transfer (Two-Step) ============
    
    /**
     * @notice Initiate ownership transfer
     * @param newOwner Address of new owner
     */
    function transferOwnership(address newOwner) public override onlyOwner {
        require(newOwner != address(0), "ArbitrageBot: invalid new owner");
        pendingOwner = newOwner;
    }
    
    /**
     * @notice Accept ownership transfer (must be called by pendingOwner)
     */
    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "ArbitrageBot: only pending owner can accept");
        address oldOwner = owner();
        _transferOwnership(msg.sender);
        pendingOwner = address(0);
    }
    
    // ============ Core Trading Functions ============
    
    struct SandwichParams {
        address pool;
        bool zeroForOne;
        int256 amountIn;
        uint256 minimumProfit;
        uint256 builderTip;
        uint256 deadline;
    }
    
    /**
     * @notice Execute sandwich attack on Uniswap V3
     * @dev Front-run, piggyback, and back-run large swap
     * @param params SandwichParams struct containing trade parameters
     */
    function executeSandwich(SandwichParams calldata params) 
        external 
        onlyOwner 
        whenNotPaused 
        nonReentrant 
        onlyApprovedPool(params.pool)
    {
        // Input validation
        require(params.amountIn > 0, "ArbitrageBot: amountIn must be positive");
        require(params.deadline >= block.timestamp, "ArbitrageBot: transaction expired");
        require(params.minimumProfit > 0, "ArbitrageBot: minimum profit must be positive");
        
        // Get input token
        address tokenIn = params.zeroForOne
            ? IUniswapV3Pool(params.pool).token0()
            : IUniswapV3Pool(params.pool).token1();
        
        require(approvedTokens[tokenIn], "ArbitrageBot: input token not approved");
        
        // Record balance before swap
        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));
        
        // FRONT-RUN: First swap to establish position
        (int256 amount0, int256 amount1) = IUniswapV3Pool(params.pool).swap(
            address(this),
            params.zeroForOne,
            params.amountIn,
            params.zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            abi.encode(params.pool, params.deadline)
        );
        
        // Calculate amount received from first swap
        int256 amountReceived = params.zeroForOne ? -amount1 : -amount0;
        require(amountReceived > 0, "ArbitrageBot: front-run yielded no output");
        
        // BACK-RUN: Second swap to close position
        IUniswapV3Pool(params.pool).swap(
            address(this),
            !params.zeroForOne,
            amountReceived,
            !params.zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            abi.encode(params.pool, params.deadline)
        );
        
        // Validate profit
        uint256 balanceAfter = IERC20(tokenIn).balanceOf(address(this));
        require(
            balanceAfter >= balanceBefore + params.minimumProfit,
            "ArbitrageBot: insufficient profit from sandwich"
        );
        
        // Calculate and track profit
        uint256 profit = balanceAfter - balanceBefore;
        totalProfit[tokenIn] += profit;
        
        // Send builder tip using safe call pattern
        if (params.builderTip > 0) {
            _sendETH(block.coinbase, params.builderTip);
        }
        
        emit SandwichExecuted(
            params.pool,
            params.zeroForOne,
            params.amountIn,
            profit,
            params.builderTip
        );
    }
    
    struct ArbHop {
        address pool;
        bool zeroForOne;
    }
    
    struct MultiHopArbParams {
        ArbHop[] hops;
        address tokenIn;
        int256 amountIn;
        uint256 minimumProfit;
        uint256 builderTip;
        uint256 deadline;
    }
    
    /**
     * @notice Execute multi-hop arbitrage across multiple pools
     * @param params MultiHopArbParams struct containing arbitrage parameters
     */
    function executeMultiHopArb(MultiHopArbParams calldata params)
        external
        onlyOwner
        whenNotPaused
        nonReentrant
        onlyApprovedToken(params.tokenIn)
    {
        // Input validation
        require(params.hops.length > 0, "ArbitrageBot: no hops provided");
        require(params.hops.length <= MAX_HOPS, "ArbitrageBot: too many hops");
        require(params.amountIn > 0, "ArbitrageBot: amountIn must be positive");
        require(params.deadline >= block.timestamp, "ArbitrageBot: transaction expired");
        require(params.minimumProfit > 0, "ArbitrageBot: minimum profit must be positive");
        
        // Validate all pools are approved
        for (uint256 i = 0; i < params.hops.length; i++) {
            require(approvedPools[params.hops[i].pool], "ArbitrageBot: pool not approved");
        }
        
        // Record balance before swaps
        uint256 balanceBefore = IERC20(params.tokenIn).balanceOf(address(this));
        
        // Execute each hop
        int256 currentAmountIn = params.amountIn;
        
        for (uint256 i = 0; i < params.hops.length; i++) {
            (int256 amount0, int256 amount1) = IUniswapV3Pool(params.hops[i].pool).swap(
                address(this),
                params.hops[i].zeroForOne,
                currentAmountIn,
                params.hops[i].zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
                abi.encode(params.hops[i].pool, params.deadline)
            );
            
            // Calculate amount for next hop
            int256 amountOut = params.hops[i].zeroForOne ? -amount1 : -amount0;
            require(amountOut > 0, "ArbitrageBot: hop yielded no output");
            
            currentAmountIn = amountOut;
        }
        
        // Validate final profit
        uint256 balanceAfter = IERC20(params.tokenIn).balanceOf(address(this));
        require(
            balanceAfter >= balanceBefore + params.minimumProfit,
            "ArbitrageBot: insufficient arb profit"
        );
        
        // Calculate and track profit
        uint256 profit = balanceAfter - balanceBefore;
        totalProfit[params.tokenIn] += profit;
        
        // Send builder tip using safe call pattern
        if (params.builderTip > 0) {
            _sendETH(block.coinbase, params.builderTip);
        }
        
        emit ArbExecuted(
            params.hops.length,
            params.tokenIn,
            params.amountIn,
            profit,
            params.builderTip
        );
    }
    
    // ============ Callback Handler ============
    
    /**
     * @notice Uniswap V3 swap callback - handles token transfer
     * @dev Called by IUniswapV3Pool after swap is executed
     */
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        // Decode callback data
        (address pool, uint256 deadline) = abi.decode(data, (address, uint256));
        
        // Validate callback requirements
        require(msg.sender == pool, "ArbitrageBot: callback from unauthorized address");
        require(approvedPools[pool], "ArbitrageBot: callback from unapproved pool");
        require(deadline >= block.timestamp, "ArbitrageBot: callback expired");
        require(amount0Delta > 0 || amount1Delta > 0, "ArbitrageBot: invalid delta");
        
        // Transfer appropriate token amount
        if (amount0Delta > 0) {
            address token0 = IUniswapV3Pool(pool).token0();
            require(approvedTokens[token0], "ArbitrageBot: token0 not approved");
            IERC20(token0).transfer(msg.sender, uint256(amount0Delta));
        }
        
        if (amount1Delta > 0) {
            address token1 = IUniswapV3Pool(pool).token1();
            require(approvedTokens[token1], "ArbitrageBot: token1 not approved");
            IERC20(token1).transfer(msg.sender, uint256(amount1Delta));
        }
    }
    
    // ============ Withdrawal Functions ============
    
    /**
     * @notice Withdraw accumulated profit for a token
     * @param token Address of token to withdraw
     */
    function withdrawProfit(address token) external onlyOwner nonReentrant {
        require(token != address(0), "ArbitrageBot: invalid token");
        
        uint256 amount = totalProfit[token];
        require(amount > 0, "ArbitrageBot: no profit to withdraw");
        
        totalProfit[token] = 0;
        
        bool success = IERC20(token).transfer(owner(), amount);
        require(success, "ArbitrageBot: token transfer failed");
        
        emit ProfitWithdrawn(token, amount);
    }
    
    /**
     * @notice Withdraw all funds of a token (including non-profit balance)
     * @param token Address of token to withdraw
     */
    function withdrawAll(address token) external onlyOwner nonReentrant {
        require(token != address(0), "ArbitrageBot: invalid token");
        
        uint256 amount = IERC20(token).balanceOf(address(this));
        require(amount > 0, "ArbitrageBot: no balance to withdraw");
        
        // Reset profit tracking for this token
        totalProfit[token] = 0;
        
        bool success = IERC20(token).transfer(owner(), amount);
        require(success, "ArbitrageBot: token transfer failed");
        
        emit ProfitWithdrawn(token, amount);
    }
    
    /**
     * @notice Withdraw accumulated ETH
     */
    function withdrawETH() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        require(amount > 0, "ArbitrageBot: no ETH to withdraw");
        
        _sendETH(owner(), amount);
        
        emit ETHWithdrawn(amount);
    }
    
    // ============ Helper Functions ============
    
    /**
     * @notice Safe ETH transfer using call pattern
     * @dev Prevents issues with smart wallets and multisigs
     */
    function _sendETH(address recipient, uint256 amount) internal {
        (bool success, ) = payable(recipient).call{value: amount}("");
        require(success, "ArbitrageBot: ETH transfer failed");
    }
    
    // ============ Receive Functions ============
    
    receive() external payable {}
    
    fallback() external payable {}
    
    // ============ View Functions ============
    
    /**
     * @notice Get total profit for a token
     * @param token Address of token
     * @return Accumulated profit amount
     */
    function getProfitFor(address token) external view returns (uint256) {
        return totalProfit[token];
    }
    
    /**
     * @notice Check if pool is approved
     * @param pool Address of pool
     * @return True if pool is approved
     */
    function isPoolApproved(address pool) external view returns (bool) {
        return approvedPools[pool];
    }
    
    /**
     * @notice Check if token is approved
     * @param token Address of token
     * @return True if token is approved
     */
    function isTokenApproved(address token) external view returns (bool) {
        return approvedTokens[token];
    }
    
    /**
     * @notice Get current ETH balance
     * @return ETH balance in wei
     */
    function getETHBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    /**
     * @notice Get token balance
     * @param token Address of token
     * @return Token balance
     */
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
}
