# REB-232 - [emiAutomationTest][OSJ-RUNTIME] Mejorar salida de orchestrate con resumen explícito en no-op, escalación y approval gating

- URL: https://vfgconsulting.atlassian.net/browse/REB-232
- Status: Backlog
- Assignee: Emiliano Braña

## Description

# SPEC: Orchestrate terminal summaries

# Spec-ID: REB-XXX

# Sprint: TBD

# Status: Draft

# Owner: Emiliano Braña

# Reviewer: TBD

## Context

Durante las pruebas del runtime agentic, `osj orchestrate --until <stage>` mostró varios comportamientos poco claros para el developer:

- en algunos casos devolvió un no-op silencioso cuando el runtime ya estaba más allá del stage pedido

- en otros casos terminó en escalación o approval gating sin un resumen terminal suficiente

- en runs largos, la ausencia de un resumen final claro generó dudas sobre si el proceso había quedado colgado, había terminado, o requería una acción humana

Esto obliga al developer a inspeccionar manualmente `runtime status`, `approval show` y artifacts dentro de `.openspec/runtime/...` para entender qué pasó y cuál es el siguiente paso.

## Goals

- Hacer que `osj orchestrate --until <stage>` siempre emita un resumen terminal explícito cuando no ejecuta agentes por no-op.

- Hacer que `osj orchestrate --until <stage>` siempre emita un resumen terminal explícito cuando termina en escalación, approval gating u otra condición no exitosa.

- Reducir la necesidad de inspección manual de runtime artifacts para entender el siguiente paso operativo.

## Non-Goals

- Implementar heartbeat o progreso en vivo durante la ejecución.

- Cambiar la policy de approvals o budgets.

- Resolver automáticamente approvals pendientes.

- Cambiar la lógica de state machine más allá de lo necesario para mostrar el resumen terminal.

## Acceptance Criteria

### CA-1 - No-op summary when runtime is already beyond requested stage

- **GIVEN** un runtime cuyo siguiente agente pendiente está más allá del stage solicitado

- **WHEN** el developer ejecuta `osj orchestrate --until <stage>`

- **THEN** el comando SHALL imprimir un resumen explícito en terminal en vez de devolver salida vacía

- **AND** el resumen SHALL indicar que no se ejecutó ningún agente

- **AND** el resumen SHALL incluir el estado actual de ticket, sesión, change y ciclo

- **AND** el resumen SHALL sugerir el siguiente comando accionable

### CA-2 - Escalation summary

- **GIVEN** que `orchestrate` ejecuta un agente y el ciclo termina en una condición de escalación

- **WHEN** el comando finaliza

- **THEN** el comando SHALL imprimir un resumen terminal explícito

- **AND** el resumen SHALL incluir el último agente ejecutado

- **AND** el resumen SHALL incluir el estado final del ciclo

- **AND** el resumen SHALL incluir la razón principal de la escalación

- **AND** el resumen SHALL incluir el approval id si se generó uno

- **AND** el resumen SHALL sugerir el siguiente comando operativo

### CA-3 - Approval gating summary

- **GIVEN** que `orchestrate` se detiene porque existe una approval humana requerida

- **WHEN** el comando finaliza

- **THEN** el resumen terminal SHALL dejar claro que el runtime quedó gated por approval

- **AND** el resumen SHALL incluir el scope de la approval

- **AND** el resumen SHALL incluir el approval id

- **AND** el resumen SHALL sugerir comandos como `osj approval show`, `osj approval accept <id>` o `osj approval reject <id>`

### CA-4 - Retryable failure summary

- **GIVEN** que `orchestrate` termina en un estado retryable como `FAILED_RETRYABLE`

- **WHEN** el comando finaliza

- **THEN** el resumen terminal SHALL indicar que el flujo puede continuar con un rerun

- **AND** el resumen SHALL explicar el motivo principal del retry

- **AND** el resumen SHALL sugerir el siguiente comando para continuar

### CA-5 - Consistency with runtime explain

- **GIVEN** que `orchestrate` imprime un resumen terminal por no-op, escalación o gating

- **WHEN** el developer consulta luego `osj runtime explain`

- **THEN** la explicación SHALL ser consistente con el motivo principal informado por `orchestrate`

- **AND** ambos SHALL apuntar al mismo siguiente paso recomendado

## Business Rules

- `osj orchestrate --until <stage>` no debe terminar silenciosamente cuando el resultado operativo sea relevante para el developer.

- Los resúmenes terminales deben priorizar accionabilidad sobre detalle exhaustivo.

- Si existe approval pendiente generada por la corrida actual, esa approval debe aparecer como evidencia principal en el resumen.

- Si no se ejecutó ningún agente, el resumen debe explicarlo explícitamente y no simular actividad.

- El resumen no reemplaza artifacts detallados; debe referenciar artifacts cuando aporten contexto adicional.

## Domain / Data / Integration Contracts

- Entidades relevantes:

- Ticket runtime

- Session runtime

- Change runtime

- Execution cycle

- Approval request

- Agent execution summary

- Datos mínimos del resumen terminal:

- requested stage

- último agente ejecutado o indicación de no-op

- estado del ciclo

- estado de ticket/session/change

- razón principal

- approval id si existe

- siguiente comando sugerido

- artifact ref relevante si existe

- No se requieren endpoints nuevos ni integraciones externas.

## UX / Error States

- Si el resultado es no-op, la terminal debe explicar por qué no se ejecutó nada.

- Si el resultado es escalación, la terminal debe dejar claro qué se espera del humano.

- Si el resultado es retryable, la terminal debe indicar que puede continuarse el flujo.

- Si no existe runtime, el comportamiento actual amigable debe preservarse.

- La salida debe ser escaneable y no excesivamente verbosa.

## Out of Scope

- Heartbeats en tiempo real

- Streaming de progreso del backend

- Aumento del diff budget

- Cambios en los agentes de negocio fuera del resumen terminal

- Reescritura completa de `runtime explain`

## Traceability

- CA-1: CLI orchestrate output, runtime orchestration

- CA-2: CLI orchestrate output, approvals, execution summaries

- CA-3: CLI orchestrate output, approval manager integration

- CA-4: CLI orchestrate output, validation/retry classification

- CA-5: runtime explain, orchestrate terminal summary consistency

## Appendix A — BDD Scenarios (optional)

### Scenario: No-op after implementation already exists

- **GIVEN** un change con artifact de implementation ya persistido

- **WHEN** el developer ejecuta `osj orchestrate --until implementation`

- **THEN** la terminal muestra que no hubo ejecución nueva

- **AND** sugiere continuar con `osj orchestrate --until delivery`

### Scenario: Approval gating after critic

- **GIVEN** un critic que genera approval humana

- **WHEN** finaliza `osj orchestrate --until delivery`

- **THEN** la terminal muestra un resumen con approval id y comando sugerido

## Quality Checklist

- [ ] Todos los CAs tienen cobertura funcional

- [ ] Casos de error documentados

- [ ] Reglas de negocio explícitas

- [ ] Contratos lógicos definidos o marcados como TBD

- [ ] Out of scope explícito

- [ ] Traceability completa

- [ ] Headings canónicos o aliases estructurales válidos respetados

- [ ] Todos los CAs usan formato `### CA-n - ...` o `### CA-n: ...`

- [ ] Todos los CAs usan `GIVEN / WHEN / THEN / AND`

- [ ] Validado por PO

- [ ] Validado por TL
