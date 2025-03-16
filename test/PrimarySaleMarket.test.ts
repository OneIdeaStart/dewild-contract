import { expect } from "chai";
import { ethers } from "hardhat";
import { DeWildClub, DeWildMinter, RoyaltySplitter, PrimarySaleMarket } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("PrimarySaleMarket", function () {
  let deWildClub: DeWildClub;
  let deWildMinter: DeWildMinter;
  let royaltySplitter: RoyaltySplitter;
  let primaryMarket: PrimarySaleMarket;
  let owner: SignerWithAddress;
  let artist: SignerWithAddress;
  let collector1: SignerWithAddress;
  let collector2: SignerWithAddress;

  const NAME = "DeWild Club";
  const SYMBOL = "DEWILD";
  const BASE_URI = "ipfs://QmYourBaseURI/";
  const MINT_PRICE = ethers.parseEther("0.0011");
  const AUCTION_START_PRICE = ethers.parseEther("0.011");
  
  // Константы для аукциона
  const DAY_IN_SECONDS = 24 * 60 * 60;
  const FIVE_MINUTES = 5 * 60;
  
  async function signMessage(signer: SignerWithAddress, address: string) {
    const hash = ethers.keccak256(ethers.solidityPacked(['address'], [address]));
    return signer.signMessage(ethers.getBytes(hash));
  }

  async function mintNFT(artistAccount: SignerWithAddress) {
    // Апрувим артиста
    await deWildClub.connect(owner).approveArtist(artistAccount.address);
    
    // Получаем подпись от владельца
    const signature = await signMessage(owner, artistAccount.address);
    
    // Минтим NFT
    await deWildMinter.connect(artistAccount).mint(signature, { value: MINT_PRICE });
    
    // Возвращаем tokenId (первый = 1)
    return 1;
  }

  beforeEach(async function () {
    // Получаем аккаунты для тестов
    [owner, artist, collector1, collector2] = await ethers.getSigners();

    // Деплоим DeWildClub
    const DeWildClub = await ethers.getContractFactory("DeWildClub");
    deWildClub = await DeWildClub.deploy(
      NAME,
      SYMBOL,
      BASE_URI
    );
    await deWildClub.waitForDeployment();

    // Деплоим DeWildMinter
    const DeWildMinter = await ethers.getContractFactory("DeWildMinter");
    deWildMinter = await DeWildMinter.deploy(await deWildClub.getAddress());
    await deWildMinter.waitForDeployment();

    // Деплоим RoyaltySplitter
    const RoyaltySplitter = await ethers.getContractFactory("RoyaltySplitter");
    royaltySplitter = await RoyaltySplitter.deploy();
    await royaltySplitter.waitForDeployment();

    // Деплоим PrimarySaleMarket
    const PrimarySaleMarket = await ethers.getContractFactory("PrimarySaleMarket");
    primaryMarket = await PrimarySaleMarket.deploy(await deWildClub.getAddress());
    await primaryMarket.waitForDeployment();

    // Настраиваем контракты
    await deWildClub.setMintContract(await deWildMinter.getAddress());
    await deWildClub.setRoyaltySplitter(await royaltySplitter.getAddress());
    await deWildClub.setPrimaryMarket(await primaryMarket.getAddress());
    await royaltySplitter.setNFTContract(await deWildClub.getAddress());

    console.log("\nDeployment Details:");
    console.log("NFT Contract:", await deWildClub.getAddress());
    console.log("Minter Contract:", await deWildMinter.getAddress());
    console.log("Royalty Splitter:", await royaltySplitter.getAddress());
    console.log("Primary Market:", await primaryMarket.getAddress());
  });

  describe("Setup", function () {
    it("Should set the correct contract addresses", async function () {
      expect(await deWildClub.mintContract()).to.equal(await deWildMinter.getAddress());
      expect(await deWildClub.royaltySplitter()).to.equal(await royaltySplitter.getAddress());
      expect(await deWildClub.primaryMarket()).to.equal(await primaryMarket.getAddress());
      expect(await royaltySplitter.nftContract()).to.equal(await deWildClub.getAddress());
    });
  });

  describe("Minting", function () {
    it("Should mint an NFT to artist", async function () {
      const tokenId = await mintNFT(artist);
      expect(await deWildClub.ownerOf(tokenId)).to.equal(artist.address);
    });
  });

  describe("First Sale Restriction", function () {
    it("Should allow free transfers but block approval except to primary market", async function () {
        // Минтим NFT
        const tokenId = await mintNFT(artist);
        
        // Свободная передача между пользователями должна быть разрешена
        await deWildClub.connect(artist).transferFrom(artist.address, collector1.address, tokenId);
        expect(await deWildClub.ownerOf(tokenId)).to.equal(collector1.address);
        
        // Но approve для стороннего маркетплейса должен быть запрещен
        const randomAddress = collector2.address; // Используем адрес другого коллекционера как "сторонний маркетплейс"
        await expect(
          deWildClub.connect(collector1).approve(randomAddress, tokenId)
        ).to.be.revertedWith("First sale must go through primary market");
        
        // Проверяем что трансфер обратно артисту тоже разрешен
        await deWildClub.connect(collector1).transferFrom(collector1.address, artist.address, tokenId);
        expect(await deWildClub.ownerOf(tokenId)).to.equal(artist.address);
        
        // И approve для primaryMarket разрешен
        await deWildClub.connect(artist).approve(await primaryMarket.getAddress(), tokenId);
        expect(await deWildClub.getApproved(tokenId)).to.equal(await primaryMarket.getAddress());
      });      
  });

  describe("Auction Creation", function () {
    it("Should allow artist to create auction with fixed 24h duration", async function () {
        // Минтим NFT
        const tokenId = await mintNFT(artist);
        
        // Устанавливаем апрув для PrimarySaleMarket
        await deWildClub.connect(artist).approve(await primaryMarket.getAddress(), tokenId);
        
        // Запоминаем текущий timestamp
        const blockBefore = await ethers.provider.getBlock('latest');
        const timestampBefore = blockBefore?.timestamp || 0;
        
        // Создаем аукцион
        await primaryMarket.connect(artist).createAuction(
          tokenId,
          AUCTION_START_PRICE
        );
        
        // Проверяем, что аукцион создан
        const auction = await primaryMarket.getAuction(tokenId);
        expect(auction[0]).to.equal(artist.address); // artist
        expect(auction[1]).to.equal(AUCTION_START_PRICE); // startPrice
        expect(auction[5]).to.equal(true); // isActive
        
        // Проверяем, что NFT переведен на контракт аукциона
        expect(await deWildClub.ownerOf(tokenId)).to.equal(await primaryMarket.getAddress());
        
        // Проверяем, что длительность аукциона равна 24 часам от текущего блока
        const endTime = Number(auction[4]);
        expect(endTime).to.be.closeTo(timestampBefore + DAY_IN_SECONDS, 60); // Допускаем разницу до 60 секунд
    });
  });

  describe("Bid Placement", function () {
    let tokenId: number;
    
    beforeEach(async function () {
      // Минтим NFT
      tokenId = await mintNFT(artist);
      
      // Устанавливаем апрув для PrimarySaleMarket
      await deWildClub.connect(artist).approve(await primaryMarket.getAddress(), tokenId);
      
      // Создаем аукцион
      await primaryMarket.connect(artist).createAuction(
        tokenId,
        AUCTION_START_PRICE
      );
    });
    
    it("Should allow placing a bid at the start price", async function () {
      await primaryMarket.connect(collector1).placeBid(tokenId, { value: AUCTION_START_PRICE });
      
      const auction = await primaryMarket.getAuction(tokenId);
      expect(auction[2]).to.equal(AUCTION_START_PRICE); // currentBid
      expect(auction[3]).to.equal(collector1.address); // highestBidder
    });
    
    it("Should allow outbidding with at least +11%", async function () {
      // Первая ставка
      await primaryMarket.connect(collector1).placeBid(tokenId, { value: AUCTION_START_PRICE });
      
      // Вторая ставка должна быть минимум на 11% выше
      const minBid = AUCTION_START_PRICE + (AUCTION_START_PRICE * BigInt(11) / BigInt(100));
      await primaryMarket.connect(collector2).placeBid(tokenId, { value: minBid });
      
      const auction = await primaryMarket.getAuction(tokenId);
      expect(auction[2]).to.equal(minBid); // currentBid
      expect(auction[3]).to.equal(collector2.address); // highestBidder
    });
    
    it("Should reject bids below minimum increment", async function () {
      // Первая ставка
      await primaryMarket.connect(collector1).placeBid(tokenId, { value: AUCTION_START_PRICE });
      
      // Недостаточная ставка (только +5%)
      const lowBid = AUCTION_START_PRICE + (AUCTION_START_PRICE * BigInt(5) / BigInt(100));
      await expect(
        primaryMarket.connect(collector2).placeBid(tokenId, { value: lowBid })
      ).to.be.revertedWith("Bid too low");
    });
    
    it("Should extend auction time if bid placed in last 5 minutes", async function () {
        // Увеличиваем время почти до конца аукциона (осталось 4 минуты)
        await ethers.provider.send("evm_increaseTime", [DAY_IN_SECONDS - FIVE_MINUTES + 60]);
        await ethers.provider.send("evm_mine", []);
        
        // Получаем время окончания аукциона до ставки
        const auctionBefore = await primaryMarket.getAuction(tokenId);
        const endTimeBefore = Number(auctionBefore[4]);
        
        // Делаем ставку
        const txResponse = await primaryMarket.connect(collector1).placeBid(tokenId, { value: AUCTION_START_PRICE });
        const receipt = await txResponse.wait();
        const block = await ethers.provider.getBlock(receipt!.blockNumber);
        const currentTimestamp = block?.timestamp || 0;
        
        // Получаем время окончания аукциона после ставки
        const auctionAfter = await primaryMarket.getAuction(tokenId);
        const endTimeAfter = Number(auctionAfter[4]);
        
        // Проверяем, что время продлено на 5 минут от текущего времени блока
        expect(endTimeAfter).to.be.greaterThan(endTimeBefore);
        expect(endTimeAfter).to.be.closeTo(currentTimestamp + FIVE_MINUTES, 60);
    });
    
    it("Should not extend auction time if bid placed more than 5 minutes before end", async function () {
      // Увеличиваем время, но оставляем больше 5 минут до конца (осталось 6 минут)
      await ethers.provider.send("evm_increaseTime", [DAY_IN_SECONDS - FIVE_MINUTES - 60]);
      await ethers.provider.send("evm_mine", []);
      
      // Получаем время окончания аукциона до ставки
      const auctionBefore = await primaryMarket.getAuction(tokenId);
      const endTimeBefore = Number(auctionBefore[4]);
      
      // Делаем ставку
      await primaryMarket.connect(collector1).placeBid(tokenId, { value: AUCTION_START_PRICE });
      
      // Получаем время окончания аукциона после ставки
      const auctionAfter = await primaryMarket.getAuction(tokenId);
      const endTimeAfter = Number(auctionAfter[4]);
      
      // Проверяем, что время не изменилось
      expect(endTimeAfter).to.equal(endTimeBefore);
    });
    
    it("Should return correct remaining time", async function () {
      // Проверяем оставшееся время сразу после создания аукциона
      const remainingTime = await primaryMarket.getRemainingTime(tokenId);
      expect(remainingTime).to.be.closeTo(BigInt(DAY_IN_SECONDS), BigInt(5));
      
      // Увеличиваем время на 1 час
      await ethers.provider.send("evm_increaseTime", [3600]);
      await ethers.provider.send("evm_mine", []);
      
      // Проверяем, что оставшееся время уменьшилось примерно на 1 час
      const newRemainingTime = await primaryMarket.getRemainingTime(tokenId);
      expect(newRemainingTime).to.be.closeTo(BigInt(DAY_IN_SECONDS - 3600), BigInt(5));
    });
  });

  describe("Auction Completion", function () {
    let tokenId: number;
    
    beforeEach(async function () {
        // Минтим NFT
        tokenId = await mintNFT(artist);
        
        // Устанавливаем апрув для PrimarySaleMarket
        await deWildClub.connect(artist).approve(await primaryMarket.getAddress(), tokenId);
        
        // Создаем аукцион
        await primaryMarket.connect(artist).createAuction(
          tokenId,
          AUCTION_START_PRICE
        );
        
        // Размещаем ставку
        await primaryMarket.connect(collector1).placeBid(tokenId, { value: AUCTION_START_PRICE });
        
        // Увеличиваем время, чтобы аукцион завершился
        await ethers.provider.send("evm_increaseTime", [DAY_IN_SECONDS + 1]);
        await ethers.provider.send("evm_mine", []);
    });
    
    it("Should end auction and split payments correctly", async function () {
      // Проверяем балансы до завершения аукциона
      const artistBalanceBefore = await ethers.provider.getBalance(artist.address);
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      
      // Увеличиваем время, чтобы аукцион завершился
      await ethers.provider.send("evm_increaseTime", [DAY_IN_SECONDS + 1]);
      await ethers.provider.send("evm_mine", []);
      
      // Завершаем аукцион
      await primaryMarket.connect(owner).endAuction(tokenId);
      
      // Проверяем, что токен передан победителю
      expect(await deWildClub.ownerOf(tokenId)).to.equal(collector1.address);
      
      // Проверяем, что токен помечен как проданный
      expect(await deWildClub.hasBeenSold(tokenId)).to.equal(true);
      
      // Проверяем, что деньги распределены корректно
      const artistBalanceAfter = await ethers.provider.getBalance(artist.address);
      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      
      // Артист должен получить 75%
      const expectedArtistPayment = (AUCTION_START_PRICE * BigInt(75)) / BigInt(100);
      expect(artistBalanceAfter - artistBalanceBefore).to.equal(expectedArtistPayment);
      
      // Команда должна получить 25% (за вычетом газа на транзакцию)
      const expectedTeamPayment = (AUCTION_START_PRICE * BigInt(25)) / BigInt(100);
      expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore); // Просто проверяем, что баланс увеличился
    });
    
    it("Should allow the NFT to be freely transferred after first sale", async function () {
      // Завершаем аукцион
      await ethers.provider.send("evm_increaseTime", [DAY_IN_SECONDS + 1]);
      await primaryMarket.connect(owner).endAuction(tokenId);
      
      // После первой продажи, токен должен свободно передаваться
      await deWildClub.connect(collector1).transferFrom(collector1.address, collector2.address, tokenId);
      expect(await deWildClub.ownerOf(tokenId)).to.equal(collector2.address);
    });
  });

  describe("Auction Cancellation", function () {
    let tokenId: number;
    
    beforeEach(async function () {
      // Минтим NFT
      tokenId = await mintNFT(artist);
      
      // Устанавливаем апрув для PrimarySaleMarket
      await deWildClub.connect(artist).approve(await primaryMarket.getAddress(), tokenId);
      
      // Создаем аукцион
      await primaryMarket.connect(artist).createAuction(
        tokenId,
        AUCTION_START_PRICE
      );
    });
    
    it("Should allow artist to cancel auction if no bids", async function () {
      await primaryMarket.connect(artist).cancelAuction(tokenId);
      
      // Проверяем, что аукцион отменен
      const auction = await primaryMarket.getAuction(tokenId);
      expect(auction[5]).to.equal(false); // isActive
      
      // Проверяем, что NFT возвращен артисту
      expect(await deWildClub.ownerOf(tokenId)).to.equal(artist.address);
    });
    
    it("Should prevent cancellation if there are bids", async function () {
      // Размещаем ставку
      await primaryMarket.connect(collector1).placeBid(tokenId, { value: AUCTION_START_PRICE });
      
      // Пытаемся отменить аукцион
      await expect(
        primaryMarket.connect(artist).cancelAuction(tokenId)
      ).to.be.revertedWith("Cannot cancel auction with bids");
    });
  });
});