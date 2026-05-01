-- ============================================================
-- DS2 Test Fixture Seed
-- Apply against the dev DB ONLY.
-- This script creates a deterministic test account (id 9001) with
-- known users, customers, categories, job types, and general work
-- descriptions for use by integration tests.
--
-- Idempotent: safe to re-run; uses INSERT ... ON CONFLICT DO NOTHING
-- where unique constraints exist, otherwise checks NOT EXISTS.
-- ============================================================

DO $$
BEGIN
   -- Test account (id 9001 reserved for tests).
   IF NOT EXISTS (SELECT 1 FROM accounts WHERE account_id = 9001) THEN
      INSERT INTO accounts(account_id, account_name, account_type, is_account_active)
         VALUES (9001, 'TEST FIXTURE ACCOUNT', 'business', true);
   END IF;

   -- Test users (employees who fill out time trackers).
   IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = 90011) THEN
      INSERT INTO users(user_id, account_id, email, display_name, cost_rate, billing_rate, job_title, access_level, is_user_active)
         VALUES (90011, 9001, 'eliza+test@example.com', 'Eliza Smith', 25.00, 75.00, 'Accountant', 'employee', true);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = 90012) THEN
      INSERT INTO users(user_id, account_id, email, display_name, cost_rate, billing_rate, job_title, access_level, is_user_active)
         VALUES (90012, 9001, 'bob+test@example.com', 'Bob Jones', 30.00, 90.00, 'Senior Accountant', 'employee', true);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = 90013) THEN
      INSERT INTO users(user_id, account_id, email, display_name, cost_rate, billing_rate, job_title, access_level, is_user_active)
         VALUES (90013, 9001, 'admin+test@example.com', 'Admin Person', 0, 0, 'Admin', 'admin', true);
   END IF;
   -- Inactive user — for the employee_not_matched test path.
   IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = 90014) THEN
      INSERT INTO users(user_id, account_id, email, display_name, cost_rate, billing_rate, job_title, access_level, is_user_active)
         VALUES (90014, 9001, 'inactive+test@example.com', 'Sam Inactive', 25.00, 75.00, 'Accountant', 'employee', false);
   END IF;

   -- Test customers.
   IF NOT EXISTS (SELECT 1 FROM customers WHERE customer_id = 900101) THEN
      INSERT INTO customers(customer_id, account_id, business_name, customer_name, display_name, is_commercial_customer, is_customer_active, is_billable, is_recurring)
         VALUES (900101, 9001, 'Acme Corporation', 'Acme', 'Acme Corp', true, true, true, true);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customers WHERE customer_id = 900102) THEN
      INSERT INTO customers(customer_id, account_id, business_name, customer_name, display_name, is_commercial_customer, is_customer_active, is_billable, is_recurring)
         VALUES (900102, 9001, 'Globex Industries', 'Globex', 'Globex Industries', true, true, true, true);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customers WHERE customer_id = 900103) THEN
      INSERT INTO customers(customer_id, account_id, business_name, customer_name, display_name, is_commercial_customer, is_customer_active, is_billable, is_recurring)
         VALUES (900103, 9001, NULL, 'John Smith', 'Smith, John', false, true, true, false);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customers WHERE customer_id = 900104) THEN
      INSERT INTO customers(customer_id, account_id, business_name, customer_name, display_name, is_commercial_customer, is_customer_active, is_billable, is_recurring)
         VALUES (900104, 9001, NULL, 'Jane Smith', 'Smith, Jane', false, true, true, false);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customers WHERE customer_id = 900105) THEN
      INSERT INTO customers(customer_id, account_id, business_name, customer_name, display_name, is_commercial_customer, is_customer_active, is_billable, is_recurring)
         VALUES (900105, 9001, 'Wayne Enterprises LLC', 'Wayne', 'Wayne Enterprises', true, true, true, true);
   END IF;

   -- Job categories.
   IF NOT EXISTS (SELECT 1 FROM customer_job_categories WHERE customer_job_category_id = 90001) THEN
      INSERT INTO customer_job_categories(customer_job_category_id, account_id, customer_job_category, is_job_category_active, created_by_user_id)
         VALUES (90001, 9001, 'Tax Compliance', true, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_job_categories WHERE customer_job_category_id = 90002) THEN
      INSERT INTO customer_job_categories(customer_job_category_id, account_id, customer_job_category, is_job_category_active, created_by_user_id)
         VALUES (90002, 9001, 'Bookkeeping', true, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_job_categories WHERE customer_job_category_id = 90003) THEN
      INSERT INTO customer_job_categories(customer_job_category_id, account_id, customer_job_category, is_job_category_active, created_by_user_id)
         VALUES (90003, 9001, 'Consulting', true, 90013);
   END IF;

   -- Job types.
   IF NOT EXISTS (SELECT 1 FROM customer_job_types WHERE job_type_id = 900201) THEN
      INSERT INTO customer_job_types(job_type_id, account_id, customer_job_category_id, job_description, book_rate, estimated_straight_time, is_job_type_active, created_by_user_id)
         VALUES (900201, 9001, 90001, '1040 Individual Return', 75, 120, true, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_job_types WHERE job_type_id = 900202) THEN
      INSERT INTO customer_job_types(job_type_id, account_id, customer_job_category_id, job_description, book_rate, estimated_straight_time, is_job_type_active, created_by_user_id)
         VALUES (900202, 9001, 90001, '1120 Corporate Return', 75, 240, true, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_job_types WHERE job_type_id = 900203) THEN
      INSERT INTO customer_job_types(job_type_id, account_id, customer_job_category_id, job_description, book_rate, estimated_straight_time, is_job_type_active, created_by_user_id)
         VALUES (900203, 9001, 90002, 'Monthly Bookkeeping', 75, 60, true, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_job_types WHERE job_type_id = 900204) THEN
      INSERT INTO customer_job_types(job_type_id, account_id, customer_job_category_id, job_description, book_rate, estimated_straight_time, is_job_type_active, created_by_user_id)
         VALUES (900204, 9001, 90003, 'General Consulting', 90, 30, true, 90013);
   END IF;

   -- General work descriptions.
   IF NOT EXISTS (SELECT 1 FROM customer_general_work_descriptions WHERE general_work_description_id = 90031) THEN
      INSERT INTO customer_general_work_descriptions(general_work_description_id, account_id, general_work_description, estimated_time, is_general_work_description_active, created_by_user_id)
         VALUES (90031, 9001, 'Tax Return Preparation', 120, true, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_general_work_descriptions WHERE general_work_description_id = 90032) THEN
      INSERT INTO customer_general_work_descriptions(general_work_description_id, account_id, general_work_description, estimated_time, is_general_work_description_active, created_by_user_id)
         VALUES (90032, 9001, 'Bookkeeping Reconciliation', 60, true, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_general_work_descriptions WHERE general_work_description_id = 90033) THEN
      INSERT INTO customer_general_work_descriptions(general_work_description_id, account_id, general_work_description, estimated_time, is_general_work_description_active, created_by_user_id)
         VALUES (90033, 9001, 'Client Meeting / Consultation', 30, true, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_general_work_descriptions WHERE general_work_description_id = 90034) THEN
      INSERT INTO customer_general_work_descriptions(general_work_description_id, account_id, general_work_description, estimated_time, is_general_work_description_active, created_by_user_id)
         VALUES (90034, 9001, 'Email Correspondence', 15, true, 90013);
   END IF;

   -- One customer_job per customer (for FK satisfaction during transaction inserts).
   IF NOT EXISTS (SELECT 1 FROM customer_jobs WHERE customer_job_id = 9001001) THEN
      INSERT INTO customer_jobs(customer_job_id, account_id, customer_id, job_type_id, current_job_total, is_quote, created_by_user_id)
         VALUES (9001001, 9001, 900101, 900201, 0, false, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_jobs WHERE customer_job_id = 9001002) THEN
      INSERT INTO customer_jobs(customer_job_id, account_id, customer_id, job_type_id, current_job_total, is_quote, created_by_user_id)
         VALUES (9001002, 9001, 900102, 900202, 0, false, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_jobs WHERE customer_job_id = 9001003) THEN
      INSERT INTO customer_jobs(customer_job_id, account_id, customer_id, job_type_id, current_job_total, is_quote, created_by_user_id)
         VALUES (9001003, 9001, 900103, 900201, 0, false, 90013);
   END IF;

   -- Time tracker staff (users who get notified).
   IF NOT EXISTS (SELECT 1 FROM time_tracker_staff WHERE user_id = 90013) THEN
      INSERT INTO time_tracker_staff(user_id, is_active) VALUES (90013, true);
   END IF;

   -- Customer information rows (required for invoice generation; one per
   -- test customer that participates in billing tests).
   IF NOT EXISTS (SELECT 1 FROM customer_information WHERE customer_id = 900101) THEN
      INSERT INTO customer_information(account_id, customer_id, customer_street, customer_city, customer_state, customer_zip, customer_email, customer_phone, is_this_address_active, is_customer_physical_address, is_customer_billing_address, is_customer_mailing_address, created_by_user_id)
         VALUES (9001, 900101, '1 Acme Way', 'Phoenix', 'AZ', '85001', 'billing@acme-test.example', '5550100100', true, true, true, true, 90013);
   END IF;
   IF NOT EXISTS (SELECT 1 FROM customer_information WHERE customer_id = 900102) THEN
      INSERT INTO customer_information(account_id, customer_id, customer_street, customer_city, customer_state, customer_zip, customer_email, customer_phone, is_this_address_active, is_customer_physical_address, is_customer_billing_address, is_customer_mailing_address, created_by_user_id)
         VALUES (9001, 900102, '2 Globex Plaza', 'Phoenix', 'AZ', '85001', 'billing@globex-test.example', '5550100200', true, true, true, true, 90013);
   END IF;
END $$;

-- Reset sequence floors for the IDENTITY columns so future inserts continue
-- past our reserved IDs without collision.
SELECT pg_catalog.setval(pg_get_serial_sequence('accounts','account_id'), GREATEST((SELECT MAX(account_id) FROM accounts), 9001), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('users','user_id'), GREATEST((SELECT MAX(user_id) FROM users), 90014), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customers','customer_id'), GREATEST((SELECT MAX(customer_id) FROM customers), 900105), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customer_job_categories','customer_job_category_id'), GREATEST((SELECT MAX(customer_job_category_id) FROM customer_job_categories), 90003), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customer_job_types','job_type_id'), GREATEST((SELECT MAX(job_type_id) FROM customer_job_types), 900204), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customer_general_work_descriptions','general_work_description_id'), GREATEST((SELECT MAX(general_work_description_id) FROM customer_general_work_descriptions), 90034), true);
SELECT pg_catalog.setval(pg_get_serial_sequence('customer_jobs','customer_job_id'), GREATEST((SELECT MAX(customer_job_id) FROM customer_jobs), 9001003), true);

\echo 'Test fixture seed applied. Account 9001 ready.'
