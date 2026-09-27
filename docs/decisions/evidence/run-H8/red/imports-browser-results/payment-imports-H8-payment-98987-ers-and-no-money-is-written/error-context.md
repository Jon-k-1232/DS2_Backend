# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: payment-imports-H8.spec.js >> payment imports processed: errors are visible, reload recovers, and no money is written
- Location: tests/payment-imports-H8.spec.js:8:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('alert')
Expected substring: "Payments could not be loaded. Reload the list to try again."
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" getByRole('alert') with timeout 15000ms
  - waiting for getByRole('alert')

```

```yaml
- link "Skip to content":
  - /url: "#main-content"
- banner:
  - button "Hide menu" [expanded]
  - text: Payment imports
  - button "Notifications": "0"
  - button "Account menu"
- region "scrollable content":
  - link "DS2 home":
    - /url: /clients
    - heading "DS | 2" [level=2]
  - navigation "Primary navigation":
    - list:
      - button "Clients"
      - button "Time & Work"
      - button "Billing"
      - button "Payments & Credits" [expanded]
      - link "Receive payment":
        - /url: /payments/receive
      - link "Payment receipts":
        - /url: /payments/receipts
      - link "Payment imports":
        - /url: /payments/imports
      - link "Client credits":
        - /url: /payments/credits
      - link "Retainers & deposits":
        - /url: /payments/retainers
      - link "Refund history":
        - /url: /payments/refunds
      - link "Credit transfers":
        - /url: /payments/transfers
      - button "Receivables"
      - button "Time Tracking"
      - button "Settings"
- main:
  - navigation "Breadcrumbs":
    - list:
      - listitem:
        - paragraph: Payments & Credits
      - listitem:
        - paragraph: Payment imports
  - button "About this page"
  - navigation "Quick actions":
    - link "Enter time":
      - /url: /work/entries?entry=time
    - link "Create invoices":
      - /url: /billing/create
    - link "Receive payment":
      - /url: /payments/receive
    - link "Recurring plans":
      - /url: /billing/recurring
  - tablist "Pending payments tabs":
    - tab "New Payments"
    - tab "Processed" [selected]
    - tab "All Payments"
    - tab "Upload"
  - tabpanel "Processed":
    - text: Month
    - combobox "Month": September 2026
    - button "Open"
    - grid:
      - rowgroup:
        - 'row "OCR Name Matched Customer Amount Date Type Ref # Processed"':
          - columnheader "OCR Name"
          - columnheader "Matched Customer"
          - columnheader "Amount"
          - columnheader "Date"
          - columnheader "Type"
          - 'columnheader "Ref #"'
          - columnheader "Processed"
          - columnheader
      - text: No rows
      - rowgroup
      - paragraph: "Rows per page:"
      - 'combobox "Rows per page: 20"': "20"
      - paragraph: 0–0 of 0
      - button "Go to previous page" [disabled]
      - button "Go to next page" [disabled]
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
  14 |  await page.goto('/payments/imports');if(status!=='new')await page.getByRole('tab',{name:tab,exact:true}).click();
> 15 |  await expect(page.getByRole('alert')).toContainText('Payments could not be loaded. Reload the list to try again.');
     |                                        ^ Error: expect(locator).toContainText(expected) failed
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