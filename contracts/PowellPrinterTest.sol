// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./PowellPrinter_2.sol";

contract PowellPrinterTest is PowellPrinterRevise {
    constructor() PowellPrinterRevise() {}

    function shouldReflect() public view returns (bool) {
        return _shouldReflect();
    }

    function reflect() public {
        return _reflect();
    }
}
