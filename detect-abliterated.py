import urllib.request
import json

OLLAMA_API = "http://localhost:11434"

def fmt_size(model):
    b = model.get("size", 0)
    if b >= 1_000_000_000:
        return f"{b / 1_000_000_000:.1f} GB"
    if b >= 1_000_000:
        return f"{b / 1_000_000:.1f} MB"
    return f"{b} B"

def detect_abliterated():
    try:
        with urllib.request.urlopen(f"{OLLAMA_API}/api/tags", timeout=10) as resp:
            data = json.loads(resp.read().decode())
        models = data.get("models", [])
    except Exception:
        print(f"Error: could not connect to Ollama at {OLLAMA_API}.")
        print("Make sure Ollama is running: ollama serve")
        return

    abliterated = [m for m in models if "abliterated" in m.get("name", "").lower()]

    if not abliterated:
        print("No abliterated models found.")
        print("Download one with: ollama pull richardyoung/qwen2.5-3b-instruct-abliterated")
        return

    print("=" * 60)
    print("  ABLITERATED MODELS DETECTED LOCALLY")
    print("=" * 60)
    print()

    for i, model in enumerate(abliterated, 1):
        name = model.get("name", "unknown")
        print(f"  [{i}] {name}")
        print(f"      Size: {fmt_size(model)}")
        print(f"      Run:  ollama run {name}")
        print()

    print("-" * 60)
    print("  Recommended model: richardyoung/qwen2.5-3b-instruct-abliterated")
    print("  (3.1B params, fast on CPU, uncensored)")
    print("-" * 60)

if __name__ == "__main__":
    detect_abliterated()
