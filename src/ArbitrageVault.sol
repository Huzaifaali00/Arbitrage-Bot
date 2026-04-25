// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ArbitrageVault
 * @notice Multi-user profit-sharing vault for the MEV arbitrage SaaS platform.
 */
contract ArbitrageVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════

    uint256 private constant PRECISION = 1e18;

    uint256 public constant MIN_DEPOSIT             = 0.005 ether;   
    uint256 public constant MAX_DEPOSIT_PER_USER    = 50 ether;      
    uint256 public constant MIN_PERFORMANCE_FEE_BPS = 1500;          
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2500;          
    uint256 public constant DAILY_WITHDRAW_LIMIT_BPS = 2500;         
    uint256 public constant TIMELOCK_DURATION       = 24 hours;
    uint256 public constant MAX_USERS               = 10_000;
    uint256 public constant RECOVERY_DELAY          = 7 days;

    uint256 public withdrawalDelay = 12 hours;
    uint256 public unfreezeDelay   = 3 days;

    // ═══════════════════════════════════════════════════════════════════
    // STORAGE
    // ═══════════════════════════════════════════════════════════════════

    uint256 public accProfitPerUnit;

    struct WithdrawalRequest {
        uint256 profitAmount;
        uint256 principalAmount;
        uint256 requestedAt;
        bool    isActive;
    }

    struct UserAccount {
        uint256 principal;        
        uint256 profitDebt;       
        uint256 pendingProfit;    
        uint256 totalDeposited;   
        uint256 totalWithdrawn;   
        bool    isPaused;         
        uint256 pauseBlock;       
        uint256 lastWithdrawTime; 
        uint256 withdrawn24h;     
        
        // Security Features
        address guardian;
        bool    isFrozen;
        uint256 unfreezeInitiatedAt;
        WithdrawalRequest pendingRequest;
        
        // Recovery Features
        address recoveryNewOwner;
        uint256 recoveryAvailableAt;
    }

    mapping(address => UserAccount) public accounts;

    uint256 public totalActivePrincipal;   
    uint256 public totalPausedPrincipal;   
    uint256 public totalUserCount;         
    IERC20  public profitToken;           

    uint256 public performanceFeeBps = 1500;   
    address payable public operatorAddress;
    uint256 public pendingOperatorFees;        

    uint256 public totalProfitDistributed;
    uint256 public totalFeesAccrued;

    mapping(address => bool) public isExecutor;

    struct TimelockAction {
        uint256 proposedAt;
        bool    executed;
    }
    mapping(bytes32 => TimelockAction) public timelockActions;

    // ═══════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════

    event Deposited(address indexed user, uint256 amount, uint256 newPrincipal);
    event Withdrawn(address indexed user, uint256 profitAmount, uint256 principalAmount, uint256 total);
    event ProfitDistributed(uint256 grossProfit, uint256 operatorFee, uint256 netToUsers, uint256 newAccProfitPerUnit);
    event OperatorFeesClaimed(address indexed operator, uint256 amount);
    event FundsPaused(address indexed user, uint256 principal);
    event FundsUnpaused(address indexed user, uint256 principal);
    event ExecutorAuthorized(address indexed executor);
    event ExecutorRevoked(address indexed executor);
    event PerformanceFeeProposed(uint256 newFeeBps, uint256 readyAt);
    event PerformanceFeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event OperatorAddressProposed(address newOperator, uint256 readyAt);
    event OperatorAddressUpdated(address oldOperator, address newOperator);
    event EmergencyWithdrawProposed(bytes32 proposalId, address to, uint256 amount, uint256 readyAt);
    event EmergencyWithdrawalExecuted(address to, uint256 amount);

    // Objective 6 Events
    event WithdrawalRequested(address indexed user, uint256 profit, uint256 principal, uint256 executeAt);
    event WithdrawalCancelled(address indexed user);
    event AccountFrozen(address indexed user, address indexed by);
    event UnfreezeInitiated(address indexed user, uint256 availableAt);
    event AccountUnfrozen(address indexed user);
    event GuardianSet(address indexed user, address indexed guardian);
    event RecoveryNominated(address indexed user, address indexed newOwner, uint256 availableAt);
    event RecoveryExecuted(address indexed oldUser, address indexed newUser);
    event RecoveryCancelled(address indexed user);
    event SecurityConfigUpdated(string parameter, uint256 newValue);

    // ═══════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════

    modifier onlyExecutor() {
        require(isExecutor[msg.sender] || msg.sender == owner(), "Vault: not executor");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════

    constructor(address initialOwner, uint256 _performanceFeeBps, address _profitToken) Ownable(initialOwner) {
        require(_performanceFeeBps >= MIN_PERFORMANCE_FEE_BPS, "Vault: fee below minimum");
        require(_performanceFeeBps <= MAX_PERFORMANCE_FEE_BPS, "Vault: fee above maximum");
        require(initialOwner != address(0), "Vault: zero owner");
        require(_profitToken != address(0), "Vault: zero profit token");

        performanceFeeBps = _performanceFeeBps;
        operatorAddress = payable(initialOwner);
        profitToken = IERC20(_profitToken);
    }

    // ═══════════════════════════════════════════════════════════════════
    // USER ACTIONS
    // ═══════════════════════════════════════════════════════════════════

    function deposit() external payable nonReentrant {
        require(!accounts[msg.sender].isFrozen, "Vault: account frozen");
        require(msg.value >= MIN_DEPOSIT, "Vault: deposit below minimum");
        require(accounts[msg.sender].principal + msg.value <= MAX_DEPOSIT_PER_USER, "Vault: exceeds per-user maximum");

        if (accounts[msg.sender].principal == 0 && accounts[msg.sender].pendingProfit == 0) {
            uint256 claimable = _calculateClaimableProfit(msg.sender);
            if (claimable == 0) {
                require(totalUserCount < MAX_USERS, "Vault: max users reached");
                totalUserCount++;
            }
        }

        _settlePendingProfit(msg.sender);

        accounts[msg.sender].principal += msg.value;
        accounts[msg.sender].totalDeposited += msg.value;
        totalActivePrincipal += msg.value;

        accounts[msg.sender].profitDebt = (accounts[msg.sender].principal * accProfitPerUnit) / PRECISION;

        emit Deposited(msg.sender, msg.value, accounts[msg.sender].principal);
    }

    function withdraw(uint256 profitAmount, uint256 principalAmount) external {
        requestWithdrawal(profitAmount, principalAmount);
    }

    function withdrawAll() external {
        UserAccount storage acc = accounts[msg.sender];
        _settlePendingProfit(msg.sender);
        requestWithdrawal(acc.pendingProfit, acc.principal);
    }

    /**
     * @notice User pauses their funds (stops being used for trading).
     */
    function pauseMyFunds() external nonReentrant {
        UserAccount storage user = accounts[msg.sender];
        require(!user.isFrozen, "Vault: account frozen");
        require(user.principal > 0, "Vault: no funds");
        require(!user.isPaused, "Vault: already paused");

        _settlePendingProfit(msg.sender);
        
        user.isPaused = true;
        user.pauseBlock = block.timestamp;
        
        totalActivePrincipal -= user.principal;
        totalPausedPrincipal += user.principal;
        
        emit FundsPaused(msg.sender, user.principal);
    }

    /**
     * @notice User resumes their funds.
     */
    function unpauseMyFunds() external nonReentrant {
        UserAccount storage user = accounts[msg.sender];
        require(!user.isFrozen, "Vault: account frozen");
        require(user.isPaused, "Vault: not paused");

        _settlePendingProfit(msg.sender);
        
        user.isPaused = false;
        totalActivePrincipal += user.principal;
        totalPausedPrincipal -= user.principal;
        
        emit FundsUnpaused(msg.sender, user.principal);
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECURITY ACTIONS (OBJECTIVE 6)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Step 1 of Withdrawal: Request tokens. Starts a delay.
     */
    function requestWithdrawal(uint256 profitAmount, uint256 principalAmount) public nonReentrant {
        UserAccount storage acc = accounts[msg.sender];
        require(!acc.isFrozen, "Vault: account frozen");
        require(profitAmount + principalAmount > 0, "Vault: nothing to withdraw");

        _settlePendingProfit(msg.sender);

        if (profitAmount > 0) require(profitAmount <= acc.pendingProfit, "Vault: insufficient profit");
        if (principalAmount > 0) require(principalAmount <= acc.principal, "Vault: insufficient principal");

        acc.pendingRequest = WithdrawalRequest({
            profitAmount: profitAmount,
            principalAmount: principalAmount,
            requestedAt: block.timestamp,
            isActive: true
        });

        emit WithdrawalRequested(msg.sender, profitAmount, principalAmount, block.timestamp + withdrawalDelay);
    }

    /**
     * @notice Step 2 of Withdrawal: Execute after delay.
     */
    function executeWithdrawal() external nonReentrant {
        UserAccount storage acc = accounts[msg.sender];
        require(!acc.isFrozen, "Vault: account frozen");
        require(acc.pendingRequest.isActive, "Vault: no pending request");
        require(block.timestamp >= acc.pendingRequest.requestedAt + withdrawalDelay, "Vault: delay active");

        uint256 profit    = acc.pendingRequest.profitAmount;
        uint256 principal = acc.pendingRequest.principalAmount;

        acc.pendingRequest.isActive = false;

        _executeWithdrawal(msg.sender, profit, principal);
    }

    /**
     * @notice Cancel a pending withdrawal request.
     */
    function cancelWithdrawal() external {
        UserAccount storage acc = accounts[msg.sender];
        require(acc.pendingRequest.isActive, "Vault: no request");
        acc.pendingRequest.isActive = false;
        emit WithdrawalCancelled(msg.sender);
    }

    /**
     * @notice Set or change account guardian.
     */
    function setGuardian(address _guardian) external {
        require(_guardian != address(0), "Vault: zero address");
        require(_guardian != msg.sender, "Vault: cannot be own guardian");
        accounts[msg.sender].guardian = _guardian;
        emit GuardianSet(msg.sender, _guardian);
    }

    /**
     * @notice Immediately freeze account to stop withdrawals.
     */
    function freezeAccount(address user) external {
        UserAccount storage acc = accounts[user];
        require(msg.sender == user || msg.sender == acc.guardian, "Vault: unauthorized");
        require(!acc.isFrozen, "Vault: already frozen");

        acc.isFrozen = true;
        acc.pendingRequest.isActive = false; // Emergency cancel any pending

        emit AccountFrozen(user, msg.sender);
    }

    /**
     * @notice Start the cooling off period for unfreezing.
     */
    function initiateUnfreeze() external {
        UserAccount storage acc = accounts[msg.sender];
        require(acc.isFrozen, "Vault: not frozen");
        acc.unfreezeInitiatedAt = block.timestamp;
        emit UnfreezeInitiated(msg.sender, block.timestamp + unfreezeDelay);
    }

    /**
     * @notice Complete unfreezing after delay.
     */
    function completeUnfreeze() external {
        UserAccount storage acc = accounts[msg.sender];
        require(acc.isFrozen, "Vault: not frozen");
        require(acc.unfreezeInitiatedAt > 0, "Vault: not initiated");
        require(block.timestamp >= acc.unfreezeInitiatedAt + unfreezeDelay, "Vault: delay active");

        acc.isFrozen = false;
        acc.unfreezeInitiatedAt = 0;
        emit AccountUnfrozen(msg.sender);
    }

    /**
     * @notice Guardian nominates a new address for the user (Recovery).
     */
    function nominateNewOwner(address user, address newOwner) external {
        UserAccount storage acc = accounts[user];
        require(msg.sender == acc.guardian, "Vault: only guardian");
        require(newOwner != address(0), "Vault: zero address");
        require(accounts[newOwner].principal == 0 && accounts[newOwner].pendingProfit == 0, "Vault: target has assets");

        acc.recoveryNewOwner = newOwner;
        acc.recoveryAvailableAt = block.timestamp + RECOVERY_DELAY;

        emit RecoveryNominated(user, newOwner, acc.recoveryAvailableAt);
    }

    /**
     * @notice Guardian finalizes account recovery.
     */
    function completeRecovery(address user) external {
        UserAccount storage acc = accounts[user];
        require(msg.sender == acc.guardian, "Vault: only guardian");
        require(acc.recoveryNewOwner != address(0), "Vault: no nomination");
        require(block.timestamp >= acc.recoveryAvailableAt, "Vault: delay active");

        address newAccount = acc.recoveryNewOwner;

        // Transfer all account state
        accounts[newAccount] = accounts[user];

        // Clear recovery state on the new account so the guardian cannot immediately
        // call completeRecovery(newAccount) — which would copy the account to itself
        // and then delete it, draining all funds.
        accounts[newAccount].recoveryNewOwner = address(0);
        accounts[newAccount].recoveryAvailableAt = 0;

        delete accounts[user];

        emit RecoveryExecuted(user, newAccount);
    }

    /**
     * @notice User cancels a bogus recovery attempt.
     */
    function cancelRecovery() external {
        UserAccount storage acc = accounts[msg.sender];
        require(acc.recoveryNewOwner != address(0), "Vault: no nomination");
        acc.recoveryNewOwner = address(0);
        acc.recoveryAvailableAt = 0;
        emit RecoveryCancelled(msg.sender);
    }

    /**
     * @notice Update security parameters (Owner only).
     */
    function setSecurityConfig(uint256 _withdrawalDelay, uint256 _unfreezeDelay) external onlyOwner {
        require(_withdrawalDelay >= 1 hours && _withdrawalDelay <= 7 days, "Vault: invalid delay");
        require(_unfreezeDelay >= 1 days && _unfreezeDelay <= 30 days, "Vault: invalid delay");
        
        withdrawalDelay = _withdrawalDelay;
        unfreezeDelay = _unfreezeDelay;
        
        emit SecurityConfigUpdated("withdrawalDelay", _withdrawalDelay);
        emit SecurityConfigUpdated("unfreezeDelay", _unfreezeDelay);
    }

    function _executeWithdrawal(address user, uint256 profitAmount, uint256 principalAmount) internal {
        UserAccount storage acc = accounts[user];
        _settlePendingProfit(user);

        // Final double check
        require(profitAmount <= acc.pendingProfit, "Vault: insufficient profit");
        require(principalAmount <= acc.principal, "Vault: insufficient principal");

        if (profitAmount > 0) {
            acc.pendingProfit -= profitAmount;
            profitToken.safeTransfer(user, profitAmount);
        }

        if (principalAmount > 0) {
            _checkAndUpdateRateLimit(user, principalAmount);
            if (!acc.isPaused) {
                totalActivePrincipal -= principalAmount;
            } else {
                totalPausedPrincipal -= principalAmount;
            }

            acc.principal -= principalAmount;

            if (acc.principal > 0) {
                acc.profitDebt = (acc.principal * accProfitPerUnit) / PRECISION;
            } else {
                acc.profitDebt = 0;
                acc.isPaused   = false;
            }

            (bool ok, ) = payable(user).call{value: principalAmount}("");
            require(ok, "Vault: ETH transfer failed");
        }

        acc.totalWithdrawn += (profitAmount + principalAmount);

        if (acc.principal == 0 && acc.pendingProfit == 0) {
            uint256 currentClaimable = _calculateClaimableProfit(user);
            if (currentClaimable == 0 && totalUserCount > 0) {
                totalUserCount--;
            }
        }

        emit Withdrawn(user, profitAmount, principalAmount, profitAmount + principalAmount);
    }

    // ═══════════════════════════════════════════════════════════════════
    // BOT ACTIONS
    // ═══════════════════════════════════════════════════════════════════

    function distributeProfit(uint256 profitTotal)
        external
        onlyExecutor
        nonReentrant
    {
        require(profitTotal > 0, "Vault: zero profit");
        require(totalActivePrincipal > 0, "Vault: no active principal");

        // Pull the profit from the executor
        profitToken.safeTransferFrom(msg.sender, address(this), profitTotal);

        uint256 operatorFee = (profitTotal * performanceFeeBps) / 10_000;
        uint256 netProfit   = profitTotal - operatorFee;

        accProfitPerUnit += (netProfit * PRECISION) / totalActivePrincipal;

        pendingOperatorFees   += operatorFee;
        totalProfitDistributed += profitTotal;
        totalFeesAccrued       += operatorFee;

        emit ProfitDistributed(profitTotal, operatorFee, netProfit, accProfitPerUnit);
    }

    function claimOperatorFees() external nonReentrant {
        require(msg.sender == operatorAddress, "Vault: not operator");
        uint256 amount = pendingOperatorFees;
        require(amount > 0, "Vault: no fees");

        pendingOperatorFees = 0;
        profitToken.safeTransfer(operatorAddress, amount);

        emit OperatorFeesClaimed(operatorAddress, amount);
    }

    // ═══════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    function getMyAccount() external view returns (
        uint256 principal, uint256 pendingProfit, uint256 claimableProfit,
        uint256 totalBalance, bool isPaused, uint256 totalDeposited, uint256 totalWithdrawn,
        uint256 reqProfit, uint256 reqPrincipal, uint256 reqTimestamp, bool reqActive,
        bool isFrozen, address guardian
    ) {
        UserAccount storage acc = accounts[msg.sender];
        uint256 claimable = _calculateClaimableProfit(msg.sender);
        return (
            acc.principal, acc.pendingProfit, claimable,
            acc.principal + acc.pendingProfit + claimable, acc.isPaused,
            acc.totalDeposited, acc.totalWithdrawn,
            acc.pendingRequest.profitAmount, acc.pendingRequest.principalAmount, 
            acc.pendingRequest.requestedAt, acc.pendingRequest.isActive,
            acc.isFrozen, acc.guardian
        );
    }

    function getUserAccount(address user) external view returns (
        uint256 principal, uint256 pendingProfit, uint256 claimableProfit, bool isPaused
    ) {
        return (
            accounts[user].principal, accounts[user].pendingProfit,
            _calculateClaimableProfit(user), accounts[user].isPaused
        );
    }

    function getVaultStats() external view returns (
        uint256 _activePrincipal, uint256 _pausedPrincipal, uint256 _userCount,
        uint256 _lifeProfit, uint256 _lifeFees, uint256 _feeBps, uint256 _balance, uint256 _pendingFees
    ) {
        return (
            totalActivePrincipal, totalPausedPrincipal, totalUserCount,
            totalProfitDistributed, totalFeesAccrued, performanceFeeBps,
            profitToken.balanceOf(address(this)), pendingOperatorFees
        );
    }

    // ═══════════════════════════════════════════════════════════════════
    // ADMIN ACTIONS
    // ═══════════════════════════════════════════════════════════════════

    function authorizeExecutor(address executor) external onlyOwner {
        require(executor != address(0), "Vault: zero address");
        isExecutor[executor] = true;
        emit ExecutorAuthorized(executor);
    }

    function revokeExecutor(address executor) external onlyOwner {
        isExecutor[executor] = false;
        emit ExecutorRevoked(executor);
    }

    /**
     * @notice Propose a new performance fee (timelocked 24h).
     * @param newFeeBps New fee in basis points (1500–2500).
     */
    function proposeSetPerformanceFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps >= MIN_PERFORMANCE_FEE_BPS, "Vault: fee below minimum");
        require(newFeeBps <= MAX_PERFORMANCE_FEE_BPS, "Vault: fee above maximum");
        bytes32 id = keccak256(abi.encode("setPerformanceFee", newFeeBps));
        _propose(id);
        emit PerformanceFeeProposed(newFeeBps, block.timestamp + TIMELOCK_DURATION);
    }

    /**
     * @notice Execute a previously proposed performance fee change.
     * @param newFeeBps Must match the value passed to proposeSetPerformanceFee.
     */
    function executeSetPerformanceFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps >= MIN_PERFORMANCE_FEE_BPS, "Vault: fee below minimum");
        require(newFeeBps <= MAX_PERFORMANCE_FEE_BPS, "Vault: fee above maximum");
        bytes32 id = keccak256(abi.encode("setPerformanceFee", newFeeBps));
        _consumeTimelock(id);
        uint256 old = performanceFeeBps;
        performanceFeeBps = newFeeBps;
        emit PerformanceFeeUpdated(old, newFeeBps);
    }

    /**
     * @notice Propose an emergency withdrawal of profit tokens (timelocked 24h).
     * @dev Gives users 24h to see the proposal and exit before execution.
     * @param to Destination address.
     * @param amount Amount of profitToken to withdraw.
     */
    function proposeEmergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Vault: zero address");
        require(amount > 0, "Vault: zero amount");
        bytes32 id = keccak256(abi.encode("emergencyWithdraw", to, amount));
        _propose(id);
        emit EmergencyWithdrawProposed(id, to, amount, block.timestamp + TIMELOCK_DURATION);
    }

    /**
     * @notice Execute a previously proposed emergency withdrawal.
     * @param to Must match the value passed to proposeEmergencyWithdraw.
     * @param amount Must match the value passed to proposeEmergencyWithdraw.
     */
    function executeEmergencyWithdraw(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Vault: zero address");
        require(amount > 0, "Vault: zero amount");
        bytes32 id = keccak256(abi.encode("emergencyWithdraw", to, amount));
        _consumeTimelock(id);
        require(profitToken.balanceOf(address(this)) >= amount, "Vault: insufficient balance");
        profitToken.safeTransfer(to, amount);
        emit EmergencyWithdrawalExecuted(to, amount);
    }

    function proposeSetOperatorAddress(address newOperator) external onlyOwner {
        require(newOperator != address(0), "Vault: zero address");
        bytes32 id = keccak256(abi.encode("setOperatorAddress", newOperator));
        _propose(id);
        emit OperatorAddressProposed(newOperator, block.timestamp + TIMELOCK_DURATION);
    }

    function executeSetOperatorAddress(address newOperator) external onlyOwner {
        bytes32 id = keccak256(abi.encode("setOperatorAddress", newOperator));
        _consumeTimelock(id);
        address old = operatorAddress;
        operatorAddress = payable(newOperator);
        emit OperatorAddressUpdated(old, newOperator);
    }

    // ═══════════════════════════════════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════════════════════════════════

    function _settlePendingProfit(address user) internal {
        uint256 claimable = _calculateClaimableProfit(user);
        if (claimable > 0) { accounts[user].pendingProfit += claimable; }
        accounts[user].profitDebt = (accounts[user].principal * accProfitPerUnit) / PRECISION;
    }

    function _calculateClaimableProfit(address user) internal view returns (uint256) {
        UserAccount storage acc = accounts[user];
        if (acc.isPaused || acc.principal == 0) return 0;
        uint256 accumulated = (acc.principal * accProfitPerUnit) / PRECISION;
        return accumulated > acc.profitDebt ? accumulated - acc.profitDebt : 0;
    }

    function _checkAndUpdateRateLimit(address user, uint256 principalAmount) internal {
        UserAccount storage acc = accounts[user];
        if (acc.lastWithdrawTime == 0 || block.timestamp >= acc.lastWithdrawTime + 24 hours) {
            acc.withdrawn24h = 0; acc.lastWithdrawTime = block.timestamp;
        }
        if (acc.principal > 0) {
            uint256 dailyLimit = (acc.principal * DAILY_WITHDRAW_LIMIT_BPS) / 10_000;
            require(acc.withdrawn24h + principalAmount <= dailyLimit, "Vault: daily withdrawal limit exceeded");
        }
        acc.withdrawn24h += principalAmount;
    }

    function _propose(bytes32 id) internal {
        require(timelockActions[id].proposedAt == 0, "Vault: already proposed");
        timelockActions[id] = TimelockAction({ proposedAt: block.timestamp, executed: false });
    }

    function _consumeTimelock(bytes32 id) internal {
        TimelockAction storage action = timelockActions[id];
        require(action.proposedAt > 0, "Vault: not proposed");
        require(!action.executed, "Vault: already executed");
        require(block.timestamp >= action.proposedAt + TIMELOCK_DURATION, "Vault: timelock active");
        action.executed = true;
    }

    receive() external payable {
        revert("Vault: use deposit() or distributeProfit()");
    }
}
