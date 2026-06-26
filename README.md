# cYHBer Console 💀

![Portada](public/img/hack1.png)

Una interfaz web local estilo cyberpunk / hacker conectada a `Ollama` que soporta **Agentes Autónomos (Tool Calling)**, **modelos abliterated** (sin censura), streaming fluido en tiempo real, y una arquitectura segura "Zero-Dependency" (sin módulos externos npm).

## 🔥 Características

- **UI Cyberpunk:** Efectos de interferencia (glitch), scanlines y animaciones retro.
- **Motor de Agentes (Tools):** El modelo puede ejecutar acciones reales en tu computadora si activas el modo agente:
  - `web_fetch`: Leer artículos de internet (con caché 60s para evitar peticiones duplicadas).
  - `web_search`: Buscar en internet vía DuckDuckGo (con caché 60s, manejo de redirects, fallback de extracción de links).
  - `read_file` / `write_file` / `list_directory`: Operar en tu sistema de archivos (con Sandboxing).
  - `run_command`: Ejecutar comandos en PowerShell (no-bloqueante, via `execFile`).
- **Persistencia de Sesiones:** El historial de conversación se almacena en el servidor (en memoria, TTL 24h). Al abrir una nueva pestaña el contexto se restaura automáticamente desde el servidor, sin perder ningún mensaje.
- **Control de Rondas del Agente:** Input numérico (1–20) en la barra de herramientas para controlar cuántas rondas de tools puede ejecutar el agente por respuesta, sin editar archivos.
- **Seguridad (Sandboxing):**
  - Prevención de Directory Traversal (la IA no puede escapar del directorio del proyecto).
  - Bloqueo SSRF contra IPv4 e IPv6 (la IA no puede escanear tu red local usando `web_fetch`).
  - Rate Limiting con limpieza automática de memoria y protección contra payloads gigantes.
  - Validación de tipo en todos los campos de mensajes (`role` y `content`).
  - CSP headers para prevenir XSS.
- **Selector en Vivo:** Cambia de modelo al vuelo desde la interfaz sin tener que reiniciar el servidor.
- **Streaming eficiente:** Loop agentico y modo chat comparten el mismo núcleo de streaming (`ollamaStreamRound`) — sin duplicación de código.
- **Gestión de memoria:** Ventana deslizante de historial (últimos 20 mensajes) para evitar desbordes de contexto en sesiones largas.
- **Limpieza ante desconexión:** Si el cliente cierra la pestaña a mitad de una respuesta, el loop agentico y la petición a Ollama se cancelan de inmediato.
- **Test suite integrada:** 59 tests con `npm test` usando el runner nativo de Node.js — sin dependencias externas.

---

## 🛠 Instalación Rápida

### 1. Instalar Prerrequisitos
Asegúrate de tener instalados:
- **[Node.js](https://nodejs.org/es/)** v18 o superior.
- **[Ollama](https://ollama.com/download)**.

### 2. Configurar variables de entorno (opcional)
Copia `.env.example` a `.env` y ajusta los valores según tu entorno:

```powershell
copy .env.example .env
```

| Variable | Default | Descripción |
|---|---|---|
| `APP_PORT` | `4000` | Puerto de la interfaz web |
| `OLLAMA_HOST` | `127.0.0.1` | Host de Ollama |
| `OLLAMA_PORT` | `11434` | Puerto de Ollama |
| `OLLAMA_MODEL` | `richardyoung/qwen2.5-3b-instruct-abliterated` | Modelo por defecto |
| `OLLAMA_NUM_GPU` | `null` (auto) | Capas en GPU. `0` = forzar CPU |
| `LOG_LEVEL` | `INFO` | Nivel de log: `DEBUG`, `INFO`, `WARN`, `ERROR` |

### 3. Descargar los Modelos
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

### 4. Iniciar el Servidor de cYHBer Console

```powershell
node server.js
```

### 5. Entrar al Sistema
Abre tu navegador web y entra a:
👉 **[http://127.0.0.1:4000](http://127.0.0.1:4000)**

---

## 🧪 Tests

```powershell
npm test
```

Cubre: validación de mensajes, rate limiter, niveles de log, protección SSRF (21 casos IPv4/IPv6), sandboxing de rutas, operaciones de archivos y ejecución de comandos. Sin dependencias externas — usa el runner nativo `node:test`.

---

## 🏗 Arquitectura del Proyecto

Este proyecto no requiere `npm install` porque utiliza únicamente módulos nativos de Node (`http`, `fs`, `path`, etc.) para máxima velocidad y seguridad.

```text
cYHBeriteratus/
├─ server.js              # Rutas HTTP, ollamaStreamRound, loop agentico, sesiones
├─ tools.js               # Herramientas del agente: sandboxing, caché, SSRF IPv4/IPv6
├─ src/
│  ├─ config.js           # Configuraciones globales y variables de entorno
│  ├─ utils/
│  │  └─ logger.js        # Log estructurado, nivel configurable via LOG_LEVEL
│  └─ middlewares/
│     ├─ security.js      # Rate-limiting (con limpieza automática) y CSP headers
│     └─ validator.js     # Validación de role y content en mensajes
├─ public/
│  ├─ index.html          # UI Base
│  ├─ styles.css          # Animaciones Cyberpunk
│  ├─ app.js              # Orquestador frontend (ES modules, ~130 líneas)
│  └─ modules/
│     ├─ session.js       # Gestión de sesión: localStorage + sync con servidor
│     ├─ ui.js            # Referencias DOM y funciones de presentación
│     └─ stream.js        # Parser de NDJSON streaming con callbacks
├─ tests/
│  ├─ validator.test.js
│  ├─ security.test.js
│  ├─ logger.test.js
│  ├─ tools.isPrivateIP.test.js
│  ├─ tools.ssrf.test.js
│  ├─ tools.files.test.js
│  └─ tools.command.test.js
├─ detect-abliterated.py  # Detecta modelos abliterated via API REST de Ollama
└─ .env.example           # Plantilla de variables de entorno
```

## 🔒 Modo Agente (Tool Calling)
En la parte superior de la pantalla encontrarás un **Switch (Toggle)** para activar el "MODO AGENTE (TOOLS)" y un **input numérico** para controlar las rondas máximas (1–20).

- **APAGADO:** El modelo actúa como un ChatGPT estándar (respuestas de texto normales, rápidas).
- **ENCENDIDO:** El modelo pensará antes de responder y podrá decidir usar herramientas del sistema (buscar en la red, correr scripts, etc.) para cumplir tu orden.

> **Advertencia:** El modelo puede modificar archivos dentro del proyecto. ¡Úsalo bajo tu propia responsabilidad!

## 🔍 Detectar Modelos Abliterated

```powershell
python detect-abliterated.py
```

Consulta la API REST de Ollama (`/api/tags`) y lista todos los modelos abliterated instalados con su tamaño real en GB/MB.
