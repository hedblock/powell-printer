// SPDX-License-Identifier: MIT

pragma solidity ^0.8.2;

import "./IERC20.sol";
import "./IERC20Metadata.sol";
import "./DividendDistributor.sol";
import "./Auth.sol";

import "./IDEX.sol";

contract PowellPrinter is IERC20, IERC20Metadata, Auth {

    using SafeMath for uint256;

    address public WAVAX = 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;
    address public routerAddress = 0x60aE616a2155Ee3d9A68541Ba4544862310933d4;

    string constant _name = "Powell Printer";
    string constant _symbol = "POWL";
    uint8 constant _decimals = 6;

    uint256 constant private _totalSupply = 1_000_000_000_000_000 * (10 ** _decimals);
    uint256 public _maxTxAmount = _totalSupply.div(40); // 2,5%
    uint256 public _maxWallet = _totalSupply.div(40); // 2,5%

    // addresses that are not subject to fees, tx limits, dividends, or account limits respectively
    mapping (address => bool) isFeeExempt;
    mapping (address => bool) isTxLimitExempt;
    mapping (address => bool) isDividendExempt;
    mapping (address => bool) isHoldingLimitExempt;

    mapping(address => uint256) private _balances;
    mapping(address => mapping (address => uint256)) _allowances;

    // percentage fees, will allow tweaking knobs
    uint256 public liquidityFee = 200;
    uint256 public buybackFee = 0;
    uint256 public reflectionFee = 1200;
    uint256 public marketingFee = 500;
    uint256 public totalFee = 1900;
    uint256 public feeDenominator = 10000;

    // addresses for fees
    address public autoLiquidityReceiver;
    address public marketingFeeReceiver;

    IDEXRouter public router = IDEXRouter(routerAddress);
    address public pair = IDEXFactory(router.factory()).createPair(WAVAX, address(this));

    // toggles liquidityFee, look more into this
    uint256 targetLiquidity = 10;
    uint256 targetLiquidityDenominator = 100;

    DividendDistributor public distributor;
    address public distributorAddress;

    uint256 distributorGas = 500000;

    uint256 public swapThreshold = _totalSupply / 5000000; // 200,000,000
    bool swapEnabled = true;
    bool inSwap;
    modifier swapping() { inSwap = true; _; inSwap = false; }

    constructor() Auth(msg.sender) {

        _allowances[address(this)][address(router)] = _totalSupply;

        distributor = new DividendDistributor(routerAddress);
        distributorAddress = address(distributor);

        isFeeExempt[msg.sender] = true;
        isFeeExempt[address(this)] = true;
        isTxLimitExempt[msg.sender] = true;
        isDividendExempt[pair] = true;
        isDividendExempt[address(this)] = true;

        isHoldingLimitExempt[msg.sender] = true;

        marketingFeeReceiver = msg.sender;
        autoLiquidityReceiver = msg.sender;

        approve(routerAddress, _totalSupply);
        approve(address(pair), _totalSupply);
        _balances[msg.sender] = _totalSupply;
        emit Transfer(address(0), msg.sender, _totalSupply);

    }

    // enables contract to recieve ETH
    receive() external payable { }

    // getter methods for private variables
    function name() external pure override returns (string memory) { return _name; }
    function symbol() external pure override returns (string memory) { return _symbol; }
    function decimals() external pure override returns (uint8) { return _decimals; }
    function totalSupply() external pure override returns (uint256) { return _totalSupply; }
    function getOwner() external view returns (address) { return owner; }
    function balanceOf(address account) public view override returns (uint256) { return _balances[account]; }
    function allowance(address holder, address spender) public view override returns (uint256) { return _allowances[holder][spender]; }

    // let spender spend amount from msg.sender
    function approve(address spender, uint256 amount) public override returns (bool){
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    // allow spender to spend all of msg.sender's tokens
    function approveMax(address spender) external returns (bool) {
        return approve(spender, _totalSupply);
    }

    // transfers amount from msg.sender to recipient
    function transfer(address recipient, uint256 amount) external override returns (bool) {
        return _transferFrom(msg.sender, recipient, amount);
    }

    // external function to transfer amount from sender to recipient
    function transferFrom(address sender, address recipient, uint256 amount) external override returns (bool) {
        if(allowance(sender, msg.sender) != _totalSupply){
            _allowances[sender][msg.sender] = _allowances[sender][msg.sender].sub(amount, "Insufficient Allowance");
        }
        return _transferFrom(sender, recipient, amount);
    }

    // transfer mechanic that sends amount to sender, experiencing a tax where appropriate
    function _transferFrom(address sender, address recipient, uint256 amount) internal returns (bool) {

        if(inSwap) { return _basicTransfer(sender, recipient, amount); }

        // check if the user is buying or selling tokens
        // bool isBuy = sender == pair || sender == routerAddress;
        bool isSell = recipient == pair || recipient == routerAddress;

        // ensure transaction does not exceed maximum
        _checkTxLimit(sender, amount);

        // check if user exceeds holding limit
        if (!isSell && !isHoldingLimitExempt[recipient]){
            require((_balances[recipient] + amount) < _maxWallet, "Max wallet has been triggered");
        }

        if(isSell && _shouldReflect()) {
            _reflect();
        }

        // reduce balance of sender, take fee if necessary, and increment the balance of the reciever
        _balances[sender] = _balances[sender].sub(amount, "Insufficient Balance");
        uint256 amountReceived = _shouldTakeFee(sender) ? _takeFee(amount, sender) : amount;
        _balances[recipient] = _balances[recipient].add(amountReceived);

        // set dividend distributor share for non-exempt addresses
        if(!isDividendExempt[sender]){ try distributor.setShare(sender, _balances[sender]) {} catch {} }
        if(!isDividendExempt[recipient]){ try distributor.setShare(recipient, _balances[recipient]) {} catch {} }

        // distribute to all users
        try distributor.process(distributorGas) {} catch {}

        emit Transfer(sender, recipient, amountReceived);
        return true;
    }

    // executes a transfer with no transaction fees
    function _basicTransfer(address sender, address recipient, uint256 amount) internal returns (bool) {
        _balances[sender] = _balances[sender].sub(amount, "Insufficient Balance");
        _balances[recipient] = _balances[recipient].add(amount);
        emit Transfer(sender, recipient, amount);
        return true;
    }

    // checks of a transaction exceeds the limit
    function _checkTxLimit(address sender, uint256 amount) internal view {
        require(amount <= _maxTxAmount || isTxLimitExempt[sender], "TX Limit Exceeded");
    }

    // checks whether the sender is subject to fees
    function _shouldTakeFee(address sender) internal view returns (bool) {
        return !isFeeExempt[sender];
    }

    // calculates the fee on a transaction, gives the fee to the contract, and decrements the amount by the fee amount
    function _takeFee(uint256 amount, address sender) internal returns (uint256) {
        uint256 feeAmount = amount.mul(totalFee).div(feeDenominator);
        _balances[address(this)] = _balances[address(this)].add(feeAmount);
        emit Transfer(sender, address(this), feeAmount);
        return amount.sub(feeAmount);
    }

    function _shouldReflect() internal view returns (bool) {
        return swapEnabled && msg.sender != pair && !inSwap && _balances[address(this)] >= swapThreshold;
    }

    function _reflect() internal swapping {
        uint256 balance = _balances[address(this)];
        
        uint256 dynamicLiquidityFee = isOverLiquified(targetLiquidity, targetLiquidityDenominator) ? 0 : liquidityFee;
        uint256 amountToLiquify = balance.mul(dynamicLiquidityFee).div(totalFee).div(2);
        uint256 amountToSwap = balance.sub(amountToLiquify);

        // store AVAX balance before swap
        uint256 balanceBefore = address(this).balance;

        // swap this token for avax
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = WAVAX;
        router.swapExactTokensForAVAXSupportingFeeOnTransferTokens(
            amountToSwap,
            0,
            path,
            address(this),
            block.timestamp
        );

        uint256 amountAVAX = address(this).balance.sub(balanceBefore);

        uint256 calculatedFeeDenominator = totalFee.sub(liquidityFee).add(dynamicLiquidityFee.div(2));

        uint256 amountAVAXReflection = amountAVAX.mul(reflectionFee).div(calculatedFeeDenominator);
        distributor.deposit{value: amountAVAXReflection}();

        uint256 amountAVAXMarketing = amountAVAX.mul(marketingFee).div(calculatedFeeDenominator);
        payable(marketingFeeReceiver).transfer(amountAVAXMarketing);

        uint256 amountAVAXLiquidity = amountAVAX.mul(dynamicLiquidityFee).div(2).div(calculatedFeeDenominator);

        if(amountToLiquify > 0){
            router.addLiquidityAVAX{value: amountAVAXLiquidity}(
                address(this),
                amountToLiquify,
                0,
                0,
                autoLiquidityReceiver,
                block.timestamp + 1
            );
            emit AutoLiquify(amountAVAXLiquidity, amountToLiquify);
        }
    }

    function setMaxWallet(uint256 amount) external authorized {
        require(amount >= _totalSupply / 1000);
        _maxWallet = amount;
    }

    function setTxLimit(uint256 amount) external authorized {
        require(amount >= _totalSupply / 1000);
        _maxTxAmount = amount;
    }

    // set whether an address is exempt from dividends
    function setIsDividendExempt(address holder, bool exempt) external authorized {
        require(holder != address(this) && holder != pair);
        isDividendExempt[holder] = exempt;
        if(exempt){
            distributor.setShare(holder, 0);
        } else {
            distributor.setShare(holder, _balances[holder]);
        }
    }

    // set whether an address is exempt from fees
    function setIsFeeExempt(address holder, bool exempt) external authorized {
        isFeeExempt[holder] = exempt;
    }

    // set whether an address has a transaction limit
    function setIsTxLimitExempt(address holder, bool exempt) external authorized {
        isTxLimitExempt[holder] = exempt;
    }

    // set whether a wallet is exempt from the holding limit
    function setHoldingLimitExempt(address holder, bool exempt) public authorized {
        isHoldingLimitExempt[holder] = exempt;
    }

    // check whether an address is exempt from the holding limit
    function checkHoldingLimitExempt(address holder) public view authorized returns(bool){
        return isHoldingLimitExempt[holder];
    }

    function setFees(uint256 _liquidityFee, uint256 _buybackFee, uint256 _reflectionFee, uint256 _marketingFee, uint256 _feeDenominator) external authorized {
        liquidityFee = _liquidityFee;
        buybackFee = _buybackFee;
        reflectionFee = _reflectionFee;
        marketingFee = _marketingFee;
        totalFee = _liquidityFee.add(_buybackFee).add(_reflectionFee).add(_marketingFee);
        feeDenominator = _feeDenominator;
        require(totalFee < feeDenominator/4);
    }

    function setFeeReceivers(address _autoLiquidityReceiver, address _marketingFeeReceiver) external authorized {
        autoLiquidityReceiver = _autoLiquidityReceiver;
        marketingFeeReceiver = _marketingFeeReceiver;
    }

    function setReflectSettings(bool _enabled, uint256 _amount) external authorized {
        swapEnabled = _enabled;
        swapThreshold = _amount;
    }

    function setTargetLiquidity(uint256 _target, uint256 _denominator) external authorized {
        targetLiquidity = _target;
        targetLiquidityDenominator = _denominator;
    }
    
    function setDistributionCriteria(uint256 _minPeriod, uint256 _minDistribution) external authorized {
        distributor.setDistributionCriteria(_minPeriod, _minDistribution);
    }
    
    // sets the distributor gas, ensuring it is not above 750,000
    function setDistributorSettings(uint256 gas) external authorized {
        require(gas < 750000);
        distributorGas = gas;
    }

    function getLiquidityBacking(uint256 accuracy) public view returns (uint256) {
        return accuracy.mul(balanceOf(pair).mul(2)).div(_totalSupply);
    }

    // checks if the current liquidity is
    function isOverLiquified(uint256 target, uint256 accuracy) public view returns (bool) {
        return getLiquidityBacking(accuracy) > target;
    }

    event AutoLiquify(uint256 amountAVAX, uint256 amountBOG);
}