import sharp from 'sharp';
import { existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import toIco from 'to-ico';

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
      },
      { 
        size: 32, 
        name: 'favicon-32x32.png',
        padding: 0.1,
      },
      { 
        size: 180, 
        name: 'apple-touch-icon-180x180.png',
        padding: 0.05, // 5% padding for Apple (they prefer less padding)
      },
      { 
        size: 192, 
        name: 'pwa-192x192.png',
        padding: 0.1,
      },
      { 
        size: 512, 
        name: 'pwa-512x512.png',
        padding: 0.1,
      }
    ];

    // Use the processed image as source
    const sourceImage = sharp(processedImage);

    for (const config of iconConfigs) {
      const { size, name, padding } = config;
      
      if (padding > 0) {
        // Create icon with padding by compositing on a background
        const paddedSize = Math.round(size * (1 - padding * 2));
        const offset = Math.round((size - paddedSize) / 2);

        // Create a pure black background and composite the resized logo on top
        await sharp({
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
        .toFile(join(publicDir, name));
      } else {
        // Direct resize without padding
        await sourceImage
          .resize(size, size)
          .png()
          .toFile(join(publicDir, name));
      }

      console.log(`✅ Generated ${name} (${size}x${size}) - padding: ${padding * 100}%`);
    }

    // Create maskable icon (less padding, solid background)
    const maskableSize = 512;
    const maskablePadding = 0.05; // 5% padding for maskable icons
    const maskablePaddedSize = Math.round(maskableSize * (1 - maskablePadding * 2));
    const maskableOffset = Math.round((maskableSize - maskablePaddedSize) / 2);

    await sharp({
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
    .toFile(join(publicDir, 'pwa-512x512-maskable.png'));

    console.log(`✅ Generated pwa-512x512-maskable.png (${maskableSize}x${maskableSize}) - maskable`);

    // Generate additional favicon sizes for ICO compatibility
    const additionalSizes = [48, 64, 96, 128, 256];
    for (const size of additionalSizes) {
      const padding = size <= 48 ? 0.05 : 0.1;
      const paddedSize = Math.round(size * (1 - padding * 2));
      const offset = Math.round((size - paddedSize) / 2);

      await sharp({
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
      .toFile(join(publicDir, `favicon-${size}x${size}.png`));

      console.log(`✅ Generated favicon-${size}x${size}.png (${size}x${size}) - padding: ${padding * 100}%`);
    }

    // Generate favicon.ico with multiple sizes
    console.log('🎯 Generating favicon.ico...');
    const icoSizes = [16, 32, 48];
    const icoBuffers = [];

    for (const size of icoSizes) {
      const padding = 0.1; // 10% padding for ICO
      const paddedSize = Math.round(size * (1 - padding * 2));
      const offset = Math.round((size - paddedSize) / 2);

      const buffer = await sharp({
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

      icoBuffers.push(buffer);
    }

    // Create the ICO file
    const icoBuffer = await toIco(icoBuffers);
    writeFileSync(join(publicDir, 'favicon.ico'), icoBuffer);

    console.log(`✅ Generated favicon.ico (${icoSizes.join('x, ')}x sizes) - multi-size ICO`);
    
    console.log('🎉 All PWA icons generated successfully!');
    console.log('');
    console.log('📋 Generated files:');
    iconConfigs.forEach(config => {
      console.log(`   • ${config.name} (${config.size}x${config.size})`);
    });
    console.log('   • pwa-512x512-maskable.png (512x512)');
    additionalSizes.forEach(size => {
      console.log(`   • favicon-${size}x${size}.png (${size}x${size})`);
    });
    console.log('   • favicon.ico (multi-size: 16x16, 32x32, 48x48)');
    console.log('');
    console.log('💡 Icons generated from SVG source, scaled by 0.67, and centered on pure black backgrounds.');
    console.log('💡 The SVG logo is automatically processed and optimized for all icon formats.');
    console.log('💡 favicon.ico contains multiple sizes for optimal browser compatibility.');

  } catch (error) {
    console.error('❌ Error generating PWA icons:', error);
    process.exit(1);
  }
}

generateIcons(); 