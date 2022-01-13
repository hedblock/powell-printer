// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./PowellPrinter.sol";

contract PowellPrinterTest is PowellPrinter {
    constructor() PowellPrinter() {}

    function shouldReflect() public view returns (bool) {
        return _shouldReflect();
    }

    function reflect() public {
        return _reflect();
    }

    function getFees() public view returns (
        uint256 liquidityFeeA,
        uint256 buybackFeeA,
        uint256 reflectionFeeA,
        uint256 marketingFeeA,
        uint256 totalFeeA,
        uint256 feeDenominatorA
    ) {
        liquidityFeeA = liquidityFee;
        buybackFeeA = buybackFee;
        reflectionFeeA = reflectionFee;
        marketingFeeA = marketingFee;
        totalFeeA = totalFee;
        feeDenominatorA = feeDenominator;
    }
}
