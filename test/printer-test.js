const PowellPrinter = artifacts.require("PowellPrinterTest");
const Distributor = artifacts.require('DividendDistributor');
const JoeRouter = artifacts.require('IDEXRouter');
const IERC20 = artifacts.require("IERC20");
const IPair = artifacts.require("IPair");

const dotenv = require("dotenv");
dotenv.config();
const WAVAX_ADDRESS = process.env.WAVAX_ADDRESS;
const ROUTER_ADDRESS = process.env.ROUTER_ADDRESS;
const USDC_ADDRESS = process.env.USDC_ADDRESS;

const chai = require("chai");

const BN = web3.utils.BN;
const chaiBN = require('chai-bn')(BN);
chai.use(chaiBN);

const chaiAsPromised = require("chai-as-promised");
const { bnCloseTo } = require("./utils");
chai.use(chaiAsPromised);

const expect = chai.expect;

const { shouldThrow } = require("./utils");

const fromPowl = (num) => (num * 10 ** 6);
const toPowl = (num) => (num / 10 ** 6)
const fromWavax = (num) => (num * 10 ** 18);
const toWavax = (num) => (num / 10 ** 18);
const toUSDC = (num) => (num * 10 ** 6);
const fromUSDC = (num) => (num / 10 ** 6);
const toAvax = (num) => (num / 10 ** 9);
const fromAvax = (num) => (num * 10 ** 9)

