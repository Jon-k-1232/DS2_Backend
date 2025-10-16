# DS2 Backend

DS2 Backend is the Node.js + PostgreSQL API that powers the DS2 time, billing, and invoicing platform. It handles authentication, customer and job management, time tracking ingestion, monthly invoice generation, and integration with email and S3 storage.

Current package version: `0.1.0.36` (mirrors `package.json`).

Looking for the frontend? See [DS2_Frontend/README.md](../DS2_Frontend/README.md) for the React app details.

## Stack Overview
- Express 4 with modular routers under `src/endpoints`.
- Knex/pg for PostgreSQL access.
- JWT authentication with role-based middleware.
- Node Schedule for background automations.
- PDFKit, ExcelJS, Archiver, and AWS SDK v3 for document generation and S3 storage.
- Test harness built on Mocha, Chai, and Supertest.

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` in the project root with the variables listed below.
3. Ensure the PostgreSQL database referenced by `DATABASE_URL` exists (default `ds2_dev`) and run migrations with Postgrator as needed:
   ```bash
   npx postgrator --config postgrator-config.js --migration-directory migrations
   ```
4. Start the API:
   ```bash
   npm run dev
   ```
   Production mode uses `npm start`.
5. Run the test suite:
   ```bash
   npm test
   ```

## Environment Variables

| Variable | Type | Purpose |
| --- | --- | --- |
| `NODE_ENV` | string (`development` \| `production`) | Selects dev/prod config branches and logging. |
| `NODE_PORT_DEV` | number | Port exposed when running locally. |
| `NODE_PORT_PROD` | number | Port exposed in production. |
| `HOST_IP_DEV` | string | Interface to bind Express to in development (e.g. `127.0.0.1`). |
| `HOST_IP_PROD` | string | Interface for production deployments. |
| `FRONT_END_URL_DEV` | URL | Allowed origin for CORS/cookies in development. |
| `FRONT_END_URL_PROD` | URL | Allowed origin for production. |
| `DB_DEV_HOST` | string | PostgreSQL host in development. |
| `DB_PROD_HOST` | string | PostgreSQL host in production. |
| `DATABASE_USER` | string | Database username. |
| `DATABASE_PASSWORD` | string | Database password. |
| `DATABASE_URL` | string | Database name/connection string (default `ds2_dev`). |
| `API_TOKEN` | string | Shared token for protected automation endpoints. |
| `JWT_EXPIRATION` | string | JWT lifetime (e.g. `12h`). |
| `DOMAIN` | string | Domain used in notification emails. |
| `FROM_EMAIL` | email | Default sender address. |
| `FROM_EMAIL_SMTP` | host | SMTP server hostname. |
| `FROM_EMAIL_SMTP_PORT` | number (optional, default `587`) | SMTP port; set to `465` when using implicit TLS. |
| `FROM_EMAIL_SMTP_SECURE` | boolean (optional) | Set to `true` to force `secure: true` (defaults to `true` when port `465`). |
| `FROM_EMAIL_REJECT_UNAUTHORIZED` | boolean (optional, default `true`) | Set to `false` when using self-signed certificates. |
| `FROM_EMAIL_USERNAME` | string | SMTP username. |
| `FROM_EMAIL_PASSWORD` | string | SMTP password. |
| `TIME_TRACKING_ADMIN_EMAILS` | comma-separated string (optional) | Fallback recipients for time-tracker validation/system error alerts when the staff list is empty. |
| `SEND_TO_EMAILS` | comma-separated string (optional) | Default recipient list used when an email call omits explicit recipients. |
| `S3_BUCKET_NAME` | string | Bucket containing trackers/invoices/logos. |
| `S3_REGION` | string | Region for the S3-compatible endpoint. |
| `S3_ENDPOINT` | URL | Optional override endpoint (trailing slashes trimmed automatically). |
| `S3_ACCESS_KEY_ID` | string | S3 access key. |
| `S3_SECRET_ACCESS_KEY` | string | S3 secret key. |
| `SSL` | boolean (optional) | Enables Postgrator SSL support. |
| `PRODUCTION_PDF_SAVE_LOCATION` | string (optional) | Filesystem path used by automations to archive PDFs. |

## Scheduled Automations

`src/automations/automationOrchestrator.js` registers three cron jobs (Phoenix timezone):
- **Thursday 09:00** – reminder emails for upcoming deadlines.
- **Friday 15:30** – final weekly reminders.
- **Daily 09:00** – missing tracker reminders.

Recipients are stored per account and managed through the `/account/automations` endpoints.

Health checks (`GET /health/status/:accountID/:userID`) now mail the active `time_tracker_staff` list when any subsystem reports **DOWN**; alerts are throttled per account (15‑minute cooldown) and include memory/CPU/database/S3 status.

Automated tests for these schedules live in `test/automations.spec.js`; run `npm test` after installing dependencies to verify the cron wiring and ensure the Express app boots.

## API Reference

All routes live under `src/endpoints`. Most require JWT authentication plus role checks (`requireAuth`, `requireManagerOrAdmin`, `requireAdmin`).

### Authentication (`/auth`)
| Method & Path | Purpose |
| --- | --- |
| `POST /auth/login` | Authenticate user, log login, return JWT + profile. |
| `POST /auth/requestPasswordReset` | Email a temporary password if the identifier matches an active user. |
| `POST /auth/updatePassword` | Authenticated users set a new password. |
| `POST /auth/renew` | Refresh a JWT for an active login. |

### Account (`/account`)
| Method & Path | Purpose |
| --- | --- |
| `POST /account/createAccount` | Create an account and account_information entries. |
| `PUT /account/updateAccount` | Admin-only update of account profile/billing metadata. |
| `GET /account/AccountInformation/:accountID/:userID` | Admin-only fetch of account profile and logo (from S3). |
| `GET /account/automations/:accountID/:userID` | Admin-only fetch of automation settings plus available users. |
| `PUT /account/automations/:accountID/:userID` | Admin-only update of automation recipients and enabled status. |

### Users (`/user`)
| Method & Path | Purpose |
| --- | --- |
| `POST /user/createUser/:accountID/:userID` | Manager/Admin create a staff user and login. |
| `PUT /user/updateUser/:accountID/:userID` | Manager/Admin update staff profile. |
| `PUT /user/updateUserLogin/:accountID/:userID` | Manager/Admin change username/password/active status. |
| `DELETE /user/deleteUser/:accountID/:userID` | Manager/Admin remove a user and login. |
| `GET /user/fetchSingleUser/:accountID/:userID` | Manager/Admin retrieve detailed user info. |

### Customers (`/customer`)
| Method & Path | Purpose |
| --- | --- |
| `POST /customer/createCustomer/:accountID/:userID` | Create customer + customer_information records (checks duplicates). |
| `GET /customer/activeCustomers/customerByID/:accountID/:userID/:customerID` | Fetch customer profile, retainers, invoices, payments, transactions, jobs. |
| `PUT /customer/updateCustomer/:accountID/:userID` | Update customer/contact info, manage recurring linkage. |
| `DELETE /customer/deleteCustomer/:customerID/:accountID/:userID` | Soft delete customer and refresh active lists. |

### Recurring Customers (`/recurringCustomer`)
| Method & Path | Purpose |
| --- | --- |
| `POST /recurringCustomer/createRecurringCustomer/:accountID/:userID` | Flag customer as recurring and create schedule record. |
| `GET /recurringCustomer/getActiveRecurringCustomers/:accountID/:userID` | List active recurring customers. |
| `PUT /recurringCustomer/updateRecurringCustomer` | Update recurrence settings. |
| `DELETE /recurringCustomer/deleteRecurringCustomer/:accountID/:recurringCustomerId` | Delete recurring record. |

### Jobs (`/jobs`)
| Method & Path | Purpose |
| --- | --- |
| `POST /jobs/createJob/:accountID/:userID` | Create a job (prevents duplicates). |
| `GET /jobs/getSingleJob/:customerJobID/:accountID/:userID` | Fetch a job hierarchy. |
| `GET /jobs/getActiveCustomerJobs/:accountID/:userID/:customerID` | List active jobs for a customer. |
| `PUT /jobs/updateJob/:accountID/:userID` | Update job metadata/completion status. |
| `DELETE /jobs/deleteJob/:jobID/:accountID/:userID` | Delete job when no linked transactions/write-offs exist. |

### Job Categories (`/jobCategories`)
| Method & Path | Purpose |
| --- | --- |
| `POST /jobCategories/createJobCategory/:accountID/:userID` | Create category. |
| `PUT /jobCategories/updateJobCategory/:accountID/:userID` | Update category. |
| `DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID` | Delete unused category. |
| `GET /jobCategories/getSingleJobCategory/:jobCategoryID/:accountID/:userID` | Fetch category details. |

### Job Types (`/jobTypes`)
| Method & Path | Purpose |
| --- | --- |
| `POST /jobTypes/createJobType/:accountID/:userID` | Create job type. |
| `GET /jobTypes/getSingleJobType/:jobTypeID/:account/:userID` | Fetch job type. |
| `PUT /jobTypes/updateJobType/:accountID/:userID` | Update job type. |
| `DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID` | Delete unused job type. |

### Work Descriptions (`/workDescriptions`)
| Method & Path | Purpose |
| --- | --- |
| `POST /workDescriptions/createWorkDescription/:accountID/:userID` | Create work description template. |
| `GET /workDescriptions/getSingleWorkDescription/:workDescriptionID/:accountID/:userID` | Fetch template. |
| `PUT /workDescriptions/updateWorkDescription/:accountID/:userID` | Update template. |
| `DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID` | Delete template. |

### Quotes (`/quotes`)
| Method & Path | Purpose |
| --- | --- |
| `POST /quotes/createQuote` | Create quote. |
| `GET /quotes/getActiveQuotes/:accountID/:quoteID` | List active quotes. |
| `PUT /quotes/updateQuote` | Update quote. |
| `DELETE /quotes/deleteQuote/:accountID/:quoteID` | Delete quote. |

### Invoices (`/invoices`)
| Method & Path | Purpose |
| --- | --- |
| `GET /invoices/getInvoices/:accountID/:invoiceID` | List invoices with grid/tree data. |
| `DELETE /invoices/deleteInvoice/:accountID/:invoiceID` | Delete invoice when not referenced. |
| `GET /invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID` | Identify customers needing invoices. |
| `POST /invoices/createInvoice/:accountID/:userID` | Generate invoice documents (draft/final/CSV) and persist finalized invoices. |
| `GET /invoices/downloadFile/:accountID/:userID` | Download invoice artifact from S3. |
| `GET /invoices/getInvoiceDetails/:invoiceID/:accountID/:userID` | Fetch invoice snapshot with related transactions/payments/write-offs/retainers. |

### Transactions (`/transactions`)
| Method & Path | Purpose |
| --- | --- |
| `POST /transactions/createTransaction/:accountID/:userID` | Create transaction and update job totals/retainers. |
| `PUT /transactions/updateTransaction/:accountID/:userID` | Update non-invoiced transaction. |
| `DELETE /transactions/deleteTransaction/:accountID/:userID` | Delete non-invoiced transaction. |
| `GET /transactions/getTransactions/:accountID/:userID` | Paginated transaction list with search. |
| `GET /transactions/exportTransactions/:accountID/:userID` | Export transactions to CSV. |
| `GET /transactions/getSingleTransaction/:customerID/:transactionID/:accountID/:userID` | Fetch specific transaction. |
| `GET /transactions/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID` | Summarize employee time transactions between dates. |

### Payments (`/payments`)
| Method & Path | Purpose |
| --- | --- |
| `POST /payments/createPayment/:accountID/:userID` | Apply payment to invoice (retainer-aware). |
| `GET /payments/getSinglePayment/:paymentID/:accountID/:userID` | Retrieve payment details. |
| `PUT /payments/updatePayment/:accountID/:userID` | Update payment metadata/amount. |
| `DELETE /payments/deletePayment/:accountID/:userID` | Remove payment and associated invoice record. |

### Retainers (`/retainers`)
| Method & Path | Purpose |
| --- | --- |
| `POST /retainers/createRetainer/:accountID/:userID` | Create retainer/prepayment. |
| `PUT /retainers/updateRetainer/:accountID/:userID` | Update retainer balances. |
| `DELETE /retainers/deleteRetainer/:retainerID/:accountID/:userID` | Delete retainer when no dependencies exist. |
| `GET /retainers/getSingleRetainer/:retainerID/:accountID/:userID` | Retrieve retainer hierarchy. |
| `GET /retainers/getActiveRetainers/:customerID/:accountID/:userID` | List retainers for a customer. |

### Write-Offs (`/writeOffs`)
| Method & Path | Purpose |
| --- | --- |
| `POST /writeOffs/createWriteOffs/:accountID/:userID` | Record write-off, optionally converting to invoice adjustment. |
| `GET /writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID` | Fetch write-off. |
| `PUT /writeOffs/updateWriteOffs/:accountID/:userID` | Update write-off when permissible. |
| `DELETE /writeOffs/deleteWriteOffs/:accountID/:userID` | Delete write-off and associated invoice adjustment. |

### Time Tracker Staff (`/time-tracker-staff`)
| Method & Path | Purpose |
| --- | --- |
| `GET /time-tracker-staff/:accountID/:userID` | Manager/Admin list tracker staff and available users. |
| `POST /time-tracker-staff/:accountID/:userID` | Manager/Admin bulk add tracker staff. |
| `PUT /time-tracker-staff/:accountID/:userID/:staffID` | Manager/Admin toggle active status. |
| `DELETE /time-tracker-staff/:accountID/:userID/:staffID` | Manager/Admin remove staff entry. |

### Time Tracking (`/time-tracking`)
| Method & Path | Purpose |
| --- | --- |
| `POST /time-tracking/upload/:accountID/:userID` | Upload tracker file (validation, S3 persistence, notifications). |
| `GET /time-tracking/users/:accountID/:userID` | Return eligible users for uploads based on requester role. |
| `GET /time-tracking/history/:accountID/:userID` | List processed tracker uploads for the user. |
| `GET /time-tracking/history/download/:accountID/:userID` | Download processed tracker by S3 key. |
| `GET /time-tracking/download/by-name/:accountID/:userID` | Download tracker by original filename (with role checks). |
| `GET /time-tracking/template/latest/:accountID/:userID` | Download latest tracker template. |
| `POST /time-tracking/template/upload/:accountID/:userID` | Admin-only template upload. |
| `GET /time-tracking/template/list/:accountID/:userID` | Admin-only list of templates. |
| `DELETE /time-tracking/template/delete/:accountID/:userID` | Admin-only template deletion. |

### Timesheets (`/timesheets`)
| Method & Path | Purpose |
| --- | --- |
| `GET /timesheets/getTimesheetEntries/:accountID/:userID` | Paginated list of outstanding timesheet entries. |
| `GET /timesheets/getTimesheetEntriesByUserID/:queryUserID/:accountID/:userID` | Outstanding entries for specific user. |
| `GET /timesheets/getTimesheetErrorsByUserID/:queryUserID/:accountID/:userID` | Pending errors for a user. |
| `GET /timesheets/getAllTimesheetsForEmployeeByUserID/:queryUserID/:accountID/:userID` | Historical timesheets for a user. |
| `GET /timesheets/fetchTimesheetsByMonth/:queryUserID/:accountID/:userID` | Current month summaries. |
| `GET /timesheets/getTimesheetErrors/:accountID/:userID` | Outstanding timesheet errors. |
| `GET /timesheets/getInvalidTimesheets/:accountID/:userID` | Invalid tracker entries flagged during validation. |
| `GET /timesheets/countsByEmployee/:accountID/:userID` | Counts of outstanding entries per employee. |
| `POST /timesheets/moveToTransactions/:accountID/:userID` | Convert entry to transaction and mark processed. |
| `DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID` | Mark entry deleted. |
| `DELETE /timesheets/deleteTimesheetError/:timesheetErrorID/:accountID/:userID` | Resolve error entry. |

### Initial Data & Health
| Method & Path | Purpose |
| --- | --- |
| `GET /initialData/initialBlob/:accountID/:userID` | Aggregate customers, users, transactions, invoices, jobs, etc. for app bootstrap. |
| `GET /health/status/:accountID/:userID` | Report server statistics, DB/S3 connectivity, environment name. |

## Docker & Deployment

- `Dockerfile` builds the backend image, sets the timezone to America/Phoenix, installs dependencies, and runs `npm start`.
- `docker-compose.backend.yml` runs the container on port `8003`, mounts the repository into `/app`, and joins an external Docker network `ds2_network`.
- GitHub Actions (`.github/workflows/docker-image.yml`) run `npm test` before building, tag releases using the version declared in `package.json`, build/push Docker images to Docker Hub, and deploy via a self-hosted runner that executes the compose file with production `.env` secrets.

## Operational Notes

- S3 connectivity is mandatory for tracker uploads, invoice PDFs, and account logos (`utils/s3` includes a connectivity check at startup).
- SMTP credentials must be valid to support password resets and automation emails.
- The automation scheduler is enabled by default; comment out `automationOrchestrator.scheduledAutomations()` in `src/app.js` to disable in development.
- Ensure the external Docker network exists before running compose locally: `docker network create ds2_network`.

For the standalone repository and issue tracking, visit [github.com/Jon-k-1232/DS2_Backend](https://github.com/Jon-k-1232/DS2_Backend/tree/master).
