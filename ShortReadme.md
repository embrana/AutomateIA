# Resumen corto de `main`

Es un fork de OpenSpec que agrega integracion con Jira para:

- importar contexto del ticket,
- crear artefactos OpenSpec desde Jira,
- medir tiempo local de trabajo,
- y grabar worklogs en Jira al hacer `archive`.

## Comandos principales

- `osj config set ...` / `config show`
- `osj purpose --jira PROJ-123 --import-ticket`
- `osj purpose --jira PROJ-123 --import-ticket --create-change`
- `osj new change --from-ticket PROJ-123`
- `osj timer status`
- `osj timer pause`
- `osj timer resume`
- `osj timer cancel`
- `osj archive <change-name> --yes --comment "..."`

## Registro de tiempo en `main`

- Hay una sesion activa por vez.
- El timer arranca con `purpose`.
- Se puede pausar y reanudar.
- Al hacer `archive`, calcula la duracion, aplica redondeo y hace `POST` a Jira Worklog.
- Si falla el sync con Jira, la sesion queda como `sync_pending` para reintentar con `archive --retry`.
- El tiempo queda asociado al ticket Jira del desarrollador.
- En `main`, el modelo es todavia el flujo base de sesion/worklog; lo mas granular y avanzado quedo en la rama `timeblocks`.
