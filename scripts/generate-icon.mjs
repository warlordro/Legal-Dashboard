import sharp from "sharp";
import pngToIco from "png-to-ico";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const buildDir = resolve(root, "build");

mkdirSync(buildDir, { recursive: true });

// SVG icon: Blue rounded square background + white scales icon
// Matches the sidebar logo style exactly
function createIconSvg(size) {
  const padding = Math.round(size * 0.15);
  const iconSize = size - padding * 2;
  const radius = Math.round(size * 0.18);
  const strokeWidth = Math.max(1.5, size * 0.06);

  // Scale the 24x24 viewBox paths to fit
  const scale = iconSize / 24;
  const tx = padding;
  const ty = padding;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <!-- Blue rounded square background -->
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#2563eb"/>

  <!-- White scales icon -->
  <g transform="translate(${tx}, ${ty}) scale(${scale})"
     fill="none" stroke="white" stroke-width="${strokeWidth / scale}"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>
    <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/>
    <path d="M7 21h10"/>
    <path d="M12 3v18"/>
    <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>
  </g>
</svg>`;
}

const sizes = [16, 32, 48, 64, 128, 256, 512];

console.log("Generating app icons...\n");

// Generate PNG files for each size
const pngBuffers = {};
for (const size of sizes) {
  const svg = createIconSvg(size);
  const png = await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toBuffer();

  pngBuffers[size] = png;

  const pngPath = resolve(buildDir, `icon-${size}.png`);
  writeFileSync(pngPath, png);
  console.log(`  Created icon-${size}.png`);
}

// Generate .ico file (Windows) with multiple sizes
const icoSizes = [16, 32, 48, 256];
const icoInputs = icoSizes.map((s) => pngBuffers[s]);
const ico = await pngToIco(icoInputs);
const icoPath = resolve(buildDir, "icon.ico");
writeFileSync(icoPath, ico);
console.log(`\n  Created icon.ico (${icoSizes.join(", ")}px)`);

// Copy 512px as the main icon.png for electron-builder
const mainPngPath = resolve(buildDir, "icon.png");
writeFileSync(mainPngPath, pngBuffers[256]);
console.log(`  Created icon.png (256px)`);

console.log(`\nAll icons saved to: ${buildDir}`);
