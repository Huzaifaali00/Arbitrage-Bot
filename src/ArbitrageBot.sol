// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {IPoolAddressesProvider, IPool, IFlashLoanSimpleReceiver} from "./interfaces/IAave.sol";
import {IDEXAdapter, SwapParams, SwapResult} from "./adapters/IDEXAdapter.sol";
import {DEXRegistry} from "./DEXRegistry.sol";

// Minimal interface for Uniswap V3 Pool
interface IUniswapV3Minimal {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

// Minimal interface for ArbitrageVault
interface IArbitrageVault {
    function distributeProfit(uint256 amount) external;
}

/**
 * @title ArbitrageBot
 * @notice Advanced profit-to-stablecoin back-run and multi-hop arbitrage executor
 * @dev Integrated with Aave V3 for capital-free trading.
 *      Automatically converts all arbitrage profit into USDC/USDT.
 */
contract ArbitrageBot is ReentrancyGuard, Ownable, IFlashLoanSimpleReceiver {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    uint256 public constant MAX_SLIPPAGE_BPS = 500; // 5%

    // ============ State Variables ============
    IPoolAddressesProvider public immutable poolAddressesProvider;
    IERC20 public immutable stablecoin;
    DEXRegistry public registry;
    address public vaultAddress;
    address public pendingOwner;

    mapping(DEXRegistry.DEXType => IDEXAdapter) public adapters;

    // ============ Events ============
    event BackrunExecuted(address indexed pool, uint256 profitUSDC);
    event ArbExecuted(uint256 profitUSDC);
    event ProfitConverted(address indexed token, uint256 amountIn, uint256 amountOutUSDC);
    event AdapterSet(DEXRegistry.DEXType indexed dexType, address adapter);
    event VaultSet(address vault);
    event RegistrySet(address registry);

    // ============ Constructor ============
    constructor(
        IPoolAddressesProvider _provider,
        address _vault,
        address _registry,
        address _stablecoin
    ) Ownable(msg.sender) {
        poolAddressesProvider = _provider;
        vaultAddress = _vault;
        registry = DEXRegistry(_registry);
        stablecoin = IERC20(_stablecoin);
    }

    // ============ Admin Functions ============

    function setAdapter(DEXRegistry.DEXType dexType, address adapter) external onlyOwner {
        require(adapter != address(0), "Zero address");
        adapters[dexType] = IDEXAdapter(adapter);
        emit AdapterSet(dexType, adapter);
    }

    function setVaultAddress(address vault) external onlyOwner {
        require(vault != address(0), "Zero address");
        vaultAddress = vault;
        emit VaultSet(vault);
    }

    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Zero address");
        registry = DEXRegistry(_registry);
        emit RegistrySet(_registry);
    }

    // ============ Core Trading — Back-Run ============

    struct BackrunParams {
        address pool;
        bool zeroForOne;
        uint256 amountIn;
        uint256 minProfitUSDC;
        uint256 deadline;
        bool useFlashLoan;
    }

    function executeBackrun(BackrunParams calldata params) external onlyOwner nonReentrant {
        if (params.useFlashLoan) {
            address tokenIn = params.zeroForOne 
                ? IUniswapV3Minimal(params.pool).token0() 
                : IUniswapV3Minimal(params.pool).token1();
            
            bytes memory data = abi.encode("BACKRUN", params);
            IPool(poolAddressesProvider.getPool()).flashLoanSimple(
                address(this),
                tokenIn,
                params.amountIn,
                data,
                0
            );
        } else {
            _executeBackrunInternal(params);
        }
    }

