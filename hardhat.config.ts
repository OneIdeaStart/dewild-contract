import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  // Пока оставляем только локальную сеть
  networks: {
    hardhat: {
      // Конфигурация для локальной сети
    },
  },
};

export default config;