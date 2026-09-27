# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: user-mistakes-decisions.spec.js >> sent receipt exception requires selection and reason; reversal and revision preserve original bytes
- Location: tests/user-mistakes-decisions.spec.js:122:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/Sent — locked ·/)
Expected: visible
Error: strict mode violation: getByText(/Sent — locked ·/) resolved to 4 elements:
    1) <div role="presentation" title="Sent — locked · " class="MuiDataGrid-cellContent">Sent — locked · </div> aka getByText('Sent — locked ·').first()
    2) <div role="presentation" title="Sent — locked · " class="MuiDataGrid-cellContent">Sent — locked · </div> aka getByText('Sent — locked ·').nth(1)
    3) <div role="presentation" title="Sent — locked · " class="MuiDataGrid-cellContent">Sent — locked · </div> aka getByText('Sent — locked ·').nth(2)
    4) <div role="presentation" title="Sent — locked · " class="MuiDataGrid-cellContent">Sent — locked · </div> aka getByText('Sent — locked ·').nth(3)

Call log:
  - Expect "toBeVisible" getByText(/Sent — locked ·/) with timeout 15000ms
  - waiting for getByText(/Sent — locked ·/)

```

# Page snapshot

```yaml
- generic [ref=f6e3]:
  - link "Skip to content" [ref=f6e4] [cursor=pointer]:
    - /url: "#main-content"
  - banner [ref=f6e5]:
    - generic [ref=f6e6]:
      - button "Hide menu" [expanded] [ref=f6e7] [cursor=pointer]
      - generic [ref=f6e16]: Invoices
      - generic [ref=f6e17]:
        - button "Notifications" [ref=f6e18] [cursor=pointer]:
          - generic [ref=f6e19]: "0"
        - button "Account menu" [ref=f6e22] [cursor=pointer]
  - region "scrollable content" [ref=f6e33]:
    - generic [ref=f6e34]:
      - link "DS2 home" [ref=f6e36] [cursor=pointer]:
        - /url: /clients
        - heading "DS | 2" [level=2] [ref=f6e38]
      - navigation "Primary navigation" [ref=f6e39]:
        - list [ref=f6e40]:
          - button "Clients" [ref=f6e41] [cursor=pointer]
          - button "Time & Work" [ref=f6e53] [cursor=pointer]
          - button "Billing" [expanded] [ref=f6e65] [cursor=pointer]
          - generic "Billing" [ref=f6e80]:
            - link "Create invoices" [ref=f6e81] [cursor=pointer]:
              - /url: /billing/create
            - link "Invoices" [ref=f6e84] [cursor=pointer]:
              - /url: /billing/invoices
            - link "Quotes" [ref=f6e87] [cursor=pointer]:
              - /url: /billing/quotes
            - link "Recurring plans" [ref=f6e90] [cursor=pointer]:
              - /url: /billing/recurring
            - link "Credit memos" [ref=f6e93] [cursor=pointer]:
              - /url: /billing/credit-memos
          - button "Payments & Credits" [ref=f6e96] [cursor=pointer]
          - button "Receivables" [ref=f6e108] [cursor=pointer]
          - button "Time Tracking" [ref=f6e122] [cursor=pointer]
          - button "Settings" [ref=f6e134] [cursor=pointer]
  - main [active] [ref=f6e149]:
    - generic [ref=f6e150]:
      - navigation "Breadcrumbs" [ref=f6e151]:
        - list [ref=f6e152]:
          - listitem [ref=f6e153]:
            - paragraph [ref=f6e154]: Billing
          - listitem [aria-hidden] [ref=f6e155]: /
          - listitem [ref=f6e156]:
            - link "Invoices" [ref=f6e157] [cursor=pointer]:
              - /url: /billing/invoices
          - listitem [aria-hidden] [ref=f6e158]: /
          - listitem [ref=f6e159]:
            - paragraph [ref=f6e160]: Details
      - navigation "Quick actions" [ref=f6e161]:
        - generic [ref=f6e162]:
          - link "Enter time" [ref=f6e163] [cursor=pointer]:
            - /url: /work/entries?entry=time
          - link "Create invoices" [ref=f6e164] [cursor=pointer]:
            - /url: /billing/create
          - link "Receive payment" [ref=f6e165] [cursor=pointer]:
            - /url: /payments/receive
          - link "Recurring plans" [ref=f6e166] [cursor=pointer]:
            - /url: /billing/recurring
    - generic [ref=f6e167]:
      - tablist "Page sections" [ref=f6e172]:
        - tab "Transactions" [selected] [ref=f6e173] [cursor=pointer]
        - tab "Payments" [ref=f6e174] [cursor=pointer]
        - tab "Write Offs" [ref=f6e175] [cursor=pointer]
        - tab "Outstanding Invoices" [ref=f6e176] [cursor=pointer]
        - tab "Retainers" [ref=f6e177] [cursor=pointer]
      - generic [ref=f6e179]:
        - table [ref=f6e180]:
          - rowgroup [ref=f6e181]:
            - row [ref=f6e182]:
              - rowheader "Company Name:" [ref=f6e183]
              - cell "E2E_1790481216713_503d42 Mary Ann Van Buren" [ref=f6e184]
            - row [ref=f6e185]:
              - rowheader "Billing Address:" [ref=f6e186]
              - cell "123 Sandbox Lane Phoenix AZ, 85001" [ref=f6e187]: 123 Sandbox LanePhoenix AZ, 85001
            - row [ref=f6e188]:
              - rowheader "Customer Phone:" [ref=f6e189]
              - cell "6025550100" [ref=f6e190]
            - row [ref=f6e191]:
              - rowheader "Email:" [ref=f6e192]
              - cell "e2e_1790481216713_503d42@example.com" [ref=f6e193]
            - row [ref=f6e194]:
              - rowheader "Customer ID Row ID:" [ref=f6e195]
              - cell "925101" [ref=f6e196]
            - row [ref=f6e197]:
              - rowheader "Customer Address Row ID:" [ref=f6e198]
              - cell "25594" [ref=f6e199]
        - table [ref=f6e200]:
          - rowgroup [ref=f6e201]:
            - row [ref=f6e202]:
              - rowheader "Invoice ID:" [ref=f6e203]
              - cell "INV-2026-01095" [ref=f6e204]
            - row [ref=f6e205]:
              - rowheader "Invoice Date:" [ref=f6e206]
              - cell "September 26, 2026" [ref=f6e207]
            - row [ref=f6e208]:
              - rowheader "Invoice Due Date:" [ref=f6e209]
              - cell "October 12, 2026" [ref=f6e210]
            - row [ref=f6e211]:
              - rowheader "Data Start Date:" [ref=f6e212]
              - cell "September 26, 2026" [ref=f6e213]
            - row [ref=f6e214]:
              - rowheader "Data End Date:" [ref=f6e215]
              - cell "September 26, 2026" [ref=f6e216]
            - row [ref=f6e217]:
              - rowheader "Fully Paid Date:" [ref=f6e218]
              - cell "Outstanding" [ref=f6e219]
            - row [ref=f6e220]:
              - rowheader "Invoice Row ID:" [ref=f6e221]
              - cell "26878" [ref=f6e222]
        - table [ref=f6e223]:
          - rowgroup [ref=f6e224]:
            - row [ref=f6e225]:
              - rowheader "Beginning Balance:" [ref=f6e226]
              - cell "17.50" [ref=f6e227]
            - row [ref=f6e228]:
              - rowheader "Total Payments:" [ref=f6e229]
              - cell "0.00" [ref=f6e230]
            - row [ref=f6e231]:
              - rowheader "Total Retainers:" [ref=f6e232]
              - cell "0.00" [ref=f6e233]
            - row [ref=f6e234]:
              - rowheader "Total Charges:" [ref=f6e235]
              - cell "0.00" [ref=f6e236]
            - row [ref=f6e237]:
              - rowheader "Total Write Offs:" [ref=f6e238]
              - cell "0.00" [ref=f6e239]
            - row [ref=f6e240]:
              - rowheader "Total Amount Due:" [ref=f6e241]
              - cell "17.50" [ref=f6e242]
            - row [ref=f6e243]:
              - rowheader "Current balance:" [ref=f6e244]
              - cell "17.5" [ref=f6e245]
        - button "Download Invoice" [ref=f6e247] [cursor=pointer]
      - generic "Invoice history" [ref=f6e248]:
        - alert [ref=f6e249]:
          - generic [ref=f6e253]: Sent — locked · INV-2026-01095. Original records and PDFs are preserved.
        - button "Flag exception" [ref=f6e254] [cursor=pointer]
        - heading "Archived versions" [level=6] [ref=f6e255]
        - button "Reprint original ($17.50)" [ref=f6e256] [cursor=pointer]
        - heading "History" [level=6] [ref=f6e257]
        - paragraph [ref=f6e258]: "9/27/2026, 3:53:46 AM · User #90013 · issued · Finalize selected statement (sent and locked)."
      - generic "Invoice corrections" [ref=f6e259]:
        - separator [ref=f6e260]
        - heading "Invoice corrections" [level=6] [ref=f6e261]
        - paragraph [ref=f6e262]: "Business #1 · Original new charges $0.00 · Open debt $0.00 · Available to credit $0.00"
        - generic [ref=f6e263]:
          - button "Credit memo" [ref=f6e264] [cursor=pointer]
          - button "Void and rebill" [ref=f6e265] [cursor=pointer]
        - heading "Credit memo history" [level=6] [ref=f6e266]
      - separator [ref=f6e267]
      - grid [ref=f6e270]:
        - generic [ref=f6e271]:
          - generic [ref=f6e272]: Transactions
          - button "Select columns" [ref=f6e273] [cursor=pointer]: Columns
          - button "Show filters" [ref=f6e277] [cursor=pointer]:
            - generic [ref=f6e278]: "0"
            - text: Filters
          - button "Export" [ref=f6e282] [cursor=pointer]
          - generic "Search" [ref=f6e286]:
            - searchbox "Search…" [ref=f6e290]
        - generic [ref=f6e291]:
          - rowgroup:
            - row
          - generic: No rows
          - rowgroup
        - generic [ref=f6e296]:
          - paragraph [ref=f6e297]: "Rows per page:"
          - generic [ref=f6e298]:
            - 'combobox "Rows per page: 100" [ref=f6e299] [cursor=pointer]': "100"
            - textbox [aria-hidden]: "100"
          - paragraph [ref=f6e300]: 0–0 of 0
          - generic [ref=f6e301]:
            - button "Go to previous page" [disabled]
            - button "Go to next page" [disabled]
