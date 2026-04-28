# Sistema Multi-Agente — Krawl

Arquitectura de agentes con ventanas de contexto aisladas para evitar perdida de contexto en sesiones largas.

## Estructura

```
.agents/
  ORCHESTRATOR.md       Prompt del orquestador (coordinador, no escribe codigo)
  AGENT-DB.md           Prompt: src/db/database.js
  AGENT-OCR.md          Prompt: src/ocr/, src/utils/, src/drive/api.js
  AGENT-IPC.md          Prompt: main.js, preload.js
  AGENT-UI.md           Prompt: renderer/
  AGENT-BUILD.md        Prompt: package.json, electron-builder, installer.iss
  HANDOFF_SCHEMA.json   Contrato JSON request/response entre agentes
  state.json            Estado persistente: tareas, bugs conocidos, sesiones
  README.md             Este archivo
```

## Como usarlo

### 1. Orquestador (sesion principal)

Abre una sesion de OpenCode/Claude/Cursor y pega el contenido de `ORCHESTRATOR.md` como primer mensaje, junto con `state.json`.

**Modelos recomendados:**
- Claude Sonnet 4.6 — razonamiento multi-paso, gestion de estado
- OpenAI o1 — alternativa para planificacion compleja

### 2. Subagentes (sesiones aisladas)

Para cada handoff que el orquestador genere, abre una **nueva sesion independiente** y pega:
1. El contenido del `AGENT-XX.md` correspondiente
2. El JSON del handoff

La sesion nueva no tiene contexto previo — exactamente el aislamiento buscado. Cuando el subagente devuelva el JSON de respuesta, copialo al orquestador para consolidar.

**Modelos recomendados por agente:**

| Agente | Modelo / Herramienta | Razon |
|---|---|---|
| ORCHESTRATOR | Claude Sonnet 4.6 | Razonamiento multi-paso |
| AGENT-DB | GitHub Copilot Pro+ (en editor) | Autocompletado SQL/JS preciso |
| AGENT-OCR | Claude Sonnet 4.6 | Pipelines complejos, regex tuning |
| AGENT-IPC | Claude Sonnet 4.6 | main.js es el archivo mas critico |
| AGENT-UI | GitHub Copilot Pro+ (en editor) | HTML/CSS/JS vanilla |
| AGENT-BUILD | OpenAI o1 (ChatGPT Plus) | Config quirks, electron-builder |

## Flujo de comunicacion

```
USUARIO
   |
   v
ORCHESTRATOR ---- lee ----> state.json
   |
   | emite HANDOFF (JSON)
   v
SUBAGENTE (sesion aislada)
   |
   | lee solo archivos de su dominio
   | implementa cambio minimo
   |
   v
RESPONSE (JSON con files_modified, summary, side_effects)
   |
   v
ORCHESTRATOR ---- valida acceptance
   |
   | si side_effects != 'none' -> nuevo HANDOFF a otro agente
   |
   v
ORCHESTRATOR ---- actualiza ----> state.json
   |
   v
RESUMEN AL USUARIO
```

## Reglas

1. **Aislamiento total** entre subagentes. Nunca comparten contexto.
2. **Orquestador no escribe codigo.** Solo planifica y consolida.
3. **Handoffs son autocontenidos.** Todo el contexto va dentro del JSON.
4. **state.json es la unica memoria persistente** entre sesiones.
5. **Side effects son obligatorios.** Si un cambio cruza dominios, encadenar handoffs.

## Bugs conocidos (resumen)

Ver `state.json` -> `known_bugs` para detalles. 8 bugs trackeados al iniciar el sistema:
- fecha_dual_format (high)
- ocr_init_stuck (high)
- fts_partial_desync (medium)
- driveapi_extensions_narrow (medium)
- concurrent_indexing (medium)
- legacy_ipc_indexar_carpeta (low)
- triple_walk_duplication (low)
- dead_deps (low)
