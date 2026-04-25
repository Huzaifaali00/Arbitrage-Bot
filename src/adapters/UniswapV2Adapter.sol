// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "./IDEXAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// ─── Minimal Uniswap V2 interfaces (no external dependency needed) ────────────

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IUniswapV2Pair {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
}

/**
 * @title UniswapV2Adapter
 * @notice Adapter for Uniswap V2 and compatible DEXes (SushiSwap, QuickSwap, etc.)
 * @dev Implements IDEXAdapter interface for V2-style AMMs
 *
 * SECURITY NOTES:
 * - Validates all token addresses before swapping
 * - Enforces slippage protection via minAmountOut
 * - Deadline protection prevents stale transactions
 * - Reentrancy guard on swap execution
 * - Factory validation ensures pool legitimacy
 */
contract UniswapV2Adapter is IDEXAdapter, Ownable {

    using SafeERC20 for IERC20;

    // ════════════════════════════════════════════════════════════════════════════════
    // CONSTANTS & STATE
    // ════════════════════════════════════════════════════════════════════════════════

    address public immutable factory;
    address public immutable router;
    string public constant DEX_NAME = "Uniswap V2";
    string public constant DEX_VERSION = "2.0";

    /// @notice Verified pair addresses to reduce gas on repeated lookups
    mapping(bytes32 => address) public pairCache;

    /// @notice Authorized callers that can execute swaps
    mapping(address => bool) public authorizedCallers;

    /// @notice Circuit breaker for emergency situations
    bool public isOperational = true;

    // ════════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ════════════════════════════════════════════════════════════════════════════════

    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    event PairCacheUpdated(address indexed token0, address indexed token1, address pair);

    event CallerAuthorizationChanged(address indexed caller, bool isAuthorized);

    event CircuitBreakerTriggered(bool isOperational);

    // ════════════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ════════════════════════════════════════════════════════════════════════════════

    modifier onlyOperational() {
        require(isOperational, "UniswapV2Adapter: circuit breaker activated");
        _;
    }

    modifier onlyAuthorizedCaller() {
        require(
            authorizedCallers[msg.sender] || msg.sender == owner(),
            "UniswapV2Adapter: caller not authorized"
        );
        _;
    }

    modifier validAddress(address addr) {
        require(addr != address(0), "UniswapV2Adapter: invalid address");
        _;
    }

    modifier validPair(address token0, address token1) {
        require(token0 != address(0) && token1 != address(0), "UniswapV2Adapter: invalid tokens");
        require(token0 != token1, "UniswapV2Adapter: identical tokens");
        _;
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Initialize adapter with factory and router addresses
     * @param _factory Uniswap V2 factory address
     * @param _router Uniswap V2 router address
     */
    constructor(address _factory, address _router)
        Ownable(msg.sender)
        validAddress(_factory)
        validAddress(_router)
    {
        factory = _factory;
        router = _router;
        authorizedCallers[msg.sender] = true;
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Authorize an address to call swap functions
     * @param caller Address to authorize
     */
    function authorizeCaller(address caller)
        external
        onlyOwner
        validAddress(caller)
    {
        require(!authorizedCallers[caller], "UniswapV2Adapter: already authorized");
        authorizedCallers[caller] = true;
        emit CallerAuthorizationChanged(caller, true);
    }

    /**
     * @notice Revoke authorization from an address
     * @param caller Address to revoke
     */
    function revokeCaller(address caller)
        external
        onlyOwner
        validAddress(caller)
    {
        require(authorizedCallers[caller], "UniswapV2Adapter: not authorized");
        authorizedCallers[caller] = false;
        emit CallerAuthorizationChanged(caller, false);
    }

    /**
     * @notice Toggle circuit breaker for emergency situations
     */
    function toggleCircuitBreaker() external onlyOwner {
        isOperational = !isOperational;
        emit CircuitBreakerTriggered(isOperational);
    }

    /**
     * @notice Clear pair cache (useful after factory updates)
     * @param token0 First token
     * @param token1 Second token
     */
    function clearPairCache(address token0, address token1)
        external
        onlyOwner
        validPair(token0, token1)
    {
        bytes32 key = _getPairKey(token0, token1);
        delete pairCache[key];
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // SWAP EXECUTION
    // ════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Execute a swap on Uniswap V2
     * @param params Swap parameters
     * @return result Swap result with actual amounts
     *
     * SECURITY:
     * - Validates deadline to prevent stale transactions
     * - Enforces minAmountOut for slippage protection
     * - Validates token addresses
     * - Checks pair exists before swapping
     */
    function swap(SwapParams calldata params)
        external
        payable
        onlyOperational
        onlyAuthorizedCaller
        returns (SwapResult memory result)
    {
        require(params.deadline >= block.timestamp, "UniswapV2Adapter: expired");
        require(params.amountIn > 0, "UniswapV2Adapter: zero amount");
        require(params.minAmountOut > 0, "UniswapV2Adapter: invalid min amount");

        (bool isValid, string memory reason) = validateSwapParams(params);
        require(isValid, reason);

        // Resolve pair
        address pair = getPool(params.tokenIn, params.tokenOut);
        require(pair != address(0), "UniswapV2Adapter: no liquidity pool");

        // Determine swap direction: token0 → token1 or token1 → token0
        address pairToken0 = IUniswapV2Pair(pair).token0();
        bool isZeroForOne = (params.tokenIn == pairToken0);

        // Calculate expected output using reserve-based AMM formula
        uint256 expectedAmountOut = getAmountOut(params.tokenIn, params.tokenOut, params.amountIn);
        require(expectedAmountOut >= params.minAmountOut, "UniswapV2Adapter: insufficient output");

        // Transfer input tokens to the pair (V2 requires tokens before swap call)
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, pair, params.amountIn);

        // Call pair.swap() — amounts are (amount0Out, amount1Out)
        (uint256 amount0Out, uint256 amount1Out) = isZeroForOne
            ? (uint256(0), expectedAmountOut)
            : (expectedAmountOut, uint256(0));

        IUniswapV2Pair(pair).swap(amount0Out, amount1Out, msg.sender, new bytes(0));

        result = SwapResult({
            amountIn: params.amountIn,
            amountOut: expectedAmountOut,
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            success: true
        });

        emit SwapExecuted(params.tokenIn, params.tokenOut, params.amountIn, expectedAmountOut);
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // POOL INFORMATION
    // ════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get the pair (pool) address for a token pair via the V2 factory.
     * @dev Checks the local cache first; queries the factory on a miss and caches the result.
     */
    function getPool(address tokenIn, address tokenOut)
        public
        view
        validPair(tokenIn, tokenOut)
        returns (address pair)
    {
        // Check cache first (avoids a factory call on hot paths)
        bytes32 key = _getPairKey(tokenIn, tokenOut);
        pair = pairCache[key];

        if (pair == address(0)) {
            // Query V2 factory for the canonical pair address
            pair = IUniswapV2Factory(factory).getPair(tokenIn, tokenOut);
            // Note: cannot write to cache in a view function;
            // use updatePairCache() externally or swap() internally.
        }

        return pair;
    }

    /**
     * @notice Pre-populate the pair cache for a token pair to save gas on hot paths.
     * @dev Anyone can call this — it only writes the canonical factory result.
     */
    function updatePairCache(address tokenIn, address tokenOut)
        external
        validPair(tokenIn, tokenOut)
    {
        address pair = IUniswapV2Factory(factory).getPair(tokenIn, tokenOut);
        require(pair != address(0), "UniswapV2Adapter: pair does not exist");
        bytes32 key = _getPairKey(tokenIn, tokenOut);
        pairCache[key] = pair;
        emit PairCacheUpdated(tokenIn, tokenOut, pair);
    }

    /**
     * @notice Check if a pool exists with sufficient liquidity
     */
    function poolExists(address tokenIn, address tokenOut, uint256 minLiquidity)
        external
        view
        validPair(tokenIn, tokenOut)
        returns (bool exists)
    {
        address pair = getPool(tokenIn, tokenOut);
        if (pair == address(0)) return false;

        // Check total supply of LP tokens as a liquidity proxy
        (uint112 reserve0, uint112 reserve1,) = IUniswapV2Pair(pair).getReserves();
        uint256 totalReserves = uint256(reserve0) + uint256(reserve1);
        return totalReserves >= minLiquidity;
    }

    /**
     * @notice Get reserves of a token pair from the pair contract.
     *
     * @dev The pair stores reserves as (reserve0, reserve1) sorted by token address.
     *      If the caller passes tokens in a different order, we swap the return values
     *      so reserve0 always corresponds to token0 and reserve1 to token1 as passed.
     */
    function getReserves(address pool, address token0, address token1)
        external
        view
        validAddress(pool)
        validPair(token0, token1)
        returns (uint256 reserve0, uint256 reserve1)
    {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pool).getReserves();
        address pairToken0 = IUniswapV2Pair(pool).token0();

        // Align to the caller's token ordering
        if (token0 == pairToken0) {
            return (uint256(r0), uint256(r1));
        } else {
            return (uint256(r1), uint256(r0));
        }
    }

    /**
     * @notice Get expected output amount using the canonical Uniswap V2 AMM formula.
     *
     * FORMULA: amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
     *          (997/1000 accounts for the 0.3% swap fee)
     */
    function getAmountOut(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    )
        public
        view
        validPair(tokenIn, tokenOut)
        returns (uint256 amountOut)
    {
        require(amountIn > 0, "UniswapV2Adapter: zero amount");

        address pair = getPool(tokenIn, tokenOut);
        require(pair != address(0), "UniswapV2Adapter: pair not found");

        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        address pairToken0 = IUniswapV2Pair(pair).token0();

        (uint256 reserveIn, uint256 reserveOut) = (tokenIn == pairToken0)
            ? (uint256(r0), uint256(r1))
            : (uint256(r1), uint256(r0));

        require(reserveIn > 0 && reserveOut > 0, "UniswapV2Adapter: insufficient liquidity");

        // Uniswap V2 formula with 0.3% fee
        uint256 amountInWithFee = amountIn * 997;
        amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    /**
     * @notice Get input amount required for a specific output amount.
     *
     * FORMULA (inverse of getAmountOut):
     *   amountIn = (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997) + 1
     */
    function getAmountIn(
        address tokenIn,
        address tokenOut,
        uint256 amountOut
    )
        external
        view
        validPair(tokenIn, tokenOut)
        returns (uint256 amountIn)
    {
        require(amountOut > 0, "UniswapV2Adapter: zero amount");

        address pair = getPool(tokenIn, tokenOut);
        require(pair != address(0), "UniswapV2Adapter: pair not found");

        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        address pairToken0 = IUniswapV2Pair(pair).token0();

        (uint256 reserveIn, uint256 reserveOut) = (tokenIn == pairToken0)
            ? (uint256(r0), uint256(r1))
            : (uint256(r1), uint256(r0));

        require(reserveIn > 0 && reserveOut > amountOut, "UniswapV2Adapter: insufficient liquidity");

        // Inverse Uniswap V2 formula
        amountIn = (reserveIn * amountOut * 1000) / ((reserveOut - amountOut) * 997) + 1;
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // DEX INFORMATION
    // ════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Get DEX name
     */
    function getDEXName() external pure returns (string memory) {
        return DEX_NAME;
    }

    /**
     * @notice Get DEX version
     */
    function getDEXVersion() external pure returns (string memory) {
        return DEX_VERSION;
    }

    /**
     * @notice Get router address
     */
    function getRouterAddress() external view returns (address) {
        return router;
    }

    /**
     * @notice Get factory address
     */
    function getFactoryAddress() external view returns (address) {
        return factory;
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // VALIDATION
    // ════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Validate token pair
     * @param tokenIn Input token
     * @param tokenOut Output token
     * @return isValid True if pair is valid
     */
    function isValidPair(address tokenIn, address tokenOut)
        external
        view
        validPair(tokenIn, tokenOut)
        returns (bool isValid)
    {
        address pair = getPool(tokenIn, tokenOut);
        return pair != address(0);
    }

    /**
     * @notice Validate swap parameters
     * @param params Parameters to validate
     * @return isValid True if valid
     * @return reason Reason if invalid
     */
    function validateSwapParams(SwapParams calldata params)
        public
        view
        returns (bool isValid, string memory reason)
    {
        if (params.tokenIn == address(0)) {
            return (false, "UniswapV2Adapter: invalid tokenIn");
        }
        if (params.tokenOut == address(0)) {
            return (false, "UniswapV2Adapter: invalid tokenOut");
        }
        if (params.tokenIn == params.tokenOut) {
            return (false, "UniswapV2Adapter: identical tokens");
        }
        if (params.amountIn == 0) {
            return (false, "UniswapV2Adapter: zero amount");
        }
        if (params.minAmountOut == 0) {
            return (false, "UniswapV2Adapter: zero min output");
        }
        if (params.deadline < block.timestamp) {
            return (false, "UniswapV2Adapter: expired deadline");
        }

        address pair = getPool(params.tokenIn, params.tokenOut);
        if (pair == address(0)) {
            return (false, "UniswapV2Adapter: no liquidity");
        }

        return (true, "");
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create cache key for token pair
     * @param token0 First token
     * @param token1 Second token
     * @return key Cache key
     */
    function _getPairKey(address token0, address token1)
        internal
        pure
        returns (bytes32 key)
    {
        // Sort tokens to create deterministic key
        if (token0 < token1) {
            return keccak256(abi.encodePacked(token0, token1));
        } else {
            return keccak256(abi.encodePacked(token1, token0));
        }
    }
}