```

# Test source

```ts
  1   | require('../lib/scenario-safety').assertLocalUI();
  2   | const { test, expect } = require('../lib/fixtures');
  3   | const { billedCustomer, createCustomer, createJob, addTransaction, finalize, openForm, closeForm, choose, submit, routes } = require('../lib/ui');
  4   | const { prepare, financial, saved, types } = require('../lib/mistakes');
  5   | const { rows } = require('../lib/db');
  6   | const { authenticate } = require('../lib/auth');
  7   | const { rememberObject } = require('../lib/storage');
  8   | const { saveDownload } = require('../lib/download');
  9   | const fs=require('fs'),crypto=require('crypto');
  10  | const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  11  | async function openInvoice(page,c,invoice) {
  12  |   await page.goto(routes.invoices); await page.getByPlaceholder('Search invoices').fill(invoice.invoice_number);
  13  |   await page.getByRole('row').filter({hasText:invoice.invoice_number}).first().click();
> 14  |   await expect(page.getByText(/Sent — locked ·/)).toBeVisible();
      |                                                   ^ Error: expect(locator).toBeVisible() failed
  15  | }
  16  | async function issue(page,c,{sameDay=false,credit=false,double=false}={}) {
  17  |   await page.goto(routes.createInvoice); await page.getByPlaceholder('Search by name or business').fill(c.prefix);
  18  |   const row=page.getByRole('row').filter({hasText:c.name}); await expect(row).toBeVisible();
  19  |   if(credit) {
  20  |     await expect(row).toContainText('Credit — no payment due');
  21  |     await expect(page.getByRole('checkbox',{name:/Select all/i})).toBeDisabled();
  22  |     await expect(row.locator('.MuiDataGrid-cellCheckbox input')).not.toBeChecked();
  23  |   }
  24  |   const selection=row.locator('.MuiDataGrid-cellCheckbox input');
  25  |   await selection.click();await expect(selection).toBeChecked();
  26  |   if(sameDay) await page.getByLabel(/Allow.*same.day|Include.*today|same.day.*rebill/i).check();
  27  |   await page.getByLabel('Create CSV Only').uncheck(); await page.getByLabel('Lock And Finalize Selected Invoices').check();
  28  |   await page.getByRole('button',{name:'Submit',exact:true}).click();
  29  |   let requests=0;
  30  |   await page.route('**/invoices/createInvoice/9001/90013',async route=>{requests++;await new Promise(r=>setTimeout(r,400));await route.fallback();});
  31  |   const response=page.waitForResponse(r=>r.request().method()==='POST' && r.url().includes('/invoices/createInvoice/'));
  32  |   const download=page.waitForEvent('download');
  33  |   const confirm=page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true});
  34  |   if(double) await confirm.dblclick(); else await confirm.click();
  35  |   const r=await response,body=await r.json(); expect(r.ok(),JSON.stringify(body)).toBeTruthy();expect(body.status,JSON.stringify(body)).toBe(200);
  36  |   rememberObject(c.prefix,body.fileLocation);await saveDownload(await download);
  37  |   expect(requests).toBe(1);
  38  |   await page.unroute('**/invoices/createInvoice/9001/90013');
  39  |   return body;
  40  | }
  41  | 
  42  | test('double finalization and browser Back create one sent invoice without replaying it',async({page,prefix})=>{
  43  |   const c=await billedCustomer(page,prefix);
  44  |   await issue(page,c,{double:true});
  45  |   await expect(page.getByText(/generated|created|finaliz|success/i).first()).toBeVisible();
  46  |   expect(rows(`SELECT invoice_id FROM invoice_issues WHERE account_id=9001 AND customer_id=${c.id}`)).toHaveLength(1);
  47  |   const before=financial(c);
  48  |   await page.goto(routes.customers);await page.goBack();expect(financial(c)).toEqual(before);
  49  |   expect(Number(before.customer_invoices[0].total_amount_due)).toBe(22.5);
  50  | });
  51  | 
  52  | test('stale delete page after another session finalizes refuses and preserves the entire sent record',async({page,browser,prefix})=>{
  53  |   const c=await billedCustomer(page,prefix);const [work]=saved('time',c);
  54  |   await page.goto(routes.transactions);await page.getByPlaceholder('Search transactions').fill(prefix);
  55  |   await page.locator(`[role=row][data-id="${work.transaction_id}"]`).click();
  56  |   await page.getByRole('button',{name:'Delete Transaction',exact:true}).click();
  57  |   const other=await browser.newContext();await authenticate(other,'admin');const p=await other.newPage();
  58  |   try {await finalize(p,c);} finally {await other.close();}
  59  |   const before=financial(c);
  60  |   await page.getByRole('dialog').getByRole('button',{name:'Delete',exact:true}).click();
  61  |   await expect(page.getByRole('alert')).toContainText(/sent|locked|invoice/i);
  62  |   expect(financial(c)).toEqual(before);
  63  |   // Reload rereads this record's current sent metadata, even before the
  64  |   // shared lookup lists finish loading.
  65  |   await page.reload();
  66  |   await expect(page.getByRole('alert')).toContainText(/sent|locked/i);
  67  |   await expect(page.getByRole('button',{name:'Delete Transaction',exact:true})).toHaveCount(0);
  68  | });
  69  | 
  70  | test('stale payment after another session pays in full refuses without a second receipt',async({page,browser,prefix})=>{
  71  |   const c=await billedCustomer(page,prefix);await finalize(page,c);const d=await prepare(page,c,'payment','22.5');
  72  |   const other=await browser.newContext();await authenticate(other,'admin');const p=await other.newPage();
  73  |   try {const form=await prepare(p,c,'payment','22.5');await submit(p,form,types.payment.endpoint);} finally {await other.close();}
  74  |   const before=financial(c);
  75  |   await d.getByRole('button',{name:'Submit',exact:true}).click();
  76  |   await expect(d.getByRole('alert').last()).toContainText(/balance|paid|open invoice|outstanding|remaining|exceed/i);
  77  |   expect(financial(c)).toEqual(before);expect(saved('payment',c)).toHaveLength(1);
  78  | });
  79  | 
  80  | test('optional credit excludes bulk selection and explicitly issues -$27.50 without a second deduction',async({page,prefix})=>{
  81  |   const c=await billedCustomer(page,prefix);
  82  |   const d=await openForm(page,routes.writeoffs,'New Write Off');await choose(page,d,'Select Customer',c.name);
  83  |   await d.getByRole('combobox',{name:'Select Current Cycle Job',exact:true}).fill('1040');
  84  |   await page.getByRole('option').filter({hasText:'1040 Individual Return'}).click();
  85  |   await choose(page,d,'Select Team Member','Admin Person');await d.getByLabel('Reason For Write Off').fill('Courtesy credit');await d.getByLabel('Write Off Amount').fill('50');
  86  |   await submit(page,d,types.writeoff.endpoint);await closeForm(page);
  87  |   await issue(page,c,{credit:true});
  88  |   const [invoice]=rows(`SELECT total_amount_due FROM customer_invoices WHERE account_id=9001 AND customer_id=${c.id} AND parent_invoice_id IS NULL`);
  89  |   expect(Number(invoice.total_amount_due)).toBe(-27.5);
  90  |   expect(saved('writeoff',c)).toHaveLength(1);expect(saved('payment',c)).toHaveLength(0);
  91  |   expect(rows(`SELECT credit_selection_reason FROM invoice_issues WHERE account_id=9001 AND customer_id=${c.id}`)[0].credit_selection_reason).toMatch(/explicitly selected credit/);
  92  | });
  93  | 
  94  | test('duplicate flag rejects missing IDs, supports dismissal and removes only an unbilled duplicate',async({page,prefix})=>{
  95  |   const c=await billedCustomer(page,prefix);const [work]=saved('time',c);const before=financial(c);
  96  |   await page.goto('/work/duplicates');
  97  |   const reason=page.getByRole('textbox',{name:/^Reason/});
  98  |   await reason.fill('Manual review');await page.getByLabel('Record ID',{exact:true}).fill('2147483000');
  99  |   await page.getByRole('button',{name:'Flag possible duplicate',exact:true}).click();await expect(page.getByRole('alert')).toContainText(/not found|not.*exist|missing|unavailable/i);expect(financial(c)).toEqual(before);
  100 |   await page.getByLabel('Record ID',{exact:true}).fill(String(work.transaction_id));
  101 |   await page.getByRole('button',{name:'Flag possible duplicate',exact:true}).click();await expect(page.getByRole('alert')).toContainText(/flag/i);
  102 |   let [flag]=rows(`SELECT duplicate_id FROM duplicate_flags WHERE account_id=9001 AND customer_id=${c.id} ORDER BY duplicate_id DESC`);
  103 |   await page.getByRole('button',{name:`Review #${flag.duplicate_id}`,exact:true}).click();await reason.fill('Reviewed as distinct');
  104 |   await page.getByRole('button',{name:'Not a duplicate',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Marked not a duplicate.');expect(financial(c)).toEqual(before);
  105 |   await reason.fill('Confirmed duplicate');await page.getByRole('button',{name:'Flag possible duplicate',exact:true}).click();
  106 |   await expect(page.getByRole('alert')).toContainText('This pair already has a duplicate review. Open its existing history.');
  107 |   expect(financial(c)).toEqual(before);
  108 |   // The unchanged dismissed pair stays resolved. A separate unbilled charge
  109 |   // gives the permitted removal case without weakening that conflict rule.
  110 |   await addTransaction(page,c,'Charge');const candidate=saved('charge',c).find(r=>r.transaction_type==='Charge');
  111 |   await page.goto('/work/duplicates');await reason.fill('Confirmed extra charge');await page.getByLabel('Record ID',{exact:true}).fill(String(candidate.transaction_id));await page.getByRole('button',{name:'Flag possible duplicate',exact:true}).click();
  112 |   await expect(page.getByRole('alert')).toContainText(/flag/i);
  113 |   [flag]=rows(`SELECT duplicate_id FROM duplicate_flags WHERE account_id=9001 AND customer_id=${c.id} ORDER BY duplicate_id DESC`);
  114 |   await page.getByRole('button',{name:`Review #${flag.duplicate_id}`,exact:true}).click();await reason.fill('Remove confirmed duplicate');
```