import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ProductRecord } from './types';

export class SupabaseService {
  private client: SupabaseClient;
  private tableName: string;

  constructor(supabaseUrl: string, supabaseKey: string, tableName: string = 'products') {
    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    this.tableName = tableName;
  }

  /**
   * Upsert a single product record.
   * Uses the primary key `id` to determine insert vs update.
   */
  async upsertProduct(record: ProductRecord): Promise<boolean> {
    try {
      const { error } = await this.client.from(this.tableName).upsert(record, {
        onConflict: 'id',
        ignoreDuplicates: false,
      });

      if (error) {
        console.error(`  ⚠ Supabase upsert error for ${record.id}:`, error.message);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`  ⚠ Supabase exception for ${record.id}:`, (error as Error).message);
      return false;
    }
  }

  /**
   * Upsert multiple product records in batches with retry logic.
   */
  async upsertProducts(records: ProductRecord[], batchSize: number = 50, retries: number = 3): Promise<{
    success: number;
    failed: number;
    errors: string[];
  }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(records.length / batchSize);
      console.log(`  Uploading batch ${batchNum}/${totalBatches} (${batch.length} products)...`);

      let batchSucceeded = false;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const { error } = await this.client.from(this.tableName).upsert(batch, {
            onConflict: 'id',
            ignoreDuplicates: false,
          });

          if (error) {
            if (attempt < retries) {
              const waitTime = 1000 * Math.pow(2, attempt);
              console.warn(`  ⚠ Retry ${attempt + 1}/${retries} after ${waitTime}ms: ${error.message}`);
              await new Promise((r) => setTimeout(r, waitTime));
              continue;
            }
            throw error;
          }

          success += batch.length;
          batchSucceeded = true;
          break;
        } catch (error) {
          if (attempt === retries) {
            console.error(`  ⚠ Batch ${batchNum} failed after ${retries} retries:`, (error as Error).message);
            failed += batch.length;
            errors.push(`Batch ${batchNum}: ${(error as Error).message}`);
            batchSucceeded = true; // Mark as handled to continue to next batch
          } else {
            const waitTime = 1000 * Math.pow(2, attempt);
            console.warn(`  ⚠ Retry ${attempt + 1}/${retries} after ${waitTime}ms`);
            await new Promise((r) => setTimeout(r, waitTime));
          }
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < records.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return { success, failed, errors };
  }

  /**
   * Check if the connection to Supabase is working.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const { error } = await this.client.from(this.tableName).select('id').limit(1);
      return !error;
    } catch {
      return false;
    }
  }
}
