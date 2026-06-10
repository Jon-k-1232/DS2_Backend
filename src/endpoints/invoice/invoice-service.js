const buildActiveInvoicesQuery = (db, accountID) =>
   db
      .select('customer_invoices.*', db.raw('customers.display_name as customer_name'), db.raw('users.display_name as created_by_user_name'))
      .from('customer_invoices')
      .join('customers', 'customer_invoices.customer_id', 'customers.customer_id')
      .join('users', 'customer_invoices.created_by_user_id', 'users.user_id')
      .where('customer_invoices.account_id', accountID);

const applyInvoicesSearchFilter = (query, searchTerm) => {
   if (!searchTerm) return;
   const normalized = String(searchTerm).trim().toLowerCase();
   if (!normalized.length) return;
   const likeTerm = `%${normalized}%`;
   query.andWhere(builder => {
      builder
         .whereRaw('LOWER(customers.display_name) LIKE ?', [likeTerm])
         .orWhereRaw('LOWER(customer_invoices.invoice_number::text) LIKE ?', [`%${normalized}%`])
         .orWhereRaw("TO_CHAR(customer_invoices.invoice_date, 'YYYY-MM-DD') LIKE ?", [`%${normalized}%`])
         .orWhereRaw("TO_CHAR(customer_invoices.due_date, 'YYYY-MM-DD') LIKE ?", [`%${normalized}%`]);
   });
};

