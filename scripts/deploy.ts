// scripts/deploy.ts
import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  console.log("Starting deployment...");
  
  // Получаем аккаунты
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  
  // Конфигурация
  const name = "DeWild Club";
  const symbol = "DEWILD";
  const baseURI = "ipfs://QmYourBaseURI/"; // Обновите на ваш реальный baseURI
  
  // 1. Деплой DeWildClub
  console.log("\n1. Deploying DeWildClub...");
  const DeWildClub = await ethers.getContractFactory("DeWildClub");
  const deWildClub = await DeWildClub.deploy(name, symbol, baseURI);
  await deWildClub.waitForDeployment();
  console.log("DeWildClub deployed to:", await deWildClub.getAddress());
  
  // 2. Деплой DeWildMinter
  console.log("\n2. Deploying DeWildMinter...");
  const DeWildMinter = await ethers.getContractFactory("DeWildMinter");
  const deWildMinter = await DeWildMinter.deploy(await deWildClub.getAddress());
  await deWildMinter.waitForDeployment();
  console.log("DeWildMinter deployed to:", await deWildMinter.getAddress());
  
  // 3. Деплой RoyaltySplitter
  console.log("\n3. Deploying RoyaltySplitter...");
  const RoyaltySplitter = await ethers.getContractFactory("RoyaltySplitter");
  const royaltySplitter = await RoyaltySplitter.deploy();
  await royaltySplitter.waitForDeployment();
  console.log("RoyaltySplitter deployed to:", await royaltySplitter.getAddress());
  
  // 4. Деплой PrimarySaleMarket
  console.log("\n4. Deploying PrimarySaleMarket...");
  const PrimarySaleMarket = await ethers.getContractFactory("PrimarySaleMarket");
  const primarySaleMarket = await PrimarySaleMarket.deploy(await deWildClub.getAddress());
  await primarySaleMarket.waitForDeployment();
  console.log("PrimarySaleMarket deployed to:", await primarySaleMarket.getAddress());
  
  // 5. Настройка взаимосвязей
  console.log("\n5. Setting up contract relationships...");
  
  // 5.1 Устанавливаем адрес минтера в DeWildClub
  let tx = await deWildClub.setMintContract(await deWildMinter.getAddress());
  await tx.wait();
  console.log("Minter contract set in DeWildClub");
  
  // 5.2 Устанавливаем адрес сплиттера в DeWildClub
  tx = await deWildClub.setRoyaltySplitter(await royaltySplitter.getAddress());
  await tx.wait();
  console.log("Royalty splitter set in DeWildClub");
  
  // 5.3 Устанавливаем адрес маркетплейса в DeWildClub
  tx = await deWildClub.setPrimaryMarket(await primarySaleMarket.getAddress());
  await tx.wait();
  console.log("Primary market set in DeWildClub");
  
  // 5.4 Устанавливаем адрес NFT в RoyaltySplitter
  tx = await royaltySplitter.setNFTContract(await deWildClub.getAddress());
  await tx.wait();
  console.log("NFT contract set in RoyaltySplitter");
  
  // 6. Проверка настроек
  console.log("\n6. Verifying configurations...");
  console.log("DeWildClub.mintContract():", await deWildClub.mintContract());
  console.log("DeWildClub.royaltySplitter():", await deWildClub.royaltySplitter());
  console.log("DeWildClub.primaryMarket():", await deWildClub.primaryMarket());
  console.log("RoyaltySplitter.nftContract():", await royaltySplitter.nftContract());
  
  // 7. Сохраняем информацию о деплое
  const deployInfo = {
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    contracts: {
      DeWildClub: await deWildClub.getAddress(),
      DeWildMinter: await deWildMinter.getAddress(),
      RoyaltySplitter: await royaltySplitter.getAddress(),
      PrimarySaleMarket: await primarySaleMarket.getAddress(),
    },
    deployedAt: new Date().toISOString()
  };
  
  // Сохраняем информацию в файл
  const network = (await ethers.provider.getNetwork()).name || "unknown";
  const fileName = `deployment-${network}-${deployInfo.deployedAt.split('T')[0]}.json`;
  fs.writeFileSync(fileName, JSON.stringify(deployInfo, null, 2));
  
  console.log(`\nDeployment info saved to ${fileName}`);
  console.log("Deployment completed successfully!");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});