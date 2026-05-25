/**
 * Extract the product handle from a Shopify product URL.
 * e.g. /products/leather-patches-jacket-black or /collections/frontpage/products/leather-patches-jacket-black
 */
export function extractHandle(url: string): string {
  const match = url.match(/\/products\/([^/?]+)/);
  return match ? match[1] : '';
}

/**
 * Build the full product URL from a handle.
 */
export function buildProductUrl(handle: string): string {
  return `https://arte-antwerp.com/products/${handle}`;
}

/**
 * Categorize a product type into a more user-friendly category string.
 * If the product_type contains "&" or "/", split into multiple categories.
 */
export function mapCategory(productType: string): string {
  if (!productType) return '';

  // Handle compound categories like "Sweaters & Hoodies"
  if (productType.includes('&')) {
    return productType
      .split('&')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');
  }

  // Handle " / " separated categories
  if (productType.includes(' / ')) {
    return productType.split(' / ').map((s) => s.trim()).filter(Boolean).join(', ');
  }

  return productType;
}

/**
 * Extract available sizes from variants.
 * Returns comma-separated string of available sizes.
 */
export function extractAvailableSizes(variants: Array<{ title: string; available: boolean }>): string {
  return variants
    .filter((v) => v.available && v.title !== 'Default Title')
    .map((v) => v.title)
    .join(', ');
}

/**
 * Extract all size options (regardless of availability) as comma-separated string.
 */
export function extractAllSizes(variants: Array<{ title: string }>): string {
  return variants
    .filter((v) => v.title !== 'Default Title')
    .map((v) => v.title)
    .join(', ');
}

/**
 * Format price with currency code.
 */
export function formatPrice(price: string, currency: string = 'EUR'): string {
  return `${price} ${currency}`;
}

/**
 * Format multiple prices from different currencies.
 */
export function formatPrices(prices: Array<{ price: string; currency: string }>): string {
  return prices.map((p) => `${p.price}${p.currency}`).join(', ');
}

/**
 * Determine if this is a unisex product based on tags, title, or category.
 */
export function determineGender(
  title: string,
  tags: string[],
  category: string
): string | null {
  const lowerTitle = title.toLowerCase();
  const lowerTags = tags.map((t) => t.toLowerCase());
  const combined = [lowerTitle, ...lowerTags, category.toLowerCase()].join(' ');

  // Use word boundary matching to avoid false positives (e.g., "men" in "women")
  if (/\b(women|woman|female)\b/i.test(combined)) {
    return 'female';
  }
  if (/\b(men|man|male)\b/i.test(combined)) {
    return 'male';
  }
  if (/\bunisex\b/i.test(combined)) {
    return 'unisex';
  }

  return null;
}

/**
 * Delay for a given number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) throw error;
      const waitTime = baseDelay * Math.pow(2, attempt);
      console.warn(`  Retry ${attempt + 1}/${retries} after ${waitTime}ms: ${(error as Error).message}`);
      await delay(waitTime);
    }
  }
  throw new Error('Unreachable');
}

/**
 * Sanitize text for embedding - remove HTML tags, normalize whitespace.
 */
export function sanitizeForEmbedding(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a metadata JSON string with all product info.
 */
export function buildMetadata(product: {
  title: string;
  description: string | null;
  category: string | null;
  vendor: string;
  tags: string[];
  variants: Array<{
    sku: string;
    title: string;
    price: string;
    compare_at_price: string | null;
    available: boolean;
  }>;
  colors?: string[];
  materials?: string;
  care?: string;
  sizing?: string;
}): string {
  return JSON.stringify({
    title: product.title,
    description: product.description,
    category: product.category,
    vendor: product.vendor,
    tags: product.tags,
    variants: product.variants.map((v) => ({
      sku: v.sku,
      title: v.title,
      price: v.price,
      compareAtPrice: v.compare_at_price,
      available: v.available,
    })),
    colors: product.colors || [],
    materials: product.materials || '',
    care: product.care || '',
    sizing: product.sizing || '',
    scrapedAt: new Date().toISOString(),
  });
}
