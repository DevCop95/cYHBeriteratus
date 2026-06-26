# cYHBer Console 💀

![Portada](public/img/hack1.png)

Una interfaz web local estilo cyberpunk / hacker conectada a `Ollama` que soporta **Agentes Autónomos (Tool Calling)**, **modelos abliterated** (sin censura), streaming fluido en tiempo real, y una arquitectura segura "Zero-Dependency" (sin módulos externos npm).

## 🔥 Características

- **UI Cyberpunk:** Efectos de interferencia (glitch), scanlines y animaciones retro.
- **Motor de Agentes (Tools):** El modelo puede ejecutar acciones reales en tu computadora si activas el modo agente:
  - `web_fetch`: Leer artículos de internet (con caché 60s para evitar peticiones duplicadas).
  - `web_search`: Buscar en internet vía DuckDuckGo (con caché 60s).
  - `read_file` / `write_file` / `list_directory`: Operar en tu sistema de archivos (con Sandboxing).
  - `run_command`: Ejecutar comandos en PowerShell (no-bloqueante, via `execFile`).
- **Seguridad (Sandboxing):**
  - Prevención de Directory Traversal (la IA no puede escapar del directorio del proyecto).
  - Bloqueo SSRF contra IPv4 e IPv6 (la IA no puede escanear tu red local usando `web_fetch`).
  - Rate Limiting y protección contra payloads gigantes.
- **Selector en Vivo:** Cambia de modelo al vuelo desde la interfaz sin tener que reiniciar el servidor.
- **Streaming eficiente:** Loop agentico y modo chat comparten el mismo núcleo de streaming (`ollamaStreamRound`) — sin duplicación de código.
- **Gestión de memoria:** Ventana deslizante de historial (últimos 20 mensajes) para evitar desbordes de contexto en sesiones largas.
- **Limpieza ante desconexión:** Si el cliente cierra la pestaña a mitad de una respuesta, el loop agentico y la petición a Ollama se cancelan de inmediato.

---

## 🛠 Instalación Rápida

### 1. Instalar Prerrequisitos
Asegúrate de tener instalados:
- **[Node.js](https://nodejs.org/es/)** (Cualquier versión reciente).
- **[Ollama](https://ollama.com/download)**.

### 2. Descargar los Modelos
Abre tu terminal (PowerShell o CMD) y descarga los modelos recomendados. El sistema detectará automáticamente los que tengas instalados.

```powershell
# Opción 1: NeuralDaredevil 8B — mejor 8B en Open LLM Leaderboard (~6 GB VRAM)
ollama pull NeuralDaredevil-8B-abliterated

# Opción 2: Josiefied-Qwen3 8B — razonamiento superior, muy eficiente (~6 GB VRAM)
ollama pull mradermacher/Josiefied-Qwen3-8B-abliterated

# Opción 3: Abliterated 5B MoE — ideal para PCs estándar, rápido
ollama pull huihui_ai/huihui-moe-abliterated:5b

# Opción 4: Abliterated 7B — buena GPU requerida
ollama pull huihui_ai/qwen2.5-abliterate:7b-instruct

# Opción 5: Abliterated 3B — para PCs de muy bajos recursos
ollama pull richardyoung/qwen2.5-3b-instruct-abliterated
```

*(Nota: Asegúrate de que Ollama esté corriendo en segundo plano, por defecto en el puerto `11434`)*

### 3. Iniciar el Servidor de cYHBer Console
Clona o descarga esta carpeta, abre una terminal dentro del directorio del proyecto y ejecuta:

```powershell
node server.js
```

### 4. Entrar al Sistema
Abre tu navegador web y entra a:
👉 **[http://127.0.0.1:4000](http://127.0.0.1:4000)**

---

## 🏗 Arquitectura del Proyecto

Este proyecto no requiere `npm install` porque utiliza únicamente módulos nativos de Node (`http`, `fs`, `path`, etc.) para máxima velocidad y seguridad.

```text
cYHBeriteratus/
├─ server.js           # Punto de entrada: rutas HTTP, ollamaStreamRound, loop agentico
├─ tools.js            # Herramientas del agente: sandboxing, caché, SSRF IPv4/IPv6
├─ src/
│  ├─ config.js        # Configuraciones globales y variables de entorno
│  ├─ utils/
│  │  └─ logger.js     # Sistema de log estructurado en consola
│  ├─ middlewares/
│     ├─ security.js   # Rate-limiting y CSP (Security Headers)
│     └─ validator.js  # Defensa contra ataques de payload y validación JSON
├─ public/             # Archivos frontend estáticos
│  ├─ index.html       # UI Base
│  ├─ styles.css       # Animaciones Cyberpunk
│  ├─ app.js           # Lógica frontend (Streaming y chat history)
│  └─ img/
```

## 🔒 Modo Agente (Tool Calling)
En la parte superior derecha de la pantalla encontrarás un **Switch (Toggle)** para activar el "MODO AGENTE (TOOLS)".
- **APAGADO:** El modelo actúa como un ChatGPT estándar (respuestas de texto normales, rápidas).
- **ENCENDIDO:** El modelo pensará antes de responder y podrá decidir usar herramientas del sistema (buscar en la red, correr scripts, etc.) para cumplir tu orden. 

> **Advertencia:** El modelo puede modificar archivos dentro del proyecto. ¡Úsalo bajo tu propia responsabilidad!
