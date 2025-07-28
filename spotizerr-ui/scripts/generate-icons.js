import sharp from 'sharp';
import { existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import toIco from 'to-ico';

// Helper function to create a rounded square mask
async function createRoundedSquareMask(size, radius) {
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
    </svg>
  `;
  return Buffer.from(svg);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const publicDir = join(__dirname, '../public');
const svgPath = join(publicDir, 'spotizerr.svg');

async function generateIcons() {
  try {
    // Check if the SVG file exists
    if (!existsSync(svgPath)) {
      throw new Error(`SVG file not found at ${svgPath}. Please ensure spotizerr.svg exists in the public directory.`);
    }

    console.log('🎨 Generating PWA icons from SVG...');

    // First, convert SVG to PNG and process it
    console.log('📐 Processing SVG: converting to PNG, scaling by 0.67, and centering in black box...');
    
    // Create a base canvas size for processing
    const baseCanvasSize = 1000;
    const scaleFactor = 3;
    
    // Convert SVG to PNG and get its dimensions
    const svgToPng = await sharp(svgPath)
      .png()
      .toBuffer();
    
    const svgMetadata = await sharp(svgToPng).metadata();
    const svgWidth = svgMetadata.width;
    const svgHeight = svgMetadata.height;
    
    // Calculate scaled dimensions
    const scaledWidth = Math.round(svgWidth * scaleFactor);
    const scaledHeight = Math.round(svgHeight * scaleFactor);
    
    // Calculate centering offsets
    const offsetX = Math.round((baseCanvasSize - scaledWidth) / 2);
    const offsetY = Math.round((baseCanvasSize - scaledHeight) / 2);
    
    // Create the processed base image: scale SVG and center in black box
    const processedImage = await sharp({
      create: {
        width: baseCanvasSize,
        height: baseCanvasSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 } // Pure black background
      }
    })
    .composite([{
      input: await sharp(svgToPng)
        .resize(scaledWidth, scaledHeight)
        .png()
        .toBuffer(),
      top: offsetY,
      left: offsetX
    }])
    .png()
    .toBuffer();

    console.log(`✅ Processed SVG: ${svgWidth}x${svgHeight} → scaled to ${scaledWidth}x${scaledHeight} → centered in ${baseCanvasSize}x${baseCanvasSize} black box`);
    
    // Save the processed base image for reference
    await sharp(processedImage)
      .png()
      .toFile(join(publicDir, 'spotizerr.png'));
    
    console.log(`✅ Saved processed base image as spotizerr.png (${baseCanvasSize}x${baseCanvasSize})`);
    
    const sourceSize = baseCanvasSize;

    // Define icon configurations
    const iconConfigs = [
      { 
        size: 16, 
        name: 'favicon-16x16.png',
        padding: 0.1, // 10% padding for small icons
        rounded: true,
        cornerRadius: 3, // 3px radius for small icons
      },
      { 
        size: 32, 
        name: 'favicon-32x32.png',
        padding: 0.1,
        rounded: true,
        cornerRadius: 6, // 6px radius
      },
      { 
        size: 180, 
        name: 'apple-touch-icon-180x180.png',
        padding: 0.05, // 5% padding for Apple (they prefer less padding)
        rounded: true,
        cornerRadius: 32, // ~18% radius for Apple icons
      },
      { 
        size: 192, 
        name: 'pwa-192x192.png',
        padding: 0.1,
        rounded: true,
        cornerRadius: 34, // ~18% radius
      },
      { 
        size: 512, 
        name: 'pwa-512x512.png',
        padding: 0.1,
        rounded: true,
        cornerRadius: 92, // ~18% radius
      }
    ];

    // Use the processed image as source
    const sourceImage = sharp(processedImage);

    for (const config of iconConfigs) {
      const { size, name, padding, rounded, cornerRadius } = config;
      
      let finalIcon;
      
      if (padding > 0) {
        // Create icon with padding by compositing on a background
        const paddedSize = Math.round(size * (1 - padding * 2));
        const offset = Math.round((size - paddedSize) / 2);

        // Create a pure black background and composite the resized logo on top
        finalIcon = await sharp({
          create: {
            width: size,
            height: size,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 } // Pure black background
          }
        })
        .composite([{
          input: await sourceImage.resize(paddedSize, paddedSize).png().toBuffer(),
          top: offset,
          left: offset
        }])
        .png()
        .toBuffer();
      } else {
        // Direct resize without padding
        finalIcon = await sourceImage
          .resize(size, size)
          .png()
          .toBuffer();
      }

      // Apply rounded corners if specified
      if (rounded && cornerRadius > 0) {
        const mask = await createRoundedSquareMask(size, cornerRadius);
        finalIcon = await sharp(finalIcon)
          .composite([{
            input: mask,
            blend: 'dest-in'
          }])
          .png()
          .toBuffer();
      }

      // Write the final icon to file
      await sharp(finalIcon).toFile(join(publicDir, name));

      const roundedText = rounded ? ` - rounded (${cornerRadius}px)` : '';
      console.log(`✅ Generated ${name} (${size}x${size}) - padding: ${padding * 100}%${roundedText}`);
    }

    // Create maskable icon (less padding, solid background, rounded)
    const maskableSize = 512;
    const maskablePadding = 0.05; // 5% padding for maskable icons
    const maskableRadius = 92; // ~18% radius for consistency
    const maskablePaddedSize = Math.round(maskableSize * (1 - maskablePadding * 2));
    const maskableOffset = Math.round((maskableSize - maskablePaddedSize) / 2);

    let maskableIcon = await sharp({
      create: {
        width: maskableSize,
        height: maskableSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 } // Pure black background for maskable
      }
    })
    .composite([{
      input: await sourceImage.resize(maskablePaddedSize, maskablePaddedSize).png().toBuffer(),
      top: maskableOffset,
      left: maskableOffset
    }])
    .png()
    .toBuffer();

    // Apply rounded corners to maskable icon
    const maskableMask = await createRoundedSquareMask(maskableSize, maskableRadius);
    maskableIcon = await sharp(maskableIcon)
      .composite([{
        input: maskableMask,
        blend: 'dest-in'
      }])
      .png()
      .toBuffer();

    await sharp(maskableIcon).toFile(join(publicDir, 'pwa-512x512-maskable.png'));

    console.log(`✅ Generated pwa-512x512-maskable.png (${maskableSize}x${maskableSize}) - maskable, rounded (${maskableRadius}px)`);

    // Generate additional favicon sizes for ICO compatibility (with rounded corners)
    const additionalSizes = [48, 64, 96, 128, 256];
    for (const size of additionalSizes) {
      const padding = size <= 48 ? 0.05 : 0.1;
      const paddedSize = Math.round(size * (1 - padding * 2));
      const offset = Math.round((size - paddedSize) / 2);
      
      // Calculate corner radius proportional to size (~18% for larger icons, smaller for tiny ones)
      const cornerRadius = size <= 48 ? Math.round(size * 0.125) : Math.round(size * 0.18);

      let additionalIcon = await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 } // Pure black background
        }
      })
      .composite([{
        input: await sourceImage.resize(paddedSize, paddedSize).png().toBuffer(),
        top: offset,
        left: offset
      }])
      .png()
      .toBuffer();

      // Apply rounded corners
      const additionalMask = await createRoundedSquareMask(size, cornerRadius);
      additionalIcon = await sharp(additionalIcon)
        .composite([{
          input: additionalMask,
          blend: 'dest-in'
        }])
        .png()
        .toBuffer();

      await sharp(additionalIcon).toFile(join(publicDir, `favicon-${size}x${size}.png`));

      console.log(`✅ Generated favicon-${size}x${size}.png (${size}x${size}) - padding: ${padding * 100}%, rounded (${cornerRadius}px)`);
    }

    // Generate favicon.ico with multiple sizes (rounded)
    console.log('🎯 Generating favicon.ico with rounded corners...');
    const icoSizes = [16, 32, 48];
    const icoBuffers = [];

    for (const size of icoSizes) {
      const padding = 0.1; // 10% padding for ICO
      const paddedSize = Math.round(size * (1 - padding * 2));
      const offset = Math.round((size - paddedSize) / 2);
      const cornerRadius = size <= 32 ? Math.round(size * 0.125) : Math.round(size * 0.18);

      let icoIcon = await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 } // Pure black background
        }
      })
      .composite([{
        input: await sourceImage.resize(paddedSize, paddedSize).png().toBuffer(),
        top: offset,
        left: offset
      }])
      .png()
      .toBuffer();

      // Apply rounded corners to ICO icon
      const icoMask = await createRoundedSquareMask(size, cornerRadius);
      const roundedIcoIcon = await sharp(icoIcon)
        .composite([{
          input: icoMask,
          blend: 'dest-in'
        }])
        .png()
        .toBuffer();

      icoBuffers.push(roundedIcoIcon);
    }

    // Create the ICO file
    const icoBuffer = await toIco(icoBuffers);
    writeFileSync(join(publicDir, 'favicon.ico'), icoBuffer);

    console.log(`✅ Generated favicon.ico (${icoSizes.join('x, ')}x sizes) - multi-size ICO, rounded corners`);
    
    console.log('🎉 All PWA icons generated successfully with rounded corners!');
    console.log('');
    console.log('📋 Generated files:');
    iconConfigs.forEach(config => {
      console.log(`   • ${config.name} (${config.size}x${config.size}) - rounded`);
    });
    console.log('   • pwa-512x512-maskable.png (512x512) - rounded');
    additionalSizes.forEach(size => {
      console.log(`   • favicon-${size}x${size}.png (${size}x${size}) - rounded`);
    });
    console.log('   • favicon.ico (multi-size: 16x16, 32x32, 48x48) - rounded');
    console.log('');
    console.log('💡 Icons generated from SVG source, scaled by 0.67, and centered on pure black backgrounds.');
    console.log('💡 All icons feature rounded corners for a modern, polished appearance.');
    console.log('💡 Corner radius scales proportionally with icon size (~18% for larger icons, ~12.5% for smaller ones).');
    console.log('💡 favicon.ico contains multiple sizes for optimal browser compatibility.');

  } catch (error) {
    console.error('❌ Error generating PWA icons:', error);
    process.exit(1);
  }
}

generateIcons(); 