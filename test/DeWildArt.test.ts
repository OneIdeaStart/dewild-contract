import { expect } from "chai";
import { ethers } from "hardhat";
import { DeWildClub, DeWildMinter, RoyaltySplitter, PrimarySaleMarket } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DeWild Club Collection", function () {
   let deWildClub: DeWildClub;
   let deWildMinter: DeWildMinter;
   let royaltySplitter: RoyaltySplitter;
   let primaryMarket: PrimarySaleMarket;
   let owner: SignerWithAddress;
   let artist1: SignerWithAddress;
   let artist2: SignerWithAddress;
   let collector: SignerWithAddress;
   let marketplace: SignerWithAddress;
   let royaltyWallet: SignerWithAddress;

   const NAME = "DeWild Club";
   const SYMBOL = "DEWILD";
   const BASE_URI = "ipfs://QmYourBaseURI/";
   const MINT_PRICE = ethers.parseEther("0.0011");
   const MIN_START_PRICE = ethers.parseEther("0.011");
   
   async function signMessage(signer: SignerWithAddress, address: string) {
       const hash = ethers.keccak256(ethers.solidityPacked(['address'], [address]));
       return signer.signMessage(ethers.getBytes(hash));
   }

   async function mintTokenForArtist(artist: SignerWithAddress) {
       await deWildClub.connect(owner).approveArtist(artist.address);
       const signature = await signMessage(owner, artist.address);
       await deWildMinter.connect(artist).mint(signature, { value: MINT_PRICE });
       return await deWildClub.totalSupply();
   }

   beforeEach(async function () {
       [owner, artist1, artist2, collector, marketplace, royaltyWallet] = await ethers.getSigners();

       // Деплоим контракты
       const DeWildClub = await ethers.getContractFactory("DeWildClub");
       deWildClub = await DeWildClub.deploy(
           NAME,
           SYMBOL,
           BASE_URI
       );
       await deWildClub.waitForDeployment();

       const DeWildMinter = await ethers.getContractFactory("DeWildMinter");
       deWildMinter = await DeWildMinter.deploy(await deWildClub.getAddress());
       await deWildMinter.waitForDeployment();

       // Устанавливаем адрес минтера
       await deWildClub.setMintContract(await deWildMinter.getAddress());

       // Деплоим и настраиваем RoyaltySplitter
       const RoyaltySplitterFactory = await ethers.getContractFactory("RoyaltySplitter");
       royaltySplitter = await RoyaltySplitterFactory.deploy();
       await royaltySplitter.waitForDeployment();

       // Устанавливаем адрес сплиттера в DeWildClub
       await deWildClub.setRoyaltySplitter(await royaltySplitter.getAddress());
       await royaltySplitter.setNFTContract(await deWildClub.getAddress());
       
       // Устанавливаем адрес кошелька роялти
       await royaltySplitter.setRoyaltyWallet(royaltyWallet.address);

       // Деплоим PrimarySaleMarket
       const PrimarySaleMarketFactory = await ethers.getContractFactory("PrimarySaleMarket");
       primaryMarket = await PrimarySaleMarketFactory.deploy(await deWildClub.getAddress());
       await primaryMarket.waitForDeployment();

       // Устанавливаем маркетплейс в DeWildClub
       await deWildClub.setPrimaryMarket(await primaryMarket.getAddress());

       console.log("\nDeployment Details:");
       console.log("NFT Contract:", await deWildClub.getAddress());
       console.log("Minter Contract:", await deWildMinter.getAddress());
       console.log("Royalty Splitter:", await royaltySplitter.getAddress());
       console.log("Primary Market:", await primaryMarket.getAddress());
   });

   describe("Deployment", function () {
       it("Should set the right name and symbol", async function () {
           expect(await deWildClub.name()).to.equal(NAME);
           expect(await deWildClub.symbol()).to.equal(SYMBOL);
       });

       it("Should set the right owner", async function () {
           expect(await deWildClub.owner()).to.equal(owner.address);
       });

       it("Should set the right minter contract", async function () {
           expect(await deWildClub.mintContract()).to.equal(await deWildMinter.getAddress());
       });

       it("Should set the right royalty splitter", async function () {
           expect(await deWildClub.royaltySplitter()).to.equal(await royaltySplitter.getAddress());
       });
   });

   describe("Artist Management", function () {
       it("Should allow owner to approve artist", async function () {
           await expect(deWildClub.connect(owner).approveArtist(artist1.address))
               .to.emit(deWildClub, "ArtistApproved")
               .withArgs(artist1.address);
               
           expect(await deWildClub.approvedArtists(artist1.address)).to.be.true;
       });

       it("Should allow owner to revoke artist", async function () {
           await deWildClub.connect(owner).approveArtist(artist1.address);
           await expect(deWildClub.connect(owner).revokeArtist(artist1.address))
               .to.emit(deWildClub, "ArtistRevoked")
               .withArgs(artist1.address);
               
           expect(await deWildClub.approvedArtists(artist1.address)).to.be.false;
       });

       it("Should not allow non-owner to approve/revoke artist", async function () {
           await expect(deWildClub.connect(artist1).approveArtist(artist2.address))
               .to.be.revertedWithCustomError(deWildClub, "OwnableUnauthorizedAccount");
       });
   });

   describe("Minting", function () {
       beforeEach(async function () {
           await deWildClub.connect(owner).approveArtist(artist1.address);
       });

       it("Should allow minting through minter contract with signature", async function () {
           const signature = await signMessage(owner, artist1.address);
           await expect(deWildMinter.connect(artist1).mint(signature, { value: MINT_PRICE }))
               .to.emit(deWildClub, "NFTMinted")
               .withArgs(1, artist1.address);
           
           expect(await deWildClub.ownerOf(1)).to.equal(artist1.address);
       });

       it("Should not allow direct minting", async function () {
           await expect(deWildClub.connect(artist1).mint({ value: MINT_PRICE }))
               .to.be.revertedWith("Mint only through official interface");
       });

       it("Should not allow minting with invalid signature", async function () {
           const signature = await signMessage(artist1, artist1.address);
           await expect(deWildMinter.connect(artist1).mint(signature, { value: MINT_PRICE }))
               .to.be.revertedWith("Invalid signature");
       });

       it("Should enforce one mint per artist", async function () {
           const signature = await signMessage(owner, artist1.address);
           await deWildMinter.connect(artist1).mint(signature, { value: MINT_PRICE });
           await expect(deWildMinter.connect(artist1).mint(signature, { value: MINT_PRICE }))
               .to.be.revertedWith("Artist already minted");
       });

       it("Should set correct royalty info", async function () {
           const signature = await signMessage(owner, artist1.address);
           await deWildMinter.connect(artist1).mint(signature, { value: MINT_PRICE });
           
           const salePrice = ethers.parseEther("1");
           const [receiver, royaltyAmount] = await deWildClub.royaltyInfo(1, salePrice);
           
           // Теперь receiver должен быть адресом royaltySplitter, а не артиста
           expect(receiver).to.equal(await royaltySplitter.getAddress());
           // Общая сумма роялти остается 5%
           expect(royaltyAmount).to.equal((salePrice * BigInt(500)) / BigInt(10000));
       });

       it("Should set correct royalty shares", async function () {
           const salePrice = ethers.parseEther("1");
           const expectedArtistShare = (salePrice * BigInt(250)) / BigInt(10000); // 2.5%
           const expectedTeamShare = (salePrice * BigInt(250)) / BigInt(10000); // 2.5%
           
           expect(await deWildClub.SECONDARY_ARTIST_SHARE()).to.equal(250);
           expect(await deWildClub.SECONDARY_TEAM_SHARE()).to.equal(250);
           expect(await deWildClub.SECONDARY_TOTAL_SHARE()).to.equal(500);
       });
   });

   describe("Max Supply Limit", function () {
    it("Should not allow minting beyond MAX_SUPPLY", async function () {
      this.timeout(0); // Отключаем таймаут, так как тест может занять много времени
      
      // Получаем текущее значение totalSupply
      const initialSupply = await deWildClub.totalSupply();
      console.log(`Начальный totalSupply: ${initialSupply}`);
      
      // Получаем значение MAX_SUPPLY
      const maxSupply = await deWildClub.MAX_SUPPLY();
      console.log(`MAX_SUPPLY контракта: ${maxSupply}`);
      
      // Получаем все доступные аккаунты
      const signers = await ethers.getSigners();
      console.log(`Доступно сигнеров: ${signers.length}`);
      
      // Минтим токены до MAX_SUPPLY
      const tokensToMint = Number(maxSupply) - Number(initialSupply);
      console.log(`Необходимо заминтить еще ${tokensToMint} токенов до MAX_SUPPLY`);
      
      if (tokensToMint > signers.length - 1) {
        console.log(`Недостаточно сигнеров для минта ${tokensToMint} токенов. Пропускаем тест.`);
        this.skip();
        return;
      }
      
      // Минтим токены один за другим
      for (let i = 0; i < tokensToMint; i++) {
        const artist = signers[i + 10]; // Начинаем с 10-го сигнера, чтобы не использовать уже занятые
        
        // Апрувим артиста
        await deWildClub.connect(owner).approveArtist(artist.address);
        
        // Получаем подпись
        const signature = await signMessage(owner, artist.address);
        
        // Минтим токен
        await deWildMinter.connect(artist).mint(signature, { value: MINT_PRICE });
        console.log(`Заминчен токен ${i + 1} из ${tokensToMint}`);
      }
      
      // Проверяем, что totalSupply равен MAX_SUPPLY
      const finalSupply = await deWildClub.totalSupply();
      console.log(`Финальный totalSupply: ${finalSupply}`);
      expect(finalSupply).to.equal(maxSupply);
      
      // Пытаемся минтить еще один токен (за пределами MAX_SUPPLY)
      const extraArtist = signers[tokensToMint + 10]; // Берем следующий доступный сигнер
      
      // Апрувим артиста
      await deWildClub.connect(owner).approveArtist(extraArtist.address);
      
      // Получаем подпись
      const extraSignature = await signMessage(owner, extraArtist.address);
      
      // Пытаемся минтить - должна быть ошибка "Max supply reached"
      await expect(
        deWildMinter.connect(extraArtist).mint(extraSignature, { value: MINT_PRICE })
      ).to.be.revertedWith("Max supply reached");
      
      console.log("Тест пройден успешно: нельзя минтить больше MAX_SUPPLY");
    });
  });  

   describe("Royalty Splitter", function () {
        beforeEach(async function () {
            await deWildClub.connect(owner).approveArtist(artist1.address);
            const signature = await signMessage(owner, artist1.address);
            await deWildMinter.connect(artist1).mint(signature, { value: MINT_PRICE });
        });

        it("Should set the token artist in RoyaltySplitter", async function () {
            expect(await royaltySplitter.tokenArtists(1)).to.equal(artist1.address);
        });

        it("Should forward all royalties to royaltyWallet", async function () {
            const royaltyAmount = ethers.parseEther("0.1");  // 0.1 ETH royalty
            
            // Запоминаем баланс royaltyWallet до отправки роялти
            const royaltyWalletBalanceBefore = await ethers.provider.getBalance(royaltyWallet.address);
            
            // Отправляем роялти в сплиттер через receiveRoyalties
            await royaltySplitter.connect(owner).receiveRoyalties(1, { value: royaltyAmount });
            
            // Проверяем, что royaltyWallet получил все роялти
            const royaltyWalletBalanceAfter = await ethers.provider.getBalance(royaltyWallet.address);
            expect(royaltyWalletBalanceAfter - royaltyWalletBalanceBefore).to.equal(royaltyAmount);
        });

        it("Should fail if artist not set for token", async function () {
            const royaltyAmount = ethers.parseEther("0.1");
            
            // Пытаемся получить роялти для несуществующего токена
            await expect(
                royaltySplitter.connect(owner).receiveRoyalties(999, { value: royaltyAmount })
            ).to.be.revertedWith("Artist not set for token");
        });

        it("Should fail if no royalties sent", async function () {
            await expect(
                royaltySplitter.connect(owner).receiveRoyalties(1, { value: 0 })
            ).to.be.revertedWith("No royalties");
        });

        it("Should only allow owner to set token artist", async function () {
            await expect(
                royaltySplitter.connect(artist1).setTokenArtist(2, artist2.address)
            ).to.be.revertedWith("Not authorized");
        });
    });

    describe("Transfer and Approval Restrictions", function () {
        let tokenId: bigint;

        beforeEach(async function () {
            // Подготовка: апрувим артиста и минтим токен
            await deWildClub.connect(owner).approveArtist(artist1.address);
            const signature = await signMessage(owner, artist1.address);
            await deWildMinter.connect(artist1).mint(signature, { value: MINT_PRICE });
            tokenId = BigInt(1);
        });

        it("Should allow transferring token to other user without restrictions", async function () {
            // Проверяем, что артист может свободно передать токен коллекционеру
            await deWildClub.connect(artist1).transferFrom(artist1.address, collector.address, tokenId);
            expect(await deWildClub.ownerOf(tokenId)).to.equal(collector.address);
        });

        it("Should prevent approving token for non-primary marketplace before first sale", async function () {
            // Пытаемся апрувить для стороннего маркетплейса (который не является primaryMarket)
            await expect(
                deWildClub.connect(artist1).approve(marketplace.address, tokenId)
            ).to.be.revertedWith("First sale must go through primary market");
        });

        it("Should allow approving token for primary marketplace", async function () {
            // Апрувим для нашего primaryMarket
            await deWildClub.connect(artist1).approve(await primaryMarket.getAddress(), tokenId);
            expect(await deWildClub.getApproved(tokenId)).to.equal(await primaryMarket.getAddress());
        });

        it("Should prevent setApprovalForAll for non-primary marketplace before first sale", async function () {
            // Пытаемся выдать одобрение на все токены для стороннего маркетплейса
            await expect(
                deWildClub.connect(artist1).setApprovalForAll(marketplace.address, true)
            ).to.be.revertedWith("First sale must go through primary market");
        });

        it("Should allow setApprovalForAll for primary marketplace", async function () {
            // Выдаем одобрение на все токены для primaryMarket
            await deWildClub.connect(artist1).setApprovalForAll(await primaryMarket.getAddress(), true);
            expect(
                await deWildClub.isApprovedForAll(artist1.address, await primaryMarket.getAddress())
            ).to.be.true;
        });

        it("Should allow all approvals after token is marked as sold by primaryMarket", async function () {
            // Создаем аукцион
            await deWildClub.connect(artist1).approve(await primaryMarket.getAddress(), tokenId);
            await primaryMarket.connect(artist1).createAuction(tokenId, MIN_START_PRICE);
            
            // Делаем ставку, чтобы аукцион завершился успешно
            await primaryMarket.connect(collector).placeBid(tokenId, { value: MIN_START_PRICE });
            
            // Увеличиваем время, чтобы аукцион можно было завершить
            await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            // Завершаем аукцион (это автоматически вызовет markAsSold)
            await primaryMarket.connect(owner).endAuction(tokenId);
            
            // Проверяем, что токен отмечен как проданный
            expect(await deWildClub.hasBeenSold(tokenId)).to.be.true;
            
            // NFT теперь должен быть у collector, поэтому дальнейшие тесты будем делать с ним
            expect(await deWildClub.ownerOf(tokenId)).to.equal(collector.address);
    
            // Теперь collector может апрувить для любого адреса
            await deWildClub.connect(collector).approve(marketplace.address, tokenId);
            expect(await deWildClub.getApproved(tokenId)).to.equal(marketplace.address);
    
            await deWildClub.connect(collector).setApprovalForAll(marketplace.address, true);
            expect(await deWildClub.isApprovedForAll(collector.address, marketplace.address)).to.be.true;
        });
    
        it("Should maintain restrictions for other tokens when one is marked as sold", async function () {
            // Минтим второй токен
            await deWildClub.connect(owner).approveArtist(artist2.address);
            const signature = await signMessage(owner, artist2.address);
            await deWildMinter.connect(artist2).mint(signature, { value: MINT_PRICE });
            const tokenId2 = BigInt(2);
    
            // Продаем первый токен через аукцион
            await deWildClub.connect(artist1).approve(await primaryMarket.getAddress(), tokenId);
            await primaryMarket.connect(artist1).createAuction(tokenId, MIN_START_PRICE);
            await primaryMarket.connect(collector).placeBid(tokenId, { value: MIN_START_PRICE });
            
            // Увеличиваем время, чтобы аукцион можно было завершить
            await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            await primaryMarket.connect(owner).endAuction(tokenId);
    
            // Проверяем, что первый токен отмечен как проданный
            expect(await deWildClub.hasBeenSold(tokenId)).to.be.true;
    
            // Первый токен не должен иметь ограничений (у коллекционера)
            await deWildClub.connect(collector).approve(marketplace.address, tokenId);
            expect(await deWildClub.getApproved(tokenId)).to.equal(marketplace.address);
    
            // Второй токен все еще должен иметь ограничения
            await expect(
                deWildClub.connect(artist2).approve(marketplace.address, tokenId2)
            ).to.be.revertedWith("First sale must go through primary market");
        });
    
        it("Should allow only primaryMarket to mark token as sold", async function () {
            // Владелец контракта пытается вызвать markAsSold (должно быть запрещено)
            await expect(
                deWildClub.connect(owner).markAsSold(tokenId)
            ).to.be.revertedWith("Only primary market can mark as sold");
            
            // Теперь проверяем через нормальный аукцион
            await deWildClub.connect(artist1).approve(await primaryMarket.getAddress(), tokenId);
            await primaryMarket.connect(artist1).createAuction(tokenId, MIN_START_PRICE);
            await primaryMarket.connect(collector).placeBid(tokenId, { value: MIN_START_PRICE });
            
            // Увеличиваем время, чтобы аукцион можно было завершить
            await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            await primaryMarket.connect(owner).endAuction(tokenId);
            
            // Проверяем, что токен отмечен как проданный
            expect(await deWildClub.hasBeenSold(tokenId)).to.be.true;
        });
    });

    describe("Full auction flow with approval restrictions", function() {
        let tokenId: bigint;
        
        beforeEach(async function() {
            // Минтим токен для артиста
            await deWildClub.connect(owner).approveArtist(artist1.address);
            const signature = await signMessage(owner, artist1.address);
            await deWildMinter.connect(artist1).mint(signature, { value: MINT_PRICE });
            tokenId = BigInt(1);
        });
        
        it("Should enforce approval restrictions through full auction flow", async function() {
            // 1. Проверяем, что нельзя апрувить для стороннего маркетплейса
            await expect(
                deWildClub.connect(artist1).approve(marketplace.address, tokenId)
            ).to.be.revertedWith("First sale must go through primary market");
            
            // 2. Апрувим для primaryMarket
            await deWildClub.connect(artist1).approve(await primaryMarket.getAddress(), tokenId);
            
            // 3. Создаем аукцион
            await primaryMarket.connect(artist1).createAuction(tokenId, MIN_START_PRICE);
            
            // 4. Размещаем ставку от коллекционера
            await primaryMarket.connect(collector).placeBid(tokenId, { value: MIN_START_PRICE });
            
            // Увеличиваем время, чтобы аукцион можно было завершить
            await ethers.provider.send("evm_increaseTime", [24 * 60 * 60 + 1]);
            await ethers.provider.send("evm_mine", []);
            
            // 5. Завершаем аукцион (это должно автоматически пометить токен как проданный)
            await primaryMarket.connect(owner).endAuction(tokenId);
            
            // 6. Проверяем, что токен помечен как проданный
            expect(await deWildClub.hasBeenSold(tokenId)).to.be.true;
            
            // 7. Проверяем, что коллекционер теперь владелец токена
            expect(await deWildClub.ownerOf(tokenId)).to.equal(collector.address);
            
            // 8. Теперь коллекционер может апрувить для любого маркетплейса
            await deWildClub.connect(collector).approve(marketplace.address, tokenId);
            expect(await deWildClub.getApproved(tokenId)).to.equal(marketplace.address);
        });
    });
});