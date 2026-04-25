// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "./IDEXAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// ── Minimal Uniswap V3 interfaces ────────────

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external;
}

/**
 * @title UniswapV3Adapter
 * @notice Adapter for Uniswap V3 pools
 */
contract UniswapV3Adapter is IDEXAdapter, IUniswapV3SwapCallback, Ownable {
    using SafeERC20 for IERC20;

    address public immutable factory;
    address public immutable quoter;
    
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    constructor(address _factory, address _quoter) Ownable(msg.sender) {
        factory = _factory;
        quoter = _quoter;
    }

    /**
     * @notice Execute a swap on a specific Uniswap V3 pool
     * @param params Swap parameters
     * @return result Swap result
     */
    function swap(SwapParams calldata params) external payable override returns (SwapResult memory result) {
        address pool = abi.decode(params.data, (address));
        require(pool != address(0), "UniswapV3Adapter: pool required in data");

        IUniswapV3Pool v3Pool = IUniswapV3Pool(pool);
        bool zeroForOne = (params.tokenIn == v3Pool.token0());

        uint256 balanceBefore = IERC20(params.tokenOut).balanceOf(msg.sender);

        // Execute swap - tokens are pulled in the callback
        v3Pool.swap(
            msg.sender,
            zeroForOne,
            int256(params.amountIn),
            zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            abi.encode(msg.sender, params.tokenIn) // Pass sender to callback to pull tokens
        );

        uint256 balanceAfter = IERC20(params.tokenOut).balanceOf(msg.sender);
        uint256 amountOut = balanceAfter - balanceBefore;
        
        require(amountOut >= params.minAmountOut, "UniswapV3Adapter: insufficient output");

        return SwapResult({
            amountIn: params.amountIn,
            amountOut: amountOut,
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            success: true
        });
    }

    /**
     * @notice Callback for Uniswap V3 swap
     */
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external override {
        require(amount0Delta > 0 || amount1Delta > 0, "UniswapV3Adapter: invalid delta");

        (address payer, address tokenIn) = abi.decode(data, (address, address));
        
        uint256 amountToPay = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        
        IERC20(tokenIn).safeTransferFrom(payer, msg.sender, amountToPay);
    }

    function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view override returns (uint256) {
        // Pricing in V3 usually requires a Quoter call. 
        // For on-chain discovery, this would be gas-heavy.
        return 0; 
    }

    function getAmountIn(address tokenIn, address tokenOut, uint256 amountOut) external view override returns (uint256) {
        return 0;
    }

    function getPool(address tokenIn, address tokenOut) external view override returns (address) {
        uint24[3] memory feeTiers = [uint24(500), uint24(3000), uint24(10000)];
        for (uint256 i = 0; i < feeTiers.length; i++) {
            address pool = IUniswapV3Factory(factory).getPool(tokenIn, tokenOut, feeTiers[i]);
            if (pool != address(0)) return pool;
        }
        return address(0);
    }

    function poolExists(address tokenIn, address tokenOut, uint256 minLiquidity) external view override returns (bool) {
        uint24[3] memory feeTiers = [uint24(500), uint24(3000), uint24(10000)];
        for (uint256 i = 0; i < feeTiers.length; i++) {
            if (IUniswapV3Factory(factory).getPool(tokenIn, tokenOut, feeTiers[i]) != address(0)) return true;
        }
        return false;
    }

    function getReserves(address pool, address token0, address token1) external view override returns (uint256, uint256) {
        // V3 doesn't have reserves in the same way as V2.
        return (0, 0);
    }

    function getDEXName() external pure override returns (string memory) { return "Uniswap V3"; }
    function getDEXVersion() external pure override returns (string memory) { return "3.0"; }
    function getRouterAddress() external view override returns (address) { return address(0); }
    function getFactoryAddress() external view override returns (address) { return factory; }

    function isValidPair(address tokenIn, address tokenOut) external view override returns (bool) {
        return true;
    }

    function validateSwapParams(SwapParams calldata params) external view override returns (bool, string memory) {
        if (params.data.length == 0) return (false, "UniswapV3Adapter: pool address in data required");
        return (true, "");
    }
}
