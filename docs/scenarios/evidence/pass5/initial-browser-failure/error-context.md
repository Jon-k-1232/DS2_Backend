# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: user-mistakes-delete.spec.js >> retainer linked-payment lookup failure refuses deletion until a successful reload
- Location: tests/user-mistakes-delete.spec.js:38:1

# Error details

```
TimeoutError: page.waitForResponse: Timeout 20000ms exceeded while waiting for event "response"
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - link [ref=e4] [cursor=pointer]:
      - /url: "#main-content"
      - text: Skip to content
    - banner [ref=e5]:
      - generic [ref=e6]:
        - button [expanded] [ref=e7] [cursor=pointer]
        - generic [ref=e16]: Clients
        - generic [ref=e17]:
          - button [ref=e18] [cursor=pointer]
          - button [ref=e22] [cursor=pointer]
    - region [ref=e33]:
      - generic [ref=e34]:
        - link [ref=e36] [cursor=pointer]:
          - /url: /clients
          - heading [level=2] [ref=e38]: DS | 2
        - navigation [ref=e39]:
          - list [ref=e40]:
            - button [expanded] [ref=e41] [cursor=pointer]:
              - generic [ref=e47]: Clients
            - link [ref=e57] [cursor=pointer]:
              - /url: /clients
              - generic [ref=e58]: Clients
            - button [ref=e60] [cursor=pointer]:
              - generic [ref=e66]: Time & Work
            - button [ref=e72] [cursor=pointer]:
              - generic [ref=e78]: Billing
            - button [ref=e84] [cursor=pointer]:
              - generic [ref=e90]: Payments & Credits
            - button [ref=e96] [cursor=pointer]:
              - generic [ref=e104]: Receivables
            - button [ref=e110] [cursor=pointer]:
              - generic [ref=e116]: Time Tracking
            - button [ref=e122] [cursor=pointer]:
              - generic [ref=e130]: Settings
    - main [ref=e137]:
      - generic [ref=e138]:
        - navigation [ref=e139]:
          - list [ref=e140]:
            - listitem [ref=e141]:
              - paragraph [ref=e142]: Clients
            - listitem [aria-hidden] [ref=e143]: /
            - listitem [ref=e144]:
              - paragraph [ref=e145]: Clients
        - navigation [ref=e146]:
          - generic [ref=e147]:
            - link [ref=e148] [cursor=pointer]:
              - /url: /work/entries?entry=time
              - text: Enter time
            - link [ref=e149] [cursor=pointer]:
              - /url: /billing/create
              - text: Create invoices
            - link [ref=e150] [cursor=pointer]:
              - /url: /payments/receive
              - text: Receive payment
            - link [ref=e151] [cursor=pointer]:
              - /url: /billing/recurring
              - text: Recurring plans
      - grid [ref=e154]:
        - generic [ref=e155]:
          - generic [ref=e156]: Customers
          - button [ref=e158] [cursor=pointer]
          - button [ref=e161] [cursor=pointer]: Columns
          - button [ref=e165] [cursor=pointer]: Filters
          - button [ref=e170] [cursor=pointer]: Export
          - textbox [ref=e180]:
            - /placeholder: Search customers
        - generic [ref=e181]:
          - rowgroup [ref=e182]:
            - row [ref=e183]:
              - columnheader [ref=e184] [cursor=pointer]:
                - generic [ref=e185]: Customer Id
              - columnheader [ref=e187] [cursor=pointer]:
                - generic [ref=e188]: Business Name
              - columnheader [ref=e190] [cursor=pointer]:
                - generic [ref=e191]: Customer Name
              - columnheader [ref=e193] [cursor=pointer]:
                - generic [ref=e194]: Display Name
              - columnheader [ref=e196] [cursor=pointer]:
                - generic [ref=e197]: Customer Street
              - columnheader [ref=e199] [cursor=pointer]:
                - generic [ref=e200]: Customer City
              - columnheader [ref=e202] [cursor=pointer]:
                - generic [ref=e203]: Customer State
          - rowgroup [ref=e205]:
            - row [ref=e206]:
              - cell [ref=e207]: "900101"
              - cell [ref=e208]: Acme Corporation
              - cell [ref=e209]: Acme
              - cell [ref=e210]: Acme Corp
              - cell [ref=e211]: 1 Acme Way
              - cell [ref=e212]: Phoenix
              - cell [ref=e213]: AZ
            - row [ref=e214]:
              - cell [ref=e215]: "910703"
              - cell [ref=e216]: CovA-5243-mugmhvhv-2
              - cell [ref=e217]: CovA-5243-mugmhvhv-2
              - cell [ref=e218]: CovA-5243-mugmhvhv-2
              - cell [ref=e219]: 1 Coverage Way
              - cell [ref=e220]: Phoenix
              - cell [ref=e221]: AZ
            - row [ref=e222]:
              - cell [ref=e223]: "919628"
              - cell [ref=e224]: CovA-61166-muiccswb-2
              - cell [ref=e225]: CovA-61166-muiccswb-2
              - cell [ref=e226]: CovA-61166-muiccswb-2
              - cell [ref=e227]: 1 Coverage Way
              - cell [ref=e228]: Phoenix
              - cell [ref=e229]: AZ
            - row [ref=e230]:
              - cell [ref=e231]: "910704"
              - cell [ref=e232]: =CovB-5243-mugmhvi4-3
              - cell [ref=e233]: =CovB-5243-mugmhvi4-3
              - cell [ref=e234]: =CovB-5243-mugmhvi4-3
              - cell [ref=e235]: 1 Coverage Way
              - cell [ref=e236]: Phoenix
              - cell [ref=e237]: AZ
            - row [ref=e238]:
              - cell [ref=e239]: "919629"
              - cell [ref=e240]: =CovB-61166-muiccswo-3
              - cell [ref=e241]: =CovB-61166-muiccswo-3
              - cell [ref=e242]: =CovB-61166-muiccswo-3
              - cell [ref=e243]: 1 Coverage Way
              - cell [ref=e244]: Phoenix
              - cell [ref=e245]: AZ
            - row [ref=e246]:
              - cell [ref=e247]: "921419"
              - cell [ref=e248]: Coverage TT MUIPSGUGCYXK
              - cell [ref=e249]: Coverage Tester
              - cell [ref=e250]: Coverage TT MUIPSGUGCYXK
              - cell [ref=e251]: 2 Coverage Ct
              - cell [ref=e252]: Tempe
              - cell [ref=e253]: AZ
            - row [ref=e254]:
              - cell [ref=e255]: "922226"
              - cell [ref=e256]
              - cell [ref=e257]: E2E_1790452831342_826f42 Mary Ann Van Buren
              - cell [ref=e258]: E2E_1790452831342_826f42 Mary Ann Van Buren
              - cell [ref=e259]: 123 Sandbox Lane
              - cell [ref=e260]: Phoenix
              - cell [ref=e261]: AZ
            - row [ref=e262]:
              - cell [ref=e263]: "910825"
              - cell [ref=e264]: FinalizeEngine peer 1790320346622-5255-3y9j
              - cell [ref=e265]: Engine Tester
              - cell [ref=e266]: FinalizeEngine peer 1790320346622-5255-3y9j
              - cell [ref=e267]: 2 Ledger Lane
              - cell [ref=e268]: Mesa
              - cell [ref=e269]: AZ
            - row [ref=e270]:
              - cell [ref=e271]: "910974"
              - cell [ref=e272]: FinalizeEngine main 1790321252430-6619-bhzs
              - cell [ref=e273]: Engine Tester
              - cell [ref=e274]: FinalizeEngine main 1790321252430-6619-bhzs
              - cell [ref=e275]: 2 Ledger Lane
              - cell [ref=e276]: Mesa
              - cell [ref=e277]: AZ
            - row [ref=e278]:
              - cell [ref=e279]: "910975"
              - cell [ref=e280]: FinalizeEngine peer 1790321252515-6619-75ud
              - cell [ref=e281]: Engine Tester
              - cell [ref=e282]: FinalizeEngine peer 1790321252515-6619-75ud
              - cell [ref=e283]: 2 Ledger Lane
              - cell [ref=e284]: Mesa
              - cell [ref=e285]: AZ
            - row [ref=e286]:
              - cell [ref=e287]: "910976"
              - cell [ref=e288]: FinalizeEngine empty 1790321252569-6619-dksa
              - cell [ref=e289]: Engine Tester
              - cell [ref=e290]: FinalizeEngine empty 1790321252569-6619-dksa
              - cell [ref=e291]: 2 Ledger Lane
              - cell [ref=e292]: Mesa
              - cell [ref=e293]: AZ
            - row [ref=e294]:
              - cell [ref=e295]: "910977"
              - cell [ref=e296]: FinalizeEngine rerun 1790321252621-6619-w6r3
              - cell [ref=e297]: Engine Tester
              - cell [ref=e298]: FinalizeEngine rerun 1790321252621-6619-w6r3
              - cell [ref=e299]: 2 Ledger Lane
              - cell [ref=e300]: Mesa
              - cell [ref=e301]: AZ
            - row [ref=e302]:
              - cell [ref=e303]: "910824"
              - cell [ref=e304]: FinalizeEngine main 1790320346543-5255-qpjs
              - cell [ref=e305]: Engine Tester
              - cell [ref=e306]: FinalizeEngine main 1790320346543-5255-qpjs
              - cell [ref=e307]: 2 Ledger Lane
              - cell [ref=e308]: Mesa
              - cell [ref=e309]: AZ
            - row [ref=e310]:
              - cell [ref=e311]: "910826"
              - cell [ref=e312]: FinalizeEngine empty 1790320346679-5255-xw7l
              - cell [ref=e313]: Engine Tester
              - cell [ref=e314]: FinalizeEngine empty 1790320346679-5255-xw7l
              - cell [ref=e315]: 2 Ledger Lane
              - cell [ref=e316]: Mesa
              - cell [ref=e317]: AZ
            - row [ref=e318]:
              - cell [ref=e319]: "910827"
              - cell [ref=e320]: FinalizeEngine rerun 1790320346729-5255-z10s
              - cell [ref=e321]: Engine Tester
              - cell [ref=e322]: FinalizeEngine rerun 1790320346729-5255-z10s
              - cell [ref=e323]: 2 Ledger Lane
              - cell [ref=e324]: Mesa
              - cell [ref=e325]: AZ
            - row [ref=e326]:
              - cell [ref=e327]: "919749"
              - cell [ref=e328]: FinalizeEngine main 1790424265548-61216-2sav
              - cell [ref=e329]: Engine Tester
              - cell [ref=e330]: FinalizeEngine main 1790424265548-61216-2sav
              - cell [ref=e331]: 2 Ledger Lane
              - cell [ref=e332]: Mesa
              - cell [ref=e333]: AZ
            - row [ref=e334]:
              - cell [ref=e335]: "919750"
              - cell [ref=e336]: FinalizeEngine peer 1790424265754-61216-kuxo
              - cell [ref=e337]: Engine Tester
              - cell [ref=e338]: FinalizeEngine peer 1790424265754-61216-kuxo
              - cell [ref=e339]: 2 Ledger Lane
              - cell [ref=e340]: Mesa
              - cell [ref=e341]: AZ
            - row [ref=e342]:
              - cell [ref=e343]: "919751"
              - cell [ref=e344]: FinalizeEngine empty 1790424265928-61216-gbvm
              - cell [ref=e345]: Engine Tester
              - cell [ref=e346]: FinalizeEngine empty 1790424265928-61216-gbvm
              - cell [ref=e347]: 2 Ledger Lane
              - cell [ref=e348]: Mesa
              - cell [ref=e349]: AZ
            - row [ref=e350]:
              - cell [ref=e351]: "919752"
              - cell [ref=e352]: FinalizeEngine rerun 1790424266096-61216-gppr
              - cell [ref=e353]: Engine Tester
              - cell [ref=e354]: FinalizeEngine rerun 1790424266096-61216-gppr
              - cell [ref=e355]: 2 Ledger Lane
              - cell [ref=e356]: Mesa
              - cell [ref=e357]: AZ
            - row [ref=e358]:
              - cell [ref=e359]: "910906"
              - cell [ref=e360]
              - cell [ref=e361]: F8-F22-5292-mugmiwh1-1
              - cell [ref=e362]: F8-F22-5292-mugmiwh1-1
              - cell [ref=e363]
              - cell [ref=e364]
              - cell [ref=e365]: AZ
            - row [ref=e366]:
              - cell [ref=e367]: "910907"
              - cell [ref=e368]
              - cell [ref=e369]: F8-F22-5292-mugmiwhx-2
              - cell [ref=e370]: F8-F22-5292-mugmiwhx-2
              - cell [ref=e371]
              - cell [ref=e372]
              - cell [ref=e373]: AZ
            - row [ref=e374]:
              - cell [ref=e375]: "910908"
              - cell [ref=e376]
              - cell [ref=e377]: F8-F22-5292-mugmiwkq-3
              - cell [ref=e378]: F8-F22-5292-mugmiwkq-3
              - cell [ref=e379]
              - cell [ref=e380]
              - cell [ref=e381]: AZ
            - row [ref=e382]:
              - cell [ref=e383]: "910909"
              - cell [ref=e384]
              - cell [ref=e385]: F8-F22-5292-mugmiwm1-4
              - cell [ref=e386]: F8-F22-5292-mugmiwm1-4
              - cell [ref=e387]
              - cell [ref=e388]
              - cell [ref=e389]: AZ
            - row [ref=e390]:
              - cell [ref=e391]: "919831"
              - cell [ref=e392]
              - cell [ref=e393]: F8-F22-62225-muicfilx-1
              - cell [ref=e394]: F8-F22-62225-muicfilx-1
              - cell [ref=e395]
              - cell [ref=e396]
              - cell [ref=e397]: AZ
            - row [ref=e398]:
              - cell [ref=e399]: "919832"
              - cell [ref=e400]
              - cell [ref=e401]: F8-F22-62225-muicfims-2
              - cell [ref=e402]: F8-F22-62225-muicfims-2
              - cell [ref=e403]
              - cell [ref=e404]
              - cell [ref=e405]: AZ
            - row [ref=e406]:
              - cell [ref=e407]: "919833"
              - cell [ref=e408]
              - cell [ref=e409]: F8-F22-62225-muicfivl-3
              - cell [ref=e410]: F8-F22-62225-muicfivl-3
              - cell [ref=e411]
              - cell [ref=e412]
              - cell [ref=e413]: AZ
        - generic [ref=e416]:
          - paragraph [ref=e417]: 1–20 of 35
          - generic [ref=e418]:
            - button [disabled]
            - button [ref=e419] [cursor=pointer]
  - dialog [ref=e424]:
    - heading "New Customer" [level=2] [ref=e425]
    - generic [ref=e427]:
      - radiogroup [ref=e430]:
        - generic [ref=e431] [cursor=pointer]:
          - radio "Individual" [checked] [ref=e433]
          - generic [ref=e439]: Individual
        - generic [ref=e440] [cursor=pointer]:
          - radio "Business" [ref=e442]
          - generic [ref=e446]: Business
      - generic [ref=e449]:
        - generic [ref=e450]:
          - generic [ref=e451]: First Name
          - textbox "First Name" [ref=e453]: E2E_1790465787498_a6dd52 Mary Ann
        - generic [ref=e454]:
          - generic [ref=e455]: Last Name
          - textbox "Last Name" [ref=e457]: Van Buren
      - generic [ref=e459]:
        - generic [ref=e460] [cursor=pointer]:
          - checkbox "Physical Address" [checked] [ref=e462]
          - generic [ref=e465]: Physical Address
        - generic [ref=e466] [cursor=pointer]:
          - checkbox "Billing Address" [checked] [ref=e468]
          - generic [ref=e471]: Billing Address
        - generic [ref=e472] [cursor=pointer]:
          - checkbox "Mailing Address" [checked] [ref=e474]
          - generic [ref=e477]: Mailing Address
      - generic [ref=e479]:
        - generic [ref=e481]:
          - generic [ref=e482]: Street Address
          - textbox "Street Address" [ref=e484]: 123 Sandbox Lane
        - generic [ref=e485]:
          - generic [ref=e486]:
            - generic [ref=e487]: City
            - textbox "City" [ref=e489]: Phoenix
          - generic [ref=e490]:
            - generic [ref=e491]: State
            - textbox "State" [ref=e493]: AZ
          - generic [ref=e494]:
            - generic [ref=e495]: Zip
            - spinbutton "Zip" [ref=e497]: "85001"
        - generic [ref=e498]:
          - generic [ref=e499]:
            - generic [ref=e500]: Phone
            - textbox "Phone" [ref=e502]: "6025550100"
          - generic [ref=e503]:
            - generic [ref=e504]: Email
            - textbox "Email" [ref=e506]: e2e_1790465787498_a6dd52@example.com
      - generic [ref=e509]:
        - generic [ref=e510] [cursor=pointer]:
          - checkbox "Customer Active" [checked] [ref=e512]
          - generic [ref=e515]: Customer Active
        - generic [ref=e516] [cursor=pointer]:
          - checkbox "Customer Billable" [checked] [ref=e518]
          - generic [ref=e521]: Customer Billable
        - generic [ref=e522] [cursor=pointer]:
          - checkbox "Recurring billing" [ref=e524]
          - generic [ref=e527]: Recurring billing
      - button "Submit" [active] [ref=e529] [cursor=pointer]
    - button "Cancel" [ref=e531] [cursor=pointer]
```

