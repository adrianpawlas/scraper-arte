#!/usr/bin/env python3
"""
SigLIP Embedding Generator for Arte Scraper.

Usage:
    python3 generate_embeddings.py image   # reads JSON from stdin: {"items": ["url1", "url2", ...]}
    python3 generate_embeddings.py text    # reads JSON from stdin: {"items": ["text1", "text2", ...]}

Outputs JSON array of embeddings (each is a list of 768 floats) to stdout.
"""

import sys
import json
import io
import requests
from PIL import Image
import torch
from transformers import AutoProcessor, AutoModel

# Model configuration
MODEL_NAME = "google/siglip-base-patch16-384"
EMBEDDING_DIM = 768

# Global model cache (load once)
_processor = None
_model = None


def load_model():
    """Load the SigLIP model and processor (cached after first call)."""
    global _processor, _model
    if _processor is None or _model is None:
        print(f"Loading SigLIP model: {MODEL_NAME}...", file=sys.stderr)
        _processor = AutoProcessor.from_pretrained(MODEL_NAME)
        _model = AutoModel.from_pretrained(MODEL_NAME)
        _model.eval()
        print("Model loaded successfully.", file=sys.stderr)
    return _processor, _model


def download_image(url: str, timeout: int = 30) -> Image.Image:
    """Download an image from a URL and return as PIL Image."""
    response = requests.get(url, timeout=timeout, headers={
        "User-Agent": "Mozilla/5.0 (compatible; ArteScraper/1.0)"
    })
    response.raise_for_status()
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def get_image_embedding(image_url: str) -> list[float]:
    """Generate a 768-dim image embedding for the given URL."""
    processor, model = load_model()
    image = download_image(image_url)
    inputs = processor(images=image, return_tensors="pt")

    with torch.no_grad():
        outputs = model.get_image_features(**inputs)

    # Normalize the embedding
    embedding = outputs[0]
    embedding = embedding / embedding.norm(dim=-1, keepdim=True)
    return embedding.tolist()


def get_text_embedding(text: str) -> list[float]:
    """Generate a 768-dim text embedding for the given string."""
    processor, model = load_model()
    
    # Truncate very long text
    if len(text) > 10000:
        text = text[:10000]

    inputs = processor(
        text=text,
        return_tensors="pt",
        padding="max_length",
        truncation=True,
        max_length=256,
    )

    with torch.no_grad():
        outputs = model.get_text_features(**inputs)

    # Normalize the embedding
    embedding = outputs[0]
    embedding = embedding / embedding.norm(dim=-1, keepdim=True)
    return embedding.tolist()


def process_image_batch(items: list[str]) -> list[list[float]]:
    """Process a batch of image URLs and return embeddings."""
    embeddings = []
    total = len(items)

    for i, url in enumerate(items):
        try:
            print(f"  Image {i+1}/{total}: processing...", file=sys.stderr)
            emb = get_image_embedding(url)
            embeddings.append(emb)
        except Exception as e:
            print(f"  ⚠ Image {i+1}/{total} failed: {e}", file=sys.stderr)
            # Return zero vector for failed images
            embeddings.append([0.0] * EMBEDDING_DIM)

    return embeddings


def process_text_batch(items: list[str]) -> list[list[float]]:
    """Process a batch of text strings and return embeddings."""
    embeddings = []
    total = len(items)

    for i, text in enumerate(items):
        try:
            print(f"  Text {i+1}/{total}: processing...", file=sys.stderr)
            emb = get_text_embedding(text)
            embeddings.append(emb)
        except Exception as e:
            print(f"  ⚠ Text {i+1}/{total} failed: {e}", file=sys.stderr)
            # Return zero vector for failed texts
            embeddings.append([0.0] * EMBEDDING_DIM)

    return embeddings


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 generate_embeddings.py <image|text>", file=sys.stderr)
        sys.exit(1)

    mode = sys.argv[1]
    if mode not in ("image", "text"):
        print(f"Invalid mode: {mode}. Use 'image' or 'text'.", file=sys.stderr)
        sys.exit(1)

    # Read input from stdin
    try:
        raw_input = sys.stdin.read()
        data = json.loads(raw_input)
        items = data.get("items", [])
    except json.JSONDecodeError as e:
        print(f"Failed to parse input JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if not items:
        print("[]")
        return

    print(f"Processing {len(items)} items in {mode} mode...", file=sys.stderr)

    if mode == "image":
        embeddings = process_image_batch(items)
    else:
        embeddings = process_text_batch(items)

    # Output embeddings as JSON to stdout
    print(json.dumps(embeddings))


if __name__ == "__main__":
    main()
