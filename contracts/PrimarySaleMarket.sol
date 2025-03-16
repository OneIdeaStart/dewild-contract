// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

// Interface for DeWildClub NFT contract
interface IDeWildClub is IERC721 {
    function markAsSold(uint256 tokenId) external;
}

/**
 * @title PrimarySaleMarket
 * @dev Contract for primary sales of DeWild NFT collection with 75/25 split
 */
contract PrimarySaleMarket is Ownable, ReentrancyGuard, ERC721Holder {
    struct Auction {
        address artist;        // Artist address
        uint256 tokenId;       // Token ID on auction
        uint256 startPrice;    // Starting price
        uint256 currentBid;    // Current bid
        address highestBidder; // Current highest bidder
        uint256 endTime;       // Auction end time
        bool isActive;         // Is auction active
    }

    // NFT contract address
    IDeWildClub public nftContract;
    
    // Split constants
    uint256 public constant ARTIST_SHARE = 75; // 75%
    uint256 public constant TEAM_SHARE = 25;   // 25%
    
    // Minimum starting price for auction
    uint256 public constant MIN_START_PRICE = 0.011 ether;
    
    // Fixed auction duration (24 hours)
    uint256 public constant AUCTION_DURATION = 1 days;
    
    // Time threshold for extension (5 minutes)
    uint256 public constant TIME_EXTENSION_THRESHOLD = 5 minutes;
    
    // Extension duration (5 minutes)
    uint256 public constant EXTENSION_DURATION = 5 minutes;
    
    // Minimum bid increment (11%)
    uint256 public constant MIN_BID_INCREMENT = 11;
    
    // Auctions mapping
    mapping(uint256 => Auction) public auctions;
    
    // Events
    event AuctionCreated(uint256 indexed tokenId, address indexed artist, uint256 startPrice, uint256 endTime);
    event BidPlaced(uint256 indexed tokenId, address indexed bidder, uint256 amount);
    event AuctionEnded(uint256 indexed tokenId, address indexed winner, uint256 amount);
    event AuctionCancelled(uint256 indexed tokenId);
    event AuctionExtended(uint256 indexed tokenId, uint256 newEndTime);
    event PaymentSplit(uint256 indexed tokenId, address indexed artist, uint256 artistAmount, address team, uint256 teamAmount);

    /**
     * @dev Constructor
     * @param _nftContract NFT contract address
     */
    constructor(address _nftContract) Ownable(msg.sender) {
        require(_nftContract != address(0), "Invalid NFT contract address");
        nftContract = IDeWildClub(_nftContract);
    }

    /**
     * @dev Create auction with fixed 24h duration
     * @param tokenId Token ID
     * @param startPrice Starting price
     */
    function createAuction(
        uint256 tokenId, 
        uint256 startPrice
    ) external nonReentrant {
        require(nftContract.ownerOf(tokenId) == msg.sender, "Not token owner");
        require(!auctions[tokenId].isActive, "Auction already exists");
        require(startPrice >= MIN_START_PRICE, "Start price too low");
        
        // Transfer NFT to marketplace contract
        nftContract.safeTransferFrom(msg.sender, address(this), tokenId);
        
        // Set auction end time to 24 hours from now
        uint256 endTime = block.timestamp + AUCTION_DURATION;
        
        // Create auction
        auctions[tokenId] = Auction({
            artist: msg.sender,
            tokenId: tokenId,
            startPrice: startPrice,
            currentBid: 0,
            highestBidder: address(0),
            endTime: endTime,
            isActive: true
        });
        
        emit AuctionCreated(tokenId, msg.sender, startPrice, endTime);
    }

    /**
     * @dev Place bid with time extension logic
     * @param tokenId Token ID on auction
     */
    function placeBid(uint256 tokenId) external payable nonReentrant {
        Auction storage auction = auctions[tokenId];
        
        require(auction.isActive, "Auction not active");
        require(block.timestamp < auction.endTime, "Auction ended");
        require(msg.sender != auction.artist, "Artist cannot bid");
        
        uint256 minBid = auction.currentBid > 0 
            ? auction.currentBid + (auction.currentBid * MIN_BID_INCREMENT / 100) // +11% to current bid
            : auction.startPrice;
            
        require(msg.value >= minBid, "Bid too low");

        // Return previous bid
        if (auction.highestBidder != address(0)) {
            payable(auction.highestBidder).transfer(auction.currentBid);
        }

        auction.currentBid = msg.value;
        auction.highestBidder = msg.sender;
        
        // Check if bid was placed in the last 5 minutes
        if (auction.endTime - block.timestamp < TIME_EXTENSION_THRESHOLD) {
            // Extend auction by 5 minutes
            auction.endTime = block.timestamp + EXTENSION_DURATION;
            emit AuctionExtended(tokenId, auction.endTime);
        }
        
        emit BidPlaced(tokenId, msg.sender, msg.value);
    }

    /**
     * @dev End auction
     * @param tokenId Token ID on auction
     */
    function endAuction(uint256 tokenId) external nonReentrant {
        Auction storage auction = auctions[tokenId];
        
        require(auction.isActive, "Auction not active");
        require(
            block.timestamp >= auction.endTime || 
            (msg.sender == owner() && auction.highestBidder == address(0)) || 
            (msg.sender == auction.artist && auction.highestBidder == address(0)), 
            "Cannot end auction yet"
        );

        auction.isActive = false;

        if (auction.highestBidder != address(0)) {
            // Split payments 75/25
            uint256 artistAmount = (auction.currentBid * ARTIST_SHARE) / 100;
            uint256 teamAmount = auction.currentBid - artistAmount;
            
            // Send funds to artist
            (bool successArtist, ) = payable(auction.artist).call{value: artistAmount}("");
            require(successArtist, "Artist payment failed");
            
            // Send funds to team
            (bool successTeam, ) = payable(owner()).call{value: teamAmount}("");
            require(successTeam, "Team payment failed");
            
            // Mark token as sold
            nftContract.markAsSold(tokenId);
            
            // Transfer NFT to winner
            nftContract.safeTransferFrom(address(this), auction.highestBidder, tokenId);
            
            emit PaymentSplit(tokenId, auction.artist, artistAmount, owner(), teamAmount);
            emit AuctionEnded(tokenId, auction.highestBidder, auction.currentBid);
        } else {
            // Return NFT to artist if no bids
            nftContract.safeTransferFrom(address(this), auction.artist, tokenId);
            emit AuctionEnded(tokenId, address(0), 0);
        }
    }

    /**
     * @dev Cancel auction (only owner or artist)
     * @param tokenId Token ID on auction
     */
    function cancelAuction(uint256 tokenId) external nonReentrant {
        Auction storage auction = auctions[tokenId];
        
        require(auction.isActive, "Auction not active");
        require(
            msg.sender == owner() || msg.sender == auction.artist, 
            "Not authorized"
        );
        require(auction.highestBidder == address(0), "Cannot cancel auction with bids");

        auction.isActive = false;

        // Return NFT to artist
        nftContract.safeTransferFrom(address(this), auction.artist, tokenId);
        
        emit AuctionCancelled(tokenId);
    }

    /**
     * @dev Get auction info
     * @param tokenId Token ID
     * @return artist Artist address
     * @return startPrice Starting price
     * @return currentBid Current bid
     * @return highestBidder Highest bidder address
     * @return endTime End time
     * @return isActive Is auction active
     */
    function getAuction(uint256 tokenId) external view returns (
        address artist,
        uint256 startPrice,
        uint256 currentBid,
        address highestBidder,
        uint256 endTime,
        bool isActive
    ) {
        Auction storage auction = auctions[tokenId];
        return (
            auction.artist,
            auction.startPrice,
            auction.currentBid,
            auction.highestBidder,
            auction.endTime,
            auction.isActive
        );
    }

    /**
     * @dev Get auction remaining time
     * @param tokenId Token ID
     * @return Seconds remaining (0 if auction ended)
     */
    function getRemainingTime(uint256 tokenId) external view returns (uint256) {
        Auction storage auction = auctions[tokenId];
        
        if (!auction.isActive || block.timestamp >= auction.endTime) {
            return 0;
        }
        
        return auction.endTime - block.timestamp;
    }

    /**
     * @dev Get minimum bid for token
     * @param tokenId Token ID
     * @return Minimum bid
     */
    function getMinBid(uint256 tokenId) external view returns (uint256) {
        Auction storage auction = auctions[tokenId];
        
        if (!auction.isActive) {
            return 0;
        }
        
        return auction.currentBid > 0 
            ? auction.currentBid + (auction.currentBid * MIN_BID_INCREMENT / 100) // +11% to current bid
            : auction.startPrice;
    }
}