    function _executeBackrunInternal(BackrunParams memory params) internal {
        DEXRegistry.PoolInfo memory info = registry.getPoolInfo(params.pool);
        require(info.isActive, "Pool not active");
        
        IDEXAdapter adapter = adapters[info.dexType];
        require(address(adapter) != address(0), "Adapter not set");

        address tokenIn = params.zeroForOne ? info.token0 : info.token1;
        address tokenOut = params.zeroForOne ? info.token1 : info.token0;

        uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));

        // Grant allowance to adapter
        IERC20(tokenIn).forceApprove(address(adapter), params.amountIn);

        SwapParams memory swapParams = SwapParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: params.amountIn,
            minAmountOut: 1, // Will verify profit in USDC
            data: abi.encode(params.pool),
            deadline: params.deadline
        });

        adapter.swap(swapParams);

        uint256 amountOut = IERC20(tokenOut).balanceOf(address(this)) - balBefore;
        
        uint256 profitUSDC = _convertToUSDC(tokenOut, amountOut);
        require(profitUSDC >= params.minProfitUSDC, "Insufficient USDC profit");

        emit BackrunExecuted(params.pool, profitUSDC);
    }

    // ============ Aave Callback ============

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == poolAddressesProvider.getPool(), "Only Aave");
        require(initiator == address(this), "ArbitrageBot: unauthorized initiator");
        
        (string memory action, bytes memory data) = abi.decode(params, (string, bytes));
        
        if (keccak256(abi.encodePacked(action)) == keccak256(abi.encodePacked("BACKRUN"))) {
            BackrunParams memory bParams = abi.decode(data, (BackrunParams));
            _executeBackrunInternal(bParams);
        } else if (keccak256(abi.encodePacked(action)) == keccak256(abi.encodePacked("ARB"))) {
            MultiHopArbParams memory aParams = abi.decode(data, (MultiHopArbParams));
            _executeMultiHopArbInternal(aParams);
        }

        uint256 amountToReturn = amount + premium;
        IERC20(asset).forceApprove(msg.sender, amountToReturn);
        
        return true;
    }

    function ADDRESSES_PROVIDER() external view override returns (address) {
        return address(poolAddressesProvider);
    }

    function POOL() external view override returns (address) {
        return poolAddressesProvider.getPool();
    }

    // ============ Multi-Hop Arbitrage ============

    struct ArbHop {
        address pool;
        bool zeroForOne;
    }

    struct MultiHopArbParams {
        ArbHop[] hops;
        address tokenIn;
        uint256 amountIn;
        uint256 minProfitUSDC;
        uint256 deadline;
        bool useFlashLoan;
    }

    function executeMultiHopArb(MultiHopArbParams calldata params) external onlyOwner nonReentrant {
        require(params.hops.length > 0, "ArbitrageBot: no hops");
        if (params.useFlashLoan) {
            bytes memory data = abi.encode("ARB", params);
            IPool(poolAddressesProvider.getPool()).flashLoanSimple(
                address(this),
                params.tokenIn,
                params.amountIn,
                data,
                0
            );
        } else {
            _executeMultiHopArbInternal(params);
        }
    }

    function _executeMultiHopArbInternal(MultiHopArbParams memory params) internal {
        uint256 balBefore = IERC20(params.tokenIn).balanceOf(address(this));
        uint256 currentAmount = params.amountIn;
        address currentToken = params.tokenIn;

        for (uint256 i = 0; i < params.hops.length; i++) {
            DEXRegistry.PoolInfo memory info = registry.getPoolInfo(params.hops[i].pool);
            IDEXAdapter adapter = adapters[info.dexType];
            
            address nextToken = params.hops[i].zeroForOne ? info.token1 : info.token0;
            
            IERC20(currentToken).forceApprove(address(adapter), currentAmount);
            
            SwapResult memory res = adapter.swap(SwapParams({
                tokenIn: currentToken,
                tokenOut: nextToken,
                amountIn: currentAmount,
                minAmountOut: 1,
                data: abi.encode(params.hops[i].pool),
                deadline: params.deadline
            }));
            
            currentAmount = res.amountOut;
            currentToken = nextToken;
        }

        uint256 balAfter = IERC20(params.tokenIn).balanceOf(address(this));
        require(balAfter > balBefore, "ArbitrageBot: no profit");
        uint256 profit = balAfter - balBefore;
        uint256 profitUSDC = _convertToUSDC(params.tokenIn, profit);
        require(profitUSDC >= params.minProfitUSDC, "Insufficient USDC profit");
        emit ArbExecuted(profitUSDC);
    }

    // ============ Helper: Convert to Stablecoin ============

    function _convertToUSDC(address token, uint256 amount) internal returns (uint256) {
        if (token == address(stablecoin)) return amount;
        if (amount == 0) return 0;

        IDEXAdapter v3 = adapters[DEXRegistry.DEXType.UniswapV3];
        if (address(v3) == address(0)) return 0;

        uint256 balBefore = stablecoin.balanceOf(address(this));
        
        IERC20(token).forceApprove(address(v3), amount);
        
        try v3.swap(SwapParams({
            tokenIn: token,
            tokenOut: address(stablecoin),
            amountIn: amount,
            minAmountOut: 1,
            data: abi.encode(address(0)),
            deadline: block.timestamp + 600
        })) {
            uint256 received = stablecoin.balanceOf(address(this)) - balBefore;
            emit ProfitConverted(token, amount, received);
            return received;
        } catch {
            return 0;
        }
    }

    // ============ Uniswap V3 Callback ============

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        // Simple callback implementation
        if (amount0Delta > 0 || amount1Delta > 0) {
           // Standard transfer to pool if needed (already handled by adapter usually)
        }
    }

    // ============ Administrative ============

    /**
     * @notice Push accumulated USDC profit to the ArbitrageVault for distribution.
     * @param amount Amount in USDC units (6 decimals on Base).
     */
    function distributeToVault(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Zero amount");
        require(stablecoin.balanceOf(address(this)) >= amount, "Insufficient balance");
        
        stablecoin.forceApprove(vaultAddress, amount);
        IArbitrageVault(vaultAddress).distributeProfit(amount);
    }

    function withdrawProfit(address token) external onlyOwner {
        uint256 amount = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner(), amount);
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Not pending owner");
        _transferOwnership(msg.sender);
        pendingOwner = address(0);
    }

    receive() external payable {}
}
