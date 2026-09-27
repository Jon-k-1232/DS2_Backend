'use strict';
const c=require('../../../src/endpoints/recurringCustomer/recurring-calendar');
describe('Recurring calendar boundaries',()=>{
 const plan={subscription_frequency:'monthly',bill_on_date:31,start_date:'2024-01-01',first_automated_period:'2024-01-01',recurring_bill_amount:125,is_recurring_customer_active:true};
 it('uses leap-day February and a30-day April',()=>expect(c.periods(plan,'2024-04-30').map(p=>p.dueDate)).to.deep.equal(['2024-01-31','2024-02-29','2024-03-31','2024-04-30']));
 it('does not shift the quarterly cadence when the first month has already passed',()=>expect(c.periods({...plan,subscription_frequency:'quarterly',start_date:'2025-11-01',first_automated_period:'2026-01-01'},'2026-05-31').map(p=>p.periodStart)).to.deep.equal(['2026-02-01','2026-05-01']));
 it('chooses the first due date on or after cutover, including exact day match',()=>{expect(c.firstPeriod({...plan,bill_on_date:1},'2026-09-26')).to.equal('2026-10-01');expect(c.firstPeriod({...plan,bill_on_date:26},'2026-09-26')).to.equal('2026-09-01');});
 it('preserves full period end even when the plan ends midway through it',()=>expect(c.periods({...plan,bill_on_date:1,end_date:'2024-01-15'},'2024-02-01')).to.deep.equal([{periodStart:'2024-01-01',periodEnd:'2024-01-31',dueDate:'2024-01-01'}]));
 it('off scheduler never opens a database connection',async()=>{const {prepareRecurring}=require('../../../src/automations/automationScripts/recurringBilling');expect(await prepareRecurring(()=>{throw Error('must not query');})).to.deep.equal([]);});
});
