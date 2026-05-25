import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Service that uses a Python subprocess to generate SigLIP embeddings.
 * The Python script handles image downloading and model inference.
 */
export class EmbeddingService {
  private pythonScriptPath: string;
  private ready: boolean = false;

  constructor() {
    this.pythonScriptPath = path.join(__dirname, '..', 'scripts', 'generate_embeddings.py');
    this.checkPythonEnvironment();
  }

  /**
   * Check that the Python script and dependencies are available.
   */
  private checkPythonEnvironment(): void {
    const scriptExists = fs.existsSync(this.pythonScriptPath);
    if (!scriptExists) {
      console.warn(`⚠ Python embedding script not found at: ${this.pythonScriptPath}`);
      console.warn('  Embedding generation will be disabled until the script is created.');
    } else {
      this.ready = true;
    }
  }

  /**
   * Check if the embedding service is ready.
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Generate image embeddings for a batch of image URLs.
   * Returns an array of 768-dimensional embedding vectors.
   */
  async generateImageEmbeddings(imageUrls: string[]): Promise<number[][]> {
    if (!this.ready) {
      throw new Error('Embedding service is not ready. Python script not found.');
    }

    if (imageUrls.length === 0) return [];

    console.log(`  🧠 Generating image embeddings for ${imageUrls.length} images...`);

    return this.runPython('image', { items: imageUrls });
  }

  /**
   * Generate text embeddings for a batch of text strings.
   * Returns an array of 768-dimensional embedding vectors.
   */
  async generateTextEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.ready) {
      throw new Error('Embedding service is not ready. Python script not found.');
    }

    if (texts.length === 0) return [];

    console.log(`  🧠 Generating text embeddings for ${texts.length} texts...`);

    return this.runPython('text', { items: texts });
  }

  /**
   * Run the Python embedding script with the given mode and data.
   * Includes a timeout to prevent hanging on stalled model/image loading.
   */
  private async runPython(
    mode: 'image' | 'text',
    data: { items: string[] },
    timeoutMs: number = 300000 // 5 minutes default
  ): Promise<number[][]> {
    return new Promise((resolve, reject) => {
      const input = JSON.stringify(data);
      const pythonProcess = spawn('python3', [this.pythonScriptPath, mode], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      // Set timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          pythonProcess.kill('SIGKILL');
          reject(new Error(`Python script timed out after ${timeoutMs / 1000}s`));
        }
      }, timeoutMs);

      pythonProcess.stdout!.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      pythonProcess.stderr!.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      pythonProcess.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);

        if (code !== 0) {
          console.error(`  ⚠ Python script exited with code ${code}`);
          if (stderr) console.error(`  stderr: ${stderr.slice(0, 500)}`);
          reject(new Error(`Python embedding script failed: ${(stderr || 'unknown error').slice(0, 200)}`));
          return;
        }

        try {
          const embeddings = JSON.parse(stdout.trim());
          resolve(embeddings);
        } catch (error) {
          reject(new Error(`Failed to parse embeddings output: ${(error as Error).message}`));
        }
      });

      pythonProcess.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });

      // Send data via stdin and close it
      pythonProcess.stdin!.write(input);
      pythonProcess.stdin!.end();
    });
  }
}
