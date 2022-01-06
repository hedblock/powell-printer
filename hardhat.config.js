require("@nomiclabs/hardhat-truffle5");

module.exports = {
  defaultNetwork: "hardhat",
  solidity: "0.8.4",
  networks: {
    hardhat: {
      chainId: 43114,
      gasPrice: 225000000000,
      forking: {
        url: "https://api.avax.network/ext/bc/C/rpc",
        enabled: true,
      },
    },
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
  },
};
