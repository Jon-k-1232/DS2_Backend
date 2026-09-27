# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: payment-imports-H8.spec.js >> payment imports all: errors are visible, reload recovers, and no money is written
- Location: tests/payment-imports-H8.spec.js:8:3

# Error details

```
TimeoutError: locator.click: Timeout 20000ms exceeded.
Call log:
  - waiting for getByRole('tab', { name: 'All payments', exact: true })

```

# Test source

```ts
  1  | const {test,expect}=require('../lib/fixtures');
  2  | const {rows}=require('../lib/db');
  3  | const audit=()=>rows('SELECT count(*)::int AS events,max(event_id)::text AS last FROM audit_events WHERE account_id=9001');
  4  | for(const [tab,status,message] of [
  5  |  ['New payments','new','No new payments to review. Use Upload to add a payment file.'],
  6  |  ['Processed','processed','No processed payments for this month. Choose another month to see earlier payments.'],
  7  |  ['All payments','all','No imported payments. Use Upload to add a payment file.']
  8  | ])test(`payment imports ${status}: errors are visible, reload recovers, and no money is written`,async({page})=>{
  9  |  const before=audit();let failed=true;
  10 |  await page.route('**/pending-payments/list/**',route=>{
  11 |   if(new URL(route.request().url()).searchParams.get('status')!==status)return route.continue();
  12 |   return failed?route.fulfill({status:503,json:{status:503,message:'Synthetic unavailable list'}}):route.fulfill({json:{status:200,payments:[],pagination:{totalItems:0}}});
  13 |  });
> 14 |  await page.goto('/payments/imports');if(status!=='new')await page.getByRole('tab',{name:tab,exact:true}).click();
     |                                                                                                           ^ TimeoutError: locator.click: Timeout 20000ms exceeded.
  15 |  await expect(page.getByRole('alert')).toContainText('Payments could not be loaded. Reload the list to try again.');
  16 |  await expect(page.getByRole('grid')).toHaveCount(0);await expect(page.getByText(message,{exact:true})).toHaveCount(0);
  17 |  expect(audit()).toEqual(before);failed=false;await page.getByRole('button',{name:'Reload payments',exact:true}).click();
  18 |  await expect(page.getByText(message,{exact:true})).toBeVisible();
  19 |  await expect(page.getByRole('columnheader',{name:'Name on payment',exact:true})).toBeVisible();
  20 |  await expect(page.getByRole('columnheader',{name:'Matched client',exact:true})).toBeVisible();
  21 |  await expect(page.getByRole('columnheader',{name:'OCR Name',exact:true})).toHaveCount(0);
  22 |  expect(audit()).toEqual(before);
  23 | });
  24 | 
```