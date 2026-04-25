// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/**
 * @notice Swap parameters for any DEX
 */
struct SwapParams {
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minAmountOut;
    bytes data;             // DEX-specific calldata
    uint256 deadline;
}

/**
 * @notice Swap result
 */
struct SwapResult {
    uint256 amountIn;
    uint256 amountOut;
    address tokenIn;
    address tokenOut;
    bool success;
}

/**
 * @title IDEXAdapter
 * @notice Interface for DEX-specific swap implementations
 */
interface IDEXAdapter {

    function swap(SwapParams calldata params) external payable returns (SwapResult memory result);

    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut);

    function getAmountIn(
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    ) external view returns (uint256 amountIn);

    function getPool(address tokenIn, address tokenOut)
        external
        view
        returns (address poolAddress);

    function poolExists(address tokenIn, address tokenOut, uint256 minLiquidity)
        external
        view
        returns (bool exists);

    function getReserves(address pool, address token0, address token1)
        external
        view
        returns (uint256 reserve0, uint256 reserve1);

    function getDEXName() external view returns (string memory);
    function getDEXVersion() external view returns (string memory);
    function getRouterAddress() external view returns (address);
    function getFactoryAddress() external view returns (address);

    function isValidPair(address tokenIn, address tokenOut)
        external
        view
        returns (bool isValid);

    function validateSwapParams(SwapParams calldata params)
        external
        view
        returns (bool isValid, string memory reason);
}