const invoiceService = {
   // Must stay desc, used in finding if an invoice has to be created
   getInvoices(db, accountID) {
      return buildActiveInvoicesQuery(db, accountID).orderBy('customer_invoices.invoice_date', 'desc');
   },

   async getInvoicesPaginated(db, accountID, { limit, offset, searchTerm }) {
      const baseQuery = buildActiveInvoicesQuery(db, accountID);
      applyInvoicesSearchFilter(baseQuery, searchTerm);

      const sortedQuery = baseQuery.clone().orderBy('customer_invoices.invoice_date', 'desc');
      const dataQuery = sortedQuery.clone().limit(limit).offset(offset);

      const countResult = await baseQuery.clone().clearSelect().count({ count: '*' }).first();
      const invoices = await dataQuery;
      const totalCount = Number(countResult?.count || 0);

      return { invoices, totalCount };
   },

   deleteInvoice(db, customerInvoiceID, accountId) {
      return db('customer_invoices').where('customer_invoice_id', customerInvoiceID).andWhere('account_id', accountId).del();
   },

   // find most recent invoice and return the remaining balance
   // commented out 4/10/24 - fixing bug on invoice viewing, around invoice-router line 212
   // getRemainingInvoiceAmount(db, accountID, invoiceID) {
   //    return db.select('remaining_balance_on_invoice').from('customer_invoices').where('account_id', accountID).andWhere('parent_invoice_id', invoiceID).orderBy('created_at', 'desc').first();
   // },
   getRemainingInvoiceAmount(db, accountID, invoiceID) {
      return db
         .select('remaining_balance_on_invoice')
         .from('customer_invoices')
         .where('account_id', accountID)
         .andWhere(builder => {
            builder.where('parent_invoice_id', invoiceID).orWhere(qb => {
               qb.where('customer_invoice_id', invoiceID).andWhere('parent_invoice_id', null);
            });
         })
         .orderBy('created_at', 'desc')
         .first();
   },

   getOutstandingInvoicesBetweenDates(db, accountID, start_date, end_date) {
      return db
         .select('customer_invoices.*', db.raw('customers.display_name as customer_name'), db.raw('users.display_name as created_by_user_name'))
         .from('customer_invoices')
         .join('customers', 'customer_invoices.customer_id', 'customers.customer_id')
         .join('users', 'customer_invoices.created_by_user_id', 'users.user_id')
         .where('customer_invoices.account_id', accountID)
         .andWhere('customer_invoices.is_invoice_paid_in_full', false)
         .andWhere('customer_invoices.remaining_balance_on_invoice', '>', 0)
         .andWhere('customer_invoices.invoice_date', '>=', start_date)
         .andWhere('customer_invoices.invoice_date', '<', end_date)
         .orderBy('customer_invoices.invoice_date', 'desc');
   },

   getCustomerInvoiceByID(db, accountID, customerID) {
      return db.select('*').from('customer_invoices').where('account_id', accountID).andWhere('customer_id', customerID).orderBy('invoice_date', 'asc');
   },

   getInvoiceByInvoiceRowID(db, accountID, invoiceRowID) {
      return db
         .select(
            'customer_invoices.*',
            db.raw('customers.display_name as customer_name'),
            'customer_information.customer_street',
            'customer_information.customer_city',
            'customer_information.customer_state',
            'customer_information.customer_zip',
            'customer_information.customer_email',
            'customer_information.customer_phone'
         )
         .from('customer_invoices')
         .join('customers', 'customer_invoices.customer_id', 'customers.customer_id')
         .join('customer_information', 'customer_invoices.customer_info_id', 'customer_information.customer_info_id')
         .where('customer_invoices.account_id', accountID)
         .andWhere('customer_invoices.customer_invoice_id', invoiceRowID);
   },

   async getLastInvoiceNumber(db, accountID) {
      return db.select('invoice_number').from('customer_invoices').where('account_id', accountID).orderBy('invoice_number', 'desc').first();
   },

   createInvoice(db, invoice) {
      return db
         .insert(invoice)
         .into('customer_invoices')
         .returning('*')
         .then(rows => rows[0]);
   },

   // Returns an object vs array.
   getAccountPayToInfo(db, accountID) {
      return db
         .select(
            'accounts.*',
            'account_information.account_street',
            'account_information.account_city',
            'account_information.account_state',
            'account_information.account_zip',
            'account_information.account_email',
            'account_information.account_phone'
         )
         .from('accounts')
         .leftJoin('account_information', function () {
            this.on('accounts.account_id', '=', 'account_information.account_id')
               .andOn('account_information.is_account_mailing_address', db.raw('?', [true]))
               .andOn('account_information.is_this_address_active', db.raw('?', [true]));
         })
         .where('accounts.account_id', accountID)
         .then(rows => rows[0]);
   },

   async getLastInvoiceDatesByCustomerID(db, accountID, customerIDs) {
      const data = await db
         .select('customer_id')
         .max('invoice_date as last_invoice_date')
         .from('customer_invoices')
         .where('account_id', accountID)
         .whereIn('customer_id', customerIDs)
         .andWhere(function () {
            this.whereNull('parent_invoice_id').orWhereRaw('parent_invoice_id = customer_invoice_id');
         })
         .groupBy('customer_id')
         .orderBy('last_invoice_date', 'desc');

      return data.reduce((result, { customer_id, last_invoice_date }) => ({ ...result, [customer_id]: last_invoice_date }), {});
   },

   getCustomerInvoicesByCustomerID(db, customerID, accountID) {
      return db
         .select('*')
         .from('customer_invoices')
         .where('account_id', accountID)
         .where('customer_id', customerID)
         .andWhere('is_invoice_paid_in_full', false)
         .andWhere('remaining_balance_on_invoice', '>', 0)
         .orderBy('created_at', 'desc');
   },

   async getCustomerInformation(db, accountID, customerIDs) {
      const data = await db
         .from('customers')
         .join('customer_information', 'customers.customer_id', '=', 'customer_information.customer_id')
         .select('customers.*', 'customer_information.*')
         .whereIn('customers.customer_id', customerIDs)
         .where({
            'customers.account_id': accountID,
            'customer_information.is_customer_mailing_address': true,
            'customer_information.is_this_address_active': true,
            'customer_information.account_id': accountID
         });

      return data.reduce((result, { customer_id, ...info }) => ({ ...result, [customer_id]: info }), {});
   },

   // Fetch the unbilled transactions that should appear on the customer's next
   // invoice.  Previously this filtered to `created_at >= lastBillDate` for
   // customers with a prior invoice, which silently dropped stale missed
   // billings (e.g. Wild West Jeep Tours tx#24719 — a $320 tax notice from
   // 2025-12-04 that was never picked up by the 2026-04-07 invoice).
   //
   // New behavior: pull EVERY unbilled transaction for the customer, regardless
   // of date.  The date filter was acting as a stealth bug: if a transaction
   // got missed in one billing cycle, it would never bill at all because
   // every subsequent lastBillDate moved further ahead of its created_at.
   //
   // Non-billable transactions are still ignored downstream by
   // groupAndTotalTransactions (filters on is_transaction_billable), so this
   // change cannot cause non-billable work to start charging.
   async getTransactionsByCustomerID(db, accountID, customerIDs /* lastBillDateLookup unused */) {
      // IMPORTANT column ordering: customer_transactions.* must come LAST so
      // its customer_id wins the duplicate-column race against customer_jobs.*.
      // Without this, a transaction linked to a job that belongs to a DIFFERENT
      // customer (data-entry artifact — e.g. KFP transaction pointing at a
      // JFK&A job) gets bucketed under the JOB's customer_id and silently
      // drops out of the original customer's invoice.  Found while reconciling
      // Kimmel Financial Partners: 5 transactions totaling $179 of billable
      // work were vanishing because their jobs lived under JFK&A.
      const data = await db('customer_transactions')
         .join('customer_jobs', 'customer_jobs.customer_job_id', '=', 'customer_transactions.customer_job_id')
         .join('customer_job_types', 'customer_job_types.job_type_id', '=', 'customer_jobs.job_type_id')
         .select('customer_jobs.*', 'customer_job_types.*', 'customer_transactions.*')
         .where('customer_transactions.account_id', accountID)
         .whereIn('customer_transactions.customer_id', customerIDs)
         .whereNull('customer_transactions.customer_invoice_id');

      return data.reduce((result, transaction) => {
         const { customer_id } = transaction;
         if (!result[customer_id]) result[customer_id] = [];
         result[customer_id].push(transaction);
         return result;
      }, {});
   },

   async getPaymentsByCustomerID(db, accountID, customerIDs, lastBillDateLookup) {
      const data = await db('customer_payments')
         // switched to left join to include payments that are not attached to an invoice through a transaction. was just a 'join'.
         .leftJoin('customer_invoices', 'customer_invoices.customer_invoice_id', '=', 'customer_payments.customer_invoice_id')
         .select('customer_payments.*', db.raw('customer_invoices.invoice_number'))
         .where({
            'customer_payments.account_id': accountID
         })
         .andWhere(builder => {
            customerIDs.forEach(id => {
               // Handles query if there is an ID in the lastBillDateLookup
               if (lastBillDateLookup[id]) {
                  builder.orWhere(subQuery => {
                     // Changed payment date to created_at from payment date since created_at has the time stamp.
                     subQuery.where('customer_payments.customer_id', id).andWhere('customer_payments.created_at', '>=', lastBillDateLookup[id]);
                  });
                  // Handles query if there is no ID in the lastBillDateLookup
               } else {
                  builder.orWhere('customer_payments.customer_id', id);
               }
            });
         });

      return data.reduce((result, payment) => {
         const { customer_id } = payment;
         if (!result[customer_id]) result[customer_id] = [];
         result[customer_id].push(payment);
         return result;
      }, {});
   },

   async getWriteOffsByCustomerID(db, accountID, customerIDs, lastBillDateLookup) {
      const data = await db('customer_writeoffs')
         .leftJoin('customer_invoices as linked_invoice', 'linked_invoice.customer_invoice_id', '=', 'customer_writeoffs.customer_invoice_id')
         // The chain root of the linked row — its invoice_date tells the engine
         // whether this write-off touches the CURRENT chain (already reflected in
         // the outstanding remaining via its snapshot) or an absorbed one (acts
         // as a credit on the next bill).
         .joinRaw(
            'LEFT JOIN customer_invoices AS linked_chain_root ON linked_chain_root.customer_invoice_id = COALESCE(linked_invoice.parent_invoice_id, linked_invoice.customer_invoice_id)'
         )
         .leftJoin('customer_jobs', 'customer_jobs.customer_job_id', '=', 'customer_writeoffs.customer_job_id')
         .leftJoin('customer_job_types', 'customer_job_types.job_type_id', '=', 'customer_jobs.job_type_id')
         .select('customer_writeoffs.*', 'customer_jobs.job_type_id', 'customer_job_types.job_description', db.raw('linked_chain_root.invoice_date as linked_chain_invoice_date'))
         .where({
            'customer_writeoffs.account_id': accountID
         })
         .andWhere(builder => {
            customerIDs.forEach(id => {
               // Handles query if there is a id in the lastBillDateLookup
               if (lastBillDateLookup[id]) {
                  builder.orWhere(subQuery => {
                     subQuery.where('customer_writeoffs.customer_id', id).andWhere('customer_writeoffs.created_at', '>=', lastBillDateLookup[id]);
                  });
                  // Handles query if there is no id in the lastBillDateLookup
               } else {
                  builder.orWhere('customer_writeoffs.customer_id', id);
               }
            });
         });

      return data.reduce((result, writeoff) => {
         const { customer_id } = writeoff;
         if (!result[customer_id]) result[customer_id] = [];
         result[customer_id].push(writeoff);
         return result;
      }, {});
   },

   async getRetainersByCustomerID(db, accountID, customerIDs, lastBillDateLookup) {
      const data = await db('customer_retainers_and_prepayments')
         .select('customer_retainers_and_prepayments.*')
         .where('customer_retainers_and_prepayments.account_id', accountID)
         .andWhere(builder => {
            customerIDs.forEach(id => {
               builder.orWhere('customer_retainers_and_prepayments.customer_id', id);
            });
         });

      return data.reduce((result, retainer) => {
         const { customer_id } = retainer;
         if (!result[customer_id]) result[customer_id] = [];
         result[customer_id].push(retainer);
         return result;
      }, {});
   },

   /**
    * Requirements-
    * Include parent invoices that do not have children and have a remaining balance.
    * Include parent invoices along with all their children where at least one of the children still has a remaining balance.
    * Include parent invoices along with all their children where a payment has been made after the last invoice date, regardless of the remaining balance.
    */
   async getOutstandingInvoices(db, accountID, customerIDs, lastBillDateLookup) {
      const outstandingInvoices = {};

      // Fetch all parent invoices
      const parentInvoices = await db
         .select('*')
         .from('customer_invoices')
         .where('account_id', accountID)
         .whereIn('customer_id', customerIDs)
         .andWhere('parent_invoice_id', null)
         .orderBy('created_at', 'desc');

      // One query for every child snapshot, grouped in memory. This used to be
      // one query per parent — N+1 across each billed customer's full history
      // on every Create Invoice run.
      const parentIDs = parentInvoices.map(parent => parent.customer_invoice_id);
      const allChildren = parentIDs.length
         ? await db.select('*').from('customer_invoices').whereIn('parent_invoice_id', parentIDs).orderBy('created_at', 'desc')
         : [];
      const childrenByParent = allChildren.reduce((acc, child) => {
         (acc[child.parent_invoice_id] = acc[child.parent_invoice_id] || []).push(child);
         return acc;
      }, {});

      // Function to handle the children of each parent
      const handleChildren = parentInvoice => {
         const children = childrenByParent[parentInvoice.customer_invoice_id] || [];
         const lastBillDate = lastBillDateLookup[parentInvoice.customer_id];

         if (!outstandingInvoices[parentInvoice.customer_id]) outstandingInvoices[parentInvoice.customer_id] = [];

         // ROLLING-BALANCE DATE GATE.  When a new monthly invoice is created its
         // beginning_balance absorbs the prior outstanding amount, but the older
         // parent's remaining_balance_on_invoice is never zeroed.  If we keep
         // counting that older parent (or its child snapshots) as outstanding we
         // double-count the same dollars.  lastBillDate is the date of the most
         // recent parent invoice for this customer — any parent older than that
         // has already been rolled forward and must be skipped here, regardless
         // of whether it has child snapshots from later partial-payment events.
         if (lastBillDate) {
            const billDate = new Date(lastBillDate);
            const invoiceDate = new Date(parentInvoice.invoice_date);
            if (invoiceDate < billDate) return;
         }

         // Include parent invoices that do not have children and have a remaining balance
         if (Number(parentInvoice.remaining_balance_on_invoice) > 0 && !children.length) {
            outstandingInvoices[parentInvoice.customer_id].push(parentInvoice);
            return;
         }

         // If the most recent child has already fully closed this chain (remaining=0, paid=true),
         // skip the whole group — older intermediate snapshots may still show remaining > 0
         // from partial payments, but the chain is done. Including them inflates the outstanding total.
         const mostRecentChild = children[0]; // sorted created_at DESC
         if (mostRecentChild && Number(mostRecentChild.remaining_balance_on_invoice) === 0 && mostRecentChild.is_invoice_paid_in_full) {
            return;
         }

         // Include parent invoices along with all their children where at least one of the children still has a remaining balance
         if (children.some(child => Number(child.remaining_balance_on_invoice) > 0)) {
            outstandingInvoices[parentInvoice.customer_id].push(...children, parentInvoice);
            return;
         }

         // Include parent invoices along with all their children where a payment has been made after the last invoice date, regardless of the remaining balance.
         // Also include when this parent IS the most recent invoice (created_at === T_last) with fully-paid children — handles the edge case where
         // a child invoice was created before the parent due to an inverted timestamp, causing paymentAfterLastBillDate to incorrectly be false.
         // filterInvoices will still safely exclude this group if no payment is in scope (via discardedGroups).
         const isCurrentInvoice = Boolean(lastBillDate) && new Date(parentInvoice.created_at) >= new Date(lastBillDate);
         const paymentAfterLastBillDate = isCurrentInvoice || children.some(child => Number(child.remaining_balance_on_invoice) === 0 && new Date(child.created_at) > new Date(lastBillDate));

         if (paymentAfterLastBillDate) {
            outstandingInvoices[parentInvoice.customer_id].push(...children, parentInvoice);
            return;
         }
      };

      parentInvoices.forEach(handleChildren);

      return outstandingInvoices;
   },

   // Update an existing invoice row. Strips joined/derived fields before writing.
   updateInvoice(db, invoice) {
      const {
         customer_invoice_id,
         customer_name,
         customer_street,
         customer_city,
         customer_state,
         customer_zip,
         customer_email,
         customer_phone,
         created_by_user_name,
         ...invoiceData
      } = invoice;
      return db('customer_invoices').where('customer_invoice_id', customer_invoice_id).andWhere('account_id', invoiceData.account_id).update(invoiceData);
   },

   // Most recent snapshot on a chain — the row carrying the authoritative
   // remaining balance after the latest payment/write-off event.
   getLatestChildInvoice(db, accountID, parentInvoiceID) {
      return db
         .select('*')
         .from('customer_invoices')
         .where('account_id', accountID)
         .andWhere('parent_invoice_id', parentInvoiceID)
         .orderBy('created_at', 'desc')
         .first();
   },

   /**
    * ROLLING-BALANCE ZERO-OUT. When a new parent invoice absorbs the prior
    * outstanding amount as its beginning_balance, the absorbed rows must stop
    * carrying a remaining balance — otherwise they keep appearing as payable
    * invoices in the payment pickers and payments get tagged to chains the
    * billing engine's date gate ignores (money paid but never reflected on a
    * bill). Zeroes every prior-dated row (parents AND their snapshots) that
    * still shows remaining > 0, and stamps notes with an `absorbed_by:` marker
    * so the audit engine can tell deliberate absorption from ledger drift.
    *
    * Strictly older dates only: same-day duplicate parents are summed by the
    * engine and must keep their remaining.
    * Negative remainders (credit memos) are left alone — they were never
    * absorbed into the new beginning_balance.
    */
   zeroOutAbsorbedInvoices(db, accountID, customerID, newInvoiceDate, newInvoiceNumber) {
      const marker = `[absorbed_by:${newInvoiceNumber}@${new Date(newInvoiceDate).toISOString().slice(0, 10)}]`;
      return db('customer_invoices')
         .where('account_id', accountID)
         .andWhere('customer_id', customerID)
         .andWhere('invoice_date', '<', newInvoiceDate)
         .andWhere('remaining_balance_on_invoice', '>', 0)
         .update({
            remaining_balance_on_invoice: 0,
            notes: db.raw(`CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || ' ' || ? END`, [marker, marker])
         });
   }
};

module.exports = invoiceService;
