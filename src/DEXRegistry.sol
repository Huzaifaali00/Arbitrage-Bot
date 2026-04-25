// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title DEXRegistry
 * @notice Manages registration and configuration of multiple DEX integrations
 * @dev Serves as a centralized registry for all supported DEXes and their pools
 *
 * SECURITY CONSIDERATIONS:
 * - Only owner can register/update DEXes
 * - Pool addresses must be validated before registration
 * - DEX types are immutable once registered to prevent tampering
 * - All state changes are logged for audit trail
 */
contract DEXRegistry is Ownable, ReentrancyGuard {

    // ============ Constructor ============

    /**
     * @notice Initialize DEXRegistry with owner
     * @param initialOwner Address that will be set as the initial owner
     */
    constructor(address initialOwner) Ownable(initialOwner) {}

    // ============ Type Definitions ============

    /// @notice DEX type enumeration
    enum DEXType {
        UniswapV2,      // 0
        UniswapV3,      // 1
        SushiSwap,      // 2
        Curve,          // 3
        Balancer,       // 4
        dYdX,           // 5
        Aerodrome,      // 6
        PancakeSwap,    // 7
        Quickswap,      // 8
        TraderJoe,      // 9
        CamelotDEX,     // 10
        Orca,           // 11
        Raydium         // 12
    }

    /// @notice Pool information structure
    struct PoolInfo {
        address poolAddress;
        DEXType dexType;
        address token0;
        address token1;
        uint256 fee;                    // For V3-like pools
        uint256 tvl;                    // Total Value Locked
        uint256 volume24h;              // 24h volume
        uint256 createdAt;              // Pool creation timestamp
        uint256 lastUpdated;            // Last update timestamp
        bool isActive;                  // Active status
        uint256 opportunityScore;       // 0-100 score based on TVL, volume, age
    }

    /// @notice DEX configuration structure
    struct DEXConfig {
        string name;
        DEXType dexType;
        address factoryAddress;
        address routerAddress;
        uint256 deployedAt;
        bool isActive;
        uint256 poolCount;
        uint256 lastSyncBlock;
    }

    // ============ State Variables ============

    /// @notice All registered DEXes
    mapping(DEXType => DEXConfig) public dexConfigs;

    /// @notice All pools by DEX type
    mapping(DEXType => address[]) public dexPools;

    /// @notice Pool information lookup
    mapping(address => PoolInfo) public poolInfo;

    /// @notice Approved pools for trading
    mapping(address => bool) public approvedPools;

    /// @notice Approved tokens for trading
    mapping(address => bool) public approvedTokens;

    /// @notice Tracks which DEXes are registered
    mapping(DEXType => bool) public isRegistered;

    /// @notice All DEX types that have been registered (in order)
    DEXType[] public registeredDexTypes;

    /// @notice Authorized updaters (can update pool data)
    mapping(address => bool) public isAuthorizedUpdater;

    /// @notice Circuit breaker: max pools per DEX to prevent DOS
    uint256 public constant MAX_POOLS_PER_DEX = 10000;

    /// @notice Minimum opportunity score to be considered (0-100)
    uint256 public minOpportunityScore = 30;

    /// @notice Minimum TVL threshold (in wei)
    uint256 public minTVL = 1000 ether; // ~$1000

    // ============ Events ============

    event DEXRegistered(
        DEXType indexed dexType,
        string name,
        address indexed factoryAddress,
        address indexed routerAddress
    );

    event DEXUpdated(
        DEXType indexed dexType,
        address indexed factoryAddress,
        address indexed routerAddress
    );

    event DEXDeactivated(DEXType indexed dexType);

    event PoolAdded(
        address indexed poolAddress,
        DEXType indexed dexType,
        address indexed token0,
        address token1,
        uint256 tvl,
        uint256 opportunityScore
    );

    event PoolUpdated(
        address indexed poolAddress,
        uint256 tvl,
        uint256 volume24h,
        uint256 opportunityScore
    );

    event PoolRemoved(address indexed poolAddress, DEXType indexed dexType);

    event PoolApproved(address indexed poolAddress, DEXType indexed dexType);

    event PoolRevoked(address indexed poolAddress);

    event TokenApproved(address indexed token);

    event TokenRevoked(address indexed token);

    event UpdaterAuthorizationChanged(address indexed updater, bool isAuthorized);

    event OpportunityScoreThresholdChanged(uint256 oldThreshold, uint256 newThreshold);

    event MinTVLThresholdChanged(uint256 oldThreshold, uint256 newThreshold);

    // ============ Modifiers ============

    modifier onlyAuthorizedUpdater() {
        require(isAuthorizedUpdater[msg.sender] || msg.sender == owner(),
            "DEXRegistry: not authorized to update");
        _;
    }

    modifier dexMustExist(DEXType dexType) {
        require(isRegistered[dexType], "DEXRegistry: DEX not registered");
        _;
    }

    modifier poolMustExist(address poolAddress) {
        require(poolInfo[poolAddress].poolAddress == poolAddress,
            "DEXRegistry: pool not found");
        _;
    }

    modifier validAddress(address addr) {
        require(addr != address(0), "DEXRegistry: invalid address");
        _;
    }

    // ============ Admin Functions ============

    /**
     * @notice Register a new DEX exchange
     * @param dexType The DEX type to register
     * @param name Human-readable name of the DEX
     * @param factoryAddress Factory contract address
     * @param routerAddress Router contract address
     *
     * SECURITY: Only owner can register DEXes
     */
    function registerDEX(
        DEXType dexType,
        string memory name,
        address factoryAddress,
        address routerAddress
    )
        external
        onlyOwner
        validAddress(factoryAddress)
        validAddress(routerAddress)
        nonReentrant
    {
        require(!isRegistered[dexType], "DEXRegistry: DEX already registered");
        require(bytes(name).length > 0, "DEXRegistry: invalid name");

        dexConfigs[dexType] = DEXConfig({
            name: name,
            dexType: dexType,
            factoryAddress: factoryAddress,
            routerAddress: routerAddress,
            deployedAt: block.timestamp,
            isActive: true,
            poolCount: 0,
            lastSyncBlock: block.number
        });

        isRegistered[dexType] = true;
        registeredDexTypes.push(dexType);

        emit DEXRegistered(dexType, name, factoryAddress, routerAddress);
    }

    /**
     * @notice Update DEX configuration
     * @param dexType The DEX type to update
     * @param factoryAddress New factory address
     * @param routerAddress New router address
     *
     * SECURITY: Only owner can update DEX config
     */
    function updateDEX(
        DEXType dexType,
        address factoryAddress,
        address routerAddress
    )
        external
        onlyOwner
        dexMustExist(dexType)
        validAddress(factoryAddress)
        validAddress(routerAddress)
        nonReentrant
    {
        dexConfigs[dexType].factoryAddress = factoryAddress;
        dexConfigs[dexType].routerAddress = routerAddress;
        dexConfigs[dexType].lastSyncBlock = block.number;

        emit DEXUpdated(dexType, factoryAddress, routerAddress);
    }

    /**
     * @notice Deactivate a DEX (soft delete)
     * @param dexType The DEX type to deactivate
     *
     * SECURITY: Only owner can deactivate DEXes
     */
    function deactivateDEX(DEXType dexType)
        external
        onlyOwner
        dexMustExist(dexType)
        nonReentrant
    {
        require(dexConfigs[dexType].isActive, "DEXRegistry: DEX already inactive");
        dexConfigs[dexType].isActive = false;

        emit DEXDeactivated(dexType);
    }

    /**
     * @notice Authorize an address to update pool data
     * @param updater Address to authorize
     *
     * SECURITY: Only owner can authorize updaters
     */
    function authorizeUpdater(address updater)
        external
        onlyOwner
        validAddress(updater)
        nonReentrant
    {
        require(!isAuthorizedUpdater[updater], "DEXRegistry: updater already authorized");
        isAuthorizedUpdater[updater] = true;

        emit UpdaterAuthorizationChanged(updater, true);
    }

    /**
     * @notice Revoke updater authorization
     * @param updater Address to revoke
     *
     * SECURITY: Only owner can revoke updater authorization
     */
    function revokeUpdater(address updater)
        external
        onlyOwner
        validAddress(updater)
        nonReentrant
    {
        require(isAuthorizedUpdater[updater], "DEXRegistry: updater not authorized");
        isAuthorizedUpdater[updater] = false;

        emit UpdaterAuthorizationChanged(updater, false);
    }

    /**
     * @notice Set minimum opportunity score threshold
     * @param threshold New threshold (0-100)
     */
    function setMinOpportunityScore(uint256 threshold)
        external
        onlyOwner
        nonReentrant
    {
        require(threshold <= 100, "DEXRegistry: invalid threshold");
        uint256 oldThreshold = minOpportunityScore;
        minOpportunityScore = threshold;

        emit OpportunityScoreThresholdChanged(oldThreshold, threshold);
    }

    /**
     * @notice Set minimum TVL threshold
     * @param threshold New threshold in wei
     */
    function setMinTVL(uint256 threshold)
        external
        onlyOwner
        nonReentrant
    {
        require(threshold > 0, "DEXRegistry: invalid threshold");
        uint256 oldThreshold = minTVL;
        minTVL = threshold;

        emit MinTVLThresholdChanged(oldThreshold, threshold);
    }

    // ============ Pool Management Functions ============

    /**
     * @notice Add a pool to the registry
     * @param poolAddress Pool contract address
     * @param dexType DEX type
     * @param token0 First token address
     * @param token1 Second token address
     * @param fee Fee tier (0 for non-V3 pools)
     * @param tvl Total Value Locked
     * @param volume24h 24-hour volume
     *
     * SECURITY: Only authorized updaters can add pools
     */
    function addPool(
        address poolAddress,
        DEXType dexType,
        address token0,
        address token1,
        uint256 fee,
        uint256 tvl,
        uint256 volume24h
    )
        external
        onlyAuthorizedUpdater
        dexMustExist(dexType)
        validAddress(poolAddress)
        validAddress(token0)
        validAddress(token1)
        nonReentrant
    {
        require(token0 != token1, "DEXRegistry: identical tokens");
        require(poolInfo[poolAddress].poolAddress == address(0),
            "DEXRegistry: pool already exists");
        require(dexPools[dexType].length < MAX_POOLS_PER_DEX,
            "DEXRegistry: max pools reached for DEX");
        require(tvl >= minTVL, "DEXRegistry: TVL below minimum");

        // Calculate opportunity score based on TVL, volume, and age
        uint256 opportunityScore = _calculateOpportunityScore(tvl, volume24h, block.timestamp);

        poolInfo[poolAddress] = PoolInfo({
            poolAddress: poolAddress,
            dexType: dexType,
            token0: token0,
            token1: token1,
            fee: fee,
            tvl: tvl,
            volume24h: volume24h,
            createdAt: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true,
            opportunityScore: opportunityScore
        });

        dexPools[dexType].push(poolAddress);
        dexConfigs[dexType].poolCount++;

        emit PoolAdded(poolAddress, dexType, token0, token1, tvl, opportunityScore);
    }

    /**
     * @notice Update pool metrics
     * @param poolAddress Pool address to update
     * @param tvl New TVL
     * @param volume24h New 24h volume
     *
     * SECURITY: Only authorized updaters can update pools
     */
    function updatePool(
        address poolAddress,
        uint256 tvl,
        uint256 volume24h
    )
        external
        onlyAuthorizedUpdater
        poolMustExist(poolAddress)
        nonReentrant
    {
        PoolInfo storage pool = poolInfo[poolAddress];

        // Update metrics
        pool.tvl = tvl;
        pool.volume24h = volume24h;
        pool.lastUpdated = block.timestamp;

        // Recalculate opportunity score using the pool's actual creation time
        pool.opportunityScore = _calculateOpportunityScore(tvl, volume24h, pool.createdAt);

        // Deactivate if TVL drops below threshold
        if (tvl < minTVL) {
            pool.isActive = false;
        } else if (!pool.isActive) {
            pool.isActive = true;
        }

        emit PoolUpdated(poolAddress, tvl, volume24h, pool.opportunityScore);
    }

    /**
     * @notice Remove a pool from the registry
     * @param poolAddress Pool to remove
     *
     * SECURITY: Only owner can remove pools
     */
    function removePool(address poolAddress)
        external
        onlyOwner
        poolMustExist(poolAddress)
        nonReentrant
    {
        PoolInfo memory pool = poolInfo[poolAddress];
        DEXType dexType = pool.dexType;

        // Remove from dexPools array
        address[] storage pools = dexPools[dexType];
        for (uint256 i = 0; i < pools.length; i++) {
            if (pools[i] == poolAddress) {
                pools[i] = pools[pools.length - 1];
                pools.pop();
                break;
            }
        }

        dexConfigs[dexType].poolCount--;

        // Remove from approvals if needed
        if (approvedPools[poolAddress]) {
            approvedPools[poolAddress] = false;
        }

        delete poolInfo[poolAddress];

        emit PoolRemoved(poolAddress, dexType);
    }

    /**
     * @notice Approve a pool for trading
     * @param poolAddress Pool to approve
     *
     * SECURITY: Only owner can approve pools
     */
    function approvePool(address poolAddress)
        external
        onlyOwner
        poolMustExist(poolAddress)
        nonReentrant
    {
        require(!approvedPools[poolAddress], "DEXRegistry: pool already approved");
        require(poolInfo[poolAddress].isActive, "DEXRegistry: pool is inactive");
        require(poolInfo[poolAddress].opportunityScore >= minOpportunityScore,
            "DEXRegistry: pool opportunity score too low");

        approvedPools[poolAddress] = true;

        emit PoolApproved(poolAddress, poolInfo[poolAddress].dexType);
    }

    /**
     * @notice Revoke pool approval
     * @param poolAddress Pool to revoke
     *
     * SECURITY: Only owner can revoke pool approval
     */
    function revokePool(address poolAddress)
        external
        onlyOwner
        poolMustExist(poolAddress)
        nonReentrant
    {
        require(approvedPools[poolAddress], "DEXRegistry: pool not approved");
        approvedPools[poolAddress] = false;

        emit PoolRevoked(poolAddress);
    }

    /**
     * @notice Approve a token for trading
     * @param token Token to approve
     *
     * SECURITY: Only owner can approve tokens
     */
    function approveToken(address token)
        external
        onlyOwner
        validAddress(token)
        nonReentrant
    {
        require(!approvedTokens[token], "DEXRegistry: token already approved");
        approvedTokens[token] = true;

        emit TokenApproved(token);
    }

    /**
     * @notice Revoke token approval
     * @param token Token to revoke
     *
     * SECURITY: Only owner can revoke token approval
     */
    function revokeToken(address token)
        external
        onlyOwner
        validAddress(token)
        nonReentrant
    {
        require(approvedTokens[token], "DEXRegistry: token not approved");
        approvedTokens[token] = false;

        emit TokenRevoked(token);
    }

    // ============ View Functions ============

    /**
     * @notice Get DEX configuration
     * @param dexType DEX type to query
     */
    function getDEXConfig(DEXType dexType)
        external
        view
        dexMustExist(dexType)
        returns (DEXConfig memory)
    {
        return dexConfigs[dexType];
    }

    /**
     * @notice Get pool information
     * @param poolAddress Pool to query
     */
    function getPoolInfo(address poolAddress)
        external
        view
        poolMustExist(poolAddress)
        returns (PoolInfo memory)
    {
        return poolInfo[poolAddress];
    }

    /**
     * @notice Get all pools for a DEX
     * @param dexType DEX type
     */
    function getDEXPools(DEXType dexType)
        external
        view
        dexMustExist(dexType)
        returns (address[] memory)
    {
        return dexPools[dexType];
    }

    /**
     * @notice Get count of pools for a DEX
     * @param dexType DEX type
     */
    function getDEXPoolCount(DEXType dexType)
        external
        view
        dexMustExist(dexType)
        returns (uint256)
    {
        return dexPools[dexType].length;
    }

    /**
     * @notice Get all registered DEXes
     */
    function getRegisteredDEXes()
        external
        view
        returns (DEXType[] memory)
    {
        return registeredDexTypes;
    }

    /**
     * @notice Get total number of registered DEXes
     */
    function getRegisteredDEXCount()
        external
        view
        returns (uint256)
    {
        return registeredDexTypes.length;
    }

    /**
     * @notice Check if a pool is approved for trading
     * @param poolAddress Pool to check
     */
    function isPoolApproved(address poolAddress)
        external
        view
        returns (bool)
    {
        return approvedPools[poolAddress];
    }

    /**
     * @notice Check if a token is approved for trading
     * @param token Token to check
     */
    function isTokenApproved(address token)
        external
        view
        returns (bool)
    {
        return approvedTokens[token];
    }

    /**
     * @notice Get high-opportunity pools across all DEXes
     * @return Array of pools with opportunity score >= minOpportunityScore
     *
     * IMPORTANT: This is a view function used by backend for discovery
     */
    function getHighOpportunityPools()
        external
        view
        returns (address[] memory)
    {
        // Count high-opportunity pools first
        uint256 count = 0;
        for (uint256 i = 0; i < registeredDexTypes.length; i++) {
            address[] memory pools = dexPools[registeredDexTypes[i]];
            for (uint256 j = 0; j < pools.length; j++) {
                if (poolInfo[pools[j]].opportunityScore >= minOpportunityScore &&
                    poolInfo[pools[j]].isActive) {
                    count++;
                }
            }
        }

        // Build result array
        address[] memory result = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < registeredDexTypes.length; i++) {
            address[] memory pools = dexPools[registeredDexTypes[i]];
            for (uint256 j = 0; j < pools.length; j++) {
                if (poolInfo[pools[j]].opportunityScore >= minOpportunityScore &&
                    poolInfo[pools[j]].isActive) {
                    result[idx] = pools[j];
                    idx++;
                }
            }
        }

        return result;
    }

    /**
     * @notice Get total TVL across all pools
     */
    function getTotalTVL()
        external
        view
        returns (uint256 totalTVL)
    {
        for (uint256 i = 0; i < registeredDexTypes.length; i++) {
            address[] memory pools = dexPools[registeredDexTypes[i]];
            for (uint256 j = 0; j < pools.length; j++) {
                if (poolInfo[pools[j]].isActive) {
                    totalTVL += poolInfo[pools[j]].tvl;
                }
            }
        }
    }

    // ============ Internal Functions ============

    /**
     * @notice Calculate opportunity score based on TVL, volume, and age
     * @dev Score formula: (TVL_weight + Volume_weight + Age_weight) / 3
     * @param tvl Total Value Locked
     * @param volume24h 24-hour volume
     * @param createdAt Unix timestamp when pool was created
     * @return score Opportunity score (0-100)
     *
     * SCORING LOGIC:
     * - Higher TVL = higher score (more liquidity = better arb opportunities)
     * - Higher 24h volume = higher score (more activity = more mispricing)
     * - Newer pools = higher score (new pools have pricing inefficiencies)
     */
    function _calculateOpportunityScore(uint256 tvl, uint256 volume24h, uint256 createdAt)
        internal
        view
        returns (uint256)
    {
        // Normalize TVL to 0-100 scale (max 1M ETH = 100)
        uint256 maxTVL = 1000000 ether;
        uint256 tvlScore = tvl >= maxTVL ? 100 : (tvl * 100) / maxTVL;

        // Normalize volume to 0-100 scale (max 10M ETH = 100)
        uint256 maxVolume = 10000000 ether;
        uint256 volumeScore = volume24h >= maxVolume ? 100 : (volume24h * 100) / maxVolume;

        // Age score: newer pools get a bonus (more likely to have mispricing)
        // createdAt = 0 means unknown age → treat as established pool (score 60)
        uint256 ageScore;
        if (createdAt == 0 || block.timestamp <= createdAt) {
            ageScore = 60; // Unknown or future timestamp — treat as established
        } else {
            uint256 ageInDays = (block.timestamp - createdAt) / 1 days;
            ageScore = ageInDays < 7 ? 100 : (ageInDays < 30 ? 80 : 60);
        }

        // Weighted average: TVL(40%) + Volume(40%) + Age(20%)
        uint256 score = (tvlScore * 40 + volumeScore * 40 + ageScore * 20) / 100;

        return score > 100 ? 100 : score;
    }
}
