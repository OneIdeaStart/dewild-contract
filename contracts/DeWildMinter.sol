// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "hardhat/console.sol";

interface IDeWildClub {
   function mint() external payable;
}

contract DeWildMinter is Ownable {
   using ECDSA for bytes32;
   using MessageHashUtils for bytes32;

   address payable public nftContract;
   mapping(bytes32 => bool) public usedSignatures;

   event NFTContractUpdated(address indexed newContract);
   
   constructor(address payable _nftContract) Ownable(msg.sender) {
       require(_nftContract != address(0), "Invalid NFT contract address");
       nftContract = _nftContract;
   }
   
   function mint(bytes calldata signature) external payable {
       console.log("Minting through contract:", address(this));
       console.log("NFT contract address:", nftContract);
       console.log("Sender:", msg.sender);
       console.log("Owner:", owner());

       // Проверяем подпись
       bytes32 hash = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(msg.sender)));
       address signer = hash.recover(signature);        
       require(signer == owner(), "Invalid signature");

       // Проверяем, что отправлено достаточно ETH
       require(msg.value >= 0.0011 ether, "Insufficient payment");

       // Сначала делаем минт (проверка на повторный минт произойдет здесь)
       IDeWildClub(nftContract).mint{value: msg.value}();
       
       // Только после успешного минта сохраняем подпись
       require(!usedSignatures[hash], "Signature already used");    
       usedSignatures[hash] = true;
   }

   receive() external payable {}
}