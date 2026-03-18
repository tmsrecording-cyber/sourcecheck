#!/usr/bin/env node
/**
 * Generate PNG icons from SVG source using Playwright
 * This script renders the SVG at multiple sizes for extension icons
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const SIZES = [16, 32, 48, 128];
const SVG_PATH = join(PROJECT_ROOT, 'public', 'assets', 'icon-source.svg');
const OUTPUT_DIR = join(PROJECT_ROOT, 'public', 'icons');

async function generateIcons() {
  console.log('🎨 Generating SourceCheck icons from SVG source...');
  
  const svgContent = readFileSync(SVG_PATH, 'utf-8');
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgContent).toString('base64')}`;
  
  const browser = await chromium.launch();
  
  try {
    for (const size of SIZES) {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
      });
      
      // Create HTML page with SVG rendered at exact size
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { 
                width: ${size}px; 
                height: ${size}px; 
                display: flex; 
                align-items: center; 
                justify-content: center;
                background: transparent;
              }
              svg { 
                width: 100%; 
                height: 100%; 
                display: block;
              }
            </style>
          </head>
          <body>
            ${svgContent.replace('viewBox="0 0 100 100"', `viewBox="0 0 100 100" width="${size}" height="${size}"`)}
          </body>
        </html>
      `;
      
      await page.setContent(html, { waitUntil: 'networkidle' });
      
      // Take screenshot
      const buffer = await page.screenshot({
        type: 'png',
        omitBackground: true,
      });
      
      const outputPath = join(OUTPUT_DIR, `${size}.png`);
      writeFileSync(outputPath, buffer);
      console.log(`  ✓ Generated ${size}x${size} -> icons/${size}.png`);
      
      await page.close();
    }
    
    // Also generate 24px for UI use
    const page24 = await browser.newPage({
      viewport: { width: 24, height: 24 },
    });
    
    const html24 = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              width: 24px; 
              height: 24px; 
              display: flex; 
              align-items: center; 
              justify-content: center;
              background: transparent;
            }
            svg { 
              width: 100%; 
              height: 100%; 
              display: block;
            }
          </style>
        </head>
        <body>
          ${svgContent.replace('viewBox="0 0 100 100"', `viewBox="0 0 100 100" width="24" height="24"`)}
        </body>
      </html>
    `;
    
    await page24.setContent(html24, { waitUntil: 'networkidle' });
    const buffer24 = await page24.screenshot({
      type: 'png',
      omitBackground: true,
    });
    writeFileSync(join(OUTPUT_DIR, '24.png'), buffer24);
    console.log(`  ✓ Generated 24x24 -> icons/24.png`);
    await page24.close();
    
    console.log('\n✅ All icons generated successfully!');
  } finally {
    await browser.close();
  }
}

generateIcons().catch(err => {
  console.error('❌ Error generating icons:', err);
  process.exit(1);
});
