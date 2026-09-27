# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: user-mistakes-delete.spec.js >> retainer linked-payment lookup failure refuses deletion until a successful reload
- Location: tests/user-mistakes-delete.spec.js:38:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('alert')
Expected pattern: /linked payments|Network Error/i
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
  - text: Retainers & deposits
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
        - link "Retainers & deposits":
          - /url: /payments/retainers
      - listitem:
        - paragraph: Details
  - navigation "Quick actions":
    - link "Enter time":
      - /url: /work/entries?entry=time
    - link "Create invoices":
      - /url: /billing/create
    - link "Receive payment":
      - /url: /payments/receive
    - link "Recurring plans":
      - /url: /billing/recurring
  - tablist "Page sections":
    - tab "Delete Retainer" [selected]
  - table:
    - rowgroup:
      - 'row "Customer: E2E_1790479217019_3989c6 Mary Ann Van Buren"':
        - cell "Customer:"
        - cell "E2E_1790479217019_3989c6 Mary Ann Van Buren"
      - 'row "Type of Hold: Retainer"':
        - cell "Type of Hold:"
        - cell "Retainer"
      - 'row "Starting Amount: -25.00"':
        - cell "Starting Amount:"
        - cell "-25.00"
      - 'row "Current Amount: -25.00"':
        - cell "Current Amount:"
        - cell "-25.00"
      - 'row "Form of Payment: Check"':
        - cell "Form of Payment:"
        - cell "Check"
      - 'row "Payment Reference Number: E2E_1790479217019_3989c6"':
        - cell "Payment Reference Number:"
        - cell "E2E_1790479217019_3989c6"
      - 'row "Is Retainer Active: true"':
        - cell "Is Retainer Active:"
        - cell "true"
      - 'row "Created By User ID: 90013"':
        - cell "Created By User ID:"
        - cell "90013"
  - button "Delete Retainer"
