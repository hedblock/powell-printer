const Distributor = artifacts.require("DividendDistributor")

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

const {shouldThrow} = require("./utils");

contract("DividendDistributor", accounts => {

    let distributor;
    let [owner, account1, account2] = accounts;

    beforeEach(async function () {
        distributor = await Distributor.new("0x60aE616a2155Ee3d9A68541Ba4544862310933d4");
    });

    context("setShare", async () => {
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
});
