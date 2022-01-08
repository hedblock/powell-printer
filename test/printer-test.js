const PowellPrinter = artifacts.require("PowellPrinterTest");
const Distributor = artifacts.require('DividendDistributor');
const JoeRouter = artifacts.require('IDEXRouter');

const dotenv = require("dotenv");
dotenv.config();
const AVALANCHE_NODE_URL = process.env.AVALANCHE_MAINNET_URL;
const WAVAX_ADDRESS = process.env.WAVAX_ADDRESS;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const USDC_ADDRESS = process.env.USDC_ADDRESS;

const chai = require("chai");

const BN = web3.utils.BN;
const chaiBN = require('chai-bn')(BN);
chai.use(chaiBN);

const chaiAsPromised = require("chai-as-promised");
const {bnCloseTo} = require("./utils");
chai.use(chaiAsPromised);

const expect = chai.expect;

const {shouldThrow} = require("./utils");

contract("PowellPrinter", accounts => {

  let printer;
  let feePercentage;
  let totalSupply;
  let [owner, account1, account2] = accounts;

  before(async () => {
    printer = await PowellPrinter.new();
    feePercentage = (await printer.totalFee()) / (await printer.feeDenominator());
    totalSupply = (await printer.totalSupply());
  })

  beforeEach(async function () {
    printer = await PowellPrinter.new();
  });

  xcontext("approve and allowance", async () => {
    it("approve sets spender's allowance of msg.sender's tokens", async () => {
      await printer.approve(account2, 100, {from: account1});
      expect(printer.allowance(account1, account2)).to.be.bignumber.equal(new BN(100));
    })
    it("approve max sets spender's allowance of msg.sender's tokens to _totalSupply", async () => {
      await printer.approveMax(account2, {from: account1});
      expect(await printer.allowance(account1, account2)).to.be.bignumber.equal(await printer.totalSupply());
    })
  })

  xcontext("shouldReflect and reflect", async () => {
    it('shouldReflect returns false when balance = 0', async () => {
      expect(await printer.shouldReflect()).to.be.false;
    })
    it("shouldReflect returns true when balance > 0 and sender is not pair", async () => {
      await printer.transfer(printer.address, 100, {from: owner});
      expect(await printer.shouldReflect()).to.be.true;
    })
    it("reflect ")
  })

  xcontext("transfer and transferFrom", async () => {
    it('don\'t allow transferFrom with insufficient allowance', async () => {
      await shouldThrow(printer.transferFrom(owner, account1, 100));
    })
    it('don\'t allow transfer over that puts address over maxWallet', async () => {
      const holdingLimit = await printer._maxWallet();
      await shouldThrow(printer.transfer(account1, holdingLimit + 10, {from: owner}));
    })
    it("transfer from fee-exempt address charges no fees", async () => {
      await printer.transfer(account1, 100, {from: owner});
      expect(await printer.balanceOf(account1)).to.be.bignumber.equal(new BN(100));
    })
    it("transfer from fee-applied address charges fee", async () => {
      await printer.transfer(account1, 100, {from: owner});
      await printer.transfer(account2, 100, {from: account1});
      expect(await printer.balanceOf(account2)).to.be.bignumber.equal(new BN(100 * (1 - feePercentage)))
    })
    it("transfer sets shares properly", async () => {
      await printer.transfer(account1, 100, {from: owner});
      const distributor = await Distributor.at(await printer.distributor());
      expect((await distributor.shares(account1)).amount).to.be.bignumber.equal(await printer.balanceOf(account1));
      expect((await distributor.shares(owner)).amount).to.be.bignumber.equal(await printer.balanceOf(owner));
    })
  })

  context("buy and sell tokens", async () => {

    let joeRouter;
    let liquidityReceiver;
    let block;

    before(async () => {
      joeRouter = await JoeRouter.at(await printer.router());
      liquidityReceiver = await printer.autoLiquidityReceiver();
    })

    beforeEach(async () => {
      block = await web3.eth.getBlock("pending");
      await joeRouter.addLiquidityAVAX(
          printer.address,
          totalSupply,
          0,
          0,
          liquidityReceiver,
          block.timestamp,
          {value: web3.utils.toWei("100", 'ether')}
      )
      block = await web3.eth.getBlock("pending");
    })

    it("initial add liquidity does not take fee", async () => {
      expect(await printer.balanceOf(await printer.pair())).is.bignumber.equal(totalSupply);
    })

    it("buy collects tax", async () => {
      block = await web3.eth.getBlock("pending");
      const pairBalanceBefore = await printer.balanceOf(await printer.pair());
      await joeRouter.swapExactAVAXForTokensSupportingFeeOnTransferTokens(
          0,
          [WAVAX_ADDRESS, printer.address],
          account1,
          block.timestamp,
          {value: 10000}
      )
      const txAmount = pairBalanceBefore.sub(await printer.balanceOf(await printer.pair()));
      await bnCloseTo(await printer.balanceOf(account1), new BN(txAmount * (1 - feePercentage)), new BN("100"));
      await bnCloseTo(await printer.balanceOf(printer.address), new BN(txAmount * feePercentage), new BN("100"))
    })

    it("sell collects tax", async () => {
      await joeRouter.swapExactAVAXForTokensSupportingFeeOnTransferTokens(
          0,
          [WAVAX_ADDRESS, printer.address],
          account1,
          (await web3.eth.getBlock("pending")).timestamp,
          {value: 10000}
      )
      await printer.approveMax(joeRouter.address, {from: account1});
      const pairBalanceBefore = await printer.balanceOf(await printer.pair());
      const account1Balance = await printer.balanceOf(account1);
      await joeRouter.swapExactTokensForAVAXSupportingFeeOnTransferTokens(
          account1Balance,
          0,
          [printer.address, WAVAX_ADDRESS],
          account1,
          (await web3.eth.getBlock("pending")).timestamp,
          {from: account1}
      )
      const txAmount = (await printer.balanceOf(await printer.pair())).sub(pairBalanceBefore);
      await bnCloseTo(txAmount, new BN(account1Balance * (1 - feePercentage)), new BN("100"));
    })
  })
});
