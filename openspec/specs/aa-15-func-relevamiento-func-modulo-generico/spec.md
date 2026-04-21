# aa-15-func-relevamiento-func-modulo-generico Specification

## Purpose
TBD - created by archiving change aa-15-func-relevamiento-func-modulo-generico. Update Purpose after archive.
## Requirements
### Requirement: [FUNC] Relevamiento Func Modulo Generico
The system SHALL implement the behavior requested by Jira issue `AA-15`.

Imported Jira description:

> Funcionalidad: Pantalla Módulo genérico de carga de datos/informes por especialistas (Médico, Nutricionista, etc)
>
>  Objetivo / JTBD: Como Especialista del área de interdisciplinario quiero tener un flujo para cargar datos e informes adjuntos
>
> Incluye:
>
> - Botón para carga de nuevo documento
> - Picker de Fecha - Selección fecha automático día de hoy
> - Campo de texto para cargar descripción
> - Campo estado tipo semáforo para indicar estado, verde (situación normal), amarillo (Advertencia), rojo (situación compleja)
>
> Inflow:
>
> - Documentos tipo pdf, word, excel, csv,
> - Datos de inputs de texto y numérico
>
> Transformaciones:
>
> - Los documentos son leidos por IA y parametrizados sus campos,
> - el módulo de IA también detecta datos del jugador, Nombre apellido, documento para su grabado de datos al correspondiente jugador
>
> Outflow:
>
> - Modal (pantalla) de confirmación de campos y datos,
> - emisión de datos para consumo de otros microservicios (jugadores)
>
> Criterios de Aceptación
> Alcance y supuestos
>
> - Se registra un documento por carga (PDF, DOC/DOCX, XLS/XLSX, CSV).
> - La carga crea un registro con: fecha, descripción, estado (semáforo), archivo adjunto, y (si la IA lo detecta) datos del jugador (nombre, apellido, documento).
>
> UI / Campos
>
> - Botón “Cargar nuevo documento” visible en la vista principal.
> - Picker de fecha:- Se completa automáticamente con la fecha de hoy (zona horaria del sistema).
> - Permite cambiar manualmente la fecha.
> - Descripción:- Campo de texto multilinea (mín. 10, máx. 500 caracteres).
> - Muestra contador de caracteres restante.
> - Estado (semáforo):- Tres opciones exclusivas: Verde (normal), Amarillo (advertencia), Rojo (situación compleja).
> - La opción seleccionada se refleja con color y etiqueta textual accesible.
> - Adjunto:- Acepta únicamente pdf, doc, docx, xls, xlsx, csv.
> - Límite de tamaño: XX MB por archivo.
> - Muestra progreso de carga (0–100%).
>
> Flujo de IA y datos
>
> - Tras subir el archivo, el sistema envía a IA para lectura y parametrización.
> - La IA intenta detectar Nombre, Apellido y Documento del jugador.
> - Si encuentra coincidencia exacta con un jugador existente (por documento o nombre+apellido normalizados), preasigna el registro a ese jugador.
> - Si hay múltiples candidatos o no hay coincidencia, el sistema solicita selección manual en el modal de confirmación.
> - La parametrización de campos detectados se muestra en el modal y puede editarse antes de confirmar.
>
> Modal de confirmación (Outflow)
>
> - El modal presenta: fecha, descripción, estado, nombre/apellido/documento (si detectados), jugador asociado (o selector), un resumen del archivo, campos parametrizados con posibilidad de ajustarlos.
> - Botones: Confirmar (habilitado solo si las validaciones pasan) y Cancelar.
> - Al Confirmar, se guarda el registro y se cierra el modal; aparece mensaje de éxito.
> - Al Cancelar, no se guarda nada y se mantienen los datos en el formulario hasta cerrar explícitamente.
>
> No-incluye
>
> - No hay edición masiva ni carga múltiple.
> - No hay procesamiento de imágenes (JPG/PNG) ni OCR avanzado fuera de los formatos definidos.
>
> Escenarios (Gherkin)
>
> - Fecha por defecto hoy
>
> Dado que abro el formulario de “Cargar nuevo documento”
> Entonces el campo Fecha muestra la fecha del día de hoy
> Y puedo modificarla manualmente
>
> - Validación de extensiones y tamaño
>
> Cuando adjunto un archivo .exe de 1 MB
> Entonces veo un mensaje “Formato no permitido”
> Y no puedo continuar
> Cuando adjunto un PDF de 30 MB
> Entonces veo “El archivo excede 25 MB”
> Y no puedo continuar
>
> - Descripción obligatoria
>
> Dado que la descripción tiene menos de 10 caracteres
> Cuando intento Confirmar
> Entonces el botón Confirmar permanece deshabilitado
> Y veo el mensaje “Mínimo 10 caracteres”
>
> - Estado semáforo obligatorio
>
> Dado que no seleccioné estado
> Cuando intento Confirmar
> Entonces el sistema muestra “Seleccione un estado”
>
> - IA detecta jugador y asigna
>
> Dado que subo un PDF válido
> Y la IA detecta Documento que coincide con un jugador
> Entonces el modal muestra el jugador preasignado
> Y puedo Confirmar sin seleccionar manualmente
>
> - IA sin coincidencia → selección manual
>
> Dado que la IA no encuentra coincidencias
> Cuando se abre el modal
> Entonces veo un buscador de jugador
> Y debo seleccionar uno para habilitar Confirmar
>
> - Falla de IA → modo manual
>
> Dado que la IA falla por timeout
> Entonces el sistema muestra “No se pudo analizar, continúe manualmente”
> Y el modal se abre con campos editables vacíos
>
> - Confirmación exitosa
>
> Dado archivo válido, descripción ≥10, estado seleccionado y jugador definido
> Cuando presiono Confirmar
> Entonces se guarda el registro
> Y veo “Documento cargado con éxito”
> Y el modal se cierra
>
> - Cancelar sin cambios
>
> Dado que estoy en el modal de confirmación
> Cuando presiono Cancelar
> Entonces no se guarda ningún dato
> Y regreso a la pantalla anterior
>
> Dependencias: módulo de IA
> Riesgos:
> Clasificación MoSCoW:
>
> Adjunto pantalla actual, y mockups nuevo flujo

#### Scenario: Jira ticket request is satisfied
- **GIVEN** Jira issue `AA-15` describes requested behavior
- **WHEN** the change is implemented
- **THEN** the implementation SHALL satisfy the imported Jira ticket description

