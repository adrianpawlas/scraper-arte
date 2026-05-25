import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { ArteScraper } from './scraper';
import { EmbeddingService } from './embedding-service';
import { SupabaseService } from './supabase-client';
import {
  ScrapedProduct,
  ProductRecord,
  ProcessingStats,
} from './types';
import {
  mapCategory,
  extractAllSizes,
  formatPrice,
  determineGender,
  sanitizeForEmbedding,
  buildMetadata,
} from './utils';

/**
 * Main scraper orchestrator.
 * 1. Scrape all products from Arte Antwerp
 * 2. Generate image and text embeddings using SigLIP
 * 3. Upload everything to Supabase
 */
async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  🛍️  Arte Antwerp Product Scraper');
  console.log('═══════════════════════════════════════════\n');

  const stats: ProcessingStats = {
    totalProducts: 0,
    scraped: 0,
    embedded: 0,
    uploaded: 0,
    failed: 0,
    errors: [],
  };

  // Validate environment
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const maxProducts = parseInt(process.env.MAX_PRODUCTS || 'Infinity', 10);
  const skipEmbeddings = process.env.SKIP_EMBEDDINGS === 'true';

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    console.error('   Local: create a .env file (see .env.example)');
    console.error('   CI:    add them as GitHub Secrets');
    process.exit(1);
  }

  // Initialize services
  const scraper = new ArteScraper({ maxProducts: isFinite(maxProducts) ? maxProducts : Infinity });
  const supabase = new SupabaseService(supabaseUrl, supabaseKey);
  const embeddingService = new EmbeddingService();

  // Check Supabase connection
  console.log('🔌 Checking Supabase connection...');
  const healthy = await supabase.healthCheck();
  if (!healthy) {
    console.error('❌ Cannot connect to Supabase. Check your credentials.');
    process.exit(1);
  }
  console.log('✅ Supabase connection OK\n');

  if (!skipEmbeddings && !embeddingService.isReady()) {
    console.warn('⚠ Embedding service not ready. Install Python dependencies:');
    console.warn('   pip install -r requirements.txt');
    console.warn('   Proceeding WITHOUT embeddings...\n');
  }

  // ==========================================
  // PHASE 1: Scrape all products
  // ==========================================
  console.log('📋 PHASE 1: Scraping products\n');
  
  const scrapedProducts = await scraper.scrapeAllProducts();
  stats.totalProducts = scrapedProducts.length;
  stats.scraped = scrapedProducts.length;

  if (scrapedProducts.length === 0) {
    console.log('❌ No products scraped. Exiting.');
    return;
  }

  // ==========================================
  // PHASE 2: Generate embeddings
  // ==========================================
  let imageEmbeddings: number[][] = [];
  let infoEmbeddings: number[][] = [];

  if (!skipEmbeddings && embeddingService.isReady()) {
    console.log('\n🧠 PHASE 2: Generating embeddings\n');

    // Generate image embeddings
    const imageUrls = scrapedProducts.map((p) => p.mainImageUrl).filter(Boolean);
    console.log(`📸 Processing ${imageUrls.length} product images for embeddings...`);

    try {
      // Process in batches of 10 to avoid overwhelming the model
      const batchSize = 10;
      for (let i = 0; i < imageUrls.length; i += batchSize) {
        const batch = imageUrls.slice(i, i + batchSize);
        console.log(`  Image batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(imageUrls.length / batchSize)}`);
        const batchEmbeddings = await embeddingService.generateImageEmbeddings(batch);
        imageEmbeddings.push(...batchEmbeddings);
      }
      console.log(`✅ Generated ${imageEmbeddings.length} image embeddings`);
    } catch (error) {
      console.error(`  ⚠ Failed to generate image embeddings:`, (error as Error).message);
    }

    // Generate text embeddings (info_embedding)
    const textInfos = scrapedProducts.map((p) => {
      const jsonLd = p.jsonLd;
      const product = p.shopifyProduct;
      const parts = [
        product.title,
        jsonLd?.description || '',
        mapCategory(product.product_type),
        ...product.tags,
        ...product.variants
          .filter((v) => v.available)
          .map((v) => `${v.title}: ${v.price} EUR`),
      ];
      return sanitizeForEmbedding(parts.filter(Boolean).join('. '));
    });

    console.log(`\n📝 Processing ${textInfos.length} product descriptions for text embeddings...`);
    try {
      const batchSize = 20;
      for (let i = 0; i < textInfos.length; i += batchSize) {
        const batch = textInfos.slice(i, i + batchSize);
        console.log(`  Text batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(textInfos.length / batchSize)}`);
        const batchEmbeddings = await embeddingService.generateTextEmbeddings(batch);
        infoEmbeddings.push(...batchEmbeddings);
      }
      console.log(`✅ Generated ${infoEmbeddings.length} text embeddings`);
    } catch (error) {
      console.error(`  ⚠ Failed to generate text embeddings:`, (error as Error).message);
    }
  } else if (skipEmbeddings) {
    console.log('\n⏭️  PHASE 2: Embeddings skipped (SKIP_EMBEDDINGS=true)\n');
  }

  stats.embedded = imageEmbeddings.length > 0 ? imageEmbeddings.length : infoEmbeddings.length;

  // ==========================================
  // PHASE 3: Prepare records and upload to Supabase
  // ==========================================
  console.log('\n📤 PHASE 3: Uploading to Supabase\n');

  const records: ProductRecord[] = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < scrapedProducts.length; i++) {
    const scraped = scrapedProducts[i];
    const product = scraped.shopifyProduct;
    const jsonLd = scraped.jsonLd;

    // Determine price and sale
    const firstAvailableVariant = product.variants.find((v) => v.available) || product.variants[0];
    const defaultPrice = firstAvailableVariant?.price || '0';
    const compareAtPrice = firstAvailableVariant?.compare_at_price || null;

    // Sale logic: if compare_at_price exists and is higher than price, it's on sale
    const isOnSale = compareAtPrice !== null && parseFloat(compareAtPrice) > parseFloat(defaultPrice);
    const originalPrice = isOnSale ? compareAtPrice : defaultPrice;
    const salePrice = isOnSale ? defaultPrice : null;

    // Get available sizes
    const sizes = extractAllSizes(product.variants);
    
    // Get category from JSON-LD or product type
    const category = mapCategory(jsonLd?.category || product.product_type);    // Build the product record
      const productUrl = `https://arte-antwerp.com/products/${product.handle}`;
      const record: ProductRecord = {
        id: String(product.id),
        source: 'scraper-arte',
        product_url: productUrl,
        affiliate_url: productUrl,
        image_url: scraped.mainImageUrl,
        brand: 'Arte Antwerp',
        title: product.title,
        description: jsonLd?.description || sanitizeForEmbedding(product.body_html) || null,
        category: category || null,
        gender: determineGender(product.title, product.tags, product.product_type),
        image_embedding: imageEmbeddings[i] || null,
        info_embedding: infoEmbeddings[i] || null,
        additional_images: scraped.additionalImageUrls.length > 0
          ? scraped.additionalImageUrls.join(' , ')
          : null,
        price: formatPrice(originalPrice, 'EUR'),
        sale: salePrice ? formatPrice(salePrice, 'EUR') : null,
        size: sizes || null,
        second_hand: false,
        metadata: buildMetadata({
          title: product.title,
          description: jsonLd?.description || null,
          category: category || null,
          vendor: product.vendor,
          tags: product.tags,
          variants: product.variants.map((v) => ({
            sku: v.sku,
            title: v.title,
            price: v.price,
            compare_at_price: v.compare_at_price,
            available: v.available,
          })),
        }),
        tags: product.tags.length > 0 ? product.tags : null,
        country: null,
        compressed_image_url: null,
        created_at: new Date().toISOString(),
      };

    records.push(record);
  }

  // Upload to Supabase in batches
  const { success, failed, errors } = await supabase.upsertProducts(records, BATCH_SIZE);
  
  stats.uploaded = success;
  stats.failed = failed;
  stats.errors = errors;

  // ==========================================
  // Summary
  // ==========================================
  console.log('\n═══════════════════════════════════════════');
  console.log('  📊 SCRAPING SUMMARY');
  console.log('═══════════════════════════════════════════');
  console.log(`  Total products found:      ${stats.totalProducts}`);
  console.log(`  Successfully scraped:      ${stats.scraped}`);
  console.log(`  Embeddings generated:      ${stats.embedded}`);
  console.log(`  Uploaded to Supabase:      ${stats.uploaded}`);
  console.log(`  Failed:                    ${stats.failed}`);
  
  if (stats.errors.length > 0) {
    console.log(`\n  Errors (${stats.errors.length}):`);
    stats.errors.slice(0, 5).forEach((e) => console.log(`    - ${e}`));
    if (stats.errors.length > 5) {
      console.log(`    ... and ${stats.errors.length - 5} more`);
    }
  }
  
  console.log('═══════════════════════════════════════════\n');

  // Save records to JSON file for inspection
  const outputPath = path.join(__dirname, '..', 'downloads', 'products.json');
  fs.writeFileSync(outputPath, JSON.stringify(records, null, 2));
  console.log(`💾 Full product data saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
