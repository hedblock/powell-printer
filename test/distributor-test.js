const Distributor = artifacts.require("DividendDistributor")
const IERC20 = artifacts.require("IERC20");


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

contract("DividendDistributor", accounts => {

    let distributor;
    let USDC;
    let DPSAccuracy;
    let [owner, account1, account2] = accounts;

    before(async () => {
        distributor = await Distributor.new("0x60aE616a2155Ee3d9A68541Ba4544862310933d4");
        DPSAccuracy = await distributor.dividendsPerShareAccuracyFactor();
        USDC = await IERC20.at(USDC_ADDRESS);
    })

    beforeEach(async function () {
        distributor = await Distributor.new("0x60aE616a2155Ee3d9A68541Ba4544862310933d4");
    });

    xcontext("setShare", async () => {
        it("setShare can only be called by owner (token) contract", async () => {
            await shouldThrow(distributor.setShare(account1, 100, {from: account1}));
        })
        it("setShare for untracked address adds to shareholders", async () => {
            await distributor.setShare(account1, 100, {from: owner});
            expect(await distributor.shareholders(0)).to.equal(account1);
        })
        it("setShare to 0 for tracked address removes", async () => {
            await distributor.setShare(account1, 100, {from: owner});
            await distributor.setShare(account1, 0, {from: owner});
            await shouldThrow(distributor.shareholders(0));
        })
        it("setShare increases totalShares and updates shares mapping", async () => {
            await distributor.setShare(account1, 100, {from: owner});
            const share = await distributor.shares(account1);
            expect(share.amount).to.be.bignumber.equal(new BN(100));
            expect(share.totalExcluded).to.be.bignumber.equal(new BN(0));
        })
    })

    xcontext("deposit", async () => {
        it('deposit when totalShares = 0 fails (div by 0)', async () => {
            await shouldThrow(distributor.deposit({from: owner, value: web3.utils.toWei("1")}));
        })
        it('deposit when totalShares > 0 increments totalDividends and dividendsPerShare', async () => {
            await distributor.setShare(owner, 100, {from: owner});
            await distributor.deposit({from: owner, value: web3.utils.toWei("1")});
            const USDCSwapped = await USDC.balanceOf(distributor.address);
            await bnCloseTo(await distributor.totalDividends(), USDCSwapped, new BN(web3.utils.toWei("0.01")))
            await bnCloseTo(await distributor.dividendsPerShare(),
                USDCSwapped.mul(DPSAccuracy).div(await distributor.totalShares()), new BN(web3.utils.toWei("0.01")));
        })
    })
});
