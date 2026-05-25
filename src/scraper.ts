import { chromium, Page, Browser } from 'playwright';
import {
  ShopifyProduct,
  ShopifyProductsResponse,
  JsonLdProductGroup,
  ScrapedProduct,
  ScraperConfig,
} from './types';
import { extractHandle, buildProductUrl, retry, delay } from './utils';

const DEFAULT_CONFIG: ScraperConfig = {
  collectionUrl: 'https://arte-antwerp.com/collections/frontpage',
  maxProducts: Infinity,
  concurrency: 5,
};

/**
 * Scraper for Arte Antwerp Shopify store.
 * Uses the Shopify products.json API for bulk product listing
 * and Playwright for individual product page scraping (JSON-LD extraction).
 */
export class ArteScraper {
  private config: ScraperConfig;
  private browser: Browser | null = null;

  constructor(config: Partial<ScraperConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the Playwright browser.
   */
  async init(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
  }

  /**
   * Close the browser.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Fetch all products from the Shopify products.json API.
   * This handles pagination automatically.
   */
  async fetchAllProductsFromApi(): Promise<ShopifyProduct[]> {
    console.log('📦 Fetching products from Shopify API...');
    const allProducts: ShopifyProduct[] = [];
    const baseUrl = this.config.collectionUrl.replace(/\/?$/, '') + '/products.json';
    let page = 1;
    const limit = 250;

    while (true) {
      const url = `${baseUrl}?page=${page}&limit=${limit}`;
      console.log(`  Fetching page ${page}...`);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = (await response.json()) as ShopifyProductsResponse;

        if (!data.products || data.products.length === 0) {
          break;
        }

        allProducts.push(...data.products);
        console.log(`  Got ${data.products.length} products (total: ${allProducts.length})`);

        if (data.products.length < limit) {
          break; // Last page
        }

        page++;
        await delay(500); // Be nice to the API
      } catch (error) {
        console.error(`  Error fetching page ${page}:`, (error as Error).message);
        throw error;
      }
    }

    console.log(`✅ Total products from API: ${allProducts.length}`);
    return allProducts.slice(0, this.config.maxProducts);
  }

  /**
   * Scrape a single product page to extract JSON-LD data.
   * Uses Playwright to render JavaScript and extract structured data.
   */
  async scrapeProductPage(handle: string): Promise<JsonLdProductGroup | null> {
    const url = `https://arte-antwerp.com/products/${handle}`;

    return retry(async () => {
      const page = await this.browser!.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        // Extract JSON-LD data
        const jsonLd = await page.evaluate(() => {
          const scripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (let i = 0; i < scripts.length; i++) {
            const script = scripts[i];
            try {
              const data = JSON.parse(script.textContent || '{}');
              if (data['@type'] === 'ProductGroup' || data['@type'] === 'Product') {
                return data;
              }
            } catch {
              // Skip invalid JSON
            }
          }
          return null;
        });

        return jsonLd as JsonLdProductGroup | null;
      } catch (error) {
        console.warn(`  ⚠ Error scraping ${handle}:`, (error as Error).message);
        return null;
      } finally {
        await page.close();
      }
    }, 2, 1000);
  }

  /**
   * Select the best product image from the available images.
   * Priority:
   * 1. Image from JSON-LD (the variant's main product shot)
   * 2. The first image from Shopify images array
   * 3. null if no images
   */
  selectMainImage(
    shopifyProduct: ShopifyProduct,
    jsonLd: JsonLdProductGroup | null
  ): { mainImageUrl: string; additionalImageUrls: string[] } {
    const allImages = shopifyProduct.images.map((img) => img.src);

    let mainImageUrl: string | null = null;

    // Priority 1: Use the image from JSON-LD variant
    if (jsonLd?.hasVariant && jsonLd.hasVariant.length > 0) {
      const variantImage = jsonLd.hasVariant[0].image;
      if (variantImage) {
        // The JSON-LD image might be a lower res or different URL format
        // Find the matching image in the Shopify images
        const matchingShopifyImage = allImages.find((img) => {
          const jsonLdFilename = variantImage.split('/').pop()?.split('?')[0] || '';
          const shopifyFilename = img.split('/').pop()?.split('?')[0] || '';
          return jsonLdFilename === shopifyFilename;
        });
        if (matchingShopifyImage) {
          mainImageUrl = matchingShopifyImage;
        } else {
          // Use the JSON-LD URL directly as fallback (it might be lower res)
          mainImageUrl = variantImage;
        }
      }
    }

    // Priority 2: Use the first image
    if (!mainImageUrl && allImages.length > 0) {
      mainImageUrl = allImages[0];
    }

    // Get additional images (all images except the main one)
    const additionalImageUrls = mainImageUrl
      ? allImages.filter((img) => {
          const mainFilename = mainImageUrl.split('/').pop()?.split('?')[0] || '';
          const imgFilename = img.split('/').pop()?.split('?')[0] || '';
          return mainFilename !== imgFilename;
        })
      : allImages;

    return {
      mainImageUrl: mainImageUrl || '',
      additionalImageUrls,
    };
  }

  /**
   * Scrape all products: fetch from API, then scrape each product page for JSON-LD.
   */
  async scrapeAllProducts(): Promise<ScrapedProduct[]> {
    await this.init();

    try {
      // Step 1: Fetch all products from the API
      const shopifyProducts = await this.fetchAllProductsFromApi();
      console.log(`\n📄 Scraping ${shopifyProducts.length} product pages for JSON-LD data...`);

      // Step 2: Scrape each product page (with concurrency)
      const results: ScrapedProduct[] = [];
      const errors: Array<{ handle: string; error: string }> = [];
      const concurrency = this.config.concurrency!;

      for (let i = 0; i < shopifyProducts.length; i += concurrency) {
        const batch = shopifyProducts.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(
          batch.map(async (product) => {
            const handle = product.handle;
            console.log(`  [${i + batch.indexOf(product) + 1}/${shopifyProducts.length}] ${product.title}`);

            const jsonLd = await this.scrapeProductPage(handle);
            const { mainImageUrl, additionalImageUrls } = this.selectMainImage(product, jsonLd);

            return {
              shopifyProduct: product,
              jsonLd,
              mainImageUrl,
              additionalImageUrls,
            } as ScrapedProduct;
          })
        );

        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            errors.push({ handle: 'unknown', error: result.reason?.message || 'Unknown error' });
          }
        }

        // Small delay between batches to avoid overwhelming the server
        if (i + concurrency < shopifyProducts.length) {
          await delay(1000);
        }
      }

      if (errors.length > 0) {
        console.warn(`\n⚠ ${errors.length} products failed to scrape:`);
        errors.forEach((e) => console.warn(`  - ${e.handle}: ${e.error}`));
      }

      console.log(`\n✅ Scraped ${results.length} products successfully`);
      return results;
    } finally {
      await this.close();
    }
  }
}
