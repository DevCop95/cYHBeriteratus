# cYHBer Console 💀

![Portada](public/img/hack1.png)

Una interfaz web local estilo cyberpunk / hacker conectada a `Ollama` que soporta **Agentes Autónomos (Tool Calling)**, **modelos abliterated** (sin censura), streaming fluido en tiempo real, y una arquitectura segura "Zero-Dependency" (sin módulos externos npm).

## 🔥 Novedades y Características

- **UI Cyberpunk:** Efectos de interferencia (glitch), scanlines y animaciones retro.
- **Motor de Agentes (Tools):** El modelo puede ejecutar acciones reales en tu computadora si activas el modo agente:
  - `web_fetch`: Leer artículos de internet.
  - `web_search`: Buscar en internet vía DuckDuckGo.
  - `read_file` / `write_file` / `list_directory`: Operar en tu sistema de archivos (con Sandboxing).
  - `run_command`: Ejecutar comandos en PowerShell.
- **Seguridad (Sandboxing):** 
  - Prevención de Directory Traversal (la IA no puede escapar del directorio del proyecto).
  - Bloqueo SSRF (la IA no puede escanear tu red local usando `web_fetch`).
  - Rate Limiting y protección contra payloads gigantes.
- **Selector en Vivo:** Cambia de modelo al vuelo desde la interfaz sin tener que reiniciar el servidor.

---

## 🛠 Instalación Rápida

### 1. Instalar Prerrequisitos
Asegúrate de tener instalados:
- **[Node.js](https://nodejs.org/es/)** (Cualquier versión reciente).
- **[Ollama](https://ollama.com/download)**.

### 2. Descargar los Modelos
Abre tu terminal (PowerShell o CMD) y descarga los modelos recomendados. El sistema detectará automáticamente los que tengas instalados.

```powershell
# Opción 1: Abliterated (Sin censura) - 5B MoE (Ideal para PCs estándar, rápido y capaz)
ollama pull huihui_ai/huihui-moe-abliterated:5b

# Opción 2: Abliterated (Sin censura) - 7B (Para PCs con buena tarjeta gráfica)
ollama pull huihui_ai/qwen2.5-abliterate:7b-instruct

# Opción 3: Abliterated (Sin censura) - 3B (Para PCs de muy bajos recursos)
ollama pull richardyoung/qwen2.5-3b-instruct-abliterated

# Opción 4: Abliterated - 4B
ollama pull kaineone/qwen3.5-4b-abliterated
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
├─ server.js           # Punto de entrada principal (Loop de Eventos)
├─ tools.js            # Lógica de las herramientas del agente (Sandboxing)
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
