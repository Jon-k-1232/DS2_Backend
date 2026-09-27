# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: receive-payment.spec.js >> a concurrent payment produces a stale warning, preserves the check and refreshes amounts
- Location: tests/receive-payment.spec.js:23:1

# Error details

```
Error: {"status":400,"message":"The date cannot be in the future."}

expect(received).toBeTruthy()

Received: false
```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - link "Skip to content" [ref=f1e4] [cursor=pointer]:
    - /url: "#main-content"
  - banner [ref=f1e5]:
    - generic [ref=f1e6]:
      - button "Hide menu" [expanded] [ref=f1e7] [cursor=pointer]
      - generic [ref=f1e16]: Receive payment
      - generic [ref=f1e17]:
        - button "Notifications" [ref=f1e18] [cursor=pointer]:
          - generic [ref=f1e19]: "0"
        - button "Account menu" [ref=f1e22] [cursor=pointer]
  - region "scrollable content" [ref=f1e33]:
    - generic [ref=f1e34]:
      - link "DS2 home" [ref=f1e36] [cursor=pointer]:
        - /url: /clients
        - heading "DS | 2" [level=2] [ref=f1e38]
      - navigation "Primary navigation" [ref=f1e39]:
        - list [ref=f1e40]:
          - button "Clients" [ref=f1e41] [cursor=pointer]
          - button "Time & Work" [ref=f1e53] [cursor=pointer]
          - button "Billing" [ref=f1e65] [cursor=pointer]
          - button "Payments & Credits" [expanded] [ref=f1e77] [cursor=pointer]
          - generic "Payments & Credits" [ref=f1e92]:
            - link "Receive payment" [ref=f1e93] [cursor=pointer]:
              - /url: /payments/receive
            - link "Payment receipts" [ref=f1e96] [cursor=pointer]:
              - /url: /payments/receipts
            - link "Payment imports" [ref=f1e99] [cursor=pointer]:
              - /url: /payments/imports
            - link "Client credits" [ref=f1e102] [cursor=pointer]:
              - /url: /payments/credits
            - link "Retainers & deposits" [ref=f1e105] [cursor=pointer]:
              - /url: /payments/retainers
            - link "Refund history" [ref=f1e108] [cursor=pointer]:
              - /url: /payments/refunds
            - link "Credit transfers" [ref=f1e111] [cursor=pointer]:
              - /url: /payments/transfers
          - button "Receivables" [ref=f1e114] [cursor=pointer]
          - button "Time Tracking" [ref=f1e128] [cursor=pointer]
          - button "Settings" [ref=f1e140] [cursor=pointer]
  - main [ref=f1e155]:
    - generic [ref=f1e156]:
      - navigation "Breadcrumbs" [ref=f1e157]:
        - list [ref=f1e158]:
          - listitem [ref=f1e159]:
            - paragraph [ref=f1e160]: Payments & Credits
          - listitem [aria-hidden] [ref=f1e161]: /
          - listitem [ref=f1e162]:
            - paragraph [ref=f1e163]: Receive payment
      - navigation "Quick actions" [ref=f1e164]:
        - generic [ref=f1e165]:
          - link "Enter time" [ref=f1e166] [cursor=pointer]:
            - /url: /work/entries?entry=time
          - link "Create invoices" [ref=f1e167] [cursor=pointer]:
            - /url: /billing/create
          - link "Receive payment" [ref=f1e168] [cursor=pointer]:
            - /url: /payments/receive
          - link "Recurring plans" [ref=f1e169] [cursor=pointer]:
            - /url: /billing/recurring
    - generic [ref=f1e170]:
      - generic [ref=f1e171]:
        - heading "Receive payment" [level=4] [ref=f1e172]
        - link "Receipt history" [ref=f1e173] [cursor=pointer]:
          - /url: /payments/receipts
      - paragraph [ref=f1e174]: Enter the check once. Apply it to open invoices, oldest first. Any remainder stays as credit for this business and is used at the next billing.
      - generic [ref=f1e175]:
        - generic [ref=f1e176]:
          - generic [ref=f1e177]: Client
          - generic [ref=f1e178]:
            - combobox "Client" [ref=f1e179] [cursor=pointer]:
              - option "Choose a client"
              - option "Acme Corp"
              - option "CovA-5243-mugmhvhv-2"
              - option "CovA-61166-muiccswb-2"
              - option "=CovB-5243-mugmhvi4-3"
              - option "=CovB-61166-muiccswo-3"
              - option "Coverage TT MUIPSGUGCYXK"
              - option "E2E_1790452831342_826f42 Mary Ann Van Buren"
              - option "E2E_1790467862030_615c0d Mary Ann Van Buren" [selected]
              - option "FinalizeEngine peer 1790320346622-5255-3y9j"
              - option "FinalizeEngine main 1790321252430-6619-bhzs"
              - option "FinalizeEngine peer 1790321252515-6619-75ud"
              - option "FinalizeEngine empty 1790321252569-6619-dksa"
              - option "FinalizeEngine rerun 1790321252621-6619-w6r3"
              - option "FinalizeEngine main 1790320346543-5255-qpjs"
              - option "FinalizeEngine empty 1790320346679-5255-xw7l"
              - option "FinalizeEngine rerun 1790320346729-5255-z10s"
              - option "FinalizeEngine main 1790424265548-61216-2sav"
              - option "FinalizeEngine peer 1790424265754-61216-kuxo"
              - option "FinalizeEngine empty 1790424265928-61216-gbvm"
              - option "FinalizeEngine rerun 1790424266096-61216-gppr"
              - option "F8-F22-5292-mugmiwh1-1"
              - option "F8-F22-5292-mugmiwhx-2"
              - option "F8-F22-5292-mugmiwkq-3"
              - option "F8-F22-5292-mugmiwm1-4"
              - option "F8-F22-62225-muicfilx-1"
              - option "F8-F22-62225-muicfims-2"
              - option "F8-F22-62225-muicfivl-3"
              - option "F8-F22-62225-muicfj1c-4"
              - option "Globex Industries"
              - option "MonthEnd Lifecycle main 1790320348788-5258-fydp"
              - option "MonthEnd Lifecycle rerun 1790320349271-5258-ni3u"
              - option "MonthEnd Lifecycle main 1790321253830-6620-7xoi"
              - option "MonthEnd Lifecycle rerun 1790424275908-61226-dn9q"
              - option "MonthEnd Lifecycle rerun 1790321254476-6620-ar24"
              - option "MonthEnd Lifecycle main 1790424272026-61226-vw2r"
              - option "Tracker E2E NonOwner MUGMKJVUJVSV"
            - group [aria-hidden]:
              - generic: Client
        - generic [ref=f1e181]:
          - generic [ref=f1e182]:
            - text: Billing business
            - generic [aria-hidden] [ref=f1e183]: "*"
          - generic [ref=f1e184]:
            - combobox "Billing business" [ref=f1e185] [cursor=pointer]:
              - option "Choose a business"
              - option "TEST FIXTURE ACCOUNT" [selected]
            - group [aria-hidden]:
              - generic: Billing business *
          - paragraph [ref=f1e186]: Choose the business receiving this work or payment.
      - generic [ref=f1e187]:
        - generic [ref=f1e188]:
          - generic [ref=f1e189]: Amount received
          - generic [ref=f1e190]:
            - textbox "Amount received" [ref=f1e191]: "1000"
            - group [aria-hidden]:
              - generic: Amount received
        - generic [ref=f1e192]:
          - generic [ref=f1e193]: Payment date
          - generic [ref=f1e194]:
            - textbox "Payment date" [ref=f1e195]: 2026-09-26
            - group [aria-hidden]:
              - generic: Payment date
        - generic [ref=f1e196]:
          - generic [ref=f1e197]: Method
          - generic [ref=f1e198]:
            - combobox "Method" [ref=f1e199] [cursor=pointer]:
              - option "Check" [selected]
              - option "Cash"
              - option "Other"
            - group [aria-hidden]:
              - generic: Method
        - generic [ref=f1e200]:
          - generic [ref=f1e201]: Check / payment reference
          - generic [ref=f1e202]:
            - textbox "Check / payment reference" [active] [ref=f1e203]: E2E_1790467862030_615c0d-CHECK
            - group [aria-hidden]:
              - generic: Check / payment reference
      - generic [ref=f1e204]:
        - generic [ref=f1e205]:
          - heading "Open invoices" [level=6] [ref=f1e206]
          - button "Apply oldest first" [ref=f1e207] [cursor=pointer]
        - paragraph [ref=f1e208]: An invoice keeps its original date when carried onto a newer statement.
        - table [ref=f1e209]:
          - rowgroup [ref=f1e210]:
            - row [ref=f1e211]:
              - columnheader "Invoice / original date" [ref=f1e212]
              - columnheader "Carried on" [ref=f1e213]
              - columnheader "Remaining" [ref=f1e214]
              - columnheader "Apply" [ref=f1e215]
          - rowgroup [ref=f1e216]:
            - row [ref=f1e217]:
              - cell "E2E_1790467862030_615c0d-INV1 2026-07-14" [ref=f1e218]:
                - text: E2E_1790467862030_615c0d-INV1
                - generic [ref=f1e219]: 2026-07-14
              - cell "Original statement" [ref=f1e220]
              - cell "$300.00" [ref=f1e221]
              - cell "Apply amount 300.00" [ref=f1e222]:
                - generic [ref=f1e223]:
                  - generic [ref=f1e224]: Apply amount
                  - generic [ref=f1e225]:
                    - textbox "Apply to E2E_1790467862030_615c0d-INV1" [ref=f1e226]: "300.00"
                    - group [aria-hidden]:
                      - generic: Apply amount
            - row [ref=f1e227]:
              - cell "E2E_1790467862030_615c0d-INV2 2026-08-13" [ref=f1e228]:
                - text: E2E_1790467862030_615c0d-INV2
                - generic [ref=f1e229]: 2026-08-13
              - cell "Original statement" [ref=f1e230]
              - cell "$450.00" [ref=f1e231]
              - cell "Apply amount 450.00" [ref=f1e232]:
                - generic [ref=f1e233]:
                  - generic [ref=f1e234]: Apply amount
                  - generic [ref=f1e235]:
                    - textbox "Apply to E2E_1790467862030_615c0d-INV2" [ref=f1e236]: "450.00"
                    - group [aria-hidden]:
                      - generic: Apply amount
            - row [ref=f1e237]:
              - cell "E2E_1790467862030_615c0d-INV3 2026-09-12" [ref=f1e238]:
                - text: E2E_1790467862030_615c0d-INV3
                - generic [ref=f1e239]: 2026-09-12
              - cell "Original statement" [ref=f1e240]
              - cell "$400.00" [ref=f1e241]
              - cell "Apply amount 250.00" [ref=f1e242]:
                - generic [ref=f1e243]:
                  - generic [ref=f1e244]: Apply amount
                  - generic [ref=f1e245]:
                    - textbox "Apply to E2E_1790467862030_615c0d-INV3" [ref=f1e246]: "250.00"
                    - group [aria-hidden]:
                      - generic: Apply amount
      - generic [ref=f1e247]:
        - paragraph [ref=f1e248]: "Received: $1000.00"
        - paragraph [ref=f1e249]: "Applied: $1000.00"
        - paragraph [ref=f1e250]: "Remaining credit: $0.00"
      - generic [ref=f1e251]:
        - generic: Allocation reason
        - generic [ref=f1e252]:
          - textbox "Allocation reason" [ref=f1e253]
          - group [aria-hidden]:
            - generic: Allocation reason
        - paragraph [ref=f1e254]: Required when changing the oldest-first suggestion.
      - button "Review payment" [ref=f1e255] [cursor=pointer]