# Test source

```ts
  1   | const { expect } = require('@playwright/test');
  2   | const { rows, literal } = require('./db');
  3   | const { rememberObject } = require('./storage');
  4   | const { saveDownload } = require('./download');
  5   | const routes = { customers: '/clients', jobs: '/work/jobs', transactions: '/work/entries', payments: '/payments/receipts/legacy', writeoffs: '/receivables/write-offs', retainers: '/payments/retainers', createInvoice: '/billing/create', invoices: '/billing/invoices' };
  6   | async function choose(page, scope, label, text) {
  7   |   const input = scope.getByRole('combobox', { name: label, exact: true });
  8   |   await input.fill(text);
  9   |   // .first(): this is a shared sandbox DB — a concurrent process can insert a
  10  |   // same-named fixture (observed live: a second "Eliza Smith", user_id 90047,
  11  |   // alongside the real fixture 90011) that makes an exact-text option match
  12  |   // resolve to more than one <li>. Every value this suite ever passes here is
  13  |   // either a fixed, known-unique catalog entry or a freshly E2E_-prefixed
  14  |   // name, so a real duplicate among THIS suite's own data would be a genuine
  15  |   // bug — but one from someone else's concurrently-inserted row is noise, not
  16  |   // a defect to chase, and the first (lowest option-order, i.e. lowest id)
  17  |   // match is always this suite's own canonical fixture.
  18  |   await page.getByRole('option', { name: text, exact: true }).first().click();
  19  | }
  20  | async function submit(page, scope, endpoint, button = 'Submit') {
> 21  |   const response = page.waitForResponse(r => r.url().includes(endpoint) && ['POST','PUT','PATCH','DELETE'].includes(r.request().method()));
      |                         ^ TimeoutError: page.waitForResponse: Timeout 20000ms exceeded while waiting for event "response"
  22  |   await scope.getByRole('button', { name: button, exact: true }).click();
  23  |   const r = await response;
  24  |   const body = await r.json();
  25  |   expect(r.ok(), JSON.stringify(body)).toBeTruthy();
  26  |   expect(body.status, JSON.stringify(body)).toBe(200);
  27  |   return body;
  28  | }
  29  | async function openForm(page, route, button) {
  30  |   await page.goto(route);
  31  |   await page.getByRole('button', { name: button, exact: true }).click();
  32  |   return page.getByRole('dialog');
  33  | }
  34  | // Stable grid toolbars preserve the open form after a successful save.
  35  | // Close explicitly, while tolerating a form already closed by its own flow.
  36  | async function closeForm(page) {
  37  |   try { await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click({ timeout: 3000 }); } catch {}
  38  |   await expect(page.getByRole('dialog')).toHaveCount(0);
  39  | }
  40  | // Jobs/Retainers use the grid's default MUI quick filter (an <input type="search">,
  41  | // ARIA role "searchbox" — GridToolbarQuickFilter's aria-label="Search" also lands on
  42  | // the outer MuiFormControl wrapper, not the input, so no role/name query finds it).
  43  | // Its wrapper's emotion-generated class is a single hashed token like
  44  | // "css-11rtsvk-MuiFormControl-root-MuiTextField-root-MuiDataGrid-toolbarQuickFilter"
  45  | // — "MuiDataGrid-toolbarQuickFilter" is a suffix of that one long class, not its own
  46  | // space-separated class, so a plain ".MuiDataGrid-toolbarQuickFilter" selector (an
  47  | // exact-class match) never matches; an attribute-contains selector is required.
  48  | async function fillQuickFilter(page, value) {
  49  |   await page.locator('[class*="MuiDataGrid-toolbarQuickFilter"] input').fill(value);
  50  | }
  51  | async function createCustomer(page, prefix) {
  52  |   const name = `${prefix} Mary Ann Van Buren`;
  53  |   const dialog = await openForm(page, routes.customers, 'Add Customer');
  54  |   await dialog.getByLabel('First Name', { exact: true }).fill(`${prefix} Mary Ann`);
  55  |   await dialog.getByLabel('Last Name', { exact: true }).fill('Van Buren');
  56  |   for (const [label, value] of Object.entries({ 'Street Address':'123 Sandbox Lane', City:'Phoenix', State:'AZ', Zip:'85001', Phone:'6025550100', Email:`${prefix.toLowerCase()}@example.com` })) await dialog.getByLabel(label, {exact:true}).fill(value);
  57  |   await submit(page, dialog, '/customer/createCustomer/');
  58  |   await closeForm(page);
  59  |   await page.getByPlaceholder('Search customers').fill(prefix);
  60  |   await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible();
  61  |   const [customer] = rows(`SELECT customer_id FROM customers WHERE account_id=9001 AND display_name=${literal(name)}`);
  62  |   expect(customer).toBeTruthy();
  63  |   return { name, id: customer.customer_id, prefix };
  64  | }
  65  | async function createJob(page, customer) {
  66  |   const d = await openForm(page, routes.jobs, 'Add New Customer Job');
  67  |   await choose(page,d,'Select Customer',customer.name);
  68  |   await choose(page,d,'Filter Job Types By Category','Tax Compliance');
  69  |   await choose(page,d,'Type Of Job','1040 Individual Return');
  70  |   await d.getByLabel('Job Notes').fill(customer.prefix);
  71  |   await submit(page,d,'/jobs/create');
  72  |   await closeForm(page);
  73  | }
  74  | async function addTransaction(page, customer, type='Time') {
  75  |   const d = await openForm(page, routes.transactions, type === 'Time' ? 'Add Time' : 'New Charge');
  76  |   await choose(page,d,'Select Customer',customer.name);
  77  |   await choose(page,d,'Select Job','1040 Individual Return');
  78  |   await choose(page,d,'Select Team Member','Eliza Smith');
  79  |   await choose(page,d,'General Work Description','Tax Return Preparation');
  80  |   await d.getByLabel('Work Completed On Job').fill(`${customer.prefix} ${type}`);
  81  |   // 0.3h is an exact 6-minute increment: TimeOptions/handleTimeCalculation
  82  |   // rounds logged time UP to the next 0.1h (6-minute) increment (see the
  83  |   // "Time (hours)" field's own helper text), so a value that isn't already on
  84  |   // a 6-minute boundary would silently bill a different quantity than typed
  85  |   // (e.g. 0.25h -> rounds up to 0.3h). Use 0.3h to keep quantity/total exact.
  86  |   if (type === 'Time') await d.getByLabel('Time (hours)').fill('0.3');
  87  |   else { await d.getByLabel('Quantity',{exact:true}).fill('2'); await d.getByLabel('Unit Cost').fill('10'); }
  88  |   await expect(d.getByText(type === 'Time' ? /Total:\s*22\.50/ : /Total:\s*20\.00/)).toBeVisible();
  89  |   await submit(page,d,'/transactions/createTransaction/');
  90  |   await closeForm(page);
  91  |   await page.getByPlaceholder('Search transactions').fill(customer.prefix);
  92  |   const [transaction] = rows(`SELECT transaction_id FROM customer_transactions WHERE account_id=9001 AND customer_id=${customer.id} AND detailed_work_description=${literal(`${customer.prefix} ${type}`)} ORDER BY transaction_id DESC LIMIT 1`);
  93  |   expect(transaction).toBeTruthy();
  94  |   const row = page.locator(`[role="row"][data-id="${transaction.transaction_id}"]`);
  95  |   await expect(row).toBeVisible();
  96  |   await expectGridValue(page,row,'total_transaction',type === 'Time' ? '22.50' : '20.00');
  97  |   return row;
  98  | }
  99  | async function billedCustomer(page, prefix) {
  100 |   const customer = await createCustomer(page,prefix);
  101 |   await createJob(page,customer);
  102 |   await addTransaction(page,customer);
  103 |   return customer;
  104 | }
  105 | // Root cause (found via diagnosis, not a flake): CreateInvoiceGrid.js now
  106 | // uses MUI X DataGrid's own default checkboxSelection column instead of a
  107 | // custom-rendered one. MUI's built-in row checkbox has a STATE-DEPENDENT
  108 | // accessible name — localeTextConstants.js: checkboxSelectionSelectRow
  109 | // ('Select row') while unchecked, checkboxSelectionUnselectRow ('Unselect
  110 | // row') once checked. A locator built with {name:'Select row'} stops
  111 | // resolving to anything the instant the click succeeds, so Playwright's own
  112 | // post-click re-verification (or a later re-query, e.g. .check()'s internal
  113 | // state check, or this helper's own isChecked()) finds zero elements and
  114 | // reports "Clicking the checkbox did not change its state" or hangs waiting
  115 | // for a name that will never come back — even though the click landed and
  116 | // the row really is selected (confirmed live: grid footer showed "1 row
  117 | // selected" while the name-based locator had already gone stale). Target the
  118 | // checkbox by MUI's stable cellCheckbox class instead, which does not depend
  119 | // on the accessible name / selection state.
  120 | async function selectInvoiceRow(page, row) {
  121 |   await expect(row).toBeVisible();
```