// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract RoyaltySplitter is Ownable, ReentrancyGuard {
    // Маппинг артистов для каждого tokenId (для совместимости с ERC2981)
    mapping(uint256 => address) public tokenArtists;
    // Адрес NFT контракта, который может устанавливать артистов
    address public nftContract;
    // Адрес кошелька для роялти
    address public royaltyWallet;
    
    event RoyaltiesReceived(uint256 indexed tokenId, uint256 amount);
    event GenericRoyaltiesReceived(uint256 amount);
    event TokenArtistSet(uint256 indexed tokenId, address indexed artist);
    event NFTContractUpdated(address indexed newContract);
    event RoyaltyWalletUpdated(address indexed newWallet);
    
    constructor() Ownable(msg.sender) {
        // По умолчанию royaltyWallet - это владелец контракта
        royaltyWallet = msg.sender;
    }

    // Установка адреса кошелька роялти
    function setRoyaltyWallet(address _royaltyWallet) external onlyOwner {
        require(_royaltyWallet != address(0), "Invalid wallet address");
        royaltyWallet = _royaltyWallet;
        emit RoyaltyWalletUpdated(_royaltyWallet);
    }

    // Установка адреса NFT контракта
    function setNFTContract(address _nftContract) external onlyOwner {
        require(_nftContract != address(0), "Invalid NFT address");
        nftContract = _nftContract;
        emit NFTContractUpdated(_nftContract);
    }

    // Установка артиста для tokenId (вызывается NFT контрактом при минте)
    // Сохраняем для совместимости и для возможности использования в скрипте
    function setTokenArtist(uint256 tokenId, address artist) external {
        // Проверяем что вызывающий - или владелец, или NFT контракт
        require(
            msg.sender == owner() || 
            (nftContract != address(0) && msg.sender == nftContract), 
            "Not authorized"
        );
        
        require(artist != address(0), "Invalid artist address");
        tokenArtists[tokenId] = artist;
        emit TokenArtistSet(tokenId, artist);
    }

    // Получение роялти с указанием tokenId
    // Теперь просто отправляем все на royaltyWallet, но логируем tokenId для скрипта
    function receiveRoyalties(uint256 tokenId) external payable nonReentrant {
        require(msg.value > 0, "No royalties");
        
        // Проверяем только валидность tokenId
        require(tokenArtists[tokenId] != address(0), "Artist not set for token");
        
        // Отправляем 100% на кошелек роялти
        (bool success, ) = payable(royaltyWallet).call{value: msg.value}("");
        require(success, "Royalty payment failed");
        
        emit RoyaltiesReceived(tokenId, msg.value);
    }
    
    // Получение роялти без указания tokenId
    receive() external payable {
        require(msg.value > 0, "No royalties received");
        
        // Отправляем 100% на кошелек роялти
        (bool success, ) = payable(royaltyWallet).call{value: msg.value}("");
        require(success, "Royalty payment failed");
        
        emit GenericRoyaltiesReceived(msg.value);
    }
}