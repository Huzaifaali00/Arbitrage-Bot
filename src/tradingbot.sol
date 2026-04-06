// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MEVBot {

    address public owner;
    mapping(address => uint256) public totalProfit;

    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    bool private _locked;

    struct ArbHop {
        address pool;
        bool zeroForOne;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier nonReentrant() {
        require(!_locked, "reentrant");
        _locked = true;
        _;
        _locked = false;
    }

    constructor() {
        owner = msg.sender;
    }

    function executeSandwich(
        address pool,
        bool zeroForOne,
        int256 amountIn,
        uint256 minimumProfit,
        uint256 builderTip
    ) external onlyOwner nonReentrant {
        require(amountIn > 0, "amountIn must be positive");

        address tokenIn = zeroForOne
            ? IUniswapV3Pool(pool).token0()
            : IUniswapV3Pool(pool).token1();

        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));

        (int256 amount0, int256 amount1) = IUniswapV3Pool(pool).swap(
            address(this),
            zeroForOne,
            amountIn,
            zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            abi.encode(pool)
        );

        int256 amountReceived = zeroForOne ? -amount1 : -amount0;
        require(amountReceived > 0, "front-run yielded no output");

        IUniswapV3Pool(pool).swap(
            address(this),
            !zeroForOne,
            amountReceived,
            !zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
            abi.encode(pool)
        );

        uint256 balanceAfter = IERC20(tokenIn).balanceOf(address(this));

        require(balanceAfter >= balanceBefore + minimumProfit, "MEVBot: insufficient profit");

        uint256 profit = balanceAfter - balanceBefore;
        totalProfit[tokenIn] += profit;

        if (builderTip > 0) {
            block.coinbase.transfer(builderTip);
        }
    }

    function executeArb(
        ArbHop[] calldata hops,
        address tokenIn,
        int256 amountIn,
        uint256 minimumProfit,
        uint256 builderTip
    ) external onlyOwner nonReentrant {
        require(hops.length > 0, "no hops");
        require(amountIn > 0, "amountIn must be positive");

        uint256 balanceBefore = IERC20(tokenIn).balanceOf(address(this));

        int256 nextAmountIn = amountIn;

        for (uint256 i = 0; i < hops.length; i++) {
            (int256 amount0, int256 amount1) = IUniswapV3Pool(hops[i].pool).swap(
                address(this),
                hops[i].zeroForOne,
                nextAmountIn,
                hops[i].zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
                abi.encode(hops[i].pool)
            );

            int256 amountOut = hops[i].zeroForOne ? -amount1 : -amount0;
            require(amountOut > 0, "hop yielded no output");
            nextAmountIn = amountOut;
        }

        uint256 balanceAfter = IERC20(tokenIn).balanceOf(address(this));

        require(balanceAfter >= balanceBefore + minimumProfit, "MEVBot: insufficient arb profit");

        uint256 profit = balanceAfter - balanceBefore;
        totalProfit[tokenIn] += profit;

        if (builderTip > 0) {
            block.coinbase.transfer(builderTip);
        }
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        require(_locked, "no active swap");
        address pool = abi.decode(data, (address));
        require(msg.sender == pool, "not pool");
        require(amount0Delta > 0 || amount1Delta > 0, "invalid delta");

        if (amount0Delta > 0) {
            IERC20(IUniswapV3Pool(pool).token0()).transfer(
                msg.sender,
                uint256(amount0Delta)
            );
        } else {
            IERC20(IUniswapV3Pool(pool).token1()).transfer(
                msg.sender,
                uint256(amount1Delta)
            );
        }
    }

    receive() external payable {}

    function withdraw(address token) external onlyOwner {
        IERC20(token).transfer(owner, IERC20(token).balanceOf(address(this)));
    }

    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
}
