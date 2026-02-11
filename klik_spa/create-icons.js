const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

async function createIcons() {
	// Use ROSE_LOGO.png from app public images (favicon & PWA icons generated from it)
	const inputFile = path.join(__dirname, "..", "public", "images", "ROSE_LOGO.png");
	const publicDir = path.join(__dirname, "public");

	// Create different icon sizes
	const sizes = [
		{ size: 192, filename: "icon-192x192.png" },
		{ size: 512, filename: "icon-512x512.png" },
	];

	for (const { size, filename } of sizes) {
		try {
			await sharp(inputFile)
				.resize(size, size, {
					fit: "contain",
					background: { r: 255, g: 255, b: 255, alpha: 0 },
				})
				.png()
				.toFile(path.join(publicDir, filename));

			console.log(`Created ${filename}`);
		} catch (error) {
			console.error(`Error creating ${filename}:`, error);
		}
	}

	// Also create a favicon
	try {
		await sharp(inputFile)
			.resize(32, 32, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
			.png()
			.toFile(path.join(publicDir, "favicon.png"));

		console.log("Created favicon.png");
	} catch (error) {
		console.error("Error creating favicon:", error);
	}
}

createIcons()
	.then(() => {
		console.log("All icons created successfully!");
		process.exit(0);
	})
	.catch((error) => {
		console.error("Error creating icons:", error);
		process.exit(1);
	});
