/** Shopify product from /collections/frontpage/products.json */
export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  vendor: string;
  product_type: string;
  created_at: string;
  updated_at: string;
  published_at: string;
  tags: string[];
  body_html: string;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
  options: ShopifyOption[];
}

export interface ShopifyImage {
  id: number;
  src: string;
  alt: string | null;
  position: number;
  width: number;
  height: number;
  product_id: number;
  created_at: string;
  updated_at: string;
  variant_ids: number[];
}

export interface ShopifyVariant {
  id: number;
  title: string;
  sku: string;
  position: number;
  product_id: number;
  price: string;
  compare_at_price: string | null;
  available: boolean;
  requires_shipping: boolean;
  taxable: boolean;
  featured_image: ShopifyImage | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShopifyOption {
  name: string;
  position: number;
  values: string[];
}

/** JSON-LD ProductGroup extracted from product page */
export interface JsonLdProductGroup {
  "@context": string;
  "@id": string;
  "@type": "ProductGroup";
  productGroupID: string;
  name: string;
  brand: string;
  category: string;
  description: string;
  url: string;
  hasVariant: JsonLdVariant[];
}

export interface JsonLdVariant {
  "@type": "Product";
  name: string;
  sku: string;
  gtin: string;
  image: string;
  offers: {
    "@type": "Offer";
    price: string;
    priceCurrency: string;
    availability: string;
    url: string;
  };
}

/** The product data ready for Supabase upsert */
export interface ProductRecord {
  id: string;
  source: string;
  product_url: string;
  affiliate_url: string | null;
  image_url: string;
  brand: string;
  title: string;
  description: string | null;
  category: string | null;
  gender: string | null;
  image_embedding: number[] | null;
  info_embedding: number[] | null;
  additional_images: string | null;
  price: string | null;
  sale: string | null;
  size: string | null;
  second_hand: boolean;
  metadata: string | null;
  tags: string[] | null;
  country: string | null;
  compressed_image_url: string | null;
  created_at: string;
}

/** Scraped product data before embedding generation */
export interface ScrapedProduct {
  shopifyProduct: ShopifyProduct;
  jsonLd: JsonLdProductGroup | null;
  mainImageUrl: string;
  additionalImageUrls: string[];
}

/** Response from products.json API */
export interface ShopifyProductsResponse {
  products: ShopifyProduct[];
}

export interface ScraperConfig {
  collectionUrl: string;
  maxProducts?: number;
  concurrency?: number;
}

export interface ProcessingStats {
  totalProducts: number;
  scraped: number;
  embedded: number;
  uploaded: number;
  failed: number;
  errors: string[];
}
