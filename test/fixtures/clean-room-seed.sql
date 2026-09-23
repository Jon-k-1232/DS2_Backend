-- ============================================================
-- DS2 Clean-Room Seed  (database: ds2_clean ONLY)
--
-- A minimal, fully known tenant for the clean-room regression
-- (test/integration/clean-room-regression.integration.spec.js):
--   account 1 "Clean Room CPA" with a mailing address and statement texts,
--   3 users (Super Admin / Admin / User) with billing + cost rates,
--   2 job categories, 4 job types, 4 general work descriptions,
--   6 customers with mailing addresses (individuals + businesses, one with a
--   retainer, one recurring/monthly), one job per customer per relevant type.
--
-- Idempotent: every insert is guarded (ON CONFLICT DO NOTHING on primary keys
-- with explicit ids, NOT EXISTS where there is no natural key). Plain SQL only
-- (no psql meta-commands) so knex can apply it with db.raw().
--
-- The spec truncates every table (RESTART IDENTITY) before applying this file,
-- so the ids below are also what a fresh run produces.
-- ============================================================

-- Account ---------------------------------------------------------------------
INSERT INTO accounts (account_id, account_name, account_type, is_account_active, account_statement, account_interest_statement, account_invoice_interest_rate, account_invoice_template_option)
VALUES (1, 'Clean Room CPA', 'business', true, 'Please reference invoice number on payment.', 'Balances unpaid for 30 days accrue interest at the rate of 18% per annum.', 1.50, 'template_one')
ON CONFLICT (account_id) DO NOTHING;

INSERT INTO account_information (account_id, account_street, account_city, account_state, account_zip, account_email, account_phone, is_this_address_active, is_account_physical_address, is_account_billing_address, is_account_mailing_address)
SELECT 1, '100 Ledger Way', 'Phoenix', 'AZ', '85001', 'billing@clean.test', '602-555-0100', true, true, true, true
WHERE NOT EXISTS (SELECT 1 FROM account_information WHERE account_id = 1);

-- Users -----------------------------------------------------------------------
INSERT INTO users (user_id, account_id, email, display_name, cost_rate, billing_rate, job_title, access_level, is_user_active) VALUES
   (1, 1, 'sa@clean.test',    'Sam Superadmin', 80.00, 200.00, 'Partner',    'Super Admin', true),
   (2, 1, 'admin@clean.test', 'Ada Admin',      60.00, 150.00, 'Manager',    'Admin',       true),
   (3, 1, 'staff@clean.test', 'Uma User',       40.00, 100.00, 'Accountant', 'User',        true)
ON CONFLICT (user_id) DO NOTHING;

-- Job categories --------------------------------------------------------------
INSERT INTO customer_job_categories (customer_job_category_id, account_id, customer_job_category, is_job_category_active, created_by_user_id) VALUES
   (1, 1, 'Tax Preparation',     true, 1),
   (2, 1, 'Accounting Services', true, 1)
ON CONFLICT (customer_job_category_id) DO NOTHING;

-- Job types -------------------------------------------------------------------
INSERT INTO customer_job_types (job_type_id, account_id, customer_job_category_id, job_description, book_rate, estimated_straight_time, is_job_type_active, created_by_user_id) VALUES
   (1, 1, 1, '2025 Form 1040',      350, 180, true, 1),
   (2, 1, 1, '2025 Form 1120-S',    900, 480, true, 1),
   (3, 1, 2, 'Monthly Bookkeeping', 250, 120, true, 1),
   (4, 1, 2, 'Payroll',             150,  60, true, 1)
ON CONFLICT (job_type_id) DO NOTHING;

-- General work descriptions ---------------------------------------------------
INSERT INTO customer_general_work_descriptions (general_work_description_id, account_id, general_work_description, estimated_time, is_general_work_description_active, created_by_user_id) VALUES
   (1, 1, 'Tax Return Preparation',     120, true, 1),
   (2, 1, 'Client Meeting',              30, true, 1),
   (3, 1, 'Bookkeeping Reconciliation',  60, true, 1),
   (4, 1, 'Administrative',              15, true, 1)
ON CONFLICT (general_work_description_id) DO NOTHING;

-- Customers -------------------------------------------------------------------
--   1 A  Alice Anderson        individual   1040
--   2 B  Baxter Brewing LLC    business     1120-S + Monthly Bookkeeping (recurring)
--   3 C  Carver Consulting Inc business     1120-S + Monthly Bookkeeping, $1,000 retainer
--   4 D  Dana Delgado          individual   1040 + Payroll
--   5 E  Eastside Dental PC    business     Monthly Bookkeeping
--   6 F  Frank Foster          individual   1040 + Payroll
INSERT INTO customers (customer_id, account_id, business_name, customer_name, display_name, is_commercial_customer, is_customer_active, is_billable, is_recurring) VALUES
   (1, 1, NULL,                    'Alice Anderson', 'Alice Anderson',        false, true, true, false),
   (2, 1, 'Baxter Brewing LLC',    'Bob Baxter',     'Baxter Brewing LLC',    true,  true, true, true),
   (3, 1, 'Carver Consulting Inc', 'Cara Carver',    'Carver Consulting Inc', true,  true, true, false),
   (4, 1, NULL,                    'Dana Delgado',   'Dana Delgado',          false, true, true, false),
   (5, 1, 'Eastside Dental PC',    'Ed East',        'Eastside Dental PC',    true,  true, true, false),
   (6, 1, NULL,                    'Frank Foster',   'Frank Foster',          false, true, true, false)
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO customer_information (customer_info_id, account_id, customer_id, customer_street, customer_city, customer_state, customer_zip, customer_email, customer_phone, is_this_address_active, is_customer_physical_address, is_customer_billing_address, is_customer_mailing_address, created_by_user_id) VALUES
   (1, 1, 1, '11 Aspen Ct',       'Mesa',       'AZ', '85201', 'alice@clean.test',   '480-555-0101', true, true, true, true, 1),
   (2, 1, 2, '22 Brewery Rd',     'Tempe',      'AZ', '85281', 'ap@baxter.test',     '480-555-0102', true, true, true, true, 1),
   (3, 1, 3, '33 Consult Blvd',   'Scottsdale', 'AZ', '85251', 'ap@carver.test',     '480-555-0103', true, true, true, true, 1),
   (4, 1, 4, '44 Desert Ln',      'Chandler',   'AZ', '85224', 'dana@clean.test',    '480-555-0104', true, true, true, true, 1),
   (5, 1, 5, '55 Enamel Ave',     'Gilbert',    'AZ', '85234', 'office@eastside.test','480-555-0105', true, true, true, true, 1),
   (6, 1, 6, '66 Foothill Dr',    'Phoenix',    'AZ', '85018', 'frank@clean.test',   '480-555-0106', true, true, true, true, 1)
