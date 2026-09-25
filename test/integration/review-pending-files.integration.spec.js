const { bootHttp, uniqueName, expectEnvelopeOk } = require('./_http');
const fixture = require('./_review-fixture');
const { pendingPaymentsService: svc, PAYMENTS_PENDING_PREFIX: PENDING, PAYMENTS_PROCESSED_PREFIX: PROCESSED } = require('../../src/endpoints/pendingPayments/pendingPayments-service');
const { putObject, getObject, deleteObject } = require('../../src/utils/s3');
const { S3Client } = require('@aws-sdk/client-s3');

describe('F16-F18 pending payment file integrity', function () {
   let h, f; const pendingIds = [], keys = [];
   before(async function () { h = await bootHttp.call(this); f = fixture(h); });
   after(async () => {
      if (!h) return;
      await h.db('customer_payments_processed').where({ account_id: 9001 }).whereIn('payment_id', pendingIds).del();
      for (const key of keys) await deleteObject(key);
      await f.cleanup(); await h.close();
   });
   const pending = async (c, source, fields = {}) => {
      const row = await f.insert('customer_payments_processed', { customer_id: c.customer_id, customer_name: c.display_name, payment_amount: 100, payment_date: '2026-09-01', source_file: source, form_of_payment: 'Check', ...fields });
      pendingIds.push(row.payment_id); return row;
   };
   const approve = (c, p) => h.as('admin').post('/pending-payments/approve/9001/90013').send({ pendingPaymentId: p.payment_id, payment: { customerID: c.customer_id, unitCost: 100, transactionDate: '2026-09-01', formOfPayment: 'Check', holdAsPrepayment: true } });
   it('F16 refuses stale soft-delete after approval commits and preserves visible posted evidence', async () => {
      const c = await f.customer(); const p = await pending(c, `${uniqueName('F16')}.pdf`);
      const read = svc.getSinglePendingPayment;
      let res;
      try {
         svc.getSinglePendingPayment = async (...args) => {
            const stale = await read(...args);
            expectEnvelopeOk(await approve(c, p));
            return stale;
         };
         res = await h.as('admin').put(`/pending-payments/soft-delete/${p.payment_id}/9001/90013`).send({});
      } finally { svc.getSinglePendingPayment = read; }
      expect(res.status).to.equal(409);
      const stored = await read(h.db, p.payment_id, 9001);
      expect(stored).to.include({ is_payment_processed: true, deleted: false });
      expect(await h.db('customer_retainers_and_prepayments').where({ account_id: 9001, customer_id: c.customer_id })).to.have.lengthOf(1);
   });
   it('F17 removes pending and archived copies and denies later preview', async () => {
      const c = await f.customer(); const name = `${uniqueName('F17')}.pdf`; const p = await pending(c, name);
      const archive = `${PROCESSED}/2026_September/${name}`; const source = `${PENDING}/${name}`;
      for (const key of [archive, source]) { keys.push(key); await putObject(key, Buffer.from('%PDF-1.4 fixture'), 'application/pdf'); }
      expect((await h.as('admin').get('/pending-payments/file-preview/9001/90013').query({ fileName: name })).status).to.equal(200);
      expectEnvelopeOk(await h.as('admin').delete('/pending-payments/file/9001/90013').send({ fileName: name }));
      for (const key of [archive, source]) {
         let missing = false; try { await getObject(key); } catch (e) { missing = e.name === 'NoSuchKey'; }
         expect(missing, key).to.equal(true);
      }
      expect((await svc.getSinglePendingPayment(h.db, p.payment_id, 9001)).deleted).to.equal(true);
      expect((await h.as('admin').get('/pending-payments/file-preview/9001/90013').query({ fileName: name })).status).to.equal(404);
   });
   it('F17 reports archive deletion failure and keeps queue rows retryable', async () => {
      const c = await f.customer(); const name = `${uniqueName('F17-fail')}.pdf`; const p = await pending(c, name);
      const archive = `${PROCESSED}/2026_September/${name}`; keys.push(archive);
      await putObject(archive, Buffer.from('%PDF-1.4 fixture'), 'application/pdf');
      const send = S3Client.prototype.send; let res;
      try {
         S3Client.prototype.send = function (command, ...args) {
            if (command.constructor.name === 'DeleteObjectCommand' && command.input.Key === archive) throw new Error('F17 S3 unavailable');
            return send.call(this, command, ...args);
         };
         res = await h.as('admin').delete('/pending-payments/file/9001/90013').send({ fileName: name });
      } finally { S3Client.prototype.send = send; }
      expect(res.status).to.equal(500);
      expect((await svc.getSinglePendingPayment(h.db, p.payment_id, 9001)).deleted).to.equal(false);
      expectEnvelopeOk(await h.as('admin').delete('/pending-payments/file/9001/90013').send({ fileName: name }));
   });
   it('F17 rechecks processed siblings under the file lock after an approval wins', async () => {
      const c = await f.customer(); const name = `${uniqueName('F17-race')}.pdf`; const p = await pending(c, name);
      const owns = svc.accountOwnsSourceFile; let res;
      try {
         svc.accountOwnsSourceFile = async (...args) => { const result = await owns(...args); expectEnvelopeOk(await approve(c, p)); return result; };
         res = await h.as('admin').delete('/pending-payments/file/9001/90013').send({ fileName: name });
      } finally { svc.accountOwnsSourceFile = owns; }
      expect(res.status).to.equal(400);
      expect((await svc.getSinglePendingPayment(h.db, p.payment_id, 9001)).deleted).to.equal(false);
   });

   it('F18 groups duplicate receipt identities into one physical file and previews either name', async () => {
      const c = await f.customer(); const name = `${uniqueName('F18')}.pdf`;
      await pending(c, name); await pending(c, `${name}#dup2-ref102`);
      const archive = `${PROCESSED}/2026_September/${name}`; keys.push(archive);
      await putObject(archive, Buffer.from('%PDF-1.4 fixture'), 'application/pdf');
      const res = await h.as('admin').get('/pending-payments/files/9001/90013'); expectEnvelopeOk(res);
      const files = res.body.files.filter(row => row.source_file.startsWith(name));
      expect(files).to.have.lengthOf(1); expect(Number(files[0].payment_count)).to.equal(2);
      for (const fileName of [name, `${name}#dup2-ref102`]) expect((await h.as('admin').get('/pending-payments/file-preview/9001/90013').query({ fileName })).status).to.equal(200);
   });
   it('F18 refuses canonical file deletion when only a suffixed sibling was approved', async () => {
      const c = await f.customer(); const name = `${uniqueName('F18-approved')}.pdf`;
      const p = await pending(c, name); const sibling = await pending(c, `${name}#dup2-ref102`);
      expectEnvelopeOk(await approve(c, sibling));
      const res = await h.as('admin').delete('/pending-payments/file/9001/90013').send({ fileName: name });
      expect(res.status).to.equal(400);
      expect((await svc.getSinglePendingPayment(h.db, p.payment_id, 9001)).deleted).to.equal(false);
   });
   it('F18 deleting via a duplicate receipt identity dismisses all siblings', async () => {
      const c = await f.customer(); const name = `${uniqueName('F18-delete')}.pdf`;
      const p = await pending(c, name); const sibling = await pending(c, `${name}#dup2-ref102`);
      expectEnvelopeOk(await h.as('admin').delete('/pending-payments/file/9001/90013').send({ fileName: sibling.source_file }));
      for (const row of [p, sibling]) expect((await svc.getSinglePendingPayment(h.db, row.payment_id, 9001)).deleted).to.equal(true);
   });

});
