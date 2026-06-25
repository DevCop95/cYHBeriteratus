# Guía de Contribución 🤝

¡Gracias por tu interés en contribuir a **cYHBer Console**! Este es un proyecto de código abierto construido para la comunidad de desarrolladores y hackers. Todas las contribuciones (reporte de bugs, nuevas herramientas (Tools), mejoras de UI) son bienvenidas.

## 🛠 Entorno de Desarrollo

El proyecto tiene una arquitectura **Zero-Dependency**. No necesitas correr `npm install`.

1. Haz un Fork del repositorio.
2. Clona tu Fork localmente: `git clone https://github.com/TU_USUARIO/cYHBeriteratus.git`
3. Asegúrate de tener Node.js y Ollama instalados.
4. Ejecuta el proyecto localmente: `node server.js`

## 🧠 Agregando Nuevas Herramientas (Tools)

Si quieres enseñarle al Agente Autónomo a hacer cosas nuevas (ej. leer bases de datos, escanear puertos, etc.), sigue estos pasos:

1. Abre el archivo `tools.js`.
2. Agrega la definición OpenAI-compatible de tu herramienta en el array `toolDefinitions`.
3. Crea la función asíncrona que ejecuta la herramienta asegurando un retorno con el formato: `{ success: boolean, result?: string, error?: string }`.
4. Añade tu función al objeto `toolExecutors` al final del archivo.
5. Abre `server.js` y asegúrate de mencionar tu herramienta en el `agentSystemPrompt` para que el modelo sepa que existe.

> **Importante**: Mantenemos una filosofía nativa. Si tu herramienta puede ser construida usando los módulos integrados de Node (`http`, `fs`, `crypto`, `child_process`), no uses dependencias externas.

## 🐛 Reporte de Bugs y Pull Requests

- **Issues:** Si encuentras un bug o tienes una idea, abre un *Issue* describiendo claramente el problema o propuesta.
- **Pull Requests (PR):**
  - Crea una rama para tu feature: `git checkout -b feature/nueva-herramienta`.
  - Asegúrate de que el código no rompe el streaming de la interfaz.
  - Haz un commit claro: `git commit -m "Añade herramienta para escanear puertos"`.
  - Haz un Push y abre el PR hacia la rama `main`.

¡Mantengamos el código rápido, ligero y peligroso! 💀
