# Data Ingestion Module

The Data Ingestion module is the React and Ant Design interface for the Foundry
`adp/data-ingestion` service.

## Entry points

- `/data-ingestion` — overview
- `/data-ingestion/import` — upload, inspect, execute, and verify ingestion
- `/data-ingestion/pipelines` — pipeline templates and complete stage specifications
- `/data-ingestion/sources` — source configuration
- `/task-management?tab=data-ingestion` — unified ingestion task history and stage details
- `/data-ingestion/catalog` — datasets and canonical records
- `/data-ingestion/auto-scan` — scheduled discovery
- `/data-ingestion/agent` — built-in Agent and MCP workbench

When no control database is configured, the module shows a first-run setup
screen. A platform administrator enters the database server, port, database
name, username, and password; Studio builds the MySQL/MariaDB connection URL
instead of asking the user to write one. The account can create the dedicated
database automatically, while a separate one-time database creation account is
available under advanced options.
The encrypted connection URL is stored in the deployment's
`data-ingestion-config` volume. Administrators can later switch to another
control database from the page header. Switching preserves the old database and
does not copy or delete its data.

Data spaces use the same field-based connection form: server, port, database
name, username, and password. Studio generates the internal space identifier,
so users do not need to invent or understand a slug. The selected database must
already exist; Studio creates the required tables after connecting.

Control database setup, control database switching, and data-space creation can
also start from an existing compatible MariaDB/MySQL record in Data Connect.
Selecting a record fills the server, port, username, and first known database.
Data Connect intentionally does not return stored passwords, so the user
re-enters the password before testing or saving.

The same picker also lists the currently configured ingestion control database
and existing data spaces. These entries are marked as coming from Data
Ingestion. Their persisted password is never returned, so the password and,
where unavailable, username must be entered again.

All requests use the existing Studio HTTP client, OAuth token, locale, and error
handling. The callback APIs are exposed through `DataIngestionWorkbenchScene`
and the module manifest so other agents can integrate the same scene without
importing route pages.
