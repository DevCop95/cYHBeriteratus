import subprocess
import json

def detect_abliterated():
    try:
        result = subprocess.run(
            ["ollama", "list", "--json"],
            capture_output=True, text=True, timeout=10
        )
        data = json.loads(result.stdout)
        models = data.get("models", [])
    except Exception:
        try:
            result = subprocess.run(
                ["ollama", "list"],
                capture_output=True, text=True, timeout=10
            )
            models = []
            for line in result.stdout.strip().split("\n")[1:]:
                parts = line.split()
                if len(parts) >= 2:
                    models.append({"name": parts[0], "size": parts[2] + " " + parts[3]})
        except Exception:
            print("Error: No se pudo conectar con Ollama.")
            return

    abliterated = [m for m in models if "abliterated" in m.get("name", "").lower()]

    if not abliterated:
        print("No se encontraron modelos abliterated.")
        print("Descarga uno con: ollama pull richardyoung/qwen2.5-3b-instruct-abliterated")
        return

    print("=" * 60)
    print("  MODELOS ABLITERATED DETECTADOS LOCALMENTE")
    print("=" * 60)
    print()

    for i, model in enumerate(abliterated, 1):
        name = model.get("name", "desconocido")
        size = model.get("size", "N/A")
        print(f"  [{i}] {name}")
        print(f"      Tamano: {size}")
        print(f"      Uso:    ollama run {name}")
        print()

    print("-" * 60)
    print("  Modelo recomendado: richardyoung/qwen2.5-3b-instruct-abliterated")
    print("  (3.1B params, rapido en CPU, sin censura)")
    print("-" * 60)

if __name__ == "__main__":
    detect_abliterated()
