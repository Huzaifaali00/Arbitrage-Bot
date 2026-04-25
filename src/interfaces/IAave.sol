// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/**
 * @title IPoolAddressesProvider
 * @notice Simplified Aave V3 interface
 */
interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

/**
 * @title IPool
 * @notice Simplified Aave V3 interface
 */
interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

/**
 * @title IFlashLoanSimpleReceiver
 * @notice Simplified Aave V3 interface
 */
interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);

    function ADDRESSES_PROVIDER() external view returns (address);
    function POOL() external view returns (address);
}