```

# Test source

```ts
  1  | require('../lib/scenario-safety').assertLocalUI();
  2  | const {test,expect}=require('../lib/fixtures');
  3  | const {createCustomer,createJob,billedCustomer,finalize,submit,closeForm,fillQuickFilter,expectGridValue,routes}=require('../lib/ui');
  4  | const {types,prepare,saved,financial}=require('../lib/mistakes');
  5  | const {rows}=require('../lib/db');
  6  | const cases=[
  7  |  ['payment','payment_id','Delete Payment','Search payments','/payments/deletePayment/'],
  8  |  ['writeoff','writeoff_id','Delete Write-off','Search write-offs','/writeOffs/deleteWriteOffs/'],
  9  |  ['retainer','retainer_id','Delete Retainer',null,'/retainers/deleteRetainer/'],
  10 |  ['charge','transaction_id','Delete Transaction','Search transactions','/transactions/deleteTransaction/']
  11 | ];
  12 | async function setup(page,prefix,type){
  13 |  const c=['payment','writeoff'].includes(type)?await billedCustomer(page,prefix):await createCustomer(page,prefix);
  14 |  if(['payment','writeoff'].includes(type))await finalize(page,c);
  15 |  if(type==='charge')await createJob(page,c);
  16 |  const d=await prepare(page,c,type);await submit(page,d,types[type].endpoint);await closeForm(page);return c;
  17 | }
  18 | async function detail(page,c,type,id,search){
  19 |  const [row]=saved(type,c);await page.goto(types[type].route);
  20 |  if(search)await page.getByPlaceholder(search).fill(c.prefix);else await fillQuickFilter(page,c.prefix);
  21 |  await page.locator(`[role=row][data-id="${row[id]}"]`).click();
  22 | }
  23 | for(const [type,id,label,search,endpoint] of cases)test(`${type}: cancel and failed delete preserve money; explicit retry removes only the eligible entry`,async({page,prefix})=>{
  24 |  const c=await setup(page,prefix,type);await detail(page,c,type,id,search);
  25 |  const before=financial(c);const button=page.getByRole('button',{name:label,exact:true});
  26 |  await expect(button).toBeEnabled();await button.click();await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  27 |  expect(financial(c)).toEqual(before);
  28 |  const pattern=`**${endpoint}**`;await page.route(pattern,route=>route.abort('failed'));
  29 |  await button.click();await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
  30 |  await expect(page.getByRole('alert')).toContainText(/network|unable|failed|error/i);await expect(button).toBeEnabled();expect(financial(c)).toEqual(before);
  31 |  await page.unroute(pattern);await button.click();
  32 |  const response=page.waitForResponse(r=>r.request().method()==='DELETE' && r.url().includes(endpoint));
  33 |  await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
  34 |  const r=await response;expect(r.status()).toBe(200);expect((await r.json()).status).toBe(200);
  35 |  await expect(page).toHaveURL(types[type].route);expect(saved(type,c)).toHaveLength(0);
  36 |  if(['payment','writeoff'].includes(type))expect(rows(`SELECT remaining_balance_on_invoice FROM customer_invoices WHERE account_id=9001 AND customer_id=${c.id}`).map(r=>Number(r.remaining_balance_on_invoice))).toEqual([22.5]);
  37 | });
  38 | test('retainer linked-payment lookup failure refuses deletion until a successful reload',async({page,prefix})=>{
  39 |  const c=await setup(page,prefix,'retainer');const before=financial(c);
  40 |  const pattern=`**/customer/activeCustomers/customerByID/9001/90013/${c.id}`;
  41 |  await page.route(pattern,route=>route.abort('failed'));
  42 |  await detail(page,c,'retainer','retainer_id',null);
> 43 |  await expect(page.getByRole('alert')).toContainText(/linked payments|Network Error/i);
     |                                        ^ Error: expect(locator).toContainText(expected) failed
  44 |  await expect(page.getByRole('button',{name:'Delete Retainer',exact:true})).toBeDisabled();expect(financial(c)).toEqual(before);
  45 |  await page.unroute(pattern);await page.reload();
  46 |  await expect(page.getByRole('button',{name:'Delete Retainer',exact:true})).toBeEnabled();expect(financial(c)).toEqual(before);
  47 | });
  48 | 
  49 | test('used retainer cannot be deleted: root dependency guidance and draw refusal preserve $5 credit',async({page,prefix})=>{
  50 |  const c=await setup(page,prefix,'retainer');const [root]=saved('retainer',c);
  51 |  await createJob(page,c);const d=await prepare(page,c,'charge');
  52 |  await d.getByRole('combobox',{name:'Apply Retainer or Pre-Payment',exact:true}).fill(prefix);
  53 |  await page.getByRole('option').filter({hasText:prefix}).click();
  54 |  await submit(page,d,types.charge.endpoint);await closeForm(page);
  55 |  const [work]=saved('charge',c),[payment]=saved('payment',c);const retainers=saved('retainer',c);
  56 |  const draw=retainers.find(r=>r.parent_retainer_id===root.retainer_id);
  57 |  expect(Number(work.total_transaction)).toBe(20);expect(Number(payment.payment_amount)).toBe(-20);
  58 |  expect(Number(work.total_transaction)+Number(payment.payment_amount)).toBe(0);
  59 |  expect(retainers.map(r=>Number(r.current_amount))).toEqual([-25,-5]);
  60 |  expect(work.retainer_id).toBe(draw.retainer_id);expect(payment.retainer_id).toBe(root.retainer_id);
  61 |  expect(payment.note).toBe(`[retainer_draw:${draw.retainer_id}]`);expect(saved('payment',c)).toHaveLength(1);
  62 |  const before=financial(c);
  63 |  await detail(page,c,'retainer','retainer_id',null);
  64 |  await expect(page.getByText('Before deletion, please remove the following items:',{exact:true})).toBeVisible();
  65 |  await expect(page.getByRole('button',{name:'Delete Retainer',exact:true})).toBeDisabled();
  66 |  await expect(page.getByRole('grid')).toBeVisible();expect(financial(c)).toEqual(before);
  67 |  await page.goto(routes.retainers);await fillQuickFilter(page,prefix);
  68 |  // The paged register exposes root and draw history as individual rows.
  69 |  // Assert both balances before checking the same two deletion safeguards.
  70 |  await expectGridValue(page,page.locator(`[role=row][data-id="${root.retainer_id}"]`),'current_amount','-25.00');
  71 |  await expectGridValue(page,page.locator(`[role=row][data-id="${draw.retainer_id}"]`),'current_amount','-5.00');
  72 |  await page.locator(`[role=row][data-id="${draw.retainer_id}"]`).click();
  73 |  await page.getByRole('button',{name:'Delete Retainer',exact:true}).click();
  74 |  const response=page.waitForResponse(r=>r.request().method()==='DELETE' && r.url().includes('/retainers/deleteRetainer/'));
  75 |  await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
  76 |  const refusal=await(await response).json();expect(refusal.status).toBe(500);expect(refusal.message).toMatch(/draw-down entry.*Delete the payment or time\/charge entry/);
  77 |  await expect(page.getByRole('alert')).toContainText(refusal.message);expect(financial(c)).toEqual(before);
  78 | });
  79 | 
```