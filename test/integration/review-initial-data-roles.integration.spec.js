const { bootHttp, uniqueName, expectEnvelopeOk } = require('./_http');
const paths = [
 ['customersList','activeCustomerData','activeCustomers'],
 ['recurringCustomersList','activeRecurringCustomersData','activeRecurringCustomers'],
 ['transactionsList','activeTransactionsData','activeTransactions'],
 ['invoicesList','activeInvoiceData','activeInvoices'],
 ['accountJobsList','activeJobData','activeJobs'],
 ['jobCategoriesList','activeJobCategoriesData','activeJobCategories'],
 ['jobTypesList','activeJobTypesData','jobTypesData'],
 ['writeOffsList','activeWriteOffsData','activeWriteOffs'],
 ['paymentsList','activePaymentsData','activePayments'],
 ['accountRetainersList','activeRetainerData','activeRetainers'],
 ['workDescriptionsList','activeWorkDescriptionsData','workDescriptions']
];
describe('F3 initial data role projection', function () {
 let h, blob;
 const users = [];
 before(async function () {
   h = await bootHttp.call(this);
   const res = await h.as('employee').get('/initialData/initialBlob/9001/90013');
   blob = expectEnvelopeOk(res);
 });
 after(async () => {
   if (!h) return;
   if (users.length) await h.db('users').where({account_id:9001}).whereIn('user_id',users).del();
   await h.close();
 });
 for (const [list, section, rows] of paths) it(`returns an empty ${list} including grids and counts to ordinary staff`, () => {
   const data = blob[list][section];
   expect(data[rows]).to.deep.equal([]);
   expect(data.grid).to.deep.equal({columns:[],rows:[]});
   if (data.treeGrid) expect(data.treeGrid.rows).to.deep.equal([]);
   if (data.pagination) {
     expect(data.pagination.totalItems).to.equal(0);
     expect(data.pagination.totalPages).to.equal(0);
   }
 });
 it('returns only the session user ID and display name even with a different URL user ID', () => {
   const users = blob.teamMembersList.activeUserData.activeUsers;
   expect(users).to.have.lengthOf(1);
   expect(users[0]).to.have.all.keys('user_id','display_name');
   expect(Number(users[0].user_id)).to.equal(90011);
   expect(blob.teamMembersList.activeUserData.grid.rows[0]).to.have.all.keys('id','user_id','display_name');
 });
 it('denies the dedicated ledger route and never queries financial/contact tables for the staff blob', async () => {
   expect((await h.as('employee').get('/transactions/getTransactions/9001/90011')).status).to.equal(403);
   const sql=[]; const listener = q => sql.push(q.sql);
   h.db.on('query',listener);
   try { expectEnvelopeOk(await h.as('employee').get('/initialData/initialBlob/9001/90011')); }
   finally { h.db.removeListener('query',listener); }
   expect(sql.filter(s => /\b(customer_|customers|recurring_customers)/i.test(s))).to.deep.equal([]);
 });
 for (const role of ['User','Manager','Admin','Super Admin','owner']) it(`keeps the documented projection for ${role}`, async () => {
   const name=uniqueName('F3');
   const [user]=await h.db('users').insert({account_id:9001, email:`${name}@example.com`,display_name:name,
     cost_rate:1,billing_rate:2,job_title:'Fixture',access_level:role,is_user_active:true}).returning('*');
   users.push(user.user_id);
   const token=h.mint('admin',{user_id:user.user_id,email:user.email});
   const data=expectEnvelopeOk(await h.request.get('/initialData/initialBlob/9001/90013').set('Authorization',`Bearer ${token}`));
   if (role==='User') {
     expect(data.customersList.activeCustomerData.activeCustomers).to.deep.equal([]);
     expect(data.teamMembersList.activeUserData.activeUsers).to.deep.equal([{user_id:user.user_id,display_name:name}]);
   } else {
     expect(data.customersList.activeCustomerData.activeCustomers.length).to.be.greaterThan(0);
     const roster=data.teamMembersList.activeUserData.activeUsers;
     expect(roster.find(r => r.user_id===user.user_id)).to.include({email:user.email,billing_rate:'2.00'});
   }
 });
});
