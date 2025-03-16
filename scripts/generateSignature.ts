import { ethers } from "hardhat";

async function main() {
    // Адрес артиста, для которого генерируем подпись
    const ARTIST_ADDRESS = "0xdddC71EC0844d5b7239E9C89AFaF689B24c00825"; // Сюда вставить адрес артиста

    try {
        // Получаем owner аккаунт
        const [owner] = await ethers.getSigners();
        console.log("Generating signature using account:", owner.address);

        // Формируем хеш адреса артиста
        const hash = ethers.keccak256(
            ethers.solidityPacked(['address'], [ARTIST_ADDRESS])
        );

        // Получаем подпись
        const signature = await owner.signMessage(ethers.getBytes(hash));

        console.log("\nSignature generated successfully!");
        console.log("Artist Address:", ARTIST_ADDRESS);
        console.log("Signature:", signature);

        // Дополнительная проверка подписи
        // Получаем адрес подписавшего из подписи
        const messageHash = ethers.keccak256(ethers.solidityPacked(['address'], [ARTIST_ADDRESS]));
        const messageHashBytes = ethers.getBytes(messageHash);
        const signerAddress = ethers.recoverAddress(
            ethers.hashMessage(messageHashBytes),
            signature
        );

        console.log("\nVerification:");
        console.log("Recovered signer:", signerAddress);
        console.log("Expected signer:", owner.address);
        console.log("Signature is valid:", signerAddress === owner.address);

    } catch (error) {
        console.error("Error generating signature:", error);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});