ON CONFLICT (customer_info_id) DO NOTHING;

-- Recurring (monthly) customer: B ------------------------------------------------
INSERT INTO recurring_customers (recurring_customer_id, account_id, customer_id, subscription_frequency, bill_on_date, recurring_bill_amount, start_date, end_date, is_recurring_customer_active, created_by_user_id)
VALUES (1, 1, 2, 'Monthly', 1, 250.00, DATE '2026-01-01', NULL, true, 1)
ON CONFLICT (recurring_customer_id) DO NOTHING;

-- Retainer: C holds $1,000 (stored NEGATIVE = credit) -----------------------------
INSERT INTO customer_retainers_and_prepayments (retainer_id, parent_retainer_id, customer_id, account_id, display_name, type_of_hold, starting_amount, current_amount, form_of_payment, payment_reference_number, is_retainer_active, created_by_user_id, note)
VALUES (1, NULL, 3, 1, 'Season retainer', 'Retainer', -1000.00, -1000.00, 'Check', '9001', true, 1, 'clean-room seed')
ON CONFLICT (retainer_id) DO NOTHING;

-- Jobs: one per customer per relevant job type -----------------------------------
INSERT INTO customer_jobs (customer_job_id, parent_job_id, account_id, customer_id, job_type_id, job_quote_amount, agreed_job_amount, current_job_total, job_status, is_job_complete, is_quote, created_by_user_id, notes) VALUES
   ( 1, NULL, 1, 1, 1, 0, 0, 0, NULL, false, false, 1, 'A 1040'),
   ( 2, NULL, 1, 2, 2, 0, 0, 0, NULL, false, false, 1, 'B 1120-S'),
   ( 3, NULL, 1, 2, 3, 0, 0, 0, NULL, false, false, 1, 'B bookkeeping'),
   ( 4, NULL, 1, 3, 2, 0, 0, 0, NULL, false, false, 1, 'C 1120-S'),
   ( 5, NULL, 1, 3, 3, 0, 0, 0, NULL, false, false, 1, 'C bookkeeping'),
   ( 6, NULL, 1, 4, 1, 0, 0, 0, NULL, false, false, 1, 'D 1040'),
   ( 7, NULL, 1, 4, 4, 0, 0, 0, NULL, false, false, 1, 'D payroll'),
   ( 8, NULL, 1, 5, 3, 0, 0, 0, NULL, false, false, 1, 'E bookkeeping'),
   ( 9, NULL, 1, 6, 1, 0, 0, 0, NULL, false, false, 1, 'F 1040'),
   (10, NULL, 1, 6, 4, 0, 0, 0, NULL, false, false, 1, 'F payroll')
ON CONFLICT (customer_job_id) DO NOTHING;

-- Identity sequences: continue past the explicit ids above --------------------------
SELECT pg_catalog.setval(pg_get_serial_sequence('accounts', 'account_id'), GREATEST((SELECT MAX(account_id) FROM accounts), 1), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('account_information', 'account_info_id'), GREATEST((SELECT COALESCE(MAX(account_info_id), 1) FROM account_information), 1), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('users', 'user_id'), GREATEST((SELECT MAX(user_id) FROM users), 3), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customer_job_categories', 'customer_job_category_id'), GREATEST((SELECT MAX(customer_job_category_id) FROM customer_job_categories), 2), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customer_job_types', 'job_type_id'), GREATEST((SELECT MAX(job_type_id) FROM customer_job_types), 4), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customer_general_work_descriptions', 'general_work_description_id'), GREATEST((SELECT MAX(general_work_description_id) FROM customer_general_work_descriptions), 4), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customers', 'customer_id'), GREATEST((SELECT MAX(customer_id) FROM customers), 6), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customer_information', 'customer_info_id'), GREATEST((SELECT MAX(customer_info_id) FROM customer_information), 6), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('recurring_customers', 'recurring_customer_id'), GREATEST((SELECT MAX(recurring_customer_id) FROM recurring_customers), 1), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customer_retainers_and_prepayments', 'retainer_id'), GREATEST((SELECT MAX(retainer_id) FROM customer_retainers_and_prepayments), 1), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customer_jobs', 'customer_job_id'), GREATEST((SELECT MAX(customer_job_id) FROM customer_jobs), 10), true);
