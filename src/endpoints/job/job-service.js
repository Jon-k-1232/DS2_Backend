const jobService = {
   async getJobsPage(db, accountID, {limit=20,offset=0,searchTerm='',customerId,sort='customer_job_id',direction='desc',latest=false,jobTypeId,categoryId,currentCycle=false}={}) {
      const allowed={customer_job_id:'j.customer_job_id',customer_name:'c.display_name',job_description:'t.job_description',created_at:'j.created_at',current_job_total:'j.current_job_total',is_job_complete:'j.is_job_complete'};
      if(!Object.hasOwn(allowed,sort))throw require('../payments/ledger-helpers').ruleError('Invalid job sort column.',400);
      const scope=require('../../utils/auditContext').storage.getStore();
      const entityId=scope?.billingScope ? scope.billingEntityId : null;
      // Scope the source before selecting latest versions; never retrieve a
      // tenant's full history to pick a client's current job in JavaScript.
      // The jobs view admits every raw NULL (shared legacy job); for a non-NULL
      // row ds2_effective_entity returns that explicit entity unchanged. Apply
      // that equivalent predicate directly, avoiding repeated attribution lookups
      // for every historical version. Project effective attribution only for
      // the bounded result below, preserving the view's response semantics.
      let source=db('public.customer_jobs').where('account_id',Number(accountID));
      if(entityId)source.where(b=>b.whereNull('billing_entity_id').orWhere('billing_entity_id',Number(entityId)));
      if(customerId)source.where('customer_id',Number(customerId));
      if(latest && !currentCycle)source=source.select('*',db.raw('row_number() over(partition by coalesce(parent_job_id,customer_job_id) order by created_at desc,customer_job_id desc) as family_rank'));
      else source=source.select('*');
      const base=db.from(source.as('j'))
         .join('customer_job_types as t',function(){this.on('t.job_type_id','j.job_type_id').andOn('t.account_id','j.account_id');})
         .join('customer_job_categories as cat',function(){this.on('cat.customer_job_category_id','t.customer_job_category_id').andOn('cat.account_id','j.account_id');})
         .join('customers as c',function(){this.on('c.customer_id','j.customer_id').andOn('c.account_id','j.account_id');});
      if(latest && !currentCycle)base.where('j.family_rank',1);
      if(currentCycle){
         // The write-off picker has always grouped by the exact referenced job
         // version, not the family lifetime total. Keep that money definition,
         // including zero-valued historical groups, without sending the ledger.
         const amounts=db('public.customer_transactions as work').where({'work.account_id':Number(accountID),'work.customer_id':Number(customerId)})
            .select('work.customer_job_id').sum({total_transaction:db.raw('CASE WHEN work.is_transaction_billable AND work.retainer_id IS NULL AND work.customer_invoice_id IS NULL THEN work.total_transaction ELSE 0 END')})
            .groupBy('work.customer_job_id');
         if(entityId){
            // Same precedence as ds2_effective_entity (migration 037), expressed
            // as unique-key joins so attribution is resolved in one set instead
            // of three scalar lookups per historical transaction. Every join
            // includes the account; each evidence source has a unique row key.
            for(const [table,alias] of [['legacy_billing_scopes','bs'],['legacy_financial_entity_attributions','at'],['billing_entity_reviews','review']])
               amounts.leftJoin(`public.${table} as ${alias}`,function(){this.on(`${alias}.account_id`,'work.account_id').andOn(`${alias}.record_id`,'work.transaction_id').andOn(db.raw('?? = ?',[`${alias}.table_name`,'customer_transactions']));});
            amounts.leftJoin('public.billing_entity_resolutions as resolution',function(){this.on('resolution.account_id','review.account_id').andOn('resolution.review_id','review.review_id');})
               .whereRaw('COALESCE(work.billing_entity_id,bs.billing_entity_id,at.billing_entity_id,resolution.billing_entity_id) = ?',[Number(entityId)]);
         }
         base.join(amounts.as('cycle'),'cycle.customer_job_id','j.customer_job_id');
      }
      if(jobTypeId)base.where('j.job_type_id',jobTypeId);
      if(categoryId)base.where('t.customer_job_category_id',categoryId);
      if(searchTerm)base.where(b=>b.whereILike('t.job_description',`%${searchTerm}%`).orWhereILike('cat.customer_job_category',`%${searchTerm}%`).orWhereILike('c.display_name',`%${searchTerm}%`).orWhereILike('j.notes',`%${searchTerm}%`).orWhereRaw('j.customer_job_id::text = ?',[searchTerm]));
      const count=await base.clone().count('* as count').first();
      const page=base.select('j.*','t.job_description','t.book_rate','t.customer_job_category_id','cat.customer_job_category','c.display_name as customer_name')
         .orderBy(allowed[sort],direction).orderBy('j.customer_job_id',direction).limit(limit).offset(offset);
      if(currentCycle)page.select('cycle.total_transaction');
      if(scope?.billingScope)page.select(db.raw('public.ds2_effective_entity(j.account_id, ?, j.customer_job_id, j.billing_entity_id) AS effective_billing_entity_id',['customer_jobs']));
      const jobs=await page;
      return {jobs:jobs.map(({effective_billing_entity_id,...j})=>({...j,...(scope?.billingScope?{billing_entity_id:effective_billing_entity_id}:{}),display_name:`${j.job_description} - ${j.customer_job_category}`})),totalCount:Number(count.count)};
   },
   // Input is ordered in SQL by the job timestamp, then ID (including sub-ms precision).
   latestFamilyVersions(jobs) {
      const families = new Map();
      for (const job of jobs) families.set(job.parent_job_id || job.customer_job_id, job);
      return [...families.values()];
   },

   createJob(db, newJob) {
      return db
         .insert(newJob)
         .into('customer_jobs')
         .returning('*')
         .then(rows => rows[0]);
   },

   findDuplicateJob(db, jobTableFields) {
      return db.select().from('customer_jobs').where('job_type_id', jobTableFields.job_type_id).andWhere('customer_id', jobTableFields.customer_id).andWhere('account_id', jobTableFields.account_id);
   },

   getSingleJob(db, customerJobID, accountID) {
      return db.select().from('customer_jobs').where('customer_job_id', customerJobID).andWhere('account_id', accountID);
   },

   getSingleJobType(db, jobTypeID, accountID) {
      return db.select().from('customer_jobs').where('job_type_id', jobTypeID).andWhere('account_id', accountID);
   },

   getActiveJobs(db, accountID) {
      return db
         .select(
            'customer_jobs.*',
            'customer_job_types.job_description',
            'customer_job_types.customer_job_category_id',
            'customer_job_types.is_job_type_active',
            'customer_job_types.estimated_straight_time',
            'customer_job_types.book_rate',
            'customer_job_categories.customer_job_category',
            db.raw('customers.display_name as customer_name'),
            db.raw('users.display_name as created_by_user')
         )
         .from('customer_jobs')
         .join('customer_job_types', function () {
         this.on('customer_jobs.job_type_id', '=', 'customer_job_types.job_type_id')
            .andOn('customer_job_types.account_id', '=', 'customer_jobs.account_id');
      })
         .join('customer_job_categories', function () {
         this.on('customer_job_types.customer_job_category_id', '=', 'customer_job_categories.customer_job_category_id')
            .andOn('customer_job_categories.account_id', '=', 'customer_job_types.account_id');
      })
         .join('customers', function () {
         this.on('customer_jobs.customer_id', '=', 'customers.customer_id')
            .andOn('customers.account_id', '=', 'customer_jobs.account_id');
      })
         .join('users', function () {
         this.on('customer_jobs.created_by_user_id', '=', 'users.user_id')
            .andOn('users.account_id', '=', 'customer_jobs.account_id');
      })
         .where('customer_jobs.account_id', accountID)
         .orderBy('customer_jobs.created_at', 'asc')
         .orderBy('customer_jobs.customer_job_id', 'asc');
   },

   // !! Must be in asc order, oldest to newest.
   getActiveCustomerJobs(db, accountID, customerID) {
      return db
         .select('customer_jobs.*', 'customer_job_types.job_description', 'customer_job_types.book_rate', 'customer_job_types.customer_job_category_id', 'customer_job_categories.customer_job_category')
         .from('customer_jobs')
         .where('customer_jobs.account_id', accountID)
         .andWhere('customer_jobs.customer_id', customerID)
         .join('customer_job_types', function () {
         this.on('customer_jobs.job_type_id', '=', 'customer_job_types.job_type_id')
            .andOn('customer_job_types.account_id', '=', 'customer_jobs.account_id');
      })
         .join('customer_job_categories', function () {
         this.on('customer_job_types.customer_job_category_id', '=', 'customer_job_categories.customer_job_category_id')
            .andOn('customer_job_categories.account_id', '=', 'customer_job_types.account_id');
      })
         .orderBy('customer_jobs.created_at', 'asc')
         .orderBy('customer_jobs.customer_job_id', 'asc');
   },

   updateJob(db, updatedJob, accountId) {
      return db.update(updatedJob).into('customer_jobs').where('customer_job_id', '=', updatedJob.customer_job_id).andWhere('account_id', accountId);
   },

   // Toggle job family completion status
   toggleJobCompletion(db, jobTableFields, accountId) {
      const { is_job_complete, customer_job_id, parent_job_id } = jobTableFields;
      const familyId = parent_job_id || customer_job_id;
      return db('customer_jobs')
         .where('account_id', accountId)
         .andWhere(builder => builder.where('customer_job_id', familyId).orWhere('parent_job_id', familyId))
         .update({ is_job_complete });
   },

   /**
    * Resolves every customer_job_id in a job's version family: the root
    * (parent_job_id IS NULL) plus every version row updateRecentJobTotal
    * inserted on a total change (parent_job_id = root). Works whether jobID
    * passed in IS the root or a later version's id. Returns [] when jobID
    * isn't found for this account.
    * @param {*} db
    * @param {*} jobID
    * @param {*} accountID
    * @returns {Promise<number[]>}
    */
   async getJobFamilyIds(db, jobID, accountID) {
      const target = await db.select('customer_job_id', 'parent_job_id').from('customer_jobs').where('customer_job_id', jobID).andWhere('account_id', accountID).first();
      if (!target) return [];

      const rootId = target.parent_job_id || target.customer_job_id;
      const family = await db
         .select('customer_job_id')
         .from('customer_jobs')
         .where('account_id', accountID)
         .andWhere(builder => builder.where('customer_job_id', rootId).orWhere('parent_job_id', rootId));

      return family.map(row => row.customer_job_id);
   },

   // Deletes every row in a job's version family (root + prior versions).
   // Callers must confirm nothing references ANY row in the family first -
   // see getJobFamilyIds and the deleteJob route handler.
   deleteJobFamily(db, jobIDs, accountId) {
      if (!jobIDs || !jobIDs.length) return Promise.resolve(0);
      return db('customer_jobs').where('account_id', accountId).whereIn('customer_job_id', jobIDs).del();
   },

   /**
    * !! Must be in desc order, newest to oldest. to select most recent job.
    * Does not include the customer_job_id, and created_at fields, used for updating/creating a new job record.
    * @param {*} db
    * @param {*} jobId
    * @returns
    */
   async getRecentJob(db, jobId, accountID) {
      const familyIds = await jobService.getJobFamilyIds(db, jobId, accountID);
      const recent = await db
         .select(
            'customer_job_id',
            'parent_job_id',
            'account_id',
            'customer_id',
            'job_type_id',
            'job_quote_amount',
            'agreed_job_amount',
            'current_job_total',
            'job_status',
            'is_job_complete',
            'is_quote',
            'created_by_user_id',
            'notes'
         )
         .from('customer_jobs')
         .whereIn('customer_job_id', familyIds)
         .andWhere('account_id', accountID)
         .orderBy('created_at', 'desc')
         .orderBy('customer_job_id', 'desc')
         .limit(1)
         .first();
      if (!recent) return undefined;
      const { customer_job_id, ...metadata } = recent;
      return { ...metadata, parent_job_id: recent.parent_job_id || customer_job_id };
   }
};

module.exports = jobService;
