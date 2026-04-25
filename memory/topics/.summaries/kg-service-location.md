<!-- Auto-generated summary — 2026-04-25 -->
# kg-service-location

KG service runs on port 3300 but `which kn` returns not-found, indicating it was likely started via a project-local script or npm command rather than as a global binary. The next investigation should use `lsof` to identify the service's source tree and check for edge endpoint definitions in the codebase. The service provides HTTP routes for knowledge/project/session CRUD operations, search, and AI features through a chi router on port 3300.
