INSERT INTO accounts(account_id, account_name, account_type, is_account_active, account_statement, account_interest_statement, account_invoice_interest_rate, account_invoice_template_option, account_company_logo, created_at)
     VALUES (1, 'Acme Inc.', 'Business', TRUE, 'test account statement', 'test interest statement', 1.5, 'template_one', NULL, '2022-01-01 09:00:00'),
(2, 'John Smith', 'Individual', TRUE, 'test account statement', 'test interest statement', 1.5, 'template_one', NULL, '2022-01-02 10:00:00'),
(3, 'Jane Doe', 'Individual', TRUE, 'test account statement', 'test interest statement', 1.5, 'template_one', NULL, '2022-01-03 11:00:00'),
(4, 'XYZ Corporation', 'Business', TRUE, 'test account statement', 'test interest statement', 1.5, 'template_one', NULL, '2022-01-04 12:00:00'),
(5, 'Bob Johnson', 'Individual', TRUE, 'test account statement', 'test interest statement', 1.5, 'template_one', NULL, '2022-01-05 13:00:00');

INSERT INTO account_information(account_info_id, account_id, account_street, account_city, account_state, account_zip, account_email, account_phone, is_this_address_active, is_account_physical_address, is_account_billing_address, is_account_mailing_address, created_at)
     VALUES (1, 1, '123 Main St', 'New York', 'NY', '10001', 'aspire@jimkimmel.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, '2022-01-01 09:00:00'),
(2, 1, '456 Park Ave', 'New York', 'NY', '10002', 'aspire@jimkimmel.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, '2022-01-01 10:00:00'),
(3, 2, '789 Elm St', 'Boston', 'MA', '02115', 'aspire@jimkimmel.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, '2022-01-02 11:00:00'),
(4, 3, '111 Oak Rd', 'Los Angeles', 'CA', '90001', 'aspire@jimkimmel.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, '2022-01-03 12:00:00'),
(5, 4, '222 Pine St', 'Seattle', 'WA', '98101', 'aspire@jimkimmel.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, '2022-01-04 13:00:00'),
(6, 5, '333 Maple St', 'Chicago', 'IL', '60601', 'aspire@jimkimmel.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, '2022-01-05 14:00:00');

INSERT INTO users(account_id, email, display_name, cost_rate, billing_rate, job_title, access_level, is_user_active, created_at)
     VALUES (2, 'johndoe@example.com', 'John Doe', 40.00, 75.00, 'Lawn Care Specialist', 'manager', TRUE, '2022-03-01 08:00:00'),
(2, 'janedoe@example.com', 'Jane Doe', 50.00, 90.00, 'Gutter Cleaning Specialist', 'manager', TRUE, '2022-03-01 08:00:00'),
(2, 'bobsmith@example.com', 'Bob Smith', 45.00, 85.00, 'Window Specialist', 'manager', TRUE, '2022-03-01 08:00:00'),
(2, 'janesmith@example.com', 'Jane Smith', 55.00, 100.00, 'Pest Control Specialist', 'manager', TRUE, '2022-03-01 08:00:00');

INSERT INTO user_login(account_id, user_id, user_name, password_hash, is_login_active, created_at, updated_at)
     VALUES (1, 1, 'johndoe', '3b3d7cb8c71e1bba19c7109f9e2c60a7', TRUE, '2022-03-01 08:00:00', '2022-03-01 08:00:00'),
(1, 2, 'janedoe', 'bb998ade6d7bfc2f91a9e10a8af55e7a', TRUE, '2022-03-01 08:00:00', '2022-03-01 08:00:00'),
(2, 3, 'bobsmith', '5e5b98f03e4d4c9e4b8db875e9573141', TRUE, '2022-03-01 08:00:00', '2022-03-01 08:00:00'),
(2, 4, 'janesmith', 'a25c7d93cb3c3fb9b9deca6a93d6e2f6', TRUE, '2022-03-01 08:00:00', '2022-03-01 08:00:00');

INSERT INTO customers(account_id, business_name, customer_name, display_name, is_commercial_customer, is_customer_active, is_billable, is_recurring, created_at)
     VALUES (2, 'ABC Company', 'John Smith', 'ABC Company', TRUE, TRUE, TRUE, TRUE, NOW()),
(2, 'XYZ Corporation', 'Jane Doe', 'XYZ Corporation', TRUE, TRUE, TRUE, FALSE, NOW()),
(2, 'Acme Inc.', 'Bob Johnson', 'Acme Inc.', TRUE, TRUE, TRUE, TRUE, NOW()),
(2, NULL, 'Mary Williams', 'Mary Williams', FALSE, TRUE, TRUE, FALSE, NOW()),
(2, NULL, 'Steve Brown', 'Steve Brown', FALSE, TRUE, TRUE, FALSE, NOW());

INSERT INTO customer_information(account_id, customer_id, customer_street, customer_city, customer_state, customer_zip, customer_email, customer_phone, is_this_address_active, is_customer_physical_address, is_customer_billing_address, is_customer_mailing_address, created_by_user_id, created_at)
     VALUES (2, 1, '123 Main St', 'Anytown', 'CA', '12345', 'jsmith@abccompany.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, 1, NOW()),
(2, 2, '456 Oak Ave', 'Othertown', 'NY', '67890', 'jdoe@xyzcorp.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, 1, NOW()),
(2, 3, '789 Pine St', 'Somewhere', 'TX', '23456', 'bjohnson@acmeinc.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, 2, NOW()),
(2, 4, '1010 Elm St', 'Anywhere', 'TX', '34567', 'mwilliams@gmail.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, 2, NOW()),
(2, 5, '1111 Maple St', 'Everywhere', 'TX', '45678', 'sbrown@yahoo.com', '602-555-1234', TRUE, TRUE, TRUE, TRUE, 3, NOW());

INSERT INTO recurring_customers(account_id, customer_id, subscription_frequency, bill_on_date, recurring_bill_amount, start_date, end_date, is_recurring_customer_active, created_by_user_id)
     VALUES (2, 1, 'Monthly', 1, 100.00, '2022-01-01', NULL, TRUE, 1),
(2, 2, 'Quarterly', 15, 100.00, '2022-02-01', '2022-12-31', TRUE, 1),
(2, 3, 'Weekly', 15, 100.00, '2022-03-01', '2022-06-30', TRUE, 2),
(2, 5, 'Monthly', 1, 100.00, '2022-04-01', '2022-08-31', FALSE, 3);

INSERT INTO customer_job_categories(account_id, customer_job_category, is_job_category_active, created_at, created_by_user_id)
     VALUES (2, 'Plumbing', TRUE, '2022-02-12 13:05:00', 1),
(2, 'Electrical', TRUE, '2022-02-12 13:05:00', 1),
(2, 'HVAC', TRUE, '2022-02-12 13:05:00', 1),
(2, 'Carpentry', TRUE, '2022-02-12 13:05:00', 1),
(2, 'Landscaping', TRUE, '2022-02-12 13:05:00', 1);

INSERT INTO customer_job_types(account_id, customer_job_category_id, job_description, book_rate, estimated_straight_time, is_job_type_active, created_at, created_by_user_id)
     VALUES (2, 1, 'Install water heater', 125, 2, TRUE, '2022-02-12 13:05:00', 1),
(2, 1, 'Unclog drain', 95, 1, TRUE, '2022-02-12 13:05:00', 1),
(2, 2, 'Install light fixture', 120, 1.5, TRUE, '2022-02-12 13:05:00', 1),
(2, 2, 'Replace electrical panel', 200, 8, TRUE, '2022-02-12 13:05:00', 1),
(2, 3, 'Service A/C unit', 150, 2, TRUE, '2022-02-12 13:05:00', 1),
(2, 4, 'Install door', 175, 3, TRUE, '2022-02-12 13:05:00', 1),
(2, 5, 'Landscape design', 250, 10, TRUE, '2022-02-12 13:05:00', 1);

INSERT INTO customer_jobs(parent_job_id, account_id, customer_id, job_type_id, job_quote_amount, agreed_job_amount, current_job_total, is_job_complete, is_quote, created_at, created_by_user_id, notes)
     VALUES (NULL, 2, 1, 1, 1000.00, 1000.00, 0.00, TRUE, FALSE, NOW(), 1, 'Install new hardwood floors in living room'),
(NULL, 2, 1, 2, 1500.00, 1500.00, 0.00, TRUE, FALSE, NOW(), 1, 'Install new carpet in bedrooms'),
(NULL, 2, 2, 4, 750.00, 750.00, 0.00, TRUE, FALSE, NOW(), 2, 'Quote for kitchen renovation'),
(NULL, 2, 3, 6, 1250.00, 1250.00, 0.00, TRUE, FALSE, NOW(), 2, 'Paint interior walls'),
(NULL, 2, 2, 3, 2000.00, 2000.00, 0.00, FALSE, FALSE, NOW(), 3, 'Quote for bathroom remodel'),
(NULL, 2, 3, 5, 3500.00, 3500.00, 0.00, TRUE, FALSE, NOW(), 3, 'Install new light fixtures throughout house');

-- Sample data for customer_quotes table
INSERT INTO customer_quotes(account_id, customer_id, customer_job_id, amount_quoted, is_quote_active, created_by_user_id, notes)
     VALUES (1, 1, 1, 500.00, TRUE, 1, 'This quote is valid for 30 days'),
(1, 2, 3, 750.00, TRUE, 2, 'Discounted rate for repeat customer'),
(1, 3, NULL, 1000.00, TRUE, 3, 'Custom project with multiple phases');

-- Sample data for customer_invoices table
INSERT INTO customer_invoices(parent_invoice_id, account_id, customer_id, customer_info_id, invoice_number, invoice_date, due_date, beginning_balance, total_payments, total_charges, total_write_offs, total_retainers, total_amount_due, remaining_balance_on_invoice, is_invoice_paid_in_full, fully_paid_date, created_by_user_id, start_date, end_date, invoice_file_location, notes)
     VALUES (NULL, 2, 1, 1, 'INV-2023-00001', '2023-01-01', '2023-02-01', 0.00, 0.00, 500.00, 0.00, 0.00, 500.00, 500, FALSE, NULL, 1, '2023-01-01', '2023-01-01', 'First invoice for completed work'),
(NULL, 2, 2, 2, 'INV-2023-00002', '2023-01-01', '2023-02-01', 0.00, 0.00, 750.00, 0.00, 0.00, 750.00, 750, FALSE, NULL, 2, '2023-01-01', '2023-01-01', 'Invoice for discounted rate'),
(NULL, 2, 3, 3, 'INV-2023-00003', '2023-01-01', '2023-02-01', 0.00, 0.00, 1000.00, 0.00, 0.00, 1000.00, 1000, FALSE, NULL, 3, '2023-01-01', '2023-01-01', 'Invoice for custom project'),
(NULL, 2, 1, 1, 'INV-2023-00004', '2023-01-01', '2023-02-01', 0.00, 0.00, 700.00, 0.00, 0.00, 700.00, 700, FALSE, NULL, 1, '2023-01-01', '2023-01-01', 'Second invoice for additional work');

-- Sample data for customer_general_work_descriptions table
INSERT INTO customer_general_work_descriptions(account_id, general_work_description, estimated_time, is_general_work_description_active, created_by_user_id, created_at)
     VALUES (1, 'admin', 60, TRUE, 1, '2023-08-01 08:00:00'),
(2, 'lunch', 30, TRUE, 1, '2023-08-02 09:00:00'),
(3, 'processing application', 120, TRUE, 1, '2023-08-03 10:00:00'),
(1, 'admin', 60, FALSE, 2, '2023-08-04 11:00:00'),
(2, 'processing application', 120, TRUE, 2, '2023-08-05 12:00:00'),
(4, 'admin', 60, TRUE, 2, '2023-08-06 13:00:00'),
(5, 'lunch', 30, FALSE, 3, '2023-08-07 14:00:00'),
(3, 'admin', 60, TRUE, 3, '2023-08-08 15:00:00'),
(4, 'processing application', 120, FALSE, 3, '2023-08-09 16:00:00'),
(5, 'admin', 60, TRUE, 4, '2023-08-10 17:00:00');

-- Sample data for customer_transactions table
INSERT INTO customer_transactions(account_id, customer_id, customer_job_id, retainer_id, customer_invoice_id, logged_for_user_id, general_work_description_id, detailed_work_description, transaction_date, transaction_type, quantity, unit_cost, total_transaction, is_transaction_billable, is_excess_to_subscription, created_by_user_id, note)
     VALUES (2, 1, 1, NULL, 1, 1, 1, 'Fixed a leak in the roof', '2023-01-10', 'Time', 1, 150.00, 150.00, TRUE, FALSE, 1, 'no note'),
(2, 1, 1, NULL, 1, 1, 2, 'Fixed a leak in the roof', '2023-01-10', 'Charge', 1, 5.00, 5.00, TRUE, FALSE, 1, 'no note'),
(2, 1, 2, NULL, 1, 2, 3, 'Invoice processing fee', '2023-01-10', 'Time', 1, 75.00, 75.00, TRUE, FALSE, 1, 'no note'),
(2, 1, 2, NULL, 1, 2, 4, 'Invoice processing fee', '2023-01-10', 'Time', 1, 100.00, 100.00, TRUE, FALSE, 1, 'no note'),
(2, 2, 3, NULL, NULL, 1, 5, 'Replaced a light fixture', '2023-01-10', 'Charge', 1, 75.00, 75.00, TRUE, FALSE, 1, 'no note'),
(2, 2, 3, NULL, NULL, 1, 6, 'Replaced a light fixture', '2023-01-10', 'Time', 1, 150.00, 150.00, TRUE, FALSE, 1, 'no note'),
(2, 3, 6, NULL, NULL, 1, 7, 'Cleaned gutters', '2023-01-10', 'Charge', 1, 5.00, 5.00, TRUE, FALSE, 1, 'no note'),
(2, 3, 5, NULL, NULL, 1, 8, 'Cleaned gutters other job', '2023-01-10', 'Charge', 1, 75.00, 75.00, TRUE, FALSE, 1, 'no note'),
(2, 2, 3, NULL, NULL, 2, 9, 'test', '2023-01-10', 'Charge', 1, 100.00, 100.00, TRUE, FALSE, 1, 'no note'),
(2, 2, 3, NULL, NULL, 2, 10, 'test', '2023-01-10', 'Charge', 1, 75.00, 75.00, TRUE, FALSE, 1, 'no note');

-- Sample data for customer_payments table
INSERT INTO customer_payments(customer_id, account_id, customer_job_id, retainer_id, customer_invoice_id, payment_date, payment_amount, form_of_payment, payment_reference_number, is_transaction_billable, created_by_user_id, note)
     VALUES (1, 2, 1, 1, 1, '2023-01-15', -200.00, 'Credit Card', '123456789', TRUE, 1, 'Payment for Invoice #INV-0001'),
(1, 2, 1, 1, 1, '2023-01-15', -300.00, 'Cash', '987654321', TRUE, 2, 'Payment for Invoice #INV-0002'),
(2, 2, 1, 1, 2, '2023-01-15', -750.00, 'Credit Card', 'ABCD1234', TRUE, 1, 'Payment for Invoice #INV-0003'),
(2, 2, 1, 1, NULL, '2023-01-15', -100.00, 'Credit Card', '456789012', TRUE, 3, 'Payment for Invoice #INV-0004'),
(3, 2, 1, 1, 3, '2023-01-15', -300.00, 'Credit Card', 'XYZ9876', TRUE, 2, 'Advance payment for services'),
(3, 2, 1, 1, 3, '2023-01-15', -150.00, 'Cash', '789012345', TRUE, 1, 'Advance payment for services');

-- Sample data for customer writeOffs table
INSERT INTO customer_writeOffs(customer_id, account_id, customer_invoice_id, customer_job_id, writeoff_date, writeoff_amount, transaction_type, writeoff_reason, created_by_user_id, note)
     VALUES (1, 2, NULL, NULL, '2023-04-01', -10.00, 'Write Off', 'Non-Payment', 1, 'Note 1'),
(2, 2, NULL, NULL, '2023-04-02', -20.00, 'Write Off', 'Non-Payment', 2, 'Note 2'),
(1, 2, NULL, NULL, '2023-04-03', -25.00, 'Write Off', 'Non-Payment', 2, 'Note 3');

-- Sample data for customer_retainers_and_prepayments table
INSERT INTO customer_retainers_and_prepayments(parent_retainer_id, customer_id, account_id, display_name, type_of_hold, starting_amount, current_amount, form_of_payment, payment_reference_number, is_retainer_active, created_at, created_by_user_id, note)
     VALUES (NULL, 1, 2, 'Retainer', -1000.00, -750.00, 'test name 1', 'Card', 'xd1234', TRUE, '2023-04-03', 1, 'Retainer for legal services'),
(NULL, 1, 2, 'test name 2', 'Prepayment', -500.00, -0.00, 'Card', 'xd1234', FALSE, '2023-04-03', 2, 'Prepayment for future legal services'),
(NULL, 2, 2, 'test name 3', 'Retainer', -2000.00, -2000.00, 'Card', 'xd1234', TRUE, '2023-04-03', 1, 'Retainer for accounting services'),
(NULL, 3, 2, 'test name 4', 'Prepayment', -1000.00, -500.00, 'Card', 'xd1234', TRUE, '2023-04-03', 3, 'Prepayment for marketing services'),
(NULL, 4, 2, 'test name 5', 'Retainer', -1500.00, -500.00, 'Card', 'xd1234', TRUE, '2023-04-03', 2, 'Retainer for consulting services'),
(NULL, 1, 2, 'test name 6', 'Retainer', -100.00, -100.00, 'Card', 'xd1234', TRUE, '2023-04-03', 1, 'Retainer for legal services'),
(NULL, 1, 2, 'test name 7', 'Prepayment', -100.00, -100.00, 'Card', 'xd1234', TRUE, '2023-04-03', 2, 'Prepayment for future legal services'),
(NULL, 2, 2, 'test name 8', 'Retainer', -100.00, -100.00, 'Card', 'xd1234', TRUE, '2023-04-03', 1, 'Retainer for accounting services'),
(NULL, 3, 2, 'test name 9', 'Prepayment', -100.00, -100.00, 'Card', 'xd1234', TRUE, '2023-04-03', 3, 'Prepayment for marketing services'),
(NULL, 4, 2, 'test name 10', 'Retainer', -100.00, -100.00, 'Card', 'xd1234', TRUE, '2023-04-03', 2, 'Retainer for consulting services');

-- Sample data for customer_notes table
INSERT INTO customer_notes(customer_id, account_id, is_note_active, created_by_user_id, clearance_level, note_title, note)
     VALUES (1, 1, TRUE, 1, 'Admin', 'First Note', 'This is the first note for customer 1 by user 1'),
(1, 1, TRUE, 2, 'Admin', 'Second Note', 'This is the second note for customer 1 by user 2'),
(2, 2, TRUE, 3, 'Manager', 'First Note', 'This is the first note for customer 2 by user 3'),
(2, 2, FALSE, 4, 'User', 'Second Note', 'This is the second note for customer 2 by user 4, but it is not active');