contract("PowellPrinter", accounts => {

  let printer;
  let fees;
  let feePercentage;
  let totalSupply;
  let [owner, account1, account2] = accounts;
  let joeRouter;

  let wavax;

  let block;
  let liquidityReceiver;

  const getFee = (amount) => amount.mul(fees.totalFeeA).div(fees.feeDenominatorA);

  const addLiquidity = async (amt) => {
    block = await web3.eth.getBlock("pending");
    const liq = await joeRouter.addLiquidityAVAX(
      printer.address,
      amt,
      0,
      0,
      liquidityReceiver,
      block.timestamp,
      { value: fromWavax(50) }
    )
    block = await web3.eth.getBlock("pending");
    return liq;
  }

  before(async () => {
    printer = await PowellPrinter.new();
    fees = await printer.getFees();
    wavax = await IERC20.at(WAVAX_ADDRESS);
    feePercentage = (await printer.totalFee()) / (await printer.feeDenominator());
    totalSupply = (await printer.totalSupply());
    joeRouter = await JoeRouter.at(await printer.router());
    liquidityReceiver = await printer.autoLiquidityReceiver();

  })

  beforeEach(async function () {
    printer = await PowellPrinter.new();
  });

  context("approve and allowance", async () => {
    it("approve sets spender's allowance of msg.sender's tokens", async () => {
      await printer.approve(account2, 100, { from: account1 });
      expect(await printer.allowance(account1, account2)).to.be.bignumber.equal(new BN("100"));
    })
    it("approve max sets spender's allowance of msg.sender's tokens to _totalSupply", async () => {
      await printer.approveMax(account2, { from: account1 });
      expect(await printer.allowance(account1, account2)).to.be.bignumber.equal(await printer.totalSupply());
    })
  })

  context("add and remove liquidity", async () => {
    it("add liquidity and subsequently remove", async () => {
      await addLiquidity(totalSupply.div(new BN("2")));

      const removeAmt = new BN("1000");

      const pair = await IPair.at(await printer.pair());
      await pair.approve(joeRouter.address, removeAmt);

      block = await web3.eth.getBlock("pending");
      await joeRouter.removeLiquidityAVAXSupportingFeeOnTransferTokens(
        printer.address,
        removeAmt,
        0,
        0,
        liquidityReceiver,
        block.timestamp,
      )
    })
  })

  context("shouldReflect and reflect", async () => {
    it('shouldReflect returns false when balance = 0', async () => {
      expect(await printer.shouldReflect()).to.be.false;
    })
    it("shouldReflect returns true when balance > 0 and sender is not pair", async () => {
      await printer.transfer(printer.address, fromPowl(2 * 10 ** 8), { from: owner });
      expect(await printer.shouldReflect()).to.be.true;
    })
    it("reflect when overliquified", async () => {
      await addLiquidity(totalSupply.div(new BN("2")));
      const swapThreshold = await printer.swapThreshold();
      await printer.transfer(printer.address, swapThreshold, { from: owner });

      const pairAvaxBefore = await wavax.balanceOf(await printer.pair());
      const liqAvaxBefore = new BN(await web3.eth.getBalance(liquidityReceiver));

      await printer.reflect({ from: account1 });

      const avaxAmount = pairAvaxBefore.sub(await wavax.balanceOf(await printer.pair()));
      const liqAvaxAmount = new BN(await web3.eth.getBalance(liquidityReceiver)).sub(liqAvaxBefore)

      const calculatedFeeDenominator = fees.totalFeeA.sub(fees.liquidityFeeA);

      await bnCloseTo(new BN(await web3.eth.getBalance(printer.address)), new BN("0"), new BN("100"));
      await bnCloseTo(liqAvaxAmount, avaxAmount.mul(fees.marketingFeeA).div(calculatedFeeDenominator), new BN("100"))
    })
    it("reflect when underliquified", async () => {
      await addLiquidity(totalSupply.div(new BN("2")));
      const swapThreshold = await printer.swapThreshold();
      await printer.transfer(printer.address, swapThreshold, { from: owner });

      const pairAvaxBefore = await wavax.balanceOf(await printer.pair());
      const pairPowlBefore = await printer.balanceOf(await printer.pair());
      const liqAvaxBefore = new BN(await web3.eth.getBalance(liquidityReceiver));

      await printer.reflect({ from: account1 });

      const avaxAmount = pairAvaxBefore.sub(await wavax.balanceOf(await printer.pair()));
      const powlAmount = pairPowlBefore.sub(await printer.balanceOf(await printer.pair()));
      const liqAvaxAmount = new BN(await web3.eth.getBalance(liquidityReceiver)).sub(liqAvaxBefore)

      const calculatedFeeDenominator = fees.totalFeeA.sub(fees.liquidityFeeA.div(new BN("2")));

      await bnCloseTo(liqAvaxAmount, avaxAmount.mul(fees.marketingFeeA).div(calculatedFeeDenominator), new BN(fromWavax(0.001).toString()))

      await bnCloseTo(new BN(await web3.eth.getBalance(printer.address)), new BN("0"), new BN("100"));
    })
  })

  context("transfer and transferFrom", async () => {
    it('don\'t allow transferFrom with insufficient allowance', async () => {
      await shouldThrow(printer.transferFrom(owner, account1, 100));
    })
    it('don\'t allow transfer over that puts address over maxWallet', async () => {
      const holdingLimit = await printer._maxWallet();
      await shouldThrow(printer.transfer(account1, holdingLimit + 10, { from: owner }));
    })
    it("transfer from fee-exempt address charges no fees", async () => {
      await printer.transfer(account1, 100, { from: owner });
      expect(await printer.balanceOf(account1)).to.be.bignumber.equal(new BN(100));
    })
    it("transfer from fee-applied address charges fee", async () => {
      const transferAmt = fromPowl(10 ** 6)
      await printer.transfer(account1, transferAmt, { from: owner });
      await printer.transfer(account2, transferAmt, { from: account1 });
      expect(await printer.balanceOf(account2)).to.be.bignumber.equal(new BN(transferAmt * (1 - feePercentage)))
    })
    it("transfer sets shares properly", async () => {
      const transferAmt = fromPowl(10 ** 6)
      await printer.transfer(account1, transferAmt, { from: owner });
      const distributor = await Distributor.at(await printer.distributor());
      expect((await distributor.shares(account1)).amount).to.be.bignumber.equal(await printer.balanceOf(account1));
      expect((await distributor.shares(owner)).amount).to.be.bignumber.equal(await printer.balanceOf(owner));
    })
  })

  context("buy and sell tokens", async () => {

    beforeEach(async () => {
      await addLiquidity(new BN("5000000"));
    })

    it("initial add liquidity does not take fee", async () => {
      expect(await printer.balanceOf(printer.address)).is.bignumber
        .equal(new BN("0"));
    })

    it("buy collects tax and does not reflect", async () => {
      block = await web3.eth.getBlock("pending");
      const pairBalanceBefore = await printer.balanceOf(await printer.pair());
      await joeRouter.swapExactAVAXForTokensSupportingFeeOnTransferTokens(
        0,
        [WAVAX_ADDRESS, printer.address],
        account1,
        block.timestamp,
        { value: fromWavax(0.0001), from: account1 }
      )
      const txAmount = pairBalanceBefore.sub(await printer.balanceOf(await printer.pair()));
      await bnCloseTo(await printer.balanceOf(account1), (txAmount.sub(getFee(txAmount))), new BN("100"));
      await bnCloseTo(await printer.balanceOf(printer.address), getFee(txAmount), new BN("100"))
    })

    it("sell collects tax", async () => {
      const transferAmount = new BN(fromPowl(2 * 10 ** 8).toString());
      await printer.transfer(account1, transferAmount, { from: owner });
      await printer.approveMax(joeRouter.address, { from: account1 });

      const account1Powl = await printer.balanceOf(account1);
      const pairPowl = await printer.balanceOf(await printer.pair());

      await joeRouter.swapExactTokensForAVAXSupportingFeeOnTransferTokens(
        account1Powl,
        0,
        [printer.address, WAVAX_ADDRESS],
        account1,
        (await web3.eth.getBlock("pending")).timestamp,
        { from: account1 }
      )

      const pairPowlIncrease = (await printer.balanceOf(await printer.pair())).sub(pairPowl);
      expect(await printer.balanceOf(printer.address)).to.be.bignumber
        .equal(getFee(transferAmount));
      expect(await printer.balanceOf(account1)).to.be.bignumber.equal(new BN("0"));
      expect(pairPowlIncrease).to.be.bignumber.equal(transferAmount.sub(getFee(transferAmount)));
    })
  })
  
});