```

# Test source

```ts
  1  | const {test,expect}=require('../lib/fixtures');
  2  | const {rows,literal,sql}=require('../lib/db');
  3  | const {createCustomer,createJob,openForm,choose,submit,closeForm,finalize,routes}=require('../lib/ui');
  4  | const {randomUUID}=require('crypto');
  5  | const entity=()=>rows('SELECT billing_entity_id FROM billing_entities WHERE account_id=9001 AND is_default')[0].billing_entity_id;
  6  | async function fixture(page,prefix){
  7  |  const c=await createCustomer(page,prefix),e=entity();
  8  |  for(const [i,charge,begin,age]of [[1,300,0,75],[2,450,300,45],[3,400,750,15]])sql(`INSERT INTO customer_invoices(account_id,customer_id,customer_info_id,billing_entity_id,invoice_number,invoice_date,due_date,beginning_balance,total_payments,total_charges,total_write_offs,total_retainers,total_amount_due,remaining_balance_on_invoice,is_invoice_paid_in_full,created_by_user_id,created_at) VALUES(9001,${c.id},(SELECT customer_info_id FROM customer_information WHERE account_id=9001 AND customer_id=${c.id} LIMIT 1),${e},${literal(prefix+'-INV'+i)},CURRENT_DATE-${age},CURRENT_DATE-${age}+15,${begin},0,${charge},0,0,${begin+charge},${begin+charge},false,90013,(clock_timestamp() AT TIME ZONE 'UTC')-interval '${age} days')`);
  9  |  return {...c,entityId:e};
  10 | }
  11 | async function start(page,c,amount='1000'){
  12 |  await page.goto('/payments/receive');await page.getByLabel('Client',{exact:true}).selectOption(String(c.id));await page.getByLabel(/Billing business/).selectOption(String(c.entityId));
  13 |  await expect(page.getByLabel('Apply to '+c.prefix+'-INV1')).toBeVisible();await page.getByLabel('Amount received',{exact:true}).fill(amount);await page.getByLabel('Check / payment reference').fill(c.prefix+'-CHECK');
  14 | }
  15 | async function save(page){await page.getByRole('button',{name:'Review payment',exact:true}).click();const res=page.waitForResponse(r=>r.url().endsWith('/payments/receipts') && r.request().method()==='POST');await page.getByRole('button',{name:'Record payment',exact:true}).dblclick();return res;}
  16 | const state=c=>rows(`SELECT 'receipt' AS kind,receipt_id::text AS id,row_to_json(r)::text AS data FROM payment_receipts r WHERE account_id=9001 AND customer_id=${c.id} UNION ALL SELECT 'application',application_id::text,row_to_json(a)::text FROM ar_applications a WHERE account_id=9001 AND customer_id=${c.id} UNION ALL SELECT 'invoice',customer_invoice_id::text,row_to_json(i)::text FROM customer_invoices i WHERE account_id=9001 AND customer_id=${c.id} UNION ALL SELECT 'audit',event_id::text,row_to_json(e)::text FROM audit_events e WHERE account_id=9001 AND customer_id=${c.id} ORDER BY kind,id`);
