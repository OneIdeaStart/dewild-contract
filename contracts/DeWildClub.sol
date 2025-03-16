// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "hardhat/console.sol";

interface IRoyaltySplitter {
   function setTokenArtist(uint256 tokenId, address artist) external;
}

contract DeWildClub is ERC721Enumerable, ERC2981, Ownable, ReentrancyGuard {
  using Strings for uint256;

  uint256 private _totalSupply;
  uint256 public constant MAX_SUPPLY = 11111;
  uint256 public constant MINT_PRICE = 0.0011 ether;

  // Royalties for secondary sales through ERC2981
  uint96 public constant SECONDARY_ARTIST_SHARE = 250;  // 2.5%
  uint96 public constant SECONDARY_TEAM_SHARE = 250;    // 2.5%
  uint96 public constant SECONDARY_TOTAL_SHARE = SECONDARY_ARTIST_SHARE + SECONDARY_TEAM_SHARE; // 5%

  string private _baseTokenURI;
  mapping(address => bool) public approvedArtists;
  mapping(address => bool) public hasMinted;
  mapping(uint256 => address) public tokenArtists;
  mapping(uint256 => bool) public hasBeenSold;
  
  address public mintContract;
  address public royaltySplitter;
  address public primaryMarket;

  event ArtistApproved(address indexed artist);
  event ArtistRevoked(address indexed artist);
  event NFTMinted(uint256 indexed tokenId, address indexed artist);
  event MinterUpdated(address indexed newMinter);
  event RoyaltySplitterUpdated(address indexed newSplitter);
  event PrimaryMarketUpdated(address indexed newMarket);
  event TokenMarkedAsSold(uint256 indexed tokenId);

  constructor(
      string memory name,
      string memory symbol,
      string memory baseURI
  ) ERC721(name, symbol) Ownable(msg.sender) {
      _baseTokenURI = baseURI;
  }

  function setMintContract(address _mintContract) external onlyOwner {
      require(_mintContract != address(0), "Invalid minter address");
      mintContract = _mintContract;
      emit MinterUpdated(_mintContract);
  }

  function setRoyaltySplitter(address _splitter) external onlyOwner {
      require(_splitter != address(0), "Invalid splitter address");
      royaltySplitter = _splitter;
      emit RoyaltySplitterUpdated(_splitter);
  }
  
  function setPrimaryMarket(address _primaryMarket) external onlyOwner {
      require(_primaryMarket != address(0), "Invalid market address");
      primaryMarket = _primaryMarket;
      emit PrimaryMarketUpdated(_primaryMarket);
  }

  function approveArtist(address artist) external onlyOwner {
      require(artist != address(0), "Invalid address");
      approvedArtists[artist] = true;
      emit ArtistApproved(artist);
  }

  function revokeArtist(address artist) external onlyOwner {
      require(artist != address(0), "Invalid address");
      approvedArtists[artist] = false;
      emit ArtistRevoked(artist);
  }

  function mint() external payable nonReentrant {
      console.log("DeWildClub mint called by:", msg.sender);
      console.log("Authorized minter:", mintContract);
      console.log("Artist (tx.origin):", tx.origin);

      require(msg.sender == mintContract, "Mint only through official interface");
      require(approvedArtists[tx.origin], "Artist not approved");
      require(!hasMinted[tx.origin], "Artist already minted");
      require(msg.value >= MINT_PRICE, "Insufficient payment");
      require(_totalSupply < MAX_SUPPLY, "Max supply reached");

      hasMinted[tx.origin] = true;
      _totalSupply++;
      uint256 tokenId = _totalSupply;

      _safeMint(tx.origin, tokenId);
      tokenArtists[tokenId] = tx.origin;
      
      // Set royalties in splitter
      require(royaltySplitter != address(0), "Splitter not set");
      _setTokenRoyalty(
          tokenId,
          royaltySplitter,
          SECONDARY_TOTAL_SHARE
      );

      // Inform splitter about the new token
      IRoyaltySplitter(royaltySplitter).setTokenArtist(tokenId, tx.origin);

      (bool success, ) = owner().call{value: msg.value}("");
      require(success, "Transfer to owner failed");

      emit NFTMinted(tokenId, tx.origin);
  }
  
  // Override approve to restrict NFT approval before first sale
  function approve(address to, uint256 tokenId) public override(ERC721, IERC721) {
      // Check if token has been sold yet
      if (!hasBeenSold[tokenId]) {
          // If not sold, only allow approval for primaryMarket
          require(to == primaryMarket, "First sale must go through primary market");
      }
      
      // Call parent implementation
      super.approve(to, tokenId);
  }

  // Override setApprovalForAll to restrict approvals before first sale
  function setApprovalForAll(address operator, bool approved) public override(ERC721, IERC721) {
      // If enabling approval
      if (approved) {
          // Check if user has any unsold tokens
          uint256 balance = balanceOf(_msgSender());
          
          for (uint256 i = 0; i < balance; i++) {
              uint256 tokenId = tokenOfOwnerByIndex(_msgSender(), i);
              if (!hasBeenSold[tokenId]) {
                  // If user has any unsold tokens, only allow approval for primaryMarket
                  require(operator == primaryMarket, "First sale must go through primary market");
                  break;
              }
          }
      }
      
      // Call parent implementation
      super.setApprovalForAll(operator, approved);
  }
  
  // Override _update to allow free transfers but restrict first sale
  function _update(
      address to,
      uint256 tokenId,
      address auth
  ) internal override returns (address) {
      address from = _ownerOf(tokenId);

      // If this is not a mint or burn, and the destination is the primaryMarket
      if (from != address(0) && to != address(0) && to == primaryMarket) {
          // Mark as being sold on our marketplace
          // No restrictions here - allow transfer to primary market
      } 
      
      // Call the parent implementation to handle the transfer
      return super._update(to, tokenId, auth);
  }

  // Mark token as sold (can only be called by primary market)
  function markAsSold(uint256 tokenId) external {
      require(msg.sender == primaryMarket, "Only primary market can mark as sold");
      hasBeenSold[tokenId] = true;
      emit TokenMarkedAsSold(tokenId);
  }

  function royaltyInfo(uint256 tokenId, uint256 salePrice) 
      public 
      view 
      override 
      returns (address receiver, uint256 royaltyAmount) 
  {
      require(_ownerOf(tokenId) != address(0), "Token does not exist");
      return (royaltySplitter, (salePrice * SECONDARY_TOTAL_SHARE) / 10000);
  }

  function _baseURI() internal view override returns (string memory) {
      return _baseTokenURI;
  }

  function setBaseURI(string memory newBaseURI) external onlyOwner {
      _baseTokenURI = newBaseURI;
  }

  function supportsInterface(bytes4 interfaceId)
      public
      view
      override(ERC721Enumerable, ERC2981)
      returns (bool)
  {
      return super.supportsInterface(interfaceId);
  }

  receive() external payable {}
  fallback() external payable {}
}