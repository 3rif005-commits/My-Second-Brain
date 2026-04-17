# API Tests Workspace

`.http` files for testing endpoints with VS Code REST Client or similar.

## Naming convention
`[service]-[endpoint].http`

Examples:
- `notes-crud.http`
- `ingest-pdf.http`
- `retrieval-semantic.http`

## Template

```http
### GET all notes
GET http://localhost:3000/api/notes
Authorization: Bearer {{token}}

###
```