> 17 | async function api(page,path,body){if(!/^\/payments\/(receipts|open-obligations)/.test(path))throw Error('Unexpected receipt fixture API');const r=body===undefined?await page.request.get('http://localhost:8003'+path):await page.request.post('http://localhost:8003'+path,{data:body,headers:{'Idempotency-Key':randomUUID()}});expect(r.ok(),await r.text()).toBeTruthy();return r.json();}
     |                                                                                                                                                                                                                                                                                                                                                                   ^ Error: {"status":400,"message":"The date cannot be in the future."}
  18 | test('one $1000 check applies $300, $450 and $250; original aging and receipt history agree',async({page,prefix},info)=>{
  19 |  const c=await fixture(page,prefix);await start(page,c);await expect(page.getByRole('button',{name:'Review payment',exact:true})).toBeEnabled();await page.screenshot({path:info.outputPath('receive-payment.png'),fullPage:true,animations:'disabled'});for(const [i,amount]of [[1,'300.00'],[2,'450.00'],[3,'250.00']])await expect(page.getByLabel('Apply to '+prefix+'-INV'+i)).toHaveValue(amount);expect((await save(page)).status()).toBe(200);await expect(page.getByText(/saved. Applied \$1000.00/)).toBeVisible();const r=rows(`SELECT * FROM payment_receipts WHERE account_id=9001 AND customer_id=${c.id} AND source_kind='manual'`);expect(r).toHaveLength(1);expect(rows(`SELECT amount FROM ar_applications WHERE receipt_id=${r[0].receipt_id} ORDER BY application_id`).map(a=>Number(a.amount))).toEqual([300,450,250]);await page.getByRole('link',{name:'View receipt'}).click();await expect(page.getByRole('heading',{name:'Receipt #'+r[0].receipt_id,exact:true})).toBeVisible();
  20 |  await page.goto('/receivables/aging');await page.getByPlaceholder('Search by business name, customer name, display name, or ID').fill(prefix);await page.getByRole('button',{name:'Search',exact:true}).click();const row=page.getByRole('row').filter({hasText:c.name});await expect(row).toContainText('$150.00');await expect(row.locator('td').nth(4)).toContainText('$150.00');await expect(row.locator('td').nth(5)).not.toContainText('$150.00');await page.screenshot({path:info.outputPath('receive-aging.png'),fullPage:true});
  21 | });
  22 | for(const [value,pattern]of [['0',/Allocation lines must be positive/],['-1',/Allocation lines must be positive/],['300.001',/Allocation lines must be positive/],['1001',/Applied total exceeds/],['301',/allocation exceeds/]])test(`blocks mistaken application ${value} before posting`,async({page,prefix})=>{const c=await fixture(page,prefix);await start(page,c,value==='301'?'1500':'1000');const before=state(c);await page.getByLabel('Apply to '+prefix+'-INV1').fill(value);await expect(page.getByText(pattern)).toBeVisible();await expect(page.getByRole('button',{name:'Review payment',exact:true})).toBeDisabled();expect(state(c)).toEqual(before);});
  23 | test('a concurrent payment produces a stale warning, preserves the check and refreshes amounts',async({page,prefix})=>{
  24 |  const c=await fixture(page,prefix);await start(page,c);const open=await api(page,`/payments/open-obligations?customerId=${c.id}&entityId=${c.entityId}`);await api(page,'/payments/receipts',{customerId:c.id,entityId:c.entityId,amount:10,date:new Date().toISOString().slice(0,10),method:'cash',reference:'',allocations:[{obligationId:open.obligations[0].obligation_id,amount:10}],ledgerFingerprint:open.ledgerFingerprint});const before=state(c);expect((await save(page)).status()).toBe(409);await expect(page.getByText(/open invoices or credit changed/)).toBeVisible();expect(state(c)).toEqual(before);await expect(page.getByLabel('Amount received')).toHaveValue('1000');await page.getByRole('button',{name:'Refresh open invoices'}).click();await expect(page.getByLabel('Apply to '+prefix+'-INV1')).toHaveValue('290.00');expect((await save(page)).status()).toBe(200);
  25 | });
  26 | for(const field of ['customerId','entityId','obligationId'])test(`server rejects a tampered wrong ${field} and the screen preserves the receipt`,async({page,prefix})=>{
  27 |  const c=await fixture(page,prefix);await start(page,c);const before=state(c);await page.route('**/payments/receipts',async route=>{if(route.request().method()!=='POST')return route.continue();const body=route.request().postDataJSON();if(field==='obligationId'){body.allocations[0].obligationId=2147483646;body.reason='Client specified invoice';}else body[field]=2147483646;await route.continue({postData:JSON.stringify(body)});});expect((await save(page)).status()).toBe(404);await expect(page.getByRole('alert')).toBeVisible();expect(state(c)).toEqual(before);await expect(page.getByLabel('Check / payment reference')).toHaveValue(prefix+'-CHECK');
  28 | });
  29 | test('whole receipt bounce restores all three original debts; partial reversal is refused',async({page,prefix})=>{
  30 |  const c=await fixture(page,prefix);await start(page,c);expect((await save(page)).status()).toBe(200);await page.getByRole('link',{name:'View receipt'}).click();const rid=Number(page.url().split('/').pop());await page.getByLabel('Reason for correction').fill('Bank returned the complete check');await page.getByRole('button',{name:'Flag complete receipt as bounced'}).click();await expect(page.getByRole('button',{name:'Reverse complete receipt'})).toBeVisible();const before=state(c);await page.route(`**/payments/receipts/${rid}/reversals`,async route=>route.continue({postData:JSON.stringify({...route.request().postDataJSON(),amount:1})}));await page.getByRole('button',{name:'Reverse complete receipt'}).click();await expect(page.getByText(/partial reversal is not permitted/)).toBeVisible();expect(state(c)).toEqual(before);await page.unroute(`**/payments/receipts/${rid}/reversals`);await page.getByLabel('Reason for correction').fill('Return the whole receipt');await page.getByRole('button',{name:'Reverse complete receipt'}).click();await expect(page.getByText(/The whole receipt is reversed/)).toBeVisible();const open=await api(page,`/payments/open-obligations?customerId=${c.id}&entityId=${c.entityId}`);expect(open.obligations.map(o=>o.openCents)).toEqual([30000,45000,40000]);
  31 | });
  32 | test('$1500 leaves $350 held credit, next $500 bill uses it once, and finalized applications stay locked',async({page,prefix},info)=>{
  33 |  const c=await fixture(page,prefix);await start(page,c,'1500');await expect(page.getByText('Remaining credit: $350.00')).toBeVisible();expect((await save(page)).status()).toBe(200);const receipt=rows(`SELECT * FROM payment_receipts WHERE account_id=9001 AND customer_id=${c.id} AND source_kind='manual'`)[0];await createJob(page,c);const d=await openForm(page,routes.transactions,'New Charge');await choose(page,d,'Select Customer',c.name);await choose(page,d,'Select Job','1040 Individual Return');await choose(page,d,'Select Team Member','Eliza Smith');await choose(page,d,'General Work Description','Tax Return Preparation');await d.getByLabel('Work Completed On Job').fill(prefix+' next bill');await d.getByLabel('Quantity',{exact:true}).fill('1');await d.getByLabel('Unit Cost').fill('500');await submit(page,d,'/transactions/createTransaction/');await closeForm(page);await page.goto(`/clients/${c.id}/auditRecord`);await expect(page.getByText('Held receipt credit $350.00 · Proposed next statement after credit $150.00')).toBeVisible();await finalize(page,c,{entityId:c.entityId,expectedTotal:'150.00',testInfo:info});await page.goto('/payments/receipts/'+receipt.receipt_id);await expect(page.getByText(/Finalized applications are locked/)).toBeVisible();await expect(page.getByLabel('Application to correct').locator('option')).toHaveCount(1);await expect(page.getByRole('button',{name:'Correct application',exact:true})).toBeDisabled();await expect(page.getByText(/\$0.00 available/)).toBeVisible();
  34 | });
  35 | test('a similar check needs a reason; duplicate cash can be cancelled only as a complete unissued receipt',async({page,prefix})=>{
  36 |  const c=await fixture(page,prefix);await start(page,c,'100');expect((await save(page)).status()).toBe(200);await page.getByLabel('Amount received').fill('100');await page.getByLabel('Check / payment reference').fill(prefix+'-CHECK');const before=state(c);expect((await save(page)).status()).toBe(409);await expect(page.getByText(/Possible duplicate receipt/)).toBeVisible();expect(state(c)).toEqual(before);await page.getByLabel('Reason to record a similar receipt').fill('Separate checks legitimately share this reference');expect((await save(page)).status()).toBe(200);await page.getByRole('link',{name:'View receipt'}).click();const rid=Number(page.url().split('/').pop()),flag=rows(`SELECT duplicate_id FROM duplicate_flags WHERE account_id=9001 AND kind='payment_receipt' AND record_id=${rid}`)[0];expect(flag).toBeTruthy();await page.goto('/work/duplicates?duplicateId='+flag.duplicate_id);await page.getByLabel('Reason',{exact:false}).fill('Review the complete cash receipt');await expect(page.getByRole('button',{name:'Remove duplicate',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Open receipt',exact:true}).click();await page.getByLabel('Reason for correction').fill('Second receipt was entered in error');await page.getByRole('button',{name:'Cancel unissued receipt entered in error'}).click();await expect(page.getByText(/complete receipt was reversed/)).toBeVisible();expect(rows(`SELECT kind FROM receipt_events WHERE account_id=9001 AND customer_id=${c.id} AND kind='exception_flagged'`)).toHaveLength(0);
  37 | });
  38 | test('admin corrects a single unissued application with visible preserved history',async({page,prefix})=>{
  39 |  const c=await fixture(page,prefix);await start(page,c,'100');expect((await save(page)).status()).toBe(200);await page.getByRole('link',{name:'View receipt'}).click();await page.getByLabel('Reason for correction').fill('Client requested the advisory invoice allocation');await page.getByLabel('Application to correct').selectOption({index:1});await page.getByLabel('Correct open invoice').selectOption({label:prefix+'-INV2 · $450.00'});await page.getByRole('button',{name:'Correct application',exact:true}).click();await expect(page.getByText('Application corrected with preserved history.')).toBeVisible();const open=await api(page,`/payments/open-obligations?customerId=${c.id}&entityId=${c.entityId}`);expect(open.obligations.map(o=>o.openCents)).toEqual([30000,35000,40000]);await expect(page.getByText(/application corrected · Client requested/)).toBeVisible();
  40 | });
  41 | test('admin transfers held receipt credit with cap, reason and double-click protection',async({page,prefix})=>{
  42 |  const c=await fixture(page,prefix);await start(page,c,'1500');expect((await save(page)).status()).toBe(200);const b=JSON.parse(sql(`INSERT INTO billing_entities(account_id,name,legal_name,invoice_prefix,is_default,active) VALUES(9001,${literal(prefix+' Advisory')},${literal(prefix+' Advisory')},${literal('H'+require('crypto').randomBytes(5).toString('hex').replace(/[0-9]/g,'A').toUpperCase())},false,true) RETURNING row_to_json(billing_entities)`));
  43 |  await page.goto('/payments/transfers');await page.getByLabel('Receipt credit client').selectOption(String(c.id));await page.getByLabel('Receipt credit from business').selectOption(String(c.entityId));await page.getByLabel('Receipt credit to business').selectOption(String(b.billing_entity_id));await page.getByLabel('Unused receipt credit').selectOption({index:1});await page.getByLabel('Receipt credit transfer reason').fill('Funds for advisory services');await page.getByLabel('Receipt credit transfer amount').fill('351');await expect(page.getByRole('button',{name:'Transfer receipt credit',exact:true})).toBeDisabled();await expect(page.getByText('Amount exceeds available receipt credit.')).toBeVisible();await page.getByLabel('Receipt credit transfer amount').fill('100');const posted=page.waitForResponse(r=>r.url().endsWith('/credits/transfers') && r.request().method()==='POST');await page.getByRole('button',{name:'Transfer receipt credit',exact:true}).dblclick();expect((await posted).status()).toBe(200);await expect(page.getByText('Unused receipt credit transferred; no new cash recorded.')).toBeVisible();expect(rows(`SELECT * FROM client_credit_events WHERE account_id=9001 AND customer_id=${c.id} AND kind='transfer'`)).toHaveLength(1);expect(rows(`SELECT * FROM payment_receipts WHERE account_id=9001 AND customer_id=${c.id} AND source_kind='manual'`)).toHaveLength(1);
  44 | });
  45 | 
  46 | 
  47 | test('AR reproduces an effective date and a saved knowledge cutoff without resetting debt ages',async({page,prefix})=>{
  48 |  const c=await fixture(page,prefix);await start(page,c);const recordedThrough=new Date().toISOString();expect((await save(page)).status()).toBe(200);
  49 |  await page.goto('/receivables/aging');await page.getByPlaceholder('Search by business name, customer name, display name, or ID').fill(prefix);await page.getByRole('button',{name:'Search',exact:true}).click();
  50 |  let row=page.getByRole('row').filter({hasText:c.name});await expect(row.locator('td').nth(4)).toContainText('$150.00');
  51 |  await page.getByLabel('Recorded through (UTC)').fill(recordedThrough);
  52 |  await expect(row.locator('td').nth(4)).toContainText('$400.00');await expect(row.locator('td').nth(5)).toContainText('$450.00');await expect(row.locator('td').nth(6)).toContainText('$300.00');
  53 |  const prior=new Date();prior.setUTCDate(prior.getUTCDate()-20);await page.getByLabel('Aging as of').fill(prior.toISOString().slice(0,10));
  54 |  await expect(row.locator('td').nth(4)).toContainText('$450.00');await expect(row.locator('td').nth(5)).toContainText('$300.00');
  55 |  await page.getByLabel('Recorded through (UTC)').fill('not-a-timestamp');await expect(page.getByRole('alert')).toBeVisible();
  56 | });
  57 | 
  58 | 
  59 | for(const role of ['manager','employee','super admin'])test(`receipt corrections honor the ${role} role in the browser`,async({page,prefix})=>{
  60 |  const c=await fixture(page,prefix);await start(page,c,'100');expect((await save(page)).status()).toBe(200);await page.getByRole('link',{name:'View receipt'}).click();const url=page.url(),before=state(c);
  61 |  const original=rows('SELECT access_level FROM users WHERE account_id=9001 AND user_id=90013')[0].access_level;
  62 |  try{
  63 |   sql(`UPDATE users SET access_level=${literal(role)} WHERE account_id=9001 AND user_id=90013`);
  64 |   await page.evaluate(value=>sessionStorage.setItem('accessLevel',value),role);await page.goto(url);
  65 |   if(role==='super admin'){
  66 |    await page.getByLabel('Reason for correction').fill('Authorized single administrator correction');await page.getByRole('button',{name:'Cancel unissued receipt entered in error'}).click();await expect(page.getByText(/complete receipt was reversed/)).toBeVisible();
  67 |   }else{
  68 |    await expect(page.getByText(role==='employee'?'You are not authorized to access this page.':'Only admins can correct applications or apply a bounced-check exception.')).toBeVisible();
  69 |    for(const name of ['Correct application','Flag complete receipt as bounced','Reverse complete receipt','Cancel unissued receipt entered in error','Create statement revisions','Roll correction into next statement'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
  70 |    expect(state(c)).toEqual(before);
  71 |   }
  72 |  }finally{sql(`UPDATE users SET access_level=${literal(original)} WHERE account_id=9001 AND user_id=90013`);}
  73 | });
  74 | 
```