const PowellPrinter = artifacts.require("PowellPrinter")

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
chai.use(chaiAsPromised);

const expect = chai.expect;


contract("PowellPrinter", accounts => {

  let printer;
  let [owner, account1, account2] = accounts;

  beforeEach(async function () {
    console.log(await web3.eth.getBalance(owner));
    // Here we get the factory for our Swapper contrat and we deploy it on the forked network
    printer = await PowellPrinter.new();
  });

  // context("Approve and allowance", async () => {
  //   it("Approve increments allowance of msg.sender to spender", async () => {
  //     await printer.connect(account1).approve()
  //   })
  // })


  it("Correct deployment conditions", async function () {
    expect(await printer.allowance(owner, ROUTER_ADDRESS)).to.be.bignumber.equal(await printer.totalSupply());
  });
});
