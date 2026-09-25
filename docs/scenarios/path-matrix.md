# Pass 3: route-by-route happy and unhappy path matrix

Observed against the local sandbox on 2026-09-25. The specification was written first in [path-matrix-expectations.md](path-matrix-expectations.md). Finalize is the sent/lock boundary; drafts remain editable and write nothing to the ledger. No production/AWS resource was used.

## Totals and counting convention

- **160 routes across 30 mounts**: 158 observed successful contracts and 2 intentionally retired 410 contracts. This includes all 135 historical COVERAGE_MATRIX entries and the 25 newer mounted routes.
- **898 enumerated failure sites**: 793 reachable error/fallback sites proved by passing tests; 76 defensive sites unreachable from an admitted HTTP request; 29 startup, scheduled-only or unused exported-helper sites excluded from HTTP reachability. There are **0 unclassified or unproved reachable sites**.
- **202 reachable sites newly proved by this pass** (no passing pre-existing test executes them on the final source); **707 new API/service test cases**. Global missing-auth, foreign-tenant and low-role refusals are additionally asserted separately for each applicable route in path-matrix-01.
- A site means one explicit throw, 4xx/5xx response, validation-result emission, catch body or promise rejection callback. A catch and its error response are separate source sites, even when one test proves both. This is an auditable source-site count, not a claim that one test per status code exhausts a feature. Boolean input variants and repeated service uses are linked through their tests below.
- Existing proof is reused. A route points to its handler/service sites; each site points to exact spec/test names in the test index. Shared sites are defined once. The static call graph is supplemented with app auth, tenant/self guards, ledger audit context, lock decoration and error forwarding; individual sites may be dominated by earlier checks, explicitly explained below.
- New refusal tests assert transport status, the JSON status when present, the message envelope, and a sorted count/digest snapshot of every public database table. Sequences are excluded because PostgreSQL sequences do not roll back. Background audit jobs may create the expressly requested failed report; optional failures after commit must preserve and report that commit. Local object rollback/orphan boundaries are described in the expectation document.
- Passing execution attribution alone is not a universal assertion of correctness: proof references are the named test oracles, and the totals cover the explicit failure sites reviewed here. Runtime/library behavior outside these boundaries is not inferred from source-line coverage.

## Global handlers

These apply in addition to each route row: malformed JSON (400), body-size limit (413), production error masking (500), database sent-lock normalization (409), auth/API/mutation throttles (429), and asynchronous error forwarding through express-async-errors / asyncHandler. Read-only polls remain outside mutation throttling.

- [T0969](#t0969) — Path matrix: global parser, lock and rate-limit refusals expensive limiter \| mutation 31 refuses 429 without launching AI or writing rows
- [T0970](#t0970) — Path matrix: global parser, lock and rate-limit refusals expensive limiter \| repeated GET polls do not consume the mutation budget
- [T0971](#t0971) — Path matrix: global parser, lock and rate-limit refusals global API limiter \| request 301 is 429 and every preceding health request succeeds without writes
- [T0972](#t0972) — Path matrix: global parser, lock and rate-limit refusals global JSON parser \| malformed JSON refuses HTTP 400 before any writes
- [T0973](#t0973) — Path matrix: global parser, lock and rate-limit refusals global JSON parser \| oversized JSON refuses HTTP 413 before any writes
- [T0974](#t0974) — Path matrix: global parser, lock and rate-limit refusals global error \| database sent-lock code is normalized to HTTP 409 and SENT_INVOICE_LOCKED
- [T0975](#t0975) — Path matrix: global parser, lock and rate-limit refusals global error \| production presentation hides internal database text and preserves rows

## Routes

“Branches” lists every statically reachable explicit handler/service failure site, plus shared request wrappers; see each B entry for its message and proof or specific unreachable reason. Guard test titles spell out the route and asserted 401/403. Both health aliases are listed independently.

### /auth

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r107"></a>**R107** `POST /auth/google` | HTTP 200 / JSON 200: [T0842](#t0842) | Public/session contract; see branch proof | [B011](#b011), [B012](#b012), [B120](#b120), [B121](#b121), [B122](#b122), [B123](#b123), [B124](#b124), [B125](#b125), [B871](#b871), [B872](#b872) |
| <a id="r108"></a>**R108** `POST /auth/logout` | HTTP 200 / JSON 200: [T0120](#t0120) | Public/session contract; see branch proof | [B011](#b011), [B012](#b012), [B871](#b871), [B872](#b872) |
| <a id="r109"></a>**R109** `POST /auth/renew` | HTTP 200 / JSON 200: [T0121](#t0121) | [T0663](#t0663) | [B011](#b011), [B012](#b012), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B871](#b871), [B872](#b872) |

### /customer

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r002"></a>**R002** `DELETE /customer/deleteCustomer/:customerID/:accountID/:userID` | HTTP 200 / JSON 200: [T1034](#t1034) | [T0373](#t0373), [T0374](#t0374), [T0375](#t0375) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B217](#b217), [B218](#b218), [B219](#b219), [B220](#b220), [B221](#b221), [B365](#b365), [B366](#b366), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r052"></a>**R052** `GET /customer/activeCustomers/:accountID/:userID` | HTTP 200 / JSON 200: [T0103](#t0103) | [T0517](#t0517), [T0518](#t0518), [T0519](#t0519) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B222](#b222), [B223](#b223), [B366](#b366), [B893](#b893) |
| <a id="r053"></a>**R053** `GET /customer/activeCustomers/customerByID/:accountID/:userID/:customerID` | HTTP 200 / JSON 200: [T0105](#t0105) | [T0520](#t0520), [T0521](#t0521), [T0522](#t0522) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B207](#b207), [B208](#b208), [B209](#b209), [B366](#b366), [B887](#b887) |
| <a id="r054"></a>**R054** `GET /customer/statement/:accountID/:userID/:customerID` | HTTP 200: [T0188](#t0188) | [T0523](#t0523), [T0524](#t0524), [T0525](#t0525) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B210](#b210), [B211](#b211), [B224](#b224), [B249](#b249), [B366](#b366) |
| <a id="r112"></a>**R112** `POST /customer/createCustomer/:accountID/:userID` | HTTP 200 / JSON 200: [T0368](#t0368) | [T0670](#t0670), [T0671](#t0671), [T0672](#t0672) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B201](#b201), [B202](#b202), [B203](#b203), [B204](#b204), [B205](#b205), [B206](#b206), [B366](#b366), [B407](#b407), [B408](#b408), [B530](#b530), [B531](#b531), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r144"></a>**R144** `PUT /customer/updateCustomer/:accountID/:userID` | HTTP 200 / JSON 200: [T0132](#t0132) | [T0762](#t0762), [T0763](#t0763), [T0764](#t0764) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B212](#b212), [B213](#b213), [B214](#b214), [B215](#b215), [B216](#b216), [B366](#b366), [B407](#b407), [B408](#b408), [B530](#b530), [B531](#b531), [B871](#b871), [B872](#b872), [B873](#b873), [B895](#b895) |

### /jobs

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r005"></a>**R005** `DELETE /jobs/deleteJob/:jobID/:accountID/:userID` | HTTP 200 / JSON 200: [T0213](#t0213) | [T0385](#t0385), [T0386](#t0386), [T0387](#t0387) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B370](#b370), [B371](#b371), [B380](#b380), [B381](#b381), [B382](#b382), [B383](#b383), [B384](#b384), [B385](#b385), [B407](#b407), [B408](#b408), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887) |
| <a id="r066"></a>**R066** `GET /jobs/getActiveCustomerJobs/:accountID/:userID/:customerID` | HTTP 200 / JSON 200: [T0225](#t0225) | [T0555](#t0555), [T0556](#t0556), [T0557](#t0557) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B887](#b887) |
| <a id="r067"></a>**R067** `GET /jobs/getSingleJob/:customerJobID/:accountID/:userID` | HTTP 200 / JSON 200: [T0226](#t0226) | [T0558](#t0558), [T0559](#t0559), [T0560](#t0560) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B887](#b887) |
| <a id="r121"></a>**R121** `POST /jobs/createJob/:accountID/:userID` | HTTP 200 / JSON 200: [T0226](#t0226) | [T0700](#t0700), [T0701](#t0701), [T0702](#t0702) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B372](#b372), [B373](#b373), [B374](#b374), [B407](#b407), [B408](#b408), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887), [B895](#b895) |
| <a id="r146"></a>**R146** `PUT /jobs/updateJob/:accountID/:userID` | HTTP 200 / JSON 200: [T0243](#t0243) | [T0771](#t0771), [T0772](#t0772), [T0773](#t0773) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B370](#b370), [B371](#b371), [B375](#b375), [B376](#b376), [B377](#b377), [B378](#b378), [B379](#b379), [B407](#b407), [B408](#b408), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887), [B895](#b895) |

### /transactions

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r015"></a>**R015** `DELETE /transactions/deleteTransaction/:accountID/:userID` | HTTP 200 / JSON 200: [T0343](#t0343) | [T0412](#t0412), [T0413](#t0413), [T0414](#t0414) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B411](#b411), [B412](#b412), [B413](#b413), [B414](#b414), [B415](#b415), [B745](#b745), [B746](#b746), [B749](#b749), [B750](#b750), [B752](#b752), [B753](#b753), [B754](#b754), [B755](#b755), [B756](#b756), [B757](#b757), [B758](#b758), [B761](#b761), [B763](#b763), [B764](#b764), [B765](#b765), [B766](#b766), [B767](#b767), [B771](#b771), [B780](#b780), [B781](#b781), [B791](#b791), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887) |
| <a id="r095"></a>**R095** `GET /transactions/exportTransactions/:accountID/:userID` | HTTP 200: [T0349](#t0349) | [T0629](#t0629), [T0630](#t0630), [T0631](#t0631) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B784](#b784), [B785](#b785) |
| <a id="r096"></a>**R096** `GET /transactions/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID` | HTTP 200 / JSON 200: [T0350](#t0350) | [T0632](#t0632), [T0633](#t0633), [T0634](#t0634) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B789](#b789), [B790](#b790), [B873](#b873), [B887](#b887) |
| <a id="r097"></a>**R097** `GET /transactions/getSingleTransaction/:customerID/:transactionID/:accountID/:userID` | HTTP 200 / JSON 200: [T0351](#t0351) | [T0635](#t0635), [T0636](#t0636), [T0637](#t0637) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B786](#b786), [B787](#b787), [B788](#b788) |
| <a id="r098"></a>**R098** `GET /transactions/getTransactions/:accountID/:userID` | HTTP 200 / JSON 200: [T0352](#t0352) | [T0638](#t0638), [T0639](#t0639), [T0640](#t0640) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B782](#b782), [B783](#b783), [B893](#b893) |
| <a id="r136"></a>**R136** `POST /transactions/createTransaction/:accountID/:userID` | HTTP 200 / JSON 200: [T0343](#t0343) | [T0739](#t0739), [T0740](#t0740), [T0741](#t0741) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B225](#b225), [B227](#b227), [B228](#b228), [B229](#b229), [B230](#b230), [B366](#b366), [B407](#b407), [B408](#b408), [B743](#b743), [B744](#b744), [B745](#b745), [B746](#b746), [B747](#b747), [B748](#b748), [B761](#b761), [B768](#b768), [B772](#b772), [B773](#b773), [B774](#b774), [B775](#b775), [B776](#b776), [B777](#b777), [B791](#b791), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887), [B895](#b895) |
| <a id="r157"></a>**R157** `PUT /transactions/updateTransaction/:accountID/:userID` | HTTP 200 / JSON 200: [T0364](#t0364) | [T0797](#t0797), [T0798](#t0798), [T0799](#t0799) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B411](#b411), [B412](#b412), [B413](#b413), [B414](#b414), [B415](#b415), [B743](#b743), [B744](#b744), [B745](#b745), [B746](#b746), [B747](#b747), [B748](#b748), [B749](#b749), [B750](#b750), [B752](#b752), [B753](#b753), [B754](#b754), [B755](#b755), [B756](#b756), [B757](#b757), [B758](#b758), [B759](#b759), [B761](#b761), [B762](#b762), [B763](#b763), [B764](#b764), [B765](#b765), [B766](#b766), [B767](#b767), [B769](#b769), [B770](#b770), [B772](#b772), [B773](#b773), [B774](#b774), [B775](#b775), [B778](#b778), [B779](#b779), [B791](#b791), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887), [B895](#b895) |

### /user

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r016"></a>**R016** `DELETE /user/deleteUser/:accountID/:userID` | HTTP 200 / JSON 200: [T0337](#t0337) | [T0415](#t0415), [T0416](#t0416), [T0417](#t0417) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B792](#b792), [B799](#b799), [B800](#b800), [B801](#b801), [B802](#b802), [B803](#b803), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r099"></a>**R099** `GET /user/fetchSingleUser/:accountID/:userID` | HTTP 200 / JSON 200: [T0114](#t0114) | [T0641](#t0641), [T0642](#t0642) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B804](#b804) |
| <a id="r137"></a>**R137** `POST /user/createUser/:accountID/:userID` | HTTP 200 / JSON 200: [T0125](#t0125) | [T0742](#t0742), [T0743](#t0743), [T0744](#t0744) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B793](#b793), [B794](#b794), [B805](#b805), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r158"></a>**R158** `PUT /user/updateUser/:accountID/:userID` | HTTP 200 / JSON 200: [T0139](#t0139) | [T0800](#t0800), [T0801](#t0801), [T0802](#t0802) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B792](#b792), [B795](#b795), [B796](#b796), [B797](#b797), [B798](#b798), [B805](#b805), [B806](#b806), [B871](#b871), [B872](#b872), [B873](#b873) |

### /invoices

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r003"></a>**R003** `DELETE /invoices/deleteInvoice/:accountID/:invoiceID` | HTTP 200 / JSON 200: [T0165](#t0165) | [T0376](#t0376), [T0377](#t0377), [T0378](#t0378) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B285](#b285), [B286](#b286), [B287](#b287), [B288](#b288), [B289](#b289), [B290](#b290), [B291](#b291), [B292](#b292), [B293](#b293), [B294](#b294), [B295](#b295), [B296](#b296), [B365](#b365), [B366](#b366), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887) |
| <a id="r059"></a>**R059** `GET /invoices/:invoiceID/history/:accountID/:userID` | HTTP 200 / JSON 200: [T1191](#t1191) | [T0531](#t0531), [T0532](#t0532), [T0533](#t0533) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B316](#b316), [B317](#b317), [B344](#b344), [B349](#b349), [B366](#b366) |
| <a id="r060"></a>**R060** `GET /invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID` | HTTP 200 / JSON 200: [T0190](#t0190) | [T0534](#t0534), [T0535](#t0535), [T0536](#t0536) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B249](#b249), [B253](#b253), [B254](#b254), [B255](#b255), [B256](#b256), [B257](#b257), [B258](#b258), [B259](#b259), [B260](#b260), [B261](#b261), [B262](#b262), [B263](#b263), [B264](#b264), [B265](#b265), [B266](#b266), [B267](#b267), [B268](#b268), [B269](#b269), [B270](#b270), [B271](#b271), [B272](#b272), [B273](#b273), [B274](#b274), [B275](#b275), [B276](#b276), [B277](#b277), [B297](#b297), [B298](#b298), [B299](#b299), [B366](#b366) |
| <a id="r061"></a>**R061** `GET /invoices/downloadFile/:accountID/:userID` | HTTP 200: [T0191](#t0191) | [T0537](#t0537), [T0538](#t0538), [T0539](#t0539) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B304](#b304), [B305](#b305), [B306](#b306), [B307](#b307), [B308](#b308), [B309](#b309), [B310](#b310), [B311](#b311), [B312](#b312), [B366](#b366) |
| <a id="r062"></a>**R062** `GET /invoices/getInvoiceDetails/:invoiceID/:accountID/:userID` | HTTP 200 / JSON 200: [T0195](#t0195) | [T0540](#t0540), [T0541](#t0541), [T0542](#t0542) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B313](#b313), [B349](#b349), [B366](#b366), [B887](#b887) |
| <a id="r063"></a>**R063** `GET /invoices/getInvoices/:accountID/:invoiceID` | HTTP 200 / JSON 200: [T0196](#t0196) | [T0543](#t0543), [T0544](#t0544), [T0545](#t0545) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B887](#b887) |
| <a id="r064"></a>**R064** `GET /invoices/getInvoicesPaginated/:accountID/:userID` | HTTP 200 / JSON 200: [T0198](#t0198) | [T0546](#t0546), [T0547](#t0547), [T0548](#t0548) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B314](#b314), [B315](#b315), [B366](#b366), [B893](#b893) |
| <a id="r116"></a>**R116** `POST /invoices/:invoiceID/exceptions/:accountID/:userID` | HTTP 200 / JSON 200: [T1186](#t1186) | [T0682](#t0682), [T0683](#t0683), [T0684](#t0684) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B316](#b316), [B317](#b317), [B344](#b344), [B345](#b345), [B346](#b346), [B347](#b347), [B348](#b348), [B349](#b349), [B350](#b350), [B351](#b351), [B352](#b352), [B353](#b353), [B354](#b354), [B355](#b355), [B356](#b356), [B366](#b366), [B407](#b407), [B408](#b408), [B871](#b871), [B872](#b872) |
| <a id="r117"></a>**R117** `POST /invoices/:invoiceID/exceptions/:exceptionID/resolve/:accountID/:userID` | HTTP 200 / JSON 200: [T1184](#t1184) | [T0685](#t0685), [T0686](#t0686), [T0687](#t0687) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B316](#b316), [B317](#b317), [B344](#b344), [B345](#b345), [B346](#b346), [B347](#b347), [B348](#b348), [B357](#b357), [B358](#b358), [B359](#b359), [B360](#b360), [B361](#b361), [B362](#b362), [B363](#b363), [B364](#b364), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B409](#b409), [B410](#b410), [B416](#b416), [B434](#b434), [B437](#b437), [B451](#b451), [B452](#b452), [B453](#b453), [B454](#b454), [B455](#b455), [B456](#b456), [B457](#b457), [B458](#b458), [B459](#b459), [B848](#b848), [B849](#b849), [B850](#b850), [B851](#b851), [B871](#b871), [B872](#b872) |
| <a id="r118"></a>**R118** `POST /invoices/:invoiceID/exceptions/:exceptionID/reverse/:accountID/:userID` | HTTP 200 / JSON 200: [T1170](#t1170) | [T0688](#t0688), [T0689](#t0689), [T0690](#t0690) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B316](#b316), [B317](#b317), [B344](#b344), [B345](#b345), [B346](#b346), [B347](#b347), [B348](#b348), [B357](#b357), [B358](#b358), [B359](#b359), [B360](#b360), [B361](#b361), [B362](#b362), [B363](#b363), [B364](#b364), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B409](#b409), [B410](#b410), [B416](#b416), [B434](#b434), [B437](#b437), [B451](#b451), [B452](#b452), [B453](#b453), [B454](#b454), [B455](#b455), [B456](#b456), [B457](#b457), [B458](#b458), [B459](#b459), [B848](#b848), [B849](#b849), [B850](#b850), [B851](#b851), [B871](#b871), [B872](#b872) |
| <a id="r119"></a>**R119** `POST /invoices/createInvoice/:accountID/:userID` | HTTP 200 / JSON 200: [T0203](#t0203) | [T0691](#t0691), [T0692](#t0692), [T0693](#t0693) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B249](#b249), [B250](#b250), [B251](#b251), [B252](#b252), [B253](#b253), [B254](#b254), [B255](#b255), [B256](#b256), [B257](#b257), [B258](#b258), [B259](#b259), [B260](#b260), [B261](#b261), [B262](#b262), [B263](#b263), [B264](#b264), [B265](#b265), [B266](#b266), [B267](#b267), [B268](#b268), [B269](#b269), [B270](#b270), [B271](#b271), [B272](#b272), [B273](#b273), [B274](#b274), [B275](#b275), [B276](#b276), [B277](#b277), [B278](#b278), [B279](#b279), [B280](#b280), [B281](#b281), [B282](#b282), [B283](#b283), [B284](#b284), [B300](#b300), [B301](#b301), [B302](#b302), [B303](#b303), [B318](#b318), [B319](#b319), [B320](#b320), [B321](#b321), [B322](#b322), [B323](#b323), [B324](#b324), [B325](#b325), [B326](#b326), [B327](#b327), [B328](#b328), [B329](#b329), [B330](#b330), [B331](#b331), [B332](#b332), [B333](#b333), [B334](#b334), [B335](#b335), [B336](#b336), [B337](#b337), [B366](#b366), [B367](#b367), [B368](#b368), [B369](#b369), [B847](#b847), [B848](#b848), [B849](#b849), [B850](#b850), [B851](#b851), [B871](#b871), [B872](#b872), [B875](#b875), [B876](#b876), [B887](#b887), [B889](#b889) |

### /jobCategories

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r004"></a>**R004** `DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID` | HTTP 200 / JSON 200: [T0205](#t0205) | [T0379](#t0379), [T0380](#t0380), [T0381](#t0381) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B391](#b391), [B392](#b392), [B393](#b393), [B394](#b394), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r065"></a>**R065** `GET /jobCategories/getSingleJobCategory/:jobCategoryID/:accountID/:userID` | HTTP 200 / JSON 200: [T0223](#t0223) | [T0549](#t0549), [T0550](#t0550), [T0551](#t0551) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r120"></a>**R120** `POST /jobCategories/createJobCategory/:accountID/:userID` | HTTP 200 / JSON 200: [T0236](#t0236) | [T0694](#t0694), [T0695](#t0695), [T0696](#t0696) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B386](#b386), [B387](#b387), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r145"></a>**R145** `PUT /jobCategories/updateJobCategory/:accountID/:userID` | HTTP 200 / JSON 200: [T0236](#t0236) | [T0765](#t0765), [T0766](#t0766), [T0767](#t0767) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B388](#b388), [B389](#b389), [B390](#b390), [B871](#b871), [B872](#b872), [B873](#b873) |

### /account

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r019"></a>**R019** `GET /account/AccountInformation/:accountID/:userID` | HTTP 200 / JSON 200: [T0100](#t0100) | [T0424](#t0424), [T0425](#t0425), [T0426](#t0426) | [B011](#b011), [B012](#b012), [B018](#b018), [B022](#b022), [B023](#b023), [B024](#b024), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r020"></a>**R020** `GET /account/automations/:accountID/:userID` | HTTP 200 / JSON 200: [T0101](#t0101) | [T0427](#t0427), [T0428](#t0428), [T0429](#t0429) | [B011](#b011), [B012](#b012), [B025](#b025), [B026](#b026), [B027](#b027), [B039](#b039), [B040](#b040), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r103"></a>**R103** `POST /account/createAccount` | HTTP 200 / JSON 200: [T0116](#t0116) | [T0652](#t0652), [T0653](#t0653) | [B011](#b011), [B012](#b012), [B036](#b036), [B037](#b037), [B038](#b038), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B871](#b871), [B872](#b872) |
| <a id="r140"></a>**R140** `PUT /account/automations/:accountID/:userID` | HTTP 200 / JSON 200: [T0127](#t0127) | [T0751](#t0751), [T0752](#t0752), [T0753](#t0753) | [B011](#b011), [B012](#b012), [B028](#b028), [B029](#b029), [B030](#b030), [B031](#b031), [B032](#b032), [B033](#b033), [B034](#b034), [B035](#b035), [B039](#b039), [B040](#b040), [B041](#b041), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B871](#b871), [B872](#b872) |
| <a id="r141"></a>**R141** `PUT /account/updateAccount` | HTTP 200 / JSON 200: [T0129](#t0129) | [T0754](#t0754), [T0755](#t0755) | [B011](#b011), [B012](#b012), [B019](#b019), [B020](#b020), [B021](#b021), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B871](#b871), [B872](#b872) |

### /jobTypes

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r006"></a>**R006** `DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID` | HTTP 200 / JSON 200: [T0209](#t0209) | [T0382](#t0382), [T0383](#t0383), [T0384](#t0384) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B401](#b401), [B402](#b402), [B403](#b403), [B404](#b404), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r068"></a>**R068** `GET /jobTypes/getSingleJobType/:jobTypeID/:accountID/:userID` | HTTP 200 / JSON 200: [T0224](#t0224) | [T0552](#t0552), [T0553](#t0553), [T0554](#t0554) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r122"></a>**R122** `POST /jobTypes/createJobType/:accountID/:userID` | HTTP 200 / JSON 200: [T0240](#t0240) | [T0697](#t0697), [T0698](#t0698), [T0699](#t0699) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B395](#b395), [B396](#b396), [B871](#b871), [B872](#b872), [B873](#b873), [B895](#b895) |
| <a id="r147"></a>**R147** `PUT /jobTypes/updateJobType/:accountID/:userID` | HTTP 200 / JSON 200: [T0240](#t0240) | [T0768](#t0768), [T0769](#t0769), [T0770](#t0770) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B397](#b397), [B398](#b398), [B399](#b399), [B400](#b400), [B871](#b871), [B872](#b872), [B873](#b873), [B895](#b895) |

### /quotes

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r009"></a>**R009** `DELETE /quotes/deleteQuote/:accountID/:quoteID` | HTTP 200 / JSON 200: [T0217](#t0217) | [T0394](#t0394), [T0395](#t0395), [T0396](#t0396) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B525](#b525), [B526](#b526), [B527](#b527), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r078"></a>**R078** `GET /quotes/getActiveQuotes/:accountID/:quoteID` | HTTP 200 / JSON 200: [T0227](#t0227) | [T0586](#t0586), [T0587](#t0587), [T0588](#t0588) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B520](#b520), [B521](#b521) |
| <a id="r127"></a>**R127** `POST /quotes/createQuote` | HTTP 200 / JSON 200: [T0245](#t0245) | [T0715](#t0715), [T0716](#t0716) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B518](#b518), [B519](#b519), [B871](#b871), [B872](#b872), [B873](#b873), [B895](#b895), [B896](#b896) |
| <a id="r153"></a>**R153** `PUT /quotes/updateQuote` | HTTP 200 / JSON 200: [T0245](#t0245) | [T0787](#t0787), [T0788](#t0788) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B522](#b522), [B523](#b523), [B524](#b524), [B871](#b871), [B872](#b872), [B873](#b873), [B895](#b895), [B896](#b896) |

### /payments

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r007"></a>**R007** `DELETE /payments/deletePayment/:accountID/:userID` | HTTP 200 / JSON 200: [T0252](#t0252) | [T0388](#t0388), [T0389](#t0389), [T0390](#t0390) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B409](#b409), [B410](#b410), [B411](#b411), [B412](#b412), [B413](#b413), [B414](#b414), [B415](#b415), [B418](#b418), [B419](#b419), [B420](#b420), [B421](#b421), [B431](#b431), [B432](#b432), [B433](#b433), [B434](#b434), [B435](#b435), [B436](#b436), [B438](#b438), [B439](#b439), [B440](#b440), [B468](#b468), [B469](#b469), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887) |
| <a id="r071"></a>**R071** `GET /payments/getPayments/:accountID/:userID` | HTTP 200 / JSON 200: [T0257](#t0257) | [T0565](#t0565), [T0566](#t0566), [T0567](#t0567) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B470](#b470), [B471](#b471), [B893](#b893) |
| <a id="r072"></a>**R072** `GET /payments/getSinglePayment/:paymentID/:accountID/:userID` | HTTP 200 / JSON 200: [T0259](#t0259) | [T0568](#t0568), [T0569](#t0569), [T0570](#t0570) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B464](#b464), [B465](#b465) |
| <a id="r123"></a>**R123** `POST /payments/createPayment/:accountID/:userID` | HTTP 200 / JSON 200: [T0284](#t0284) | [T0703](#t0703), [T0704](#t0704), [T0705](#t0705) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B225](#b225), [B227](#b227), [B228](#b228), [B229](#b229), [B230](#b230), [B366](#b366), [B407](#b407), [B408](#b408), [B416](#b416), [B417](#b417), [B422](#b422), [B423](#b423), [B424](#b424), [B425](#b425), [B426](#b426), [B427](#b427), [B428](#b428), [B429](#b429), [B430](#b430), [B460](#b460), [B461](#b461), [B543](#b543), [B544](#b544), [B545](#b545), [B546](#b546), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887), [B892](#b892) |
| <a id="r124"></a>**R124** `POST /payments/reversePayment/:accountID/:userID` | HTTP 200 / JSON 200: [T0272](#t0272) | [T0706](#t0706), [T0707](#t0707), [T0708](#t0708) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B409](#b409), [B410](#b410), [B416](#b416), [B434](#b434), [B437](#b437), [B451](#b451), [B452](#b452), [B453](#b453), [B454](#b454), [B455](#b455), [B456](#b456), [B457](#b457), [B458](#b458), [B459](#b459), [B462](#b462), [B463](#b463), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887) |
| <a id="r150"></a>**R150** `PUT /payments/updatePayment/:accountID/:userID` | HTTP 200 / JSON 200: [T0288](#t0288) | [T0778](#t0778), [T0779](#t0779), [T0780](#t0780) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B409](#b409), [B410](#b410), [B411](#b411), [B412](#b412), [B413](#b413), [B414](#b414), [B415](#b415), [B418](#b418), [B419](#b419), [B420](#b420), [B421](#b421), [B422](#b422), [B431](#b431), [B432](#b432), [B433](#b433), [B441](#b441), [B442](#b442), [B443](#b443), [B444](#b444), [B445](#b445), [B446](#b446), [B447](#b447), [B448](#b448), [B449](#b449), [B450](#b450), [B466](#b466), [B467](#b467), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887), [B892](#b892) |

### /recurringCustomer

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r010"></a>**R010** `DELETE /recurringCustomer/deleteRecurringCustomer/:accountID/:recurringCustomerId` | HTTP 200 / JSON 200: [T0097](#t0097) | [T0397](#t0397), [T0398](#t0398), [T0399](#t0399) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B407](#b407), [B408](#b408), [B529](#b529), [B530](#b530), [B531](#b531), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r079"></a>**R079** `GET /recurringCustomer/getActiveRecurringCustomers/:accountID/:userID` | HTTP 200 / JSON 200: [T0112](#t0112) | [T0589](#t0589), [T0590](#t0590), [T0591](#t0591) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366) |
| <a id="r128"></a>**R128** `POST /recurringCustomer/createRecurringCustomer/:accountID/:userID` | HTTP 200 / JSON 200: [T0122](#t0122) | [T0717](#t0717), [T0718](#t0718), [T0719](#t0719) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B407](#b407), [B408](#b408), [B530](#b530), [B531](#b531), [B871](#b871), [B872](#b872), [B873](#b873), [B895](#b895) |
| <a id="r154"></a>**R154** `PUT /recurringCustomer/updateRecurringCustomer` | HTTP 200 / JSON 200: [T0136](#t0136) | [T0789](#t0789), [T0790](#t0790) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B407](#b407), [B408](#b408), [B528](#b528), [B530](#b530), [B531](#b531), [B871](#b871), [B872](#b872), [B873](#b873), [B895](#b895) |

### /duplicates

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r055"></a>**R055** `GET /duplicates/:accountID/:userID` | HTTP 200 / JSON 200: [T1209](#t1209) | [T0526](#t0526), [T0527](#t0527), [T0528](#t0528) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B235](#b235), [B236](#b236), [B366](#b366), [B888](#b888), [B890](#b890), [B891](#b891) |
| <a id="r113"></a>**R113** `POST /duplicates/:accountID/:userID` | HTTP 200 / JSON 200: [T1229](#t1229) | [T0673](#t0673), [T0674](#t0674), [T0675](#t0675) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B225](#b225), [B226](#b226), [B227](#b227), [B228](#b228), [B229](#b229), [B230](#b230), [B231](#b231), [B232](#b232), [B233](#b233), [B366](#b366), [B407](#b407), [B408](#b408), [B871](#b871), [B872](#b872), [B888](#b888), [B889](#b889), [B890](#b890), [B891](#b891) |
| <a id="r114"></a>**R114** `POST /duplicates/:duplicateID/resolve/:accountID/:userID` | HTTP 200 / JSON 200: [T1229](#t1229) | [T0676](#t0676), [T0677](#t0677), [T0678](#t0678) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B225](#b225), [B226](#b226), [B227](#b227), [B237](#b237), [B238](#b238), [B239](#b239), [B240](#b240), [B241](#b241), [B242](#b242), [B243](#b243), [B244](#b244), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B409](#b409), [B410](#b410), [B411](#b411), [B412](#b412), [B413](#b413), [B414](#b414), [B415](#b415), [B418](#b418), [B419](#b419), [B420](#b420), [B421](#b421), [B431](#b431), [B432](#b432), [B433](#b433), [B434](#b434), [B435](#b435), [B436](#b436), [B438](#b438), [B439](#b439), [B440](#b440), [B554](#b554), [B555](#b555), [B556](#b556), [B557](#b557), [B558](#b558), [B559](#b559), [B560](#b560), [B745](#b745), [B746](#b746), [B749](#b749), [B750](#b750), [B752](#b752), [B753](#b753), [B754](#b754), [B755](#b755), [B756](#b756), [B757](#b757), [B758](#b758), [B761](#b761), [B763](#b763), [B764](#b764), [B765](#b765), [B766](#b766), [B767](#b767), [B771](#b771), [B791](#b791), [B818](#b818), [B819](#b819), [B821](#b821), [B871](#b871), [B872](#b872), [B888](#b888), [B889](#b889), [B890](#b890), [B891](#b891) |
| <a id="r115"></a>**R115** `POST /duplicates/scan/:accountID/:userID` | HTTP 200 / JSON 200: [T1209](#t1209) | [T0679](#t0679), [T0680](#t0680), [T0681](#t0681) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B225](#b225), [B227](#b227), [B228](#b228), [B229](#b229), [B230](#b230), [B234](#b234), [B366](#b366), [B407](#b407), [B408](#b408), [B871](#b871), [B872](#b872), [B888](#b888), [B889](#b889), [B890](#b890), [B891](#b891) |

### /retainers

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r011"></a>**R011** `DELETE /retainers/deleteRetainer/:retainerID/:accountID/:userID` | HTTP 200 / JSON 200: [T0341](#t0341) | [T0400](#t0400), [T0401](#t0401), [T0402](#t0402) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B409](#b409), [B410](#b410), [B554](#b554), [B555](#b555), [B556](#b556), [B557](#b557), [B558](#b558), [B559](#b559), [B560](#b560), [B565](#b565), [B566](#b566), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887) |
| <a id="r080"></a>**R080** `GET /retainers/:retainerID/events/:accountID/:userID` | HTTP 200 / JSON 200: [T1193](#t1193) | [T0592](#t0592), [T0593](#t0593), [T0594](#t0594) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B407](#b407), [B408](#b408), [B536](#b536), [B537](#b537), [B888](#b888), [B890](#b890), [B891](#b891) |
| <a id="r081"></a>**R081** `GET /retainers/getActiveRetainers/:customerID/:accountID/:userID` | HTTP 200 / JSON 200: [T0346](#t0346) | [T0595](#t0595), [T0596](#t0596), [T0597](#t0597) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B571](#b571), [B572](#b572), [B887](#b887) |
| <a id="r082"></a>**R082** `GET /retainers/getSingleRetainer/:retainerID/:accountID/:userID` | HTTP 200 / JSON 200: [T0347](#t0347) | [T0598](#t0598), [T0599](#t0599), [T0600](#t0600) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B567](#b567), [B568](#b568), [B569](#b569), [B570](#b570), [B887](#b887) |
| <a id="r129"></a>**R129** `POST /retainers/:retainerID/events/:accountID/:userID` | HTTP 200 / JSON 200: [T1207](#t1207) | [T0720](#t0720), [T0721](#t0721), [T0722](#t0722) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B407](#b407), [B408](#b408), [B532](#b532), [B533](#b533), [B534](#b534), [B535](#b535), [B536](#b536), [B537](#b537), [B538](#b538), [B539](#b539), [B540](#b540), [B541](#b541), [B542](#b542), [B871](#b871), [B872](#b872), [B888](#b888), [B889](#b889), [B890](#b890), [B891](#b891) |
| <a id="r130"></a>**R130** `POST /retainers/createRetainer/:accountID/:userID` | HTTP 200 / JSON 200: [T0358](#t0358) | [T0723](#t0723), [T0724](#t0724), [T0725](#t0725) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B225](#b225), [B227](#b227), [B228](#b228), [B229](#b229), [B230](#b230), [B366](#b366), [B407](#b407), [B408](#b408), [B547](#b547), [B548](#b548), [B561](#b561), [B562](#b562), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887), [B892](#b892) |
| <a id="r155"></a>**R155** `PUT /retainers/updateRetainer/:accountID/:userID` | HTTP 200 / JSON 200: [T0361](#t0361) | [T0791](#t0791), [T0792](#t0792), [T0793](#t0793) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B409](#b409), [B410](#b410), [B549](#b549), [B550](#b550), [B551](#b551), [B552](#b552), [B553](#b553), [B563](#b563), [B564](#b564), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887), [B892](#b892) |

### /writeOffs

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r018"></a>**R018** `DELETE /writeOffs/deleteWriteOffs/:accountID/:userID` | HTTP 200 / JSON 200: [T0345](#t0345) | [T0421](#t0421), [T0422](#t0422), [T0423](#t0423) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B409](#b409), [B410](#b410), [B411](#b411), [B412](#b412), [B818](#b818), [B819](#b819), [B821](#b821), [B843](#b843), [B844](#b844), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887) |
| <a id="r101"></a>**R101** `GET /writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID` | HTTP 200 / JSON 200: [T0354](#t0354) | [T0646](#t0646), [T0647](#t0647), [T0648](#t0648) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B837](#b837), [B838](#b838), [B839](#b839), [B840](#b840) |
| <a id="r102"></a>**R102** `GET /writeOffs/getWriteOffs/:accountID/:userID` | HTTP 200 / JSON 200: [T0356](#t0356) | [T0649](#t0649), [T0650](#t0650), [T0651](#t0651) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B845](#b845), [B846](#b846), [B893](#b893) |
| <a id="r139"></a>**R139** `POST /writeOffs/createWriteOffs/:accountID/:userID` | HTTP 200 / JSON 200: [T0365](#t0365) | [T0748](#t0748), [T0749](#t0749), [T0750](#t0750) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B225](#b225), [B227](#b227), [B228](#b228), [B229](#b229), [B230](#b230), [B366](#b366), [B407](#b407), [B408](#b408), [B416](#b416), [B417](#b417), [B820](#b820), [B822](#b822), [B823](#b823), [B824](#b824), [B825](#b825), [B826](#b826), [B827](#b827), [B828](#b828), [B835](#b835), [B836](#b836), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887), [B892](#b892) |
| <a id="r160"></a>**R160** `PUT /writeOffs/updateWriteOffs/:accountID/:userID` | HTTP 200 / JSON 200: [T0366](#t0366) | [T0806](#t0806), [T0807](#t0807), [T0808](#t0808) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B409](#b409), [B410](#b410), [B411](#b411), [B412](#b412), [B818](#b818), [B819](#b819), [B820](#b820), [B821](#b821), [B829](#b829), [B830](#b830), [B831](#b831), [B832](#b832), [B833](#b833), [B834](#b834), [B841](#b841), [B842](#b842), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887), [B892](#b892) |

### /initialData

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r058"></a>**R058** `GET /initialData/initialBlob/:accountID/:userID` | HTTP 200 / JSON 200: [T0109](#t0109) | [T0529](#t0529), [T0530](#t0530) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B247](#b247), [B248](#b248), [B366](#b366), [B887](#b887) |

### /workDescriptions

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r017"></a>**R017** `DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID` | HTTP 200 / JSON 200: [T0220](#t0220) | [T0418](#t0418), [T0419](#t0419), [T0420](#t0420) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B814](#b814), [B815](#b815), [B816](#b816), [B817](#b817), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r100"></a>**R100** `GET /workDescriptions/getSingleWorkDescription/:workDescriptionID/:accountID/:userID` | HTTP 200 / JSON 200: [T0228](#t0228) | [T0643](#t0643), [T0644](#t0644), [T0645](#t0645) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B809](#b809), [B810](#b810) |
| <a id="r138"></a>**R138** `POST /workDescriptions/createWorkDescription/:accountID/:userID` | HTTP 200 / JSON 200: [T0249](#t0249) | [T0745](#t0745), [T0746](#t0746), [T0747](#t0747) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B807](#b807), [B808](#b808), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r159"></a>**R159** `PUT /workDescriptions/updateWorkDescription/:accountID/:userID` | HTTP 200 / JSON 200: [T0249](#t0249) | [T0803](#t0803), [T0804](#t0804), [T0805](#t0805) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B811](#b811), [B812](#b812), [B813](#b813), [B871](#b871), [B872](#b872), [B873](#b873) |

### /timesheets

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r014"></a>**R014** `DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID` | HTTP 200: [T0305](#t0305) | [T0409](#t0409), [T0410](#t0410), [T0411](#t0411) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B711](#b711), [B736](#b736), [B737](#b737), [B738](#b738), [B739](#b739), [B740](#b740), [B741](#b741), [B871](#b871), [B872](#b872) |
| <a id="r090"></a>**R090** `GET /timesheets/countsByEmployee/:accountID/:userID` | HTTP 200: [T0321](#t0321) | [T0617](#t0617), [T0618](#t0618), [T0619](#t0619) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B711](#b711), [B726](#b726), [B727](#b727), [B742](#b742) |
| <a id="r091"></a>**R091** `GET /timesheets/fetchTimesheetsByMonth/:queryUserID/:accountID/:userID` | HTTP 200: [T0322](#t0322) | [T0620](#t0620), [T0621](#t0621) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B712](#b712), [B713](#b713), [B724](#b724), [B725](#b725), [B893](#b893) |
| <a id="r092"></a>**R092** `GET /timesheets/getAllTimesheetsForEmployeeByUserID/:queryUserID/:accountID/:userID` | HTTP 200: [T0323](#t0323) | [T0622](#t0622), [T0623](#t0623) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B712](#b712), [B713](#b713), [B722](#b722), [B723](#b723), [B893](#b893) |
| <a id="r093"></a>**R093** `GET /timesheets/getTimesheetEntries/:accountID/:userID` | HTTP 200: [T0325](#t0325) | [T0624](#t0624), [T0625](#t0625), [T0626](#t0626) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B711](#b711), [B712](#b712), [B713](#b713), [B714](#b714), [B715](#b715), [B893](#b893) |
| <a id="r094"></a>**R094** `GET /timesheets/getTimesheetEntriesByUserID/:queryUserID/:accountID/:userID` | HTTP 200: [T0326](#t0326) | [T0627](#t0627), [T0628](#t0628) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B712](#b712), [B713](#b713), [B720](#b720), [B721](#b721), [B893](#b893) |
| <a id="r134"></a>**R134** `POST /timesheets/ai/kickoff/:accountID/:userID` | HTTP 202 / JSON 202: [T0328](#t0328) | [T0734](#t0734), [T0735](#t0735) | [B008](#b008), [B009](#b009), [B010](#b010), [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B407](#b407), [B408](#b408), [B666](#b666), [B667](#b667), [B668](#b668), [B669](#b669), [B670](#b670), [B671](#b671), [B672](#b672), [B673](#b673), [B674](#b674), [B675](#b675), [B676](#b676), [B677](#b677), [B678](#b678), [B716](#b716), [B717](#b717), [B718](#b718), [B719](#b719), [B743](#b743), [B744](#b744), [B745](#b745), [B746](#b746), [B747](#b747), [B748](#b748), [B761](#b761), [B768](#b768), [B772](#b772), [B773](#b773), [B774](#b774), [B775](#b775), [B791](#b791), [B871](#b871), [B872](#b872), [B874](#b874), [B895](#b895) |
| <a id="r135"></a>**R135** `POST /timesheets/moveToTransactions/:accountID/:userID` | HTTP 200 / JSON 200: [T0336](#t0336) | [T0736](#t0736), [T0737](#t0737), [T0738](#t0738) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B407](#b407), [B408](#b408), [B711](#b711), [B728](#b728), [B729](#b729), [B730](#b730), [B731](#b731), [B732](#b732), [B733](#b733), [B734](#b734), [B735](#b735), [B743](#b743), [B744](#b744), [B745](#b745), [B746](#b746), [B747](#b747), [B748](#b748), [B761](#b761), [B768](#b768), [B772](#b772), [B773](#b773), [B774](#b774), [B775](#b775), [B791](#b791), [B871](#b871), [B872](#b872), [B895](#b895) |

### /time-tracking

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r013"></a>**R013** `DELETE /time-tracking/template/delete/:accountID/:userID` | HTTP 204: [T0304](#t0304) | [T0406](#t0406), [T0407](#t0407), [T0408](#t0408) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B662](#b662), [B663](#b663), [B664](#b664), [B665](#b665), [B871](#b871), [B872](#b872) |
| <a id="r084"></a>**R084** `GET /time-tracking/download/by-name/:accountID/:userID` | HTTP 200: [T0308](#t0308) | [T0604](#t0604), [T0605](#t0605) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B599](#b599), [B600](#b600), [B601](#b601), [B641](#b641), [B642](#b642), [B643](#b643), [B644](#b644), [B645](#b645), [B646](#b646), [B647](#b647), [B648](#b648), [B649](#b649), [B650](#b650), [B651](#b651) |
| <a id="r085"></a>**R085** `GET /time-tracking/history/:accountID/:userID` | HTTP 200: [T0310](#t0310) | [T0606](#t0606), [T0607](#t0607) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B599](#b599), [B600](#b600), [B601](#b601) |
| <a id="r086"></a>**R086** `GET /time-tracking/history/download/:accountID/:userID` | HTTP 200: [T0313](#t0313) | [T0608](#t0608), [T0609](#t0609) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B599](#b599), [B633](#b633), [B634](#b634), [B635](#b635), [B636](#b636), [B637](#b637), [B638](#b638), [B639](#b639), [B640](#b640) |
| <a id="r087"></a>**R087** `GET /time-tracking/template/latest/:accountID/:userID` | HTTP 200: [T0316](#t0316) | [T0610](#t0610), [T0611](#t0611) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B579](#b579), [B580](#b580), [B581](#b581), [B582](#b582), [B583](#b583), [B584](#b584), [B585](#b585), [B586](#b586), [B587](#b587), [B588](#b588), [B589](#b589), [B590](#b590), [B591](#b591), [B592](#b592), [B593](#b593), [B594](#b594), [B595](#b595), [B596](#b596), [B597](#b597), [B598](#b598), [B652](#b652), [B653](#b653), [B654](#b654), [B655](#b655) |
| <a id="r088"></a>**R088** `GET /time-tracking/template/list/:accountID/:userID` | HTTP 200: [T0318](#t0318) | [T0612](#t0612), [T0613](#t0613), [T0614](#t0614) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B602](#b602) |
| <a id="r089"></a>**R089** `GET /time-tracking/users/:accountID/:userID` | HTTP 200 / JSON 200: [T0319](#t0319) | [T0615](#t0615), [T0616](#t0616) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B599](#b599), [B632](#b632) |
| <a id="r132"></a>**R132** `POST /time-tracking/template/upload/:accountID/:userID` | HTTP 201: [T0302](#t0302) | [T0729](#t0729), [T0730](#t0730), [T0731](#t0731) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B656](#b656), [B657](#b657), [B658](#b658), [B659](#b659), [B660](#b660), [B661](#b661), [B871](#b871), [B872](#b872) |
| <a id="r133"></a>**R133** `POST /time-tracking/upload/:accountID/:userID` | HTTP 201: [T0328](#t0328) | [T0732](#t0732), [T0733](#t0733) | [B008](#b008), [B009](#b009), [B010](#b010), [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B407](#b407), [B408](#b408), [B599](#b599), [B600](#b600), [B603](#b603), [B604](#b604), [B605](#b605), [B606](#b606), [B607](#b607), [B608](#b608), [B609](#b609), [B610](#b610), [B611](#b611), [B612](#b612), [B613](#b613), [B614](#b614), [B615](#b615), [B616](#b616), [B617](#b617), [B618](#b618), [B619](#b619), [B620](#b620), [B621](#b621), [B622](#b622), [B623](#b623), [B624](#b624), [B625](#b625), [B626](#b626), [B627](#b627), [B628](#b628), [B629](#b629), [B630](#b630), [B631](#b631), [B666](#b666), [B667](#b667), [B668](#b668), [B669](#b669), [B670](#b670), [B671](#b671), [B672](#b672), [B673](#b673), [B674](#b674), [B675](#b675), [B676](#b676), [B677](#b677), [B678](#b678), [B684](#b684), [B685](#b685), [B686](#b686), [B687](#b687), [B688](#b688), [B689](#b689), [B690](#b690), [B691](#b691), [B692](#b692), [B693](#b693), [B694](#b694), [B695](#b695), [B696](#b696), [B697](#b697), [B698](#b698), [B699](#b699), [B700](#b700), [B701](#b701), [B702](#b702), [B703](#b703), [B704](#b704), [B705](#b705), [B706](#b706), [B707](#b707), [B708](#b708), [B709](#b709), [B710](#b710), [B743](#b743), [B744](#b744), [B745](#b745), [B746](#b746), [B747](#b747), [B748](#b748), [B761](#b761), [B768](#b768), [B772](#b772), [B773](#b773), [B774](#b774), [B775](#b775), [B791](#b791), [B855](#b855), [B856](#b856), [B857](#b857), [B858](#b858), [B859](#b859), [B860](#b860), [B861](#b861), [B862](#b862), [B863](#b863), [B864](#b864), [B865](#b865), [B866](#b866), [B867](#b867), [B868](#b868), [B869](#b869), [B870](#b870), [B871](#b871), [B872](#b872), [B874](#b874), [B880](#b880), [B881](#b881), [B882](#b882), [B883](#b883), [B884](#b884), [B885](#b885), [B886](#b886), [B895](#b895) |

### /time-tracker-staff

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r012"></a>**R012** `DELETE /time-tracker-staff/:accountID/:userID/:staffID` | HTTP 200: [T0099](#t0099) | [T0403](#t0403), [T0404](#t0404), [T0405](#t0405) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B578](#b578), [B871](#b871), [B872](#b872) |
| <a id="r083"></a>**R083** `GET /time-tracker-staff/:accountID/:userID` | HTTP 200: [T0113](#t0113) | [T0601](#t0601), [T0602](#t0602), [T0603](#t0603) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B573](#b573) |
| <a id="r131"></a>**R131** `POST /time-tracker-staff/:accountID/:userID` | HTTP 201: [T0123](#t0123) | [T0726](#t0726), [T0727](#t0727), [T0728](#t0728) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B574](#b574), [B575](#b575), [B871](#b871), [B872](#b872) |
| <a id="r156"></a>**R156** `PUT /time-tracker-staff/:accountID/:userID/:staffID` | HTTP 200: [T0137](#t0137) | [T0794](#t0794), [T0795](#t0795), [T0796](#t0796) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B576](#b576), [B577](#b577), [B871](#b871), [B872](#b872) |

### /api/health

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r038"></a>**R038** `GET /api/health/` | HTTP 200 / JSON ok: [T0828](#t0828) | Public/session contract; see branch proof | [B011](#b011), [B012](#b012) |
| <a id="r039"></a>**R039** `GET /api/health/check` | HTTP 200 / JSON ok: [T0102](#t0102) | Public/session contract; see branch proof | [B011](#b011), [B012](#b012), [B245](#b245), [B246](#b246) |

### /healthz

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r056"></a>**R056** `GET /healthz/` | HTTP 200 / JSON ok: [T0107](#t0107) | Public/session contract; see branch proof | [B011](#b011), [B012](#b012) |
| <a id="r057"></a>**R057** `GET /healthz/check` | HTTP 200 / JSON ok: [T0108](#t0108) | Public/session contract; see branch proof | [B011](#b011), [B012](#b012), [B245](#b245), [B246](#b246) |

### /ai-integration

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r001"></a>**R001** `ALL /ai-integration/*` | HTTP 410 (retired): [T0840](#t0840) | [T0372](#t0372) | [B011](#b011), [B012](#b012), [B073](#b073), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |

### /pending-payments

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r008"></a>**R008** `DELETE /pending-payments/file/:accountID/:userID` | HTTP 200 / JSON 200: [T0255](#t0255) | [T0391](#t0391), [T0392](#t0392), [T0393](#t0393) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B505](#b505), [B506](#b506), [B507](#b507), [B508](#b508), [B509](#b509), [B510](#b510), [B511](#b511), [B871](#b871), [B872](#b872), [B873](#b873) |
| <a id="r073"></a>**R073** `GET /pending-payments/counts/:accountID/:userID` | HTTP 200 / JSON 200: [T0260](#t0260) | [T0571](#t0571), [T0572](#t0572), [T0573](#t0573) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B481](#b481), [B482](#b482) |
| <a id="r074"></a>**R074** `GET /pending-payments/file-preview/:accountID/:userID` | HTTP 200: [T0261](#t0261) | [T0574](#t0574), [T0575](#t0575), [T0576](#t0576) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B512](#b512), [B513](#b513), [B514](#b514), [B515](#b515), [B516](#b516), [B517](#b517) |
| <a id="r075"></a>**R075** `GET /pending-payments/files/:accountID/:userID` | HTTP 200 / JSON 200: [T0264](#t0264) | [T0577](#t0577), [T0578](#t0578), [T0579](#t0579) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B503](#b503), [B504](#b504) |
| <a id="r076"></a>**R076** `GET /pending-payments/list/:accountID/:userID` | HTTP 200 / JSON 200: [T0265](#t0265) | [T0580](#t0580), [T0581](#t0581), [T0582](#t0582) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B479](#b479), [B480](#b480), [B893](#b893) |
| <a id="r077"></a>**R077** `GET /pending-payments/single/:paymentID/:accountID/:userID` | HTTP 200 / JSON 200: [T0267](#t0267) | [T0583](#t0583), [T0584](#t0584), [T0585](#t0585) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B472](#b472), [B473](#b473), [B478](#b478), [B483](#b483) |
| <a id="r125"></a>**R125** `POST /pending-payments/approve/:accountID/:userID` | HTTP 200 / JSON 200: [T0275](#t0275) | [T0709](#t0709), [T0710](#t0710), [T0711](#t0711) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B407](#b407), [B408](#b408), [B416](#b416), [B417](#b417), [B422](#b422), [B423](#b423), [B424](#b424), [B425](#b425), [B426](#b426), [B427](#b427), [B428](#b428), [B429](#b429), [B430](#b430), [B474](#b474), [B475](#b475), [B486](#b486), [B487](#b487), [B488](#b488), [B489](#b489), [B490](#b490), [B491](#b491), [B492](#b492), [B493](#b493), [B543](#b543), [B544](#b544), [B545](#b545), [B546](#b546), [B871](#b871), [B872](#b872), [B873](#b873), [B887](#b887) |
| <a id="r126"></a>**R126** `POST /pending-payments/upload/:accountID/:userID` | HTTP 200 / JSON 200: [T0300](#t0300) | [T0712](#t0712), [T0713](#t0713), [T0714](#t0714) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B495](#b495), [B496](#b496), [B497](#b497), [B498](#b498), [B499](#b499), [B500](#b500), [B501](#b501), [B502](#b502), [B871](#b871), [B872](#b872) |
| <a id="r151"></a>**R151** `PUT /pending-payments/approve/:paymentID/:accountID/:userID` | HTTP 410 / JSON 410 (retired): [T0289](#t0289) | [T0781](#t0781), [T0782](#t0782), [T0783](#t0783) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B494](#b494), [B871](#b871), [B872](#b872) |
| <a id="r152"></a>**R152** `PUT /pending-payments/soft-delete/:paymentID/:accountID/:userID` | HTTP 200 / JSON 200: [T0264](#t0264) | [T0784](#t0784), [T0785](#t0785), [T0786](#t0786) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B472](#b472), [B473](#b473), [B476](#b476), [B477](#b477), [B478](#b478), [B484](#b484), [B485](#b485), [B871](#b871), [B872](#b872), [B873](#b873) |

### /billing-review

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r046"></a>**R046** `GET /billing-review/distinct-entities/:accountID/:userID` | HTTP 200: [T0141](#t0141) | [T0499](#t0499), [T0500](#t0500), [T0501](#t0501) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r047"></a>**R047** `GET /billing-review/earliest-unbilled-month/:accountID/:userID` | HTTP 200: [T0142](#t0142) | [T0502](#t0502), [T0503](#t0503), [T0504](#t0504) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r048"></a>**R048** `GET /billing-review/pending/:accountID/:userID` | HTTP 200: [T0143](#t0143) | [T0505](#t0505), [T0506](#t0506), [T0507](#t0507) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B135](#b135), [B366](#b366) |
| <a id="r049"></a>**R049** `GET /billing-review/pre-invoice/:accountID/:userID` | HTTP 200: [T0145](#t0145) | [T0508](#t0508), [T0509](#t0509), [T0510](#t0510) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B140](#b140), [B366](#b366) |
| <a id="r050"></a>**R050** `GET /billing-review/reprocess-count/:accountID/:userID` | HTTP 200: [T0147](#t0147) | [T0511](#t0511), [T0512](#t0512), [T0513](#t0513) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B141](#b141), [B142](#b142), [B162](#b162), [B366](#b366) |
| <a id="r051"></a>**R051** `GET /billing-review/weekly/:accountID/:userID` | HTTP 200: [T0149](#t0149) | [T0514](#t0514), [T0515](#t0515), [T0516](#t0516) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B138](#b138), [B139](#b139), [B366](#b366) |
| <a id="r110"></a>**R110** `POST /billing-review/reprocess-with-overrides/:entryID/:accountID/:userID` | HTTP 200: [T0993](#t0993) | [T0664](#t0664), [T0665](#t0665), [T0666](#t0666) | [B008](#b008), [B009](#b009), [B010](#b010), [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B147](#b147), [B148](#b148), [B149](#b149), [B163](#b163), [B164](#b164), [B366](#b366), [B407](#b407), [B408](#b408), [B666](#b666), [B667](#b667), [B668](#b668), [B669](#b669), [B670](#b670), [B671](#b671), [B672](#b672), [B673](#b673), [B674](#b674), [B675](#b675), [B676](#b676), [B743](#b743), [B744](#b744), [B745](#b745), [B746](#b746), [B747](#b747), [B748](#b748), [B761](#b761), [B768](#b768), [B772](#b772), [B773](#b773), [B774](#b774), [B775](#b775), [B791](#b791), [B871](#b871), [B872](#b872), [B874](#b874), [B895](#b895) |
| <a id="r111"></a>**R111** `POST /billing-review/reprocess/:accountID/:userID` | HTTP 200: [T0872](#t0872) | [T0667](#t0667), [T0668](#t0668), [T0669](#t0669) | [B008](#b008), [B009](#b009), [B010](#b010), [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B143](#b143), [B144](#b144), [B145](#b145), [B146](#b146), [B162](#b162), [B366](#b366), [B407](#b407), [B408](#b408), [B666](#b666), [B667](#b667), [B668](#b668), [B669](#b669), [B670](#b670), [B671](#b671), [B672](#b672), [B673](#b673), [B674](#b674), [B675](#b675), [B676](#b676), [B677](#b677), [B678](#b678), [B743](#b743), [B744](#b744), [B745](#b745), [B746](#b746), [B747](#b747), [B748](#b748), [B761](#b761), [B768](#b768), [B772](#b772), [B773](#b773), [B774](#b774), [B775](#b775), [B791](#b791), [B871](#b871), [B872](#b872), [B874](#b874), [B895](#b895) |
| <a id="r142"></a>**R142** `PUT /billing-review/:entryID/:accountID/:userID` | HTTP 200: [T1222](#t1222) | [T0756](#t0756), [T0757](#t0757), [T0758](#t0758) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B136](#b136), [B137](#b137), [B152](#b152), [B153](#b153), [B154](#b154), [B155](#b155), [B156](#b156), [B157](#b157), [B158](#b158), [B159](#b159), [B160](#b160), [B161](#b161), [B366](#b366), [B407](#b407), [B408](#b408), [B743](#b743), [B744](#b744), [B745](#b745), [B746](#b746), [B747](#b747), [B748](#b748), [B761](#b761), [B768](#b768), [B772](#b772), [B773](#b773), [B774](#b774), [B775](#b775), [B791](#b791), [B871](#b871), [B872](#b872), [B895](#b895) |
| <a id="r143"></a>**R143** `PUT /billing-review/transaction/:transactionID/:accountID/:userID` | HTTP 200: [T1036](#t1036) | [T0759](#t0759), [T0760](#t0760), [T0761](#t0761) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B150](#b150), [B151](#b151), [B165](#b165), [B166](#b166), [B167](#b167), [B168](#b168), [B169](#b169), [B170](#b170), [B171](#b171), [B172](#b172), [B173](#b173), [B174](#b174), [B175](#b175), [B176](#b176), [B177](#b177), [B178](#b178), [B179](#b179), [B180](#b180), [B181](#b181), [B182](#b182), [B183](#b183), [B184](#b184), [B185](#b185), [B186](#b186), [B187](#b187), [B188](#b188), [B189](#b189), [B190](#b190), [B191](#b191), [B192](#b192), [B193](#b193), [B194](#b194), [B195](#b195), [B196](#b196), [B197](#b197), [B198](#b198), [B199](#b199), [B200](#b200), [B365](#b365), [B366](#b366), [B407](#b407), [B408](#b408), [B761](#b761), [B871](#b871), [B872](#b872), [B874](#b874) |

### /notifications

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r069"></a>**R069** `GET /notifications/:accountID/:userID` | HTTP 200: [T0110](#t0110) | [T0561](#t0561), [T0562](#t0562) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r070"></a>**R070** `GET /notifications/:accountID/:userID/unread-count` | HTTP 200: [T0111](#t0111) | [T0563](#t0563), [T0564](#t0564) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r148"></a>**R148** `PUT /notifications/:accountID/:userID/read-all` | HTTP 200: [T0133](#t0133) | [T0774](#t0774), [T0775](#t0775) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B871](#b871), [B872](#b872) |
| <a id="r149"></a>**R149** `PUT /notifications/:notificationID/:accountID/:userID/read` | HTTP 200: [T0134](#t0134) | [T0776](#t0776), [T0777](#t0777) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B118](#b118), [B119](#b119), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B405](#b405), [B871](#b871), [B872](#b872) |

### /accountAudit

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r021"></a>**R021** `GET /accountAudit/audit/:auditID/:accountID/:userID` | HTTP 200 / JSON 200: [T0168](#t0168) | [T0430](#t0430), [T0431](#t0431), [T0432](#t0432) | [B011](#b011), [B012](#b012), [B060](#b060), [B061](#b061), [B062](#b062), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366) |
| <a id="r022"></a>**R022** `GET /accountAudit/audit/:auditID/pdf/:accountID/:userID` | HTTP 200: [T0171](#t0171) | [T0433](#t0433), [T0434](#t0434), [T0435](#t0435) | [B011](#b011), [B012](#b012), [B045](#b045), [B063](#b063), [B064](#b064), [B065](#b065), [B066](#b066), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366) |
| <a id="r023"></a>**R023** `GET /accountAudit/customer/:customerID/:accountID/:userID` | HTTP 200 / JSON 200: [T0172](#t0172) | [T0436](#t0436), [T0437](#t0437), [T0438](#t0438) | [B011](#b011), [B012](#b012), [B067](#b067), [B068](#b068), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366) |
| <a id="r024"></a>**R024** `GET /accountAudit/customers/:accountID/:userID` | HTTP 200 / JSON 200: [T0173](#t0173) | [T0439](#t0439), [T0440](#t0440), [T0441](#t0441) | [B011](#b011), [B012](#b012), [B046](#b046), [B047](#b047), [B048](#b048), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366) |
| <a id="r025"></a>**R025** `GET /accountAudit/job/:jobId/:accountID/:userID` | HTTP 200 / JSON 200: [T0176](#t0176) | [T0442](#t0442), [T0443](#t0443), [T0444](#t0444) | [B011](#b011), [B012](#b012), [B059](#b059), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366) |
| <a id="r026"></a>**R026** `GET /accountAudit/whoami/:accountID/:userID` | HTTP 200 / JSON 200: [T0007](#t0007) | [T0445](#t0445), [T0446](#t0446), [T0447](#t0447) | [B011](#b011), [B012](#b012), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366) |
| <a id="r104"></a>**R104** `POST /accountAudit/run/:accountID/:userID` | HTTP 200 / JSON 200: [T0200](#t0200) | [T0654](#t0654), [T0655](#t0655), [T0656](#t0656) | [B001](#b001), [B002](#b002), [B003](#b003), [B004](#b004), [B005](#b005), [B006](#b006), [B007](#b007), [B011](#b011), [B012](#b012), [B043](#b043), [B044](#b044), [B045](#b045), [B049](#b049), [B050](#b050), [B051](#b051), [B052](#b052), [B053](#b053), [B054](#b054), [B055](#b055), [B056](#b056), [B057](#b057), [B058](#b058), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B249](#b249), [B253](#b253), [B254](#b254), [B255](#b255), [B256](#b256), [B257](#b257), [B258](#b258), [B259](#b259), [B260](#b260), [B261](#b261), [B262](#b262), [B263](#b263), [B264](#b264), [B265](#b265), [B266](#b266), [B267](#b267), [B268](#b268), [B269](#b269), [B270](#b270), [B271](#b271), [B272](#b272), [B273](#b273), [B274](#b274), [B275](#b275), [B276](#b276), [B277](#b277), [B366](#b366), [B871](#b871), [B872](#b872) |

### /auditRecord

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r040"></a>**R040** `GET /auditRecord/customer/:customerID/:accountID/:userID` | HTTP 200 / JSON 200: [T1228](#t1228) | [T0481](#t0481), [T0482](#t0482), [T0483](#t0483) | [B011](#b011), [B012](#b012), [B096](#b096), [B097](#b097), [B098](#b098), [B099](#b099), [B100](#b100), [B101](#b101), [B114](#b114), [B115](#b115), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B249](#b249), [B366](#b366), [B888](#b888) |
| <a id="r041"></a>**R041** `GET /auditRecord/customer/:customerID/:accountID/:userID/records` | HTTP 200 / JSON 200: [T1230](#t1230) | [T0484](#t0484), [T0485](#t0485), [T0486](#t0486) | [B011](#b011), [B012](#b012), [B096](#b096), [B097](#b097), [B098](#b098), [B099](#b099), [B100](#b100), [B101](#b101), [B114](#b114), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B888](#b888) |
| <a id="r042"></a>**R042** `GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/evidence` | HTTP 200: [T1230](#t1230) | [T0487](#t0487), [T0488](#t0488), [T0489](#t0489) | [B011](#b011), [B012](#b012), [B100](#b100), [B101](#b101), [B105](#b105), [B106](#b106), [B107](#b107), [B109](#b109), [B110](#b110), [B111](#b111), [B112](#b112), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B888](#b888) |
| <a id="r043"></a>**R043** `GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/pdf` | HTTP 200: [T1230](#t1230) | [T0490](#t0490), [T0491](#t0491), [T0492](#t0492) | [B011](#b011), [B012](#b012), [B100](#b100), [B101](#b101), [B105](#b105), [B106](#b106), [B107](#b107), [B108](#b108), [B113](#b113), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B888](#b888) |
| <a id="r044"></a>**R044** `GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/verify` | HTTP 200 / JSON 200: [T1230](#t1230) | [T0493](#t0493), [T0494](#t0494), [T0495](#t0495) | [B011](#b011), [B012](#b012), [B100](#b100), [B101](#b101), [B105](#b105), [B106](#b106), [B107](#b107), [B108](#b108), [B109](#b109), [B110](#b110), [B111](#b111), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B888](#b888) |
| <a id="r045"></a>**R045** `GET /auditRecord/customer/:customerID/:accountID/:userID/verify` | HTTP 200 / JSON 200: [T1227](#t1227) | [T0496](#t0496), [T0497](#t0497), [T0498](#t0498) | [B011](#b011), [B012](#b012), [B100](#b100), [B101](#b101), [B114](#b114), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B366](#b366), [B888](#b888) |
| <a id="r106"></a>**R106** `POST /auditRecord/customer/:customerID/:accountID/:userID/records` | HTTP 201 / JSON 201: [T1230](#t1230) | [T0660](#t0660), [T0661](#t0661), [T0662](#t0662) | [B011](#b011), [B012](#b012), [B095](#b095), [B096](#b096), [B097](#b097), [B098](#b098), [B099](#b099), [B100](#b100), [B101](#b101), [B102](#b102), [B103](#b103), [B104](#b104), [B114](#b114), [B115](#b115), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B131](#b131), [B132](#b132), [B133](#b133), [B134](#b134), [B249](#b249), [B366](#b366), [B871](#b871), [B872](#b872), [B888](#b888) |

### /accountsReceivable

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r027"></a>**R027** `GET /accountsReceivable/aging/:accountID/:userID` | HTTP 200 / JSON 200: [T0177](#t0177) | [T0448](#t0448), [T0449](#t0449), [T0450](#t0450) | [B011](#b011), [B012](#b012), [B069](#b069), [B070](#b070), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B893](#b893) |
| <a id="r028"></a>**R028** `GET /accountsReceivable/aging/:accountID/:userID/export` | HTTP 200: [T0178](#t0178) | [T0451](#t0451), [T0452](#t0452), [T0453](#t0453) | [B011](#b011), [B012](#b012), [B071](#b071), [B072](#b072), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |

### /analytics

| Route | Successful or retired contract | Auth / tenant / role proof | Handler and service branches |
|---|---|---|---|
| <a id="r029"></a>**R029** `GET /analytics/clientRates/:accountID/:userID` | HTTP 200 / JSON 200: [T0179](#t0179) | [T0454](#t0454), [T0455](#t0455), [T0456](#t0456) | [B011](#b011), [B012](#b012), [B074](#b074), [B075](#b075), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r030"></a>**R030** `GET /analytics/clientRates/:accountID/:userID/export` | HTTP 200: [T0180](#t0180) | [T0457](#t0457), [T0458](#t0458), [T0459](#t0459) | [B011](#b011), [B012](#b012), [B076](#b076), [B077](#b077), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r031"></a>**R031** `GET /analytics/exclusions/:accountID/:userID` | HTTP 200 / JSON 200: [T0181](#t0181) | [T0460](#t0460), [T0461](#t0461), [T0462](#t0462) | [B011](#b011), [B012](#b012), [B093](#b093), [B094](#b094), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r032"></a>**R032** `GET /analytics/jobBudgets/:accountID/:userID` | HTTP 200 / JSON 200: [T0182](#t0182) | [T0463](#t0463), [T0464](#t0464), [T0465](#t0465) | [B011](#b011), [B012](#b012), [B087](#b087), [B088](#b088), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r033"></a>**R033** `GET /analytics/taxSeasonCapacity/:accountID/:userID` | HTTP 200 / JSON 200: [T0183](#t0183) | [T0466](#t0466), [T0467](#t0467), [T0468](#t0468) | [B011](#b011), [B012](#b012), [B091](#b091), [B092](#b092), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r034"></a>**R034** `GET /analytics/timeAllocation/:accountID/:userID` | HTTP 200 / JSON 200: [T0184](#t0184) | [T0469](#t0469), [T0470](#t0470), [T0471](#t0471) | [B011](#b011), [B012](#b012), [B078](#b078), [B079](#b079), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r035"></a>**R035** `GET /analytics/timeAllocation/:accountID/:userID/export` | HTTP 200: [T0185](#t0185) | [T0472](#t0472), [T0473](#t0473), [T0474](#t0474) | [B011](#b011), [B012](#b012), [B080](#b080), [B081](#b081), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366) |
| <a id="r036"></a>**R036** `GET /analytics/wipAging/:accountID/:userID` | HTTP 200 / JSON 200: [T0186](#t0186) | [T0475](#t0475), [T0476](#t0476), [T0477](#t0477) | [B011](#b011), [B012](#b012), [B085](#b085), [B086](#b086), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B249](#b249), [B366](#b366) |
| <a id="r037"></a>**R037** `GET /analytics/yearEndPacket/:accountID/:userID` | HTTP 200: [T0187](#t0187) | [T0478](#t0478), [T0479](#t0479), [T0480](#t0480) | [B011](#b011), [B012](#b012), [B089](#b089), [B090](#b090), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B249](#b249), [B366](#b366) |
| <a id="r105"></a>**R105** `POST /analytics/rateAgreement/:accountID/:userID` | HTTP 200 / JSON 200: [T0201](#t0201) | [T0657](#t0657), [T0658](#t0658), [T0659](#t0659) | [B011](#b011), [B012](#b012), [B082](#b082), [B083](#b083), [B084](#b084), [B116](#b116), [B117](#b117), [B126](#b126), [B127](#b127), [B128](#b128), [B129](#b129), [B130](#b130), [B366](#b366), [B407](#b407), [B408](#b408), [B871](#b871), [B872](#b872) |

## Failure-site catalog

The full condition/catch snippets, precise source offsets, route mounts and source hashes are retained in [the machine-readable inventory](evidence/pass3/route-inventory.json). Each entry below includes the source location and the exact proving test(s), or the reason it cannot be reached. “Outside HTTP” is not counted as a passed API branch.

### src/ai_integrations/bedrock/index.js

<a id="b001"></a>**B001** — [src/ai_integrations/bedrock/index.js:59](../../src/ai_integrations/bedrock/index.js#L59) · catch · `_parseAnthropicJson`

` catch (e) { json = null; } `

**Proved:** [T0977](#t0977).

<a id="b002"></a>**B002** — [src/ai_integrations/bedrock/index.js:65](../../src/ai_integrations/bedrock/index.js#L65) · catch · `_parseAnthropicJson`

` catch (e) { return null; } `

**Proved:** [T0001](#t0001).

<a id="b003"></a>**B003** — [src/ai_integrations/bedrock/index.js:118](../../src/ai_integrations/bedrock/index.js#L118) · catch · `invokeBedrockClaude`

` catch (err) { const transient = err && (err.name === 'ThrottlingException' || err.$metadata?.httpStatusCode >= 500); if (transient) { await _sleep(500 + Math.floor(Math.random() * 250)); await acquireSlot(modelId); // re-spend a token on the retry try { raw =  `

**Proved:** [T0981](#t0981), [T0200](#t0200).

<a id="b004"></a>**B004** — [src/ai_integrations/bedrock/index.js:125](../../src/ai_integrations/bedrock/index.js#L125) · catch · `invokeBedrockClaude`

` catch (err2) { status = 'error'; errorMessage = err2.message || String(err2); } `

**Proved:** [T0002](#t0002).

<a id="b005"></a>**B005** — [src/ai_integrations/bedrock/index.js:180](../../src/ai_integrations/bedrock/index.js#L180) · catch · `invokeBedrockClaude`

` catch (e) { // Audit failure must never break the call — surface as console only. console.error('[bedrock] S3 audit log write failed:', e.message); } `

**Proved:** [T1008](#t1008).

<a id="b006"></a>**B006** — [src/ai_integrations/bedrock/index.js:188](../../src/ai_integrations/bedrock/index.js#L188) · catch · `invokeBedrockClaude`

` catch (e) { console.error('[bedrock] DB audit log write failed:', e.message); } `

**Proved:** [T0976](#t0976).

<a id="b007"></a>**B007** — [src/ai_integrations/bedrock/index.js:199](../../src/ai_integrations/bedrock/index.js#L199) · throw · `invokeBedrockClaude`

` throw errorObj; `

**Proved:** [T0977](#t0977), [T0981](#t0981).

### src/ai_integrations/categoryInference.js

<a id="b008"></a>**B008** — [src/ai_integrations/categoryInference.js:155](../../src/ai_integrations/categoryInference.js#L155) · catch · `inferCategorization`

` catch (err) { lastError = err; // Don't escalate to Sonnet on auth / permission errors — Sonnet will // fail the same way and we'd waste an InvokeModel call. Same for // ResourceNotFound (model not enabled). Throttling DOES escalate // because Haiku-specific t `

**Proved:** [T0981](#t0981), [T0003](#t0003).

<a id="b009"></a>**B009** — [src/ai_integrations/categoryInference.js:187](../../src/ai_integrations/categoryInference.js#L187) · catch · `inferCategorization`

` catch (err) { lastError = err; } `

**Proved:** [T0981](#t0981), [T0004](#t0004).

### src/ai_integrations/customerMatching.js

<a id="b010"></a>**B010** — [src/ai_integrations/customerMatching.js:280](../../src/ai_integrations/customerMatching.js#L280) · catch · `matchCustomer`

`` catch (err) { return { customerId: null, displayName: null, score: top.score, tier: 'llm_error', candidates: fuzzyCandidates, reason: `bedrock_error: ${err.message}` }; } ``

**Proved:** [T0006](#t0006), [T0005](#t0005).

### src/app.js

<a id="b011"></a>**B011** — [src/app.js:186](../../src/app.js#L186) · response · `<handler>`

` res.status(409).send({ message: err.message, status: 409, code: 'SENT_INVOICE_LOCKED' }) `

**Proved:** [T0974](#t0974).

<a id="b012"></a>**B012** — [src/app.js:196](../../src/app.js#L196) · response · `<handler>`

` res.status(statusCode).json({ message: errorMessage, ...(NODE_ENV !== 'production' && { error: err }) }) `

**Proved:** [T0890](#t0890), [T0897](#t0897).

### src/automations/automationScripts/timeTrackerReminders.js

<a id="b013"></a>**B013** — [src/automations/automationScripts/timeTrackerReminders.js:56](../../src/automations/automationScripts/timeTrackerReminders.js#L56) · catch · `sendAccountWideReminder`

`` catch (error) { console.error(`[${new Date().toISOString()}] Failed to send "${subject}" reminder for account ${accountID}: ${error.message}`); } ``

**outside HTTP:** Scheduled reminder execution only. No mounted HTTP handler calls these functions; app schedules them only at production startup. Starting daemons or sending real email is outside this local API pass.

<a id="b014"></a>**B014** — [src/automations/automationScripts/timeTrackerReminders.js:121](../../src/automations/automationScripts/timeTrackerReminders.js#L121) · catch · `sendMissingTrackerRemindersForAccount`

`` catch (userError) { console.error(`[${new Date().toISOString()}] Failed to evaluate tracker status for user ${user.userId} (account ${accountID}): ${userError.message}`); } ``

**outside HTTP:** Scheduled reminder execution only. No mounted HTTP handler calls these functions; app schedules them only at production startup. Starting daemons or sending real email is outside this local API pass.

<a id="b015"></a>**B015** — [src/automations/automationScripts/timeTrackerReminders.js:153](../../src/automations/automationScripts/timeTrackerReminders.js#L153) · catch · `<handler>`

`` catch (emailError) { console.error(`[${new Date().toISOString()}] Failed to send missing tracker reminder to ${user.email} (account ${accountID}): ${emailError.message}`); } ``

**outside HTTP:** Scheduled reminder execution only. No mounted HTTP handler calls these functions; app schedules them only at production startup. Starting daemons or sending real email is outside this local API pass.

<a id="b016"></a>**B016** — [src/automations/automationScripts/timeTrackerReminders.js:158](../../src/automations/automationScripts/timeTrackerReminders.js#L158) · catch · `sendMissingTrackerRemindersForAccount`

`` catch (error) { console.error(`[${new Date().toISOString()}] Failed to evaluate missing trackers for account ${accountID}: ${error.message}`); } ``

**outside HTTP:** Scheduled reminder execution only. No mounted HTTP handler calls these functions; app schedules them only at production startup. Starting daemons or sending real email is outside this local API pass.

<a id="b017"></a>**B017** — [src/automations/automationScripts/timeTrackerReminders.js:176](../../src/automations/automationScripts/timeTrackerReminders.js#L176) · catch · `iterateAccountsForAutomation`

`` catch (error) { console.error(`[${new Date().toISOString()}] Unable to resolve accounts for automation "${automationKey}": ${error.message}`); } ``

**outside HTTP:** Scheduled reminder execution only. No mounted HTTP handler calls these functions; app schedules them only at production startup. Starting daemons or sending real email is outside this local API pass.

### src/endpoints/account/account-router.js

<a id="b018"></a>**B018** — [src/endpoints/account/account-router.js:91](../../src/endpoints/account/account-router.js#L91) · catch · `fetchAccountLogo`

`` catch (s3Error) { source = 'unavailable'; if (s3Error?.code === 'ENOTFOUND') { console.warn(`Account logo S3 endpoint not reachable (${s3Error.hostname}).`); } else if (s3Error?.$metadata?.httpStatusCode === 404 || s3Error?.name === 'NoSuchKey') { console.warn ``

**Proved:** [T1246](#t1246), [T0163](#t0163).

<a id="b019"></a>**B019** — [src/endpoints/account/account-router.js:183](../../src/endpoints/account/account-router.js#L183) · response · `<handler>`

` res.status(400).send({ status: 400, message: 'Invalid logo file key.' }) `

**Proved:** [T0152](#t0152), [T0164](#t0164).

<a id="b020"></a>**B020** — [src/endpoints/account/account-router.js:198](../../src/endpoints/account/account-router.js#L198) · response · `<handler>`

` res.status(400).send({ status: 400, message: 'Valid account address ID required.' }) `

**Proved:** [T0131](#t0131).

<a id="b021"></a>**B021** — [src/endpoints/account/account-router.js:210](../../src/endpoints/account/account-router.js#L210) · throw · `<handler>`

` throw new Error('Account or address not found.'); `

**Proved:** [T0130](#t0130).

<a id="b022"></a>**B022** — [src/endpoints/account/account-router.js:241](../../src/endpoints/account/account-router.js#L241) · response · `<handler>`

` res.status(404).send({ message: 'Account not found.', status: 404 }) `

**Proved:** [T0811](#t0811).

<a id="b023"></a>**B023** — [src/endpoints/account/account-router.js:263](../../src/endpoints/account/account-router.js#L263) · catch · `<handler>`

` catch (error) { console.error('Error fetching account information:', error); res.status(500).send({ message: 'Error retrieving account information.', status: 500 }); } `

**Proved:** [T0812](#t0812).

<a id="b024"></a>**B024** — [src/endpoints/account/account-router.js:265](../../src/endpoints/account/account-router.js#L265) · response · `<handler>`

` res.status(500).send({ message: 'Error retrieving account information.', status: 500 }) `

**Proved:** [T0812](#t0812).

<a id="b025"></a>**B025** — [src/endpoints/account/account-router.js:281](../../src/endpoints/account/account-router.js#L281) · response · `<handler>`

` res.status(400).json({ message: 'Invalid account identifier.', status: 400 }) `

**unreachable:** router.param(accountID, enforceAccountId) runs first and rejects noninteger/foreign account IDs with 403. A verified owned PostgreSQL account ID is always a finite integer; this later 400 cannot run.

<a id="b026"></a>**B026** — [src/endpoints/account/account-router.js:320](../../src/endpoints/account/account-router.js#L320) · catch · `<handler>`

` catch (error) { console.error('Error fetching automation settings:', error); const status = error.status || 500; return res.status(status).json({ message: error.message || 'Unable to retrieve automation settings.', status }); } `

**Proved:** [T0813](#t0813).

<a id="b027"></a>**B027** — [src/endpoints/account/account-router.js:323](../../src/endpoints/account/account-router.js#L323) · response · `<handler>`

` res.status(status).json({ message: error.message || 'Unable to retrieve automation settings.', status }) `

**Proved:** [T0813](#t0813).

<a id="b028"></a>**B028** — [src/endpoints/account/account-router.js:337](../../src/endpoints/account/account-router.js#L337) · response · `<handler>`

` res.status(400).json({ message: 'Invalid account identifier.', status: 400 }) `

**unreachable:** router.param(accountID, enforceAccountId) runs first and rejects noninteger/foreign account IDs with 403. A verified owned PostgreSQL account ID is always a finite integer; this later 400 cannot run.

<a id="b029"></a>**B029** — [src/endpoints/account/account-router.js:344](../../src/endpoints/account/account-router.js#L344) · response · `<handler>`

` res.status(400).json({ message: 'Invalid automation key.', status: 400 }) `

**Proved:** [T0854](#t0854).

<a id="b030"></a>**B030** — [src/endpoints/account/account-router.js:362](../../src/endpoints/account/account-router.js#L362) · response · `<handler>`

` res.status(400).json({ message: 'Invalid value for isEnabled.', status: 400 }) `

**Proved:** [T0849](#t0849).

<a id="b031"></a>**B031** — [src/endpoints/account/account-router.js:370](../../src/endpoints/account/account-router.js#L370) · response · `<handler>`

` res.status(400).json({ message: 'Invalid value for isEnabled.', status: 400 }) `

**Proved:** [T0850](#t0850).

<a id="b032"></a>**B032** — [src/endpoints/account/account-router.js:379](../../src/endpoints/account/account-router.js#L379) · response · `<handler>`

` res.status(400).json({ message: 'Invalid automation recipients payload.', status: 400 }) `

**Proved:** [T0851](#t0851).

<a id="b033"></a>**B033** — [src/endpoints/account/account-router.js:388](../../src/endpoints/account/account-router.js#L388) · response · `<handler>`

` res.status(400).json({ message: 'No automation updates provided.', status: 400 }) `

**Proved:** [T0853](#t0853).

<a id="b034"></a>**B034** — [src/endpoints/account/account-router.js:400](../../src/endpoints/account/account-router.js#L400) · catch · `<handler>`

` catch (error) { console.error('Error updating automation setting:', error); const status = error.status || 500; return res.status(status).json({ message: error.message || 'Unable to update automation setting.', status }); } `

**Proved:** [T0848](#t0848), [T0852](#t0852).

<a id="b035"></a>**B035** — [src/endpoints/account/account-router.js:403](../../src/endpoints/account/account-router.js#L403) · response · `<handler>`

` res.status(status).json({ message: error.message || 'Unable to update automation setting.', status }) `

**Proved:** [T0848](#t0848), [T0852](#t0852).

### src/endpoints/account/account-service.js

<a id="b036"></a>**B036** — [src/endpoints/account/account-service.js:57](../../src/endpoints/account/account-service.js#L57) · catch · `<handler>`

` catch (err) { if (err?.code === '23505' && err?.constraint === 'accounts_storage_slug_key') { // Re-picks a fresh accountId too (a new nextval), not just a // fresh slug for the same id — simplest correct retry, and the // abandoned id from the failed attempt  `

**Proved:** [T0937](#t0937), [T0938](#t0938).

<a id="b037"></a>**B037** — [src/endpoints/account/account-service.js:65](../../src/endpoints/account/account-service.js#L65) · throw · `<handler>`

` throw err; `

**Proved:** [T0937](#t0937).

### src/endpoints/account/accountObjects.js

<a id="b038"></a>**B038** — [src/endpoints/account/accountObjects.js:102](../../src/endpoints/account/accountObjects.js#L102) · throw · `validateAccountCreation`

`` throw Object.assign(new Error(`Invalid ${field}; use text up to ${limit} characters.`), { status: 400 }); ``

**Proved:** [T0117](#t0117), [T1031](#t1031).

### src/endpoints/account/automation-settings-service.js

<a id="b039"></a>**B039** — [src/endpoints/account/automation-settings-service.js:62](../../src/endpoints/account/automation-settings-service.js#L62) · throw · `replaceAutomationRecipients`

` throw error; `

**unreachable:** updateAutomationSetting validates automationKey before calling replaceAutomationRecipients with that same key; the replacement function has no other HTTP caller.

<a id="b040"></a>**B040** — [src/endpoints/account/automation-settings-service.js:81](../../src/endpoints/account/automation-settings-service.js#L81) · throw · `replaceAutomationRecipients`

` throw error; `

**Proved:** [T0852](#t0852), [T1030](#t1030).

<a id="b041"></a>**B041** — [src/endpoints/account/automation-settings-service.js:104](../../src/endpoints/account/automation-settings-service.js#L104) · throw · `updateAutomationSetting`

` throw error; `

**Proved:** [T0848](#t0848), [T0128](#t0128).

<a id="b042"></a>**B042** — [src/endpoints/account/automation-settings-service.js:156](../../src/endpoints/account/automation-settings-service.js#L156) · throw · `getEnabledAccountIds`

` throw error; `

**outside HTTP:** getEnabledAccountIds is called only by scheduled automation orchestration, not by the settings HTTP routes.

### src/endpoints/accountAudit/account-audit-narrative.js

<a id="b043"></a>**B043** — [src/endpoints/accountAudit/account-audit-narrative.js:89](../../src/endpoints/accountAudit/account-audit-narrative.js#L89) · catch · `generateAuditNarrative`

`` catch (firstErr) { console.warn(`[audit-narrative] primary model failed (${DEFAULT_MODEL}): ${firstErr.message}. Trying fallback.`); try { const out = await attempt(FALLBACK_MODEL); return shapeResponse(out, FALLBACK_MODEL); } catch (secondErr) { console.warn( ``

**Proved:** [T0200](#t0200), [T0093](#t0093).

<a id="b044"></a>**B044** — [src/endpoints/accountAudit/account-audit-narrative.js:94](../../src/endpoints/accountAudit/account-audit-narrative.js#L94) · catch · `generateAuditNarrative`

`` catch (secondErr) { console.warn(`[audit-narrative] fallback model also failed: ${secondErr.message}`); return null; } ``

**Proved:** [T0200](#t0200), [T0093](#t0093).

### src/endpoints/accountAudit/account-audit-pdf.js

<a id="b045"></a>**B045** — [src/endpoints/accountAudit/account-audit-pdf.js:335](../../src/endpoints/accountAudit/account-audit-pdf.js#L335) · catch · `<handler>`

` catch (err) { reject(err); } `

**Proved:** [T0913](#t0913).

### src/endpoints/accountAudit/account-audit-router.js

<a id="b046"></a>**B046** — [src/endpoints/accountAudit/account-audit-router.js:61](../../src/endpoints/accountAudit/account-audit-router.js#L61) · response · `<handler>`

` res.status(400).send({ status: 400, message: 'ar_60 is not supported. Use the Accounts Receivable aging report.' }) `

**Proved:** [T1032](#t1032), [T1033](#t1033).

<a id="b047"></a>**B047** — [src/endpoints/accountAudit/account-audit-router.js:109](../../src/endpoints/accountAudit/account-audit-router.js#L109) · catch · `<handler>`

` catch (err) { console.error('Account audit list error:', err); res.status(500).send({ message: clientSafeMessage(err, 'Error listing customers.'), status: 500 }); } `

**Proved:** [T0816](#t0816).

<a id="b048"></a>**B048** — [src/endpoints/accountAudit/account-audit-router.js:111](../../src/endpoints/accountAudit/account-audit-router.js#L111) · response · `<handler>`

` res.status(500).send({ message: clientSafeMessage(err, 'Error listing customers.'), status: 500 }) `

**Proved:** [T0816](#t0816).

<a id="b049"></a>**B049** — [src/endpoints/accountAudit/account-audit-router.js:154](../../src/endpoints/accountAudit/account-audit-router.js#L154) · catch · `<handler>`

`` catch (e) { appBalanceError = (e.message || String(e)).slice(0, 500); console.warn(`[audit-job] app balance failed for ${customerId}: ${appBalanceError}`); } ``

**Proved:** [T0918](#t0918).

<a id="b050"></a>**B050** — [src/endpoints/accountAudit/account-audit-router.js:170](../../src/endpoints/accountAudit/account-audit-router.js#L170) · catch · `runAuditBatch`

`` catch (e) { console.warn(`[audit-job] narrative skipped for ${customerId}: ${e.message}`); } ``

**unreachable:** generateAuditNarrative catches both model failures and returns null. Its pre-try prompt shaping consumes the deterministic auditor arrays, not arbitrary HTTP objects. No uncaught database/storage operation exists in this redundant outer catch.

<a id="b051"></a>**B051** — [src/endpoints/accountAudit/account-audit-router.js:239](../../src/endpoints/accountAudit/account-audit-router.js#L239) · catch · `runAuditBatch`

`` catch (e) { console.warn(`[audit-job] PDF/S3 skipped for audit ${saved.audit_id}: ${e.message}`); } ``

**Proved:** [T0917](#t0917).

<a id="b052"></a>**B052** — [src/endpoints/accountAudit/account-audit-router.js:256](../../src/endpoints/accountAudit/account-audit-router.js#L256) · catch · `runAuditBatch`

`` catch (err) { console.error(`[audit-job] customer ${customerId} failed:`, err); try { const [saved] = await accountAuditService.insertAudit(db, { account_id: accountId, customer_id: customerId, run_by_user_id: auditUser.user_id, run_by_display_name: auditUser. ``

**Proved:** [T0920](#t0920), [T0919](#t0919).

<a id="b053"></a>**B053** — [src/endpoints/accountAudit/account-audit-router.js:268](../../src/endpoints/accountAudit/account-audit-router.js#L268) · catch · `runAuditBatch`

` catch (_) { job.results.push({ customer_id: customerId, status: 'failed', error: err.message }); } `

**Proved:** [T0920](#t0920).

<a id="b054"></a>**B054** — [src/endpoints/accountAudit/account-audit-router.js:288](../../src/endpoints/accountAudit/account-audit-router.js#L288) · response · `<handler>`

` res.status(400).send({ message: 'No customers selected.', status: 400 }) `

**Proved:** [T0199](#t0199).

<a id="b055"></a>**B055** — [src/endpoints/accountAudit/account-audit-router.js:291](../../src/endpoints/accountAudit/account-audit-router.js#L291) · response · `<handler>`

` res.status(400).send({ message: 'Limit 200 customers per batch.', status: 400 }) `

**Proved:** [T0836](#t0836).

<a id="b056"></a>**B056** — [src/endpoints/accountAudit/account-audit-router.js:310](../../src/endpoints/accountAudit/account-audit-router.js#L310) · rejection callback · `<handler>`

` runAuditBatch(db, accountId, ids, notes, req.user, jobId).catch(err => { console.error('[audit-job] fatal background error:', err); const job = auditJobs.get(jobId); if (job) { job.status = 'failed';  `

**unreachable:** Every customer database/render/storage operation is enclosed in runAuditBatch per-customer catches, including failed-result persistence. Outside those catches the runner only updates its private job object, increments counters and creates timestamps. Fatal rejection would require an internal runtime/programming failure, not a customer input or database/storage rejection.

<a id="b057"></a>**B057** — [src/endpoints/accountAudit/account-audit-router.js:318](../../src/endpoints/accountAudit/account-audit-router.js#L318) · catch · `<handler>`

` catch (err) { console.error('Account audit run error:', err); res.status(500).send({ message: clientSafeMessage(err, 'Error running audits.'), status: 500 }); } `

**Proved:** [T0989](#t0989).

<a id="b058"></a>**B058** — [src/endpoints/accountAudit/account-audit-router.js:320](../../src/endpoints/accountAudit/account-audit-router.js#L320) · response · `<handler>`

` res.status(500).send({ message: clientSafeMessage(err, 'Error running audits.'), status: 500 }) `

**Proved:** [T0989](#t0989).

<a id="b059"></a>**B059** — [src/endpoints/accountAudit/account-audit-router.js:328](../../src/endpoints/accountAudit/account-audit-router.js#L328) · response · `<handler>`

` res.status(404).send({ message: 'Job not found or expired.', status: 404 }) `

**Proved:** [T0174](#t0174), [T0175](#t0175).

<a id="b060"></a>**B060** — [src/endpoints/accountAudit/account-audit-router.js:349](../../src/endpoints/accountAudit/account-audit-router.js#L349) · response · `<handler>`

` res.status(404).send({ message: 'Audit not found.', status: 404 }) `

**Proved:** [T0167](#t0167).

<a id="b061"></a>**B061** — [src/endpoints/accountAudit/account-audit-router.js:379](../../src/endpoints/accountAudit/account-audit-router.js#L379) · catch · `<handler>`

` catch (err) { console.error('Account audit detail error:', err); res.status(500).send({ message: clientSafeMessage(err, 'Error fetching audit.'), status: 500 }); } `

**Proved:** [T0814](#t0814), [T1110](#t1110).

<a id="b062"></a>**B062** — [src/endpoints/accountAudit/account-audit-router.js:381](../../src/endpoints/accountAudit/account-audit-router.js#L381) · response · `<handler>`

` res.status(500).send({ message: clientSafeMessage(err, 'Error fetching audit.'), status: 500 }) `

**Proved:** [T0814](#t0814), [T1110](#t1110).

<a id="b063"></a>**B063** — [src/endpoints/accountAudit/account-audit-router.js:392](../../src/endpoints/accountAudit/account-audit-router.js#L392) · response · `<handler>`

` res.status(404).send({ message: 'Audit not found.', status: 404 }) `

**Proved:** [T0169](#t0169).

<a id="b064"></a>**B064** — [src/endpoints/accountAudit/account-audit-router.js:404](../../src/endpoints/accountAudit/account-audit-router.js#L404) · catch · `<handler>`

`` catch (e) { console.warn(`[audit] S3 fetch failed for ${audit.pdf_s3_key}, rebuilding: ${e.message}`); } ``

**Proved:** [T0914](#t0914), [T0170](#t0170).

<a id="b065"></a>**B065** — [src/endpoints/accountAudit/account-audit-router.js:425](../../src/endpoints/accountAudit/account-audit-router.js#L425) · catch · `<handler>`

` catch (err) { console.error('Account audit pdf error:', err); res.status(500).send({ message: clientSafeMessage(err, 'Error returning PDF.'), status: 500 }); } `

**Proved:** [T0913](#t0913), [T0912](#t0912).

<a id="b066"></a>**B066** — [src/endpoints/accountAudit/account-audit-router.js:427](../../src/endpoints/accountAudit/account-audit-router.js#L427) · response · `<handler>`

` res.status(500).send({ message: clientSafeMessage(err, 'Error returning PDF.'), status: 500 }) `

**Proved:** [T0913](#t0913), [T0912](#t0912).

<a id="b067"></a>**B067** — [src/endpoints/accountAudit/account-audit-router.js:465](../../src/endpoints/accountAudit/account-audit-router.js#L465) · catch · `<handler>`

` catch (err) { console.error('Account audit customer-list error:', err); res.status(500).send({ message: clientSafeMessage(err, 'Error fetching customer audits.'), status: 500 }); } `

**Proved:** [T0815](#t0815).

<a id="b068"></a>**B068** — [src/endpoints/accountAudit/account-audit-router.js:467](../../src/endpoints/accountAudit/account-audit-router.js#L467) · response · `<handler>`

` res.status(500).send({ message: clientSafeMessage(err, 'Error fetching customer audits.'), status: 500 }) `

**Proved:** [T0815](#t0815).

### src/endpoints/accountsReceivable/accounts-receivable-router.js

<a id="b069"></a>**B069** — [src/endpoints/accountsReceivable/accounts-receivable-router.js:108](../../src/endpoints/accountsReceivable/accounts-receivable-router.js#L108) · catch · `<handler>`

` catch (error) { console.error('Error fetching AR aging:', error); const isPaginationError = error.message && error.message.includes('Invalid pagination'); const statusCode = isPaginationError ? 400 : 500; return res.status(statusCode).send({ message: error.mes `

**Proved:** [T0817](#t0817), [T1111](#t1111).

<a id="b070"></a>**B070** — [src/endpoints/accountsReceivable/accounts-receivable-router.js:112](../../src/endpoints/accountsReceivable/accounts-receivable-router.js#L112) · response · `<handler>`

` res.status(statusCode).send({ message: error.message || 'An error occurred while retrieving AR aging.', status: statusCode }) `

**Proved:** [T0817](#t0817), [T1111](#t1111).

<a id="b071"></a>**B071** — [src/endpoints/accountsReceivable/accounts-receivable-router.js:148](../../src/endpoints/accountsReceivable/accounts-receivable-router.js#L148) · catch · `<handler>`

` catch (error) { console.error('Error exporting AR aging:', error); return res.status(500).send({ message: error.message || 'An error occurred while exporting AR aging.', status: 500 }); } `

**Proved:** [T0818](#t0818).

<a id="b072"></a>**B072** — [src/endpoints/accountsReceivable/accounts-receivable-router.js:150](../../src/endpoints/accountsReceivable/accounts-receivable-router.js#L150) · response · `<handler>`

` res.status(500).send({ message: error.message || 'An error occurred while exporting AR aging.', status: 500 }) `

**Proved:** [T0818](#t0818).

### src/endpoints/aiIntegration/aiIntegration-router.js

<a id="b073"></a>**B073** — [src/endpoints/aiIntegration/aiIntegration-router.js:10](../../src/endpoints/aiIntegration/aiIntegration-router.js#L10) · response · `_gone`

` res.status(410).json({ message: 'The /ai-integration endpoints have been removed. The time-tracker AI pipeline now runs on AWS Bedrock and is managed by feature flag rather than per-account API key. Use /billing-review and /notifications for the reviewer surface, and /time-tracking/template/latest for the dynamic template.', deprecated: t `

**Proved:** [T0840](#t0840).

### src/endpoints/analytics/analytics-router.js

<a id="b074"></a>**B074** — [src/endpoints/analytics/analytics-router.js:153](../../src/endpoints/analytics/analytics-router.js#L153) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while retrieving client rates.', status: 500 }); } `

**Proved:** [T0819](#t0819).

<a id="b075"></a>**B075** — [src/endpoints/analytics/analytics-router.js:155](../../src/endpoints/analytics/analytics-router.js#L155) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while retrieving client rates.', status: 500 }) `

**Proved:** [T0819](#t0819).

<a id="b076"></a>**B076** — [src/endpoints/analytics/analytics-router.js:166](../../src/endpoints/analytics/analytics-router.js#L166) · catch · `<handler>`

` catch (err) { console.log(err); res.status(500).send({ message: err.message || 'An error occurred while exporting client rates.', status: 500 }); } `

**Proved:** [T0820](#t0820).

<a id="b077"></a>**B077** — [src/endpoints/analytics/analytics-router.js:168](../../src/endpoints/analytics/analytics-router.js#L168) · response · `<handler>`

` res.status(500).send({ message: err.message || 'An error occurred while exporting client rates.', status: 500 }) `

**Proved:** [T0820](#t0820).

<a id="b078"></a>**B078** — [src/endpoints/analytics/analytics-router.js:180](../../src/endpoints/analytics/analytics-router.js#L180) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while retrieving time allocation.', status: 500 }); } `

**Proved:** [T0824](#t0824).

<a id="b079"></a>**B079** — [src/endpoints/analytics/analytics-router.js:182](../../src/endpoints/analytics/analytics-router.js#L182) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while retrieving time allocation.', status: 500 }) `

**Proved:** [T0824](#t0824).

<a id="b080"></a>**B080** — [src/endpoints/analytics/analytics-router.js:192](../../src/endpoints/analytics/analytics-router.js#L192) · catch · `<handler>`

` catch (err) { console.log(err); res.status(500).send({ message: err.message || 'An error occurred while exporting time allocation.', status: 500 }); } `

**Proved:** [T0825](#t0825).

<a id="b081"></a>**B081** — [src/endpoints/analytics/analytics-router.js:194](../../src/endpoints/analytics/analytics-router.js#L194) · response · `<handler>`

` res.status(500).send({ message: err.message || 'An error occurred while exporting time allocation.', status: 500 }) `

**Proved:** [T0825](#t0825).

<a id="b082"></a>**B082** — [src/endpoints/analytics/analytics-router.js:211](../../src/endpoints/analytics/analytics-router.js#L211) · throw · `<handler>`

` throw new Error('A customer, a year, and a positive agreed rate are required.'); `

**Proved:** [T0202](#t0202), [T1040](#t1040).

<a id="b083"></a>**B083** — [src/endpoints/analytics/analytics-router.js:221](../../src/endpoints/analytics/analytics-router.js#L221) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while saving the rate agreement.', status: 500 }); } `

**Proved:** [T0202](#t0202), [T1039](#t1039).

<a id="b084"></a>**B084** — [src/endpoints/analytics/analytics-router.js:223](../../src/endpoints/analytics/analytics-router.js#L223) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while saving the rate agreement.', status: 500 }) `

**Proved:** [T0202](#t0202), [T1039](#t1039).

<a id="b085"></a>**B085** — [src/endpoints/analytics/analytics-router.js:234](../../src/endpoints/analytics/analytics-router.js#L234) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while retrieving WIP aging.', status: 500 }); } `

**Proved:** [T0826](#t0826).

<a id="b086"></a>**B086** — [src/endpoints/analytics/analytics-router.js:236](../../src/endpoints/analytics/analytics-router.js#L236) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while retrieving WIP aging.', status: 500 }) `

**Proved:** [T0826](#t0826).

<a id="b087"></a>**B087** — [src/endpoints/analytics/analytics-router.js:247](../../src/endpoints/analytics/analytics-router.js#L247) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while retrieving job budgets.', status: 500 }); } `

**Proved:** [T0822](#t0822).

<a id="b088"></a>**B088** — [src/endpoints/analytics/analytics-router.js:249](../../src/endpoints/analytics/analytics-router.js#L249) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while retrieving job budgets.', status: 500 }) `

**Proved:** [T0822](#t0822).

<a id="b089"></a>**B089** — [src/endpoints/analytics/analytics-router.js:269](../../src/endpoints/analytics/analytics-router.js#L269) · response · `failExport`

` res.status(500).type('application/json').send({ message: err.message || 'An error occurred while building the year-end packet.', status: 500 }) `

**Proved:** [T0915](#t0915), [T0916](#t0916).

<a id="b090"></a>**B090** — [src/endpoints/analytics/analytics-router.js:298](../../src/endpoints/analytics/analytics-router.js#L298) · catch · `<handler>`

` catch (err) { console.log(err); failExport(err); } `

**Proved:** [T0916](#t0916), [T0827](#t0827).

<a id="b091"></a>**B091** — [src/endpoints/analytics/analytics-router.js:311](../../src/endpoints/analytics/analytics-router.js#L311) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while retrieving tax season capacity.', status: 500 }); } `

**Proved:** [T0823](#t0823).

<a id="b092"></a>**B092** — [src/endpoints/analytics/analytics-router.js:313](../../src/endpoints/analytics/analytics-router.js#L313) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while retrieving tax season capacity.', status: 500 }) `

**Proved:** [T0823](#t0823).

<a id="b093"></a>**B093** — [src/endpoints/analytics/analytics-router.js:324](../../src/endpoints/analytics/analytics-router.js#L324) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while retrieving exclusion options.', status: 500 }); } `

**Proved:** [T0821](#t0821).

<a id="b094"></a>**B094** — [src/endpoints/analytics/analytics-router.js:326](../../src/endpoints/analytics/analytics-router.js#L326) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while retrieving exclusion options.', status: 500 }) `

**Proved:** [T0821](#t0821).

### src/endpoints/auditRecord/audit-record-pdf.js

<a id="b095"></a>**B095** — [src/endpoints/auditRecord/audit-record-pdf.js:145](../../src/endpoints/auditRecord/audit-record-pdf.js#L145) · throw · `render`

` throw new Error('PDF digest field is not unique'); `

**Proved:** [T1000](#t1000).

### src/endpoints/auditRecord/audit-record-router.js

<a id="b096"></a>**B096** — [src/endpoints/auditRecord/audit-record-router.js:19](../../src/endpoints/auditRecord/audit-record-router.js#L19) · throw · `date`

` throw ruleError('Use valid YYYY-MM-DD dates.',400); `

**Proved:** [T1235](#t1235).

<a id="b097"></a>**B097** — [src/endpoints/auditRecord/audit-record-router.js:24](../../src/endpoints/auditRecord/audit-record-router.js#L24) · throw · `options`

` throw ruleError('Start date must not be after end date.',400); `

**Proved:** [T1235](#t1235).

<a id="b098"></a>**B098** — [src/endpoints/auditRecord/audit-record-router.js:25](../../src/endpoints/auditRecord/audit-record-router.js#L25) · throw · `number`

` throw ruleError('Invalid pagination.',400); `

**Proved:** [T1235](#t1235).

<a id="b099"></a>**B099** — [src/endpoints/auditRecord/audit-record-router.js:27](../../src/endpoints/auditRecord/audit-record-router.js#L27) · throw · `options`

` throw ruleError('Limit must be positive.',400); `

**Proved:** [T1235](#t1235).

<a id="b100"></a>**B100** — [src/endpoints/auditRecord/audit-record-router.js:32](../../src/endpoints/auditRecord/audit-record-router.js#L32) · catch · `<handler>`

` catch(e) {const status=e.statusCode || (e.code==='P0409'?409:500);res.status(status).send({status,code:e.code,message:status===500?'Unable to complete the audit record request. Please retry.':e.message});} `

**Proved:** [T1000](#t1000), [T1232](#t1232).

<a id="b101"></a>**B101** — [src/endpoints/auditRecord/audit-record-router.js:32](../../src/endpoints/auditRecord/audit-record-router.js#L32) · response · `<handler>`

` res.status(status).send({status,code:e.code,message:status===500?'Unable to complete the audit record request. Please retry.':e.message}) `

**Proved:** [T1000](#t1000), [T1232](#t1232).

<a id="b102"></a>**B102** — [src/endpoints/auditRecord/audit-record-router.js:51](../../src/endpoints/auditRecord/audit-record-router.js#L51) · throw · `<handler>`

` throw ruleError('A date-range object is required.',400); `

**Proved:** [T1235](#t1235).

<a id="b103"></a>**B103** — [src/endpoints/auditRecord/audit-record-router.js:54](../../src/endpoints/auditRecord/audit-record-router.js#L54) · throw · `<handler>`

` throw ruleError('Record type must be client or full_evidence.',400); `

**Proved:** [T1235](#t1235).

<a id="b104"></a>**B104** — [src/endpoints/auditRecord/audit-record-router.js:80](../../src/endpoints/auditRecord/audit-record-router.js#L80) · throw · `<handler>`

` throw new Error('Audit record insert failed'); `

**Proved:** [T1234](#t1234).

<a id="b105"></a>**B105** — [src/endpoints/auditRecord/audit-record-router.js:86](../../src/endpoints/auditRecord/audit-record-router.js#L86) · throw · `recordRow`

` throw ruleError('Invalid record ID.',400); `

**Proved:** [T1235](#t1235).

<a id="b106"></a>**B106** — [src/endpoints/auditRecord/audit-record-router.js:88](../../src/endpoints/auditRecord/audit-record-router.js#L88) · throw · `recordRow`

` throw ruleError('Audit record not found.',404); `

**Proved:** [T1235](#t1235), [T1224](#t1224).

<a id="b107"></a>**B107** — [src/endpoints/auditRecord/audit-record-router.js:89](../../src/endpoints/auditRecord/audit-record-router.js#L89) · throw · `recordRow`

` throw ruleError('Audit record storage identity is invalid.',409); `

**Proved:** [T1232](#t1232).

<a id="b108"></a>**B108** — [src/endpoints/auditRecord/audit-record-router.js:95](../../src/endpoints/auditRecord/audit-record-router.js#L95) · throw · `stored`

` throw new Error('Missing stored PDF'); `

**Proved:** [T1234](#t1234).

<a id="b109"></a>**B109** — [src/endpoints/auditRecord/audit-record-router.js:108](../../src/endpoints/auditRecord/audit-record-router.js#L108) · throw · `storedEvidence`

` throw ruleError('This legacy record has no separate evidence archive.',404); `

**Proved:** [T1233](#t1233).

<a id="b110"></a>**B110** — [src/endpoints/auditRecord/audit-record-router.js:109](../../src/endpoints/auditRecord/audit-record-router.js#L109) · throw · `storedEvidence`

` throw ruleError('Audit evidence storage identity is invalid.',409); `

**Proved:** [T1233](#t1233).

<a id="b111"></a>**B111** — [src/endpoints/auditRecord/audit-record-router.js:111](../../src/endpoints/auditRecord/audit-record-router.js#L111) · throw · `storedEvidence`

` throw new Error('Missing stored evidence'); `

**Proved:** [T1234](#t1234).

<a id="b112"></a>**B112** — [src/endpoints/auditRecord/audit-record-router.js:126](../../src/endpoints/auditRecord/audit-record-router.js#L126) · throw · `<handler>`

` throw ruleError('Stored evidence failed verification. Download blocked.',409,'AUDIT_EVIDENCE_TAMPERED'); `

**Proved:** [T1233](#t1233), [T1227](#t1227).

<a id="b113"></a>**B113** — [src/endpoints/auditRecord/audit-record-router.js:132](../../src/endpoints/auditRecord/audit-record-router.js#L132) · throw · `<handler>`

` throw ruleError('Stored PDF failed verification. Download blocked.',409,'AUDIT_DOCUMENT_TAMPERED'); `

**Proved:** [T1226](#t1226).

### src/endpoints/auditRecord/audit-record-service.js

<a id="b114"></a>**B114** — [src/endpoints/auditRecord/audit-record-service.js:76](../../src/endpoints/auditRecord/audit-record-service.js#L76) · throw · `customer`

` throw ruleError('Customer not found.',404); `

**Proved:** [T1223](#t1223), [T1225](#t1225).

<a id="b115"></a>**B115** — [src/endpoints/auditRecord/audit-record-service.js:82](../../src/endpoints/auditRecord/audit-record-service.js#L82) · throw · `history`

` throw ruleError('Audit chain verification failed. Record generation is blocked.',409,'AUDIT_INTEGRITY_FAILED'); `

**Proved:** [T1227](#t1227).

### src/endpoints/auth/account-scope.js

<a id="b116"></a>**B116** — [src/endpoints/auth/account-scope.js:9](../../src/endpoints/auth/account-scope.js#L9) · response · `enforceAccountId`

` res.status(401).json({ message: 'Unauthorized request', status: 401 }) `

**unreachable:** All mounted uses follow requireAuth, which rejects missing/invalid identities and populates both user_id and account_id from the stored user before router.param runs.

<a id="b117"></a>**B117** — [src/endpoints/auth/account-scope.js:14](../../src/endpoints/auth/account-scope.js#L14) · response · `enforceAccountId`

` res.status(403).json({ message: 'Account access denied', status: 403 }) `

**Proved:** [T0527](#t0527), [T0674](#t0674).

<a id="b118"></a>**B118** — [src/endpoints/auth/account-scope.js:30](../../src/endpoints/auth/account-scope.js#L30) · response · `enforceSelfOrPrivileged`

` res.status(401).json({ message: 'Unauthorized request', status: 401 }) `

**unreachable:** All mounted uses follow requireAuth, which rejects missing/invalid identities and populates both user_id and account_id from the stored user before router.param runs.

<a id="b119"></a>**B119** — [src/endpoints/auth/account-scope.js:39](../../src/endpoints/auth/account-scope.js#L39) · response · `enforceSelfOrPrivileged`

` res.status(403).json({ message: 'Access denied for this user', status: 403 }) `

**Proved:** [T0863](#t0863), [T0870](#t0870).

### src/endpoints/auth/auth-router.js

<a id="b120"></a>**B120** — [src/endpoints/auth/auth-router.js:32](../../src/endpoints/auth/auth-router.js#L32) · response · `<handler>`

` res.status(400).json({ error: 'Missing Google credential', status: 400 }) `

**Proved:** [T0118](#t0118), [T0119](#t0119).

<a id="b121"></a>**B121** — [src/endpoints/auth/auth-router.js:41](../../src/endpoints/auth/auth-router.js#L41) · catch · `<handler>`

` catch (err) { console.error('Google ID token verification failed:', err.message); return res.status(401).json({ error: err.message || 'Invalid Google credential', status: 401 }); } `

**Proved:** [T0844](#t0844), [T0843](#t0843).

<a id="b122"></a>**B122** — [src/endpoints/auth/auth-router.js:43](../../src/endpoints/auth/auth-router.js#L43) · response · `<handler>`

` res.status(401).json({ error: err.message || 'Invalid Google credential', status: 401 }) `

**Proved:** [T0844](#t0844), [T0843](#t0843).

<a id="b123"></a>**B123** — [src/endpoints/auth/auth-router.js:54](../../src/endpoints/auth/auth-router.js#L54) · response · `<handler>`

` res.status(403).json({ error: 'Your account is not provisioned in DS2. Contact your administrator.', status: 403 }) `

**Proved:** [T0841](#t0841).

### src/endpoints/auth/auth-service.js

<a id="b124"></a>**B124** — [src/endpoints/auth/auth-service.js:18](../../src/endpoints/auth/auth-service.js#L18) · throw · `verifyGoogleIdToken`

`` throw new Error(`Access restricted to ${config.GOOGLE_WORKSPACE_DOMAIN} Workspace accounts`); ``

**Proved:** [T0844](#t0844).

<a id="b125"></a>**B125** — [src/endpoints/auth/auth-service.js:21](../../src/endpoints/auth/auth-service.js#L21) · throw · `verifyGoogleIdToken`

` throw new Error('Email not verified by Google'); `

**Proved:** [T0843](#t0843).

### src/endpoints/auth/jwt-auth.js

<a id="b126"></a>**B126** — [src/endpoints/auth/jwt-auth.js:22](../../src/endpoints/auth/jwt-auth.js#L22) · response · `requireAuth`

` res.status(401).json({ message: 'Missing authentication token', status: 401 }) `

**Proved:** [T0663](#t0663), [T0372](#t0372).

<a id="b127"></a>**B127** — [src/endpoints/auth/jwt-auth.js:33](../../src/endpoints/auth/jwt-auth.js#L33) · response · `requireAuth`

` res.status(401).json({ message: 'Unauthorized request', status: 401 }) `

**Proved:** [T1066](#t1066), [T1067](#t1067).

<a id="b128"></a>**B128** — [src/endpoints/auth/jwt-auth.js:48](../../src/endpoints/auth/jwt-auth.js#L48) · catch · `requireAuth`

`` catch (error) { console.error(`Authentication error: ${error}`); if (error instanceof jwt.TokenExpiredError) { return res.status(401).json({ message: 'Expired token', status: 401 }); } else { return res.status(401).json({ message: 'Unauthorized request', statu ``

**Proved:** [T0858](#t0858), [T0859](#t0859).

<a id="b129"></a>**B129** — [src/endpoints/auth/jwt-auth.js:51](../../src/endpoints/auth/jwt-auth.js#L51) · response · `requireAuth`

` res.status(401).json({ message: 'Expired token', status: 401 }) `

**Proved:** [T0858](#t0858), [T1066](#t1066).

<a id="b130"></a>**B130** — [src/endpoints/auth/jwt-auth.js:56](../../src/endpoints/auth/jwt-auth.js#L56) · response · `requireAuth`

` res.status(401).json({ message: 'Unauthorized request', status: 401 }) `

**Proved:** [T0859](#t0859), [T0857](#t0857).

<a id="b131"></a>**B131** — [src/endpoints/auth/jwt-auth.js:67](../../src/endpoints/auth/jwt-auth.js#L67) · response · `<handler>`

` res.status(401).json({ message: 'Missing authentication token', status: 401 }) `

**unreachable:** All mounted role checks follow requireAuth using the same request token. Missing/invalid tokens are refused by requireAuth before checkRole can repeat the token check.

<a id="b132"></a>**B132** — [src/endpoints/auth/jwt-auth.js:73](../../src/endpoints/auth/jwt-auth.js#L73) · catch · `<handler>`

` catch (err) { return res.status(401).json({ message: 'Invalid token', status: 401 }); } `

**unreachable:** All mounted role checks follow requireAuth using the same request token. Missing/invalid tokens are refused by requireAuth before checkRole can repeat the token check.

<a id="b133"></a>**B133** — [src/endpoints/auth/jwt-auth.js:74](../../src/endpoints/auth/jwt-auth.js#L74) · response · `<handler>`

` res.status(401).json({ message: 'Invalid token', status: 401 }) `

**unreachable:** All mounted role checks follow requireAuth using the same request token. Missing/invalid tokens are refused by requireAuth before checkRole can repeat the token check.

<a id="b134"></a>**B134** — [src/endpoints/auth/jwt-auth.js:83](../../src/endpoints/auth/jwt-auth.js#L83) · response · `<handler>`

` res.status(403).json({ message: 'Unauthorized', status: 403 }) `

**Proved:** [T0788](#t0788), [T0716](#t0716).

### src/endpoints/billingReview/billingReview-router.js

<a id="b135"></a>**B135** — [src/endpoints/billingReview/billingReview-router.js:96](../../src/endpoints/billingReview/billingReview-router.js#L96) · response · `<handler>`

` res.status(400).json({ message: 'Invalid pagination parameters. page and limit must be positive integers (limit at most 500).' }) `

**Proved:** [T0144](#t0144).

<a id="b136"></a>**B136** — [src/endpoints/billingReview/billingReview-router.js:138](../../src/endpoints/billingReview/billingReview-router.js#L138) · catch · `<handler>`

` catch (err) { const status = SERVICE_ERROR_STATUS[err.code] || 500; if (status >= 500) _logUnexpected('applyHeldEntry', err); res.status(status).json({ ..._errorBody(err, status, 'The held entry could not be applied.'), field: err.field }); } `

**Proved:** [T0944](#t0944), [T0945](#t0945).

<a id="b137"></a>**B137** — [src/endpoints/billingReview/billingReview-router.js:141](../../src/endpoints/billingReview/billingReview-router.js#L141) · response · `<handler>`

` res.status(status).json({ ..._errorBody(err, status, 'The held entry could not be applied.'), field: err.field }) `

**Proved:** [T0944](#t0944), [T0945](#t0945).

<a id="b138"></a>**B138** — [src/endpoints/billingReview/billingReview-router.js:161](../../src/endpoints/billingReview/billingReview-router.js#L161) · response · `<handler>`

` res.status(400).json({ message: 'start and end query params are required (YYYY-MM-DD)' }) `

**Proved:** [T0150](#t0150).

<a id="b139"></a>**B139** — [src/endpoints/billingReview/billingReview-router.js:165](../../src/endpoints/billingReview/billingReview-router.js#L165) · response · `<handler>`

` res.status(400).json({ message: 'start and end must be YYYY-MM-DD format' }) `

**Proved:** [T0151](#t0151).

<a id="b140"></a>**B140** — [src/endpoints/billingReview/billingReview-router.js:198](../../src/endpoints/billingReview/billingReview-router.js#L198) · response · `<handler>`

` res.status(400).json({ message: 'customerId, start, end query params are all required' }) `

**Proved:** [T0146](#t0146).

<a id="b141"></a>**B141** — [src/endpoints/billingReview/billingReview-router.js:224](../../src/endpoints/billingReview/billingReview-router.js#L224) · catch · `<handler>`

` catch (err) { const status = SERVICE_ERROR_STATUS[err.code] || 500; if (status >= 500) _logUnexpected('reprocess-count', err); res.status(status).json(_errorBody(err, status, 'Could not count entries to reprocess.')); } `

**Proved:** [T0148](#t0148).

<a id="b142"></a>**B142** — [src/endpoints/billingReview/billingReview-router.js:227](../../src/endpoints/billingReview/billingReview-router.js#L227) · response · `<handler>`

` res.status(status).json(_errorBody(err, status, 'Could not count entries to reprocess.')) `

**Proved:** [T0148](#t0148).

<a id="b143"></a>**B143** — [src/endpoints/billingReview/billingReview-router.js:250](../../src/endpoints/billingReview/billingReview-router.js#L250) · response · `<handler>`

` res.status(503).json({ message: 'Auto-ingest is not enabled for this account. Set TIME_TRACKER_AI_FEATURE_FLAG=test or on and add this account to TIME_TRACKER_AI_TEST_ACCOUNT_IDS to use this button.', code: 'flag_off' }) `

**Proved:** [T0970](#t0970), [T0875](#t0875).

<a id="b144"></a>**B144** — [src/endpoints/billingReview/billingReview-router.js:262](../../src/endpoints/billingReview/billingReview-router.js#L262) · catch · `<handler>`

` catch (err) { if (err.code === 'BAD_MODE') return res.status(400).json({ message: err.message, code: 'bad_mode' }); _logUnexpected('reprocess', err); return res.status(500).json({ message: clientSafeMessage(err, 'Could not queue the reprocess job.') }); } `

**Proved:** [T0871](#t0871), [T0873](#t0873).

<a id="b145"></a>**B145** — [src/endpoints/billingReview/billingReview-router.js:263](../../src/endpoints/billingReview/billingReview-router.js#L263) · response · `<handler>`

` res.status(400).json({ message: err.message, code: 'bad_mode' }) `

**Proved:** [T0871](#t0871).

<a id="b146"></a>**B146** — [src/endpoints/billingReview/billingReview-router.js:265](../../src/endpoints/billingReview/billingReview-router.js#L265) · response · `<handler>`

` res.status(500).json({ message: clientSafeMessage(err, 'Could not queue the reprocess job.') }) `

**Proved:** [T0873](#t0873).

<a id="b147"></a>**B147** — [src/endpoints/billingReview/billingReview-router.js:294](../../src/endpoints/billingReview/billingReview-router.js#L294) · response · `<handler>`

` res.status(503).json({ message: 'AI pipeline is not enabled for this account.', code: 'flag_off' }) `

**Proved:** [T0874](#t0874).

<a id="b148"></a>**B148** — [src/endpoints/billingReview/billingReview-router.js:303](../../src/endpoints/billingReview/billingReview-router.js#L303) · catch · `<handler>`

` catch (err) { const status = SERVICE_ERROR_STATUS[err.code] || 500; if (status >= 500) _logUnexpected('reprocessWithOverrides', err); res.status(status).json({ ..._errorBody(err, status, 'An unexpected error occurred.'), ...(err.transactionId ? { transactionId `

**Proved:** [T0993](#t0993), [T0008](#t0008).

<a id="b149"></a>**B149** — [src/endpoints/billingReview/billingReview-router.js:306](../../src/endpoints/billingReview/billingReview-router.js#L306) · response · `<handler>`

` res.status(status).json({ ..._errorBody(err, status, 'An unexpected error occurred.'), ...(err.transactionId ? { transactionId: err.transactionId } : {}), decision: 'error' }) `

**Proved:** [T0993](#t0993), [T0008](#t0008).

<a id="b150"></a>**B150** — [src/endpoints/billingReview/billingReview-router.js:334](../../src/endpoints/billingReview/billingReview-router.js#L334) · catch · `<handler>`

` catch (err) { const status = _statusCodeForCascadeError(err.code); if (status >= 500) _logUnexpected('cascade transaction edit', err); res.status(status).json({ ..._errorBody(err, status, 'The transaction could not be updated.'), invoiceId: err.invoiceId, ...( `

**Proved:** [T0940](#t0940), [T0994](#t0994).

<a id="b151"></a>**B151** — [src/endpoints/billingReview/billingReview-router.js:337](../../src/endpoints/billingReview/billingReview-router.js#L337) · response · `<handler>`

` res.status(status).json({ ..._errorBody(err, status, 'The transaction could not be updated.'), invoiceId: err.invoiceId, ...(err.invoiceNumber ? { invoiceNumber: err.invoiceNumber } : {}), ...(err.field ? { field: err.field } : {}) }) `

**Proved:** [T0940](#t0940), [T0994](#t0994).

### src/endpoints/billingReview/billingReview-service.js

<a id="b152"></a>**B152** — [src/endpoints/billingReview/billingReview-service.js:258](../../src/endpoints/billingReview/billingReview-service.js#L258) · throw · `applyHeldEntry`

` throw _serviceError('NOT_FOUND', 'This held entry was not found or has already been applied.'); `

**Proved:** [T0013](#t0013).

<a id="b153"></a>**B153** — [src/endpoints/billingReview/billingReview-service.js:264](../../src/endpoints/billingReview/billingReview-service.js#L264) · throw · `applyHeldEntry`

`` throw _serviceError('MISSING_FIELD', `${HELD_FIELD_LABELS[field]} is required before this entry can be applied.`, { field }); ``

**Proved:** [T0018](#t0018).

<a id="b154"></a>**B154** — [src/endpoints/billingReview/billingReview-service.js:271](../../src/endpoints/billingReview/billingReview-service.js#L271) · throw · `applyHeldEntry`

`` throw _serviceError('INVALID_FIELD', `Customer #${edits.customer_id} was not found in this account.`, { field: 'customer_id' }); ``

**Proved:** [T0943](#t0943).

<a id="b155"></a>**B155** — [src/endpoints/billingReview/billingReview-service.js:274](../../src/endpoints/billingReview/billingReview-service.js#L274) · throw · `applyHeldEntry`

`` throw _serviceError('INVALID_FIELD', `Job #${edits.customer_job_id} does not belong to the chosen customer.`, { field: 'customer_job_id' }); ``

**Proved:** [T0014](#t0014).

<a id="b156"></a>**B156** — [src/endpoints/billingReview/billingReview-service.js:280](../../src/endpoints/billingReview/billingReview-service.js#L280) · throw · `applyHeldEntry`

`` throw _serviceError('INVALID_FIELD', `Work description #${edits.general_work_description_id} was not found in this account.`, { field: 'general_work_description_id' }); ``

**Proved:** [T0015](#t0015).

<a id="b157"></a>**B157** — [src/endpoints/billingReview/billingReview-service.js:282](../../src/endpoints/billingReview/billingReview-service.js#L282) · throw · `applyHeldEntry`

`` throw _serviceError('INVALID_FIELD', `Employee #${edits.logged_for_user_id} was not found in this account.`, { field: 'logged_for_user_id' }); ``

**Proved:** [T0014](#t0014).

<a id="b158"></a>**B158** — [src/endpoints/billingReview/billingReview-service.js:291](../../src/endpoints/billingReview/billingReview-service.js#L291) · throw · `applyHeldEntry`

` throw _serviceError('INVALID_FIELD', 'Duration must be greater than zero minutes.', { field: 'duration_minutes' }); `

**Proved:** [T0017](#t0017).

<a id="b159"></a>**B159** — [src/endpoints/billingReview/billingReview-service.js:296](../../src/endpoints/billingReview/billingReview-service.js#L296) · throw · `applyHeldEntry`

` throw _serviceError('INVALID_FIELD', 'Rate must be a number of zero or more.', { field: 'unit_cost' }); `

**Proved:** [T0944](#t0944), [T0945](#t0945).

<a id="b160"></a>**B160** — [src/endpoints/billingReview/billingReview-service.js:304](../../src/endpoints/billingReview/billingReview-service.js#L304) · throw · `applyHeldEntry`

` throw _serviceError('INVALID_FIELD', 'Rate must have at most 2 decimal places.', { field: 'unit_cost' }); `

**Proved:** [T0016](#t0016).

<a id="b161"></a>**B161** — [src/endpoints/billingReview/billingReview-service.js:335](../../src/endpoints/billingReview/billingReview-service.js#L335) · throw · `<handler>`

` throw _serviceError('NOT_FOUND', 'This held entry was not found or has already been applied.'); `

**Proved:** [T0012](#t0012).

<a id="b162"></a>**B162** — [src/endpoints/billingReview/billingReview-service.js:399](../../src/endpoints/billingReview/billingReview-service.js#L399) · throw · `listEntriesForReprocess`

`` throw _serviceError('BAD_MODE', `unknown reprocess mode: ${mode}`); ``

**Proved:** [T0871](#t0871), [T0148](#t0148).

<a id="b163"></a>**B163** — [src/endpoints/billingReview/billingReview-service.js:496](../../src/endpoints/billingReview/billingReview-service.js#L496) · throw · `<handler>`

` throw _serviceError('NOT_FOUND', 'This time entry was not found.'); `

**Proved:** [T0019](#t0019).

<a id="b164"></a>**B164** — [src/endpoints/billingReview/billingReview-service.js:499](../../src/endpoints/billingReview/billingReview-service.js#L499) · throw · `<handler>`

` throw _alreadyAppliedError(appliedTransactionId); `

**Proved:** [T0993](#t0993), [T0020](#t0020).

### src/endpoints/billingReview/cascadeEdit.js

<a id="b165"></a>**B165** — [src/endpoints/billingReview/cascadeEdit.js:202](../../src/endpoints/billingReview/cascadeEdit.js#L202) · throw · `_normalizeUpdates`

`` throw _invalid(field, `${label} is required.`); ``

**Proved:** [T0038](#t0038).

<a id="b166"></a>**B166** — [src/endpoints/billingReview/cascadeEdit.js:205](../../src/endpoints/billingReview/cascadeEdit.js#L205) · throw · `_normalizeUpdates`

`` throw _invalid(field, `${label} must be a valid id.`); ``

**Proved:** [T0038](#t0038).

<a id="b167"></a>**B167** — [src/endpoints/billingReview/cascadeEdit.js:211](../../src/endpoints/billingReview/cascadeEdit.js#L211) · throw · `_normalizeUpdates`

`` throw _invalid(field, `${label} must be a valid date (YYYY-MM-DD).`); ``

**Proved:** [T1075](#t1075), [T0038](#t0038).

<a id="b168"></a>**B168** — [src/endpoints/billingReview/cascadeEdit.js:216](../../src/endpoints/billingReview/cascadeEdit.js#L216) · throw · `_normalizeUpdates`

`` throw _invalid(field, `${label} is required.`); ``

**Proved:** [T1076](#t1076), [T0038](#t0038).

<a id="b169"></a>**B169** — [src/endpoints/billingReview/cascadeEdit.js:218](../../src/endpoints/billingReview/cascadeEdit.js#L218) · throw · `_normalizeUpdates`

`` throw _invalid(field, `${label} must be a number between 0 and ${MAX_AMOUNT}.`); ``

**Proved:** [T1073](#t1073), [T1074](#t1074).

<a id="b170"></a>**B170** — [src/endpoints/billingReview/cascadeEdit.js:224](../../src/endpoints/billingReview/cascadeEdit.js#L224) · throw · `_normalizeUpdates`

`` throw _invalid(field, `${label} must be true or false.`); ``

**Proved:** [T1071](#t1071), [T0038](#t0038).

<a id="b171"></a>**B171** — [src/endpoints/billingReview/cascadeEdit.js:229](../../src/endpoints/billingReview/cascadeEdit.js#L229) · throw · `_normalizeUpdates`

`` throw _invalid(field, `${label} must be text.`); ``

**Proved:** [T1072](#t1072).

<a id="b172"></a>**B172** — [src/endpoints/billingReview/cascadeEdit.js:347](../../src/endpoints/billingReview/cascadeEdit.js#L347) · throw · `_assertChainAcceptsDelta`

` throw _err(ERRORS.INVOICE_LOCKED, MESSAGES.ABSORBED, { invoiceId, invoiceNumber: root.invoice_number, reason: 'absorbed', absorbedBy: newerParent ? newerParent.invoice_number : null }); `

**Proved:** [T0010](#t0010), [T0023](#t0023).

<a id="b173"></a>**B173** — [src/endpoints/billingReview/cascadeEdit.js:357](../../src/endpoints/billingReview/cascadeEdit.js#L357) · throw · `_assertChainAcceptsDelta`

` throw _err(ERRORS.INVOICE_LOCKED, MESSAGES.PAID_IN_FULL, { invoiceId, invoiceNumber: root.invoice_number, reason: 'paid_in_full' }); `

**Proved:** [T0022](#t0022), [T0033](#t0033).

<a id="b174"></a>**B174** — [src/endpoints/billingReview/cascadeEdit.js:363](../../src/endpoints/billingReview/cascadeEdit.js#L363) · throw · `_assertChainAcceptsDelta`

`` throw _err( ERRORS.EDIT_WOULD_CREATE_CREDIT, `This change would leave statement ${root.invoice_number || `#${root.customer_invoice_id}`} with a credit of $${Math.abs(next).toFixed(2)} because payments already exceed the new total. Record a write-off or credit on the current statement instead.`, { invoiceId, invoiceNumber: root.invoice_num ``

**Proved:** [T0021](#t0021).

<a id="b175"></a>**B175** — [src/endpoints/billingReview/cascadeEdit.js:446](../../src/endpoints/billingReview/cascadeEdit.js#L446) · throw · `_assertDateInsidePeriod`

`` throw _err( ERRORS.DATE_OUTSIDE_INVOICE, `${newDate} is outside the billing period of statement ${chain.root.invoice_number || `#${chain.root.customer_invoice_id}`} (${start} to ${end}). Choose a date inside that period.`, { invoiceId: linkedInvoiceId, periodStart: start, periodEnd: end } ); ``

**Proved:** [T0090](#t0090), [T0036](#t0036).

<a id="b176"></a>**B176** — [src/endpoints/billingReview/cascadeEdit.js:461](../../src/endpoints/billingReview/cascadeEdit.js#L461) · throw · `_validateReferences`

`` throw _invalid('customer_id', `Customer #${requested.customer_id} was not found in this account.`); ``

**Proved:** [T0995](#t0995).

<a id="b177"></a>**B177** — [src/endpoints/billingReview/cascadeEdit.js:465](../../src/endpoints/billingReview/cascadeEdit.js#L465) · throw · `_validateReferences`

` throw _err(ERRORS.JOB_REQUIRED_FOR_CUSTOMER_CHANGE, MESSAGES.JOB_MISSING_FOR_CUSTOMER_CHANGE, { field: 'customer_job_id' }); `

**Proved:** [T0091](#t0091), [T0009](#t0009).

<a id="b178"></a>**B178** — [src/endpoints/billingReview/cascadeEdit.js:469](../../src/endpoints/billingReview/cascadeEdit.js#L469) · throw · `_validateReferences`

`` throw _err(ERRORS.JOB_REQUIRED_FOR_CUSTOMER_CHANGE, `Job #${jobId} does not belong to the new customer. Pick a job that belongs to the new customer.`, { field: 'customer_job_id' }); ``

**Proved:** [T0091](#t0091), [T0026](#t0026).

<a id="b179"></a>**B179** — [src/endpoints/billingReview/cascadeEdit.js:474](../../src/endpoints/billingReview/cascadeEdit.js#L474) · throw · `_validateReferences`

` throw _invalid('customer_job_id', MESSAGES.JOB_REQUIRED); `

**Proved:** [T1069](#t1069), [T0027](#t0027).

<a id="b180"></a>**B180** — [src/endpoints/billingReview/cascadeEdit.js:477](../../src/endpoints/billingReview/cascadeEdit.js#L477) · throw · `_validateReferences`

`` throw _invalid('customer_job_id', `Job #${requested.customer_job_id} does not belong to this transaction's customer.`); ``

**Proved:** [T1068](#t1068), [T0025](#t0025).

<a id="b181"></a>**B181** — [src/endpoints/billingReview/cascadeEdit.js:485](../../src/endpoints/billingReview/cascadeEdit.js#L485) · throw · `_validateReferences`

`` throw _invalid('general_work_description_id', `Work description #${requested.general_work_description_id} was not found in this account.`); ``

**Proved:** [T1070](#t1070), [T0034](#t0034).

<a id="b182"></a>**B182** — [src/endpoints/billingReview/cascadeEdit.js:494](../../src/endpoints/billingReview/cascadeEdit.js#L494) · catch · `_sanitizeNotes`

` catch (redactErr) { // Comprehend failed — skip notes rather than leak raw text return null; } `

**unreachable:** detectAndRedact catches Comprehend errors and returns deterministic string redaction; rawNotes is a database text string and knownNames is the literal empty array. The shared helper cannot reject for these inputs. Its actual fallback is asserted with an email fixture in path-matrix-10.

<a id="b183"></a>**B183** — [src/endpoints/billingReview/cascadeEdit.js:505](../../src/endpoints/billingReview/cascadeEdit.js#L505) · catch · `_inSavepoint`

`` catch (e) { console.error(`[cascadeEdit] ${label} failed:`, e.message); return null; } ``

**Proved:** [T0942](#t0942).

<a id="b184"></a>**B184** — [src/endpoints/billingReview/cascadeEdit.js:530](../../src/endpoints/billingReview/cascadeEdit.js#L530) · catch · `_labelForField`

` catch { /* label lookup failure is non-fatal */ } `

**Proved:** [T0941](#t0941).

<a id="b185"></a>**B185** — [src/endpoints/billingReview/cascadeEdit.js:569](../../src/endpoints/billingReview/cascadeEdit.js#L569) · throw · `_planEdit`

` throw _err(ERRORS.CUSTOMER_CHANGE_NEEDS_CONFIRM, MESSAGES.CUSTOMER_CHANGE_NEEDS_CONFIRM); `

**Proved:** [T0028](#t0028), [T0011](#t0011).

<a id="b186"></a>**B186** — [src/endpoints/billingReview/cascadeEdit.js:576](../../src/endpoints/billingReview/cascadeEdit.js#L576) · throw · `_planEdit`

` throw _err(ERRORS.RETAINER_NOT_EDITABLE_HERE, MESSAGES.RETAINER_FUNDED); `

**Proved:** [T1065](#t1065), [T0037](#t0037).

<a id="b187"></a>**B187** — [src/endpoints/billingReview/cascadeEdit.js:625](../../src/endpoints/billingReview/cascadeEdit.js#L625) · catch · `_lockLedgers`

`` catch (e) { if (!e || !e.isLedgerRule) throw e; // No such customer in this account (tenancy is checked by the lock). if (id === requestedCustomerId) throw _invalid('customer_id', `Customer #${id} was not found in this account.`); throw _err(ERRORS.NOT_FOUND,  ``

**Proved:** [T0940](#t0940), [T1138](#t1138).

<a id="b188"></a>**B188** — [src/endpoints/billingReview/cascadeEdit.js:626](../../src/endpoints/billingReview/cascadeEdit.js#L626) · throw · `_lockLedgers`

` throw e; `

**Proved:** [T1138](#t1138).

<a id="b189"></a>**B189** — [src/endpoints/billingReview/cascadeEdit.js:628](../../src/endpoints/billingReview/cascadeEdit.js#L628) · throw · `_lockLedgers`

`` throw _invalid('customer_id', `Customer #${id} was not found in this account.`); ``

**Proved:** [T0940](#t0940), [T0024](#t0024).

<a id="b190"></a>**B190** — [src/endpoints/billingReview/cascadeEdit.js:629](../../src/endpoints/billingReview/cascadeEdit.js#L629) · throw · `_lockLedgers`

` throw _err(ERRORS.NOT_FOUND, MESSAGES.CUSTOMER_MISSING); `

**Proved:** [T0032](#t0032).

<a id="b191"></a>**B191** — [src/endpoints/billingReview/cascadeEdit.js:653](../../src/endpoints/billingReview/cascadeEdit.js#L653) · throw · `_applyLockedEdit`

` throw _err(ERRORS.NOT_FOUND, MESSAGES.NOT_FOUND); `

**Proved:** [T1136](#t1136).

<a id="b192"></a>**B192** — [src/endpoints/billingReview/cascadeEdit.js:655](../../src/endpoints/billingReview/cascadeEdit.js#L655) · throw · `_applyLockedEdit`

` throw _relock([...locked, ...needed]); `

**Proved:** [T0031](#t0031), [T0029](#t0029).

<a id="b193"></a>**B193** — [src/endpoints/billingReview/cascadeEdit.js:679](../../src/endpoints/billingReview/cascadeEdit.js#L679) · throw · `_applyLockedEdit`

` throw _err(ERRORS.INVOICE_LOCKED, MESSAGES.INVOICE_MISSING, { invoiceId: linkedInvoiceId, reason: 'invoice_missing' }); `

**Proved:** [T0994](#t0994).

<a id="b194"></a>**B194** — [src/endpoints/billingReview/cascadeEdit.js:683](../../src/endpoints/billingReview/cascadeEdit.js#L683) · throw · `_applyLockedEdit`

` throw _relock([...locked, chainCustomerId]); `

**Proved:** [T0030](#t0030).

<a id="b195"></a>**B195** — [src/endpoints/billingReview/cascadeEdit.js:806](../../src/endpoints/billingReview/cascadeEdit.js#L806) · throw · `applyTransactionEdit`

` throw _err(ERRORS.NOT_FOUND, MESSAGES.NOT_FOUND); `

**Proved:** [T1082](#t1082).

<a id="b196"></a>**B196** — [src/endpoints/billingReview/cascadeEdit.js:810](../../src/endpoints/billingReview/cascadeEdit.js#L810) · throw · `applyTransactionEdit`

` throw _err(ERRORS.NOT_FOUND, MESSAGES.NOT_FOUND); `

**Proved:** [T1080](#t1080), [T1081](#t1081).

<a id="b197"></a>**B197** — [src/endpoints/billingReview/cascadeEdit.js:814](../../src/endpoints/billingReview/cascadeEdit.js#L814) · throw · `applyTransactionEdit`

` throw _err(ERRORS.RETAINER_NOT_EDITABLE_HERE, MESSAGES.RETAINER_FIELD); `

**Proved:** [T1065](#t1065), [T0035](#t0035).

<a id="b198"></a>**B198** — [src/endpoints/billingReview/cascadeEdit.js:830](../../src/endpoints/billingReview/cascadeEdit.js#L830) · catch · `applyTransactionEdit`

` catch (e) { if (!(e && e[RELOCK])) throw e; if (attempt >= MAX_LOCK_ATTEMPTS) throw _err(ERRORS.CONCURRENT_EDIT, MESSAGES.CONCURRENT_EDIT); lockIds = e[RELOCK]; } `

**Proved:** [T0940](#t0940), [T0994](#t0994).

<a id="b199"></a>**B199** — [src/endpoints/billingReview/cascadeEdit.js:831](../../src/endpoints/billingReview/cascadeEdit.js#L831) · throw · `applyTransactionEdit`

` throw e; `

**Proved:** [T0940](#t0940), [T0994](#t0994).

<a id="b200"></a>**B200** — [src/endpoints/billingReview/cascadeEdit.js:832](../../src/endpoints/billingReview/cascadeEdit.js#L832) · throw · `applyTransactionEdit`

` throw _err(ERRORS.CONCURRENT_EDIT, MESSAGES.CONCURRENT_EDIT); `

**Proved:** [T0029](#t0029).

### src/endpoints/customer/customer-router.js

<a id="b201"></a>**B201** — [src/endpoints/customer/customer-router.js:55](../../src/endpoints/customer/customer-router.js#L55) · throw · `<handler>`

` throw new Error('Customer already exists with that name.'); `

**Proved:** [T1053](#t1053).

<a id="b202"></a>**B202** — [src/endpoints/customer/customer-router.js:67](../../src/endpoints/customer/customer-router.js#L67) · throw · `<handler>`

` throw new Error('Error Inserting Customer Into Customer Table.'); `

**Proved:** [T0845](#t0845).

<a id="b203"></a>**B203** — [src/endpoints/customer/customer-router.js:78](../../src/endpoints/customer/customer-router.js#L78) · throw · `<handler>`

` throw new Error('Error Inserting Customer Into Customer Information Table.'); `

**Proved:** [T0846](#t0846).

<a id="b204"></a>**B204** — [src/endpoints/customer/customer-router.js:86](../../src/endpoints/customer/customer-router.js#L86) · throw · `<handler>`

` throw new Error('Error Inserting Customer Into Recurring Customer Table.'); `

**Proved:** [T0847](#t0847).

<a id="b205"></a>**B205** — [src/endpoints/customer/customer-router.js:112](../../src/endpoints/customer/customer-router.js#L112) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while creating the customer.', status: 500 }); } `

**Proved:** [T0845](#t0845), [T0847](#t0847).

<a id="b206"></a>**B206** — [src/endpoints/customer/customer-router.js:114](../../src/endpoints/customer/customer-router.js#L114) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while creating the customer.', status: 500 }) `

**Proved:** [T0845](#t0845), [T0847](#t0847).

<a id="b207"></a>**B207** — [src/endpoints/customer/customer-router.js:140](../../src/endpoints/customer/customer-router.js#L140) · response · `<handler>`

` res.status(404).send({ message: 'Customer not found.', status: 404 }) `

**Proved:** [T1055](#t1055), [T0106](#t0106).

<a id="b208"></a>**B208** — [src/endpoints/customer/customer-router.js:194](../../src/endpoints/customer/customer-router.js#L194) · catch · `<handler>`

` catch (err) { // Express 4 never forwards awaited rejections — without this, a single // failed query (e.g. a non-numeric customerID reaching knex) escapes as // an unhandled rejection and kills the process on Node 20. console.log(err); res.send({ message: err `

**Proved:** [T0831](#t0831), [T1112](#t1112).

<a id="b209"></a>**B209** — [src/endpoints/customer/customer-router.js:199](../../src/endpoints/customer/customer-router.js#L199) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while retrieving the customer profile.', status: 500 }) `

**Proved:** [T0831](#t0831), [T1112](#t1112).

<a id="b210"></a>**B210** — [src/endpoints/customer/customer-router.js:223](../../src/endpoints/customer/customer-router.js#L223) · catch · `<handler>`

` catch (err) { console.log(err); res.status(500).send({ message: err.message || 'An error occurred while generating the statement.', status: 500 }); } `

**Proved:** [T0189](#t0189).

<a id="b211"></a>**B211** — [src/endpoints/customer/customer-router.js:225](../../src/endpoints/customer/customer-router.js#L225) · response · `<handler>`

` res.status(500).send({ message: err.message || 'An error occurred while generating the statement.', status: 500 }) `

**Proved:** [T0189](#t0189).

<a id="b212"></a>**B212** — [src/endpoints/customer/customer-router.js:260](../../src/endpoints/customer/customer-router.js#L260) · throw · `<handler>`

` throw new Error('Recurring row does not belong to this customer.'); `

**Proved:** [T1047](#t1047).

<a id="b213"></a>**B213** — [src/endpoints/customer/customer-router.js:265](../../src/endpoints/customer/customer-router.js#L265) · throw · `<handler>`

` throw new Error('Customer was not found.'); `

**Proved:** [T0855](#t0855), [T1162](#t1162).

<a id="b214"></a>**B214** — [src/endpoints/customer/customer-router.js:267](../../src/endpoints/customer/customer-router.js#L267) · throw · `<handler>`

` throw new Error('Customer contact was not found in this account.'); `

**Proved:** [T1133](#t1133), [T1035](#t1035).

<a id="b215"></a>**B215** — [src/endpoints/customer/customer-router.js:315](../../src/endpoints/customer/customer-router.js#L315) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while updating the customer.', status: 500 }); } `

**Proved:** [T0855](#t0855), [T1133](#t1133).

<a id="b216"></a>**B216** — [src/endpoints/customer/customer-router.js:317](../../src/endpoints/customer/customer-router.js#L317) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while updating the customer.', status: 500 }) `

**Proved:** [T0855](#t0855), [T1133](#t1133).

<a id="b217"></a>**B217** — [src/endpoints/customer/customer-router.js:335](../../src/endpoints/customer/customer-router.js#L335) · response · `<handler>`

` res.send({ message: 'No matching customer record found.', status: 404 }) `

**Proved:** [T0809](#t0809).

<a id="b218"></a>**B218** — [src/endpoints/customer/customer-router.js:351](../../src/endpoints/customer/customer-router.js#L351) · throw · `<handler>`

` throw new Error('Cannot delete customer with associated jobs, retainers, invoices, payments, write-offs, transactions, recurring customers, or quotes. Please disable customer instead.'); `

**Proved:** [T0094](#t0094), [T0096](#t0096).

<a id="b219"></a>**B219** — [src/endpoints/customer/customer-router.js:358](../../src/endpoints/customer/customer-router.js#L358) · response · `<handler>`

` res.send({ message: 'No matching customer record found.', status: 404 }) `

**Proved:** [T0095](#t0095).

<a id="b220"></a>**B220** — [src/endpoints/customer/customer-router.js:375](../../src/endpoints/customer/customer-router.js#L375) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while deleting the Customer.', status: 500 }); } `

**Proved:** [T1054](#t1054), [T1168](#t1168).

<a id="b221"></a>**B221** — [src/endpoints/customer/customer-router.js:377](../../src/endpoints/customer/customer-router.js#L377) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while deleting the Customer.', status: 500 }) `

**Proved:** [T1054](#t1054), [T1168](#t1168).

<a id="b222"></a>**B222** — [src/endpoints/customer/customer-router.js:422](../../src/endpoints/customer/customer-router.js#L422) · catch · `<handler>`

` catch (error) { console.error('Error fetching paginated customers:', error); const isPaginationError = error.message && error.message.includes('Invalid pagination'); const statusCode = isPaginationError ? 400 : 500; res.status(statusCode).send({ message: error `

**Proved:** [T0830](#t0830), [T0104](#t0104).

<a id="b223"></a>**B223** — [src/endpoints/customer/customer-router.js:426](../../src/endpoints/customer/customer-router.js#L426) · response · `<handler>`

` res.status(statusCode).send({ message: error.message || 'An error occurred while retrieving customers.', status: statusCode }) `

**Proved:** [T0830](#t0830), [T0104](#t0104).

### src/endpoints/customer/customer-statement.js

<a id="b224"></a>**B224** — [src/endpoints/customer/customer-statement.js:18](../../src/endpoints/customer/customer-statement.js#L18) · throw · `<handler>`

` throw new Error('No matching customer record found.'); `

**Proved:** [T0189](#t0189).

### src/endpoints/duplicates/duplicates-service.js

<a id="b225"></a>**B225** — [src/endpoints/duplicates/duplicates-service.js:11](../../src/endpoints/duplicates/duplicates-service.js#L11) · throw · `kindInfo`

` throw ruleError('Choose transaction, payment, writeoff or retainer.',400); `

**Proved:** [T1216](#t1216).

<a id="b226"></a>**B226** — [src/endpoints/duplicates/duplicates-service.js:41](../../src/endpoints/duplicates/duplicates-service.js#L41) · throw · `record`

` throw ruleError('Record not found for this account.',404); `

**Proved:** [T1213](#t1213), [T1217](#t1217).

<a id="b227"></a>**B227** — [src/endpoints/duplicates/duplicates-service.js:46](../../src/endpoints/duplicates/duplicates-service.js#L46) · throw · `audit`

` throw new Error('Duplicate evidence insertion did not return its saved record.'); `

**Proved:** [T1215](#t1215), [T1208](#t1208).

<a id="b228"></a>**B228** — [src/endpoints/duplicates/duplicates-service.js:53](../../src/endpoints/duplicates/duplicates-service.js#L53) · throw · `insertFlag`

` throw new Error('Duplicate flag insertion did not return its saved record.'); `

**Proved:** [T1215](#t1215).

<a id="b229"></a>**B229** — [src/endpoints/duplicates/duplicates-service.js:64](../../src/endpoints/duplicates/duplicates-service.js#L64) · throw · `insertFlag`

` throw new Error('Updated duplicate review was not saved.'); `

**Proved:** [T1208](#t1208).

<a id="b230"></a>**B230** — [src/endpoints/duplicates/duplicates-service.js:68](../../src/endpoints/duplicates/duplicates-service.js#L68) · throw · `insertFlag`

` throw ruleError('This pair already has a duplicate review. Open its existing history.',409); `

**Proved:** [T1209](#t1209).

<a id="b231"></a>**B231** — [src/endpoints/duplicates/duplicates-service.js:89](../../src/endpoints/duplicates/duplicates-service.js#L89) · throw · `flag`

` throw ruleError('A record cannot be its own duplicate.',400); `

**Proved:** [T1218](#t1218).

<a id="b232"></a>**B232** — [src/endpoints/duplicates/duplicates-service.js:95](../../src/endpoints/duplicates/duplicates-service.js#L95) · throw · `<handler>`

` throw ruleError('Both records must belong to the same customer.',400); `

**Proved:** [T1210](#t1210).

<a id="b233"></a>**B233** — [src/endpoints/duplicates/duplicates-service.js:96](../../src/endpoints/duplicates/duplicates-service.js#L96) · throw · `<handler>`

` throw ruleError('Flag the original retainer receipt, not a balance snapshot.',400); `

**Proved:** [T1214](#t1214).

<a id="b234"></a>**B234** — [src/endpoints/duplicates/duplicates-service.js:107](../../src/endpoints/duplicates/duplicates-service.js#L107) · throw · `<handler>`

` throw ruleError('Customer not found.',404); `

**Proved:** [T1219](#t1219).

<a id="b235"></a>**B235** — [src/endpoints/duplicates/duplicates-service.js:131](../../src/endpoints/duplicates/duplicates-service.js#L131) · throw · `list`

` throw ruleError('Status must be open or all.',400); `

**Proved:** [T1219](#t1219).

<a id="b236"></a>**B236** — [src/endpoints/duplicates/duplicates-service.js:133](../../src/endpoints/duplicates/duplicates-service.js#L133) · throw · `list`

` throw ruleError('Customer not found.',404); `

**Proved:** [T1219](#t1219).

<a id="b237"></a>**B237** — [src/endpoints/duplicates/duplicates-service.js:155](../../src/endpoints/duplicates/duplicates-service.js#L155) · throw · `resolve`

` throw ruleError('Choose dismiss or remove.',400); `

**Proved:** [T1219](#t1219).

<a id="b238"></a>**B238** — [src/endpoints/duplicates/duplicates-service.js:159](../../src/endpoints/duplicates/duplicates-service.js#L159) · throw · `<handler>`

` throw ruleError('Duplicate flag not found.',404); `

**Proved:** [T1219](#t1219).

<a id="b239"></a>**B239** — [src/endpoints/duplicates/duplicates-service.js:162](../../src/endpoints/duplicates/duplicates-service.js#L162) · throw · `<handler>`

` throw ruleError('This duplicate review is already resolved.',409); `

**Proved:** [T1209](#t1209), [T1211](#t1211).

<a id="b240"></a>**B240** — [src/endpoints/duplicates/duplicates-service.js:170](../../src/endpoints/duplicates/duplicates-service.js#L170) · throw · `<handler>`

` throw ruleError('Record changed since it was flagged. Dismiss this review and flag the current entry again if needed.',409); `

**Proved:** [T1213](#t1213), [T1208](#t1208).

<a id="b241"></a>**B241** — [src/endpoints/duplicates/duplicates-service.js:178](../../src/endpoints/duplicates/duplicates-service.js#L178) · catch · `<handler>`

` catch(error) { if(error.isLedgerRule || error.code==='P0409') error.statusCode=409; throw error; } `

**Proved:** [T1212](#t1212), [T1215](#t1215).

<a id="b242"></a>**B242** — [src/endpoints/duplicates/duplicates-service.js:178](../../src/endpoints/duplicates/duplicates-service.js#L178) · throw · `<handler>`

` throw error; `

**Proved:** [T1212](#t1212), [T1215](#t1215).

<a id="b243"></a>**B243** — [src/endpoints/duplicates/duplicates-service.js:182](../../src/endpoints/duplicates/duplicates-service.js#L182) · throw · `<handler>`

` throw new Error('Duplicate resolution was not saved.'); `

**Proved:** [T1214](#t1214).

<a id="b244"></a>**B244** — [src/endpoints/duplicates/duplicates-service.js:190](../../src/endpoints/duplicates/duplicates-service.js#L190) · throw · `<handler>`

` throw new Error('Related duplicate resolution was not saved.'); `

**Proved:** [T0933](#t0933).

### src/endpoints/health/health-router.js

<a id="b245"></a>**B245** — [src/endpoints/health/health-router.js:14](../../src/endpoints/health/health-router.js#L14) · catch · `<handler>`

` catch (error) { console.error('Health check DB probe failed:', error.message); res.status(503).json({ status: 'error', db: 'error', message: error.message, timestamp: new Date().toISOString() }); } `

**Proved:** [T0832](#t0832), [T0829](#t0829).

<a id="b246"></a>**B246** — [src/endpoints/health/health-router.js:16](../../src/endpoints/health/health-router.js#L16) · response · `<handler>`

` res.status(503).json({ status: 'error', db: 'error', message: error.message, timestamp: new Date().toISOString() }) `

**Proved:** [T0832](#t0832), [T0829](#t0829).

### src/endpoints/initialData/initialData-router.js

<a id="b247"></a>**B247** — [src/endpoints/initialData/initialData-router.js:28](../../src/endpoints/initialData/initialData-router.js#L28) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while retrieving the initial data.', status: 500 }); } `

**Proved:** [T0833](#t0833).

<a id="b248"></a>**B248** — [src/endpoints/initialData/initialData-router.js:30](../../src/endpoints/initialData/initialData-router.js#L30) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while retrieving the initial data.', status: 500 }) `

**Proved:** [T0833](#t0833).

### src/endpoints/invoice/billingDate.js

<a id="b249"></a>**B249** — [src/endpoints/invoice/billingDate.js:21](../../src/endpoints/invoice/billingDate.js#L21) · catch · `billingDateToday`

` catch (e) { return instant.format('YYYY-MM-DD'); } `

**Proved:** [T0992](#t0992).

### src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js

<a id="b250"></a>**B250** — [src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js:36](../../src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js#L36) · catch · `safeFetchS3LogoBuffer`

`` catch (error) { console.warn(`Unable to load logo from S3 key ${key}: ${error.message}`); return null; } ``

**Proved:** [T0838](#t0838), [T0839](#t0839).

<a id="b251"></a>**B251** — [src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js:80](../../src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js#L80) · catch · `loadCompanyLogo`

`` catch (error) { console.warn(`Unable to load logo using key ${logoKey}: ${error.message}`); } ``

**unreachable:** Every awaited fetch in this outer try is safeFetchS3LogoBuffer, which catches storage failures and returns null. The remaining operations are truthiness tests on buffers/strings; the inner storage-failure path is tested.

<a id="b252"></a>**B252** — [src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js:114](../../src/endpoints/invoice/createInvoice/addDetailToInvoice/addInvoiceDetail.js#L114) · throw · `<handler>`

`` throw new Error(`Customer ${customer_id} has no active mailing address on file; add one before invoicing.`); ``

**Proved:** [T1128](#t1128).

### src/endpoints/invoice/createInvoice/createInvoiceQueries.js

<a id="b253"></a>**B253** — [src/endpoints/invoice/createInvoice/createInvoiceQueries.js:50](../../src/endpoints/invoice/createInvoice/createInvoiceQueries.js#L50) · catch · `fetchInitialQueryItems`

`` catch (error) { console.log(`Error fetching initial query items: ${error.message}`); throw new Error('Error fetching initial query items: ' + error.message); } ``

**Proved:** [T0918](#t0918), [T1220](#t1220).

<a id="b254"></a>**B254** — [src/endpoints/invoice/createInvoice/createInvoiceQueries.js:52](../../src/endpoints/invoice/createInvoice/createInvoiceQueries.js#L52) · throw · `fetchInitialQueryItems`

` throw new Error('Error fetching initial query items: ' + error.message); `

**Proved:** [T0918](#t0918), [T1220](#t1220).

### src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js

<a id="b255"></a>**B255** — [src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js:39](../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js#L39) · catch · `calculateInvoices`

`` catch (error) { console.log(`Error Calculating Invoices: ${error.message}`); throw new Error('Error calculating invoices: ' + error.message); } ``

**Proved:** [T0931](#t0931), [T0927](#t0927).

<a id="b256"></a>**B256** — [src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js:41](../../src/endpoints/invoice/createInvoice/invoiceCalculations/calculateInvoices.js#L41) · throw · `calculateInvoices`

` throw new Error('Error calculating invoices: ' + error.message); `

**Proved:** [T0931](#t0931), [T0927](#t0927).

### src/endpoints/invoice/createInvoice/invoiceCalculations/outstandingInvoicesCalculations.js

<a id="b257"></a>**B257** — [src/endpoints/invoice/createInvoice/invoiceCalculations/outstandingInvoicesCalculations.js:15](../../src/endpoints/invoice/createInvoice/invoiceCalculations/outstandingInvoicesCalculations.js#L15) · throw · `groupAndTotalOutstandingInvoices`

`` throw new Error(`Outstanding Invoice Total on customerID:${customer_id} is NaN`); ``

**Proved:** [T0931](#t0931).

<a id="b258"></a>**B258** — [src/endpoints/invoice/createInvoice/invoiceCalculations/outstandingInvoicesCalculations.js:19](../../src/endpoints/invoice/createInvoice/invoiceCalculations/outstandingInvoicesCalculations.js#L19) · throw · `groupAndTotalOutstandingInvoices`

`` throw new Error(`Outstanding Invoice Total on customerID:${customer_id} is null or undefined`); ``

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

<a id="b259"></a>**B259** — [src/endpoints/invoice/createInvoice/invoiceCalculations/outstandingInvoicesCalculations.js:23](../../src/endpoints/invoice/createInvoice/invoiceCalculations/outstandingInvoicesCalculations.js#L23) · throw · `groupAndTotalOutstandingInvoices`

`` throw new Error(`Outstanding Invoice Total on customerID:${customer_id} is not a number`); ``

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

### src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js

<a id="b260"></a>**B260** — [src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:27](../../src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js#L27) · throw · `groupAndTotalPayments`

`` throw new Error(`Payment Total on customerID:${customer_id} is NaN`); ``

**Proved:** [T0927](#t0927).

<a id="b261"></a>**B261** — [src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:31](../../src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js#L31) · throw · `groupAndTotalPayments`

`` throw new Error(`Payment Total on customerID:${customer_id} is null or undefined`); ``

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

<a id="b262"></a>**B262** — [src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js:35](../../src/endpoints/invoice/createInvoice/invoiceCalculations/paymentsCalculations.js#L35) · throw · `groupAndTotalPayments`

`` throw new Error(`Payment Total on customerID:${customer_id} is not a number`); ``

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

### src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js

<a id="b263"></a>**B263** — [src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js:9](../../src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js#L9) · throw · `groupAndTotalRetainers`

`` throw new Error(`Retainer Total on customerID:${customer_id} is NaN`); ``

**Proved:** [T0928](#t0928).

<a id="b264"></a>**B264** — [src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js:13](../../src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js#L13) · throw · `groupAndTotalRetainers`

`` throw new Error(`Retainer Total on customerID:${customer_id} is null or undefined`); ``

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

<a id="b265"></a>**B265** — [src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js:17](../../src/endpoints/invoice/createInvoice/invoiceCalculations/retainerCalculations.js#L17) · throw · `groupAndTotalRetainers`

`` throw new Error(`Retainer Total on customerID:${customer_id} is not a number`); ``

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

### src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js

<a id="b266"></a>**B266** — [src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:24](../../src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js#L24) · throw · `totalInvoice`

`` throw new Error(`Invoice Total on ${customer_id} is NaN`); ``

**unreachable:** All component sums reject NaN before totalInvoice. They derive from bounded PostgreSQL NUMERIC(10,2) ledger rows with integer identities, so their sum cannot overflow a JS number. round2 returns a number, never null/undefined or another type. These final repeated type guards are defensive invariants.

<a id="b267"></a>**B267** — [src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:28](../../src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js#L28) · throw · `totalInvoice`

`` throw new Error(`Invoice Total on ${customer_id} is null or undefined`); ``

**unreachable:** All component sums reject NaN before totalInvoice. They derive from bounded PostgreSQL NUMERIC(10,2) ledger rows with integer identities, so their sum cannot overflow a JS number. round2 returns a number, never null/undefined or another type. These final repeated type guards are defensive invariants.

<a id="b268"></a>**B268** — [src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js:32](../../src/endpoints/invoice/createInvoice/invoiceCalculations/totalInvoice.js#L32) · throw · `totalInvoice`

`` throw new Error(`Invoice Total on ${customer_id} is not a number`); ``

**unreachable:** All component sums reject NaN before totalInvoice. They derive from bounded PostgreSQL NUMERIC(10,2) ledger rows with integer identities, so their sum cannot overflow a JS number. round2 returns a number, never null/undefined or another type. These final repeated type guards are defensive invariants.

### src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js

<a id="b269"></a>**B269** — [src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:109](../../src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js#L109) · throw · `<handler>`

` throw new Error('Transaction Total is NaN'); `

**Proved:** [T0929](#t0929).

<a id="b270"></a>**B270** — [src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:113](../../src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js#L113) · throw · `<handler>`

` throw new Error('Transaction Total is null or undefined'); `

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

<a id="b271"></a>**B271** — [src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js:117](../../src/endpoints/invoice/createInvoice/invoiceCalculations/transactionCalculations.js#L117) · throw · `<handler>`

` throw new Error('Transaction Total is not a number'); `

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

### src/endpoints/invoice/createInvoice/invoiceCalculations/transactionRetainerPaymentCalculations.js

<a id="b272"></a>**B272** — [src/endpoints/invoice/createInvoice/invoiceCalculations/transactionRetainerPaymentCalculations.js:17](../../src/endpoints/invoice/createInvoice/invoiceCalculations/transactionRetainerPaymentCalculations.js#L17) · throw · `groupAndTotalTransactionRetainerPayments`

`` throw new Error(`Transaction Retainer Payment Total on customerID:${customer_id} is NaN`); ``

**Proved:** [T0932](#t0932).

<a id="b273"></a>**B273** — [src/endpoints/invoice/createInvoice/invoiceCalculations/transactionRetainerPaymentCalculations.js:21](../../src/endpoints/invoice/createInvoice/invoiceCalculations/transactionRetainerPaymentCalculations.js#L21) · throw · `groupAndTotalTransactionRetainerPayments`

`` throw new Error(`Transaction Retainer Payment Total on customerID:${customer_id} is null or undefined`); ``

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

<a id="b274"></a>**B274** — [src/endpoints/invoice/createInvoice/invoiceCalculations/transactionRetainerPaymentCalculations.js:25](../../src/endpoints/invoice/createInvoice/invoiceCalculations/transactionRetainerPaymentCalculations.js#L25) · throw · `groupAndTotalTransactionRetainerPayments`

`` throw new Error(`Transaction Retainer Payment Total on customerID:${customer_id} is not a number`); ``

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

### src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js

<a id="b275"></a>**B275** — [src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:38](../../src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js#L38) · throw · `groupAndTotalWriteOffs`

`` throw new Error(`Write Off Total on customerID:${customer_id} is NaN`); ``

**Proved:** [T0930](#t0930).

<a id="b276"></a>**B276** — [src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:42](../../src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js#L42) · throw · `groupAndTotalWriteOffs`

`` throw new Error(`Write Off Total on customerID:${customer_id} is null or undefined`); ``

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

<a id="b277"></a>**B277** — [src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js:46](../../src/endpoints/invoice/createInvoice/invoiceCalculations/writeOffCalculations.js#L46) · throw · `groupAndTotalWriteOffs`

`` throw new Error(`Write Off Total on customerID:${customer_id} is not a number`); ``

**unreachable:** This specific guard checks null/undefined or typeof after a Number-based numeric reduction/arithmetic. The result is always a JS number, including NaN; the preceding NaN guard is separately exercised by path-matrix-09. It cannot become null, undefined or another type.

### src/endpoints/invoice/creditSelection.js

<a id="b278"></a>**B278** — [src/endpoints/invoice/creditSelection.js:6](../../src/endpoints/invoice/creditSelection.js#L6) · throw · `validateSelection`

` throw ruleError('Invalid invoice configuration.', 400); `

**Proved:** [T1221](#t1221).

<a id="b279"></a>**B279** — [src/endpoints/invoice/creditSelection.js:8](../../src/endpoints/invoice/creditSelection.js#L8) · throw · `validateSelection`

` throw ruleError('Select at least one customer to invoice.', 400); `

**Proved:** [T1123](#t1123), [T1221](#t1221).

<a id="b280"></a>**B280** — [src/endpoints/invoice/creditSelection.js:11](../../src/endpoints/invoice/creditSelection.js#L11) · throw · `<handler>`

` throw ruleError('Invalid customer selection.', 400); `

**Proved:** [T1120](#t1120), [T1125](#t1125).

<a id="b281"></a>**B281** — [src/endpoints/invoice/creditSelection.js:12](../../src/endpoints/invoice/creditSelection.js#L12) · throw · `<handler>`

` throw ruleError('includeCreditStatement must be a boolean.', 400); `

**Proved:** [T1221](#t1221).

<a id="b282"></a>**B282** — [src/endpoints/invoice/creditSelection.js:16](../../src/endpoints/invoice/creditSelection.js#L16) · throw · `validateSelection`

` throw ruleError('A customer was selected more than once; select each customer once.', 400); `

**Proved:** [T1122](#t1122), [T1221](#t1221).

<a id="b283"></a>**B283** — [src/endpoints/invoice/creditSelection.js:18](../../src/endpoints/invoice/creditSelection.js#L18) · throw · `validateSelection`

` throw ruleError('Invalid invoice creation settings.', 400); `

**Proved:** [T1221](#t1221).

<a id="b284"></a>**B284** — [src/endpoints/invoice/creditSelection.js:20](../../src/endpoints/invoice/creditSelection.js#L20) · throw · `validateSelection`

`` throw ruleError(`${field} must be a boolean.`, 400); ``

**Proved:** [T1221](#t1221).

### src/endpoints/invoice/invoice-router.js

<a id="b285"></a>**B285** — [src/endpoints/invoice/invoice-router.js:72](../../src/endpoints/invoice/invoice-router.js#L72) · throw · `<handler>`

` throw new Error('Invoice not found.'); `

**Proved:** [T1064](#t1064), [T0166](#t0166).

<a id="b286"></a>**B286** — [src/endpoints/invoice/invoice-router.js:77](../../src/endpoints/invoice/invoice-router.js#L77) · throw · `<handler>`

` throw new Error('This row is a payment/write-off snapshot. Delete or reverse the payment or write-off instead.'); `

**Proved:** [T0925](#t0925).

<a id="b287"></a>**B287** — [src/endpoints/invoice/invoice-router.js:86](../../src/endpoints/invoice/invoice-router.js#L86) · throw · `<handler>`

` throw new Error('Cannot delete invoice with transactions, retainers, payments, or writeoffs.'); `

**Proved:** [T0924](#t0924).

<a id="b288"></a>**B288** — [src/endpoints/invoice/invoice-router.js:94](../../src/endpoints/invoice/invoice-router.js#L94) · throw · `<handler>`

`` throw new Error(`Invoice ${targetInvoice.invoice_number} was rolled into a later statement (see its notes) and is part of that statement's history; it cannot be deleted.`); ``

**Proved:** [T0922](#t0922).

<a id="b289"></a>**B289** — [src/endpoints/invoice/invoice-router.js:99](../../src/endpoints/invoice/invoice-router.js#L99) · throw · `<handler>`

`` throw new Error(`Invoice ${targetInvoice.invoice_number} has payment or write-off activity recorded against it and cannot be deleted. Delete or reverse those entries first.`); ``

**Proved:** [T1154](#t1154).

<a id="b290"></a>**B290** — [src/endpoints/invoice/invoice-router.js:103](../../src/endpoints/invoice/invoice-router.js#L103) · throw · `<handler>`

`` throw new Error( `Invoice ${targetInvoice.invoice_number} rolled ${absorbedRows} earlier statement row(s) into its beginning balance ($${Number(targetInvoice.beginning_balance).toFixed(2)}). Deleting it would erase that debt; void it with an adjustment instead.` ); ``

**Proved:** [T0923](#t0923), [T0921](#t0921).

<a id="b291"></a>**B291** — [src/endpoints/invoice/invoice-router.js:119](../../src/endpoints/invoice/invoice-router.js#L119) · throw · `<handler>`

` throw new Error('Invoice not found.'); `

**Proved:** [T1158](#t1158).

<a id="b292"></a>**B292** — [src/endpoints/invoice/invoice-router.js:120](../../src/endpoints/invoice/invoice-router.js#L120) · throw · `<handler>`

` throw new Error('Invoice changed customer while being deleted; refresh and try again.'); `

**Proved:** [T1158](#t1158).

<a id="b293"></a>**B293** — [src/endpoints/invoice/invoice-router.js:123](../../src/endpoints/invoice/invoice-router.js#L123) · throw · `<handler>`

`` throw new Error(`Invoice ${current.invoice_number} became part of statement history while being deleted (a later statement rolled it forward); it cannot be deleted.`); ``

**Proved:** [T0367](#t0367).

<a id="b294"></a>**B294** — [src/endpoints/invoice/invoice-router.js:132](../../src/endpoints/invoice/invoice-router.js#L132) · throw · `<handler>`

` throw new Error('Invoice gained linked activity while being deleted; refresh and try again.'); `

**Proved:** [T1155](#t1155).

<a id="b295"></a>**B295** — [src/endpoints/invoice/invoice-router.js:144](../../src/endpoints/invoice/invoice-router.js#L144) · catch · `<handler>`

` catch (error) { res.send({ message: error.message || 'An error occurred while deleting the invoice.', status: 500 }); } `

**Proved:** [T0922](#t0922), [T0925](#t0925).

<a id="b296"></a>**B296** — [src/endpoints/invoice/invoice-router.js:145](../../src/endpoints/invoice/invoice-router.js#L145) · response · `<handler>`

` res.send({ message: error.message || 'An error occurred while deleting the invoice.', status: 500 }) `

**Proved:** [T0922](#t0922), [T0925](#t0925).

<a id="b297"></a>**B297** — [src/endpoints/invoice/invoice-router.js:170](../../src/endpoints/invoice/invoice-router.js#L170) · catch · `<handler>`

` catch (e) { return res.status(500).send({ status: 500, message: 'Unable to calculate statement balances. Refresh before selecting invoices.' }); } `

**Proved:** [T1220](#t1220).

<a id="b298"></a>**B298** — [src/endpoints/invoice/invoice-router.js:171](../../src/endpoints/invoice/invoice-router.js#L171) · response · `<handler>`

` res.status(500).send({ status: 500, message: 'Unable to calculate statement balances. Refresh before selecting invoices.' }) `

**Proved:** [T1220](#t1220).

<a id="b299"></a>**B299** — [src/endpoints/invoice/invoice-router.js:195](../../src/endpoints/invoice/invoice-router.js#L195) · catch · `<handler>`

` catch (e) { console.warn('[AccountsWithBalance] audit lookup failed:', e.message); } `

**Proved:** [T0926](#t0926).

<a id="b300"></a>**B300** — [src/endpoints/invoice/invoice-router.js:248](../../src/endpoints/invoice/invoice-router.js#L248) · throw · `<handler>`

` throw ruleError('Selected customer was not found in this account.', 404); `

**Proved:** [T1121](#t1121), [T1124](#t1124).

<a id="b301"></a>**B301** — [src/endpoints/invoice/invoice-router.js:309](../../src/endpoints/invoice/invoice-router.js#L309) · throw · `<handler>`

` throw new Error('Invalid calculated statement total.'); `

**unreachable:** calculateInvoices has already validated every component and total. Bounded database money and integer row IDs cannot produce Infinity; the repeated finite check cannot fail from admitted HTTP inputs.

<a id="b302"></a>**B302** — [src/endpoints/invoice/invoice-router.js:384](../../src/endpoints/invoice/invoice-router.js#L384) · catch · `<handler>`

`` catch (error) { console.error(`[createInvoice] ${error.message}`); if (committedResult) { return res.send({ ...committedResult, message: `Finalized ${committedResult.committedInvoices.length} invoice(s).`, warnings: ['Billing committed, but the combined downlo ``

**Proved:** [T0931](#t0931), [T0927](#t0927).

<a id="b303"></a>**B303** — [src/endpoints/invoice/invoice-router.js:394](../../src/endpoints/invoice/invoice-router.js#L394) · response · `<handler>`

` res.status(status).send({ message: error.message, status }) `

**Proved:** [T0931](#t0931), [T0927](#t0927).

<a id="b304"></a>**B304** — [src/endpoints/invoice/invoice-router.js:404](../../src/endpoints/invoice/invoice-router.js#L404) · throw · `<handler>`

` throw new Error('Invalid or no file path.'); `

**Proved:** [T0193](#t0193), [T0154](#t0154).

<a id="b305"></a>**B305** — [src/endpoints/invoice/invoice-router.js:429](../../src/endpoints/invoice/invoice-router.js#L429) · response · `<handler>`

` res.status(403).send({ message: 'You do not have access to this file.', status: 403 }) `

**Proved:** [T0155](#t0155), [T0156](#t0156).

<a id="b306"></a>**B306** — [src/endpoints/invoice/invoice-router.js:436](../../src/endpoints/invoice/invoice-router.js#L436) · throw · `<handler>`

` throw new Error('File does not exist.'); `

**unreachable:** getObject resolves with a Buffer or throws on GetObject/body collection failure. Even a zero-length Buffer is truthy; the later !buffer branch is unreachable. Storage rejection is tested at the enclosing catch.

<a id="b307"></a>**B307** — [src/endpoints/invoice/invoice-router.js:456](../../src/endpoints/invoice/invoice-router.js#L456) · catch · `<handler>`

` catch (error) { return res.status(500).send({status:500,message:'Unable to record the invoice reprint. Please retry.'}); } `

**Proved:** [T1231](#t1231).

<a id="b308"></a>**B308** — [src/endpoints/invoice/invoice-router.js:457](../../src/endpoints/invoice/invoice-router.js#L457) · response · `<handler>`

` res.status(500).send({status:500,message:'Unable to record the invoice reprint. Please retry.'}) `

**Proved:** [T1231](#t1231).

<a id="b309"></a>**B309** — [src/endpoints/invoice/invoice-router.js:469](../../src/endpoints/invoice/invoice-router.js#L469) · catch · `<handler>`

`` catch (s3Error) { console.warn(`Unable to retrieve ${s3Key} from S3: ${s3Error.message}`); } ``

**Proved:** [T0192](#t0192).

<a id="b310"></a>**B310** — [src/endpoints/invoice/invoice-router.js:473](../../src/endpoints/invoice/invoice-router.js#L473) · throw · `<handler>`

` throw new Error('File does not exist.'); `

**Proved:** [T0192](#t0192).

<a id="b311"></a>**B311** — [src/endpoints/invoice/invoice-router.js:474](../../src/endpoints/invoice/invoice-router.js#L474) · catch · `<handler>`

` catch (error) { res.status(400).send({ message: error.message }); } `

**Proved:** [T0193](#t0193), [T0192](#t0192).

<a id="b312"></a>**B312** — [src/endpoints/invoice/invoice-router.js:475](../../src/endpoints/invoice/invoice-router.js#L475) · response · `<handler>`

` res.status(400).send({ message: error.message }) `

**Proved:** [T0193](#t0193), [T0192](#t0192).

<a id="b313"></a>**B313** — [src/endpoints/invoice/invoice-router.js:488](../../src/endpoints/invoice/invoice-router.js#L488) · response · `<handler>`

` res.status(404).send({ message: 'Invoice not found.', status: 404 }) `

**Proved:** [T0194](#t0194).

<a id="b314"></a>**B314** — [src/endpoints/invoice/invoice-router.js:611](../../src/endpoints/invoice/invoice-router.js#L611) · catch · `<handler>`

` catch (error) { console.error('Error fetching paginated invoices:', error); const isPaginationError = error.message && error.message.includes('Invalid pagination'); const statusCode = isPaginationError ? 400 : 500; res.status(statusCode).send({ message: error. `

**Proved:** [T0197](#t0197).

<a id="b315"></a>**B315** — [src/endpoints/invoice/invoice-router.js:615](../../src/endpoints/invoice/invoice-router.js#L615) · response · `<handler>`

` res.status(statusCode).send({ message: error.message || 'An error occurred while retrieving invoices.', status: statusCode }) `

**Proved:** [T0197](#t0197).

<a id="b316"></a>**B316** — [src/endpoints/invoice/invoice-router.js:631](../../src/endpoints/invoice/invoice-router.js#L631) · catch · `<handler>`

` catch (err) { const status = err.code === '23505' ? 409 : err.statusCode || (err.code === 'P0409' ? 409 : 500); return res.status(status).send({ status, message: status === 500 ? 'Invoice operation failed. No changes were committed; retry after checking the se `

**Proved:** [T0935](#t0935), [T0936](#t0936).

<a id="b317"></a>**B317** — [src/endpoints/invoice/invoice-router.js:633](../../src/endpoints/invoice/invoice-router.js#L633) · response · `<handler>`

` res.status(status).send({ status, message: status === 500 ? 'Invoice operation failed. No changes were committed; retry after checking the service.' : err.message, code: err.code }) `

**Proved:** [T0935](#t0935), [T0936](#t0936).

### src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js

<a id="b318"></a>**B318** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:34](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L34) · throw · `dataInsertionOrchestrator`

` throw new Error('Missing necessary arguments for dataInsertionOrchestrator'); `

**unreachable:** Only the finalized HTTP path calls this function, after constructing arrays of calculated details/PDFs and owned account billing information and loading an authenticated user ID. Missing arguments are not an HTTP input at this boundary.

<a id="b319"></a>**B319** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:48](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L48) · throw · `dataInsertionOrchestrator`

` throw new Error('Invalid customer id in the billing batch.'); `

**unreachable:** validateSelection has already required positive integer customer IDs, rejected duplicate selection and verified owned customers before calculation or finalization.

<a id="b320"></a>**B320** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:49](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L49) · throw · `dataInsertionOrchestrator`

` throw new Error('A customer appears more than once in the billing batch; select each customer once.'); `

**unreachable:** validateSelection has already required positive integer customer IDs, rejected duplicate selection and verified owned customers before calculation or finalization.

<a id="b321"></a>**B321** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:52](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L52) · throw · `<handler>`

`` throw new Error(`Invoice total for customer ${invoice.customer_id} is not a number.`); ``

**unreachable:** The invoice route validates calculated finite totals before calling this orchestrator; newInvoiceObject repeats the same invariant before mapping typed money.

<a id="b322"></a>**B322** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:53](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L53) · throw · `<handler>`

`` throw new Error(`Customer ${invoice.customer_id} has a credit balance; explicitly select this credit statement before finalizing.`); ``

**unreachable:** The finalized route filters every negative calculated total unless that specific customer has includeCreditStatement === true. The same explicit flag is carried into the orchestrator.

<a id="b323"></a>**B323** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:58](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L58) · throw · `dataInsertionOrchestrator`

` throw new Error('Account id missing for the billing run.'); `

**unreachable:** Owned account billing information is selected after requireAuth/enforceAccountId; a missing account is rejected upstream. Stored account_id is an integer.

<a id="b324"></a>**B324** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:61](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L61) · rejection callback · `dataInsertionOrchestrator`

`` saveInvoiceImagesForDatabase(pdfBuffer, accountBillingInformation, runID).catch(err => { throw new Error(`Error in saving invoice images: ${err.message}`); }) ``

**Proved:** [T1192](#t1192), [T1243](#t1243).

<a id="b325"></a>**B325** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:62](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L62) · throw · `<handler>`

`` throw new Error(`Error in saving invoice images: ${err.message}`); ``

**Proved:** [T1192](#t1192), [T1243](#t1243).

<a id="b326"></a>**B326** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:67](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L67) · throw · `dataInsertionOrchestrator`

` throw new Error('Duplicate invoice numbers in the billing batch.'); `

**unreachable:** addInvoiceDetails assigns one incremented invoice number per unique selected customer. Duplicate customer selection is already refused. Concurrent existing-number collisions are a different tested database branch.

<a id="b327"></a>**B327** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:80](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L80) · throw · `<handler>`

`` throw new Error(`Customer(s) ${[...new Set(billedToday.map(r => r.customer_id))].join(', ')} were finalized today by another run. Refresh Create Invoice and submit again.`); ``

**Proved:** [T1163](#t1163), [T1256](#t1256).

<a id="b328"></a>**B328** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:86](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L86) · throw · `<handler>`

`` throw new Error(`Invoice number(s) ${taken.map(t => t.invoice_number).join(', ')} were just used by another billing run. Re-open Create Invoice and submit again.`); ``

**Proved:** [T1157](#t1157).

<a id="b329"></a>**B329** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:94](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L94) · throw · `<handler>`

`` throw new Error(`The ledger for customer(s) ${changed.join(', ')} changed while the statements were being generated (a payment, write-off, invoice row or transaction was added, edited or deleted). Nothing was finalized — re-run Create Invoice.`); ``

**Proved:** [T1196](#t1196), [T1117](#t1117).

<a id="b330"></a>**B330** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:111](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L111) · throw · `<handler>`

`` throw new Error(`Parent statement missing for customer ${plan.customer_id}.`); ``

**Proved:** [T0991](#t0991).

<a id="b331"></a>**B331** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:126](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L126) · throw · `<handler>`

`` throw new Error(`Customer ${plan.customer_id}: ${plan.transactionIDs.length - transactionsStamped} transaction(s) on the statement were changed or billed by another run. Nothing was finalized — re-run Create Invoice.`); ``

**Proved:** [T1165](#t1165).

<a id="b332"></a>**B332** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:137](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L137) · throw · `<handler>`

`` throw new Error(`Customer ${plan.customer_id}: a payment on the statement was changed by another run. Nothing was finalized — re-run Create Invoice.`); ``

**Proved:** [T1164](#t1164).

<a id="b333"></a>**B333** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:172](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L172) · throw · `assertLedgerUnchanged`

`` throw new Error( `The ledger changed while the statements were being generated (${payments} payment(s), ${writeOffs} write-off(s), ${invoiceRows} invoice row(s) were posted for the selected customers). Nothing was finalized — re-run Create Invoice so the statements include those entries.` ); ``

**Proved:** [T1258](#t1258), [T1156](#t1156).

<a id="b334"></a>**B334** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:196](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L196) · throw · `assertLedgerUnchanged`

`` throw new Error(`Transactions changed while the statements were being generated (${drift.slice(0, 5).join('; ')}${drift.length > 5 ? '; …' : ''}). Nothing was finalized — re-run Create Invoice.`); ``

**Proved:** [T1257](#t1257), [T1159](#t1159).

<a id="b335"></a>**B335** — [src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js:270](../../src/endpoints/invoice/invoiceDataInsertions/dataInsertionOrchestrator.js#L270) · throw · `newInvoiceObject`

`` throw new Error(`Invoice total for customer ${customer_id} is not a number.`); ``

**unreachable:** The invoice route validates calculated finite totals before calling this orchestrator; newInvoiceObject repeats the same invariant before mapping typed money.

### src/endpoints/invoice/invoiceDataInsertions/schemaValidation/invoiceValidation.js

<a id="b336"></a>**B336** — [src/endpoints/invoice/invoiceDataInsertions/schemaValidation/invoiceValidation.js:80](../../src/endpoints/invoice/invoiceDataInsertions/schemaValidation/invoiceValidation.js#L80) · throw · `<handler>`

`` throw new Error(`Validation of invoice object failed prior to database insert failed on ${key} on ${invoiceObject.customer_id}`); ``

**Proved:** [T0990](#t0990).

<a id="b337"></a>**B337** — [src/endpoints/invoice/invoiceDataInsertions/schemaValidation/invoiceValidation.js:85](../../src/endpoints/invoice/invoiceDataInsertions/schemaValidation/invoiceValidation.js#L85) · throw · `cleanAndValidateInvoiceObject`

`` throw new Error(`Validation of invoice failed prior to database insert on ${invoiceObject.customer_id}`); ``

**unreachable:** The every callback either returns true or throws at line 80. It never returns false, so validatedKeys cannot be false. The real schema rejection is fault-tested in path-matrix-15.

### src/endpoints/invoice/invoiceDataInsertions/schemaValidation/paymentValidations.js

<a id="b338"></a>**B338** — [src/endpoints/invoice/invoiceDataInsertions/schemaValidation/paymentValidations.js:73](../../src/endpoints/invoice/invoiceDataInsertions/schemaValidation/paymentValidations.js#L73) · throw · `<handler>`

`` throw new Error(`Validation of payment object failed prior to database insert failed on ${key} on ${paymentObject.customer_id}`); ``

**outside HTTP:** Legacy exported validator has no imports/callers in src. Current finalize uses invoiceValidation and shared ledger cores instead.

<a id="b339"></a>**B339** — [src/endpoints/invoice/invoiceDataInsertions/schemaValidation/paymentValidations.js:79](../../src/endpoints/invoice/invoiceDataInsertions/schemaValidation/paymentValidations.js#L79) · throw · `cleanAndValidatePaymentObject`

`` throw new Error(`Validation of payment failed prior to database insert on ${paymentObject.customer_id}`); ``

**outside HTTP:** Legacy exported validator has no imports/callers in src. Current finalize uses invoiceValidation and shared ledger cores instead.

### src/endpoints/invoice/invoiceDataInsertions/schemaValidation/transactionValidation.js

<a id="b340"></a>**B340** — [src/endpoints/invoice/invoiceDataInsertions/schemaValidation/transactionValidation.js:89](../../src/endpoints/invoice/invoiceDataInsertions/schemaValidation/transactionValidation.js#L89) · throw · `<handler>`

`` throw new Error(`Validation of transaction object failed prior to database insert failed on ${key} on ${transactionObject.customer_id}`); ``

**outside HTTP:** Legacy exported validator has no imports/callers in src. Current finalize uses invoiceValidation and shared ledger cores instead.

<a id="b341"></a>**B341** — [src/endpoints/invoice/invoiceDataInsertions/schemaValidation/transactionValidation.js:93](../../src/endpoints/invoice/invoiceDataInsertions/schemaValidation/transactionValidation.js#L93) · throw · `cleanAndValidateTransactionObject`

`` throw new Error(`Validation of transaction failed prior to database insert on ${transactionObject.customer_id}`); ``

**outside HTTP:** Legacy exported validator has no imports/callers in src. Current finalize uses invoiceValidation and shared ledger cores instead.

### src/endpoints/invoice/invoiceDataInsertions/schemaValidation/writeOffValidation.js

<a id="b342"></a>**B342** — [src/endpoints/invoice/invoiceDataInsertions/schemaValidation/writeOffValidation.js:69](../../src/endpoints/invoice/invoiceDataInsertions/schemaValidation/writeOffValidation.js#L69) · throw · `<handler>`

`` throw new Error(`Validation of write-off object failed prior to database insert failed on ${key} on ${writeOffObject.customer_id}`); ``

**outside HTTP:** Legacy exported validator has no imports/callers in src. Current finalize uses invoiceValidation and shared ledger cores instead.

<a id="b343"></a>**B343** — [src/endpoints/invoice/invoiceDataInsertions/schemaValidation/writeOffValidation.js:74](../../src/endpoints/invoice/invoiceDataInsertions/schemaValidation/writeOffValidation.js#L74) · throw · `cleanAndValidateWriteOffObject`

`` throw new Error(`Validation of write off failed prior to database insert on ${writeOffObject.customer_id}`); ``

**outside HTTP:** Legacy exported validator has no imports/callers in src. Current finalize uses invoiceValidation and shared ledger cores instead.

### src/endpoints/invoice/invoiceExceptions.js

<a id="b344"></a>**B344** — [src/endpoints/invoice/invoiceExceptions.js:13](../../src/endpoints/invoice/invoiceExceptions.js#L13) · throw · `id`

`` throw ruleError(`Invalid ${name}.`, 400); ``

**Proved:** [T1177](#t1177), [T1175](#t1175).

<a id="b345"></a>**B345** — [src/endpoints/invoice/invoiceExceptions.js:18](../../src/endpoints/invoice/invoiceExceptions.js#L18) · throw · `parentFor`

` throw ruleError('Invoice not found.', 404); `

**Proved:** [T1175](#t1175), [T1176](#t1176).

<a id="b346"></a>**B346** — [src/endpoints/invoice/invoiceExceptions.js:19](../../src/endpoints/invoice/invoiceExceptions.js#L19) · throw · `parentFor`

` throw ruleError('Select the parent statement for an exception.', 409); `

**Proved:** [T1191](#t1191).

<a id="b347"></a>**B347** — [src/endpoints/invoice/invoiceExceptions.js:23](../../src/endpoints/invoice/invoiceExceptions.js#L23) · throw · `parentFor`

` throw ruleError('Invoice not found.', 404); `

**Proved:** [T0934](#t0934).

<a id="b348"></a>**B348** — [src/endpoints/invoice/invoiceExceptions.js:24](../../src/endpoints/invoice/invoiceExceptions.js#L24) · throw · `parentFor`

` throw ruleError('Invoice has not been sent.', 409); `

**Proved:** [T1191](#t1191).

<a id="b349"></a>**B349** — [src/endpoints/invoice/invoiceExceptions.js:33](../../src/endpoints/invoice/invoiceExceptions.js#L33) · throw · `readHistory`

` throw ruleError('Invoice not found.', 404); `

**Proved:** [T1177](#t1177), [T1183](#t1183).

<a id="b350"></a>**B350** — [src/endpoints/invoice/invoiceExceptions.js:58](../../src/endpoints/invoice/invoiceExceptions.js#L58) · throw · `flag`

` throw ruleError('Unsupported exception condition.', 400); `

**Proved:** [T1179](#t1179), [T1182](#t1182).

<a id="b351"></a>**B351** — [src/endpoints/invoice/invoiceExceptions.js:59](../../src/endpoints/invoice/invoiceExceptions.js#L59) · throw · `flag`

` throw ruleError('A reason of 1 to 2000 characters is required.', 400); `

**Proved:** [T1181](#t1181), [T1174](#t1174).

<a id="b352"></a>**B352** — [src/endpoints/invoice/invoiceExceptions.js:60](../../src/endpoints/invoice/invoiceExceptions.js#L60) · throw · `flag`

` throw ruleError('Select 1 to 100 payments.', 400); `

**Proved:** [T1180](#t1180), [T1173](#t1173).

<a id="b353"></a>**B353** — [src/endpoints/invoice/invoiceExceptions.js:62](../../src/endpoints/invoice/invoiceExceptions.js#L62) · throw · `flag`

` throw ruleError('Select each payment only once.', 400); `

**Proved:** [T1172](#t1172).

<a id="b354"></a>**B354** — [src/endpoints/invoice/invoiceExceptions.js:66](../../src/endpoints/invoice/invoiceExceptions.js#L66) · throw · `<handler>`

` throw ruleError('Resolve the existing exception first.', 409); `

**Proved:** [T1186](#t1186), [T1167](#t1167).

<a id="b355"></a>**B355** — [src/endpoints/invoice/invoiceExceptions.js:71](../../src/endpoints/invoice/invoiceExceptions.js#L71) · throw · `<handler>`

` throw ruleError('Selected payment is not on this statement.', 404); `

**Proved:** [T1169](#t1169).

<a id="b356"></a>**B356** — [src/endpoints/invoice/invoiceExceptions.js:72](../../src/endpoints/invoice/invoiceExceptions.js#L72) · throw · `<handler>`

`` throw ruleError(`Payment #${paymentId} cannot be reversed by this condition.`, 409); ``

**Proved:** [T1188](#t1188), [T1190](#t1190).

<a id="b357"></a>**B357** — [src/endpoints/invoice/invoiceExceptions.js:84](../../src/endpoints/invoice/invoiceExceptions.js#L84) · throw · `transition`

` throw ruleError('Invalid exception action.', 400); `

**Proved:** [T1170](#t1170).

<a id="b358"></a>**B358** — [src/endpoints/invoice/invoiceExceptions.js:89](../../src/endpoints/invoice/invoiceExceptions.js#L89) · throw · `<handler>`

` throw ruleError('Exception not found.', 404); `

**Proved:** [T1183](#t1183).

<a id="b359"></a>**B359** — [src/endpoints/invoice/invoiceExceptions.js:91](../../src/endpoints/invoice/invoiceExceptions.js#L91) · throw · `<handler>`

`` throw ruleError(`Exception is ${exception.state}; ${action} is not permitted.`, 409); ``

**Proved:** [T1170](#t1170), [T1166](#t1166).

<a id="b360"></a>**B360** — [src/endpoints/invoice/invoiceExceptions.js:99](../../src/endpoints/invoice/invoiceExceptions.js#L99) · rejection callback · `<handler>`

` payments.reversePayment(trx, { accountId, userId: actor, paymentId: p.payment_id, reason: exception.reason, exceptionId }).catch(err => { if (err.isLedgerRule && err.statusCode === 422) err.statusCode `

**Proved:** [T1185](#t1185), [T1171](#t1171).

<a id="b361"></a>**B361** — [src/endpoints/invoice/invoiceExceptions.js:99](../../src/endpoints/invoice/invoiceExceptions.js#L99) · throw · `<handler>`

` throw err; `

**Proved:** [T1185](#t1185), [T1171](#t1171).

<a id="b362"></a>**B362** — [src/endpoints/invoice/invoiceExceptions.js:121](../../src/endpoints/invoice/invoiceExceptions.js#L121) · throw · `<handler>`

` throw ruleError('This invoice was rolled forward. Roll the correction into the next invoice.', 409); `

**Proved:** [T1184](#t1184).

<a id="b363"></a>**B363** — [src/endpoints/invoice/invoiceExceptions.js:133](../../src/endpoints/invoice/invoiceExceptions.js#L133) · throw · `<handler>`

` throw ruleError('Original archive is unavailable for this account.', 409); `

**Proved:** [T1178](#t1178).

<a id="b364"></a>**B364** — [src/endpoints/invoice/invoiceExceptions.js:137](../../src/endpoints/invoice/invoiceExceptions.js#L137) · throw · `<handler>`

` throw new Error('Original archive must contain exactly one customer PDF.'); `

**Proved:** [T0935](#t0935), [T0936](#t0936).

### src/endpoints/invoice/sentInvoiceLocks.js

<a id="b365"></a>**B365** — [src/endpoints/invoice/sentInvoiceLocks.js:14](../../src/endpoints/invoice/sentInvoiceLocks.js#L14) · throw · `assertUnlocked`

` throw ruleError(lockedMessage(number), 409, 'SENT_INVOICE_LOCKED'); `

**Proved:** [T0986](#t0986), [T1249](#t1249).

<a id="b366"></a>**B366** — [src/endpoints/invoice/sentInvoiceLocks.js:89](../../src/endpoints/invoice/sentInvoiceLocks.js#L89) · rejection callback · `<handler>`

`` req.app.get('db').raw(`SELECT t, id, ds2_locked_invoice(t,id,?::integer) AS number, ARRAY(SELECT duplicate_id FROM duplicate_flags d WHERE d.account_id=?::integer AND d.status='open' AND (d.record_id= ``

**Proved:** [T0985](#t0985), [T0984](#t0984).

### src/endpoints/invoice/sharedInvoiceFunctions.js

<a id="b367"></a>**B367** — [src/endpoints/invoice/sharedInvoiceFunctions.js:45](../../src/endpoints/invoice/sharedInvoiceFunctions.js#L45) · throw · `incrementAnInvoiceOrQuote`

` throw new Error('invoiceNumber must be a string'); `

**unreachable:** getLastInvoiceNumber admits only the requested prefix/year plus numeric suffix using SQL regex, or supplies the known valid default. The HTTP route never supplies a client invoiceNumber to this helper.

<a id="b368"></a>**B368** — [src/endpoints/invoice/sharedInvoiceFunctions.js:57](../../src/endpoints/invoice/sharedInvoiceFunctions.js#L57) · throw · `incrementAnInvoiceOrQuote`

` throw new Error('Invalid invoiceNumber format'); `

**unreachable:** getLastInvoiceNumber admits only the requested prefix/year plus numeric suffix using SQL regex, or supplies the known valid default. The HTTP route never supplies a client invoiceNumber to this helper.

<a id="b369"></a>**B369** — [src/endpoints/invoice/sharedInvoiceFunctions.js:72](../../src/endpoints/invoice/sharedInvoiceFunctions.js#L72) · throw · `incrementAnInvoiceOrQuote`

`` throw new Error(`Invoice sequence exhausted for ${prefix}-${currentYear} (${incrementedNum} > 99999).`); ``

**Proved:** [T1128](#t1128), [T0039](#t0039).

### src/endpoints/job/job-router.js

<a id="b370"></a>**B370** — [src/endpoints/job/job-router.js:39](../../src/endpoints/job/job-router.js#L39) · throw · `<handler>`

` throw ruleError('Job not found.', 404); `

**Proved:** [T1129](#t1129), [T1247](#t1247).

<a id="b371"></a>**B371** — [src/endpoints/job/job-router.js:48](../../src/endpoints/job/job-router.js#L48) · throw · `<handler>`

` throw ruleError('Job changed while saving. Refresh and retry.', 409); `

**Proved:** [T0040](#t0040).

<a id="b372"></a>**B372** — [src/endpoints/job/job-router.js:85](../../src/endpoints/job/job-router.js#L85) · throw · `<handler>`

` throw new Error('Duplicate job'); `

**Proved:** [T1053](#t1053), [T0231](#t0231).

<a id="b373"></a>**B373** — [src/endpoints/job/job-router.js:91](../../src/endpoints/job/job-router.js#L91) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'Error creating job.', status: 500 }); } `

**Proved:** [T1109](#t1109), [T1053](#t1053).

<a id="b374"></a>**B374** — [src/endpoints/job/job-router.js:93](../../src/endpoints/job/job-router.js#L93) · response · `<handler>`

` res.send({ message: err.message || 'Error creating job.', status: 500 }) `

**Proved:** [T1109](#t1109), [T1053](#t1053).

<a id="b375"></a>**B375** — [src/endpoints/job/job-router.js:178](../../src/endpoints/job/job-router.js#L178) · throw · `<handler>`

` throw new Error('Cannot reassign this job to a different customer: transactions are linked to it or one of its prior versions.'); `

**Proved:** [T1133](#t1133), [T0244](#t0244).

<a id="b376"></a>**B376** — [src/endpoints/job/job-router.js:181](../../src/endpoints/job/job-router.js#L181) · throw · `<handler>`

` throw new Error('Cannot reassign this job to a different customer: write offs are linked to it or one of its prior versions.'); `

**Proved:** [T1161](#t1161).

<a id="b377"></a>**B377** — [src/endpoints/job/job-router.js:185](../../src/endpoints/job/job-router.js#L185) · throw · `<handler>`

` throw new Error('Cannot reassign this job to a different customer: payments are linked to it or one of its prior versions.'); `

**Proved:** [T1160](#t1160).

<a id="b378"></a>**B378** — [src/endpoints/job/job-router.js:207](../../src/endpoints/job/job-router.js#L207) · catch · `<handler>`

` catch (error) { console.log(error); res.send({ message: error.message || 'An error occurred while updating the Job.', status: 500 }); } `

**Proved:** [T1129](#t1129), [T1130](#t1130).

<a id="b379"></a>**B379** — [src/endpoints/job/job-router.js:209](../../src/endpoints/job/job-router.js#L209) · response · `<handler>`

` res.send({ message: error.message || 'An error occurred while updating the Job.', status: 500 }) `

**Proved:** [T1129](#t1129), [T1130](#t1130).

<a id="b380"></a>**B380** — [src/endpoints/job/job-router.js:231](../../src/endpoints/job/job-router.js#L231) · throw · `<handler>`

` throw new Error('Job not found.'); `

**Proved:** [T0987](#t0987).

<a id="b381"></a>**B381** — [src/endpoints/job/job-router.js:236](../../src/endpoints/job/job-router.js#L236) · throw · `<handler>`

` throw new Error('Transactions are linked to this job or one of its prior versions; it cannot be deleted.'); `

**Proved:** [T0215](#t0215), [T0212](#t0212).

<a id="b382"></a>**B382** — [src/endpoints/job/job-router.js:239](../../src/endpoints/job/job-router.js#L239) · throw · `<handler>`

` throw new Error('Write offs are linked to this job or one of its prior versions; it cannot be deleted.'); `

**Proved:** [T1161](#t1161), [T0216](#t0216).

<a id="b383"></a>**B383** — [src/endpoints/job/job-router.js:243](../../src/endpoints/job/job-router.js#L243) · throw · `<handler>`

` throw new Error('Payments are linked to this job or one of its prior versions; it cannot be deleted.'); `

**Proved:** [T1160](#t1160), [T0214](#t0214).

<a id="b384"></a>**B384** — [src/endpoints/job/job-router.js:249](../../src/endpoints/job/job-router.js#L249) · catch · `<handler>`

` catch (error) { console.log(error); res.send({ message: error.message || 'An error occurred while updating the Job.', status: 500 }); } `

**Proved:** [T0987](#t0987), [T1129](#t1129).

<a id="b385"></a>**B385** — [src/endpoints/job/job-router.js:251](../../src/endpoints/job/job-router.js#L251) · response · `<handler>`

` res.send({ message: error.message || 'An error occurred while updating the Job.', status: 500 }) `

**Proved:** [T0987](#t0987), [T1129](#t1129).

### src/endpoints/jobCategories/jobCategories-router.js

<a id="b386"></a>**B386** — [src/endpoints/jobCategories/jobCategories-router.js:30](../../src/endpoints/jobCategories/jobCategories-router.js#L30) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while updating the Job Category.', status: 500 }); } `

**Proved:** [T0229](#t0229).

<a id="b387"></a>**B387** — [src/endpoints/jobCategories/jobCategories-router.js:32](../../src/endpoints/jobCategories/jobCategories-router.js#L32) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while updating the Job Category.', status: 500 }) `

**Proved:** [T0229](#t0229).

<a id="b388"></a>**B388** — [src/endpoints/jobCategories/jobCategories-router.js:55](../../src/endpoints/jobCategories/jobCategories-router.js#L55) · response · `<handler>`

` res.status(404).send({ message: 'Job category not found.', status: 404 }) `

**Proved:** [T0238](#t0238), [T0235](#t0235).

<a id="b389"></a>**B389** — [src/endpoints/jobCategories/jobCategories-router.js:58](../../src/endpoints/jobCategories/jobCategories-router.js#L58) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while updating the Job Category.', status: 500 }); } `

**Proved:** [T0237](#t0237).

<a id="b390"></a>**B390** — [src/endpoints/jobCategories/jobCategories-router.js:60](../../src/endpoints/jobCategories/jobCategories-router.js#L60) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while updating the Job Category.', status: 500 }) `

**Proved:** [T0237](#t0237).

<a id="b391"></a>**B391** — [src/endpoints/jobCategories/jobCategories-router.js:74](../../src/endpoints/jobCategories/jobCategories-router.js#L74) · throw · `<handler>`

` throw new Error('Job Category is in use by Job Types.'); `

**Proved:** [T0206](#t0206), [T0092](#t0092).

<a id="b392"></a>**B392** — [src/endpoints/jobCategories/jobCategories-router.js:79](../../src/endpoints/jobCategories/jobCategories-router.js#L79) · response · `<handler>`

` res.status(404).send({ message: 'Job category not found.', status: 404 }) `

**Proved:** [T0207](#t0207), [T0204](#t0204).

<a id="b393"></a>**B393** — [src/endpoints/jobCategories/jobCategories-router.js:82](../../src/endpoints/jobCategories/jobCategories-router.js#L82) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while updating the Job Category.', status: 500 }); } `

**Proved:** [T0206](#t0206), [T0092](#t0092).

<a id="b394"></a>**B394** — [src/endpoints/jobCategories/jobCategories-router.js:84](../../src/endpoints/jobCategories/jobCategories-router.js#L84) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while updating the Job Category.', status: 500 }) `

**Proved:** [T0206](#t0206), [T0092](#t0092).

### src/endpoints/jobType/jobType-router.js

<a id="b395"></a>**B395** — [src/endpoints/jobType/jobType-router.js:33](../../src/endpoints/jobType/jobType-router.js#L33) · catch · `<handler>`

` catch (error) { console.error(error.message); res.send({ message: error.message || 'Error creating jobType.', status: 500 }); } `

**Proved:** [T0230](#t0230), [T1041](#t1041).

<a id="b396"></a>**B396** — [src/endpoints/jobType/jobType-router.js:35](../../src/endpoints/jobType/jobType-router.js#L35) · response · `<handler>`

` res.send({ message: error.message || 'Error creating jobType.', status: 500 }) `

**Proved:** [T0230](#t0230), [T1041](#t1041).

<a id="b397"></a>**B397** — [src/endpoints/jobType/jobType-router.js:77](../../src/endpoints/jobType/jobType-router.js#L77) · response · `<handler>`

` res.status(404).send({ message: 'Job type not found.', status: 404 }) `

**Proved:** [T0242](#t0242), [T0239](#t0239).

<a id="b398"></a>**B398** — [src/endpoints/jobType/jobType-router.js:84](../../src/endpoints/jobType/jobType-router.js#L84) · response · `<handler>`

` res.status(404).send({ message: 'Job type not found.', status: 404 }) `

**Proved:** [T0856](#t0856).

<a id="b399"></a>**B399** — [src/endpoints/jobType/jobType-router.js:87](../../src/endpoints/jobType/jobType-router.js#L87) · catch · `<handler>`

` catch (error) { console.error(error.message); res.send({ message: error.message || 'Error updating jobType.', status: 500 }); } `

**Proved:** [T0241](#t0241), [T1042](#t1042).

<a id="b400"></a>**B400** — [src/endpoints/jobType/jobType-router.js:89](../../src/endpoints/jobType/jobType-router.js#L89) · response · `<handler>`

` res.send({ message: error.message || 'Error updating jobType.', status: 500 }) `

**Proved:** [T0241](#t0241), [T1042](#t1042).

<a id="b401"></a>**B401** — [src/endpoints/jobType/jobType-router.js:103](../../src/endpoints/jobType/jobType-router.js#L103) · throw · `<handler>`

` throw new Error('Cannot delete jobType that is in use.'); `

**Proved:** [T0210](#t0210), [T0092](#t0092).

<a id="b402"></a>**B402** — [src/endpoints/jobType/jobType-router.js:108](../../src/endpoints/jobType/jobType-router.js#L108) · response · `<handler>`

` res.status(404).send({ message: 'Job type not found.', status: 404 }) `

**Proved:** [T0211](#t0211), [T0208](#t0208).

<a id="b403"></a>**B403** — [src/endpoints/jobType/jobType-router.js:111](../../src/endpoints/jobType/jobType-router.js#L111) · catch · `<handler>`

` catch (error) { console.error(error.message); res.send({ message: error.message || 'Error deleting jobType.', status: 500 }); } `

**Proved:** [T0210](#t0210), [T0092](#t0092).

<a id="b404"></a>**B404** — [src/endpoints/jobType/jobType-router.js:113](../../src/endpoints/jobType/jobType-router.js#L113) · response · `<handler>`

` res.send({ message: error.message || 'Error deleting jobType.', status: 500 }) `

**Proved:** [T0210](#t0210), [T0092](#t0092).

### src/endpoints/notifications/notifications-router.js

<a id="b405"></a>**B405** — [src/endpoints/notifications/notifications-router.js:43](../../src/endpoints/notifications/notifications-router.js#L43) · response · `<handler>`

` res.status(404).json({ message: 'notification not found' }) `

**Proved:** [T0135](#t0135).

### src/endpoints/notifications/notifications-service.js

<a id="b406"></a>**B406** — [src/endpoints/notifications/notifications-service.js:10](../../src/endpoints/notifications/notifications-service.js#L10) · throw · `insertNotification`

` throw new Error('accountId, userId, type, and title are required'); `

**outside HTTP:** insertNotification has no src callers. HTTP-triggered ingestion uses insertForUsers, which builds notification rows directly. Direct helper proof: [T0041](#t0041).

### src/endpoints/payments/ledger-helpers.js

<a id="b407"></a>**B407** — [src/endpoints/payments/ledger-helpers.js:64](../../src/endpoints/payments/ledger-helpers.js#L64) · throw · `lockCustomerLedger`

` throw ruleError('No customer selected.', 400); `

**Proved:** [T1162](#t1162).

<a id="b408"></a>**B408** — [src/endpoints/payments/ledger-helpers.js:66](../../src/endpoints/payments/ledger-helpers.js#L66) · throw · `lockCustomerLedger`

` throw ruleError('Customer not found for this account.', 404); `

**Proved:** [T0940](#t0940), [T1092](#t1092).

<a id="b409"></a>**B409** — [src/endpoints/payments/ledger-helpers.js:77](../../src/endpoints/payments/ledger-helpers.js#L77) · throw · `lockCustomerLedgerForRow`

` throw ruleError(notFoundMessage, 404); `

**Proved:** [T1129](#t1129), [T1132](#t1132).

<a id="b410"></a>**B410** — [src/endpoints/payments/ledger-helpers.js:82](../../src/endpoints/payments/ledger-helpers.js#L82) · throw · `lockCustomerLedgerForRow`

` throw ruleError(notFoundMessage, 404); `

**Proved:** [T1247](#t1247), [T1130](#t1130).

<a id="b411"></a>**B411** — [src/endpoints/payments/ledger-helpers.js:123](../../src/endpoints/payments/ledger-helpers.js#L123) · throw · `ledgerRowBilledQuery`

`` throw new Error(`Unsupported ledger table for the billed gate: ${table}`); ``

**Proved:** [T0042](#t0042).

<a id="b412"></a>**B412** — [src/endpoints/payments/ledger-helpers.js:146](../../src/endpoints/payments/ledger-helpers.js#L146) · throw · `isLedgerRowBilled`

`` throw new Error(`Unsupported ledger table for the billed gate: ${anchor && anchor.table}`); ``

**unreachable:** All isLedgerRowBilled callers pass hard-coded whitelisted table names (invoices, payments, writeoffs, transactions or retainers); no request field chooses the table.

<a id="b413"></a>**B413** — [src/endpoints/payments/ledger-helpers.js:396](../../src/endpoints/payments/ledger-helpers.js#L396) · throw · `resolveRetainerDrawForPayment`

`` throw drawError( 'RETAINER_DRAW_MISMATCH', `Payment #${paymentId} records retainer draw #${markedId}, but that row ${problem}. The retainer balance cannot be adjusted automatically — contact an administrator to reconcile retainer #${rootId}.` ); ``

**Proved:** [T0082](#t0082), [T0044](#t0044).

<a id="b414"></a>**B414** — [src/endpoints/payments/ledger-helpers.js:407](../../src/endpoints/payments/ledger-helpers.js#L407) · throw · `resolveRetainerDrawForPayment`

`` throw drawError( 'RETAINER_DRAW_NOT_FOUND', `Could not find the retainer draw recorded with payment #${paymentId}, so the retainer balance cannot be adjusted automatically. Contact an administrator to reconcile retainer #${rootId}.` ); ``

**Proved:** [T1147](#t1147).

<a id="b415"></a>**B415** — [src/endpoints/payments/ledger-helpers.js:412](../../src/endpoints/payments/ledger-helpers.js#L412) · throw · `resolveRetainerDrawForPayment`

`` throw drawError( 'RETAINER_DRAW_AMBIGUOUS', `Payment #${paymentId} was recorded before retainer draws were linked to their payments, and ${candidates.length} draws on retainer #${rootId} ` + `(${candidates.map(c => `#${c.retainer_id}`).join(', ')}) were written within a second of it, so the draw that belongs to this payment cannot be dete ``

**Proved:** [T1021](#t1021).

### src/endpoints/payments/payment-logic.js

<a id="b416"></a>**B416** — [src/endpoints/payments/payment-logic.js:164](../../src/endpoints/payments/payment-logic.js#L164) · throw · `getCurrentChainTargets`

`` throw ruleError( `This customer's current invoice${targets.length > 1 ? 's' : ''} (${targets.map(t => t.parent.invoice_number).join(', ')}) ` + `${targets.length > 1 ? 'are' : 'is'} all marked absorbed by a newer statement that cannot be found. The ledger is inconsistent and cannot ` + 'safely accept new money right now — finalize or repa ``

**Proved:** [T1119](#t1119), [T1026](#t1026).

<a id="b417"></a>**B417** — [src/endpoints/payments/payment-logic.js:187](../../src/endpoints/payments/payment-logic.js#L187) · throw · `pickCurrentChainTarget`

` throw ruleError(zeroRemainingMessage(target)); `

**Proved:** [T1269](#t1269), [T0043](#t0043).

<a id="b418"></a>**B418** — [src/endpoints/payments/payment-logic.js:207](../../src/endpoints/payments/payment-logic.js#L207) · throw · `checkIfPaymentIsAttachedToInvoice`

` throw ruleError('No matching payment record found.', 404); `

**Proved:** [T0988](#t0988).

<a id="b419"></a>**B419** — [src/endpoints/payments/payment-logic.js:217](../../src/endpoints/payments/payment-logic.js#L217) · throw · `checkIfPaymentIsAttachedToInvoice`

` throw ruleError('Payment is attached to an invoice and cannot be deleted or Modified.', 423); `

**Proved:** [T0287](#t0287), [T1014](#t1014).

<a id="b420"></a>**B420** — [src/endpoints/payments/payment-logic.js:232](../../src/endpoints/payments/payment-logic.js#L232) · throw · `loadRetainerDrawForMutation`

` throw ruleError('Retainer is attached to an invoice and cannot be deleted or Modified.', 423); `

**Proved:** [T1015](#t1015).

<a id="b421"></a>**B421** — [src/endpoints/payments/payment-logic.js:254](../../src/endpoints/payments/payment-logic.js#L254) · throw · `assertNotReversed`

`` throw ruleError(`Payment #${paymentRecord.payment_id} has been reversed (reversal entry #${reversal.payment_id}). Delete the reversal first, then ${action} this payment.`); ``

**Proved:** [T1011](#t1011).

<a id="b422"></a>**B422** — [src/endpoints/payments/payment-logic.js:362](../../src/endpoints/payments/payment-logic.js#L362) · throw · `assertPaymentJobOwner`

` throw ruleError('The selected job does not belong to this customer. Re-select the job.'); `

**Proved:** [T1083](#t1083), [T1253](#t1253).

<a id="b423"></a>**B423** — [src/endpoints/payments/payment-logic.js:438](../../src/endpoints/payments/payment-logic.js#L438) · throw · `<handler>`

` throw ruleError('Payment amount must be greater than $0.00.', 400); `

**unreachable:** Strict payment create/update input builders require a positive cent amount and valid date before this core is entered. The same typed fields are forwarded unchanged; malformed input is tested at those earlier guards.

<a id="b424"></a>**B424** — [src/endpoints/payments/payment-logic.js:441](../../src/endpoints/payments/payment-logic.js#L441) · throw · `<handler>`

` throw ruleError('A valid payment date is required.', 400); `

**unreachable:** Strict payment create/update input builders require a positive cent amount and valid date before this core is entered. The same typed fields are forwarded unchanged; malformed input is tested at those earlier guards.

<a id="b425"></a>**B425** — [src/endpoints/payments/payment-logic.js:448](../../src/endpoints/payments/payment-logic.js#L448) · throw · `<handler>`

` throw ruleError('A retainer-funded payment must be applied to an invoice.', 400); `

**Proved:** [T1084](#t1084).

<a id="b426"></a>**B426** — [src/endpoints/payments/payment-logic.js:460](../../src/endpoints/payments/payment-logic.js#L460) · throw · `<handler>`

` throw ruleError('No invoice ID provided for this payment. If the customer has no open invoice, record the funds as a retainer/prepayment instead.', 400); `

**Proved:** [T1085](#t1085), [T0270](#t0270).

<a id="b427"></a>**B427** — [src/endpoints/payments/payment-logic.js:467](../../src/endpoints/payments/payment-logic.js#L467) · throw · `<handler>`

` throw ruleError('No matching invoice record found for this payment.', 404); `

**Proved:** [T1089](#t1089), [T1254](#t1254).

<a id="b428"></a>**B428** — [src/endpoints/payments/payment-logic.js:470](../../src/endpoints/payments/payment-logic.js#L470) · throw · `<handler>`

`` throw ruleError(`Invoice ${requestedInvoice.invoice_number} belongs to a different customer than this payment. Re-select the invoice.`); ``

**Proved:** [T1087](#t1087), [T1251](#t1251).

<a id="b429"></a>**B429** — [src/endpoints/payments/payment-logic.js:481](../../src/endpoints/payments/payment-logic.js#L481) · throw · `<handler>`

` throw ruleError('This customer has no invoices to apply a payment to. Record the funds as a retainer/prepayment instead.'); `

**Proved:** [T1148](#t1148).

<a id="b430"></a>**B430** — [src/endpoints/payments/payment-logic.js:511](../../src/endpoints/payments/payment-logic.js#L511) · throw · `<handler>`

`` throw ruleError( `Payment amount exceeds remaining balance on invoice ${target.parent.invoice_number}. Max amount that can be applied to this invoice is $${Math.max(0, remaining)}.` ); ``

**Proved:** [T1088](#t1088), [T1118](#t1118).

<a id="b431"></a>**B431** — [src/endpoints/payments/payment-logic.js:591](../../src/endpoints/payments/payment-logic.js#L591) · throw · `assertRetainerDrawAdjustable`

`` throw ruleError( `Could not find the retainer draw recorded with payment #${paymentRecord.payment_id}, so the retainer balance cannot be adjusted automatically. Contact an administrator to reconcile retainer #${paymentRecord.retainer_id}.` ); ``

**unreachable:** loadRetainerDrawForMutation calls resolveRetainerDrawForPayment first. For a retainer-linked payment it either returns the exact draw or throws the tested missing/ambiguous/mismatched-draw error; it cannot return null to this later assertion.

<a id="b432"></a>**B432** — [src/endpoints/payments/payment-logic.js:598](../../src/endpoints/payments/payment-logic.js#L598) · throw · `assertRetainerDrawAdjustable`

` throw ruleError('A newer draw has been made on this retainer since this payment. Edit or delete the newer retainer-funded entries first.'); `

**Proved:** [T1022](#t1022).

<a id="b433"></a>**B433** — [src/endpoints/payments/payment-logic.js:603](../../src/endpoints/payments/payment-logic.js#L603) · throw · `assertRetainerDrawAdjustable`

`` throw ruleError(`This payment was recorded automatically for retainer-funded time/charge entry #${linkedTransaction.transaction_id}. Edit or delete that entry instead.`); ``

**Proved:** [T1019](#t1019).

<a id="b434"></a>**B434** — [src/endpoints/payments/payment-logic.js:661](../../src/endpoints/payments/payment-logic.js#L661) · throw · `findOverpaymentPrepayment`

`` throw ruleError( `Payment #${paymentRecord.payment_id} predates exact prepayment linking, and ${rows.length} prepayment retainers (${rows.map(r => `#${r.retainer_id}`).join(', ')}) match its $${excess.toFixed(2)} overpayment, so the one it banked cannot be determined. Nothing was changed — contact an administrator.` ); ``

**Proved:** [T1146](#t1146).

<a id="b435"></a>**B435** — [src/endpoints/payments/payment-logic.js:712](../../src/endpoints/payments/payment-logic.js#L712) · throw · `planOverpaymentPrepaymentRelease`

`` throw ruleError( `Payment #${paymentRecord.payment_id} has been reversed and prepayment retainer #${prepayment.retainer_id} banked from its overpayment was cancelled with it. Delete the reversal first, then retry.` ); ``

**Proved:** [T1139](#t1139).

<a id="b436"></a>**B436** — [src/endpoints/payments/payment-logic.js:717](../../src/endpoints/payments/payment-logic.js#L717) · throw · `planOverpaymentPrepaymentRelease`

`` throw ruleError( `The ${moneyText(prepayment.starting_amount)} prepayment retainer #${prepayment.retainer_id} banked from this payment's overpayment has already been used. Reverse or delete the entries drawn from it first, then retry.` ); ``

**Proved:** [T1061](#t1061), [T1018](#t1018).

<a id="b437"></a>**B437** — [src/endpoints/payments/payment-logic.js:744](../../src/endpoints/payments/payment-logic.js#L744) · throw · `planOverpaymentPrepaymentCancel`

`` throw ruleError( `Cannot reverse payment #${original.payment_id}: ${moneyText(prepayment.starting_amount)} of this payment was banked as prepayment retainer #${prepayment.retainer_id} (overpayment excess), ` + `and that prepayment has already been used (${use.usage || 'balance changed'}). Adjust the retainer first — delete or reverse the  ``

**Proved:** [T1061](#t1061), [T1189](#t1189).

<a id="b438"></a>**B438** — [src/endpoints/payments/payment-logic.js:785](../../src/endpoints/payments/payment-logic.js#L785) · throw · `planCancelledPrepaymentRestore`

`` throw ruleError( `Prepayment retainer #${prepayment.retainer_id} was cancelled by this reversal and has changed since, so it cannot be restored automatically. Nothing was changed — contact an administrator to reconcile retainer #${prepayment.retainer_id}.` ); ``

**Proved:** [T1135](#t1135).

<a id="b439"></a>**B439** — [src/endpoints/payments/payment-logic.js:839](../../src/endpoints/payments/payment-logic.js#L839) · throw · `<handler>`

`` throw ruleError(`Payment #${paymentRecord.payment_id} is linked to invoice ${paymentInvoiceRecord.invoice_number} of a different customer. Contact an administrator to correct the link.`); ``

**Proved:** [T1149](#t1149).

<a id="b440"></a>**B440** — [src/endpoints/payments/payment-logic.js:848](../../src/endpoints/payments/payment-logic.js#L848) · throw · `<handler>`

` throw ruleError('A newer payment or write-off has been applied to this invoice since this payment. Delete the newer entries first, then retry.'); `

**Proved:** [T1212](#t1212), [T1126](#t1126).

<a id="b441"></a>**B441** — [src/endpoints/payments/payment-logic.js:914](../../src/endpoints/payments/payment-logic.js#L914) · throw · `<handler>`

` throw ruleError('Reversal entries cannot be edited. Delete the reversal and re-enter it if the amount or reason was wrong.'); `

**Proved:** [T1059](#t1059).

<a id="b442"></a>**B442** — [src/endpoints/payments/payment-logic.js:920](../../src/endpoints/payments/payment-logic.js#L920) · throw · `<handler>`

` throw ruleError('Moving a payment to a different invoice is not supported. Delete the payment and re-enter it against the correct invoice.'); `

**Proved:** [T1126](#t1126), [T0285](#t0285).

<a id="b443"></a>**B443** — [src/endpoints/payments/payment-logic.js:923](../../src/endpoints/payments/payment-logic.js#L923) · throw · `<handler>`

` throw ruleError('Moving a payment to a different customer is not supported. Delete the payment and re-enter it for the correct customer.'); `

**Proved:** [T1126](#t1126).

<a id="b444"></a>**B444** — [src/endpoints/payments/payment-logic.js:926](../../src/endpoints/payments/payment-logic.js#L926) · throw · `<handler>`

` throw ruleError('Changing the retainer that funded a payment is not supported. Delete the payment and re-enter it.'); `

**Proved:** [T1126](#t1126).

<a id="b445"></a>**B445** — [src/endpoints/payments/payment-logic.js:929](../../src/endpoints/payments/payment-logic.js#L929) · throw · `<handler>`

`` throw ruleError(`Payment #${paymentRecord.payment_id} is linked to invoice ${paymentInvoiceRecord.invoice_number} of a different customer. Contact an administrator to correct the link.`); ``

**Proved:** [T1149](#t1149).

<a id="b446"></a>**B446** — [src/endpoints/payments/payment-logic.js:935](../../src/endpoints/payments/payment-logic.js#L935) · throw · `<handler>`

` throw ruleError('Payment amount must be greater than $0.00.', 400); `

**unreachable:** Strict payment create/update input builders require a positive cent amount and valid date before this core is entered. The same typed fields are forwarded unchanged; malformed input is tested at those earlier guards.

<a id="b447"></a>**B447** — [src/endpoints/payments/payment-logic.js:944](../../src/endpoints/payments/payment-logic.js#L944) · throw · `<handler>`

`` throw ruleError(`This payment is linked directly to invoice ${paymentInvoiceRecord.invoice_number} and cannot be re-priced. Delete it and re-enter it.`); ``

**Proved:** [T1150](#t1150).

<a id="b448"></a>**B448** — [src/endpoints/payments/payment-logic.js:952](../../src/endpoints/payments/payment-logic.js#L952) · throw · `<handler>`

` throw ruleError('A newer payment or write-off has been applied to this invoice since this payment. Edit or delete the newer entries first.'); `

**Proved:** [T1126](#t1126), [T0286](#t0286).

<a id="b449"></a>**B449** — [src/endpoints/payments/payment-logic.js:958](../../src/endpoints/payments/payment-logic.js#L958) · throw · `<handler>`

`` throw ruleError(`Payment amount exceeds remaining balance on invoice ${paymentInvoiceRecord.invoice_number}. Max increase is $${snapshotRemaining}.`); ``

**Proved:** [T1126](#t1126).

<a id="b450"></a>**B450** — [src/endpoints/payments/payment-logic.js:970](../../src/endpoints/payments/payment-logic.js#L970) · throw · `<handler>`

`` throw ruleError(`Payment amount exceeds remaining balance on retainer. Max increase is $${maxIncrease}.`); ``

**Proved:** [T1147](#t1147).

<a id="b451"></a>**B451** — [src/endpoints/payments/payment-logic.js:1025](../../src/endpoints/payments/payment-logic.js#L1025) · throw · `reversePayment`

` throw ruleError('No payment ID provided for the reversal.', 400); `

**Proved:** [T1129](#t1129), [T1132](#t1132).

<a id="b452"></a>**B452** — [src/endpoints/payments/payment-logic.js:1028](../../src/endpoints/payments/payment-logic.js#L1028) · throw · `reversePayment`

` throw ruleError('A reversal reason is required (e.g. "NSF — check #1234 returned").', 400); `

**Proved:** [T1126](#t1126), [T0273](#t0273).

<a id="b453"></a>**B453** — [src/endpoints/payments/payment-logic.js:1030](../../src/endpoints/payments/payment-logic.js#L1030) · throw · `reversePayment`

` throw ruleError('The user recording the reversal could not be identified.', 401); `

**unreachable:** Reverse routes supply req.user.user_id from requireAuth, not the URL/body. A missing/nonpositive actor is refused before entering reversePayment.

<a id="b454"></a>**B454** — [src/endpoints/payments/payment-logic.js:1040](../../src/endpoints/payments/payment-logic.js#L1040) · throw · `<handler>`

`` throw ruleError(`locked: part of sent invoice ${sentNumber}`, 409, 'SENT_INVOICE_LOCKED'); ``

**Proved:** [T1168](#t1168).

<a id="b455"></a>**B455** — [src/endpoints/payments/payment-logic.js:1042](../../src/endpoints/payments/payment-logic.js#L1042) · throw · `<handler>`

` throw ruleError('This entry is already a reversal and cannot be reversed.'); `

**Proved:** [T0271](#t0271), [T1028](#t1028).

<a id="b456"></a>**B456** — [src/endpoints/payments/payment-logic.js:1043](../../src/endpoints/payments/payment-logic.js#L1043) · throw · `<handler>`

` throw ruleError('This payment has already been reversed.'); `

**Proved:** [T1059](#t1059), [T0271](#t0271).

<a id="b457"></a>**B457** — [src/endpoints/payments/payment-logic.js:1045](../../src/endpoints/payments/payment-logic.js#L1045) · throw · `<handler>`

` throw ruleError('This payment has already been reversed.'); `

**Proved:** [T1016](#t1016).

<a id="b458"></a>**B458** — [src/endpoints/payments/payment-logic.js:1046](../../src/endpoints/payments/payment-logic.js#L1046) · throw · `<handler>`

` throw ruleError('Retainer-funded payments cannot be reversed here — adjust the retainer instead.'); `

**Proved:** [T1057](#t1057).

<a id="b459"></a>**B459** — [src/endpoints/payments/payment-logic.js:1051](../../src/endpoints/payments/payment-logic.js#L1051) · throw · `<handler>`

` throw ruleError('This customer has no invoices; the reversal has nowhere to restore the balance.'); `

**Proved:** [T1148](#t1148).

### src/endpoints/payments/payments-router.js

<a id="b460"></a>**B460** — [src/endpoints/payments/payments-router.js:38](../../src/endpoints/payments/payments-router.js#L38) · catch · `<handler>`

` catch (err) { console.log(err); res.status(err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while creating the Payment.', status: err.inputValidation ? 400 : 500 }); } `

**Proved:** [T1265](#t1265), [T1086](#t1086).

<a id="b461"></a>**B461** — [src/endpoints/payments/payments-router.js:40](../../src/endpoints/payments/payments-router.js#L40) · response · `<handler>`

` res.status(err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while creating the Payment.', status: err.inputValidation ? 400 : 500 }) `

**Proved:** [T1265](#t1265), [T1086](#t1086).

<a id="b462"></a>**B462** — [src/endpoints/payments/payments-router.js:64](../../src/endpoints/payments/payments-router.js#L64) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while reversing the payment.', status: 500 }); } `

**Proved:** [T1129](#t1129), [T1130](#t1130).

<a id="b463"></a>**B463** — [src/endpoints/payments/payments-router.js:66](../../src/endpoints/payments/payments-router.js#L66) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while reversing the payment.', status: 500 }) `

**Proved:** [T1129](#t1129), [T1130](#t1130).

<a id="b464"></a>**B464** — [src/endpoints/payments/payments-router.js:98](../../src/endpoints/payments/payments-router.js#L98) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: clientSafeMessage(err, 'An error occurred while retrieving the payment.'), status: 500 }); } `

**Proved:** [T1113](#t1113).

<a id="b465"></a>**B465** — [src/endpoints/payments/payments-router.js:100](../../src/endpoints/payments/payments-router.js#L100) · response · `<handler>`

` res.send({ message: clientSafeMessage(err, 'An error occurred while retrieving the payment.'), status: 500 }) `

**Proved:** [T1113](#t1113).

<a id="b466"></a>**B466** — [src/endpoints/payments/payments-router.js:124](../../src/endpoints/payments/payments-router.js#L124) · catch · `<handler>`

` catch (err) { console.log(err); res.status(err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while updating the Payment.', status: err.inputValidation ? 400 : 500 }); } `

**Proved:** [T1239](#t1239), [T1240](#t1240).

<a id="b467"></a>**B467** — [src/endpoints/payments/payments-router.js:126](../../src/endpoints/payments/payments-router.js#L126) · response · `<handler>`

` res.status(err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while updating the Payment.', status: err.inputValidation ? 400 : 500 }) `

**Proved:** [T1239](#t1239), [T1240](#t1240).

<a id="b468"></a>**B468** — [src/endpoints/payments/payments-router.js:148](../../src/endpoints/payments/payments-router.js#L148) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while deleting the Payment.', status: 500 }); } `

**Proved:** [T0988](#t0988), [T1129](#t1129).

<a id="b469"></a>**B469** — [src/endpoints/payments/payments-router.js:150](../../src/endpoints/payments/payments-router.js#L150) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while deleting the Payment.', status: 500 }) `

**Proved:** [T0988](#t0988), [T1129](#t1129).

<a id="b470"></a>**B470** — [src/endpoints/payments/payments-router.js:192](../../src/endpoints/payments/payments-router.js#L192) · catch · `<handler>`

` catch (error) { console.error('Error fetching paginated payments:', error); const isPaginationError = error.message && error.message.includes('Invalid pagination'); const statusCode = isPaginationError ? 400 : 500; res.status(statusCode).send({ message: error. `

**Proved:** [T0258](#t0258).

<a id="b471"></a>**B471** — [src/endpoints/payments/payments-router.js:196](../../src/endpoints/payments/payments-router.js#L196) · response · `<handler>`

` res.status(statusCode).send({ message: error.message || 'An error occurred while retrieving payments.', status: statusCode }) `

**Proved:** [T0258](#t0258).

### src/endpoints/pendingPayments/pendingPayments-logic.js

<a id="b472"></a>**B472** — [src/endpoints/pendingPayments/pendingPayments-logic.js:12](../../src/endpoints/pendingPayments/pendingPayments-logic.js#L12) · throw · `validatePendingPaymentExists`

` throw pendingPaymentNotFound(); `

**Proved:** [T0292](#t0292), [T0269](#t0269).

<a id="b473"></a>**B473** — [src/endpoints/pendingPayments/pendingPayments-logic.js:15](../../src/endpoints/pendingPayments/pendingPayments-logic.js#L15) · throw · `validatePendingPaymentExists`

` throw pendingPaymentNotFound(); `

**Proved:** [T0292](#t0292), [T0268](#t0268).

<a id="b474"></a>**B474** — [src/endpoints/pendingPayments/pendingPayments-logic.js:22](../../src/endpoints/pendingPayments/pendingPayments-logic.js#L22) · throw · `validateCanApprove`

` throw new Error('This payment has already been processed.'); `

**Proved:** [T0274](#t0274), [T0275](#t0275).

<a id="b475"></a>**B475** — [src/endpoints/pendingPayments/pendingPayments-logic.js:25](../../src/endpoints/pendingPayments/pendingPayments-logic.js#L25) · throw · `validateCanApprove`

` throw new Error('This payment has been deleted and cannot be processed.'); `

**Proved:** [T0884](#t0884).

<a id="b476"></a>**B476** — [src/endpoints/pendingPayments/pendingPayments-logic.js:31](../../src/endpoints/pendingPayments/pendingPayments-logic.js#L31) · throw · `validateCanDelete`

` throw new Error('This payment has already been processed and cannot be deleted.'); `

**Proved:** [T0293](#t0293).

<a id="b477"></a>**B477** — [src/endpoints/pendingPayments/pendingPayments-logic.js:34](../../src/endpoints/pendingPayments/pendingPayments-logic.js#L34) · throw · `validateCanDelete`

` throw new Error('This payment is already deleted.'); `

**Proved:** [T0291](#t0291).

### src/endpoints/pendingPayments/pendingPayments-router.js

<a id="b478"></a>**B478** — [src/endpoints/pendingPayments/pendingPayments-router.js:30](../../src/endpoints/pendingPayments/pendingPayments-router.js#L30) · response · `sendPendingPaymentError`

` res.status(statusCode).send({ message: error.statusCode ? error.message : clientSafeMessage(error, fallback), status: statusCode }) `

**Proved:** [T0883](#t0883), [T0291](#t0291).

<a id="b479"></a>**B479** — [src/endpoints/pendingPayments/pendingPayments-router.js:64](../../src/endpoints/pendingPayments/pendingPayments-router.js#L64) · catch · `<handler>`

` catch (error) { console.error('Error fetching pending payments:', error); // Same contract as GET /payments/getPayments: bad paging input is a 400. const isPaginationError = Boolean(error.message && error.message.includes('Invalid pagination')); const statusCo `

**Proved:** [T0266](#t0266).

<a id="b480"></a>**B480** — [src/endpoints/pendingPayments/pendingPayments-router.js:69](../../src/endpoints/pendingPayments/pendingPayments-router.js#L69) · response · `<handler>`

` res.status(statusCode).send({ message: isPaginationError ? error.message : clientSafeMessage(error, 'An error occurred while retrieving pending payments.'), status: statusCode }) `

**Proved:** [T0266](#t0266).

<a id="b481"></a>**B481** — [src/endpoints/pendingPayments/pendingPayments-router.js:85](../../src/endpoints/pendingPayments/pendingPayments-router.js#L85) · catch · `<handler>`

` catch (error) { console.error('Error fetching pending payment counts:', error); res.status(500).send({ message: error.message, status: 500 }); } `

**Proved:** [T0879](#t0879).

<a id="b482"></a>**B482** — [src/endpoints/pendingPayments/pendingPayments-router.js:87](../../src/endpoints/pendingPayments/pendingPayments-router.js#L87) · response · `<handler>`

` res.status(500).send({ message: error.message, status: 500 }) `

**Proved:** [T0879](#t0879).

<a id="b483"></a>**B483** — [src/endpoints/pendingPayments/pendingPayments-router.js:100](../../src/endpoints/pendingPayments/pendingPayments-router.js#L100) · catch · `<handler>`

` catch (error) { console.error('Error fetching single pending payment:', error); sendPendingPaymentError(res, error, 'An error occurred while retrieving the pending payment.'); } `

**Proved:** [T0883](#t0883), [T0269](#t0269).

<a id="b484"></a>**B484** — [src/endpoints/pendingPayments/pendingPayments-router.js:117](../../src/endpoints/pendingPayments/pendingPayments-router.js#L117) · throw · `<handler>`

` throw httpError(409, 'Payment state changed; refresh before deleting.'); `

**Proved:** [T1037](#t1037).

<a id="b485"></a>**B485** — [src/endpoints/pendingPayments/pendingPayments-router.js:122](../../src/endpoints/pendingPayments/pendingPayments-router.js#L122) · catch · `<handler>`

` catch (error) { console.error('Error soft-deleting pending payment:', error); sendPendingPaymentError(res, error, 'An error occurred while deleting the pending payment.'); } `

**Proved:** [T0291](#t0291), [T0293](#t0293).

<a id="b486"></a>**B486** — [src/endpoints/pendingPayments/pendingPayments-router.js:159](../../src/endpoints/pendingPayments/pendingPayments-router.js#L159) · throw · `<handler>`

` throw httpError(400, 'pendingPaymentId is required.'); `

**Proved:** [T0278](#t0278), [T1013](#t1013).

<a id="b487"></a>**B487** — [src/endpoints/pendingPayments/pendingPayments-router.js:163](../../src/endpoints/pendingPayments/pendingPayments-router.js#L163) · throw · `<handler>`

` throw httpError(400, 'payment is required.'); `

**Proved:** [T0277](#t0277).

<a id="b488"></a>**B488** — [src/endpoints/pendingPayments/pendingPayments-router.js:170](../../src/endpoints/pendingPayments/pendingPayments-router.js#L170) · throw · `<handler>`

` throw httpError(404, 'Pending payment record not found.'); `

**Proved:** [T0276](#t0276).

<a id="b489"></a>**B489** — [src/endpoints/pendingPayments/pendingPayments-router.js:173](../../src/endpoints/pendingPayments/pendingPayments-router.js#L173) · catch · `<handler>`

` catch (err) { throw httpError(409, err.message); } `

**Proved:** [T0884](#t0884), [T0274](#t0274).

<a id="b490"></a>**B490** — [src/endpoints/pendingPayments/pendingPayments-router.js:174](../../src/endpoints/pendingPayments/pendingPayments-router.js#L174) · throw · `<handler>`

` throw httpError(409, err.message); `

**Proved:** [T0884](#t0884), [T0274](#t0274).

<a id="b491"></a>**B491** — [src/endpoints/pendingPayments/pendingPayments-router.js:178](../../src/endpoints/pendingPayments/pendingPayments-router.js#L178) · throw · `<handler>`

`` throw httpError(409, `Payment #${alreadyPosted.payment_id} was already posted from this pending payment.`); ``

**Proved:** [T0885](#t0885).

<a id="b492"></a>**B492** — [src/endpoints/pendingPayments/pendingPayments-router.js:203](../../src/endpoints/pendingPayments/pendingPayments-router.js#L203) · catch · `<handler>`

` catch (error) { console.error('Error approving pending payment:', error); const statusCode = error.statusCode || 500; // Rule refusals carry a user-facing message; an unexpected failure may be a // raw driver/SQL error, which must not reach the client in produ `

**Proved:** [T0884](#t0884), [T0885](#t0885).

<a id="b493"></a>**B493** — [src/endpoints/pendingPayments/pendingPayments-router.js:209](../../src/endpoints/pendingPayments/pendingPayments-router.js#L209) · response · `<handler>`

` res.status(statusCode).send({ message, status: statusCode }) `

**Proved:** [T0884](#t0884), [T0885](#t0885).

<a id="b494"></a>**B494** — [src/endpoints/pendingPayments/pendingPayments-router.js:222](../../src/endpoints/pendingPayments/pendingPayments-router.js#L222) · response · `<handler>`

` res.status(410).send({ status: 410, message: 'This endpoint no longer posts payments. Use POST /pending-payments/approve/:accountID/:userID with { pendingPaymentId, payment } — it posts the ledger entry and marks the pending payment processed atomically.' }) `

**Proved:** [T0290](#t0290), [T0289](#t0289).

<a id="b495"></a>**B495** — [src/endpoints/pendingPayments/pendingPayments-router.js:237](../../src/endpoints/pendingPayments/pendingPayments-router.js#L237) · response · `<handler>`

` res.status(400).json({ message: 'Missing file name header.', status: 400 }) `

**Proved:** [T0281](#t0281).

<a id="b496"></a>**B496** — [src/endpoints/pendingPayments/pendingPayments-router.js:241](../../src/endpoints/pendingPayments/pendingPayments-router.js#L241) · response · `<handler>`

` res.status(400).json({ message: 'Uploaded file is empty or missing.', status: 400 }) `

**Proved:** [T0283](#t0283).

<a id="b497"></a>**B497** — [src/endpoints/pendingPayments/pendingPayments-router.js:245](../../src/endpoints/pendingPayments/pendingPayments-router.js#L245) · response · `<handler>`

` res.status(400).json({ message: 'File exceeds the 10MB size limit.', status: 400 }) `

**Proved:** [T0280](#t0280).

<a id="b498"></a>**B498** — [src/endpoints/pendingPayments/pendingPayments-router.js:252](../../src/endpoints/pendingPayments/pendingPayments-router.js#L252) · response · `<handler>`

` res.status(400).json({ message: 'Only PDF files are accepted.', status: 400 }) `

**Proved:** [T0282](#t0282), [T0301](#t0301).

<a id="b499"></a>**B499** — [src/endpoints/pendingPayments/pendingPayments-router.js:260](../../src/endpoints/pendingPayments/pendingPayments-router.js#L260) · response · `<handler>`

` res.status(400).json({ message: 'Invalid file name.', status: 400 }) `

**Proved:** [T0298](#t0298).

<a id="b500"></a>**B500** — [src/endpoints/pendingPayments/pendingPayments-router.js:272](../../src/endpoints/pendingPayments/pendingPayments-router.js#L272) · response · `<handler>`

` res.status(403).json({ message: 'Automatic payment PDF processing is not available for this account.', status: 403 }) `

**Proved:** [T0279](#t0279), [T0299](#t0299).

<a id="b501"></a>**B501** — [src/endpoints/pendingPayments/pendingPayments-router.js:290](../../src/endpoints/pendingPayments/pendingPayments-router.js#L290) · catch · `<handler>`

` catch (error) { console.error('Error uploading payment file:', error); res.status(500).send({ message: error.message || 'Upload failed.', status: 500 }); } `

**Proved:** [T0886](#t0886).

<a id="b502"></a>**B502** — [src/endpoints/pendingPayments/pendingPayments-router.js:292](../../src/endpoints/pendingPayments/pendingPayments-router.js#L292) · response · `<handler>`

` res.status(500).send({ message: error.message || 'Upload failed.', status: 500 }) `

**Proved:** [T0886](#t0886).

<a id="b503"></a>**B503** — [src/endpoints/pendingPayments/pendingPayments-router.js:305](../../src/endpoints/pendingPayments/pendingPayments-router.js#L305) · catch · `<handler>`

` catch (error) { console.error('Error fetching payment files:', error); res.status(500).send({ message: error.message, status: 500 }); } `

**Proved:** [T0882](#t0882).

<a id="b504"></a>**B504** — [src/endpoints/pendingPayments/pendingPayments-router.js:307](../../src/endpoints/pendingPayments/pendingPayments-router.js#L307) · response · `<handler>`

` res.status(500).send({ message: error.message, status: 500 }) `

**Proved:** [T0882](#t0882).

<a id="b505"></a>**B505** — [src/endpoints/pendingPayments/pendingPayments-router.js:320](../../src/endpoints/pendingPayments/pendingPayments-router.js#L320) · response · `<handler>`

` res.status(400).json({ message: 'File name is required.', status: 400 }) `

**Proved:** [T0256](#t0256).

<a id="b506"></a>**B506** — [src/endpoints/pendingPayments/pendingPayments-router.js:324](../../src/endpoints/pendingPayments/pendingPayments-router.js#L324) · response · `<handler>`

` res.status(400).json({ message: 'Invalid file name.', status: 400 }) `

**Proved:** [T0294](#t0294).

<a id="b507"></a>**B507** — [src/endpoints/pendingPayments/pendingPayments-router.js:338](../../src/endpoints/pendingPayments/pendingPayments-router.js#L338) · response · `<handler>`

` res.status(404).json({ message: 'File not found.', status: 404 }) `

**Proved:** [T0295](#t0295), [T0253](#t0253).

<a id="b508"></a>**B508** — [src/endpoints/pendingPayments/pendingPayments-router.js:345](../../src/endpoints/pendingPayments/pendingPayments-router.js#L345) · throw · `<handler>`

` throw httpError(404, 'File not found.'); `

**Proved:** [T0878](#t0878).

<a id="b509"></a>**B509** — [src/endpoints/pendingPayments/pendingPayments-router.js:346](../../src/endpoints/pendingPayments/pendingPayments-router.js#L346) · throw · `<handler>`

` throw httpError(400, 'Cannot delete this file because some payments have already been processed.'); `

**Proved:** [T0254](#t0254), [T1038](#t1038).

<a id="b510"></a>**B510** — [src/endpoints/pendingPayments/pendingPayments-router.js:356](../../src/endpoints/pendingPayments/pendingPayments-router.js#L356) · catch · `<handler>`

` catch (error) { console.error('Error deleting payment file:', error); res.status(error.statusCode || 500).send({ message: error.message, status: error.statusCode || 500 }); } `

**Proved:** [T0878](#t0878), [T0254](#t0254).

<a id="b511"></a>**B511** — [src/endpoints/pendingPayments/pendingPayments-router.js:358](../../src/endpoints/pendingPayments/pendingPayments-router.js#L358) · response · `<handler>`

` res.status(error.statusCode || 500).send({ message: error.message, status: error.statusCode || 500 }) `

**Proved:** [T0878](#t0878), [T0254](#t0254).

<a id="b512"></a>**B512** — [src/endpoints/pendingPayments/pendingPayments-router.js:371](../../src/endpoints/pendingPayments/pendingPayments-router.js#L371) · response · `<handler>`

` res.status(400).json({ message: 'File name is required.', status: 400 }) `

**Proved:** [T0263](#t0263).

<a id="b513"></a>**B513** — [src/endpoints/pendingPayments/pendingPayments-router.js:375](../../src/endpoints/pendingPayments/pendingPayments-router.js#L375) · response · `<handler>`

` res.status(400).json({ message: 'Invalid file name.', status: 400 }) `

**Proved:** [T0296](#t0296).

<a id="b514"></a>**B514** — [src/endpoints/pendingPayments/pendingPayments-router.js:390](../../src/endpoints/pendingPayments/pendingPayments-router.js#L390) · response · `<handler>`

` res.status(404).send({ message: 'File not found.', status: 404 }) `

**Proved:** [T0262](#t0262), [T0297](#t0297).

<a id="b515"></a>**B515** — [src/endpoints/pendingPayments/pendingPayments-router.js:405](../../src/endpoints/pendingPayments/pendingPayments-router.js#L405) · catch · `<handler>`

` catch (err) { // Not in processed, try pending } `

**Proved:** [T0880](#t0880), [T0881](#t0881).

<a id="b516"></a>**B516** — [src/endpoints/pendingPayments/pendingPayments-router.js:416](../../src/endpoints/pendingPayments/pendingPayments-router.js#L416) · catch · `<handler>`

` catch (error) { console.error('Error fetching file preview:', error); res.status(404).send({ message: 'File not found.', status: 404 }); } `

**Proved:** [T0880](#t0880).

<a id="b517"></a>**B517** — [src/endpoints/pendingPayments/pendingPayments-router.js:418](../../src/endpoints/pendingPayments/pendingPayments-router.js#L418) · response · `<handler>`

` res.status(404).send({ message: 'File not found.', status: 404 }) `

**Proved:** [T0880](#t0880).

### src/endpoints/quotes/quotes-router.js

<a id="b518"></a>**B518** — [src/endpoints/quotes/quotes-router.js:48](../../src/endpoints/quotes/quotes-router.js#L48) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while creating the quote.', status: 500 }); } `

**Proved:** [T0232](#t0232), [T1043](#t1043).

<a id="b519"></a>**B519** — [src/endpoints/quotes/quotes-router.js:50](../../src/endpoints/quotes/quotes-router.js#L50) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while creating the quote.', status: 500 }) `

**Proved:** [T0232](#t0232), [T1043](#t1043).

<a id="b520"></a>**B520** — [src/endpoints/quotes/quotes-router.js:79](../../src/endpoints/quotes/quotes-router.js#L79) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while retrieving quotes.', status: 500 }); } `

**Proved:** [T0834](#t0834).

<a id="b521"></a>**B521** — [src/endpoints/quotes/quotes-router.js:81](../../src/endpoints/quotes/quotes-router.js#L81) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while retrieving quotes.', status: 500 }) `

**Proved:** [T0834](#t0834).

<a id="b522"></a>**B522** — [src/endpoints/quotes/quotes-router.js:104](../../src/endpoints/quotes/quotes-router.js#L104) · response · `<handler>`

` res.status(404).send({ message: 'Quote not found.', status: 404 }) `

**Proved:** [T0247](#t0247).

<a id="b523"></a>**B523** — [src/endpoints/quotes/quotes-router.js:125](../../src/endpoints/quotes/quotes-router.js#L125) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while updating the quote.', status: 500 }); } `

**Proved:** [T0246](#t0246), [T1044](#t1044).

<a id="b524"></a>**B524** — [src/endpoints/quotes/quotes-router.js:127](../../src/endpoints/quotes/quotes-router.js#L127) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while updating the quote.', status: 500 }) `

**Proved:** [T0246](#t0246), [T1044](#t1044).

<a id="b525"></a>**B525** — [src/endpoints/quotes/quotes-router.js:143](../../src/endpoints/quotes/quotes-router.js#L143) · response · `<handler>`

` res.status(404).send({ message: 'Quote not found.', status: 404 }) `

**Proved:** [T0218](#t0218).

<a id="b526"></a>**B526** — [src/endpoints/quotes/quotes-router.js:164](../../src/endpoints/quotes/quotes-router.js#L164) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while deleting the quote.', status: 500 }); } `

**Proved:** [T0810](#t0810).

<a id="b527"></a>**B527** — [src/endpoints/quotes/quotes-router.js:166](../../src/endpoints/quotes/quotes-router.js#L166) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while deleting the quote.', status: 500 }) `

**Proved:** [T0810](#t0810).

### src/endpoints/recurringCustomer/recurringCustomer-router.js

<a id="b528"></a>**B528** — [src/endpoints/recurringCustomer/recurringCustomer-router.js:105](../../src/endpoints/recurringCustomer/recurringCustomer-router.js#L105) · response · `<handler>`

` res.status(404).send({ message: 'Recurring customer not found.', status: 404 }) `

**Proved:** [T0837](#t0837).

<a id="b529"></a>**B529** — [src/endpoints/recurringCustomer/recurringCustomer-router.js:144](../../src/endpoints/recurringCustomer/recurringCustomer-router.js#L144) · response · `<handler>`

` res.status(404).send({ message: 'Recurring customer not found.', status: 404 }) `

**Proved:** [T0098](#t0098).

### src/endpoints/recurringCustomer/recurringCustomer-service.js

<a id="b530"></a>**B530** — [src/endpoints/recurringCustomer/recurringCustomer-service.js:14](../../src/endpoints/recurringCustomer/recurringCustomer-service.js#L14) · throw · `<handler>`

` throw new Error('Recurring customer not found.'); `

**Proved:** [T0949](#t0949), [T0950](#t0950).

<a id="b531"></a>**B531** — [src/endpoints/recurringCustomer/recurringCustomer-service.js:22](../../src/endpoints/recurringCustomer/recurringCustomer-service.js#L22) · throw · `<handler>`

` throw new Error('Recurring customer changed; refresh before saving.'); `

**Proved:** [T0946](#t0946).

### src/endpoints/retainer/retainer-events.js

<a id="b532"></a>**B532** — [src/endpoints/retainer/retainer-events.js:7](../../src/endpoints/retainer/retainer-events.js#L7) · throw · `validate`

` throw ruleError('Choose refund or adjustment.',400); `

**Proved:** [T1200](#t1200).

<a id="b533"></a>**B533** — [src/endpoints/retainer/retainer-events.js:9](../../src/endpoints/retainer/retainer-events.js#L9) · throw · `validate`

` throw ruleError('Choose increase or decrease; refunds decrease credit.',400); `

**Proved:** [T1199](#t1199), [T1194](#t1194).

<a id="b534"></a>**B534** — [src/endpoints/retainer/retainer-events.js:10](../../src/endpoints/retainer/retainer-events.js#L10) · throw · `validate`

` throw ruleError('Amount must be between 0.01 and 99,999,999.99 with at most two decimal places.',400); `

**Proved:** [T1204](#t1204), [T1201](#t1201).

<a id="b535"></a>**B535** — [src/endpoints/retainer/retainer-events.js:11](../../src/endpoints/retainer/retainer-events.js#L11) · throw · `validate`

` throw ruleError('A valid calendar date (YYYY-MM-DD) is required.',400); `

**Proved:** [T1198](#t1198), [T1194](#t1194).

<a id="b536"></a>**B536** — [src/endpoints/retainer/retainer-events.js:17](../../src/endpoints/retainer/retainer-events.js#L17) · throw · `load`

` throw ruleError('Retainer not found.',404); `

**Proved:** [T1197](#t1197).

<a id="b537"></a>**B537** — [src/endpoints/retainer/retainer-events.js:20](../../src/endpoints/retainer/retainer-events.js#L20) · throw · `load`

` throw ruleError('Retainer chain is inconsistent; review the account before adjusting.',409); `

**Proved:** [T1195](#t1195).

<a id="b538"></a>**B538** — [src/endpoints/retainer/retainer-events.js:40](../../src/endpoints/retainer/retainer-events.js#L40) · throw · `<handler>`

` throw ruleError('This prepayment was cancelled by a payment reversal. It cannot be adjusted.',409); `

**Proved:** [T1194](#t1194).

<a id="b539"></a>**B539** — [src/endpoints/retainer/retainer-events.js:42](../../src/endpoints/retainer/retainer-events.js#L42) · throw · `<handler>`

` throw ruleError('Retainer state is inconsistent; review the account before adjusting.',409); `

**Proved:** [T1195](#t1195).

<a id="b540"></a>**B540** — [src/endpoints/retainer/retainer-events.js:45](../../src/endpoints/retainer/retainer-events.js#L45) · throw · `<handler>`

`` throw ruleError(`Only $${before.toFixed(2)} is available. Funds already applied cannot be refunded or removed.`,409); ``

**Proved:** [T1197](#t1197), [T1207](#t1207).

<a id="b541"></a>**B541** — [src/endpoints/retainer/retainer-events.js:46](../../src/endpoints/retainer/retainer-events.js#L46) · throw · `<handler>`

` throw ruleError('Resulting retainer credit exceeds 99,999,999.99.',409); `

**Proved:** [T1194](#t1194).

<a id="b542"></a>**B542** — [src/endpoints/retainer/retainer-events.js:51](../../src/endpoints/retainer/retainer-events.js#L51) · throw · `<handler>`

` throw new Error('Retainer event insertion did not return its saved record.'); `

**Proved:** [T1205](#t1205).

### src/endpoints/retainer/retainer-logic.js

<a id="b543"></a>**B543** — [src/endpoints/retainer/retainer-logic.js:31](../../src/endpoints/retainer/retainer-logic.js#L31) · throw · `findMatchingRetainer`

` throw ruleError('No matching retainer found for this payment.'); `

**Proved:** [T1090](#t1090), [T1255](#t1255).

<a id="b544"></a>**B544** — [src/endpoints/retainer/retainer-logic.js:34](../../src/endpoints/retainer/retainer-logic.js#L34) · throw · `findMatchingRetainer`

` throw ruleError('The selected retainer belongs to a different customer than this payment.'); `

**Proved:** [T1091](#t1091), [T1252](#t1252).

<a id="b545"></a>**B545** — [src/endpoints/retainer/retainer-logic.js:40](../../src/endpoints/retainer/retainer-logic.js#L40) · throw · `findMatchingRetainer`

` throw ruleError('The selected retainer has no remaining balance.'); `

**Proved:** [T1024](#t1024), [T1012](#t1012).

<a id="b546"></a>**B546** — [src/endpoints/retainer/retainer-logic.js:45](../../src/endpoints/retainer/retainer-logic.js#L45) · throw · `findMatchingRetainer`

`` throw ruleError(`Payment amount exceeds remaining balance on retainer. Max amount that can be applied to this invoice is $${available}.`); ``

**Proved:** [T1020](#t1020).

<a id="b547"></a>**B547** — [src/endpoints/retainer/retainer-logic.js:65](../../src/endpoints/retainer/retainer-logic.js#L65) · throw · `<handler>`

` throw ruleError('Retainer amount must be greater than $0.00.'); `

**unreachable:** Strict retainer create/update mappers validate positive money and required hold type before calling these core functions. The normalized values are forwarded unchanged; their earlier refusals are tested.

<a id="b548"></a>**B548** — [src/endpoints/retainer/retainer-logic.js:66](../../src/endpoints/retainer/retainer-logic.js#L66) · throw · `<handler>`

` throw ruleError('Select a type of hold (Retainer or Prepayment).'); `

**unreachable:** Strict retainer create/update mappers validate positive money and required hold type before calling these core functions. The normalized values are forwarded unchanged; their earlier refusals are tested.

<a id="b549"></a>**B549** — [src/endpoints/retainer/retainer-logic.js:92](../../src/endpoints/retainer/retainer-logic.js#L92) · throw · `<handler>`

` throw ruleError('Moving a retainer to a different customer is not supported. Delete it and re-enter it for the correct customer.'); `

**Proved:** [T1133](#t1133), [T1025](#t1025).

<a id="b550"></a>**B550** — [src/endpoints/retainer/retainer-logic.js:97](../../src/endpoints/retainer/retainer-logic.js#L97) · throw · `<handler>`

` throw ruleError('Retainer event history is immutable; record a new adjustment instead.',409,'RETAINER_EVENT_LOCKED'); `

**Proved:** [T1194](#t1194).

<a id="b551"></a>**B551** — [src/endpoints/retainer/retainer-logic.js:108](../../src/endpoints/retainer/retainer-logic.js#L108) · throw · `<handler>`

` throw ruleError('Retainer amount must be greater than $0.00.'); `

**unreachable:** Strict retainer create/update mappers validate positive money and required hold type before calling these core functions. The normalized values are forwarded unchanged; their earlier refusals are tested.

<a id="b552"></a>**B552** — [src/endpoints/retainer/retainer-logic.js:117](../../src/endpoints/retainer/retainer-logic.js#L117) · throw · `<handler>`

`` throw ruleError( `Prepayment retainer #${rootID} was cancelled by the reversal of payment #${cancelledBy}; its amount cannot be edited. Delete that reversal to restore the prepayment.` ); ``

**Proved:** [T1060](#t1060), [T1010](#t1010).

<a id="b553"></a>**B553** — [src/endpoints/retainer/retainer-logic.js:125](../../src/endpoints/retainer/retainer-logic.js#L125) · throw · `<handler>`

`` throw ruleError(`Starting amount cannot be less than the $${drawn.toFixed(2)} already drawn from this retainer.`); ``

**Proved:** [T1056](#t1056), [T1250](#t1250).

<a id="b554"></a>**B554** — [src/endpoints/retainer/retainer-logic.js:165](../../src/endpoints/retainer/retainer-logic.js#L165) · throw · `<handler>`

` throw ruleError('Retainer event history is immutable; record a new adjustment instead.',409,'RETAINER_EVENT_LOCKED'); `

**Proved:** [T1194](#t1194).

<a id="b555"></a>**B555** — [src/endpoints/retainer/retainer-logic.js:169](../../src/endpoints/retainer/retainer-logic.js#L169) · throw · `<handler>`

`` throw ruleError(`This row is a draw-down entry on retainer #${rootID}. Delete the payment or time/charge entry that drew on it instead.`); ``

**Proved:** [T1057](#t1057), [T1023](#t1023).

<a id="b556"></a>**B556** — [src/endpoints/retainer/retainer-logic.js:174](../../src/endpoints/retainer/retainer-logic.js#L174) · throw · `<handler>`

`` throw ruleError( `This prepayment was cancelled by the reversal of payment #${cancelledBy}. Delete that reversal to restore it (and then the payment, to remove both) instead of deleting the prepayment.` ); ``

**Proved:** [T1060](#t1060), [T1010](#t1010).

<a id="b557"></a>**B557** — [src/endpoints/retainer/retainer-logic.js:181](../../src/endpoints/retainer/retainer-logic.js#L181) · throw · `<handler>`

` throw ruleError('This retainer has already been drawn on and cannot be deleted. Delete the payments or time/charge entries that drew on it first.'); `

**Proved:** [T1057](#t1057), [T1250](#t1250).

<a id="b558"></a>**B558** — [src/endpoints/retainer/retainer-logic.js:190](../../src/endpoints/retainer/retainer-logic.js#L190) · throw · `<handler>`

` throw ruleError('Transactions are linked to this retainer; it cannot be deleted.'); `

**Proved:** [T1023](#t1023).

<a id="b559"></a>**B559** — [src/endpoints/retainer/retainer-logic.js:191](../../src/endpoints/retainer/retainer-logic.js#L191) · throw · `<handler>`

` throw ruleError('Payments are linked to this retainer; it cannot be deleted.'); `

**Proved:** [T1023](#t1023).

<a id="b560"></a>**B560** — [src/endpoints/retainer/retainer-logic.js:193](../../src/endpoints/retainer/retainer-logic.js#L193) · throw · `<handler>`

`` throw ruleError( `This prepayment was banked from the overpayment on payment #${refs.overpaymentPayments[0].payment_id}. Delete that payment instead — it removes the prepayment with it.` ); ``

**Proved:** [T1060](#t1060), [T1017](#t1017).

### src/endpoints/retainer/retainer-router.js

<a id="b561"></a>**B561** — [src/endpoints/retainer/retainer-router.js:38](../../src/endpoints/retainer/retainer-router.js#L38) · catch · `<handler>`

` catch (err) { console.log(err); res.status(err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while creating the Retainer.', status: err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.i `

**Proved:** [T1266](#t1266), [T1267](#t1267).

<a id="b562"></a>**B562** — [src/endpoints/retainer/retainer-router.js:40](../../src/endpoints/retainer/retainer-router.js#L40) · response · `<handler>`

` res.status(err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while creating the Retainer.', status: err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.inputValidation ? 400 : 500 }) `

**Proved:** [T1266](#t1266), [T1267](#t1267).

<a id="b563"></a>**B563** — [src/endpoints/retainer/retainer-router.js:66](../../src/endpoints/retainer/retainer-router.js#L66) · catch · `<handler>`

` catch (err) { console.log(err); res.status(err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while updating the Retainer.', status: err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.i `

**Proved:** [T1237](#t1237), [T1236](#t1236).

<a id="b564"></a>**B564** — [src/endpoints/retainer/retainer-router.js:68](../../src/endpoints/retainer/retainer-router.js#L68) · response · `<handler>`

` res.status(err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while updating the Retainer.', status: err.code === 'RETAINER_EVENT_LOCKED' ? 409 : err.inputValidation ? 400 : 500 }) `

**Proved:** [T1237](#t1237), [T1236](#t1236).

<a id="b565"></a>**B565** — [src/endpoints/retainer/retainer-router.js:86](../../src/endpoints/retainer/retainer-router.js#L86) · catch · `<handler>`

` catch (err) { console.log(err); res.status(err.code === 'RETAINER_EVENT_LOCKED' ? 409 : 200).send({ message: err.message || 'An error occurred while deleting the Retainer.', status: err.code === 'RETAINER_EVENT_LOCKED' ? 409 : 500 }); } `

**Proved:** [T1129](#t1129), [T1247](#t1247).

<a id="b566"></a>**B566** — [src/endpoints/retainer/retainer-router.js:88](../../src/endpoints/retainer/retainer-router.js#L88) · response · `<handler>`

` res.status(err.code === 'RETAINER_EVENT_LOCKED' ? 409 : 200).send({ message: err.message || 'An error occurred while deleting the Retainer.', status: err.code === 'RETAINER_EVENT_LOCKED' ? 409 : 500 }) `

**Proved:** [T1129](#t1129), [T1247](#t1247).

<a id="b567"></a>**B567** — [src/endpoints/retainer/retainer-router.js:105](../../src/endpoints/retainer/retainer-router.js#L105) · response · `<handler>`

` res.send({ message: 'No matching retainer record found.', status: 404 }) `

**Proved:** [T1082](#t1082), [T0348](#t0348).

<a id="b568"></a>**B568** — [src/endpoints/retainer/retainer-router.js:110](../../src/endpoints/retainer/retainer-router.js#L110) · response · `<handler>`

` res.send({ message: 'No matching retainer record found.', status: 404 }) `

**Proved:** [T1080](#t1080), [T1081](#t1081).

<a id="b569"></a>**B569** — [src/endpoints/retainer/retainer-router.js:124](../../src/endpoints/retainer/retainer-router.js#L124) · catch · `<handler>`

` catch (err) { res.send({ message: 'Failure to retrieve single retainer.', status: 500 }); } `

**Proved:** [T1114](#t1114).

<a id="b570"></a>**B570** — [src/endpoints/retainer/retainer-router.js:125](../../src/endpoints/retainer/retainer-router.js#L125) · response · `<handler>`

` res.send({ message: 'Failure to retrieve single retainer.', status: 500 }) `

**Proved:** [T1114](#t1114).

<a id="b571"></a>**B571** — [src/endpoints/retainer/retainer-router.js:150](../../src/endpoints/retainer/retainer-router.js#L150) · catch · `<handler>`

` catch (err) { res.send({ message: 'Failure to retrieve active retainers.', status: 500 }); } `

**Proved:** [T1244](#t1244).

<a id="b572"></a>**B572** — [src/endpoints/retainer/retainer-router.js:151](../../src/endpoints/retainer/retainer-router.js#L151) · response · `<handler>`

` res.send({ message: 'Failure to retrieve active retainers.', status: 500 }) `

**Proved:** [T1244](#t1244).

### src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js

<a id="b573"></a>**B573** — [src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:38](../../src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js#L38) · response · `<handler>`

` res.status(400).json({ message: 'Invalid account identifier provided.' }) `

**unreachable:** enforceAccountId rejects malformed or foreign account IDs before the handler. The later Number.isFinite check cannot fail for the owned integer account ID.

<a id="b574"></a>**B574** — [src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:63](../../src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js#L63) · response · `<handler>`

` res.status(400).json({ message: 'Invalid account identifier provided.' }) `

**unreachable:** enforceAccountId rejects malformed or foreign account IDs before the handler. The later Number.isFinite check cannot fail for the owned integer account ID.

<a id="b575"></a>**B575** — [src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:69](../../src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js#L69) · response · `<handler>`

` res.status(400).json({ message: 'Select at least one user to add as time tracker staff.' }) `

**Proved:** [T0124](#t0124).

<a id="b576"></a>**B576** — [src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:87](../../src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js#L87) · response · `<handler>`

` res.status(400).json({ message: 'Invalid account identifier provided.' }) `

**unreachable:** enforceAccountId rejects malformed or foreign account IDs before the handler. The later Number.isFinite check cannot fail for the owned integer account ID.

<a id="b577"></a>**B577** — [src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:93](../../src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js#L93) · response · `<handler>`

` res.status(400).json({ message: 'Include an "isActive" boolean in the request body.' }) `

**Proved:** [T0138](#t0138).

<a id="b578"></a>**B578** — [src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js:110](../../src/endpoints/timeTrackerStaff/timeTrackerStaff-router.js#L110) · response · `<handler>`

` res.status(400).json({ message: 'Invalid account identifier provided.' }) `

**unreachable:** enforceAccountId rejects malformed or foreign account IDs before the handler. The later Number.isFinite check cannot fail for the owned integer account ID.

### src/endpoints/timeTracking/template-builder.js

<a id="b579"></a>**B579** — [src/endpoints/timeTracking/template-builder.js:39](../../src/endpoints/timeTracking/template-builder.js#L39) · catch · `_shrinkFullColumnSqrefs`

` catch (e) { return buffer; } `

**Proved:** [T1002](#t1002).

<a id="b580"></a>**B580** — [src/endpoints/timeTracking/template-builder.js:105](../../src/endpoints/timeTracking/template-builder.js#L105) · catch · `_restoreDefinedNames`

` catch (e) { console.error('[template-builder] _restoreDefinedNames failed:', e.message); return buffer; } `

**Proved:** [T1001](#t1001).

<a id="b581"></a>**B581** — [src/endpoints/timeTracking/template-builder.js:159](../../src/endpoints/timeTracking/template-builder.js#L159) · catch · `_injectDateValidations`

` catch (e) { console.error('[template-builder] _injectDateValidations failed:', e.message); return buffer; } `

**Proved:** [T1006](#t1006).

<a id="b582"></a>**B582** — [src/endpoints/timeTracking/template-builder.js:193](../../src/endpoints/timeTracking/template-builder.js#L193) · catch · `_stripBadValidations`

` catch (e) { return buffer; } `

**Proved:** [T1003](#t1003).

<a id="b583"></a>**B583** — [src/endpoints/timeTracking/template-builder.js:289](../../src/endpoints/timeTracking/template-builder.js#L289) · catch · `_addLookupSheet`

` catch (e) { // older ExcelJS versions ignore protect — non-fatal. } `

**Proved:** [T1004](#t1004).

<a id="b584"></a>**B584** — [src/endpoints/timeTracking/template-builder.js:390](../../src/endpoints/timeTracking/template-builder.js#L390) · throw · `_parseWorkbookXmlSheetNames`

`` throw new Error(`template_builder_workbook_xml_unparsable: could not parse xl/workbook.xml (${parseError.message}). Non-owner downloads can only be rebuilt from the reviewed tenant-neutral package shape.`); ``

**Proved:** [T1009](#t1009).

<a id="b585"></a>**B585** — [src/endpoints/timeTracking/template-builder.js:402](../../src/endpoints/timeTracking/template-builder.js#L402) · throw · `_assertAllowedWorksheetSet`

`` throw new Error( `template_builder_disallowed_sheet: worksheet "${ws.name}" is not one of the template's allowed sheets. Non-owner downloads can only be rebuilt from the reviewed tenant-neutral package shape.` ); ``

**Proved:** [T1007](#t1007).

<a id="b586"></a>**B586** — [src/endpoints/timeTracking/template-builder.js:427](../../src/endpoints/timeTracking/template-builder.js#L427) · throw · `_assertAllowedParts`

`` throw new Error( `template_builder_disallowed_package_part: found ${_describeDisallowedPart(name)} ("${name}") in the built template. Refusing to serve this download.` ); ``

**Proved:** [T0053](#t0053).

<a id="b587"></a>**B587** — [src/endpoints/timeTracking/template-builder.js:443](../../src/endpoints/timeTracking/template-builder.js#L443) · throw · `_assertAllowedPackage`

`` throw new Error( `template_builder_disallowed_sheet: worksheet "${sheetName}" is not one of the template's allowed sheets. Non-owner downloads can only be rebuilt from the reviewed tenant-neutral package shape.` ); ``

**Proved:** [T0048](#t0048), [T0047](#t0047).

<a id="b588"></a>**B588** — [src/endpoints/timeTracking/template-builder.js:792](../../src/endpoints/timeTracking/template-builder.js#L792) · catch · `_readAccountLabel`

` catch (e) { return null; } `

**Proved:** [T0048](#t0048), [T0046](#t0046).

<a id="b589"></a>**B589** — [src/endpoints/timeTracking/template-builder.js:959](../../src/endpoints/timeTracking/template-builder.js#L959) · catch · `_loadNeutralAsset`

`` catch (e) { throw new Error(`neutral_template_asset_missing: could not read the committed neutral template asset at ${assetPath} (${e.message}). Run scripts/timeTracking/build-neutral-template.js to generate it.`); } ``

**Proved:** [T0051](#t0051).

<a id="b590"></a>**B590** — [src/endpoints/timeTracking/template-builder.js:960](../../src/endpoints/timeTracking/template-builder.js#L960) · throw · `_loadNeutralAsset`

`` throw new Error(`neutral_template_asset_missing: could not read the committed neutral template asset at ${assetPath} (${e.message}). Run scripts/timeTracking/build-neutral-template.js to generate it.`); ``

**Proved:** [T0051](#t0051).

<a id="b591"></a>**B591** — [src/endpoints/timeTracking/template-builder.js:965](../../src/endpoints/timeTracking/template-builder.js#L965) · catch · `_loadNeutralAsset`

`` catch (e) { throw new Error(`neutral_template_manifest_missing: could not read/parse the neutral template manifest at ${manifestPath} (${e.message}).`); } ``

**Proved:** [T0952](#t0952).

<a id="b592"></a>**B592** — [src/endpoints/timeTracking/template-builder.js:966](../../src/endpoints/timeTracking/template-builder.js#L966) · throw · `_loadNeutralAsset`

`` throw new Error(`neutral_template_manifest_missing: could not read/parse the neutral template manifest at ${manifestPath} (${e.message}).`); ``

**Proved:** [T0952](#t0952).

<a id="b593"></a>**B593** — [src/endpoints/timeTracking/template-builder.js:971](../../src/endpoints/timeTracking/template-builder.js#L971) · throw · `_loadNeutralAsset`

`` throw new Error( `neutral_template_asset_hash_mismatch: ${assetPath} (sha256 ${actual}) does not match neutral-template.manifest.json (expected ${expected || '<missing>'}). Refusing to build a non-owner template from an asset that doesn't match its own manifest.` ); ``

**Proved:** [T0052](#t0052).

<a id="b594"></a>**B594** — [src/endpoints/timeTracking/template-builder.js:1043](../../src/endpoints/timeTracking/template-builder.js#L1043) · throw · `_assertNoForbiddenTokens`

`` throw new Error(`template_builder_forbidden_token_survived: found a forbidden identifier in ${partName} after building from the neutral asset. Refusing to serve this download.`); ``

**Proved:** [T0050](#t0050), [T0049](#t0049).

<a id="b595"></a>**B595** — [src/endpoints/timeTracking/template-builder.js:1085](../../src/endpoints/timeTracking/template-builder.js#L1085) · throw · `_buildFromOwnerBytes`

` throw new Error('base_template_has_no_data_sheet'); `

**Proved:** [T1005](#t1005).

<a id="b596"></a>**B596** — [src/endpoints/timeTracking/template-builder.js:1161](../../src/endpoints/timeTracking/template-builder.js#L1161) · throw · `_buildFromNeutralAsset`

` throw new Error('base_template_has_no_data_sheet'); `

**unreachable:** Non-owner rebuild loads the checked-in neutral asset only after its bytes match the pinned SHA-256 manifest. That reviewed asset has the Time worksheet. A missing asset or hash mismatch is refused earlier and tested; owner-uploaded missing Time is separately tested.

<a id="b597"></a>**B597** — [src/endpoints/timeTracking/template-builder.js:1226](../../src/endpoints/timeTracking/template-builder.js#L1226) · throw · `buildTemplate`

` throw new TypeError('buildTemplate requires isOwnerAccount (boolean): true only for the account that owns the uploaded template.'); `

**Proved:** [T0045](#t0045).

<a id="b598"></a>**B598** — [src/endpoints/timeTracking/template-builder.js:1249](../../src/endpoints/timeTracking/template-builder.js#L1249) · catch · `buildTemplate`

` catch (e) { console.error('[template-builder] audit-row write failed:', e.message); } `

**Proved:** [T0951](#t0951).

### src/endpoints/timeTracking/timeTracking-router.js

<a id="b599"></a>**B599** — [src/endpoints/timeTracking/timeTracking-router.js:102](../../src/endpoints/timeTracking/timeTracking-router.js#L102) · throw · `fetchUserRecord`

` throw error; `

**Proved:** [T0311](#t0311), [T0320](#t0320).

<a id="b600"></a>**B600** — [src/endpoints/timeTracking/timeTracking-router.js:112](../../src/endpoints/timeTracking/timeTracking-router.js#L112) · throw · `fetchAccountRecord`

` throw error; `

**Proved:** [T0890](#t0890).

<a id="b601"></a>**B601** — [src/endpoints/timeTracking/timeTracking-router.js:271](../../src/endpoints/timeTracking/timeTracking-router.js#L271) · catch · `findAccountFolders`

`` catch (err) { console.error(`[${new Date().toISOString()}] Could not list tracker folders under ${PROCESSED_ROOT}: ${err.message}`); } ``

**Proved:** [T0888](#t0888), [T0891](#t0891).

<a id="b602"></a>**B602** — [src/endpoints/timeTracking/timeTracking-router.js:302](../../src/endpoints/timeTracking/timeTracking-router.js#L302) · throw · `ensureAdminAccess`

` throw error; `

**Proved:** [T0614](#t0614), [T0317](#t0317).

<a id="b603"></a>**B603** — [src/endpoints/timeTracking/timeTracking-router.js:326](../../src/endpoints/timeTracking/timeTracking-router.js#L326) · response · `<handler>`

` res.status(400).json({ message: 'Invalid account or user information provided.', note: policyNote }) `

**Proved:** [T0907](#t0907).

<a id="b604"></a>**B604** — [src/endpoints/timeTracking/timeTracking-router.js:333](../../src/endpoints/timeTracking/timeTracking-router.js#L333) · response · `<handler>`

` res.status(400).json({ message: 'Account and user identifiers must be positive integers.', note: policyNote }) `

**Proved:** [T0904](#t0904), [T0905](#t0905).

<a id="b605"></a>**B605** — [src/endpoints/timeTracking/timeTracking-router.js:340](../../src/endpoints/timeTracking/timeTracking-router.js#L340) · response · `<handler>`

` res.status(400).json({ message: 'Missing file metadata. Please include the original file name.', note: policyNote }) `

**Proved:** [T1277](#t1277).

<a id="b606"></a>**B606** — [src/endpoints/timeTracking/timeTracking-router.js:347](../../src/endpoints/timeTracking/timeTracking-router.js#L347) · response · `<handler>`

` res.status(400).json({ message: 'Uploaded file is empty or missing.', note: policyNote }) `

**Proved:** [T1277](#t1277).

<a id="b607"></a>**B607** — [src/endpoints/timeTracking/timeTracking-router.js:354](../../src/endpoints/timeTracking/timeTracking-router.js#L354) · response · `<handler>`

` res.status(400).json({ message: 'File exceeds the 1MB size limit.', note: policyNote }) `

**Proved:** [T1273](#t1273).

<a id="b608"></a>**B608** — [src/endpoints/timeTracking/timeTracking-router.js:364](../../src/endpoints/timeTracking/timeTracking-router.js#L364) · catch · `<handler>`

`` catch (recipientError) { console.warn(`[${new Date().toISOString()}] Failed to resolve time tracker admin recipients for account ${accountIdNumber}: ${recipientError.message}`); adminRecipients = []; } ``

**unreachable:** getAdminRecipients catches its database query failure itself and returns the configured fallback array. Its pre-query email parsing uses an environment string; the redundant outer catch has no reachable database rejection.

<a id="b609"></a>**B609** — [src/endpoints/timeTracking/timeTracking-router.js:371](../../src/endpoints/timeTracking/timeTracking-router.js#L371) · catch · `<handler>`

` catch (decodeError) { return res.status(400).json({ message: 'Invalid file name encoding.', note: policyNote }); } `

**Proved:** [T1278](#t1278).

<a id="b610"></a>**B610** — [src/endpoints/timeTracking/timeTracking-router.js:372](../../src/endpoints/timeTracking/timeTracking-router.js#L372) · response · `<handler>`

` res.status(400).json({ message: 'Invalid file name encoding.', note: policyNote }) `

**Proved:** [T1278](#t1278).

<a id="b611"></a>**B611** — [src/endpoints/timeTracking/timeTracking-router.js:379](../../src/endpoints/timeTracking/timeTracking-router.js#L379) · response · `<handler>`

` res.status(400).json({ message: 'Apple Numbers files are not supported. Please export your tracker as XLSX or XLS before uploading.', note: policyNote }) `

**Proved:** [T1275](#t1275).

<a id="b612"></a>**B612** — [src/endpoints/timeTracking/timeTracking-router.js:400](../../src/endpoints/timeTracking/timeTracking-router.js#L400) · response · `<handler>`

` res.status(400).json({ message: 'The selected user is inactive and cannot receive time tracker uploads.', note: policyNote }) `

**Proved:** [T1277](#t1277).

<a id="b613"></a>**B613** — [src/endpoints/timeTracking/timeTracking-router.js:411](../../src/endpoints/timeTracking/timeTracking-router.js#L411) · response · `<handler>`

` res.status(403).json({ message: 'Only managers or admins can submit trackers for other users.', note: policyNote }) `

**Proved:** [T1276](#t1276).

<a id="b614"></a>**B614** — [src/endpoints/timeTracking/timeTracking-router.js:433](../../src/endpoints/timeTracking/timeTracking-router.js#L433) · response · `<handler>`

` res.status(400).json({ message: 'The tracker failed validation. The file was not saved. Correct all validation errors before re-uploading.', errors: validationResult.errors, note: policyNote }) `

**Proved:** [T0966](#t0966), [T0958](#t0958).

<a id="b615"></a>**B615** — [src/endpoints/timeTracking/timeTracking-router.js:469](../../src/endpoints/timeTracking/timeTracking-router.js#L469) · response · `<handler>`

` res.status(400).json({ message: 'The tracker metadata is incomplete. Please ensure the start and end dates are provided.', note: policyNote }) `

**unreachable:** validateUploadedTracker returns errors for missing period metadata, missing/blank time entries, invalid dates and invalid/nonpositive durations. The route returns 400 for errors before reaching these second-pass normalized-data checks. Tests 11 cover the real rejection branches.

<a id="b616"></a>**B616** — [src/endpoints/timeTracking/timeTracking-router.js:501](../../src/endpoints/timeTracking/timeTracking-router.js#L501) · response · `<handler>`

` res.status(400).json({ message: 'The tracker did not contain any valid time entries. The file was not saved.', note: policyNote }) `

**unreachable:** validateUploadedTracker returns errors for missing period metadata, missing/blank time entries, invalid dates and invalid/nonpositive durations. The route returns 400 for errors before reaching these second-pass normalized-data checks. Tests 11 cover the real rejection branches.

<a id="b617"></a>**B617** — [src/endpoints/timeTracking/timeTracking-router.js:511](../../src/endpoints/timeTracking/timeTracking-router.js#L511) · response · `<handler>`

` res.status(400).json({ message: 'The tracker contains invalid dates. Please review the Date column and try again.', note: policyNote }) `

**unreachable:** validateUploadedTracker returns errors for missing period metadata, missing/blank time entries, invalid dates and invalid/nonpositive durations. The route returns 400 for errors before reaching these second-pass normalized-data checks. Tests 11 cover the real rejection branches.

<a id="b618"></a>**B618** — [src/endpoints/timeTracking/timeTracking-router.js:519](../../src/endpoints/timeTracking/timeTracking-router.js#L519) · response · `<handler>`

` res.status(400).json({ message: 'The tracker contains invalid duration values. Please review the Duration column and try again.', note: policyNote }) `

**unreachable:** validateUploadedTracker returns errors for missing period metadata, missing/blank time entries, invalid dates and invalid/nonpositive durations. The route returns 400 for errors before reaching these second-pass normalized-data checks. Tests 11 cover the real rejection branches.

<a id="b619"></a>**B619** — [src/endpoints/timeTracking/timeTracking-router.js:584](../../src/endpoints/timeTracking/timeTracking-router.js#L584) · response · `<handler>`

` res.status(409).json({ message, errors: [message], duplicate_of: earlier, note: policyNote }) `

**Proved:** [T0338](#t0338), [T1048](#t1048).

<a id="b620"></a>**B620** — [src/endpoints/timeTracking/timeTracking-router.js:592](../../src/endpoints/timeTracking/timeTracking-router.js#L592) · response · `<handler>`

` res.status(409).json({ message, errors: [message], duplicates_skipped: dedupe.duplicates, duplicates_skipped_count: dedupe.duplicates.length, note: policyNote }) `

**Proved:** [T0911](#t0911).

<a id="b621"></a>**B621** — [src/endpoints/timeTracking/timeTracking-router.js:622](../../src/endpoints/timeTracking/timeTracking-router.js#L622) · catch · `<handler>`

`` catch (dbError) { await trx.rollback().catch(() => {}); console.error(`[${new Date().toISOString()}] Failed to persist timesheet entries for "${decodedOriginalName}": ${dbError.message}`, dbError.stack); if (storedInS3) { try { await deleteObject(s3Key); conso ``

**Proved:** [T0910](#t0910), [T0901](#t0901).

<a id="b622"></a>**B622** — [src/endpoints/timeTracking/timeTracking-router.js:623](../../src/endpoints/timeTracking/timeTracking-router.js#L623) · rejection callback · `<handler>`

` trx.rollback().catch(() => {}) `

**Proved:** [T0908](#t0908).

<a id="b623"></a>**B623** — [src/endpoints/timeTracking/timeTracking-router.js:630](../../src/endpoints/timeTracking/timeTracking-router.js#L630) · catch · `<handler>`

`` catch (cleanupError) { console.error(`[${new Date().toISOString()}] Failed to remove S3 object "${s3Key}" after database error: ${cleanupError.message}`); } ``

**Proved:** [T0903](#t0903).

<a id="b624"></a>**B624** — [src/endpoints/timeTracking/timeTracking-router.js:636](../../src/endpoints/timeTracking/timeTracking-router.js#L636) · rejection callback · `<handler>`

`` sendSystemErrorEmail({ adminEmails: adminRecipients, userRecord, accountRecord, originalFileName: decodedOriginalName, error: dbError }).catch(emailError => { console.error(`[${new Date().toISOString( ``

**Proved:** [T0901](#t0901).

<a id="b625"></a>**B625** — [src/endpoints/timeTracking/timeTracking-router.js:647](../../src/endpoints/timeTracking/timeTracking-router.js#L647) · response · `<handler>`

` res.status(500).json({ message: 'An unexpected error occurred while saving the time tracker. Please try again later.', note: policyNote }) `

**Proved:** [T0910](#t0910), [T0901](#t0901).

<a id="b626"></a>**B626** — [src/endpoints/timeTracking/timeTracking-router.js:687](../../src/endpoints/timeTracking/timeTracking-router.js#L687) · catch · `<handler>`

`` catch (emailError) { console.error(`[${new Date().toISOString()}] Failed to send validation success email: ${emailError.message}`, emailError.stack); } ``

**Proved:** [T0909](#t0909), [T1048](#t1048).

<a id="b627"></a>**B627** — [src/endpoints/timeTracking/timeTracking-router.js:709](../../src/endpoints/timeTracking/timeTracking-router.js#L709) · catch · `<handler>`

`` catch (emailError) { console.error(`[${new Date().toISOString()}] Failed to send success email to owner (${ownerEmail}): ${emailError.message}`, emailError.stack); } ``

**Proved:** [T0906](#t0906).

<a id="b628"></a>**B628** — [src/endpoints/timeTracking/timeTracking-router.js:720](../../src/endpoints/timeTracking/timeTracking-router.js#L720) · catch · `<handler>`

`` catch (emailError) { console.error(`[${new Date().toISOString()}] Failed to send success email to submitter (${submitterEmail}): ${emailError.message}`, emailError.stack); } ``

**Proved:** [T0906](#t0906).

<a id="b629"></a>**B629** — [src/endpoints/timeTracking/timeTracking-router.js:766](../../src/endpoints/timeTracking/timeTracking-router.js#L766) · catch · `<handler>`

` catch (error) { const status = error.status || 500; if (status >= 500 && adminRecipients.length) { await sendSystemErrorEmail({ adminEmails: adminRecipients, userRecord, accountRecord, originalFileName: decodedOriginalName, error }).catch(emailError => { conso `

**Proved:** [T0900](#t0900), [T0902](#t0902).

<a id="b630"></a>**B630** — [src/endpoints/timeTracking/timeTracking-router.js:769](../../src/endpoints/timeTracking/timeTracking-router.js#L769) · rejection callback · `<handler>`

`` sendSystemErrorEmail({ adminEmails: adminRecipients, userRecord, accountRecord, originalFileName: decodedOriginalName, error }).catch(emailError => { console.error(`[${new Date().toISOString()}] Faile ``

**Proved:** [T0902](#t0902).

<a id="b631"></a>**B631** — [src/endpoints/timeTracking/timeTracking-router.js:784](../../src/endpoints/timeTracking/timeTracking-router.js#L784) · response · `<handler>`

` res.status(status).json({ message, note: policyNote }) `

**Proved:** [T0900](#t0900), [T0902](#t0902).

<a id="b632"></a>**B632** — [src/endpoints/timeTracking/timeTracking-router.js:800](../../src/endpoints/timeTracking/timeTracking-router.js#L800) · response · `<handler>`

` res.status(400).json({ message: 'Invalid account or user information provided.', status: 400 }) `

**Proved:** [T0898](#t0898).

<a id="b633"></a>**B633** — [src/endpoints/timeTracking/timeTracking-router.js:912](../../src/endpoints/timeTracking/timeTracking-router.js#L912) · response · `<handler>`

` res.status(400).json({ message: 'An S3 object key is required to download the file.' }) `

**Proved:** [T0314](#t0314).

<a id="b634"></a>**B634** — [src/endpoints/timeTracking/timeTracking-router.js:924](../../src/endpoints/timeTracking/timeTracking-router.js#L924) · response · `<handler>`

` res.status(403).json({ message: 'You do not have access to this file.' }) `

**Proved:** [T0159](#t0159), [T0158](#t0158).

<a id="b635"></a>**B635** — [src/endpoints/timeTracking/timeTracking-router.js:946](../../src/endpoints/timeTracking/timeTracking-router.js#L946) · response · `<handler>`

` res.status(403).json({ message: 'You do not have access to this file.' }) `

**Proved:** [T0340](#t0340), [T0339](#t0339).

<a id="b636"></a>**B636** — [src/endpoints/timeTracking/timeTracking-router.js:953](../../src/endpoints/timeTracking/timeTracking-router.js#L953) · catch · `<handler>`

` catch (err) { if (err.name === 'NoSuchKey') { return res.status(404).json({ message: 'That time tracker file could not be found.' }); } throw err; } `

**Proved:** [T0893](#t0893), [T0894](#t0894).

<a id="b637"></a>**B637** — [src/endpoints/timeTracking/timeTracking-router.js:955](../../src/endpoints/timeTracking/timeTracking-router.js#L955) · response · `<handler>`

` res.status(404).json({ message: 'That time tracker file could not be found.' }) `

**Proved:** [T0893](#t0893), [T0312](#t0312).

<a id="b638"></a>**B638** — [src/endpoints/timeTracking/timeTracking-router.js:957](../../src/endpoints/timeTracking/timeTracking-router.js#L957) · throw · `<handler>`

` throw err; `

**Proved:** [T0894](#t0894).

<a id="b639"></a>**B639** — [src/endpoints/timeTracking/timeTracking-router.js:974](../../src/endpoints/timeTracking/timeTracking-router.js#L974) · catch · `<handler>`

`` catch (decompressError) { console.error(`[${new Date().toISOString()}] Failed to decompress tracker "${key}": ${decompressError.message}`); return res.status(500).json({ message: 'We were unable to open that time tracker file. It may be corrupted. Please conta ``

**Proved:** [T0892](#t0892).

<a id="b640"></a>**B640** — [src/endpoints/timeTracking/timeTracking-router.js:976](../../src/endpoints/timeTracking/timeTracking-router.js#L976) · response · `<handler>`

` res.status(500).json({ message: 'We were unable to open that time tracker file. It may be corrupted. Please contact support if this continues.' }) `

**Proved:** [T0892](#t0892).

<a id="b641"></a>**B641** — [src/endpoints/timeTracking/timeTracking-router.js:1002](../../src/endpoints/timeTracking/timeTracking-router.js#L1002) · response · `<handler>`

` res.status(400).json({ message: 'Both ownerUserID and timesheetName are required to download a tracker.' }) `

**Proved:** [T0309](#t0309).

<a id="b642"></a>**B642** — [src/endpoints/timeTracking/timeTracking-router.js:1015](../../src/endpoints/timeTracking/timeTracking-router.js#L1015) · response · `<handler>`

` res.status(400).json({ message: 'Invalid timesheet name provided.' }) `

**Proved:** [T0157](#t0157), [T0309](#t0309).

<a id="b643"></a>**B643** — [src/endpoints/timeTracking/timeTracking-router.js:1035](../../src/endpoints/timeTracking/timeTracking-router.js#L1035) · response · `<handler>`

` res.status(403).json({ message: 'You are not authorized to download this tracker.' }) `

**Proved:** [T0308](#t0308).

<a id="b644"></a>**B644** — [src/endpoints/timeTracking/timeTracking-router.js:1100](../../src/endpoints/timeTracking/timeTracking-router.js#L1100) · catch · `<handler>`

`` catch (error) { if (error.name !== 'NoSuchKey') { console.error(`[${new Date().toISOString()}] Error attempting to download "${key}": ${error.message}`); } } ``

**Proved:** [T0888](#t0888), [T0889](#t0889).

<a id="b645"></a>**B645** — [src/endpoints/timeTracking/timeTracking-router.js:1125](../../src/endpoints/timeTracking/timeTracking-router.js#L1125) · catch · `<handler>`

`` catch (fetchError) { console.error(`[${new Date().toISOString()}] Error retrieving candidate key "${object.Key}": ${fetchError.message}`); } ``

**Proved:** [T0889](#t0889).

<a id="b646"></a>**B646** — [src/endpoints/timeTracking/timeTracking-router.js:1130](../../src/endpoints/timeTracking/timeTracking-router.js#L1130) · catch · `<handler>`

`` catch (listError) { console.error(`[${new Date().toISOString()}] Failed to list objects under "${prefix}": ${listError.message}`); } ``

**Proved:** [T0888](#t0888).

<a id="b647"></a>**B647** — [src/endpoints/timeTracking/timeTracking-router.js:1144](../../src/endpoints/timeTracking/timeTracking-router.js#L1144) · catch · `<handler>`

`` catch (fetchError) { console.error(`[${new Date().toISOString()}] Error retrieving candidate key "${key}": ${fetchError.message}`); } ``

**Proved:** [T0889](#t0889).

<a id="b648"></a>**B648** — [src/endpoints/timeTracking/timeTracking-router.js:1151](../../src/endpoints/timeTracking/timeTracking-router.js#L1151) · response · `<handler>`

` res.status(404).json({ message: 'We could not locate that time tracker. It may have been archived or renamed.' }) `

**Proved:** [T0888](#t0888), [T0889](#t0889).

<a id="b649"></a>**B649** — [src/endpoints/timeTracking/timeTracking-router.js:1161](../../src/endpoints/timeTracking/timeTracking-router.js#L1161) · response · `<handler>`

` res.status(404).json({ message: 'We could not locate that time tracker. It may have been archived or renamed.' }) `

**unreachable:** Each candidate is checked by the same pure isAuthorized closure before downloadKey is assigned. The owned-key set and permitted prefixes do not change during this request. The final repeated check cannot reject a key that was just admitted.

<a id="b650"></a>**B650** — [src/endpoints/timeTracking/timeTracking-router.js:1177](../../src/endpoints/timeTracking/timeTracking-router.js#L1177) · catch · `<handler>`

`` catch (decompressError) { console.error(`[${new Date().toISOString()}] Failed to decompress tracker "${downloadKey}": ${decompressError.message}`); return res.status(500).json({ message: 'We were unable to open that time tracker file. It may be corrupted. Plea ``

**Proved:** [T0887](#t0887).

<a id="b651"></a>**B651** — [src/endpoints/timeTracking/timeTracking-router.js:1179](../../src/endpoints/timeTracking/timeTracking-router.js#L1179) · response · `<handler>`

` res.status(500).json({ message: 'We were unable to open that time tracker file. It may be corrupted. Please contact support if this continues.' }) `

**Proved:** [T0887](#t0887).

<a id="b652"></a>**B652** — [src/endpoints/timeTracking/timeTracking-router.js:1218](../../src/endpoints/timeTracking/timeTracking-router.js#L1218) · response · `<handler>`

` res.status(404).json({ message: 'No tracker templates are available in S3.' }) `

**Proved:** [T0895](#t0895).

<a id="b653"></a>**B653** — [src/endpoints/timeTracking/timeTracking-router.js:1235](../../src/endpoints/timeTracking/timeTracking-router.js#L1235) · response · `<handler>`

` res.status(404).json({ message: 'Unable to find a base tracker template.' }) `

**Proved:** [T0896](#t0896).

<a id="b654"></a>**B654** — [src/endpoints/timeTracking/timeTracking-router.js:1284](../../src/endpoints/timeTracking/timeTracking-router.js#L1284) · catch · `<handler>`

`` catch (err) { console.error(`[${new Date().toISOString()}] template-builder failed for account ${accountIdNumber}: ${err.message}`); if (!isOwnerAccount) { // Never launder the owner's names into another tenant's // download by falling back to the shared raw b ``

**Proved:** [T0952](#t0952), [T0315](#t0315).

<a id="b655"></a>**B655** — [src/endpoints/timeTracking/timeTracking-router.js:1289](../../src/endpoints/timeTracking/timeTracking-router.js#L1289) · response · `<handler>`

` res.status(503).json({ message: 'We could not prepare your time tracker template right now. Please try again shortly, or contact support if this continues.' }) `

**Proved:** [T0952](#t0952), [T0315](#t0315).

<a id="b656"></a>**B656** — [src/endpoints/timeTracking/timeTracking-router.js:1324](../../src/endpoints/timeTracking/timeTracking-router.js#L1324) · response · `<handler>`

` res.status(403).json({ message: 'Only the template owner account may upload a shared tracker template.', status: 403 }) `

**Proved:** [T0161](#t0161).

<a id="b657"></a>**B657** — [src/endpoints/timeTracking/timeTracking-router.js:1331](../../src/endpoints/timeTracking/timeTracking-router.js#L1331) · response · `<handler>`

` res.status(400).json({ message: 'Missing file metadata. Please include the original file name.' }) `

**Proved:** [T0327](#t0327).

<a id="b658"></a>**B658** — [src/endpoints/timeTracking/timeTracking-router.js:1335](../../src/endpoints/timeTracking/timeTracking-router.js#L1335) · response · `<handler>`

` res.status(400).json({ message: 'Uploaded file is empty or missing.' }) `

**Proved:** [T0953](#t0953).

<a id="b659"></a>**B659** — [src/endpoints/timeTracking/timeTracking-router.js:1339](../../src/endpoints/timeTracking/timeTracking-router.js#L1339) · response · `<handler>`

` res.status(400).json({ message: 'File exceeds the 1MB size limit.' }) `

**Proved:** [T0327](#t0327).

<a id="b660"></a>**B660** — [src/endpoints/timeTracking/timeTracking-router.js:1347](../../src/endpoints/timeTracking/timeTracking-router.js#L1347) · catch · `<handler>`

` catch (decodeError) { return res.status(400).json({ message: 'Invalid file name encoding.' }); } `

**Proved:** [T0899](#t0899).

<a id="b661"></a>**B661** — [src/endpoints/timeTracking/timeTracking-router.js:1348](../../src/endpoints/timeTracking/timeTracking-router.js#L1348) · response · `<handler>`

` res.status(400).json({ message: 'Invalid file name encoding.' }) `

**Proved:** [T0899](#t0899).

<a id="b662"></a>**B662** — [src/endpoints/timeTracking/timeTracking-router.js:1439](../../src/endpoints/timeTracking/timeTracking-router.js#L1439) · response · `<handler>`

` res.status(403).json({ message: 'Only the template owner account may delete a shared tracker template.', status: 403 }) `

**Proved:** [T0160](#t0160).

<a id="b663"></a>**B663** — [src/endpoints/timeTracking/timeTracking-router.js:1445](../../src/endpoints/timeTracking/timeTracking-router.js#L1445) · response · `<handler>`

` res.status(400).json({ message: 'S3 key is required to delete a template.' }) `

**Proved:** [T0303](#t0303).

<a id="b664"></a>**B664** — [src/endpoints/timeTracking/timeTracking-router.js:1454](../../src/endpoints/timeTracking/timeTracking-router.js#L1454) · response · `<handler>`

` res.status(400).json({ message: 'Invalid template key.' }) `

**Proved:** [T0303](#t0303), [T0153](#t0153).

<a id="b665"></a>**B665** — [src/endpoints/timeTracking/timeTracking-router.js:1459](../../src/endpoints/timeTracking/timeTracking-router.js#L1459) · response · `<handler>`

` res.status(400).json({ message: 'Only tracker template files can be deleted.' }) `

**Proved:** [T0303](#t0303), [T0162](#t0162).

### src/endpoints/timesheets/auto-ingest-orchestrator.js

<a id="b666"></a>**B666** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:105](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L105) · catch · `_loadConfirmedAliases`

` catch (e) { console.error('[auto-ingest] confirmed-alias load failed (continuing without aliases):', e.message); return new Map(); } `

**Proved:** [T0979](#t0979).

<a id="b667"></a>**B667** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:150](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L150) · catch · `_loadFewShots`

` catch (e) { return []; } `

**Proved:** [T0983](#t0983).

<a id="b668"></a>**B668** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:582](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L582) · throw · `_autoInsertEntry`

` throw _holdError(resolution.holdReason || HOLD_REASONS.MISSING_REQUIRED_FIELD, resolution.holdDetail || null); `

**Proved:** [T1029](#t1029), [T0369](#t0369).

<a id="b669"></a>**B669** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:589](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L589) · throw · `_autoInsertEntry`

` throw _holdError(HOLD_REASONS.MISSING_REQUIRED_FIELD, { reason: 'invalid_duration', duration_minutes: Number.isFinite(minutesValue) ? minutesValue : null }); `

**Proved:** [T0982](#t0982), [T0980](#t0980).

<a id="b670"></a>**B670** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:615](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L615) · throw · `<handler>`

` throw err; `

**Proved:** [T0371](#t0371), [T0370](#t0370).

<a id="b671"></a>**B671** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:700](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L700) · rejection callback · `_customerPatternsFor`

` load().catch(err => { cache.delete(customerId); throw err; }) `

**Proved:** [T0999](#t0999).

<a id="b672"></a>**B672** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:702](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L702) · throw · `<handler>`

` throw err; `

**Proved:** [T0999](#t0999).

<a id="b673"></a>**B673** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:815](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L815) · catch · `processEntry`

` catch (err) { suggestionError = err.message; } `

**unreachable:** inferCategorization catches model/provider failures and returns a suggestion/error result. Its pre-try prompt uses arrays/strings built by validated catalogs and processEntry; HTTP input cannot supply executable getters or non-array catalogs. Actual inference failure/hold paths are tested.

<a id="b674"></a>**B674** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:840](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L840) · catch · `processEntry`

` catch (err) { if (err.code === ALREADY_PROCESSED) return _skipped(entry.timesheet_entry_id, suggestionCost); if (!err.holdReason) { // Unexpected insert failure (job/customer guard, DB error). The raw message can // carry data values, so it is logged — never p `

**Proved:** [T0982](#t0982), [T0980](#t0980).

<a id="b675"></a>**B675** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:917](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L917) · catch · `<handler>`

` catch (err) { let held = true; try { held = await _holdEntry(db, { entryId: entry.timesheet_entry_id, accountId, holdReason: HOLD_REASONS.BEDROCK_ERROR, suggestion: null, suggestedCustomer: null, sanitizedNotes: '' }); } catch (holdErr) { console.error('[auto- `

**Proved:** [T0999](#t0999), [T0980](#t0980).

<a id="b676"></a>**B676** — [src/endpoints/timesheets/auto-ingest-orchestrator.js:928](../../src/endpoints/timesheets/auto-ingest-orchestrator.js#L928) · catch · `<handler>`

` catch (holdErr) { console.error('[auto-ingest] hold-on-error fallback failed:', holdErr.message); } `

**Proved:** [T0980](#t0980).

### src/endpoints/timesheets/auto-ingest-runner.js

<a id="b677"></a>**B677** — [src/endpoints/timesheets/auto-ingest-runner.js:64](../../src/endpoints/timesheets/auto-ingest-runner.js#L64) · catch · `_fanOutNotifications`

` catch (e) { console.error('[auto-ingest] notification fan-out failed:', e.message); } `

**Proved:** [T0981](#t0981).

<a id="b678"></a>**B678** — [src/endpoints/timesheets/auto-ingest-runner.js:80](../../src/endpoints/timesheets/auto-ingest-runner.js#L80) · catch · `<handler>`

`` catch (err) { console.error(`[${new Date().toISOString()}] [auto-ingest] fatal: ${err.message}`); } ``

**Proved:** [T0978](#t0978).

### src/endpoints/timesheets/timesheet-suggestions-service.js

<a id="b679"></a>**B679** — [src/endpoints/timesheets/timesheet-suggestions-service.js:9](../../src/endpoints/timesheets/timesheet-suggestions-service.js#L9) · catch · `toJsonb`

` catch (e) { return { raw_text: value }; } `

**outside HTTP:** toJsonb/normalizeSuggestion are used only by upsertSuggestions, which has no src caller. Mounted timesheets routes use getSuggestionsForEntries/updateSuggestion, while ingestion builds its own suggestion rows.

<a id="b680"></a>**B680** — [src/endpoints/timesheets/timesheet-suggestions-service.js:20](../../src/endpoints/timesheets/timesheet-suggestions-service.js#L20) · throw · `normalizeSuggestion`

` throw new Error('Suggestion payload must be an object.'); `

**outside HTTP:** toJsonb/normalizeSuggestion are used only by upsertSuggestions, which has no src caller. Mounted timesheets routes use getSuggestionsForEntries/updateSuggestion, while ingestion builds its own suggestion rows.

<a id="b681"></a>**B681** — [src/endpoints/timesheets/timesheet-suggestions-service.js:39](../../src/endpoints/timesheets/timesheet-suggestions-service.js#L39) · throw · `normalizeSuggestion`

` throw new Error('Suggestion payload is missing account_id.'); `

**outside HTTP:** toJsonb/normalizeSuggestion are used only by upsertSuggestions, which has no src caller. Mounted timesheets routes use getSuggestionsForEntries/updateSuggestion, while ingestion builds its own suggestion rows.

<a id="b682"></a>**B682** — [src/endpoints/timesheets/timesheet-suggestions-service.js:43](../../src/endpoints/timesheets/timesheet-suggestions-service.js#L43) · throw · `normalizeSuggestion`

` throw new Error('Suggestion payload is missing timesheet_entry_id.'); `

**outside HTTP:** toJsonb/normalizeSuggestion are used only by upsertSuggestions, which has no src caller. Mounted timesheets routes use getSuggestionsForEntries/updateSuggestion, while ingestion builds its own suggestion rows.

<a id="b683"></a>**B683** — [src/endpoints/timesheets/timesheet-suggestions-service.js:47](../../src/endpoints/timesheets/timesheet-suggestions-service.js#L47) · throw · `normalizeSuggestion`

` throw new Error('Suggestion payload is missing sanitized_notes.'); `

**outside HTTP:** toJsonb/normalizeSuggestion are used only by upsertSuggestions, which has no src caller. Mounted timesheets routes use getSuggestionsForEntries/updateSuggestion, while ingestion builds its own suggestion rows.

### src/endpoints/timesheets/timesheetProcessingLogic/validations/csvHeaderPropertyConfig.js

<a id="b684"></a>**B684** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/csvHeaderPropertyConfig.js:81](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/csvHeaderPropertyConfig.js#L81) · validation result · `describeHeaderProblems`

`` problems.push( `The time entry header (spreadsheet line 5) is missing required column${missing.length === 1 ? '' : 's'}: ${missing .map(h => `"${h}"`) .join(', ')}. Found: ${found.length ? found.map(h => `"${h}"`).join(', ') : '(none)'}. Header names must match the template exactly (capitalization and spacing are ignored).` ) ``

**Proved:** [T0963](#t0963), [T0070](#t0070).

<a id="b685"></a>**B685** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/csvHeaderPropertyConfig.js:88](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/csvHeaderPropertyConfig.js#L88) · validation result · `describeHeaderProblems`

`` problems.push(`The time entry header (spreadsheet line 5) repeats column${duplicates.length === 1 ? '' : 's'} ${duplicates.map(h => `"${h}"`).join(', ')}; each column may appear only once.`) ``

**Proved:** [T0956](#t0956), [T0071](#t0071).

### src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js

<a id="b686"></a>**B686** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js:35](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js#L35) · throw · `_wholeMinutes`

`` throw new Error(`Duration "${raw}" is not a whole number of minutes. ${HINT}`); ``

**Proved:** [T0062](#t0062), [T0057](#t0057).

<a id="b687"></a>**B687** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js:47](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js#L47) · throw · `parseDurationMinutes`

`` throw new Error(`Duration is required. ${HINT}`); ``

**Proved:** [T0064](#t0064).

<a id="b688"></a>**B688** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js:53](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js#L53) · throw · `parseDurationMinutes`

`` throw new Error(`Duration "${raw}" is not a number. ${HINT}`); ``

**Proved:** [T0063](#t0063).

<a id="b689"></a>**B689** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js:57](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js#L57) · throw · `parseDurationMinutes`

`` throw new Error(`Duration is required. ${HINT}`); ``

**Proved:** [T0054](#t0054).

<a id="b690"></a>**B690** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js:70](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js#L70) · throw · `parseDurationMinutes`

`` throw new Error(`Duration "${raw}" is not a recognized number of minutes. ${HINT}`); ``

**Proved:** [T0058](#t0058), [T0055](#t0055).

<a id="b691"></a>**B691** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js:75](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js#L75) · throw · `parseDurationMinutes`

`` throw new Error(`Duration must be greater than 0 minutes (got "${raw}").`); ``

**Proved:** [T0060](#t0060), [T0059](#t0059).

<a id="b692"></a>**B692** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js:78](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/parseDuration.js#L78) · throw · `parseDurationMinutes`

`` throw new Error(`Duration "${raw}" is ${minutes} minutes, more than 24 hours for a single entry. ${HINT}`); ``

**Proved:** [T0061](#t0061), [T0056](#t0056).

### src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js

<a id="b693"></a>**B693** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js:32](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js#L32) · throw · `validateField`

`` throw new Error(`Unexpected header "${header}" at row ${rowIndex}`); ``

**unreachable:** validateTimeBlock only calls validateField for headers resolved through HEADER_CONFIG; unknown worksheet headers are rejected/skipped by the header validation first.

<a id="b694"></a>**B694** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js:40](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js#L40) · throw · `validateField`

`` throw new Error(`Missing required value in column "${header}" at row ${rowIndex}`); ``

**Proved:** [T0961](#t0961), [T0964](#t0964).

<a id="b695"></a>**B695** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js:52](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js#L52) · throw · `validateField`

`` throw new Error(`Invalid date value in column "${header}" at row ${rowIndex}`); ``

**Proved:** [T0958](#t0958).

<a id="b696"></a>**B696** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js:62](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js#L62) · catch · `validateField`

`` catch (err) { throw new Error(`${err.message} (column "${header}" at row ${rowIndex})`); } ``

**Proved:** [T0066](#t0066), [T0065](#t0065).

<a id="b697"></a>**B697** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js:63](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js#L63) · throw · `validateField`

`` throw new Error(`${err.message} (column "${header}" at row ${rowIndex})`); ``

**Proved:** [T0066](#t0066), [T0065](#t0065).

<a id="b698"></a>**B698** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js:70](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js#L70) · throw · `validateField`

`` throw new Error(`Invalid integer value in column "${header}" at row ${rowIndex}`); ``

**unreachable:** HEADER_CONFIG declares no int or unknown type. The HTTP spreadsheet cannot change that module constant; these generic switch arms have no configured caller.

<a id="b699"></a>**B699** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js:80](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateField.js#L80) · throw · `validateField`

`` throw new Error(`Unknown field type "${type}" for column "${header}" at row ${rowIndex}`); ``

**unreachable:** HEADER_CONFIG declares no int or unknown type. The HTTP spreadsheet cannot change that module constant; these generic switch arms have no configured caller.

### src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js

<a id="b700"></a>**B700** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js:20](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js#L20) · throw · `validateNameBlock`

` throw new Error('Employee Name (B1) is required.'); `

**Proved:** [T0962](#t0962).

<a id="b701"></a>**B701** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js:25](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js#L25) · throw · `validateNameBlock`

`` throw new Error(`Employee Name (B1) "${employeeName}" is not valid or not found.`); ``

**Proved:** [T0073](#t0073), [T1274](#t1274).

<a id="b702"></a>**B702** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js:30](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js#L30) · throw · `validateNameBlock`

` throw new Error('Time Tracker Start Date (B2) is invalid or missing.'); `

**Proved:** [T0960](#t0960).

<a id="b703"></a>**B703** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js:35](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js#L35) · throw · `validateNameBlock`

` throw new Error('Time Tracker End Date (B3) is invalid or missing.'); `

**Proved:** [T0959](#t0959).

<a id="b704"></a>**B704** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js:40](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js#L40) · throw · `validateNameBlock`

` throw new Error('Time Tracker End Date (B3) cannot be before Time Tracker Start Date (B2).'); `

**Proved:** [T0957](#t0957).

<a id="b705"></a>**B705** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js:46](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameBlock.js#L46) · throw · `validateNameBlock`

`` throw new Error(`Employee Email is missing or invalid for "${employeeName}".`); ``

**Proved:** [T0965](#t0965).

### src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameFields.js

<a id="b706"></a>**B706** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameFields.js:14](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateNameFields.js#L14) · throw · `validateNameFields`

`` throw new Error(`Missing required 'First Name' and 'Last Name' when 'Company Name' is empty at row ${rowIndex}`); ``

**Proved:** [T0072](#t0072).

### src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js

<a id="b707"></a>**B707** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js:59](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js#L59) · throw · `validateTimeBlock`

` throw new Error(headerProblems.join(' ')); `

**unreachable:** validateUploadedTracker invokes describeHeaderProblems first and returns its errors before calling validateTimeBlock. The repeated header check sees the same header array.

<a id="b708"></a>**B708** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js:82](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js#L82) · catch · `<handler>`

`` catch (error) { throw new Error(`Error validating column "${header}" at row ${rowIndex}: ${error.message}`); } ``

**Proved:** [T0958](#t0958), [T0961](#t0961).

<a id="b709"></a>**B709** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js:83](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js#L83) · throw · `<handler>`

`` throw new Error(`Error validating column "${header}" at row ${rowIndex}: ${error.message}`); ``

**Proved:** [T0958](#t0958), [T0961](#t0961).

<a id="b710"></a>**B710** — [src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js:92](../../src/endpoints/timesheets/timesheetProcessingLogic/validations/validateTimeBlock.js#L92) · throw · `<handler>`

`` throw new Error( `Date "${entry.date}" at row ${rowIndex} is outside the allowed range ${window.earliest.format('MM/DD/YYYY')} to ${window.latest.format('MM/DD/YYYY')}. ` + `Entries may be dated up to ${ENTRY_DATE_LOOKBACK_DAYS} days before the tracker Start Date (B2), and never after the End Date (B3) or today.` ); ``

**Proved:** [T0069](#t0069), [T0068](#t0068).

### src/endpoints/timesheets/timesheets-router.js

<a id="b711"></a>**B711** — [src/endpoints/timesheets/timesheets-router.js:38](../../src/endpoints/timesheets/timesheets-router.js#L38) · response · `requireManagerOrAbove`

` res.status(403).json({ status: 403, message: 'Manager, admin or super admin access required.' }) `

**Proved:** [T0619](#t0619), [T0626](#t0626).

<a id="b712"></a>**B712** — [src/endpoints/timesheets/timesheets-router.js:51](../../src/endpoints/timesheets/timesheets-router.js#L51) · catch · `parsePagination`

` catch (err) { res.status(400).json({ status: 400, message: clientSafeMessage(err, 'Invalid pagination parameters. Page and limit must be positive integers.') }); return { ok: false }; } `

**Proved:** [T0324](#t0324).

<a id="b713"></a>**B713** — [src/endpoints/timesheets/timesheets-router.js:52](../../src/endpoints/timesheets/timesheets-router.js#L52) · response · `parsePagination`

` res.status(400).json({ status: 400, message: clientSafeMessage(err, 'Invalid pagination parameters. Page and limit must be positive integers.') }) `

**Proved:** [T0324](#t0324).

<a id="b714"></a>**B714** — [src/endpoints/timesheets/timesheets-router.js:79](../../src/endpoints/timesheets/timesheets-router.js#L79) · catch · `<handler>`

`` catch (err) { console.error(`[${new Date().toISOString()}] Error retrieving timesheet entries for account ${accountID}: ${err.message}`); res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') }); } ``

**Proved:** [T0868](#t0868).

<a id="b715"></a>**B715** — [src/endpoints/timesheets/timesheets-router.js:81](../../src/endpoints/timesheets/timesheets-router.js#L81) · response · `<handler>`

` res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') }) `

**Proved:** [T0868](#t0868).

<a id="b716"></a>**B716** — [src/endpoints/timesheets/timesheets-router.js:104](../../src/endpoints/timesheets/timesheets-router.js#L104) · response · `<handler>`

` res.status(400).json({ status: 400, message: 'Provide timesheet_name or entry_ids to kick off auto-ingest.' }) `

**Proved:** [T0331](#t0331).

<a id="b717"></a>**B717** — [src/endpoints/timesheets/timesheets-router.js:108](../../src/endpoints/timesheets/timesheets-router.js#L108) · response · `<handler>`

` res.status(503).json({ status: 503, message: 'Auto-ingest is not enabled for this account (TIME_TRACKER_AI_FEATURE_FLAG).' }) `

**Proved:** [T0876](#t0876), [T0331](#t0331).

<a id="b718"></a>**B718** — [src/endpoints/timesheets/timesheets-router.js:124](../../src/endpoints/timesheets/timesheets-router.js#L124) · response · `<handler>`

` res.status(403).json({ status: 403, message: 'Access denied for this tracker.' }) `

**Proved:** [T0330](#t0330).

<a id="b719"></a>**B719** — [src/endpoints/timesheets/timesheets-router.js:135](../../src/endpoints/timesheets/timesheets-router.js#L135) · response · `<handler>`

` res.status(403).json({ status: 403, message: 'Access denied for this tracker.' }) `

**Proved:** [T0329](#t0329).

<a id="b720"></a>**B720** — [src/endpoints/timesheets/timesheets-router.js:179](../../src/endpoints/timesheets/timesheets-router.js#L179) · catch · `<handler>`

`` catch (err) { console.error(`[${new Date().toISOString()}] Error retrieving employee timesheet entries for account ${accountID}: ${err.message}`); res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') }); } ``

**Proved:** [T0869](#t0869).

<a id="b721"></a>**B721** — [src/endpoints/timesheets/timesheets-router.js:181](../../src/endpoints/timesheets/timesheets-router.js#L181) · response · `<handler>`

` res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') }) `

**Proved:** [T0869](#t0869).

<a id="b722"></a>**B722** — [src/endpoints/timesheets/timesheets-router.js:207](../../src/endpoints/timesheets/timesheets-router.js#L207) · catch · `<handler>`

`` catch (err) { console.error(`[${new Date().toISOString()}] Error retrieving employee timesheet entries for account ${accountID}: ${err.message}`); res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') }); } ``

**Proved:** [T0867](#t0867).

<a id="b723"></a>**B723** — [src/endpoints/timesheets/timesheets-router.js:209](../../src/endpoints/timesheets/timesheets-router.js#L209) · response · `<handler>`

` res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') }) `

**Proved:** [T0867](#t0867).

<a id="b724"></a>**B724** — [src/endpoints/timesheets/timesheets-router.js:239](../../src/endpoints/timesheets/timesheets-router.js#L239) · catch · `<handler>`

`` catch (err) { console.error(`[${new Date().toISOString()}] Error retrieving employee timesheet entries for account ${accountID}: ${err.message}`); res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') }); } ``

**Proved:** [T0866](#t0866).

<a id="b725"></a>**B725** — [src/endpoints/timesheets/timesheets-router.js:241](../../src/endpoints/timesheets/timesheets-router.js#L241) · response · `<handler>`

` res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet entries.') }) `

**Proved:** [T0866](#t0866).

<a id="b726"></a>**B726** — [src/endpoints/timesheets/timesheets-router.js:268](../../src/endpoints/timesheets/timesheets-router.js#L268) · catch · `<handler>`

`` catch (err) { console.error(`[${new Date().toISOString()}] Error retrieving timesheet counts by employee for account ${accountID}: ${err.message}`); res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet counts by employee.') }); } ``

**Proved:** [T0865](#t0865).

<a id="b727"></a>**B727** — [src/endpoints/timesheets/timesheets-router.js:270](../../src/endpoints/timesheets/timesheets-router.js#L270) · response · `<handler>`

` res.status(500).json({ message: clientSafeMessage(err, 'Error retrieving timesheet counts by employee.') }) `

**Proved:** [T0865](#t0865).

<a id="b728"></a>**B728** — [src/endpoints/timesheets/timesheets-router.js:292](../../src/endpoints/timesheets/timesheets-router.js#L292) · response · `<handler>`

` res.status(400).json({ status: 400, message: 'A valid timesheetEntryID is required to move a timesheet entry to transactions.' }) `

**Proved:** [T0332](#t0332).

<a id="b729"></a>**B729** — [src/endpoints/timesheets/timesheets-router.js:299](../../src/endpoints/timesheets/timesheets-router.js#L299) · response · `<handler>`

` res.status(400).json({ status: 400, message: 'A valid timesheetEntryID is required to move a timesheet entry to transactions.' }) `

**Proved:** [T0335](#t0335).

<a id="b730"></a>**B730** — [src/endpoints/timesheets/timesheets-router.js:341](../../src/endpoints/timesheets/timesheets-router.js#L341) · throw · `<handler>`

` throw alreadyDone; `

**Proved:** [T0334](#t0334), [T1279](#t1279).

<a id="b731"></a>**B731** — [src/endpoints/timesheets/timesheets-router.js:357](../../src/endpoints/timesheets/timesheets-router.js#L357) · throw · `<handler>`

` throw badTenancy; `

**Proved:** [T0333](#t0333).

<a id="b732"></a>**B732** — [src/endpoints/timesheets/timesheets-router.js:376](../../src/endpoints/timesheets/timesheets-router.js#L376) · throw · `<handler>`

` throw invalidTime; `

**Proved:** [T1280](#t1280).

<a id="b733"></a>**B733** — [src/endpoints/timesheets/timesheets-router.js:397](../../src/endpoints/timesheets/timesheets-router.js#L397) · catch · `<handler>`

`` catch (err) { if (err.status === 409 || err.status === 400) { return res.status(err.status).json({ status: err.status, message: err.message }); } console.error(`[${new Date().toISOString()}] Error moving timesheet entry to transactions: ${err.message}`); res.s ``

**Proved:** [T0877](#t0877), [T0333](#t0333).

<a id="b734"></a>**B734** — [src/endpoints/timesheets/timesheets-router.js:399](../../src/endpoints/timesheets/timesheets-router.js#L399) · response · `<handler>`

` res.status(err.status).json({ status: err.status, message: err.message }) `

**Proved:** [T0333](#t0333), [T0334](#t0334).

<a id="b735"></a>**B735** — [src/endpoints/timesheets/timesheets-router.js:402](../../src/endpoints/timesheets/timesheets-router.js#L402) · response · `<handler>`

` res.status(500).json({ message: clientSafeMessage(err, 'Error moving timesheet entry to transactions.') }) `

**Proved:** [T0877](#t0877).

<a id="b736"></a>**B736** — [src/endpoints/timesheets/timesheets-router.js:417](../../src/endpoints/timesheets/timesheets-router.js#L417) · response · `<handler>`

` res.status(400).json({ status: 400, message: 'A valid timesheetEntryID is required to delete a timesheet entry.' }) `

**Proved:** [T0862](#t0862).

<a id="b737"></a>**B737** — [src/endpoints/timesheets/timesheets-router.js:423](../../src/endpoints/timesheets/timesheets-router.js#L423) · response · `<handler>`

` res.status(404).json({ status: 404, message: 'Timesheet entry not found.' }) `

**Proved:** [T0306](#t0306), [T0307](#t0307).

<a id="b738"></a>**B738** — [src/endpoints/timesheets/timesheets-router.js:433](../../src/endpoints/timesheets/timesheets-router.js#L433) · response · `<handler>`

` res.status(409).json({ status: 409, message: 'This timesheet entry has already been processed into a transaction and cannot be deleted. Reverse or delete the transaction first.' }) `

**Proved:** [T1271](#t1271), [T1272](#t1272).

<a id="b739"></a>**B739** — [src/endpoints/timesheets/timesheets-router.js:450](../../src/endpoints/timesheets/timesheets-router.js#L450) · response · `<handler>`

` res.status(409).json({ status: 409, message: 'This timesheet entry was processed or deleted by someone else; refresh before retrying.' }) `

**Proved:** [T0861](#t0861).

<a id="b740"></a>**B740** — [src/endpoints/timesheets/timesheets-router.js:461](../../src/endpoints/timesheets/timesheets-router.js#L461) · catch · `<handler>`

`` catch (err) { console.error(`[${new Date().toISOString()}] Error deleting timesheet entry: ${err.message}`); res.status(500).json({ message: clientSafeMessage(err, 'Error deleting timesheet entry.') }); } ``

**Proved:** [T0860](#t0860).

<a id="b741"></a>**B741** — [src/endpoints/timesheets/timesheets-router.js:463](../../src/endpoints/timesheets/timesheets-router.js#L463) · response · `<handler>`

` res.status(500).json({ message: clientSafeMessage(err, 'Error deleting timesheet entry.') }) `

**Proved:** [T0860](#t0860).

<a id="b742"></a>**B742** — [src/endpoints/timesheets/timesheets-router.js:618](../../src/endpoints/timesheets/timesheets-router.js#L618) · catch · `<handler>`

`` catch (err) { console.error(`Error for User ID ${user_id}:`, err); return { display_name, user_id, transaction_count: 0, trackers_to_date: 0, trackers_by_month: 0, ai_processing_count: 0, ai_completed_count: 0, ai_failed_count: 0 }; } ``

**Proved:** [T0864](#t0864).

### src/endpoints/transactions/sharedTransactionFunctions.js

<a id="b743"></a>**B743** — [src/endpoints/transactions/sharedTransactionFunctions.js:99](../../src/endpoints/transactions/sharedTransactionFunctions.js#L99) · throw · `assertJobBelongsToCustomer`

` throw new Error('Selected job was not found.'); `

**Proved:** [T1094](#t1094), [T1099](#t1099).

<a id="b744"></a>**B744** — [src/endpoints/transactions/sharedTransactionFunctions.js:101](../../src/endpoints/transactions/sharedTransactionFunctions.js#L101) · throw · `assertJobBelongsToCustomer`

` throw new Error('Selected job does not belong to this customer.'); `

**Proved:** [T1102](#t1102), [T0363](#t0363).

<a id="b745"></a>**B745** — [src/endpoints/transactions/sharedTransactionFunctions.js:123](../../src/endpoints/transactions/sharedTransactionFunctions.js#L123) · throw · `loadOwnedRetainerChain`

` throw ruleError('Retainer was not found.', 404); `

**Proved:** [T1100](#t1100).

<a id="b746"></a>**B746** — [src/endpoints/transactions/sharedTransactionFunctions.js:125](../../src/endpoints/transactions/sharedTransactionFunctions.js#L125) · throw · `loadOwnedRetainerChain`

` throw ruleError('The selected retainer/prepayment belongs to a different customer than this transaction.'); `

**Proved:** [T1095](#t1095), [T0077](#t0077).

<a id="b747"></a>**B747** — [src/endpoints/transactions/sharedTransactionFunctions.js:138](../../src/endpoints/transactions/sharedTransactionFunctions.js#L138) · throw · `planRetainerDraw`

` throw ruleError('The selected retainer/prepayment has no remaining balance.'); `

**Proved:** [T1206](#t1206), [T1058](#t1058).

<a id="b748"></a>**B748** — [src/endpoints/transactions/sharedTransactionFunctions.js:141](../../src/endpoints/transactions/sharedTransactionFunctions.js#L141) · throw · `planRetainerDraw`

`` throw ruleError(`Retainer does not have enough balance to cover the transaction. Available: $${available.toFixed(2)}.`); ``

**Proved:** [T1057](#t1057), [T1058](#t1058).

<a id="b749"></a>**B749** — [src/endpoints/transactions/sharedTransactionFunctions.js:295](../../src/endpoints/transactions/sharedTransactionFunctions.js#L295) · throw · `resolveAutoRetainerPayment`

`` throw ruleError(`Multiple payments are linked to this entry's retainer draw #${Number(transaction.retainer_id)} — contact support.`); ``

**Proved:** [T1153](#t1153).

<a id="b750"></a>**B750** — [src/endpoints/transactions/sharedTransactionFunctions.js:300](../../src/endpoints/transactions/sharedTransactionFunctions.js#L300) · throw · `resolveAutoRetainerPayment`

` throw ruleError('Multiple candidate retainer payments found for this transaction — contact support.'); `

**Proved:** [T0074](#t0074).

<a id="b751"></a>**B751** — [src/endpoints/transactions/sharedTransactionFunctions.js:320](../../src/endpoints/transactions/sharedTransactionFunctions.js#L320) · throw · `resolveLinkedRetainerPayment`

` throw new Error(refuseIfBilledMessage || 'The retainer payment linked to this transaction has already been billed. Contact support.'); `

**outside HTTP:** Legacy exported read/helper function has no src call sites: resolveLinkedRetainerPayment / differenceBetweenOldAndNewTransaction. Current mutations use resolveAutoRetainerPayment / loadStoredTransactionForWrite. Existing direct unit evidence is retained but is not HTTP reachability. Direct helper proof: [T0075](#t0075).

<a id="b752"></a>**B752** — [src/endpoints/transactions/sharedTransactionFunctions.js:336](../../src/endpoints/transactions/sharedTransactionFunctions.js#L336) · throw · `inspectExactDraw`

` throw refuse('is not a draw-down row of its retainer'); `

**Proved:** [T1143](#t1143).

<a id="b753"></a>**B753** — [src/endpoints/transactions/sharedTransactionFunctions.js:341](../../src/endpoints/transactions/sharedTransactionFunctions.js#L341) · throw · `inspectExactDraw`

`` throw refuse(`drew $${movement.toFixed(2)}, not this entry's $${amount.toFixed(2)}`); ``

**Proved:** [T1142](#t1142).

<a id="b754"></a>**B754** — [src/endpoints/transactions/sharedTransactionFunctions.js:344](../../src/endpoints/transactions/sharedTransactionFunctions.js#L344) · throw · `inspectExactDraw`

` throw refuse('is also referenced by another entry'); `

**Proved:** [T1141](#t1141).

<a id="b755"></a>**B755** — [src/endpoints/transactions/sharedTransactionFunctions.js:347](../../src/endpoints/transactions/sharedTransactionFunctions.js#L347) · throw · `inspectExactDraw`

` throw ruleError('The retainer draw for this entry is already on a statement and cannot be changed. Contact support.', 423); `

**Proved:** [T1140](#t1140).

<a id="b756"></a>**B756** — [src/endpoints/transactions/sharedTransactionFunctions.js:360](../../src/endpoints/transactions/sharedTransactionFunctions.js#L360) · throw · `resolveFundingLink`

` throw ruleError(billedMessage, 423); `

**Proved:** [T0084](#t0084), [T0085](#t0085).

<a id="b757"></a>**B757** — [src/endpoints/transactions/sharedTransactionFunctions.js:368](../../src/endpoints/transactions/sharedTransactionFunctions.js#L368) · throw · `resolveFundingLink`

`` throw ruleError(`Retainer payment #${payment.payment_id} is not linked to this entry's retainer draw. Contact support to reconcile it.`); ``

**Proved:** [T1145](#t1145).

<a id="b758"></a>**B758** — [src/endpoints/transactions/sharedTransactionFunctions.js:371](../../src/endpoints/transactions/sharedTransactionFunctions.js#L371) · throw · `resolveFundingLink`

`` throw ruleError(`Retainer payment #${payment.payment_id} no longer matches this entry's amount. Contact support to reconcile it.`); ``

**Proved:** [T1144](#t1144).

<a id="b759"></a>**B759** — [src/endpoints/transactions/sharedTransactionFunctions.js:383](../../src/endpoints/transactions/sharedTransactionFunctions.js#L383) · throw · `assertRetainerCanAbsorb`

`` throw ruleError(`Edited transaction amount is greater than the current retainer balance. This entry can increase by at most $${headroom.toFixed(2)}.`); ``

**Proved:** [T0083](#t0083), [T1282](#t1282).

<a id="b760"></a>**B760** — [src/endpoints/transactions/sharedTransactionFunctions.js:436](../../src/endpoints/transactions/sharedTransactionFunctions.js#L436) · throw · `differenceBetweenOldAndNewTransaction`

` throw new Error('Transaction was not found.'); `

**outside HTTP:** Legacy exported read/helper function has no src call sites: resolveLinkedRetainerPayment / differenceBetweenOldAndNewTransaction. Current mutations use resolveAutoRetainerPayment / loadStoredTransactionForWrite. Existing direct unit evidence is retained but is not HTTP reachability. Direct helper proof: [T0079](#t0079).

<a id="b761"></a>**B761** — [src/endpoints/transactions/sharedTransactionFunctions.js:467](../../src/endpoints/transactions/sharedTransactionFunctions.js#L467) · throw · `updateRecentJobTotal`

` throw new Error('Job was not found.'); `

**Proved:** [T0080](#t0080).

<a id="b762"></a>**B762** — [src/endpoints/transactions/sharedTransactionFunctions.js:501](../../src/endpoints/transactions/sharedTransactionFunctions.js#L501) · throw · `decideFundingAction`

` throw ruleError(RETAINER_REMOVE_MESSAGE); `

**Proved:** [T1057](#t1057), [T0078](#t0078).

<a id="b763"></a>**B763** — [src/endpoints/transactions/sharedTransactionFunctions.js:525](../../src/endpoints/transactions/sharedTransactionFunctions.js#L525) · throw · `loadStoredTransactionForWrite`

` throw ruleError('Transaction was not found.', 404); `

**Proved:** [T1129](#t1129), [T1132](#t1132).

<a id="b764"></a>**B764** — [src/endpoints/transactions/sharedTransactionFunctions.js:527](../../src/endpoints/transactions/sharedTransactionFunctions.js#L527) · throw · `loadStoredTransactionForWrite`

` throw ruleError('Transaction was not found.', 404); `

**Proved:** [T1130](#t1130), [T1131](#t1131).

<a id="b765"></a>**B765** — [src/endpoints/transactions/sharedTransactionFunctions.js:532](../../src/endpoints/transactions/sharedTransactionFunctions.js#L532) · throw · `loadStoredTransactionForWrite`

` throw ruleError('Transaction was not found.', 404); `

**Proved:** [T0948](#t0948).

<a id="b766"></a>**B766** — [src/endpoints/transactions/sharedTransactionFunctions.js:534](../../src/endpoints/transactions/sharedTransactionFunctions.js#L534) · throw · `loadStoredTransactionForWrite`

` throw ruleError('This transaction was changed by someone else while it was being saved. Refresh and try again.', 409); `

**Proved:** [T0947](#t0947).

<a id="b767"></a>**B767** — [src/endpoints/transactions/sharedTransactionFunctions.js:537](../../src/endpoints/transactions/sharedTransactionFunctions.js#L537) · throw · `loadStoredTransactionForWrite`

` throw customerMismatchMessage ? ruleError(customerMismatchMessage) : ruleError('Transaction was not found.', 404); `

**Proved:** [T1137](#t1137), [T1133](#t1133).

<a id="b768"></a>**B768** — [src/endpoints/transactions/sharedTransactionFunctions.js:574](../../src/endpoints/transactions/sharedTransactionFunctions.js#L574) · catch · `recordCategoryTrainingExample`

`` catch (e) { // Non-blocking: training example logging should not fail transaction creation console.error(`[${new Date().toISOString()}] Failed to insert AI category training example: ${e.message}`); } ``

**Proved:** [T0076](#t0076), [T1283](#t1283).

<a id="b769"></a>**B769** — [src/endpoints/transactions/sharedTransactionFunctions.js:664](../../src/endpoints/transactions/sharedTransactionFunctions.js#L664) · throw · `<handler>`

` throw ruleError('Transaction is attached to an invoice and cannot be updated.', 423); `

**Proved:** [T0362](#t0362), [T1281](#t1281).

<a id="b770"></a>**B770** — [src/endpoints/transactions/sharedTransactionFunctions.js:699](../../src/endpoints/transactions/sharedTransactionFunctions.js#L699) · throw · `<handler>`

` throw ruleError(RETAINER_CHANGE_MESSAGE); `

**Proved:** [T0086](#t0086).

<a id="b771"></a>**B771** — [src/endpoints/transactions/sharedTransactionFunctions.js:791](../../src/endpoints/transactions/sharedTransactionFunctions.js#L791) · throw · `<handler>`

` throw ruleError('Transaction is attached to an invoice and cannot be deleted.', 423); `

**Proved:** [T0342](#t0342), [T0081](#t0081).

### src/endpoints/transactions/transactionPricing.js

<a id="b772"></a>**B772** — [src/endpoints/transactions/transactionPricing.js:12](../../src/endpoints/transactions/transactionPricing.js#L12) · throw · `validateTransactionPrice`

`` throw new Error(`${key} must be a finite nonnegative number within the supported range.`); ``

**Proved:** [T1077](#t1077), [T1079](#t1079).

<a id="b773"></a>**B773** — [src/endpoints/transactions/transactionPricing.js:14](../../src/endpoints/transactions/transactionPricing.js#L14) · throw · `validateTransactionPrice`

`` throw new Error(`${key} supports at most two decimal places.`); ``

**Proved:** [T1238](#t1238), [T1078](#t1078).

<a id="b774"></a>**B774** — [src/endpoints/transactions/transactionPricing.js:24](../../src/endpoints/transactions/transactionPricing.js#L24) · throw · `validateTransactionPrice`

` throw new Error('Time quantity must match the duration rounded up to six-minute increments.'); `

**Proved:** [T1103](#t1103), [T1101](#t1101).

<a id="b775"></a>**B775** — [src/endpoints/transactions/transactionPricing.js:31](../../src/endpoints/transactions/transactionPricing.js#L31) · throw · `validateTransactionPrice`

` throw new Error('Transaction total must equal quantity times rate rounded to cents.'); `

**Proved:** [T1096](#t1096), [T1238](#t1238).

### src/endpoints/transactions/transactions-router.js

<a id="b776"></a>**B776** — [src/endpoints/transactions/transactions-router.js:68](../../src/endpoints/transactions/transactions-router.js#L68) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while creating the transaction.', status: 500 }); } `

**Proved:** [T1094](#t1094), [T1099](#t1099).

<a id="b777"></a>**B777** — [src/endpoints/transactions/transactions-router.js:70](../../src/endpoints/transactions/transactions-router.js#L70) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while creating the transaction.', status: 500 }) `

**Proved:** [T1094](#t1094), [T1099](#t1099).

<a id="b778"></a>**B778** — [src/endpoints/transactions/transactions-router.js:90](../../src/endpoints/transactions/transactions-router.js#L90) · catch · `<handler>`

` catch (error) { console.log(error); res.send({ message: error.message || 'An error occurred while updating the transaction.', status: 500 }); } `

**Proved:** [T0948](#t0948), [T0947](#t0947).

<a id="b779"></a>**B779** — [src/endpoints/transactions/transactions-router.js:92](../../src/endpoints/transactions/transactions-router.js#L92) · response · `<handler>`

` res.send({ message: error.message || 'An error occurred while updating the transaction.', status: 500 }) `

**Proved:** [T0948](#t0948), [T0947](#t0947).

<a id="b780"></a>**B780** — [src/endpoints/transactions/transactions-router.js:112](../../src/endpoints/transactions/transactions-router.js#L112) · catch · `<handler>`

` catch (error) { console.log(error); res.send({ message: error.message || 'An error occurred while deleting the transaction.', status: 500 }); } `

**Proved:** [T1142](#t1142), [T1144](#t1144).

<a id="b781"></a>**B781** — [src/endpoints/transactions/transactions-router.js:114](../../src/endpoints/transactions/transactions-router.js#L114) · response · `<handler>`

` res.send({ message: error.message || 'An error occurred while deleting the transaction.', status: 500 }) `

**Proved:** [T1142](#t1142), [T1144](#t1144).

<a id="b782"></a>**B782** — [src/endpoints/transactions/transactions-router.js:145](../../src/endpoints/transactions/transactions-router.js#L145) · catch · `<handler>`

` catch (error) { console.log(error); const isPaginationError = error.message && error.message.includes('Invalid pagination'); const statusCode = isPaginationError ? 400 : 500; res.status(statusCode).send({ message: error.message || 'An error occurred while retr `

**Proved:** [T0353](#t0353).

<a id="b783"></a>**B783** — [src/endpoints/transactions/transactions-router.js:149](../../src/endpoints/transactions/transactions-router.js#L149) · response · `<handler>`

` res.status(statusCode).send({ message: error.message || 'An error occurred while retrieving the transactions.', status: statusCode }) `

**Proved:** [T0353](#t0353).

<a id="b784"></a>**B784** — [src/endpoints/transactions/transactions-router.js:169](../../src/endpoints/transactions/transactions-router.js#L169) · catch · `<handler>`

` catch (error) { console.log(error); res.status(500).send({ message: error.message || 'An error occurred while exporting the transactions.', status: 500 }); } `

**Proved:** [T1259](#t1259).

<a id="b785"></a>**B785** — [src/endpoints/transactions/transactions-router.js:171](../../src/endpoints/transactions/transactions-router.js#L171) · response · `<handler>`

` res.status(500).send({ message: error.message || 'An error occurred while exporting the transactions.', status: 500 }) `

**Proved:** [T1259](#t1259).

<a id="b786"></a>**B786** — [src/endpoints/transactions/transactions-router.js:191](../../src/endpoints/transactions/transactions-router.js#L191) · response · `<handler>`

` res.send({ message: 'No matching transaction record found.', status: 404 }) `

**Proved:** [T1080](#t1080), [T1082](#t1082).

<a id="b787"></a>**B787** — [src/endpoints/transactions/transactions-router.js:204](../../src/endpoints/transactions/transactions-router.js#L204) · catch · `<handler>`

` catch (error) { console.log(error); res.send({ message: 'Failure to retrieve single transaction.', status: 500 }); } `

**Proved:** [T1115](#t1115).

<a id="b788"></a>**B788** — [src/endpoints/transactions/transactions-router.js:206](../../src/endpoints/transactions/transactions-router.js#L206) · response · `<handler>`

` res.send({ message: 'Failure to retrieve single transaction.', status: 500 }) `

**Proved:** [T1115](#t1115).

<a id="b789"></a>**B789** — [src/endpoints/transactions/transactions-router.js:230](../../src/endpoints/transactions/transactions-router.js#L230) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while fetching user time.', status: 500 }); } `

**Proved:** [T1245](#t1245).

<a id="b790"></a>**B790** — [src/endpoints/transactions/transactions-router.js:232](../../src/endpoints/transactions/transactions-router.js#L232) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while fetching user time.', status: 500 }) `

**Proved:** [T1245](#t1245).

### src/endpoints/transactions/transactionsObjects.js

<a id="b791"></a>**B791** — [src/endpoints/transactions/transactionsObjects.js:13](../../src/endpoints/transactions/transactionsObjects.js#L13) · throw · `normalizeTransactionType`

`` throw new Error(`Invalid transaction_type: "${value}". Must be "Time" or "Charge".`); ``

**Proved:** [T1097](#t1097), [T0359](#t0359).

### src/endpoints/user/user-router.js

<a id="b792"></a>**B792** — [src/endpoints/user/user-router.js:36](../../src/endpoints/user/user-router.js#L36) · throw · `assertNotLastSuperAdmin`

` throw error; `

**Proved:** [T0089](#t0089), [T1052](#t1052).

<a id="b793"></a>**B793** — [src/endpoints/user/user-router.js:62](../../src/endpoints/user/user-router.js#L62) · catch · `<handler>`

` catch (err) { console.log(err); const status = err.status || 500; res.status(status).send({ message: err.message || 'An error occurred while creating the user.', status }); } `

**Proved:** [T0126](#t0126).

<a id="b794"></a>**B794** — [src/endpoints/user/user-router.js:65](../../src/endpoints/user/user-router.js#L65) · response · `<handler>`

` res.status(status).send({ message: err.message || 'An error occurred while creating the user.', status }) `

**Proved:** [T0126](#t0126).

<a id="b795"></a>**B795** — [src/endpoints/user/user-router.js:99](../../src/endpoints/user/user-router.js#L99) · throw · `<handler>`

` throw error; `

**Proved:** [T1049](#t1049), [T0088](#t0088).

<a id="b796"></a>**B796** — [src/endpoints/user/user-router.js:108](../../src/endpoints/user/user-router.js#L108) · throw · `<handler>`

` throw error; `

**Proved:** [T1270](#t1270), [T1263](#t1263).

<a id="b797"></a>**B797** — [src/endpoints/user/user-router.js:116](../../src/endpoints/user/user-router.js#L116) · catch · `<handler>`

` catch (err) { console.log(err); const status = err.status || 500; res.status(status).send({ message: err.message || 'An error occurred while updating the user.', status }); } `

**Proved:** [T1270](#t1270), [T1263](#t1263).

<a id="b798"></a>**B798** — [src/endpoints/user/user-router.js:119](../../src/endpoints/user/user-router.js#L119) · response · `<handler>`

` res.status(status).send({ message: err.message || 'An error occurred while updating the user.', status }) `

**Proved:** [T1270](#t1270), [T1263](#t1263).

<a id="b799"></a>**B799** — [src/endpoints/user/user-router.js:138](../../src/endpoints/user/user-router.js#L138) · throw · `<handler>`

` throw error; `

**Proved:** [T1260](#t1260), [T0087](#t0087).

<a id="b800"></a>**B800** — [src/endpoints/user/user-router.js:152](../../src/endpoints/user/user-router.js#L152) · throw · `<handler>`

` throw error; `

**Proved:** [T1262](#t1262), [T1261](#t1261).

<a id="b801"></a>**B801** — [src/endpoints/user/user-router.js:162](../../src/endpoints/user/user-router.js#L162) · throw · `<handler>`

` throw error; `

**Proved:** [T1264](#t1264), [T1248](#t1248).

<a id="b802"></a>**B802** — [src/endpoints/user/user-router.js:167](../../src/endpoints/user/user-router.js#L167) · catch · `<handler>`

` catch (err) { console.log(err); const status = err.status || 500; res.status(status).send({ message: status === 500 ? 'The user cannot be deleted because data tied to this user exists.' : err.message, status }); } `

**Proved:** [T1262](#t1262), [T1261](#t1261).

<a id="b803"></a>**B803** — [src/endpoints/user/user-router.js:170](../../src/endpoints/user/user-router.js#L170) · response · `<handler>`

` res.status(status).send({ message: status === 500 ? 'The user cannot be deleted because data tied to this user exists.' : err.message, status }) `

**Proved:** [T1262](#t1262), [T1261](#t1261).

<a id="b804"></a>**B804** — [src/endpoints/user/user-router.js:193](../../src/endpoints/user/user-router.js#L193) · response · `<handler>`

` res.status(404).send({ message: 'User not found.', status: 404 }) `

**Proved:** [T0115](#t0115).

### src/endpoints/user/userObjects.js

<a id="b805"></a>**B805** — [src/endpoints/user/userObjects.js:21](../../src/endpoints/user/userObjects.js#L21) · throw · `normalizeAccessLevel`

` throw error; `

**Proved:** [T0126](#t0126), [T0140](#t0140).

<a id="b806"></a>**B806** — [src/endpoints/user/userObjects.js:45](../../src/endpoints/user/userObjects.js#L45) · throw · `optionalActiveBoolean`

` throw error; `

**Proved:** [T1050](#t1050), [T1051](#t1051).

### src/endpoints/workDescriptions/workDescriptions-router.js

<a id="b807"></a>**B807** — [src/endpoints/workDescriptions/workDescriptions-router.js:26](../../src/endpoints/workDescriptions/workDescriptions-router.js#L26) · catch · `<handler>`

` catch (error) { console.error(error.message); res.send({ message: error.message || 'Error creating work description.', status: 500 }); } `

**Proved:** [T0233](#t0233), [T0234](#t0234).

<a id="b808"></a>**B808** — [src/endpoints/workDescriptions/workDescriptions-router.js:28](../../src/endpoints/workDescriptions/workDescriptions-router.js#L28) · response · `<handler>`

` res.send({ message: error.message || 'Error creating work description.', status: 500 }) `

**Proved:** [T0233](#t0233), [T0234](#t0234).

<a id="b809"></a>**B809** — [src/endpoints/workDescriptions/workDescriptions-router.js:54](../../src/endpoints/workDescriptions/workDescriptions-router.js#L54) · catch · `<handler>`

` catch (error) { console.error(error.message); res.send({ message: error.message || 'Error getting workDescription.', status: 500 }); } `

**Proved:** [T0835](#t0835).

<a id="b810"></a>**B810** — [src/endpoints/workDescriptions/workDescriptions-router.js:56](../../src/endpoints/workDescriptions/workDescriptions-router.js#L56) · response · `<handler>`

` res.send({ message: error.message || 'Error getting workDescription.', status: 500 }) `

**Proved:** [T0835](#t0835).

<a id="b811"></a>**B811** — [src/endpoints/workDescriptions/workDescriptions-router.js:79](../../src/endpoints/workDescriptions/workDescriptions-router.js#L79) · response · `<handler>`

` res.status(404).send({ message: 'Work description not found.', status: 404 }) `

**Proved:** [T0251](#t0251), [T0248](#t0248).

<a id="b812"></a>**B812** — [src/endpoints/workDescriptions/workDescriptions-router.js:82](../../src/endpoints/workDescriptions/workDescriptions-router.js#L82) · catch · `<handler>`

` catch (error) { console.error(error.message); res.send({ message: error.message || 'Error updating workDescription.', status: 500 }); } `

**Proved:** [T0250](#t0250).

<a id="b813"></a>**B813** — [src/endpoints/workDescriptions/workDescriptions-router.js:84](../../src/endpoints/workDescriptions/workDescriptions-router.js#L84) · response · `<handler>`

` res.send({ message: error.message || 'Error updating workDescription.', status: 500 }) `

**Proved:** [T0250](#t0250).

<a id="b814"></a>**B814** — [src/endpoints/workDescriptions/workDescriptions-router.js:102](../../src/endpoints/workDescriptions/workDescriptions-router.js#L102) · throw · `<handler>`

` throw new Error('This work description is in use by one or more transactions and cannot be deleted.'); `

**Proved:** [T0221](#t0221), [T0092](#t0092).

<a id="b815"></a>**B815** — [src/endpoints/workDescriptions/workDescriptions-router.js:108](../../src/endpoints/workDescriptions/workDescriptions-router.js#L108) · response · `<handler>`

` res.status(404).send({ message: 'Work description not found.', status: 404 }) `

**Proved:** [T0222](#t0222), [T0219](#t0219).

<a id="b816"></a>**B816** — [src/endpoints/workDescriptions/workDescriptions-router.js:111](../../src/endpoints/workDescriptions/workDescriptions-router.js#L111) · catch · `<handler>`

` catch (error) { console.error(error.message); res.send({ message: error.message || 'Error deleting workDescription.', status: 500 }); } `

**Proved:** [T0221](#t0221), [T0092](#t0092).

<a id="b817"></a>**B817** — [src/endpoints/workDescriptions/workDescriptions-router.js:113](../../src/endpoints/workDescriptions/workDescriptions-router.js#L113) · response · `<handler>`

` res.send({ message: error.message || 'Error deleting workDescription.', status: 500 }) `

**Proved:** [T0221](#t0221), [T0092](#t0092).

### src/endpoints/writeOffs/writeOffs-logic.js

<a id="b818"></a>**B818** — [src/endpoints/writeOffs/writeOffs-logic.js:45](../../src/endpoints/writeOffs/writeOffs-logic.js#L45) · throw · `loadUnbilledWriteOff`

` throw ruleError(BILLED_MESSAGE, 423); `

**Proved:** [T0365](#t0365), [T0344](#t0344).

<a id="b819"></a>**B819** — [src/endpoints/writeOffs/writeOffs-logic.js:48](../../src/endpoints/writeOffs/writeOffs-logic.js#L48) · throw · `loadUnbilledWriteOff`

`` throw ruleError(`Write-off #${stored.writeoff_id} is linked to invoice ${linkedRow.invoice_number} of a different customer. Contact an administrator to correct the link.`); ``

**Proved:** [T1151](#t1151).

<a id="b820"></a>**B820** — [src/endpoints/writeOffs/writeOffs-logic.js:57](../../src/endpoints/writeOffs/writeOffs-logic.js#L57) · throw · `assertJobBelongsToCustomer`

` throw ruleError('The selected job does not belong to this customer. Re-select the job.'); `

**Proved:** [T1105](#t1105), [T1134](#t1134).

<a id="b821"></a>**B821** — [src/endpoints/writeOffs/writeOffs-logic.js:64](../../src/endpoints/writeOffs/writeOffs-logic.js#L64) · throw · `assertLatestOnChain`

`` throw ruleError(`A newer payment or write-off has been applied to this invoice since this write-off. ${verb} the newer entries first, then retry.`); ``

**Proved:** [T1127](#t1127), [T1027](#t1027).

<a id="b822"></a>**B822** — [src/endpoints/writeOffs/writeOffs-logic.js:80](../../src/endpoints/writeOffs/writeOffs-logic.js#L80) · throw · `<handler>`

` throw ruleError('Write-off amount must be greater than $0.00.', 400); `

**unreachable:** Strict write-off create/update mappers validate positive money, required reason and a real calendar date before the core. These later identical checks cannot fail for the mapped input.

<a id="b823"></a>**B823** — [src/endpoints/writeOffs/writeOffs-logic.js:82](../../src/endpoints/writeOffs/writeOffs-logic.js#L82) · throw · `<handler>`

` throw ruleError('A write-off reason is required.', 400); `

**unreachable:** Strict write-off create/update mappers validate positive money, required reason and a real calendar date before the core. These later identical checks cannot fail for the mapped input.

<a id="b824"></a>**B824** — [src/endpoints/writeOffs/writeOffs-logic.js:83](../../src/endpoints/writeOffs/writeOffs-logic.js#L83) · throw · `<handler>`

` throw ruleError('A valid write-off date is required.', 400); `

**unreachable:** Strict write-off create/update mappers validate positive money, required reason and a real calendar date before the core. These later identical checks cannot fail for the mapped input.

<a id="b825"></a>**B825** — [src/endpoints/writeOffs/writeOffs-logic.js:96](../../src/endpoints/writeOffs/writeOffs-logic.js#L96) · throw · `<handler>`

` throw ruleError('No matching invoice record found for this write-off.', 404); `

**Proved:** [T1107](#t1107), [T0360](#t0360).

<a id="b826"></a>**B826** — [src/endpoints/writeOffs/writeOffs-logic.js:98](../../src/endpoints/writeOffs/writeOffs-logic.js#L98) · throw · `<handler>`

`` throw ruleError(`Invoice ${requestedInvoice.invoice_number} belongs to a different customer than this write-off. Re-select the invoice.`); ``

**Proved:** [T1108](#t1108), [T1027](#t1027).

<a id="b827"></a>**B827** — [src/endpoints/writeOffs/writeOffs-logic.js:102](../../src/endpoints/writeOffs/writeOffs-logic.js#L102) · throw · `<handler>`

` throw ruleError('This customer has no invoices to write off against.'); `

**Proved:** [T1148](#t1148).

<a id="b828"></a>**B828** — [src/endpoints/writeOffs/writeOffs-logic.js:117](../../src/endpoints/writeOffs/writeOffs-logic.js#L117) · throw · `<handler>`

`` throw ruleError( `Write-off amount exceeds remaining balance on invoice ${target.parent.invoice_number}. Max amount that can be written off on this invoice is $${Math.max(0, remaining)}.` ); ``

**Proved:** [T1106](#t1106), [T1062](#t1062).

<a id="b829"></a>**B829** — [src/endpoints/writeOffs/writeOffs-logic.js:149](../../src/endpoints/writeOffs/writeOffs-logic.js#L149) · throw · `<handler>`

` throw ruleError('Moving a write-off to a different customer is not supported. Delete the write-off and re-enter it for the correct customer.'); `

**Proved:** [T1127](#t1127), [T1134](#t1134).

<a id="b830"></a>**B830** — [src/endpoints/writeOffs/writeOffs-logic.js:152](../../src/endpoints/writeOffs/writeOffs-logic.js#L152) · throw · `<handler>`

` throw ruleError('Moving a write-off to a different invoice is not supported. Delete the write-off and re-enter it against the correct invoice.'); `

**Proved:** [T1127](#t1127), [T1027](#t1027).

<a id="b831"></a>**B831** — [src/endpoints/writeOffs/writeOffs-logic.js:155](../../src/endpoints/writeOffs/writeOffs-logic.js#L155) · throw · `<handler>`

` throw ruleError('A job-level write-off cannot be moved onto an invoice. Delete it and re-enter it against the invoice.'); `

**Proved:** [T1134](#t1134), [T1063](#t1063).

<a id="b832"></a>**B832** — [src/endpoints/writeOffs/writeOffs-logic.js:159](../../src/endpoints/writeOffs/writeOffs-logic.js#L159) · throw · `<handler>`

` throw ruleError('Write-off amount must be greater than $0.00.', 400); `

**unreachable:** Strict write-off create/update mappers validate positive money, required reason and a real calendar date before the core. These later identical checks cannot fail for the mapped input.

<a id="b833"></a>**B833** — [src/endpoints/writeOffs/writeOffs-logic.js:164](../../src/endpoints/writeOffs/writeOffs-logic.js#L164) · throw · `<handler>`

`` throw ruleError(`This write-off is linked directly to invoice ${linkedRow.invoice_number} and cannot be re-priced. Delete it and re-enter it.`); ``

**Proved:** [T1152](#t1152).

<a id="b834"></a>**B834** — [src/endpoints/writeOffs/writeOffs-logic.js:171](../../src/endpoints/writeOffs/writeOffs-logic.js#L171) · throw · `<handler>`

`` throw ruleError(`Write-off amount exceeds remaining balance on invoice ${linkedRow.invoice_number}. Max increase is $${snapshotRemaining}.`); ``

**Proved:** [T1127](#t1127).

### src/endpoints/writeOffs/writeOffs-router.js

<a id="b835"></a>**B835** — [src/endpoints/writeOffs/writeOffs-router.js:44](../../src/endpoints/writeOffs/writeOffs-router.js#L44) · catch · `<handler>`

` catch (err) { console.log(err); res.status(err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while creating the writeOff.', status: err.inputValidation ? 400 : 500 }); } `

**Proved:** [T1268](#t1268), [T1104](#t1104).

<a id="b836"></a>**B836** — [src/endpoints/writeOffs/writeOffs-router.js:46](../../src/endpoints/writeOffs/writeOffs-router.js#L46) · response · `<handler>`

` res.status(err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while creating the writeOff.', status: err.inputValidation ? 400 : 500 }) `

**Proved:** [T1268](#t1268), [T1104](#t1104).

<a id="b837"></a>**B837** — [src/endpoints/writeOffs/writeOffs-router.js:63](../../src/endpoints/writeOffs/writeOffs-router.js#L63) · response · `<handler>`

` res.send({ message: 'No matching write-off record found.', status: 404 }) `

**Proved:** [T1082](#t1082), [T0355](#t0355).

<a id="b838"></a>**B838** — [src/endpoints/writeOffs/writeOffs-router.js:67](../../src/endpoints/writeOffs/writeOffs-router.js#L67) · response · `<handler>`

` res.send({ message: 'No matching write-off record found.', status: 404 }) `

**Proved:** [T1080](#t1080), [T1081](#t1081).

<a id="b839"></a>**B839** — [src/endpoints/writeOffs/writeOffs-router.js:81](../../src/endpoints/writeOffs/writeOffs-router.js#L81) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while retrieving the writeOff.', status: 500 }); } `

**Proved:** [T1116](#t1116).

<a id="b840"></a>**B840** — [src/endpoints/writeOffs/writeOffs-router.js:83](../../src/endpoints/writeOffs/writeOffs-router.js#L83) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while retrieving the writeOff.', status: 500 }) `

**Proved:** [T1116](#t1116).

<a id="b841"></a>**B841** — [src/endpoints/writeOffs/writeOffs-router.js:109](../../src/endpoints/writeOffs/writeOffs-router.js#L109) · catch · `<handler>`

` catch (err) { console.log(err); res.status(err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while updating the writeOff.', status: err.inputValidation ? 400 : 500 }); } `

**Proved:** [T1241](#t1241), [T1242](#t1242).

<a id="b842"></a>**B842** — [src/endpoints/writeOffs/writeOffs-router.js:111](../../src/endpoints/writeOffs/writeOffs-router.js#L111) · response · `<handler>`

` res.status(err.inputValidation ? 400 : 200).send({ message: err.message || 'An error occurred while updating the writeOff.', status: err.inputValidation ? 400 : 500 }) `

**Proved:** [T1241](#t1241), [T1242](#t1242).

<a id="b843"></a>**B843** — [src/endpoints/writeOffs/writeOffs-router.js:134](../../src/endpoints/writeOffs/writeOffs-router.js#L134) · catch · `<handler>`

` catch (err) { console.log(err); res.send({ message: err.message || 'An error occurred while deleting the writeOff.', status: 500 }); } `

**Proved:** [T1129](#t1129), [T1130](#t1130).

<a id="b844"></a>**B844** — [src/endpoints/writeOffs/writeOffs-router.js:136](../../src/endpoints/writeOffs/writeOffs-router.js#L136) · response · `<handler>`

` res.send({ message: err.message || 'An error occurred while deleting the writeOff.', status: 500 }) `

**Proved:** [T1129](#t1129), [T1130](#t1130).

<a id="b845"></a>**B845** — [src/endpoints/writeOffs/writeOffs-router.js:178](../../src/endpoints/writeOffs/writeOffs-router.js#L178) · catch · `<handler>`

` catch (error) { console.error('Error fetching paginated write-offs:', error); const isPaginationError = error.message && error.message.includes('Invalid pagination'); const statusCode = isPaginationError ? 400 : 500; res.status(statusCode).send({ message: erro `

**Proved:** [T0357](#t0357).

<a id="b846"></a>**B846** — [src/endpoints/writeOffs/writeOffs-router.js:182](../../src/endpoints/writeOffs/writeOffs-router.js#L182) · response · `<handler>`

` res.status(statusCode).send({ message: error.message || 'An error occurred while retrieving write-offs.', status: statusCode }) `

**Proved:** [T0357](#t0357).

### src/pdfCreator/templateOne/templateFunctions/pdfLayoutHelpers.js

<a id="b847"></a>**B847** — [src/pdfCreator/templateOne/templateFunctions/pdfLayoutHelpers.js:108](../../src/pdfCreator/templateOne/templateFunctions/pdfLayoutHelpers.js#L108) · throw · `<handler>`

`` throw new Error(`${title}: ${which} cannot fit on a single statement page with its required subtotal. Shorten it before finalizing.`); ``

**Proved:** [T1284](#t1284), [T1285](#t1285).

### src/pdfCreator/zipOrchestrator.js

<a id="b848"></a>**B848** — [src/pdfCreator/zipOrchestrator.js:27](../../src/pdfCreator/zipOrchestrator.js#L27) · throw · `createAndSaveZip`

` throw new Error('Account storage slug is required to generate invoice storage path.'); `

**unreachable:** All HTTP callers pass owned account rows with non-null immutable storage_slug assigned/backfilled by migration 020. Accounts cannot clear it via the API.

<a id="b849"></a>**B849** — [src/pdfCreator/zipOrchestrator.js:68](../../src/pdfCreator/zipOrchestrator.js#L68) · throw · `<handler>`

`` throw new Error(`Invalid buffer or metadata: ${JSON.stringify({ buffer, metadata })}`); ``

**unreachable:** HTTP callers supply buffers/metadata from the internal PDF and CSV builders. Those either return that shape or throw before ZIP construction; the request does not supply arbitrary buffer/metadata objects.

<a id="b850"></a>**B850** — [src/pdfCreator/zipOrchestrator.js:80](../../src/pdfCreator/zipOrchestrator.js#L80) · catch · `createAndSaveZip`

`` catch (error) { console.error(`Error creating ZIP file: ${error.message}`); throw error; } ``

**Proved:** [T1192](#t1192), [T1187](#t1187).

<a id="b851"></a>**B851** — [src/pdfCreator/zipOrchestrator.js:82](../../src/pdfCreator/zipOrchestrator.js#L82) · throw · `createAndSaveZip`

` throw error; `

**Proved:** [T1192](#t1192), [T1187](#t1187).

### src/server.js

<a id="b852"></a>**B852** — [src/server.js:18](../../src/server.js#L18) · rejection callback · `<handler>`

`` bedrockSmokeTest({ db }) .then(result => { console.log(`[bedrock] smoke test ok (model=${result.requestId ? 'reached' : 'unknown'} latency=${result.latencyMs}ms cost=$${(result.cost || 0).toFixed(6)}) ``

**outside HTTP:** Server boot connectivity/smoke probe only; src/app.js HTTP harness never imports server.js. Existing local servers were not restarted.

<a id="b853"></a>**B853** — [src/server.js:30](../../src/server.js#L30) · rejection callback · `<handler>`

`` checkConnectivity() .then(isConnected => { if (isConnected) { console.log(`S3 Bucket = ${S3_BUCKET_NAME || 'unknown'} (connected)`); } else { console.log('S3 Connectivity = false'); } }) .catch(error  ``

**outside HTTP:** Server boot connectivity/smoke probe only; src/app.js HTTP harness never imports server.js. Existing local servers were not restarted.

<a id="b854"></a>**B854** — [src/server.js:48](../../src/server.js#L48) · rejection callback · `<handler>`

`` db.raw('SELECT 1') .then(() => { clearTimeout(dbTimeout); console.log(`Database = ${DATABASE_URL} (connected)`); }) .catch(error => { clearTimeout(dbTimeout); console.warn(`Database connectivity check ``

**outside HTTP:** Server boot connectivity/smoke probe only; src/app.js HTTP harness never imports server.js. Existing local servers were not restarted.

### src/timeTrackerValidation/notifications.js

<a id="b855"></a>**B855** — [src/timeTrackerValidation/notifications.js:45](../../src/timeTrackerValidation/notifications.js#L45) · catch · `getAdminRecipients`

`` catch (error) { console.warn(`[${new Date().toISOString()}] Failed to load time tracker staff emails for account ${accountID}: ${error.message}`); return fallbackEmails; } ``

**Proved:** [T0909](#t0909).

### src/timeTrackerValidation/validateUploadedTracker.js

<a id="b856"></a>**B856** — [src/timeTrackerValidation/validateUploadedTracker.js:30](../../src/timeTrackerValidation/validateUploadedTracker.js#L30) · catch · `<handler>`

` catch (error) { errors.push(error.message); } `

**Proved:** [T0958](#t0958), [T0961](#t0961).

<a id="b857"></a>**B857** — [src/timeTrackerValidation/validateUploadedTracker.js:31](../../src/timeTrackerValidation/validateUploadedTracker.js#L31) · validation result · `<handler>`

` errors.push(error.message) `

**Proved:** [T0958](#t0958), [T0961](#t0961).

<a id="b858"></a>**B858** — [src/timeTrackerValidation/validateUploadedTracker.js:50](../../src/timeTrackerValidation/validateUploadedTracker.js#L50) · validation result · `validateUploadedTracker`

` return { errors: ['The uploaded file is empty or unreadable.'], metadata: null, entries: [] }; `

**unreachable:** Upload router rejects absent/non-Buffer/empty bytes before invoking validateUploadedTracker. Its earlier 400 and no-write behavior are tested.

<a id="b859"></a>**B859** — [src/timeTrackerValidation/validateUploadedTracker.js:60](../../src/timeTrackerValidation/validateUploadedTracker.js#L60) · catch · `validateUploadedTracker`

` catch (parseError) { return { errors: ['The uploaded workbook is corrupt or unsupported. Please re-save it as XLSX/XLS and try again.'], metadata: null, entries: [] }; } `

**Proved:** [T0966](#t0966), [T0067](#t0067).

<a id="b860"></a>**B860** — [src/timeTrackerValidation/validateUploadedTracker.js:61](../../src/timeTrackerValidation/validateUploadedTracker.js#L61) · validation result · `validateUploadedTracker`

` return { errors: ['The uploaded workbook is corrupt or unsupported. Please re-save it as XLSX/XLS and try again.'], metadata: null, entries: [] }; `

**Proved:** [T0966](#t0966), [T0067](#t0067).

<a id="b861"></a>**B861** — [src/timeTrackerValidation/validateUploadedTracker.js:70](../../src/timeTrackerValidation/validateUploadedTracker.js#L70) · validation result · `validateUploadedTracker`

` return { errors: ['The uploaded file does not contain any worksheets.'], metadata: null, entries: [] }; `

**Proved:** [T0968](#t0968).

<a id="b862"></a>**B862** — [src/timeTrackerValidation/validateUploadedTracker.js:81](../../src/timeTrackerValidation/validateUploadedTracker.js#L81) · validation result · `validateUploadedTracker`

` return { errors: ['The uploaded file does not contain any data.'], metadata: null, entries: [] }; `

**Proved:** [T0967](#t0967).

<a id="b863"></a>**B863** — [src/timeTrackerValidation/validateUploadedTracker.js:105](../../src/timeTrackerValidation/validateUploadedTracker.js#L105) · catch · `validateUploadedTracker`

` catch (nameError) { validationErrors.push(nameError.message); } `

**Proved:** [T0957](#t0957), [T0959](#t0959).

<a id="b864"></a>**B864** — [src/timeTrackerValidation/validateUploadedTracker.js:106](../../src/timeTrackerValidation/validateUploadedTracker.js#L106) · validation result · `validateUploadedTracker`

` validationErrors.push(nameError.message) `

**Proved:** [T0957](#t0957), [T0959](#t0959).

<a id="b865"></a>**B865** — [src/timeTrackerValidation/validateUploadedTracker.js:110](../../src/timeTrackerValidation/validateUploadedTracker.js#L110) · validation result · `validateUploadedTracker`

` validationErrors.push('Uploaded tracker belongs to a different user. Users can only submit their own trackers.') `

**unreachable:** Employee lookup is filtered to the explicitly authorized owner userID before validateNameBlock resolves metadata.userId. A different owner/name fails that lookup; a successful result cannot identify a different user.

<a id="b866"></a>**B866** — [src/timeTrackerValidation/validateUploadedTracker.js:118](../../src/timeTrackerValidation/validateUploadedTracker.js#L118) · validation result · `validateUploadedTracker`

` validationErrors.push('Time tracker is missing the time entry header row.') `

**Proved:** [T0955](#t0955).

<a id="b867"></a>**B867** — [src/timeTrackerValidation/validateUploadedTracker.js:124](../../src/timeTrackerValidation/validateUploadedTracker.js#L124) · validation result · `validateUploadedTracker`

` validationErrors.push(...describeHeaderProblems(originalHeaders)) `

**Proved:** [T0909](#t0909), [T0958](#t0958).

<a id="b868"></a>**B868** — [src/timeTrackerValidation/validateUploadedTracker.js:132](../../src/timeTrackerValidation/validateUploadedTracker.js#L132) · validation result · `validateUploadedTracker`

` validationErrors.push('Time tracker does not contain any time entry rows.') `

**Proved:** [T0954](#t0954).

<a id="b869"></a>**B869** — [src/timeTrackerValidation/validateUploadedTracker.js:136](../../src/timeTrackerValidation/validateUploadedTracker.js#L136) · validation result · `validateUploadedTracker`

` validationErrors.push(...errors) `

**Proved:** [T0958](#t0958), [T0961](#t0961).

<a id="b870"></a>**B870** — [src/timeTrackerValidation/validateUploadedTracker.js:149](../../src/timeTrackerValidation/validateUploadedTracker.js#L149) · validation result · `validateUploadedTracker`

` return { errors: [...new Set(validationErrors)], metadata, entries }; `

**Proved:** [T0909](#t0909), [T0958](#t0958).

### src/utils/auditContext.js

<a id="b871"></a>**B871** — [src/utils/auditContext.js:62](../../src/utils/auditContext.js#L62) · catch · `auditQuery`

` catch (error) { await originalQuery.call(this, connection, 'ROLLBACK'); throw error; } `

**Proved:** [T1231](#t1231), [T0234](#t0234).

<a id="b872"></a>**B872** — [src/utils/auditContext.js:64](../../src/utils/auditContext.js#L64) · throw · `auditQuery`

` throw error; `

**Proved:** [T1231](#t1231), [T0234](#t0234).

### src/utils/committedResponse.js

<a id="b873"></a>**B873** — [src/utils/committedResponse.js:20](../../src/utils/committedResponse.js#L20) · catch · `committedResponse`

` catch (error) { console.error('Committed mutation: response refresh failed', error); return res.send(committedFallback(message)); } `

**Proved:** [T0838](#t0838), [T0839](#t0839).

### src/utils/comprehend.js

<a id="b874"></a>**B874** — [src/utils/comprehend.js:64](../../src/utils/comprehend.js#L64) · catch · `detectAndRedact`

` catch (e) { const fallback = _stringFallbackRedact(text, knownNames); return { redacted: fallback, entities: [], usedComprehend: false, error: e.message }; } `

**Proved:** [T0939](#t0939), [T1286](#t1286).

### src/utils/createAndSavePDFs.js

<a id="b875"></a>**B875** — [src/utils/createAndSavePDFs.js:26](../../src/utils/createAndSavePDFs.js#L26) · catch · `createPDFInvoices`

`` catch (error) { console.log(`Error creating and saving pdfs to disk: ${error.message}`); throw new Error('Error creating and saving pdfs to disk: ' + error.message); } ``

**unreachable:** The try returns Promise.all without awaiting it. Rejected asynchronous PDF renders propagate directly to the invoice-route catch, which is tested; this synchronous catch only covers a non-array invoicesWithDetail, but HTTP calculation always produces an array.

<a id="b876"></a>**B876** — [src/utils/createAndSavePDFs.js:28](../../src/utils/createAndSavePDFs.js#L28) · throw · `createPDFInvoices`

` throw new Error('Error creating and saving pdfs to disk: ' + error.message); `

**unreachable:** The try returns Promise.all without awaiting it. Rejected asynchronous PDF renders propagate directly to the invoice-route catch, which is tested; this synchronous catch only covers a non-array invoicesWithDetail, but HTTP calculation always produces an array.

### src/utils/db.js

<a id="b877"></a>**B877** — [src/utils/db.js:22](../../src/utils/db.js#L22) · catch · `resolveDbSsl`

` catch (err) { ca = undefined; } `

**outside HTTP:** SSL CA-file fallback runs when constructing the database connection at module load, not from an HTTP handler. The scenario guard fixes local TCP with SSL disabled.

### src/utils/email/failureMessages.js

<a id="b878"></a>**B878** — [src/utils/email/failureMessages.js:18](../../src/utils/email/failureMessages.js#L18) · throw · `sendErrorNotificationForAutomation`

` throw new Error('No valid recipient emails provided.'); `

**outside HTTP:** Automation-only error notification; references lead only to scheduled reminder functions, not an HTTP handler.

<a id="b879"></a>**B879** — [src/utils/email/failureMessages.js:29](../../src/utils/email/failureMessages.js#L29) · catch · `sendErrorNotificationForAutomation`

`` catch (emailErr) { console.error(`[${new Date().toISOString()}] Failed to send error notification for account ${accountID}: ${emailErr.message}`); } ``

**outside HTTP:** Automation-only error notification; references lead only to scheduled reminder functions, not an HTTP handler.

### src/utils/email/sendEmail.js

<a id="b880"></a>**B880** — [src/utils/email/sendEmail.js:48](../../src/utils/email/sendEmail.js#L48) · throw · `sendEmail`

` throw new Error('sendEmail called without any recipient emails.'); `

**Proved:** [T0996](#t0996).

<a id="b881"></a>**B881** — [src/utils/email/sendEmail.js:52](../../src/utils/email/sendEmail.js#L52) · throw · `sendEmail`

` throw new Error('sendEmail called without a subject.'); `

**Proved:** [T0998](#t0998).

<a id="b882"></a>**B882** — [src/utils/email/sendEmail.js:56](../../src/utils/email/sendEmail.js#L56) · throw · `sendEmail`

` throw new Error('Missing FROM_EMAIL configuration.'); `

**Proved:** [T0997](#t0997).

<a id="b883"></a>**B883** — [src/utils/email/sendEmail.js:112](../../src/utils/email/sendEmail.js#L112) · catch · `sendEmail`

`` catch (error) { console.error(`[${new Date().toISOString()}] Failed to send email "${subject}" to ${to.join(', ')}: ${error.message}`); throw error; } ``

**Proved:** [T0906](#t0906), [T0901](#t0901).

<a id="b884"></a>**B884** — [src/utils/email/sendEmail.js:114](../../src/utils/email/sendEmail.js#L114) · throw · `sendEmail`

` throw error; `

**Proved:** [T0906](#t0906), [T0901](#t0901).

### src/utils/email/sendSuccessEmail.js

<a id="b885"></a>**B885** — [src/utils/email/sendSuccessEmail.js:35](../../src/utils/email/sendSuccessEmail.js#L35) · catch · `sendSuccessEmail`

`` catch (error) { console.error(`[${new Date().toISOString()}] Failed to send success email for "${timesheetName}": ${error.message}`); throw error; } ``

**Proved:** [T0906](#t0906).

<a id="b886"></a>**B886** — [src/utils/email/sendSuccessEmail.js:37](../../src/utils/email/sendSuccessEmail.js#L37) · throw · `sendSuccessEmail`

` throw error; `

**Proved:** [T0906](#t0906).

### src/utils/gridFunctions.js

<a id="b887"></a>**B887** — [src/utils/gridFunctions.js:70](../../src/utils/gridFunctions.js#L70) · throw · `generateTreeGridData`

` throw new Error('Property is required for tree grid.'); `

**unreachable:** Every src caller supplies a nonempty literal primary-key property to generateTreeGridData. There is no HTTP-controlled property parameter.

### src/utils/ledgerAction.js

<a id="b888"></a>**B888** — [src/utils/ledgerAction.js:3](../../src/utils/ledgerAction.js#L3) · throw · `id`

` throw ruleError('A positive record ID is required.', 400); `

**Proved:** [T1223](#t1223), [T1225](#t1225).

<a id="b889"></a>**B889** — [src/utils/ledgerAction.js:8](../../src/utils/ledgerAction.js#L8) · throw · `text`

`` throw ruleError(`${name} is required and must be at most ${max} characters.`, 400); ``

**Proved:** [T1202](#t1202), [T1203](#t1203).

<a id="b890"></a>**B890** — [src/utils/ledgerAction.js:16](../../src/utils/ledgerAction.js#L16) · catch · `<handler>`

` catch (error) { const status = error.code === 'P0409' ? 409 : (error.statusCode || 500); res.status(status).send({ status, code: error.code, message: status === 500 ? 'The operation failed. No changes were saved. Please retry.' : error.message }); } `

**Proved:** [T0933](#t0933), [T1198](#t1198).

<a id="b891"></a>**B891** — [src/utils/ledgerAction.js:18](../../src/utils/ledgerAction.js#L18) · response · `<handler>`

` res.status(status).send({ status, code: error.code, message: status === 500 ? 'The operation failed. No changes were saved. Please retry.' : error.message }) `

**Proved:** [T0933](#t0933), [T1198](#t1198).

### src/utils/ledgerInput.js

<a id="b892"></a>**B892** — [src/utils/ledgerInput.js:10](../../src/utils/ledgerInput.js#L10) · throw · `invalid`

` throw error; `

**Proved:** [T1265](#t1265), [T1266](#t1266).

### src/utils/pagination.js

<a id="b893"></a>**B893** — [src/utils/pagination.js:13](../../src/utils/pagination.js#L13) · throw · `getPaginationParams`

` throw new Error('Invalid pagination parameters. Page and limit must be positive integers.'); `

**Proved:** [T0324](#t0324), [T0258](#t0258).

### src/utils/piiRedactor.js

<a id="b894"></a>**B894** — [src/utils/piiRedactor.js:77](../../src/utils/piiRedactor.js#L77) · throw · `assertNoPii`

` throw new Error('PII leak detected in serialized payload'); `

**outside HTTP:** assertNoPii is an exported diagnostic helper used by tests only; no src caller. The actual redaction path is tested independently. Direct helper proof: [T1287](#t1287), [T1288](#t1288).

### src/utils/relatedAccount.js

<a id="b895"></a>**B895** — [src/utils/relatedAccount.js:11](../../src/utils/relatedAccount.js#L11) · throw · `requireAccountRow`

` throw error; `

**Proved:** [T1093](#t1093), [T1098](#t1098).

<a id="b896"></a>**B896** — [src/utils/relatedAccount.js:22](../../src/utils/relatedAccount.js#L22) · throw · `requireCustomerJob`

` throw error; `

**Proved:** [T1045](#t1045), [T1046](#t1046).

### src/utils/s3.js

<a id="b897"></a>**B897** — [src/utils/s3.js:32](../../src/utils/s3.js#L32) · throw · `<handler>`

`` throw new Error( `Missing required S3 configuration values: ${missing.join(", ")}` ); ``

**outside HTTP:** Required S3 configuration is checked at module load; checkConnectivity is called only by server.js at startup. Runtime HTTP storage rejection paths are separately injected and tested.

<a id="b898"></a>**B898** — [src/utils/s3.js:163](../../src/utils/s3.js#L163) · catch · `checkConnectivity`

`` catch (error) { console.warn(`S3 connectivity check failed: ${error.message}`); return false; } ``

**outside HTTP:** Required S3 configuration is checked at module load; checkConnectivity is called only by server.js at startup. Runtime HTTP storage rejection paths are separately injected and tested.

## Owner decisions, database locks and screens

Sent locks, exception transition guards, retainer event immutability, duplicate resolution, credit selection and audit evidence also rely on database functions/triggers (migrations 023–027). The integration tests below exercise the real triggers, rollback, tenant scope and immutable rows rather than mocking those rules.

### scenario-lifecycle-12-sent-exceptions.integration.spec

- ` owner decisions 3/5: immutable statements and bounced payment corrections issues $500, accepts a new $100 receipt without changing issued rows, then issues $400 ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections refuses direct edits/deletes and cascade edits with HTTP 409 and no ledger writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections database defenses refuse raw import/upsert changes to every frozen row ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections validates condition without writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections validates reason without writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections validates ids without writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections validates duplicate ids without writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections rejects a missing/foreign payment without writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections flags only the chosen receipt, audits the actor and permits no ordinary mutation ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections rolls back a failed reversal, including original evidence and exception state ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections reverses once to $500 with no original row changes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections archives a marked $500 revision without overwriting the original PDF or reposting money ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner decisions 3/5: immutable statements and bounced payment corrections carries corrected $500 into the next statement once and re-locks its evidence ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward get history refuses anonymous before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward get history refuses staff before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward get history refuses foreign before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward history rejects malformed and missing invoice IDs ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward post exceptions refuses anonymous before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward post exceptions refuses staff before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward post exceptions refuses foreign before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward exceptions rejects malformed and missing invoice IDs ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward post exceptions/1/reverse refuses anonymous before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward post exceptions/1/reverse refuses staff before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward post exceptions/1/reverse refuses foreign before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward exceptions/1/reverse rejects malformed and missing invoice IDs ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward post exceptions/1/resolve refuses anonymous before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward post exceptions/1/resolve refuses staff before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward post exceptions/1/resolve refuses foreign before writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward exceptions/1/resolve rejects malformed and missing invoice IDs ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects tenant-local and cross-tenant exception lookup without disclosure ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input null ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input [] ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {} ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {"condition":"bounced_check","reason":42,"paymentIds":[1]} ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {"condition":"bounced_check","reason":"NSF","paymentIds":[true]} ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {"condition":"bounced_check","reason":"NSF","paymentIds":[[1]]} ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {"condition":"bounced_check","reason":"NSF","paymentIds":[{"toString": ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {"condition":"bounced_check","reason":"NSF","paymentIds":[0]} ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {"condition":"bounced_check","reason":"NSF","paymentIds":[2147483648]} ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {"condition":"bounced_check","reason":"NSF","paymentIds":[1,1,1,1,1,1, ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward flag failure on invoice_exceptions rolls back everything ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward flag failure on invoice_exception_payments rolls back everything ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward flag failure on invoice_history rolls back everything ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward cancels a flag without changing money and prevents repeated cancellation ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward serializes duplicate flags into exactly one active grant ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward reverse failure on customer_invoices rolls back the whole batch ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward reverse failure on invoice_exception_payments rolls back the whole batch ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward reverse failure on invoice_statement_members rolls back the whole batch ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward reverse failure on invoice_exceptions rolls back the whole batch ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward reverse failure on invoice_history rolls back the whole batch ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward reverses both receipts once under racing requests: $50 + $20 + $30 = $100 ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward storage failure leaves the reversal pending and no revision/history writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward upload failure preserves the pending correction and original ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward invalid archive failure preserves the pending correction and original ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward refuses a foreign original artifact key before storage access, with no writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward revision failure on invoice_revisions leaves original evidence and state intact ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward revision failure on invoice_exceptions leaves original evidence and state intact ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward revision failure on invoice_history leaves original evidence and state intact ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward requires roll-forward after the affected statement was absorbed ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` owner exception boundaries, authorization, faults and roll-forward read database failure makes no writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction locks retainer root/draws, printed credits, job deletion and reassignment without writes ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction marks locked rows and exposes the owning invoice on reads ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction refuses import-style raw updates, deletes and new links to an issued statement ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction refuses retainer-funded receipt exceptions ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction allows new funded work and credits without rewriting a sent statement ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction pending approval against a sent invoice posts only a fresh snapshot, with atomic failure and retry ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction unissued parents and child snapshots cannot open an exception ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction reverses a $150 bounced check as $100 restored debt plus $50 cancelled credit, then issues a $100 revision ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction refuses reversal of a bounced overpayment whose excess has already funded work, with no partial correction ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction locks historical artifacts without a backfill and audits first exception hydration ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction creates two numbered revisions from separate exceptions without accumulating corrections twice ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.
- ` sent ledger surface coverage and overpayment correction protects job families linked only to sent receipts or credits, including raw imports ` — [spec](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js); passed.

### scenario-lifecycle-13-retainer-events.integration.spec

- ` owner decision 1: retainer refunds and adjustments starts with $500, draws $120 and issues a frozen $0 statement with $380 available ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments refunds $80 then increases $50 and decreases $30: availability 380-80+50-30=$320, debt $0 ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments prints all events exactly once and preserves the original artifact ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid kind without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid zero without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid negative without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid nonfinite without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid precision without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid maximum without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid date without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid reason without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid method without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid reference without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects invalid direction without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects insufficient availability, missing/cross-tenant IDs and permissions without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments refuses cancellation revival, overflow, malformed adjustment fields and direct journal-chain edits ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments reports retainer history database failure without writes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments refuses inconsistent retainer balances and cross-customer chains on both event routes ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments preserves pending events when statement storage fails before commit ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rolls back snapshot and journal on each database write failure ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments refunds all $320, prints the event even with zero retainers, then increases an exhausted chain ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments serializes racing refunds; only one $40 refund can consume $50 ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments serializes a $10 draw against a $10 refund and leaves event evidence immutable ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.
- ` owner decision 1: retainer refunds and adjustments rejects a finalize priced before a refund and prints long reasons across statement pages ` — [spec](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js); passed.

### scenario-lifecycle-14-duplicates.integration.spec

- ` owner decision 4: visible duplicate review and guarded removal flags matching manual work on creation; badge data and actor are visible without changing balances ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal dismisses without ledger changes and a review scan does not reopen the pair ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal manually flags an unpaired entry and removes it through the work deletion core: $200 -> $100 ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal detects and removes duplicate payments atomically: $1000 - $100 - $100 -> $900 ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal detects/removes duplicate writeoffs and retainers without double counting available credit ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal scans existing matching entries, supports idempotent concurrent scans and resolves all pairs for a removed source ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal locks sent duplicates, preserves original rows, and still permits not-a-duplicate dismissal ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal refuses a retainer with draws and a payment with a later balance event without partial writes ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal validates manual flag kind with no writes ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal validates manual flag ID with no writes ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal validates manual flag canonical ID with no writes ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal validates manual flag self with no writes ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal validates manual flag reason with no writes ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal validates manual flag missing with no writes ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal validates manual flag missing canonical with no writes ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal validates scan/list/filter/action and checks missing records ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal enforces authentication, roles and tenancy on every new route ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal refuses stale source reviews and missing sources without deleting changed money ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal allows an explicit fresh review of a changed dismissed source, preserving prior evidence ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal rejects retainer snapshot flags, malformed resolution IDs and suppressed resolution writes ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal rolls back flag, scan, dismissal and removal when evidence cannot be saved ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal rolls back each manual create route when automatic duplicate evidence fails ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.
- ` owner decision 4: visible duplicate review and guarded removal reports read failures with no writes and rejects changed duplicate history ` — [spec](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js); passed.

### scenario-lifecycle-15-credit-statements.integration.spec

- ` owner decision 2: optional signed credit statements shows -$50 clearly; preview and default skip preserve every pending record ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.
- ` owner decision 2: optional signed credit statements explicitly issues -$50 with no payment due, session actor/reason and frozen evidence ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.
- ` owner decision 2: optional signed credit statements same-day guard remains; selected carry-forward absorbs -$50 once and adds $20 = -$30 ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.
- ` owner decision 2: optional signed credit statements crosses credit to zero then debt without another credit payment or dropped activity ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.
- ` owner decision 2: optional signed credit statements mixed batch issues debit only and leaves an unselected credit customer unchanged ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.
- ` owner decision 2: optional signed credit statements a bounced receipt revises chosen credit -10 to 10 once with the correct PDF label ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.
- ` owner decision 2: optional signed credit statements a bounced receipt revises chosen credit -50 to -30 once with the correct PDF label ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.
- ` owner decision 2: optional signed credit statements validates every new raw option and customer shape before writing ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.
- ` owner decision 2: optional signed credit statements rejects missing/cross-account customers, anonymous/staff and foreign tenants without writes ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.
- ` owner decision 2: optional signed credit statements selected credit database and storage failures leave all money, membership and selection evidence unchanged ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.
- ` owner decision 2: optional signed credit statements eligibility fails closed when pricing is unavailable rather than labelling credits zero ` — [spec](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js); passed.

### scenario-lifecycle-16-owner-combined.integration.spec

- ` all five owner decisions in one complete billing lifecycle work -> retainer draw -> finalize means sent and locked: $400 - $100 = $300 ` — [spec](../../test/integration/scenario-lifecycle-16-owner-combined.integration.spec.js); passed.
- ` all five owner decisions in one complete billing lifecycle new duplicate work is visibly flagged and removed; issued evidence remains frozen ` — [spec](../../test/integration/scenario-lifecycle-16-owner-combined.integration.spec.js); passed.
- ` all five owner decisions in one complete billing lifecycle check receipt -> statement $240 -> bounced flag -> narrow reversal $340 -> roll forward ` — [spec](../../test/integration/scenario-lifecycle-16-owner-combined.integration.spec.js); passed.
- ` all five owner decisions in one complete billing lifecycle retainer refund -> credit skipped -> credit chosen -> later work consumes credit exactly once ` — [spec](../../test/integration/scenario-lifecycle-16-owner-combined.integration.spec.js); passed.

### scenario-lifecycle-17-time-boundaries.integration.spec

- ` duration boundaries through manual, held review, invoice, audit, AR and analytics 1 min manually and through held tracker review cost $13.75 each ` — [spec](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js); passed.
- ` duration boundaries through manual, held review, invoice, audit, AR and analytics 6 min manually and through held tracker review cost $13.75 each ` — [spec](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js); passed.
- ` duration boundaries through manual, held review, invoice, audit, AR and analytics 7 min manually and through held tracker review cost $27.5 each ` — [spec](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js); passed.
- ` duration boundaries through manual, held review, invoice, audit, AR and analytics 14 min manually and through held tracker review cost $41.25 each ` — [spec](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js); passed.
- ` duration boundaries through manual, held review, invoice, audit, AR and analytics 15 min manually and through held tracker review cost $41.25 each ` — [spec](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js); passed.
- ` duration boundaries through manual, held review, invoice, audit, AR and analytics 16 min manually and through held tracker review cost $41.25 each ` — [spec](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js); passed.
- ` duration boundaries through manual, held review, invoice, audit, AR and analytics 59 min manually and through held tracker review cost $137.5 each ` — [spec](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js); passed.
- ` duration boundaries through manual, held review, invoice, audit, AR and analytics 60 min manually and through held tracker review cost $137.5 each ` — [spec](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js); passed.
- ` duration boundaries through manual, held review, invoice, audit, AR and analytics 61 min manually and through held tracker review cost $151.25 each ` — [spec](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js); passed.
- ` duration boundaries through manual, held review, invoice, audit, AR and analytics keeps actual tracker hours separate from rounded billed hours and freezes $1210 in the PDF ` — [spec](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js); passed.

### scenario-lifecycle-18-audit-record.integration.spec

- ` owner decision 6 hard account audit record attributes work, edits, customers and jobs to the session actor, never URL or logged-for staff ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record retainer receipt/draw/refund/increase remain separate from debt: $120+$50-$50-$20=$100; available $100-$50-$10+$5=$45 ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record draft writes no events; finalize marks sent and locks without double charging ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record receipt -> finalized lock -> bounced reversal -> roll forward yields $70 -> $100 with all exception transitions ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record duplicate flag/dismiss/remove and ordinary delete retain changes; $100+$10+$10-$10=$110 ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record captures direct imports as system with source and never mistakes creator for actor ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record paginates without resetting balances, applies Phoenix dates, and accepts admins ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record generates a printable stored snapshot and reopens byte-identical bytes after later edits ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record prints full evidence compactly with retrievable payload descriptors and exact reopening ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record refuses updating/deleting stored metadata and preserves its PDF and evidence ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record records invoice reprints, and a failed reprint audit write returns no bytes or partial evidence ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record denies Manager and Owner on every audit route, preserving their other billing permissions ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record GET /: authentication, roles, tenant, missing and database failures write nothing ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record GET /verify: authentication, roles, tenant, missing and database failures write nothing ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record GET /records: authentication, roles, tenant, missing and database failures write nothing ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record POST /records: authentication, roles, tenant, missing and database failures write nothing ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record GET /records/RECORD/pdf: authentication, roles, tenant, missing and database failures write nothing ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record GET /records/RECORD/verify: authentication, roles, tenant, missing and database failures write nothing ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record GET /records/RECORD/evidence: authentication, roles, tenant, missing and database failures write nothing ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record validates every range/pagination branch and rejects malformed/missing stored IDs without writes ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record foreign customer/record isolation, including super admins, leaves no evidence ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record storage creation failure and DB insert failure publish no record and no log; retry succeeds ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record render failure, empty storage result and suppressed metadata insert publish no record ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record refuses archive tampering, wrong storage identity, missing archive, failed chain and failed anchor without writes ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record PDF upload failure after evidence upload publishes no metadata for either print type ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record fails the financial write closed if audit capture fails, with no partial business or chain changes ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record isolates concurrent users and permits later postings while a consistent PDF snapshot is rendered ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record reacquires the account lock after savepoint rollback and rolls back actor-attributed evidence atomically ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record detects altered PDF bytes, blocks reopening and reports verification failure without writes ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record refuses a forged storage identity and detects a mismatched retained chain anchor ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record detects altered chain evidence in the disposable scenario database and blocks new print/history ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.
- ` owner decision 6 hard account audit record reconstructs pre-logging history and unknown actors, then retains edits and deletion ` — [spec](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js); passed.

### Screen: src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.finalize.test.js

- ` CreateNewInvoices — finalize confirmation path against the real grid, FetchCalls, and balance envelope commits through the confirmation dialog, refreshes the real balance envelope, and leaves the grid selection clear ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.finalize.test.js); passed.
- ` CreateNewInvoices — finalize confirmation path against the real grid, FetchCalls, and balance envelope R2: a real HTTP failure on the post-finalize balance refresh keeps the previous grid data on screen and warns, instead of permanent Loading ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.finalize.test.js); passed.
- ` CreateNewInvoices — finalize confirmation path against the real grid, FetchCalls, and balance envelope R3: a download failure plus an explicit refresh-error envelope leaves no checked rows; Submit reports the empty selection ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.finalize.test.js); passed.
- ` CreateNewInvoices — finalize confirmation path against the real grid, FetchCalls, and balance envelope R3: an all-skipped batch clears the grid selection so an immediate second Submit does not silently resubmit the same customer ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.finalize.test.js); passed.
- ` a partial skip clears the selection but retains the skipped customer's note and write-off flag for the retry ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.finalize.test.js); passed.

### Screen: src/Components/DataGrids/CreateInvoiceGrid.test.js

- ` CreateInvoiceGrid — bulk selection excludes billed-today rows, individual selection does not header select-all with one fresh and one billed-today row submits only the fresh one, and the UI shows the same ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.
- ` CreateInvoiceGrid — bulk selection excludes billed-today rows, individual selection does not a single billed-today row does not get swept in by header select-all (header is disabled with nothing eligible) ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.
- ` CreateInvoiceGrid — bulk selection excludes billed-today rows, individual selection does not individual selection of a billed-today row stays possible via its own row checkbox ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.
- ` CreateInvoiceGrid — header checkbox keyboard operation and accessible mixed state Space on the focused header checkbox selects all eligible rows, and Space again deselects them ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.
- ` CreateInvoiceGrid — header checkbox keyboard operation and accessible mixed state key-repeat while Space is held does not re-toggle the selection on every repeat tick ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.
- ` CreateInvoiceGrid — header checkbox keyboard operation and accessible mixed state a partial selection exposes aria-checked="mixed" (assistive tech reads this; MUI's indeterminate prop is visual-only) ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.
- ` CreateInvoiceGrid — header checkbox keyboard operation and accessible mixed state a filter change prunes hidden selections but keeps visible ones selected, and header clicks still work ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.
- ` keeps zero-dollar customers with pending retainer events selectable ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.
- ` owner decision 2: explicit credit selection shows credit, excludes it from bulk selection and includes it only after an individual choice ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.
- ` owner decision 2: explicit credit selection never selects a sole credit by keyboard bulk selection ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.
- ` a selected debit becoming credit after refresh does not silently gain credit authorization ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/CreateInvoiceGrid.test.js); passed.

### Screen: src/Pages/Transactions/Duplicates/PossibleDuplicates.test.js

- ` shows both records and requires a reason before a review action ` — [spec](../../../DS2_Frontend/src/Pages/Transactions/Duplicates/PossibleDuplicates.test.js); passed.
- ` confirms removal and surfaces conflict without claiming success ` — [spec](../../../DS2_Frontend/src/Pages/Transactions/Duplicates/PossibleDuplicates.test.js); passed.
- ` offers invoice history and disables removal for sent records ` — [spec](../../../DS2_Frontend/src/Pages/Transactions/Duplicates/PossibleDuplicates.test.js); passed.
- ` scans with a reason and includes resolved history on request ` — [spec](../../../DS2_Frontend/src/Pages/Transactions/Duplicates/PossibleDuplicates.test.js); passed.
- ` manually flags a record and requires a valid positive ID ` — [spec](../../../DS2_Frontend/src/Pages/Transactions/Duplicates/PossibleDuplicates.test.js); passed.
- ` shows read failure and prevents removal of missing records ` — [spec](../../../DS2_Frontend/src/Pages/Transactions/Duplicates/PossibleDuplicates.test.js); passed.

### Screen: src/Pages/Customer/CustomerProfile/RetainerEvents.test.js

- ` shows the sent boundary and immutable event history ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/RetainerEvents.test.js); passed.
- ` requires confirmation and records actor-attributed refund fields then refreshes ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/RetainerEvents.test.js); passed.
- ` does not submit unavailable funds and invalidates confirmation when amount changes ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/RetainerEvents.test.js); passed.
- ` supports increasing an exhausted chain without refund evidence ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/RetainerEvents.test.js); passed.
- ` keeps failed submissions reviewable and shows load failures ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/RetainerEvents.test.js); passed.
- ` shows read errors and empty retainer guidance ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/RetainerEvents.test.js); passed.
- ` selects newly loaded roots and replaces a selection when the customer changes ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/RetainerEvents.test.js); passed.

### Screen: src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js

- ` shows the lock and reprints the original without a money mutation ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js); passed.
- ` requires both a reason and selected payment before recording a flag ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js); passed.
- ` shows refusal and keeps the flag form available for retry ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js); passed.
- ` only offers reversal and cancellation while flagged ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js); passed.
- ` resolves reversed exception with revision ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js); passed.
- ` resolves reversed exception with roll_forward ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js); passed.
- ` shows history and download failures ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js); passed.
- ` shows a history load error ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js); passed.
- ` reports the refreshed current balance after correction and shows cancellation evidence ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js); passed.
- ` explains how to reprint the complete revision package ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceHistory.test.js); passed.

### Screen: src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js

- ` allows Admin and shows deterministic changes, amounts and Phoenix time ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` allows Super Admin and shows deterministic changes, amounts and Phoenix time ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` refuses User before fetching and protects direct navigation ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` refuses Manager before fetching and protects direct navigation ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` refuses Owner before fetching and protects direct navigation ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` refuses  before fetching and protects direct navigation ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` uses a separate guard allowing Admin without widening AI Audit ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` filters and paginates history and records independently ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` validates reversed ranges without fetching ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` prints the applied range, reopens its ID and reopens older stored bytes without regeneration ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` verifies and reports integrity failures ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` shows load and print failures and allows retry ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` ignores a slower response for a previous customer ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` renders empty and reconstructed history honestly ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.
- ` offers full evidence printing and shows type without exposing raw fields or payloads ` — [spec](../../../DS2_Frontend/src/Pages/Customer/CustomerProfile/CustomerProfileAuditRecord.test.js); passed.

### Screen: src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.test.js

- ` CreateNewInvoices — committed results survive follow-up failures success + download failure keeps the success result visible and adds a warning ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.test.js); passed.
- ` CreateNewInvoices — committed results survive follow-up failures an all-skipped batch keeps its skip details visible well past the old 2-second auto-clear ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.test.js); passed.
- ` CreateNewInvoices — committed results survive follow-up failures shows the skipped customer's existing invoice number ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.test.js); passed.
- ` CreateNewInvoices — committed results survive follow-up failures dismisses the result only when the user closes the alert ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/CreateNewInvoices.test.js); passed.

### Screen: src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.test.js

- ` adds Audit Record next to AI Audit with separate admin visibility ` — [spec](../../../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.test.js); passed.
- ` CustomerProfileSubRoutes — gates children on a successful load shows a loading indicator before the fetch resolves, not an empty/broken tab ` — [spec](../../../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.test.js); passed.
- ` CustomerProfileSubRoutes — gates children on a successful load shows an Alert and no tab content on a real HTTP 404 (fetch helper's {status, message} shape) ` — [spec](../../../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.test.js); passed.
- ` CustomerProfileSubRoutes — gates children on a successful load shows an Alert and no tab content on a body-status 404 (HTTP 200, {status: 404} payload) ` — [spec](../../../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.test.js); passed.
- ` CustomerProfileSubRoutes — gates children on a successful load falls back to a default message when the error response carries none ` — [spec](../../../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.test.js); passed.
- ` CustomerProfileSubRoutes — gates children on a successful load renders the tab content on a genuine successful load ` — [spec](../../../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.test.js); passed.
- ` CustomerProfileSubRoutes — gates children on a successful load discards an obsolete response: navigating to a second customer before the first resolves only ever shows the second ` — [spec](../../../DS2_Frontend/src/Routes/GroupedRoutes/CustomerRoutes/CustomerProfileSubRoutes.test.js); passed.

### Screen: src/Pages/Invoices/CreateNewInvoice/SubComponents/CreateInvoiceCheckBoxes.test.js

- ` CreateInvoiceCheckBoxes — Allow same-day re-bill is disabled when no selected row was already billed today ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/SubComponents/CreateInvoiceCheckBoxes.test.js); passed.
- ` CreateInvoiceCheckBoxes — Allow same-day re-bill is enabled once a selected row was already billed today ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/SubComponents/CreateInvoiceCheckBoxes.test.js); passed.
- ` CreateInvoiceCheckBoxes — Allow same-day re-bill reports allowSameDayRebill=true on check ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/SubComponents/CreateInvoiceCheckBoxes.test.js); passed.
- ` CreateInvoiceCheckBoxes — Allow same-day re-bill reflects a checked state from invoiceCreationSettings ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/CreateNewInvoice/SubComponents/CreateInvoiceCheckBoxes.test.js); passed.

### Screen: src/Components/SentInvoiceNotice.test.js

- ` explains the lock and opens the owning statement instead of the payment snapshot ` — [spec](../../../DS2_Frontend/src/Components/SentInvoiceNotice.test.js); passed.

### Screen: src/Pages/Invoices/InvoiceDetails/InvoiceDetails.credit.test.js

- ` labels the immutable issued credit separately from its later current balance ` — [spec](../../../DS2_Frontend/src/Pages/Invoices/InvoiceDetails/InvoiceDetails.credit.test.js); passed.

### Screen: src/Components/DataGrids/sentLockColumn.test.js

- ` leaves unlocked grids alone ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/sentLockColumn.test.js); passed.
- ` keeps a visible status after feature column filtering ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/sentLockColumn.test.js); passed.
- ` adds a visible duplicate badge linking to its review after grid filtering ` — [spec](../../../DS2_Frontend/src/Components/DataGrids/sentLockColumn.test.js); passed.

### Screen: src/Services/ApiCalls/AuditRecordCalls.test.js

- ` uses account/customer-scoped routes, exact range and record identity ` — [spec](../../../DS2_Frontend/src/Services/ApiCalls/AuditRecordCalls.test.js); passed.
- ` propagates failures instead of pretending a record was printed ` — [spec](../../../DS2_Frontend/src/Services/ApiCalls/AuditRecordCalls.test.js); passed.
- ` downloads the stored PDF and releases the object URL ` — [spec](../../../DS2_Frontend/src/Services/ApiCalls/AuditRecordCalls.test.js); passed.

The complete frontend run passed 184 tests in 40 suites. The additional [five real-browser owner-decision checks](../../../DS2_Frontend/e2e/tests/path-matrix-owner-decisions.spec.js) were blocked before their first test body: Chromium launch failed with macOS `bootstrap_check_in ... Permission denied (1100)`. They are **not** counted as passing; four dependent tests did not run. [Launch evidence](evidence/pass3/browser-blocked.log). No running local server was restarted.

## Exact test index

Every T reference resolves to the full Mocha title and spec path; dynamically generated parameter cases retain their individual title.

<a id="t0001"></a>**T0001** — [test/ai_integrations/bedrock/index.spec.js](../../test/ai_integrations/bedrock/index.spec.js)

` bedrock _parseAnthropicJson returns null entirely on bad input `

<a id="t0002"></a>**T0002** — [test/ai_integrations/bedrock/index.spec.js](../../test/ai_integrations/bedrock/index.spec.js)

` bedrock invokeBedrockClaude throws after retry exhaustion `

<a id="t0003"></a>**T0003** — [test/ai_integrations/categoryInference.spec.js](../../test/ai_integrations/categoryInference.spec.js)

` categoryInference inferCategorization falls through to Sonnet when Haiku throws `

<a id="t0004"></a>**T0004** — [test/ai_integrations/categoryInference.spec.js](../../test/ai_integrations/categoryInference.spec.js)

` categoryInference inferCategorization returns suggestion=null when both models throw `

<a id="t0005"></a>**T0005** — [test/ai_integrations/customerMatching.spec.js](../../test/ai_integrations/customerMatching.spec.js)

` customerMatching matchCustomer conflicting legal forms never auto-match (C5) "Acme LLC" searched against a catalog that only has "Acme Inc" is held, not matched exact/canonical `

<a id="t0006"></a>**T0006** — [test/ai_integrations/customerMatching.spec.js](../../test/ai_integrations/customerMatching.spec.js)

` customerMatching matchCustomer returns tier=llm_error when Bedrock throws `

<a id="t0007"></a>**T0007** — [test/endpoints/auth/roleGates.integration.spec.js](../../test/endpoints/auth/roleGates.integration.spec.js)

` integration: backend role gates mirror the frontend (fixes 2 & 3) GET /accountAudit/whoami (requireSuperAdmin, gated inside account-audit-router.js itself) 200s a "Super Admin" caller `

<a id="t0008"></a>**T0008** — [test/endpoints/billingReview/billingReview-router.spec.js](../../test/endpoints/billingReview/billingReview-router.spec.js)

` billingReview-router POST /reprocess-with-overrides/:entryID 409 when the entry was already applied `

<a id="t0009"></a>**T0009** — [test/endpoints/billingReview/billingReview-router.spec.js](../../test/endpoints/billingReview/billingReview-router.spec.js)

` billingReview-router PUT /transaction/:transactionID (cascade edit) 400 job_required_for_customer_change with a readable message `

<a id="t0010"></a>**T0010** — [test/endpoints/billingReview/billingReview-router.spec.js](../../test/endpoints/billingReview/billingReview-router.spec.js)

` billingReview-router PUT /transaction/:transactionID (cascade edit) 409 with the rolled-forward guidance for an absorbed statement `

<a id="t0011"></a>**T0011** — [test/endpoints/billingReview/billingReview-router.spec.js](../../test/endpoints/billingReview/billingReview-router.spec.js)

` billingReview-router PUT /transaction/:transactionID (cascade edit) treats confirmCustomerChange: 'false' (string) as NOT confirmed `

<a id="t0012"></a>**T0012** — [test/endpoints/billingReview/billingReview-service.spec.js](../../test/endpoints/billingReview/billingReview-service.spec.js)

` billingReview-service applyHeldEntry a submit whose claim loses the race (entry applied after its pre-read) inserts nothing `

<a id="t0013"></a>**T0013** — [test/endpoints/billingReview/billingReview-service.spec.js](../../test/endpoints/billingReview/billingReview-service.spec.js)

` billingReview-service applyHeldEntry claims the entry so a second submit cannot create a duplicate transaction `

<a id="t0014"></a>**T0014** — [test/endpoints/billingReview/billingReview-service.spec.js](../../test/endpoints/billingReview/billingReview-service.spec.js)

` billingReview-service applyHeldEntry refuses a job that belongs to another customer, and another account's employee `

<a id="t0015"></a>**T0015** — [test/endpoints/billingReview/billingReview-service.spec.js](../../test/endpoints/billingReview/billingReview-service.spec.js)

` billingReview-service applyHeldEntry refuses another tenant's general_work_description_id (400/INVALID_FIELD), nothing written (C8) `

<a id="t0016"></a>**T0016** — [test/endpoints/billingReview/billingReview-service.spec.js](../../test/endpoints/billingReview/billingReview-service.spec.js)

` billingReview-service applyHeldEntry rejects a rate with more than 2 decimal places instead of silently rounding it `

<a id="t0017"></a>**T0017** — [test/endpoints/billingReview/billingReview-service.spec.js](../../test/endpoints/billingReview/billingReview-service.spec.js)

` billingReview-service applyHeldEntry rejects a zero or negative duration with a clear error `

<a id="t0018"></a>**T0018** — [test/endpoints/billingReview/billingReview-service.spec.js](../../test/endpoints/billingReview/billingReview-service.spec.js)

` billingReview-service applyHeldEntry reports a missing required field with a readable message `

<a id="t0019"></a>**T0019** — [test/endpoints/billingReview/billingReview-service.spec.js](../../test/endpoints/billingReview/billingReview-service.spec.js)

` billingReview-service reprocessHeldEntryWithOverrides 404s a deleted or unknown entry `

<a id="t0020"></a>**T0020** — [test/endpoints/billingReview/billingReview-service.spec.js](../../test/endpoints/billingReview/billingReview-service.spec.js)

` billingReview-service reprocessHeldEntryWithOverrides refuses to reset an entry that already produced a live transaction `

<a id="t0021"></a>**T0021** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) billable-amount delta refuses a reduction that would leave a credit balance (engine would drop it) `

<a id="t0022"></a>**T0022** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) billable-amount delta rejects amount edits when the statement is paid in full `

<a id="t0023"></a>**T0023** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) customer / job changes a customer change on an absorbed statement is refused (it would move billed money) `

<a id="t0024"></a>**T0024** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) customer / job changes refuses a customer in another account `

<a id="t0025"></a>**T0025** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) customer / job changes refuses a job that belongs to a different customer (job-only change) `

<a id="t0026"></a>**T0026** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) customer / job changes refuses the OLD customer's job on a customer change (what the grid sends if no new job is picked) `

<a id="t0027"></a>**T0027** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) customer / job changes refuses unlinking the job `

<a id="t0028"></a>**T0028** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) customer / job changes rejects customer_id changes without confirm flag `

<a id="t0029"></a>**T0029** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) ledger locking (concurrent saves) gives up with concurrent_edit when the row keeps changing customer `

<a id="t0030"></a>**T0030** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) ledger locking (concurrent saves) locks the statement's own customer when a legacy row is billed on another customer's statement `

<a id="t0031"></a>**T0031** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) ledger locking (concurrent saves) re-locks (rollback + retry) when the row moved to another customer after the preview `

<a id="t0032"></a>**T0032** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) ledger locking (concurrent saves) refuses cleanly when the row's own customer is not in this account `

<a id="t0033"></a>**T0033** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) ledger locking (concurrent saves) refuses on the locked chain state even when the preview looked fine (B paid the statement off first) `

<a id="t0034"></a>**T0034** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) no-op and non-financial edits rejects another account's work description `

<a id="t0035"></a>**T0035** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) no-op and non-financial edits rejects retainer_id edits via this endpoint `

<a id="t0036"></a>**T0036** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) no-op and non-financial edits rejects transaction_date when it falls outside the linked invoice period `

<a id="t0037"></a>**T0037** — [test/endpoints/billingReview/cascadeEdit.flow.spec.js](../../test/endpoints/billingReview/cascadeEdit.flow.spec.js)

` cascadeEdit applyTransactionEdit (flow) retainer-funded transactions refuses amount / billable / customer changes but allows notes `

<a id="t0038"></a>**T0038** — [test/endpoints/billingReview/cascadeEdit.spec.js](../../test/endpoints/billingReview/cascadeEdit.spec.js)

` cascadeEdit pure helpers _normalizeUpdates rejects blanks and garbage in NOT NULL fields `

<a id="t0039"></a>**T0039** — [test/endpoints/invoice/engine-units.spec.js](../../test/endpoints/invoice/engine-units.spec.js)

` sharedInvoiceFunctions.incrementAnInvoiceOrQuote — billing year and overflow refuses to overflow five digits `

<a id="t0040"></a>**T0040** — [test/endpoints/job/job-router.spec.js](../../test/endpoints/job/job-router.spec.js)

` job-router — ledger-serialized create/update (A2) PUT /updateJob refuses with a concurrent-edit message when the job moved to a different customer between the two lock-window reads `

<a id="t0041"></a>**T0041** — [test/endpoints/notifications/notifications-service.spec.js](../../test/endpoints/notifications/notifications-service.spec.js)

` notifications-service rejects insertion with missing fields `

<a id="t0042"></a>**T0042** — [test/endpoints/payments/payment-integrity.spec.js](../../test/endpoints/payments/payment-integrity.spec.js)

` billed gate in SQL — microsecond-exact, same rule as the engine statement gate refuses tables that are not ledger rows (identifiers are never taken from input) `

<a id="t0043"></a>**T0043** — [test/endpoints/payments/payment-integrity.spec.js](../../test/endpoints/payments/payment-integrity.spec.js)

` pickCurrentChainTarget — current-chain rule shared by payments and write-offs refuses the remap when the current chain has nothing remaining `

<a id="t0044"></a>**T0044** — [test/endpoints/retainer/retainer-rules.spec.js](../../test/endpoints/retainer/retainer-rules.spec.js)

` payment → retainer draw linkage (ledger-helpers.resolveRetainerDrawForPayment) refuses a marker that names a missing row, a root, another customer’s draw or another chain’s draw — never guesses `

<a id="t0045"></a>**T0045** — [test/endpoints/timeTracking/template-builder.spec.js](../../test/endpoints/timeTracking/template-builder.spec.js)

` buildTemplate owner flag is required (fail-closed) throws a TypeError before any database read or buffer access when isOwnerAccount is omitted or not a boolean `

<a id="t0046"></a>**T0046** — [test/endpoints/timeTracking/template-builder.spec.js](../../test/endpoints/timeTracking/template-builder.spec.js)

` template-builder fail-closed allowlist + name-boundary fixes (Astra findings 2 & 3, round 9) clears Employee Names!B1 (not just column A) of a stray value `

<a id="t0047"></a>**T0047** — [test/endpoints/timeTracking/template-builder.spec.js](../../test/endpoints/timeTracking/template-builder.spec.js)

` template-builder fail-closed allowlist + name-boundary fixes (Astra findings 2 & 3, round 9) throws when fed Astra's round-9 finding-2 fixture (hidden foreign sheet + formula + hyperlink) `

<a id="t0048"></a>**T0048** — [test/endpoints/timeTracking/template-builder.spec.js](../../test/endpoints/timeTracking/template-builder.spec.js)

` template-builder fail-closed allowlist + name-boundary fixes (Astra findings 2 & 3, round 9) throws when the base has an unknown worksheet `

<a id="t0049"></a>**T0049** — [test/endpoints/timeTracking/template-builder.spec.js](../../test/endpoints/timeTracking/template-builder.spec.js)

` template-builder non-owner build (neutral asset) excludes a forbidden token from the scan when it matches the requesting tenant's OWN current data (no false-positive 503) `

<a id="t0050"></a>**T0050** — [test/endpoints/timeTracking/template-builder.spec.js](../../test/endpoints/timeTracking/template-builder.spec.js)

` template-builder non-owner build (neutral asset) still throws for a forbidden token that does NOT match anything in the requesting tenant's own current data `

<a id="t0051"></a>**T0051** — [test/endpoints/timeTracking/template-builder.spec.js](../../test/endpoints/timeTracking/template-builder.spec.js)

` template-builder non-owner build (neutral asset) throws when the asset file is missing `

<a id="t0052"></a>**T0052** — [test/endpoints/timeTracking/template-builder.spec.js](../../test/endpoints/timeTracking/template-builder.spec.js)

` template-builder non-owner build (neutral asset) throws when the neutral asset does not match its manifest sha256 — never serves an unverified asset `

<a id="t0053"></a>**T0053** — [test/endpoints/timeTracking/template-builder.spec.js](../../test/endpoints/timeTracking/template-builder.spec.js)

` template-builder tenant-neutral scrubbing (Astra finding 2) throws rather than scrubs when the base contains a cell comment (a package part outside the allowlist) `

<a id="t0054"></a>**T0054** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects "" `

<a id="t0055"></a>**T0055** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects "1:30" `

<a id="t0056"></a>**T0056** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects "25h" `

<a id="t0057"></a>**T0057** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects "7.5m" `

<a id="t0058"></a>**T0058** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects "abc" `

<a id="t0059"></a>**T0059** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects -46 `

<a id="t0060"></a>**T0060** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects 0 `

<a id="t0061"></a>**T0061** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects 1441 `

<a id="t0062"></a>**T0062** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects 7.5 `

<a id="t0063"></a>**T0063** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects NaN `

<a id="t0064"></a>**T0064** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` parseDurationMinutes rejects null `

<a id="t0065"></a>**T0065** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` tracker upload validation (prod layout) Duration rejects negative durations instead of billing them as positive amounts `

<a id="t0066"></a>**T0066** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` tracker upload validation (prod layout) Duration rejects zero `

<a id="t0067"></a>**T0067** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` tracker upload validation (prod layout) a corrupt / unsupported workbook (C11) a corrupt XLSX (unparseable ZIP) -> a clean validation error, not a thrown exception / 500 `

<a id="t0068"></a>**T0068** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` tracker upload validation (prod layout) entry dates rejects a future-dated typo (2058) and names the row `

<a id="t0069"></a>**T0069** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` tracker upload validation (prod layout) entry dates rejects dates after the tracker end date `

<a id="t0070"></a>**T0070** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` tracker upload validation (prod layout) header row fails the upload naming a misspelled required header instead of silently dropping the column `

<a id="t0071"></a>**T0071** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` tracker upload validation (prod layout) header row rejects a duplicated column `

<a id="t0072"></a>**T0072** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` tracker upload validation (prod layout) reports every bad row in one pass `

<a id="t0073"></a>**T0073** — [test/endpoints/timesheets/tracker-validation.spec.js](../../test/endpoints/timesheets/tracker-validation.spec.js)

` tracker upload validation: employee lookup is scoped to the OWNER (C7) an owner id outside the roster is refused (B1 no longer resolves against the whole account) `

<a id="t0074"></a>**T0074** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions retainer-payment linkage refuses when more than one candidate payment matches, regardless of billed status `

<a id="t0075"></a>**T0075** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions retainer-payment linkage refuses with the given message when the single match is already billed `

<a id="t0076"></a>**T0076** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.addNewTransaction a failing AI training insert neither fails nor rolls back the entry `

<a id="t0077"></a>**T0077** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.addNewTransaction refuses another customer's retainer before any write (cross-customer draw) `

<a id="t0078"></a>**T0078** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.decideFundingAction refuses silently dropping the retainer from a funded billable entry `

<a id="t0079"></a>**T0079** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.differenceBetweenOldAndNewTransaction throws a clean "not found" Error (not a TypeError) when the transaction does not exist `

<a id="t0080"></a>**T0080** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.updateRecentJobTotal throws a clean "not found" Error (not a TypeError) when the job does not exist `

<a id="t0081"></a>**T0081** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.updateTransactionCore / deleteTransactionCore keeps the stored-row guards: not found, billed, and customer moves `

<a id="t0082"></a>**T0082** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.updateTransactionCore / deleteTransactionCore refuses (via the payments module's resolver) when the marker names a row that is not a draw `

<a id="t0083"></a>**T0083** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.updateTransactionCore / deleteTransactionCore refuses an increase the retainer cannot cover — nothing changes `

<a id="t0084"></a>**T0084** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.updateTransactionCore / deleteTransactionCore refuses deleting an entry whose payment is billed — nothing changes `

<a id="t0085"></a>**T0085** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.updateTransactionCore / deleteTransactionCore refuses making an entry non-billable once its payment is billed — nothing changes `

<a id="t0086"></a>**T0086** — [test/endpoints/transactions/sharedTransactionFunctions.spec.js](../../test/endpoints/transactions/sharedTransactionFunctions.spec.js)

` sharedTransactionFunctions.updateTransactionCore / deleteTransactionCore refuses switching a funded entry to a different retainer chain, or dropping its retainer `

<a id="t0087"></a>**T0087** — [test/endpoints/user/userGuards.integration.spec.js](../../test/endpoints/user/userGuards.integration.spec.js)

` integration: user-router self-service and last-super-admin guards (fix 7) DELETE /user/deleteUser — self-delete guard refuses when the caller tries to delete their own account `

<a id="t0088"></a>**T0088** — [test/endpoints/user/userGuards.integration.spec.js](../../test/endpoints/user/userGuards.integration.spec.js)

` integration: user-router self-service and last-super-admin guards (fix 7) PUT /user/updateUser — self-deactivate guard refuses when the caller tries to deactivate their own account `

<a id="t0089"></a>**T0089** — [test/endpoints/user/userGuards.integration.spec.js](../../test/endpoints/user/userGuards.integration.spec.js)

` integration: user-router self-service and last-super-admin guards (fix 7) last-active-Super-Admin guard PUT /user/updateUser refuses to demote the account's only active Super Admin away from Super Admin `

<a id="t0090"></a>**T0090** — [test/integration/cascade-edit-recompute.integration.spec.js](../../test/integration/cascade-edit-recompute.integration.spec.js)

` integration: cascadeEdit delta posting (billing review) an unchanged out-of-period date does not 409 `

<a id="t0091"></a>**T0091** — [test/integration/cascade-edit-recompute.integration.spec.js](../../test/integration/cascade-edit-recompute.integration.spec.js)

` integration: cascadeEdit delta posting (billing review) refuses a customer change without a job for the new customer `

<a id="t0092"></a>**T0092** — [test/integration/clean-room-regression.integration.spec.js](../../test/integration/clean-room-regression.integration.spec.js)

` clean-room regression: three statement cycles on ds2_clean 2d. reference data CRUD: work descriptions, job types and categories (deactivate=false persists, in-use deletes refused) `

<a id="t0093"></a>**T0093** — [test/integration/clean-room-regression.integration.spec.js](../../test/integration/clean-room-regression.integration.spec.js)

` clean-room regression: three statement cycles on ds2_clean 5e. account audit through the API for B and D: balances match the app, only informational findings `

<a id="t0094"></a>**T0094** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer DELETE /customer/deleteCustomer/:customerID/:accountID/:userID (refusal with linked rows) happy path: refuses to delete a customer with a linked job, customer survives `

<a id="t0095"></a>**T0095** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer DELETE /customer/deleteCustomer/:customerID/:accountID/:userID (refusal with linked rows) not-found: a nonexistent customerID returns a clean 404 envelope `

<a id="t0096"></a>**T0096** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer DELETE /customer/deleteCustomer/:customerID/:accountID/:userID (refusal with linked rows) refuses to delete a customer with a recurring-billing row (guard keyed by customer_id, not recurring_customer_id), then deletes once it is gone `

<a id="t0097"></a>**T0097** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer DELETE /recurringCustomer/deleteRecurringCustomer/:accountID/:recurringCustomerId happy path: soft-deletes (is_recurring_customer_active -> false), proven in the DB `

<a id="t0098"></a>**T0098** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer DELETE /recurringCustomer/deleteRecurringCustomer/:accountID/:recurringCustomerId returns a clean 404 for a nonexistent recurringCustomerId `

<a id="t0099"></a>**T0099** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer DELETE /time-tracker-staff/:accountID/:userID/:staffID happy path: removes the staff row, proven in the DB `

<a id="t0100"></a>**T0100** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /account/AccountInformation/:accountID/:userID happy path: returns the account row + logo metadata for the caller's own account `

<a id="t0101"></a>**T0101** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /account/automations/:accountID/:userID happy path: returns all 4 known automation definitions with defaults `

<a id="t0102"></a>**T0102** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /api/health/check happy path: 200 with a real DB probe against the sandbox (same handler, different mount) `

<a id="t0103"></a>**T0103** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /customer/activeCustomers/:accountID/:userID happy path: paginated, includes the seeded Acme fixture, correct pagination metadata `

<a id="t0104"></a>**T0104** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /customer/activeCustomers/:accountID/:userID validation failure: a negative page number is refused with 400 `

<a id="t0105"></a>**T0105** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /customer/activeCustomers/customerByID/:accountID/:userID/:customerID happy path: returns the full customer profile bundle for the seeded Acme fixture `

<a id="t0106"></a>**T0106** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /customer/activeCustomers/customerByID/:accountID/:userID/:customerID returns 404 for a nonexistent customerID `

<a id="t0107"></a>**T0107** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /healthz happy path: 200 ok, no auth required, no DB probe `

<a id="t0108"></a>**T0108** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /healthz/check happy path: 200 with a real DB probe against the sandbox `

<a id="t0109"></a>**T0109** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /initialData/initialBlob/:accountID/:userID happy path (light): 200 with the customersList key present `

<a id="t0110"></a>**T0110** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /notifications/:accountID/:userID unreadOnly=true filters out already-read notifications `

<a id="t0111"></a>**T0111** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /notifications/:accountID/:userID/unread-count happy path: count increases by exactly the number of unread rows this test added `

<a id="t0112"></a>**T0112** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /recurringCustomer/getActiveRecurringCustomers/:accountID/:userID happy path: the list includes the fixture row just inserted `

<a id="t0113"></a>**T0113** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /time-tracker-staff/:accountID/:userID happy path: the seeded staff row (90013) is present with the expected shape `

<a id="t0114"></a>**T0114** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /user/fetchSingleUser/:accountID/:userID happy path: a caller fetches their own record and it matches the DB row `

<a id="t0115"></a>**T0115** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer GET /user/fetchSingleUser/:accountID/:userID returns 404 for a privileged caller looking up a nonexistent userID `

<a id="t0116"></a>**T0116** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /account/createAccount happy path: a Super Admin can provision a brand-new account (not account 1 or 9001), proven in the DB `

<a id="t0117"></a>**T0117** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /account/createAccount validation failure: an empty account body returns 400 without creating an account or address `

<a id="t0118"></a>**T0118** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /auth/google 400s when the credential is missing `

<a id="t0119"></a>**T0119** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /auth/google carries rate-limit headers (authLimiter applies to every /auth/* route) `

<a id="t0120"></a>**T0120** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /auth/logout carries rate-limit headers `

<a id="t0121"></a>**T0121** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /auth/renew carries rate-limit headers `

<a id="t0122"></a>**T0122** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /recurringCustomer/createRecurringCustomer/:accountID/:userID happy path: honours the chosen start date and active flag, proven in the DB `

<a id="t0123"></a>**T0123** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /time-tracker-staff/:accountID/:userID happy path: adds a user as time-tracker staff, proven in the DB (201) `

<a id="t0124"></a>**T0124** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /time-tracker-staff/:accountID/:userID validation failure: an empty userIds array is refused with 400 `

<a id="t0125"></a>**T0125** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /user/createUser/:accountID/:userID honours isActive:false on create `

<a id="t0126"></a>**T0126** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer POST /user/createUser/:accountID/:userID validation failure: a non-canonical accessLevel is refused with 400 before any DB write `

<a id="t0127"></a>**T0127** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /account/automations/:accountID/:userID happy path: toggles isEnabled and replaces recipientUserIds, proven in the DB `

<a id="t0128"></a>**T0128** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /account/automations/:accountID/:userID validation failure: an unknown automationKey is refused with 400 `

<a id="t0129"></a>**T0129** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /account/updateAccount happy path: updates the caller's own account (9001) and is provable in the DB `

<a id="t0130"></a>**T0130** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /account/updateAccount partial-payload regressions (business-only / address-only forms) a well-formed but nonexistent account_info_id rolls back the account fields written in the same request (single transaction) `

<a id="t0131"></a>**T0131** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /account/updateAccount partial-payload regressions (business-only / address-only forms) address fields with a missing or invalid account_info_id → 400, and nothing is written `

<a id="t0132"></a>**T0132** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /customer/updateCustomer/:accountID/:userID (deactivate -> warnings[]) happy path: deactivating a clean customer (no balance/unbilled work) succeeds with an empty warnings array `

<a id="t0133"></a>**T0133** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /notifications/:accountID/:userID/read-all happy path: marks every one of the caller's unread notifications read, proven in the DB `

<a id="t0134"></a>**T0134** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /notifications/:notificationID/:accountID/:userID/read happy path: marks the caller's own notification read, proven in the DB `

<a id="t0135"></a>**T0135** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /notifications/:notificationID/:accountID/:userID/read not-found: a nonexistent notificationID returns a clean 404 `

<a id="t0136"></a>**T0136** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /recurringCustomer/updateRecurringCustomer updates a recurring customer's billing amount `

<a id="t0137"></a>**T0137** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /time-tracker-staff/:accountID/:userID/:staffID happy path: toggles is_active, proven in the DB `

<a id="t0138"></a>**T0138** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /time-tracker-staff/:accountID/:userID/:staffID validation failure: a non-boolean isActive is refused with 400 `

<a id="t0139"></a>**T0139** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /user/updateUser/:accountID/:userID happy path: a Super Admin updates a different user's record, proven in the DB `

<a id="t0140"></a>**T0140** — [test/integration/coverage-account-users-auth-misc.integration.spec.js](../../test/integration/coverage-account-users-auth-misc.integration.spec.js)

` integration: coverage — account / user / auth / notifications / health / initialData / recurringCustomer / timeTrackerStaff / customer PUT /user/updateUser/:accountID/:userID validation failure: a non-canonical accessLevel is refused with 400 and does not change the row `

<a id="t0141"></a>**T0141** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/distinct-entities/:accountID/:userID happy path: returns the account's distinct entity list `

<a id="t0142"></a>**T0142** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/earliest-unbilled-month/:accountID/:userID happy path: returns a YYYY-MM-DD start (or null when nothing is unbilled) `

<a id="t0143"></a>**T0143** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/pending/:accountID/:userID happy path: a paginated list of held entries with a total `

<a id="t0144"></a>**T0144** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/pending/:accountID/:userID validation: a nonsense page or page size is refused with 400, never a 500 `

<a id="t0145"></a>**T0145** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/pre-invoice/:accountID/:userID happy path: a customer/period returns the consolidated list plus an anomaly check `

<a id="t0146"></a>**T0146** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/pre-invoice/:accountID/:userID validation: customerId, start and end are all required `

<a id="t0147"></a>**T0147** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/reprocess-count/:accountID/:userID happy path: default mode is "unprocessed" and reports a count + eligibility `

<a id="t0148"></a>**T0148** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/reprocess-count/:accountID/:userID validation: an unknown mode is refused with a 4xx, never a 500 `

<a id="t0149"></a>**T0149** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/weekly/:accountID/:userID happy path: a valid week returns the consolidated transaction list `

<a id="t0150"></a>**T0150** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/weekly/:accountID/:userID validation: start and end are required `

<a id="t0151"></a>**T0151** — [test/integration/coverage-billing-review.integration.spec.js](../../test/integration/coverage-billing-review.integration.spec.js)

` integration: coverage — billing-review read routes GET /billing-review/weekly/:accountID/:userID validation: start/end must be YYYY-MM-DD `

<a id="t0152"></a>**T0152** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) Account rename cannot collide with another account's storage namespace (finding 1 regression) FIXED: after the rename, setting account 9001's logo to account 1's real logo key STILL 400s — no cross-tenant logo adoption `

<a id="t0153"></a>**T0153** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) DELETE /time-tracking/template/delete — owner-account syntax validator (RESIDUAL finding) owner-account delete refuses a key containing ".." even though it matches the tracker_versions/ prefix and a timetracker_ basename — nothing is deleted `

<a id="t0154"></a>**T0154** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) GET /invoices/downloadFile/:accountID/:userID — key ownership 400 for a missing fileLocation query param (unchanged) `

<a id="t0155"></a>**T0155** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) GET /invoices/downloadFile/:accountID/:userID — key ownership 403 for a key under a DIFFERENT account's own invoicing prefix (account 1) `

<a id="t0156"></a>**T0156** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) GET /invoices/downloadFile/:accountID/:userID — key ownership 403 for path traversal, a leading slash, a backslash, and a residual (double-encoded) percent `

<a id="t0157"></a>**T0157** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) GET /time-tracking/download/by-name — bare-filename hygiene gap (RESIDUAL finding) rejects a timesheetName containing a backslash `

<a id="t0158"></a>**T0158** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) GET /time-tracking/history/download — syntax validator (RESIDUAL finding) a key that starts with this account's own real prefix but escapes it via ".." is refused (403), never reaches S3 `

<a id="t0159"></a>**T0159** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) GET /time-tracking/history/download — syntax validator (RESIDUAL finding) rejects a backslash and a residual (double-encoded) percent the same way `

<a id="t0160"></a>**T0160** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) Shared tracker template — owner-account-only mutation, non-owner list DELETE /time-tracking/template/delete as a NON-owner super admin (9001) -> 403; nothing removed `

<a id="t0161"></a>**T0161** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) Shared tracker template — owner-account-only mutation, non-owner list POST /time-tracking/template/upload as a NON-owner super admin (9001) -> 403; nothing written `

<a id="t0162"></a>**T0162** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) Shared tracker template — owner-account-only mutation, non-owner list owner-account super admin is unaffected by the new gate (still 400, not 403, for an invalid key) — READ path only, no mutation attempted `

<a id="t0163"></a>**T0163** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) account_company_logo — write-time validation and read-time authorization GET /account/AccountInformation/:accountID/:userID — read-time authorization never fetches, and never leaks, a REAL fetchable object outside the logo prefix (simulated legacy bad data) — no 500 `

<a id="t0164"></a>**T0164** — [test/integration/coverage-downloads-authz.integration.spec.js](../../test/integration/coverage-downloads-authz.integration.spec.js)

` integration: coverage — cross-tenant download authorization (HTTP) account_company_logo — write-time validation and read-time authorization PUT /account/updateAccount — write-time key validation 400: refuses path traversal, a leading slash, a backslash, and a residual percent — nothing is written `

<a id="t0165"></a>**T0165** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) DELETE /invoices/deleteInvoice/:accountID/:invoiceID cleanly deletes a zero-history parent with no linked rows `

<a id="t0166"></a>**T0166** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) DELETE /invoices/deleteInvoice/:accountID/:invoiceID not-found: refuses a bogus invoice id `

<a id="t0167"></a>**T0167** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountAudit/audit/:auditID/:accountID/:userID 404 for an unknown audit id `

<a id="t0168"></a>**T0168** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountAudit/audit/:auditID/:accountID/:userID READ-ONLY: returns a real account-1 audit detail `

<a id="t0169"></a>**T0169** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountAudit/audit/:auditID/pdf/:accountID/:userID 404 for an unknown audit id `

<a id="t0170"></a>**T0170** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountAudit/audit/:auditID/pdf/:accountID/:userID READ-ONLY: returns application/pdf bytes for a real account-1 audit `

<a id="t0171"></a>**T0171** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountAudit/audit/:auditID/pdf/:accountID/:userID returns application/pdf bytes for the audit `

<a id="t0172"></a>**T0172** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountAudit/customer/:customerID/:accountID/:userID returns an empty list for a customer with no audits `

<a id="t0173"></a>**T0173** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountAudit/customers/:accountID/:userID READ-ONLY: lists real customers for account 1 `

<a id="t0174"></a>**T0174** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountAudit/job/:jobId/:accountID/:userID 404 for an unknown job id `

<a id="t0175"></a>**T0175** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountAudit/job/:jobId/:accountID/:userID FIXED (was DEFECT): job results are scoped to the account that created them `

<a id="t0176"></a>**T0176** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountAudit/job/:jobId/:accountID/:userID returns the completed job's results `

<a id="t0177"></a>**T0177** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountsReceivable/aging/:accountID/:userID search narrows the list to the matching customer only `

<a id="t0178"></a>**T0178** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /accountsReceivable/aging/:accountID/:userID/export returns text/csv with a header row and quote-guards custB's name (starts with '=') `

<a id="t0179"></a>**T0179** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /analytics/clientRates/:accountID/:userID returns numeric per-year fields for account 1 (read-only) `

<a id="t0180"></a>**T0180** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /analytics/clientRates/:accountID/:userID/export returns text/csv with a header row and quote-guards custB's name `

<a id="t0181"></a>**T0181** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /analytics/exclusions/:accountID/:userID returns the customer list and default-excluded ids for account 1 (read-only) `

<a id="t0182"></a>**T0182** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /analytics/jobBudgets/:accountID/:userID returns numeric budget fields for account 1 (read-only) `

<a id="t0183"></a>**T0183** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /analytics/taxSeasonCapacity/:accountID/:userID returns numeric capacity fields for account 1 (read-only) `

<a id="t0184"></a>**T0184** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /analytics/timeAllocation/:accountID/:userID returns numeric summary fields for account 1 (read-only) `

<a id="t0185"></a>**T0185** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /analytics/timeAllocation/:accountID/:userID/export returns text/csv with a header row for account 1 `

<a id="t0186"></a>**T0186** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /analytics/wipAging/:accountID/:userID returns numeric aging fields for account 1 (read-only) `

<a id="t0187"></a>**T0187** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /analytics/yearEndPacket/:accountID/:userID returns a zip for account 1 (read-only) `

<a id="t0188"></a>**T0188** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /customer/statement/:accountID/:userID/:customerID returns application/pdf bytes for custA's statement `

<a id="t0189"></a>**T0189** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /customer/statement/:accountID/:userID/:customerID unknown customer id returns a clean error envelope, not a crash `

<a id="t0190"></a>**T0190** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID lists custA's unbilled balance with the engine-computed invoice_total, before it is billed `

<a id="t0191"></a>**T0191** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /invoices/downloadFile/:accountID/:userID 200 streams back the uploaded bytes with the right filename `

<a id="t0192"></a>**T0192** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /invoices/downloadFile/:accountID/:userID 400 for a bogus path that does not exist in S3 `

<a id="t0193"></a>**T0193** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /invoices/downloadFile/:accountID/:userID 400 for a missing fileLocation query param `

<a id="t0194"></a>**T0194** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /invoices/getInvoiceDetails/:invoiceID/:accountID/:userID 404 for an unknown invoice id `

<a id="t0195"></a>**T0195** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /invoices/getInvoiceDetails/:invoiceID/:accountID/:userID returns the transactions billed on custA's freshly finalized parent `

<a id="t0196"></a>**T0196** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /invoices/getInvoices/:accountID/:invoiceID lists the freshly finalized custA invoice, in the grid and tree grid `

<a id="t0197"></a>**T0197** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /invoices/getInvoicesPaginated/:accountID/:userID 400 for invalid pagination (page=0) `

<a id="t0198"></a>**T0198** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) GET /invoices/getInvoicesPaginated/:accountID/:userID search finds the invoice by custA's display name `

<a id="t0199"></a>**T0199** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) POST /accountAudit/run/:accountID/:userID 400 validation failure: no customers selected `

<a id="t0200"></a>**T0200** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) POST /accountAudit/run/:accountID/:userID runs a background job for custA that completes with an audit_balance matching the engine total `

<a id="t0201"></a>**T0201** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) POST /analytics/rateAgreement/:accountID/:userID creates the rate agreement row for custB `

<a id="t0202"></a>**T0202** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) POST /analytics/rateAgreement/:accountID/:userID validation failure: missing customer/year/rate `

<a id="t0203"></a>**T0203** — [test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js](../../test/integration/coverage-invoices-audit-ar-analytics.integration.spec.js)

` integration: coverage — invoices, account audit, accounts receivable, analytics (HTTP) POST /invoices/createInvoice/:accountID/:userID isFinalized creates a parent invoice and stamps the transaction `

<a id="t0204"></a>**T0204** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID cannot delete an account-1 job category even when scoped through the caller's own account/token (row untouched) `

<a id="t0205"></a>**T0205** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID happy path: deletes an unused category `

<a id="t0206"></a>**T0206** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID is blocked while a job type references the category `

<a id="t0207"></a>**T0207** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID returns a clean 404 for a not-found id `

<a id="t0208"></a>**T0208** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID cannot delete an account-1 job type even when scoped through the caller's own account/token (row untouched) `

<a id="t0209"></a>**T0209** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID happy path: deletes an unused job type `

<a id="t0210"></a>**T0210** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID is blocked while a job references the job type `

<a id="t0211"></a>**T0211** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID returns a clean 404 for a not-found id `

<a id="t0212"></a>**T0212** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobs/deleteJob/:jobID/:accountID/:userID checks links across the whole version family, not just the row named in the URL `

<a id="t0213"></a>**T0213** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobs/deleteJob/:jobID/:accountID/:userID happy path: deletes a job family with no linked rows `

<a id="t0214"></a>**T0214** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobs/deleteJob/:jobID/:accountID/:userID is blocked while a payment references the job `

<a id="t0215"></a>**T0215** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobs/deleteJob/:jobID/:accountID/:userID is blocked while a transaction references the job `

<a id="t0216"></a>**T0216** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /jobs/deleteJob/:jobID/:accountID/:userID is blocked while a write-off references the job `

<a id="t0217"></a>**T0217** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /quotes/deleteQuote/:accountID/:quoteID happy path: deletes a quote `

<a id="t0218"></a>**T0218** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /quotes/deleteQuote/:accountID/:quoteID returns a clean 404 for a not-found id `

<a id="t0219"></a>**T0219** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID cannot delete an account-1 work description even when scoped through the caller's own account/token (row untouched) `

<a id="t0220"></a>**T0220** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID happy path: deletes an unused work description `

<a id="t0221"></a>**T0221** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID is blocked while a transaction references the work description `

<a id="t0222"></a>**T0222** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID returns a clean 404 for a not-found id `

<a id="t0223"></a>**T0223** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) GET /jobCategories/getSingleJobCategory/:jobCategoryID/:accountID/:userID happy path: returns the category by id `

<a id="t0224"></a>**T0224** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) GET /jobTypes/getSingleJobType/:jobTypeID/:accountID/:userID happy path: returns the job type by id `

<a id="t0225"></a>**T0225** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) GET /jobs/getActiveCustomerJobs/:accountID/:userID/:customerID happy path: lists the customer's jobs with a computed display_name `

<a id="t0226"></a>**T0226** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) GET /jobs/getSingleJob/:customerJobID/:accountID/:userID happy path: returns the job by id `

<a id="t0227"></a>**T0227** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) GET /quotes/getActiveQuotes/:accountID/:quoteID happy path: lists quotes scoped to the caller's account `

<a id="t0228"></a>**T0228** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) GET /workDescriptions/getSingleWorkDescription/:workDescriptionID/:accountID/:userID happy path: returns the work description by id `

<a id="t0229"></a>**T0229** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) POST /jobCategories/createJobCategory/:accountID/:userID rejects a request with no jobCategory payload `

<a id="t0230"></a>**T0230** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) POST /jobTypes/createJobType/:accountID/:userID rejects a request with no jobType payload `

<a id="t0231"></a>**T0231** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) POST /jobs/createJob/:accountID/:userID rejects a duplicate customer+jobType combination and writes no second row `

<a id="t0232"></a>**T0232** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) POST /quotes/createQuote rejects a request with no quote payload `

<a id="t0233"></a>**T0233** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) POST /workDescriptions/createWorkDescription/:accountID/:userID rejects a request with no workDescription payload `

<a id="t0234"></a>**T0234** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) POST /workDescriptions/createWorkDescription/:accountID/:userID rejects an invalid estimatedTime (NaN, NOT NULL column) and writes no row `

<a id="t0235"></a>**T0235** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /jobCategories/updateJobCategory/:accountID/:userID cannot update an account-1 job category even when scoped through the caller's own account/token (row untouched) `

<a id="t0236"></a>**T0236** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /jobCategories/updateJobCategory/:accountID/:userID happy path: renames a category `

<a id="t0237"></a>**T0237** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /jobCategories/updateJobCategory/:accountID/:userID rejects a request with no jobCategory payload `

<a id="t0238"></a>**T0238** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /jobCategories/updateJobCategory/:accountID/:userID returns a clean 404 for a not-found id (0 rows affected) `

<a id="t0239"></a>**T0239** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /jobTypes/updateJobType/:accountID/:userID cannot update an account-1 job type even when scoped through the caller's own account/token (row untouched) `

<a id="t0240"></a>**T0240** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /jobTypes/updateJobType/:accountID/:userID happy path: updates job type fields `

<a id="t0241"></a>**T0241** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /jobTypes/updateJobType/:accountID/:userID rejects a request with no jobType payload `

<a id="t0242"></a>**T0242** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /jobTypes/updateJobType/:accountID/:userID returns a clean 404 for a not-found id (0 rows affected) `

<a id="t0243"></a>**T0243** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /jobs/updateJob/:accountID/:userID happy path: updates job fields and toggles is_job_complete `

<a id="t0244"></a>**T0244** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /jobs/updateJob/:accountID/:userID refuses reassigning a job to a different customer while a transaction is linked to it `

<a id="t0245"></a>**T0245** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /quotes/updateQuote happy path: updates quote fields `

<a id="t0246"></a>**T0246** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /quotes/updateQuote rejects a request with no quote payload `

<a id="t0247"></a>**T0247** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /quotes/updateQuote returns a clean 404 for a not-found id (0 rows affected) `

<a id="t0248"></a>**T0248** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /workDescriptions/updateWorkDescription/:accountID/:userID cannot update an account-1 work description even when scoped through the caller's own account/token (row untouched) `

<a id="t0249"></a>**T0249** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /workDescriptions/updateWorkDescription/:accountID/:userID happy path: updates work description fields `

<a id="t0250"></a>**T0250** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /workDescriptions/updateWorkDescription/:accountID/:userID rejects a request with no workDescription payload `

<a id="t0251"></a>**T0251** — [test/integration/coverage-jobs-masterdata.integration.spec.js](../../test/integration/coverage-jobs-masterdata.integration.spec.js)

` Jobs / master-data HTTP route coverage (job, jobCategories, jobTypes, workDescriptions, quotes) PUT /workDescriptions/updateWorkDescription/:accountID/:userID returns a clean 404 for a not-found id (0 rows affected) `

<a id="t0252"></a>**T0252** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) DELETE /payments/deletePayment/:accountID/:userID happy path: round trip — deleting a payment restores the parent exactly `

<a id="t0253"></a>**T0253** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) DELETE /pending-payments/file/:accountID/:userID FIXED (was DEFECT, review/full-audit-2026-09 finding 3): a fileName with no rows for this account is now refused with HTTP 404, not silently "succeeded" `

<a id="t0254"></a>**T0254** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) DELETE /pending-payments/file/:accountID/:userID domain edge: refused once any payment from the file has been processed `

<a id="t0255"></a>**T0255** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) DELETE /pending-payments/file/:accountID/:userID happy path: removes unprocessed pending rows for the file and the S3 object `

<a id="t0256"></a>**T0256** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) DELETE /pending-payments/file/:accountID/:userID validation failure: a missing fileName is refused with HTTP 400 `

<a id="t0257"></a>**T0257** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /payments/getPayments/:accountID/:userID domain edge: the page-size cap holds even for a very large requested limit `

<a id="t0258"></a>**T0258** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /payments/getPayments/:accountID/:userID validation failure: a non-positive limit is refused with HTTP 400 `

<a id="t0259"></a>**T0259** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /payments/getSinglePayment/:paymentID/:accountID/:userID happy path: returns the payment row `

<a id="t0260"></a>**T0260** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /pending-payments/counts/:accountID/:userID happy path: counts reflect new/processed/all as rows change `

<a id="t0261"></a>**T0261** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /pending-payments/file-preview/:accountID/:userID happy path: streams back the exact bytes that were uploaded `

<a id="t0262"></a>**T0262** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /pending-payments/file-preview/:accountID/:userID not-found: a nonexistent file name is refused with HTTP 404 `

<a id="t0263"></a>**T0263** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /pending-payments/file-preview/:accountID/:userID validation failure: a missing fileName is refused with HTTP 400 `

<a id="t0264"></a>**T0264** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /pending-payments/files/:accountID/:userID domain edge: a soft-deleted row is excluded from every file group `

<a id="t0265"></a>**T0265** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /pending-payments/list/:accountID/:userID domain edge: a hostile search string is a literal filter, not SQL `

<a id="t0266"></a>**T0266** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /pending-payments/list/:accountID/:userID validation failure: invalid pagination is refused with HTTP 400 (same contract as GET /payments/getPayments) `

<a id="t0267"></a>**T0267** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /pending-payments/single/:paymentID/:accountID/:userID happy path: returns the pending payment row `

<a id="t0268"></a>**T0268** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /pending-payments/single/:paymentID/:accountID/:userID not-found: a nonexistent payment id is refused with HTTP 404 (same as the atomic approve route below) `

<a id="t0269"></a>**T0269** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) GET /pending-payments/single/:paymentID/:accountID/:userID validation failure: a non-numeric payment id is refused as not-found (HTTP 404), without leaking SQL `

<a id="t0270"></a>**T0270** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /payments/createPayment/:accountID/:userID domain edge: no invoice and no holdAsPrepayment is refused; holdAsPrepayment banks a Prepayment retainer instead `

<a id="t0271"></a>**T0271** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /payments/reversePayment/:accountID/:userID domain edge: reversing twice, or reversing a reversal, is refused `

<a id="t0272"></a>**T0272** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /payments/reversePayment/:accountID/:userID happy path: creates a positive payment row and un-pays the parent `

<a id="t0273"></a>**T0273** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /payments/reversePayment/:accountID/:userID validation failure: a missing reason is refused `

<a id="t0274"></a>**T0274** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /pending-payments/approve/:accountID/:userID domain edge: a second approve of the same pending row is refused with HTTP 409 `

<a id="t0275"></a>**T0275** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /pending-payments/approve/:accountID/:userID domain edge: two simultaneous approvals of one pending row post exactly one payment `

<a id="t0276"></a>**T0276** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /pending-payments/approve/:accountID/:userID not-found: a nonexistent pendingPaymentId is refused with HTTP 404 `

<a id="t0277"></a>**T0277** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /pending-payments/approve/:accountID/:userID validation failure: a missing payment object is refused with HTTP 400 `

<a id="t0278"></a>**T0278** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /pending-payments/approve/:accountID/:userID validation failure: a missing pendingPaymentId is refused with HTTP 400 `

<a id="t0279"></a>**T0279** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /pending-payments/upload/:accountID/:userID FIXED (was DEFECT, review/full-audit-2026-09 finding 3): account 9001 is refused with HTTP 403 before any S3 write `

<a id="t0280"></a>**T0280** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /pending-payments/upload/:accountID/:userID validation failure: a file over the 10MB cap is refused with HTTP 400 `

<a id="t0281"></a>**T0281** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /pending-payments/upload/:accountID/:userID validation failure: a missing x-file-name header is refused with HTTP 400 `

<a id="t0282"></a>**T0282** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /pending-payments/upload/:accountID/:userID validation failure: a non-.pdf extension is refused with HTTP 400 `

<a id="t0283"></a>**T0283** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) POST /pending-payments/upload/:accountID/:userID validation failure: an empty body is refused with HTTP 400 `

<a id="t0284"></a>**T0284** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) PUT /payments/updatePayment/:accountID/:userID 401 / 403 `

<a id="t0285"></a>**T0285** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) PUT /payments/updatePayment/:accountID/:userID domain edge: moving a payment to a different invoice is not supported `

<a id="t0286"></a>**T0286** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) PUT /payments/updatePayment/:accountID/:userID domain edge: refused once a newer payment exists on the chain `

<a id="t0287"></a>**T0287** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) PUT /payments/updatePayment/:accountID/:userID domain edge: refused once the payment is billed (a newer statement exists) `

<a id="t0288"></a>**T0288** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) PUT /payments/updatePayment/:accountID/:userID happy path: re-prices the latest snapshot and the parent mirror `

<a id="t0289"></a>**T0289** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) PUT /pending-payments/approve/:paymentID/:accountID/:userID (A6: retired) always answers 410 and never marks a real, unprocessed row processed `

<a id="t0290"></a>**T0290** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) PUT /pending-payments/approve/:paymentID/:accountID/:userID (A6: retired) answers 410 even for an already-processed row — it no longer performs (or refuses) an approval, just refuses to run `

<a id="t0291"></a>**T0291** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) PUT /pending-payments/soft-delete/:paymentID/:accountID/:userID domain edge: soft-deleting an already-deleted row is refused `

<a id="t0292"></a>**T0292** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) PUT /pending-payments/soft-delete/:paymentID/:accountID/:userID not-found: a nonexistent (or malformed) payment id is refused with HTTP 404 `

<a id="t0293"></a>**T0293** — [test/integration/coverage-payments-pending.integration.spec.js](../../test/integration/coverage-payments-pending.integration.spec.js)

` integration: coverage — payments & pending payments (HTTP) PUT /pending-payments/soft-delete/:paymentID/:accountID/:userID validation failure: soft-deleting an already-processed row is refused `

<a id="t0294"></a>**T0294** — [test/integration/coverage-pending-payments-authz.integration.spec.js](../../test/integration/coverage-pending-payments-authz.integration.spec.js)

` integration: coverage — pendingPayments S3 authorization (HTTP) DELETE /pending-payments/file/:accountID/:userID 400: filename hygiene rejects traversal, a backslash, an embedded slash, and a residual percent `

<a id="t0295"></a>**T0295** — [test/integration/coverage-pending-payments-authz.integration.spec.js](../../test/integration/coverage-pending-payments-authz.integration.spec.js)

` integration: coverage — pendingPayments S3 authorization (HTTP) DELETE /pending-payments/file/:accountID/:userID 404: a REAL, fetchable object with no owning row for this account is refused — the object is left untouched `

<a id="t0296"></a>**T0296** — [test/integration/coverage-pending-payments-authz.integration.spec.js](../../test/integration/coverage-pending-payments-authz.integration.spec.js)

` integration: coverage — pendingPayments S3 authorization (HTTP) GET /pending-payments/file-preview/:accountID/:userID 400: filename hygiene rejects traversal, a backslash, an embedded slash, and a residual percent `

<a id="t0297"></a>**T0297** — [test/integration/coverage-pending-payments-authz.integration.spec.js](../../test/integration/coverage-pending-payments-authz.integration.spec.js)

` integration: coverage — pendingPayments S3 authorization (HTTP) GET /pending-payments/file-preview/:accountID/:userID 404: a REAL, fetchable object with no owning row for this account is never streamed back `

<a id="t0298"></a>**T0298** — [test/integration/coverage-pending-payments-authz.integration.spec.js](../../test/integration/coverage-pending-payments-authz.integration.spec.js)

` integration: coverage — pendingPayments S3 authorization (HTTP) POST /pending-payments/upload/:accountID/:userID 400: filename hygiene rejects traversal, a leading slash, a backslash, an embedded slash, and a residual percent (account 9001 — hygiene runs before the account gate) `

<a id="t0299"></a>**T0299** — [test/integration/coverage-pending-payments-authz.integration.spec.js](../../test/integration/coverage-pending-payments-authz.integration.spec.js)

` integration: coverage — pendingPayments S3 authorization (HTTP) POST /pending-payments/upload/:accountID/:userID 403: a non-owner account (9001) is refused before any S3 write, even with an otherwise perfectly valid request `

<a id="t0300"></a>**T0300** — [test/integration/coverage-pending-payments-authz.integration.spec.js](../../test/integration/coverage-pending-payments-authz.integration.spec.js)

` integration: coverage — pendingPayments S3 authorization (HTTP) POST /pending-payments/upload/:accountID/:userID FINDING 6: the owner account (1) — a valid PDF upload actually succeeds, with exact bytes/key/metadata, cleaned up immediately after `

<a id="t0301"></a>**T0301** — [test/integration/coverage-pending-payments-authz.integration.spec.js](../../test/integration/coverage-pending-payments-authz.integration.spec.js)

` integration: coverage — pendingPayments S3 authorization (HTTP) POST /pending-payments/upload/:accountID/:userID the owner account (1) is unaffected by the new gate — still 400, not 403, for an invalid extension; no real upload is attempted `

<a id="t0302"></a>**T0302** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) DELETE /time-tracking/template/delete/:accountID/:userID an account admin (not super admin) cannot delete a firm-wide template version `

<a id="t0303"></a>**T0303** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) DELETE /time-tracking/template/delete/:accountID/:userID refuses bad requests without deleting anything: no key / outside tracker_versions / the folder / a non-template name -> 400; employee -> 403 `

<a id="t0304"></a>**T0304** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) DELETE /time-tracking/template/delete/:accountID/:userID super admin deletes the uploaded version: 204, gone from S3 and the list, and the original is the latest template again `

<a id="t0305"></a>**T0305** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID admin soft-deletes an unprocessed entry: 200, is_deleted, gone from the pending queues and counts `

<a id="t0306"></a>**T0306** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID an unknown entry id -> 404 `

<a id="t0307"></a>**T0307** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID another tenant’s entry id is refused and the account-1 row is untouched `

<a id="t0308"></a>**T0308** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/download/by-name/:accountID/:userID employee: own tracker -> 200; another owner’s tracker -> 403 `

<a id="t0309"></a>**T0309** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/download/by-name/:accountID/:userID missing params -> 400; a path-like name -> 400; unknown name -> 404; owner outside the account -> 404 `

<a id="t0310"></a>**T0310** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/history/:accountID/:userID employee (self) sees their own list; another owner’s history -> 403 `

<a id="t0311"></a>**T0311** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/history/:accountID/:userID unknown owner -> 404 `

<a id="t0312"></a>**T0312** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/history/download/:accountID/:userID a key inside the owner’s folder that does not exist -> 404 `

<a id="t0313"></a>**T0313** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/history/download/:accountID/:userID employee downloads their own tracker `

<a id="t0314"></a>**T0314** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/history/download/:accountID/:userID missing key -> 400; a key outside the owner’s folder (another employee’s tracker, the template) -> 403 `

<a id="t0315"></a>**T0315** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/template/latest/:accountID/:userID a template-builder failure for a non-owner account returns 503 and never falls back to the shared bytes `

<a id="t0316"></a>**T0316** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/template/latest/:accountID/:userID flag off (default), OWNER account: the stored latest template is served unchanged `

<a id="t0317"></a>**T0317** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/template/list/:accountID/:userID a manager addressing an ADMIN's URL id cannot borrow that admin's role (403) `

<a id="t0318"></a>**T0318** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/template/list/:accountID/:userID a non-owner account (9001 admin) gets an empty list, never the owner's raw keys or slug `

<a id="t0319"></a>**T0319** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/users/:accountID/:userID employee (self): only their own row `

<a id="t0320"></a>**T0320** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /time-tracking/users/:accountID/:userID unknown :userID, or a user of another tenant -> 404 `

<a id="t0321"></a>**T0321** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /timesheets/countsByEmployee/:accountID/:userID admin: one row per active user with pending-entry / tracker / AI-status counts that match the tables `

<a id="t0322"></a>**T0322** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /timesheets/fetchTimesheetsByMonth/:queryUserID/:accountID/:userID admin: only trackers whose window lies inside the CURRENT month (T1 yes, last month’s T2 no) `

<a id="t0323"></a>**T0323** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /timesheets/getAllTimesheetsForEmployeeByUserID/:queryUserID/:accountID/:userID employee may list their own trackers `

<a id="t0324"></a>**T0324** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /timesheets/getTimesheetEntries/:accountID/:userID invalid pagination (page=0) -> 400 `

<a id="t0325"></a>**T0325** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /timesheets/getTimesheetEntries/:accountID/:userID pagination: page 2 of limit 1 returns one row; a huge limit is capped at 500 `

<a id="t0326"></a>**T0326** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) GET /timesheets/getTimesheetEntriesByUserID/:queryUserID/:accountID/:userID employee may read their own queue; an unknown employee is an empty page `

<a id="t0327"></a>**T0327** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) POST /time-tracking/template/upload/:accountID/:userID missing x-file-name -> 400; a file over 1 MB -> 400 `

<a id="t0328"></a>**T0328** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) POST /timesheets/ai/kickoff/:accountID/:userID an admin can kick off an employee’s tracker by timesheet_name `

<a id="t0329"></a>**T0329** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) POST /timesheets/ai/kickoff/:accountID/:userID an employee cannot kick off another employee's tracker by entry_ids (403), and nothing is processed `

<a id="t0330"></a>**T0330** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) POST /timesheets/ai/kickoff/:accountID/:userID an employee cannot kick off another employee's tracker by timesheet_name (403), and nothing is processed `

<a id="t0331"></a>**T0331** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) POST /timesheets/ai/kickoff/:accountID/:userID flag off -> 503 and nothing is processed; no timesheet_name / entry_ids -> 400 `

<a id="t0332"></a>**T0332** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

`` time-tracking + timesheets routes: HTTP coverage (account 9001) POST /timesheets/moveToTransactions/:accountID/:userID a body without `entry` -> 400 ``

<a id="t0333"></a>**T0333** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) POST /timesheets/moveToTransactions/:accountID/:userID another tenant's general_work_description_id -> 400, nothing written `

<a id="t0334"></a>**T0334** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) POST /timesheets/moveToTransactions/:accountID/:userID another tenant’s entry id -> 409; nothing is written and the account-1 row is untouched `

<a id="t0335"></a>**T0335** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) POST /timesheets/moveToTransactions/:accountID/:userID invalid or missing timesheetEntryID -> 400 `

<a id="t0336"></a>**T0336** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) POST /timesheets/moveToTransactions/:accountID/:userID loggedByUserID is the authenticated caller, never a client-supplied value `

<a id="t0337"></a>**T0337** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) legacy tracker ownership is durable, not name-derived (Astra round 13) a deleted employee's owned file is not transferred to a later employee created with the same name `

<a id="t0338"></a>**T0338** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) tracker duplicate detection after a delete (C9) a PROCESSED row that also carries is_deleted=true (legacy data shape) still blocks a duplicate re-upload `

<a id="t0339"></a>**T0339** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) tracker key ownership is structural (Astra round 11) refuses a key in another account's folder even when its file name is one this owner recorded `

<a id="t0340"></a>**T0340** — [test/integration/coverage-timetracking-timesheets.integration.spec.js](../../test/integration/coverage-timetracking-timesheets.integration.spec.js)

` time-tracking + timesheets routes: HTTP coverage (account 9001) tracker key ownership is structural (Astra round 11) refuses keys of unexpected depth, and a bare file directly under the processed root `

<a id="t0341"></a>**T0341** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage DELETE /retainers/deleteRetainer/:retainerID/:accountID/:userID happy path: deletes an unused retainer `

<a id="t0342"></a>**T0342** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage DELETE /transactions/deleteTransaction/:accountID/:userID a billed transaction (customer_invoice_id set directly) cannot be deleted `

<a id="t0343"></a>**T0343** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage DELETE /transactions/deleteTransaction/:accountID/:userID happy path: deletes the row and decrements the job total `

<a id="t0344"></a>**T0344** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage DELETE /writeOffs/deleteWriteOffs/:accountID/:userID a billed write-off cannot be deleted `

<a id="t0345"></a>**T0345** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage DELETE /writeOffs/deleteWriteOffs/:accountID/:userID happy path: symmetric delete removes the snapshot and restores the parent remaining `

<a id="t0346"></a>**T0346** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /retainers/getActiveRetainers/:customerID/:accountID/:userID happy path: lists a live retainer for the customer `

<a id="t0347"></a>**T0347** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /retainers/getSingleRetainer/:retainerID/:accountID/:userID happy path: returns the retainer `

<a id="t0348"></a>**T0348** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /retainers/getSingleRetainer/:retainerID/:accountID/:userID not-found: a malformed retainer id is refused before any SQL runs (no driver text leaks) `

<a id="t0349"></a>**T0349** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /transactions/exportTransactions/:accountID/:userID search containing quotes, semicolons and -- returns a clean CSV (no 500) `

<a id="t0350"></a>**T0350** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /transactions/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID not-found-equivalent: a date range with nothing logged still returns 200 with a zeroed roster `

<a id="t0351"></a>**T0351** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /transactions/getSingleTransaction/:customerID/:transactionID/:accountID/:userID happy path: returns the transaction `

<a id="t0352"></a>**T0352** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /transactions/getTransactions/:accountID/:userID pagination: a limit over 500 is capped at 500 `

<a id="t0353"></a>**T0353** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /transactions/getTransactions/:accountID/:userID validation failure: a non-positive limit is refused with HTTP 400 `

<a id="t0354"></a>**T0354** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID happy path: returns the write-off `

<a id="t0355"></a>**T0355** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID not-found: a malformed write-off id is refused before any SQL runs (no driver text leaks) `

<a id="t0356"></a>**T0356** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /writeOffs/getWriteOffs/:accountID/:userID pagination: a limit over 500 is capped at 500 `

<a id="t0357"></a>**T0357** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage GET /writeOffs/getWriteOffs/:accountID/:userID validation failure: a non-positive limit is refused with HTTP 400 `

<a id="t0358"></a>**T0358** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage POST /retainers/createRetainer/:accountID/:userID happy path: stores starting_amount and current_amount NEGATIVE from a positive unitCost `

<a id="t0359"></a>**T0359** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage POST /transactions/createTransaction/:accountID/:userID validation failure: an unrecognized transaction_type is refused `

<a id="t0360"></a>**T0360** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage POST /writeOffs/createWriteOffs/:accountID/:userID not-found: a nonexistent invoice id is refused `

<a id="t0361"></a>**T0361** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage PUT /retainers/updateRetainer/:accountID/:userID happy path: re-prices the whole chain by the starting-amount delta and keeps draw-down history `

<a id="t0362"></a>**T0362** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage PUT /transactions/updateTransaction/:accountID/:userID a billed transaction (customer_invoice_id set directly) cannot be updated, and the link cannot be cleared `

<a id="t0363"></a>**T0363** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage PUT /transactions/updateTransaction/:accountID/:userID cross-customer job refused on update too `

<a id="t0364"></a>**T0364** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage PUT /transactions/updateTransaction/:accountID/:userID happy path: updates fields and the DB reflects the new values `

<a id="t0365"></a>**T0365** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage PUT /writeOffs/updateWriteOffs/:accountID/:userID a billed write-off is immutable `

<a id="t0366"></a>**T0366** — [test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js](../../test/integration/coverage-transactions-retainers-writeoffs.integration.spec.js)

` integration: transactions / retainers / write-offs route coverage PUT /writeOffs/updateWriteOffs/:accountID/:userID happy path: updating an unbilled invoice-linked write-off re-prices its snapshot and the parent mirror `

<a id="t0367"></a>**T0367** — [test/integration/finalize-snapshot.integration.spec.js](../../test/integration/finalize-snapshot.integration.spec.js)

` integration: finalize snapshot + fingerprint + locked delete guards (round-3 B1/B3) B3. deleteInvoice repeats its history guards under the customer lock a statement absorbed by a finalize that commits while the delete waits for the lock is refused, not deleted `

<a id="t0368"></a>**T0368** — [test/integration/month-end-lifecycle.integration.spec.js](../../test/integration/month-end-lifecycle.integration.spec.js)

` integration: month-end ledger lifecycle (HTTP) 1. creates a customer with a mailing address and a job for it `

<a id="t0369"></a>**T0369** — [test/integration/orchestrator.integration.spec.js](../../test/integration/orchestrator.integration.spec.js)

` integration: auto-ingest orchestrator (prod-layout trackers, stubbed Bedrock + Comprehend) mixed tracker: ambiguous customers, missing jobs, vague notes and non-work rows are handled per row `

<a id="t0370"></a>**T0370** — [test/integration/orchestrator.integration.spec.js](../../test/integration/orchestrator.integration.spec.js)

` integration: auto-ingest orchestrator (prod-layout trackers, stubbed Bedrock + Comprehend) the is_processed claim guard skips (never double-inserts or downgrades) an entry processed after it was read `

<a id="t0371"></a>**T0371** — [test/integration/orchestrator.integration.spec.js](../../test/integration/orchestrator.integration.spec.js)

` integration: auto-ingest orchestrator (prod-layout trackers, stubbed Bedrock + Comprehend) two concurrent orchestrator runs over the same entries insert each transaction exactly once `

<a id="t0372"></a>**T0372** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts ALL /ai-integration/* | absent session: 401 envelope and no writes `

<a id="t0373"></a>**T0373** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /customer/deleteCustomer/:customerID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0374"></a>**T0374** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /customer/deleteCustomer/:customerID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0375"></a>**T0375** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /customer/deleteCustomer/:customerID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0376"></a>**T0376** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /invoices/deleteInvoice/:accountID/:invoiceID | absent session: 401 envelope and no writes `

<a id="t0377"></a>**T0377** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /invoices/deleteInvoice/:accountID/:invoiceID | foreign URL account: 403 envelope and no writes `

<a id="t0378"></a>**T0378** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /invoices/deleteInvoice/:accountID/:invoiceID | staff role: 403 envelope and no writes `

<a id="t0379"></a>**T0379** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0380"></a>**T0380** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0381"></a>**T0381** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /jobCategories/deleteJobCategory/:jobCategoryID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0382"></a>**T0382** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0383"></a>**T0383** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0384"></a>**T0384** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /jobTypes/deleteJobType/:jobTypeID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0385"></a>**T0385** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /jobs/deleteJob/:jobID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0386"></a>**T0386** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /jobs/deleteJob/:jobID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0387"></a>**T0387** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /jobs/deleteJob/:jobID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0388"></a>**T0388** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /payments/deletePayment/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0389"></a>**T0389** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /payments/deletePayment/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0390"></a>**T0390** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /payments/deletePayment/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0391"></a>**T0391** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /pending-payments/file/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0392"></a>**T0392** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /pending-payments/file/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0393"></a>**T0393** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /pending-payments/file/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0394"></a>**T0394** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /quotes/deleteQuote/:accountID/:quoteID | absent session: 401 envelope and no writes `

<a id="t0395"></a>**T0395** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /quotes/deleteQuote/:accountID/:quoteID | foreign URL account: 403 envelope and no writes `

<a id="t0396"></a>**T0396** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /quotes/deleteQuote/:accountID/:quoteID | staff role: 403 envelope and no writes `

<a id="t0397"></a>**T0397** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /recurringCustomer/deleteRecurringCustomer/:accountID/:recurringCustomerId | absent session: 401 envelope and no writes `

<a id="t0398"></a>**T0398** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /recurringCustomer/deleteRecurringCustomer/:accountID/:recurringCustomerId | foreign URL account: 403 envelope and no writes `

<a id="t0399"></a>**T0399** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /recurringCustomer/deleteRecurringCustomer/:accountID/:recurringCustomerId | staff role: 403 envelope and no writes `

<a id="t0400"></a>**T0400** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /retainers/deleteRetainer/:retainerID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0401"></a>**T0401** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /retainers/deleteRetainer/:retainerID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0402"></a>**T0402** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /retainers/deleteRetainer/:retainerID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0403"></a>**T0403** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /time-tracker-staff/:accountID/:userID/:staffID | absent session: 401 envelope and no writes `

<a id="t0404"></a>**T0404** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /time-tracker-staff/:accountID/:userID/:staffID | foreign URL account: 403 envelope and no writes `

<a id="t0405"></a>**T0405** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /time-tracker-staff/:accountID/:userID/:staffID | staff role: 403 envelope and no writes `

<a id="t0406"></a>**T0406** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /time-tracking/template/delete/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0407"></a>**T0407** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /time-tracking/template/delete/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0408"></a>**T0408** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /time-tracking/template/delete/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0409"></a>**T0409** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0410"></a>**T0410** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0411"></a>**T0411** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0412"></a>**T0412** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /transactions/deleteTransaction/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0413"></a>**T0413** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /transactions/deleteTransaction/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0414"></a>**T0414** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /transactions/deleteTransaction/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0415"></a>**T0415** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /user/deleteUser/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0416"></a>**T0416** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /user/deleteUser/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0417"></a>**T0417** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /user/deleteUser/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0418"></a>**T0418** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0419"></a>**T0419** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0420"></a>**T0420** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /workDescriptions/deleteWorkDescription/:workDescriptionID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0421"></a>**T0421** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /writeOffs/deleteWriteOffs/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0422"></a>**T0422** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /writeOffs/deleteWriteOffs/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0423"></a>**T0423** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts DELETE /writeOffs/deleteWriteOffs/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0424"></a>**T0424** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /account/AccountInformation/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0425"></a>**T0425** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /account/AccountInformation/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0426"></a>**T0426** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /account/AccountInformation/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0427"></a>**T0427** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /account/automations/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0428"></a>**T0428** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /account/automations/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0429"></a>**T0429** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /account/automations/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0430"></a>**T0430** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/audit/:auditID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0431"></a>**T0431** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/audit/:auditID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0432"></a>**T0432** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/audit/:auditID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0433"></a>**T0433** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/audit/:auditID/pdf/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0434"></a>**T0434** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/audit/:auditID/pdf/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0435"></a>**T0435** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/audit/:auditID/pdf/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0436"></a>**T0436** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/customer/:customerID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0437"></a>**T0437** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/customer/:customerID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0438"></a>**T0438** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/customer/:customerID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0439"></a>**T0439** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/customers/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0440"></a>**T0440** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/customers/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0441"></a>**T0441** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/customers/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0442"></a>**T0442** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/job/:jobId/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0443"></a>**T0443** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/job/:jobId/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0444"></a>**T0444** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/job/:jobId/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0445"></a>**T0445** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/whoami/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0446"></a>**T0446** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/whoami/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0447"></a>**T0447** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountAudit/whoami/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0448"></a>**T0448** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountsReceivable/aging/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0449"></a>**T0449** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountsReceivable/aging/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0450"></a>**T0450** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountsReceivable/aging/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0451"></a>**T0451** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountsReceivable/aging/:accountID/:userID/export | absent session: 401 envelope and no writes `

<a id="t0452"></a>**T0452** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountsReceivable/aging/:accountID/:userID/export | foreign URL account: 403 envelope and no writes `

<a id="t0453"></a>**T0453** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /accountsReceivable/aging/:accountID/:userID/export | staff role: 403 envelope and no writes `

<a id="t0454"></a>**T0454** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/clientRates/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0455"></a>**T0455** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/clientRates/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0456"></a>**T0456** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/clientRates/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0457"></a>**T0457** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/clientRates/:accountID/:userID/export | absent session: 401 envelope and no writes `

<a id="t0458"></a>**T0458** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/clientRates/:accountID/:userID/export | foreign URL account: 403 envelope and no writes `

<a id="t0459"></a>**T0459** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/clientRates/:accountID/:userID/export | staff role: 403 envelope and no writes `

<a id="t0460"></a>**T0460** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/exclusions/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0461"></a>**T0461** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/exclusions/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0462"></a>**T0462** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/exclusions/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0463"></a>**T0463** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/jobBudgets/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0464"></a>**T0464** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/jobBudgets/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0465"></a>**T0465** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/jobBudgets/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0466"></a>**T0466** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/taxSeasonCapacity/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0467"></a>**T0467** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/taxSeasonCapacity/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0468"></a>**T0468** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/taxSeasonCapacity/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0469"></a>**T0469** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/timeAllocation/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0470"></a>**T0470** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/timeAllocation/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0471"></a>**T0471** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/timeAllocation/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0472"></a>**T0472** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/timeAllocation/:accountID/:userID/export | absent session: 401 envelope and no writes `

<a id="t0473"></a>**T0473** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/timeAllocation/:accountID/:userID/export | foreign URL account: 403 envelope and no writes `

<a id="t0474"></a>**T0474** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/timeAllocation/:accountID/:userID/export | staff role: 403 envelope and no writes `

<a id="t0475"></a>**T0475** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/wipAging/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0476"></a>**T0476** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/wipAging/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0477"></a>**T0477** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/wipAging/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0478"></a>**T0478** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/yearEndPacket/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0479"></a>**T0479** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/yearEndPacket/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0480"></a>**T0480** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /analytics/yearEndPacket/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0481"></a>**T0481** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0482"></a>**T0482** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0483"></a>**T0483** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0484"></a>**T0484** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records | absent session: 401 envelope and no writes `

<a id="t0485"></a>**T0485** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records | foreign URL account: 403 envelope and no writes `

<a id="t0486"></a>**T0486** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records | staff role: 403 envelope and no writes `

<a id="t0487"></a>**T0487** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/evidence | absent session: 401 envelope and no writes `

<a id="t0488"></a>**T0488** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/evidence | foreign URL account: 403 envelope and no writes `

<a id="t0489"></a>**T0489** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/evidence | staff role: 403 envelope and no writes `

<a id="t0490"></a>**T0490** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/pdf | absent session: 401 envelope and no writes `

<a id="t0491"></a>**T0491** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/pdf | foreign URL account: 403 envelope and no writes `

<a id="t0492"></a>**T0492** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/pdf | staff role: 403 envelope and no writes `

<a id="t0493"></a>**T0493** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/verify | absent session: 401 envelope and no writes `

<a id="t0494"></a>**T0494** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/verify | foreign URL account: 403 envelope and no writes `

<a id="t0495"></a>**T0495** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/records/:recordID/verify | staff role: 403 envelope and no writes `

<a id="t0496"></a>**T0496** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/verify | absent session: 401 envelope and no writes `

<a id="t0497"></a>**T0497** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/verify | foreign URL account: 403 envelope and no writes `

<a id="t0498"></a>**T0498** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /auditRecord/customer/:customerID/:accountID/:userID/verify | staff role: 403 envelope and no writes `

<a id="t0499"></a>**T0499** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/distinct-entities/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0500"></a>**T0500** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/distinct-entities/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0501"></a>**T0501** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/distinct-entities/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0502"></a>**T0502** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/earliest-unbilled-month/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0503"></a>**T0503** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/earliest-unbilled-month/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0504"></a>**T0504** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/earliest-unbilled-month/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0505"></a>**T0505** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/pending/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0506"></a>**T0506** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/pending/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0507"></a>**T0507** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/pending/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0508"></a>**T0508** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/pre-invoice/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0509"></a>**T0509** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/pre-invoice/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0510"></a>**T0510** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/pre-invoice/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0511"></a>**T0511** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/reprocess-count/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0512"></a>**T0512** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/reprocess-count/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0513"></a>**T0513** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/reprocess-count/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0514"></a>**T0514** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/weekly/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0515"></a>**T0515** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/weekly/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0516"></a>**T0516** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /billing-review/weekly/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0517"></a>**T0517** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /customer/activeCustomers/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0518"></a>**T0518** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /customer/activeCustomers/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0519"></a>**T0519** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /customer/activeCustomers/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0520"></a>**T0520** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /customer/activeCustomers/customerByID/:accountID/:userID/:customerID | absent session: 401 envelope and no writes `

<a id="t0521"></a>**T0521** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /customer/activeCustomers/customerByID/:accountID/:userID/:customerID | foreign URL account: 403 envelope and no writes `

<a id="t0522"></a>**T0522** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /customer/activeCustomers/customerByID/:accountID/:userID/:customerID | staff role: 403 envelope and no writes `

<a id="t0523"></a>**T0523** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /customer/statement/:accountID/:userID/:customerID | absent session: 401 envelope and no writes `

<a id="t0524"></a>**T0524** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /customer/statement/:accountID/:userID/:customerID | foreign URL account: 403 envelope and no writes `

<a id="t0525"></a>**T0525** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /customer/statement/:accountID/:userID/:customerID | staff role: 403 envelope and no writes `

<a id="t0526"></a>**T0526** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /duplicates/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0527"></a>**T0527** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /duplicates/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0528"></a>**T0528** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /duplicates/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0529"></a>**T0529** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /initialData/initialBlob/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0530"></a>**T0530** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /initialData/initialBlob/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0531"></a>**T0531** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/:invoiceID/history/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0532"></a>**T0532** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/:invoiceID/history/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0533"></a>**T0533** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/:invoiceID/history/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0534"></a>**T0534** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID | absent session: 401 envelope and no writes `

<a id="t0535"></a>**T0535** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID | foreign URL account: 403 envelope and no writes `

<a id="t0536"></a>**T0536** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/createInvoice/AccountsWithBalance/:accountID/:invoiceID | staff role: 403 envelope and no writes `

<a id="t0537"></a>**T0537** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/downloadFile/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0538"></a>**T0538** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/downloadFile/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0539"></a>**T0539** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/downloadFile/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0540"></a>**T0540** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/getInvoiceDetails/:invoiceID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0541"></a>**T0541** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/getInvoiceDetails/:invoiceID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0542"></a>**T0542** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/getInvoiceDetails/:invoiceID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0543"></a>**T0543** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/getInvoices/:accountID/:invoiceID | absent session: 401 envelope and no writes `

<a id="t0544"></a>**T0544** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/getInvoices/:accountID/:invoiceID | foreign URL account: 403 envelope and no writes `

<a id="t0545"></a>**T0545** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/getInvoices/:accountID/:invoiceID | staff role: 403 envelope and no writes `

<a id="t0546"></a>**T0546** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/getInvoicesPaginated/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0547"></a>**T0547** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/getInvoicesPaginated/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0548"></a>**T0548** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /invoices/getInvoicesPaginated/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0549"></a>**T0549** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobCategories/getSingleJobCategory/:jobCategoryID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0550"></a>**T0550** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobCategories/getSingleJobCategory/:jobCategoryID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0551"></a>**T0551** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobCategories/getSingleJobCategory/:jobCategoryID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0552"></a>**T0552** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobTypes/getSingleJobType/:jobTypeID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0553"></a>**T0553** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobTypes/getSingleJobType/:jobTypeID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0554"></a>**T0554** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobTypes/getSingleJobType/:jobTypeID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0555"></a>**T0555** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobs/getActiveCustomerJobs/:accountID/:userID/:customerID | absent session: 401 envelope and no writes `

<a id="t0556"></a>**T0556** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobs/getActiveCustomerJobs/:accountID/:userID/:customerID | foreign URL account: 403 envelope and no writes `

<a id="t0557"></a>**T0557** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobs/getActiveCustomerJobs/:accountID/:userID/:customerID | staff role: 403 envelope and no writes `

<a id="t0558"></a>**T0558** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobs/getSingleJob/:customerJobID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0559"></a>**T0559** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobs/getSingleJob/:customerJobID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0560"></a>**T0560** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /jobs/getSingleJob/:customerJobID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0561"></a>**T0561** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /notifications/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0562"></a>**T0562** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /notifications/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0563"></a>**T0563** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /notifications/:accountID/:userID/unread-count | absent session: 401 envelope and no writes `

<a id="t0564"></a>**T0564** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /notifications/:accountID/:userID/unread-count | foreign URL account: 403 envelope and no writes `

<a id="t0565"></a>**T0565** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /payments/getPayments/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0566"></a>**T0566** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /payments/getPayments/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0567"></a>**T0567** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /payments/getPayments/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0568"></a>**T0568** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /payments/getSinglePayment/:paymentID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0569"></a>**T0569** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /payments/getSinglePayment/:paymentID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0570"></a>**T0570** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /payments/getSinglePayment/:paymentID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0571"></a>**T0571** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/counts/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0572"></a>**T0572** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/counts/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0573"></a>**T0573** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/counts/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0574"></a>**T0574** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/file-preview/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0575"></a>**T0575** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/file-preview/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0576"></a>**T0576** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/file-preview/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0577"></a>**T0577** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/files/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0578"></a>**T0578** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/files/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0579"></a>**T0579** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/files/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0580"></a>**T0580** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/list/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0581"></a>**T0581** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/list/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0582"></a>**T0582** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/list/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0583"></a>**T0583** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/single/:paymentID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0584"></a>**T0584** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/single/:paymentID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0585"></a>**T0585** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /pending-payments/single/:paymentID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0586"></a>**T0586** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /quotes/getActiveQuotes/:accountID/:quoteID | absent session: 401 envelope and no writes `

<a id="t0587"></a>**T0587** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /quotes/getActiveQuotes/:accountID/:quoteID | foreign URL account: 403 envelope and no writes `

<a id="t0588"></a>**T0588** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /quotes/getActiveQuotes/:accountID/:quoteID | staff role: 403 envelope and no writes `

<a id="t0589"></a>**T0589** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /recurringCustomer/getActiveRecurringCustomers/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0590"></a>**T0590** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /recurringCustomer/getActiveRecurringCustomers/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0591"></a>**T0591** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /recurringCustomer/getActiveRecurringCustomers/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0592"></a>**T0592** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /retainers/:retainerID/events/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0593"></a>**T0593** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /retainers/:retainerID/events/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0594"></a>**T0594** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /retainers/:retainerID/events/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0595"></a>**T0595** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /retainers/getActiveRetainers/:customerID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0596"></a>**T0596** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /retainers/getActiveRetainers/:customerID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0597"></a>**T0597** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /retainers/getActiveRetainers/:customerID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0598"></a>**T0598** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /retainers/getSingleRetainer/:retainerID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0599"></a>**T0599** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /retainers/getSingleRetainer/:retainerID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0600"></a>**T0600** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /retainers/getSingleRetainer/:retainerID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0601"></a>**T0601** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracker-staff/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0602"></a>**T0602** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracker-staff/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0603"></a>**T0603** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracker-staff/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0604"></a>**T0604** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/download/by-name/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0605"></a>**T0605** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/download/by-name/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0606"></a>**T0606** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/history/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0607"></a>**T0607** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/history/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0608"></a>**T0608** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/history/download/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0609"></a>**T0609** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/history/download/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0610"></a>**T0610** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/template/latest/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0611"></a>**T0611** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/template/latest/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0612"></a>**T0612** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/template/list/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0613"></a>**T0613** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/template/list/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0614"></a>**T0614** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/template/list/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0615"></a>**T0615** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/users/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0616"></a>**T0616** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /time-tracking/users/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0617"></a>**T0617** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/countsByEmployee/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0618"></a>**T0618** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/countsByEmployee/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0619"></a>**T0619** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/countsByEmployee/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0620"></a>**T0620** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/fetchTimesheetsByMonth/:queryUserID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0621"></a>**T0621** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/fetchTimesheetsByMonth/:queryUserID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0622"></a>**T0622** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/getAllTimesheetsForEmployeeByUserID/:queryUserID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0623"></a>**T0623** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/getAllTimesheetsForEmployeeByUserID/:queryUserID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0624"></a>**T0624** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/getTimesheetEntries/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0625"></a>**T0625** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/getTimesheetEntries/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0626"></a>**T0626** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/getTimesheetEntries/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0627"></a>**T0627** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/getTimesheetEntriesByUserID/:queryUserID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0628"></a>**T0628** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /timesheets/getTimesheetEntriesByUserID/:queryUserID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0629"></a>**T0629** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/exportTransactions/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0630"></a>**T0630** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/exportTransactions/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0631"></a>**T0631** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/exportTransactions/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0632"></a>**T0632** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0633"></a>**T0633** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0634"></a>**T0634** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/fetchEmployeeTransactions/:startDate/:endDate/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0635"></a>**T0635** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/getSingleTransaction/:customerID/:transactionID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0636"></a>**T0636** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/getSingleTransaction/:customerID/:transactionID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0637"></a>**T0637** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/getSingleTransaction/:customerID/:transactionID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0638"></a>**T0638** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/getTransactions/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0639"></a>**T0639** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/getTransactions/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0640"></a>**T0640** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /transactions/getTransactions/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0641"></a>**T0641** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /user/fetchSingleUser/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0642"></a>**T0642** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /user/fetchSingleUser/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0643"></a>**T0643** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /workDescriptions/getSingleWorkDescription/:workDescriptionID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0644"></a>**T0644** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /workDescriptions/getSingleWorkDescription/:workDescriptionID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0645"></a>**T0645** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /workDescriptions/getSingleWorkDescription/:workDescriptionID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0646"></a>**T0646** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0647"></a>**T0647** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0648"></a>**T0648** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /writeOffs/getSingleWriteOff/:writeOffID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0649"></a>**T0649** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /writeOffs/getWriteOffs/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0650"></a>**T0650** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /writeOffs/getWriteOffs/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0651"></a>**T0651** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts GET /writeOffs/getWriteOffs/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0652"></a>**T0652** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /account/createAccount | absent session: 401 envelope and no writes `

<a id="t0653"></a>**T0653** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /account/createAccount | staff role: 403 envelope and no writes `

<a id="t0654"></a>**T0654** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /accountAudit/run/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0655"></a>**T0655** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /accountAudit/run/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0656"></a>**T0656** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /accountAudit/run/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0657"></a>**T0657** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /analytics/rateAgreement/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0658"></a>**T0658** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /analytics/rateAgreement/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0659"></a>**T0659** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /analytics/rateAgreement/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0660"></a>**T0660** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /auditRecord/customer/:customerID/:accountID/:userID/records | absent session: 401 envelope and no writes `

<a id="t0661"></a>**T0661** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /auditRecord/customer/:customerID/:accountID/:userID/records | foreign URL account: 403 envelope and no writes `

<a id="t0662"></a>**T0662** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /auditRecord/customer/:customerID/:accountID/:userID/records | staff role: 403 envelope and no writes `

<a id="t0663"></a>**T0663** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /auth/renew | absent session: 401 envelope and no writes `

<a id="t0664"></a>**T0664** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /billing-review/reprocess-with-overrides/:entryID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0665"></a>**T0665** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /billing-review/reprocess-with-overrides/:entryID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0666"></a>**T0666** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /billing-review/reprocess-with-overrides/:entryID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0667"></a>**T0667** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /billing-review/reprocess/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0668"></a>**T0668** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /billing-review/reprocess/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0669"></a>**T0669** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /billing-review/reprocess/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0670"></a>**T0670** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /customer/createCustomer/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0671"></a>**T0671** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /customer/createCustomer/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0672"></a>**T0672** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /customer/createCustomer/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0673"></a>**T0673** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /duplicates/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0674"></a>**T0674** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /duplicates/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0675"></a>**T0675** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /duplicates/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0676"></a>**T0676** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /duplicates/:duplicateID/resolve/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0677"></a>**T0677** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /duplicates/:duplicateID/resolve/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0678"></a>**T0678** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /duplicates/:duplicateID/resolve/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0679"></a>**T0679** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /duplicates/scan/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0680"></a>**T0680** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /duplicates/scan/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0681"></a>**T0681** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /duplicates/scan/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0682"></a>**T0682** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/:invoiceID/exceptions/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0683"></a>**T0683** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/:invoiceID/exceptions/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0684"></a>**T0684** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/:invoiceID/exceptions/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0685"></a>**T0685** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/:invoiceID/exceptions/:exceptionID/resolve/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0686"></a>**T0686** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/:invoiceID/exceptions/:exceptionID/resolve/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0687"></a>**T0687** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/:invoiceID/exceptions/:exceptionID/resolve/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0688"></a>**T0688** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/:invoiceID/exceptions/:exceptionID/reverse/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0689"></a>**T0689** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/:invoiceID/exceptions/:exceptionID/reverse/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0690"></a>**T0690** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/:invoiceID/exceptions/:exceptionID/reverse/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0691"></a>**T0691** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/createInvoice/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0692"></a>**T0692** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/createInvoice/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0693"></a>**T0693** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /invoices/createInvoice/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0694"></a>**T0694** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /jobCategories/createJobCategory/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0695"></a>**T0695** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /jobCategories/createJobCategory/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0696"></a>**T0696** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /jobCategories/createJobCategory/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0697"></a>**T0697** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /jobTypes/createJobType/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0698"></a>**T0698** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /jobTypes/createJobType/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0699"></a>**T0699** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /jobTypes/createJobType/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0700"></a>**T0700** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /jobs/createJob/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0701"></a>**T0701** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /jobs/createJob/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0702"></a>**T0702** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /jobs/createJob/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0703"></a>**T0703** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /payments/createPayment/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0704"></a>**T0704** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /payments/createPayment/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0705"></a>**T0705** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /payments/createPayment/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0706"></a>**T0706** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /payments/reversePayment/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0707"></a>**T0707** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /payments/reversePayment/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0708"></a>**T0708** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /payments/reversePayment/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0709"></a>**T0709** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /pending-payments/approve/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0710"></a>**T0710** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /pending-payments/approve/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0711"></a>**T0711** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /pending-payments/approve/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0712"></a>**T0712** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /pending-payments/upload/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0713"></a>**T0713** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /pending-payments/upload/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0714"></a>**T0714** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /pending-payments/upload/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0715"></a>**T0715** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /quotes/createQuote | absent session: 401 envelope and no writes `

<a id="t0716"></a>**T0716** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /quotes/createQuote | staff role: 403 envelope and no writes `

<a id="t0717"></a>**T0717** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /recurringCustomer/createRecurringCustomer/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0718"></a>**T0718** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /recurringCustomer/createRecurringCustomer/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0719"></a>**T0719** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /recurringCustomer/createRecurringCustomer/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0720"></a>**T0720** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /retainers/:retainerID/events/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0721"></a>**T0721** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /retainers/:retainerID/events/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0722"></a>**T0722** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /retainers/:retainerID/events/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0723"></a>**T0723** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /retainers/createRetainer/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0724"></a>**T0724** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /retainers/createRetainer/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0725"></a>**T0725** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /retainers/createRetainer/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0726"></a>**T0726** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /time-tracker-staff/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0727"></a>**T0727** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /time-tracker-staff/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0728"></a>**T0728** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /time-tracker-staff/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0729"></a>**T0729** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /time-tracking/template/upload/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0730"></a>**T0730** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /time-tracking/template/upload/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0731"></a>**T0731** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /time-tracking/template/upload/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0732"></a>**T0732** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /time-tracking/upload/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0733"></a>**T0733** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /time-tracking/upload/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0734"></a>**T0734** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /timesheets/ai/kickoff/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0735"></a>**T0735** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /timesheets/ai/kickoff/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0736"></a>**T0736** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /timesheets/moveToTransactions/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0737"></a>**T0737** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /timesheets/moveToTransactions/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0738"></a>**T0738** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /timesheets/moveToTransactions/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0739"></a>**T0739** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /transactions/createTransaction/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0740"></a>**T0740** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /transactions/createTransaction/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0741"></a>**T0741** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /transactions/createTransaction/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0742"></a>**T0742** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /user/createUser/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0743"></a>**T0743** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /user/createUser/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0744"></a>**T0744** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /user/createUser/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0745"></a>**T0745** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /workDescriptions/createWorkDescription/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0746"></a>**T0746** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /workDescriptions/createWorkDescription/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0747"></a>**T0747** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /workDescriptions/createWorkDescription/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0748"></a>**T0748** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /writeOffs/createWriteOffs/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0749"></a>**T0749** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /writeOffs/createWriteOffs/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0750"></a>**T0750** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts POST /writeOffs/createWriteOffs/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0751"></a>**T0751** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /account/automations/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0752"></a>**T0752** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /account/automations/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0753"></a>**T0753** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /account/automations/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0754"></a>**T0754** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /account/updateAccount | absent session: 401 envelope and no writes `

<a id="t0755"></a>**T0755** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /account/updateAccount | staff role: 403 envelope and no writes `

<a id="t0756"></a>**T0756** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /billing-review/:entryID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0757"></a>**T0757** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /billing-review/:entryID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0758"></a>**T0758** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /billing-review/:entryID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0759"></a>**T0759** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /billing-review/transaction/:transactionID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0760"></a>**T0760** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /billing-review/transaction/:transactionID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0761"></a>**T0761** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /billing-review/transaction/:transactionID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0762"></a>**T0762** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /customer/updateCustomer/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0763"></a>**T0763** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /customer/updateCustomer/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0764"></a>**T0764** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /customer/updateCustomer/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0765"></a>**T0765** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /jobCategories/updateJobCategory/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0766"></a>**T0766** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /jobCategories/updateJobCategory/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0767"></a>**T0767** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /jobCategories/updateJobCategory/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0768"></a>**T0768** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /jobTypes/updateJobType/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0769"></a>**T0769** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /jobTypes/updateJobType/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0770"></a>**T0770** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /jobTypes/updateJobType/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0771"></a>**T0771** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /jobs/updateJob/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0772"></a>**T0772** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /jobs/updateJob/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0773"></a>**T0773** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /jobs/updateJob/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0774"></a>**T0774** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /notifications/:accountID/:userID/read-all | absent session: 401 envelope and no writes `

<a id="t0775"></a>**T0775** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /notifications/:accountID/:userID/read-all | foreign URL account: 403 envelope and no writes `

<a id="t0776"></a>**T0776** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /notifications/:notificationID/:accountID/:userID/read | absent session: 401 envelope and no writes `

<a id="t0777"></a>**T0777** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /notifications/:notificationID/:accountID/:userID/read | foreign URL account: 403 envelope and no writes `

<a id="t0778"></a>**T0778** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /payments/updatePayment/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0779"></a>**T0779** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /payments/updatePayment/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0780"></a>**T0780** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /payments/updatePayment/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0781"></a>**T0781** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /pending-payments/approve/:paymentID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0782"></a>**T0782** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /pending-payments/approve/:paymentID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0783"></a>**T0783** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /pending-payments/approve/:paymentID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0784"></a>**T0784** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /pending-payments/soft-delete/:paymentID/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0785"></a>**T0785** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /pending-payments/soft-delete/:paymentID/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0786"></a>**T0786** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /pending-payments/soft-delete/:paymentID/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0787"></a>**T0787** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /quotes/updateQuote | absent session: 401 envelope and no writes `

<a id="t0788"></a>**T0788** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /quotes/updateQuote | staff role: 403 envelope and no writes `

<a id="t0789"></a>**T0789** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /recurringCustomer/updateRecurringCustomer | absent session: 401 envelope and no writes `

<a id="t0790"></a>**T0790** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /recurringCustomer/updateRecurringCustomer | staff role: 403 envelope and no writes `

<a id="t0791"></a>**T0791** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /retainers/updateRetainer/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0792"></a>**T0792** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /retainers/updateRetainer/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0793"></a>**T0793** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /retainers/updateRetainer/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0794"></a>**T0794** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /time-tracker-staff/:accountID/:userID/:staffID | absent session: 401 envelope and no writes `

<a id="t0795"></a>**T0795** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /time-tracker-staff/:accountID/:userID/:staffID | foreign URL account: 403 envelope and no writes `

<a id="t0796"></a>**T0796** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /time-tracker-staff/:accountID/:userID/:staffID | staff role: 403 envelope and no writes `

<a id="t0797"></a>**T0797** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /transactions/updateTransaction/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0798"></a>**T0798** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /transactions/updateTransaction/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0799"></a>**T0799** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /transactions/updateTransaction/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0800"></a>**T0800** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /user/updateUser/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0801"></a>**T0801** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /user/updateUser/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0802"></a>**T0802** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /user/updateUser/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0803"></a>**T0803** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /workDescriptions/updateWorkDescription/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0804"></a>**T0804** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /workDescriptions/updateWorkDescription/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0805"></a>**T0805** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /workDescriptions/updateWorkDescription/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0806"></a>**T0806** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /writeOffs/updateWriteOffs/:accountID/:userID | absent session: 401 envelope and no writes `

<a id="t0807"></a>**T0807** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /writeOffs/updateWriteOffs/:accountID/:userID | foreign URL account: 403 envelope and no writes `

<a id="t0808"></a>**T0808** — [test/integration/path-matrix-01-guards.integration.spec.js](../../test/integration/path-matrix-01-guards.integration.spec.js)

` Path matrix: mounted-route no-write authorization contracts PUT /writeOffs/updateWriteOffs/:accountID/:userID | staff role: 403 envelope and no writes `

<a id="t0809"></a>**T0809** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows DELETE /customer/deleteCustomer | malformed ID is envelope 404 without writes `

<a id="t0810"></a>**T0810** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows DELETE /quotes/deleteQuote | database delete failure is refused with no rows changed `

<a id="t0811"></a>**T0811** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /account/AccountInformation | missing account response is 404 without writes `

<a id="t0812"></a>**T0812** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /account/AccountInformation/1/1 | getAccount failure: HTTP 500, envelope 500, no writes `

<a id="t0813"></a>**T0813** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /account/automations/1/1 | listAccountAutomations failure: HTTP 500, envelope 500, no writes `

<a id="t0814"></a>**T0814** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /accountAudit/audit/1/1/1 | getAuditById failure: HTTP 500, envelope 500, no writes `

<a id="t0815"></a>**T0815** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /accountAudit/customer/1/1/1 | getAuditsForCustomer failure: HTTP 500, envelope 500, no writes `

<a id="t0816"></a>**T0816** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /accountAudit/customers/1/1 | getAuditableCustomers failure: HTTP 500, envelope 500, no writes `

<a id="t0817"></a>**T0817** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /accountsReceivable/aging/1/1 | getAging failure: HTTP 500, envelope 500, no writes `

<a id="t0818"></a>**T0818** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /accountsReceivable/aging/1/1/export | getAging failure: HTTP 500, envelope 500, no writes `

<a id="t0819"></a>**T0819** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /analytics/clientRates/1/1 | getClientRates failure: HTTP 200, envelope 500, no writes `

<a id="t0820"></a>**T0820** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /analytics/clientRates/1/1/export | getClientRates failure: HTTP 500, envelope 500, no writes `

<a id="t0821"></a>**T0821** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /analytics/exclusions/1/1 | getExcludableCustomers failure: HTTP 200, envelope 500, no writes `

<a id="t0822"></a>**T0822** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /analytics/jobBudgets/1/1 | getJobBudgets failure: HTTP 200, envelope 500, no writes `

<a id="t0823"></a>**T0823** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /analytics/taxSeasonCapacity/1/1 | getTaxSeasonCapacity failure: HTTP 200, envelope 500, no writes `

<a id="t0824"></a>**T0824** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /analytics/timeAllocation/1/1 | getTimeAllocation failure: HTTP 200, envelope 500, no writes `

<a id="t0825"></a>**T0825** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /analytics/timeAllocation/1/1/export | getTimeAllocation failure: HTTP 500, envelope 500, no writes `

<a id="t0826"></a>**T0826** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /analytics/wipAging/1/1 | getWipAging failure: HTTP 200, envelope 500, no writes `

<a id="t0827"></a>**T0827** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /analytics/yearEndPacket/1/1 | getClientRates failure: HTTP 500, envelope 500, no writes `

<a id="t0828"></a>**T0828** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /api/health/ | public liveness succeeds without database writes `

<a id="t0829"></a>**T0829** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /api/health/check | failed database probe is 503 without writes `

<a id="t0830"></a>**T0830** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /customer/activeCustomers/1/1 | getActiveCustomersPaginated failure: HTTP 500, envelope 500, no writes `

<a id="t0831"></a>**T0831** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /customer/activeCustomers/customerByID/1/1/1 | getCustomerByID failure: HTTP 200, envelope 500, no writes `

<a id="t0832"></a>**T0832** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /healthz/check | failed database probe is 503 without writes `

<a id="t0833"></a>**T0833** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /initialData/initialBlob/1/1 | getActiveCustomers failure: HTTP 200, envelope 500, no writes `

<a id="t0834"></a>**T0834** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /quotes/getActiveQuotes/1/1 | getActiveQuotes failure: HTTP 200, envelope 500, no writes `

<a id="t0835"></a>**T0835** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows GET /workDescriptions/getSingleWorkDescription/1/1/1 | getSingleWorkDescription failure: HTTP 200, envelope 500, no writes `

<a id="t0836"></a>**T0836** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows POST /accountAudit/run | more than 200 customers refuses before registering a job `

<a id="t0837"></a>**T0837** — [test/integration/path-matrix-02-read-failures.integration.spec.js](../../test/integration/path-matrix-02-read-failures.integration.spec.js)

` Path matrix: database read failures preserve all rows PUT /recurringCustomer/updateRecurringCustomer | missing row is 404 without writes `

<a id="t0838"></a>**T0838** — [test/integration/path-matrix-03-commit-outcomes.integration.spec.js](../../test/integration/path-matrix-03-commit-outcomes.integration.spec.js)

` Path matrix: committed CRUD is not reported as a failed write job create | postcommit list failure reports saved outcome `

<a id="t0839"></a>**T0839** — [test/integration/path-matrix-03-commit-outcomes.integration.spec.js](../../test/integration/path-matrix-03-commit-outcomes.integration.spec.js)

` Path matrix: committed CRUD is not reported as a failed write job delete | postcommit list failure reports saved outcome `

<a id="t0840"></a>**T0840** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls ALL /ai-integration/* | retired endpoint is 410 and preserves every row `

<a id="t0841"></a>**T0841** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls POST /auth/google | unprovisioned identity refuses 403 without a login row `

<a id="t0842"></a>**T0842** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls POST /auth/google | valid provisioned identity receives cookie and exactly one login row `

<a id="t0843"></a>**T0843** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls POST /auth/google | verified identity with invalid email_verified refuses 401 without writes `

<a id="t0844"></a>**T0844** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls POST /auth/google | verified identity with invalid hd refuses 401 without writes `

<a id="t0845"></a>**T0845** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls POST /customer/createCustomer | createCustomer empty return rolls back all writes `

<a id="t0846"></a>**T0846** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls POST /customer/createCustomer | createCustomerInformation empty return rolls back all writes `

<a id="t0847"></a>**T0847** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls POST /customer/createCustomer | createRecurringCustomer empty return rolls back all writes `

<a id="t0848"></a>**T0848** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls PUT /account/automations | {"automationKey":"absent","isEnabled":true} refuses 400 without writes `

<a id="t0849"></a>**T0849** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls PUT /account/automations | {"automationKey":"thursday_reminder_emails","isEnabled":"not-a-boolean"} refuses 400 without writes `

<a id="t0850"></a>**T0850** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls PUT /account/automations | {"automationKey":"thursday_reminder_emails","isEnabled":{}} refuses 400 without writes `

<a id="t0851"></a>**T0851** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls PUT /account/automations | {"automationKey":"thursday_reminder_emails","recipientUserIds":"1"} refuses 400 without writes `

<a id="t0852"></a>**T0852** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls PUT /account/automations | {"automationKey":"thursday_reminder_emails","recipientUserIds":[2147483646]} refuses 400 without writes `

<a id="t0853"></a>**T0853** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls PUT /account/automations | {"automationKey":"thursday_reminder_emails"} refuses 400 without writes `

<a id="t0854"></a>**T0854** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls PUT /account/automations | {"isEnabled":true} refuses 400 without writes `

<a id="t0855"></a>**T0855** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls PUT /customer/updateCustomer | lost update target rolls back with no contact/evidence writes `

<a id="t0856"></a>**T0856** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls PUT /jobTypes/updateJobType | target disappears after preflight: 404 without writes `

<a id="t0857"></a>**T0857** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls requireAuth | database lookup failure refuses 401 without writes `

<a id="t0858"></a>**T0858** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls requireAuth | expired token refuses without writes `

<a id="t0859"></a>**T0859** — [test/integration/path-matrix-04-admin-controls.integration.spec.js](../../test/integration/path-matrix-04-admin-controls.integration.spec.js)

` Path matrix: account, authentication and defensive save controls requireAuth | malformed token refuses without writes `

<a id="t0860"></a>**T0860** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures DELETE /timesheets/deleteTimesheetEntry | database update failure is 500 without writes `

<a id="t0861"></a>**T0861** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures DELETE /timesheets/deleteTimesheetEntry | lost conditional claim is 409 without writes `

<a id="t0862"></a>**T0862** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures DELETE /timesheets/deleteTimesheetEntry | malformed ID is 400 without writes `

<a id="t0863"></a>**T0863** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures GET /notifications/1/1 | staff cannot access another employee: 403 and no writes `

<a id="t0864"></a>**T0864** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures GET /timesheets/countsByEmployee | per-employee count failure degrades to zero without writes `

<a id="t0865"></a>**T0865** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures GET /timesheets/countsByEmployee/1/1 | getActiveAccountUsers database failure: 500 and no writes `

<a id="t0866"></a>**T0866** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures GET /timesheets/fetchTimesheetsByMonth/3/1/1 | getTimesheetSummariesByUserAndMonth database failure: 500 and no writes `

<a id="t0867"></a>**T0867** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures GET /timesheets/getAllTimesheetsForEmployeeByUserID/3/1/1 | getTimesheetSummariesByUser database failure: 500 and no writes `

<a id="t0868"></a>**T0868** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures GET /timesheets/getTimesheetEntries/1/1 | getOutstandingTimesheetEntries database failure: 500 and no writes `

<a id="t0869"></a>**T0869** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures GET /timesheets/getTimesheetEntriesByUserID/3/1/1 | getPendingTimesheetEntriesByUserID database failure: 500 and no writes `

<a id="t0870"></a>**T0870** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures GET /user/fetchSingleUser/1/1 | staff cannot access another employee: 403 and no writes `

<a id="t0871"></a>**T0871** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures POST /billing-review/reprocess | invalid mode refuses 400 without writes `

<a id="t0872"></a>**T0872** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures POST /billing-review/reprocess | no matching entries succeeds without writes `

<a id="t0873"></a>**T0873** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures POST /billing-review/reprocess | query failure refuses 500 without writes `

<a id="t0874"></a>**T0874** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures POST /billing-review/reprocess-with-overrides/1/1/1 | disabled feature refuses 503 without writes `

<a id="t0875"></a>**T0875** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures POST /billing-review/reprocess/1/1 | disabled feature refuses 503 without writes `

<a id="t0876"></a>**T0876** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures POST /timesheets/ai/kickoff/1/1 | disabled feature refuses 503 without writes `

<a id="t0877"></a>**T0877** — [test/integration/path-matrix-05-timesheets.integration.spec.js](../../test/integration/path-matrix-05-timesheets.integration.spec.js)

` Path matrix: timesheet and billing review failures POST /timesheets/moveToTransactions | final suggestion-write failure rolls back work, claim and audit `

<a id="t0878"></a>**T0878** — [test/integration/path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js)

` Path matrix: pending-payment queue and storage failures DELETE /pending-payments/file | file disappears after ownership check: 404 without writes `

<a id="t0879"></a>**T0879** — [test/integration/path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js)

` Path matrix: pending-payment queue and storage failures GET /pending-payments/counts/1/1 | query failure refuses 500 without writes `

<a id="t0880"></a>**T0880** — [test/integration/path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js)

` Path matrix: pending-payment queue and storage failures GET /pending-payments/file-preview | both storage locations unavailable: 404 without writes `

<a id="t0881"></a>**T0881** — [test/integration/path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js)

` Path matrix: pending-payment queue and storage failures GET /pending-payments/file-preview | processed-list failure falls back to exact pending bytes `

<a id="t0882"></a>**T0882** — [test/integration/path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js)

` Path matrix: pending-payment queue and storage failures GET /pending-payments/files/1/1 | query failure refuses 500 without writes `

<a id="t0883"></a>**T0883** — [test/integration/path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js)

` Path matrix: pending-payment queue and storage failures GET /pending-payments/single/1/1/1 | query failure refuses 500 without writes `

<a id="t0884"></a>**T0884** — [test/integration/path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js)

` Path matrix: pending-payment queue and storage failures POST /pending-payments/approve | deleted payment refuses 409 without writes `

<a id="t0885"></a>**T0885** — [test/integration/path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js)

` Path matrix: pending-payment queue and storage failures POST /pending-payments/approve | posted marker refuses retry even if queue flag is false `

<a id="t0886"></a>**T0886** — [test/integration/path-matrix-06-pending-payments.integration.spec.js](../../test/integration/path-matrix-06-pending-payments.integration.spec.js)

` Path matrix: pending-payment queue and storage failures POST /pending-payments/upload | storage failure refuses 500 without database writes `

<a id="t0887"></a>**T0887** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET download/by-name | corrupt resolved gzip refuses 500 `

<a id="t0888"></a>**T0888** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET download/by-name | list and candidate failures end in 404 with no writes `

<a id="t0889"></a>**T0889** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET download/by-name | listed candidate and durable legacy candidate failures end in 404 `

<a id="t0890"></a>**T0890** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET history | missing account refuses 404 `

<a id="t0891"></a>**T0891** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET history | object-list failure refuses 500 after folder-discovery fallback `

<a id="t0892"></a>**T0892** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET history/download | corrupt gzip preserves all rows `

<a id="t0893"></a>**T0893** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET history/download | missing object preserves all rows `

<a id="t0894"></a>**T0894** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET history/download | unavailable storage preserves all rows `

<a id="t0895"></a>**T0895** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET template/latest | empty list refuses 404 `

<a id="t0896"></a>**T0896** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET template/latest | without base list refuses 404 `

<a id="t0897"></a>**T0897** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET template/list | storage failure refuses 500 `

<a id="t0898"></a>**T0898** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures GET users | nonnumeric requester refuses 400 `

<a id="t0899"></a>**T0899** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST template/upload | malformed filename encoding refuses 400 `

<a id="t0900"></a>**T0900** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | account query failure refuses 500 without rows `

<a id="t0901"></a>**T0901** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | database and system-error email failures still return rollback refusal `

<a id="t0902"></a>**T0902** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | initial query and error-email failures refuse 500 without database writes `

<a id="t0903"></a>**T0903** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | insert failure rolls back every row; object cleanup fails visibly in logs `

<a id="t0904"></a>**T0904** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | owner 0 refuses before persistence `

<a id="t0905"></a>**T0905** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | owner 1.5 refuses before persistence `

<a id="t0906"></a>**T0906** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | owner and submitter notification failures preserve the saved upload `

<a id="t0907"></a>**T0907** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | owner bad refuses before persistence `

<a id="t0908"></a>**T0908** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | rollback reporting failure preserves the original refusal and removes the uploaded object `

<a id="t0909"></a>**T0909** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | staff-recipient query failure does not undo the saved upload `

<a id="t0910"></a>**T0910** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | storage put failure rolls back without any object or database rows `

<a id="t0911"></a>**T0911** — [test/integration/path-matrix-07-tracker-storage.integration.spec.js](../../test/integration/path-matrix-07-tracker-storage.integration.spec.js)

` Path matrix: tracker persistence and storage failures POST upload | union of two previous uploads refuses all-rows-already-uploaded without writes `

<a id="t0912"></a>**T0912** — [test/integration/path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js)

` Path matrix: audit reports and interrupted exports GET audit PDF | malformed report returns JSON 500 without writes or PDF headers `

<a id="t0913"></a>**T0913** — [test/integration/path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js)

` Path matrix: audit reports and interrupted exports GET audit PDF | renderer failure returns JSON 500 without writes `

<a id="t0914"></a>**T0914** — [test/integration/path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js)

` Path matrix: audit reports and interrupted exports GET audit PDF | stored-object failure rebuilds a valid PDF without writes `

<a id="t0915"></a>**T0915** — [test/integration/path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js)

` Path matrix: audit reports and interrupted exports GET yearEndPacket | archive event before bytes returns JSON 500 without writes `

<a id="t0916"></a>**T0916** — [test/integration/path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js)

` Path matrix: audit reports and interrupted exports GET yearEndPacket | archive throw before bytes returns JSON 500 without writes `

<a id="t0917"></a>**T0917** — [test/integration/path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js)

` Path matrix: audit reports and interrupted exports POST accountAudit/run | PDF store failure keeps completed report with no published PDF `

<a id="t0918"></a>**T0918** — [test/integration/path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js)

` Path matrix: audit reports and interrupted exports POST accountAudit/run | app comparison query failure uses savepoint and preserves numerical audit `

<a id="t0919"></a>**T0919** — [test/integration/path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js)

` Path matrix: audit reports and interrupted exports POST accountAudit/run | customer read failure finishes with one failed report and unchanged money `

<a id="t0920"></a>**T0920** — [test/integration/path-matrix-08-reports.integration.spec.js](../../test/integration/path-matrix-08-reports.integration.spec.js)

` Path matrix: audit reports and interrupted exports POST accountAudit/run | report and failed-result persistence failures finish with no writes `

<a id="t0921"></a>**T0921** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses DELETE invoice | unissued absorbed predecessor refuses 200/500 and preserves every row `

<a id="t0922"></a>**T0922** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses DELETE invoice | unissued absorbed refuses 200/500 and preserves every row `

<a id="t0923"></a>**T0923** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses DELETE invoice | unissued beginning balance refuses 200/500 and preserves every row `

<a id="t0924"></a>**T0924** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses DELETE invoice | unissued linked work refuses 200/500 and preserves every row `

<a id="t0925"></a>**T0925** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses DELETE invoice | unissued snapshot refuses 200/500 and preserves every row `

<a id="t0926"></a>**T0926** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses GET eligibility | failed optional audit lookup preserves calculated balances and writes nothing `

<a id="t0927"></a>**T0927** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses POST createInvoice | corrupt getPaymentsByCustomerID refuses 500 without saving `

<a id="t0928"></a>**T0928** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses POST createInvoice | corrupt getRetainersByCustomerID refuses 500 without saving `

<a id="t0929"></a>**T0929** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses POST createInvoice | corrupt getTransactionsByCustomerID refuses 500 without saving `

<a id="t0930"></a>**T0930** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses POST createInvoice | corrupt getWriteOffsByCustomerID refuses 500 without saving `

<a id="t0931"></a>**T0931** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses POST createInvoice | corrupt outstanding snapshot refuses 500 without saving `

<a id="t0932"></a>**T0932** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses POST createInvoice | malformed retainer-funded nonbillable row refuses NaN draw total `

<a id="t0933"></a>**T0933** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses POST duplicate resolve | failed related-review update rolls back source removal and every audit row `

<a id="t0934"></a>**T0934** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses POST exception flag | disappeared invoice under the ledger lock refuses 404 without writes `

<a id="t0935"></a>**T0935** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses POST exception revision | original archive with 0 PDFs refuses atomically `

<a id="t0936"></a>**T0936** — [test/integration/path-matrix-09-ledger-defenses.integration.spec.js](../../test/integration/path-matrix-09-ledger-defenses.integration.spec.js)

` Path matrix: invoice and duplicate transactional defenses POST exception revision | original archive with 2 PDFs refuses atomically `

<a id="t0937"></a>**T0937** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation POST account | nested account insert failure rolls back both account and address `

<a id="t0938"></a>**T0938** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation POST account | unique storage-slug race retries once using a savepoint and saves one account `

<a id="t0939"></a>**T0939** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation PUT cascade edit | Comprehend failure uses deterministic email redaction and preserves the ledger edit `

<a id="t0940"></a>**T0940** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation PUT cascade edit | missing new customer refuses before writing `

<a id="t0941"></a>**T0941** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation PUT cascade edit | optional label lookup failure preserves requested customer move `

<a id="t0942"></a>**T0942** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation PUT cascade edit | optional training savepoint failure preserves the requested ledger edit `

<a id="t0943"></a>**T0943** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation PUT held entry | customer_id=999999 refuses 400 and preserves every row `

<a id="t0944"></a>**T0944** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation PUT held entry | unit_cost=-1 refuses 400 and preserves every row `

<a id="t0945"></a>**T0945** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation PUT held entry | unit_cost=NaN refuses 400 and preserves every row `

<a id="t0946"></a>**T0946** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation PUT recurring | conditional update loses its row: 500 with complete rollback `

<a id="t0947"></a>**T0947** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation PUT transaction | row changes customer under lock: legacy conflict refusal without writes `

<a id="t0948"></a>**T0948** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation PUT transaction | row disappears after owner lookup: legacy refusal without writes `

<a id="t0949"></a>**T0949** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation delete recurring | row disappears between route validation and locked service: 500 without writes `

<a id="t0950"></a>**T0950** — [test/integration/path-matrix-10-races-and-review.integration.spec.js](../../test/integration/path-matrix-10-races-and-review.integration.spec.js)

` Path matrix: concurrent edits and review degradation update recurring | row disappears between route validation and locked service: 500 without writes `

<a id="t0951"></a>**T0951** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures GET non-owner template | audit-row insertion failure still returns a tenant-only workbook `

<a id="t0952"></a>**T0952** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures GET non-owner template | unreadable neutral manifest refuses 503 and never returns owner bytes `

<a id="t0953"></a>**T0953** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST template upload | missing raw bytes refuses 400 without writes `

<a id="t0954"></a>**T0954** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | absent entry rows refuses before any storage or row writes `

<a id="t0955"></a>**T0955** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | absent header row refuses before any storage or row writes `

<a id="t0956"></a>**T0956** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | duplicate header refuses before any storage or row writes `

<a id="t0957"></a>**T0957** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | end before start refuses before any storage or row writes `

<a id="t0958"></a>**T0958** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | invalid date refuses before any storage or row writes `

<a id="t0959"></a>**T0959** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | invalid end date refuses before any storage or row writes `

<a id="t0960"></a>**T0960** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | invalid start date refuses before any storage or row writes `

<a id="t0961"></a>**T0961** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | missing date refuses before any storage or row writes `

<a id="t0962"></a>**T0962** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | missing employee refuses before any storage or row writes `

<a id="t0963"></a>**T0963** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | missing header refuses before any storage or row writes `

<a id="t0964"></a>**T0964** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | missing notes refuses before any storage or row writes `

<a id="t0965"></a>**T0965** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | owner with empty email refuses validation and writes nothing `

<a id="t0966"></a>**T0966** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | workbook parser failure refuses corrupt workbook `

<a id="t0967"></a>**T0967** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | workbook parser produces empty sheet: 400 and no writes `

<a id="t0968"></a>**T0968** — [test/integration/path-matrix-11-tracker-validation.integration.spec.js](../../test/integration/path-matrix-11-tracker-validation.integration.spec.js)

` Path matrix: tracker parser and tenant-safe template failures POST upload | workbook parser produces no sheets: 400 and no writes `

<a id="t0969"></a>**T0969** — [test/integration/path-matrix-12-global-errors.integration.spec.js](../../test/integration/path-matrix-12-global-errors.integration.spec.js)

` Path matrix: global parser, lock and rate-limit refusals expensive limiter | mutation 31 refuses 429 without launching AI or writing rows `

<a id="t0970"></a>**T0970** — [test/integration/path-matrix-12-global-errors.integration.spec.js](../../test/integration/path-matrix-12-global-errors.integration.spec.js)

` Path matrix: global parser, lock and rate-limit refusals expensive limiter | repeated GET polls do not consume the mutation budget `

<a id="t0971"></a>**T0971** — [test/integration/path-matrix-12-global-errors.integration.spec.js](../../test/integration/path-matrix-12-global-errors.integration.spec.js)

` Path matrix: global parser, lock and rate-limit refusals global API limiter | request 301 is 429 and every preceding health request succeeds without writes `

<a id="t0972"></a>**T0972** — [test/integration/path-matrix-12-global-errors.integration.spec.js](../../test/integration/path-matrix-12-global-errors.integration.spec.js)

` Path matrix: global parser, lock and rate-limit refusals global JSON parser | malformed JSON refuses HTTP 400 before any writes `

<a id="t0973"></a>**T0973** — [test/integration/path-matrix-12-global-errors.integration.spec.js](../../test/integration/path-matrix-12-global-errors.integration.spec.js)

` Path matrix: global parser, lock and rate-limit refusals global JSON parser | oversized JSON refuses HTTP 413 before any writes `

<a id="t0974"></a>**T0974** — [test/integration/path-matrix-12-global-errors.integration.spec.js](../../test/integration/path-matrix-12-global-errors.integration.spec.js)

` Path matrix: global parser, lock and rate-limit refusals global error | database sent-lock code is normalized to HTTP 409 and SENT_INVOICE_LOCKED `

<a id="t0975"></a>**T0975** — [test/integration/path-matrix-12-global-errors.integration.spec.js](../../test/integration/path-matrix-12-global-errors.integration.spec.js)

` Path matrix: global parser, lock and rate-limit refusals global error | production presentation hides internal database text and preserves rows `

<a id="t0976"></a>**T0976** — [test/integration/path-matrix-13-optional-services.integration.spec.js](../../test/integration/path-matrix-13-optional-services.integration.spec.js)

` Path matrix: optional ingestion services fail without corrupting billing AI audit-log database failure does not discard the stubbed valid inference `

<a id="t0977"></a>**T0977** — [test/integration/path-matrix-13-optional-services.integration.spec.js](../../test/integration/path-matrix-13-optional-services.integration.spec.js)

` Path matrix: optional ingestion services fail without corrupting billing AI response with malformed embedded JSON is rejected without any database writes `

<a id="t0978"></a>**T0978** — [test/integration/path-matrix-13-optional-services.integration.spec.js](../../test/integration/path-matrix-13-optional-services.integration.spec.js)

` Path matrix: optional ingestion services fail without corrupting billing background ingestion fatal query failure is logged, never a financial write `

<a id="t0979"></a>**T0979** — [test/integration/path-matrix-13-optional-services.integration.spec.js](../../test/integration/path-matrix-13-optional-services.integration.spec.js)

` Path matrix: optional ingestion services fail without corrupting billing confirmed-alias query failure yields an empty map and writes nothing `

<a id="t0980"></a>**T0980** — [test/integration/path-matrix-13-optional-services.integration.spec.js](../../test/integration/path-matrix-13-optional-services.integration.spec.js)

` Path matrix: optional ingestion services fail without corrupting billing failed holding-row update and fallback preserve the entire database with diagnostic result `

<a id="t0981"></a>**T0981** — [test/integration/path-matrix-13-optional-services.integration.spec.js](../../test/integration/path-matrix-13-optional-services.integration.spec.js)

` Path matrix: optional ingestion services fail without corrupting billing ingestion notification failure preserves held non-work without creating a charge `

<a id="t0982"></a>**T0982** — [test/integration/path-matrix-13-optional-services.integration.spec.js](../../test/integration/path-matrix-13-optional-services.integration.spec.js)

` Path matrix: optional ingestion services fail without corrupting billing legacy negative duration is held for review and never creates a charge `

<a id="t0983"></a>**T0983** — [test/integration/path-matrix-13-optional-services.integration.spec.js](../../test/integration/path-matrix-13-optional-services.integration.spec.js)

` Path matrix: optional ingestion services fail without corrupting billing training-example query failure yields no few-shot examples and writes nothing `

<a id="t0984"></a>**T0984** — [test/integration/path-matrix-14-response-decoration.integration.spec.js](../../test/integration/path-matrix-14-response-decoration.integration.spec.js)

` Path matrix: sent-lock response decoration failures GET transactions | failed lock lookup refuses 500 without writing or exposing unannotated rows `

<a id="t0985"></a>**T0985** — [test/integration/path-matrix-14-response-decoration.integration.spec.js](../../test/integration/path-matrix-14-response-decoration.integration.spec.js)

` Path matrix: sent-lock response decoration failures GET transactions | failed root-invoice lookup refuses 500 without changing the sent ledger `

<a id="t0986"></a>**T0986** — [test/integration/path-matrix-14-response-decoration.integration.spec.js](../../test/integration/path-matrix-14-response-decoration.integration.spec.js)

` Path matrix: sent-lock response decoration failures POST finalize | failed lock decoration preserves sent status, exact 110-dollar statement and immutable issue `

<a id="t0987"></a>**T0987** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures DELETE job | family query loses its row under the lock: refusal and no writes `

<a id="t0988"></a>**T0988** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures DELETE payment | second lookup loses a stored payment: refusal and no writes `

<a id="t0989"></a>**T0989** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures POST audit batch | uncoercible JSON identifier refuses 500 before any job or database write `

<a id="t0990"></a>**T0990** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures POST finalize | corrupt customer-information identity refuses schema validation before saving `

<a id="t0991"></a>**T0991** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures POST finalize | missing inserted parent mapping rolls back its insert and all ledger writes `

<a id="t0992"></a>**T0992** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures POST preview | timezone conversion failure uses the same local date and writes nothing `

<a id="t0993"></a>**T0993** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures POST reprocess with overrides | six minutes at 100 per hour saves exactly 10 dollars; repeat refuses without writes `

<a id="t0994"></a>**T0994** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures PUT cascade edit | missing unissued legacy invoice chain refuses 409 without writes `

<a id="t0995"></a>**T0995** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures PUT cascade edit | second customer lookup disappears: invalid reference and no writes `

<a id="t0996"></a>**T0996** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures email boundary | missing recipients refuses before storage, network or database writes `

<a id="t0997"></a>**T0997** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures email boundary | missing sender configuration refuses before storage, network or database writes `

<a id="t0998"></a>**T0998** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures email boundary | missing subject refuses before storage, network or database writes `

<a id="t0999"></a>**T0999** — [test/integration/path-matrix-15-defensive-faults.integration.spec.js](../../test/integration/path-matrix-15-defensive-faults.integration.spec.js)

` Path matrix: defensive database and configuration failures ingestion | failed historical-pattern query clears cached failure and holds the entry without charging `

<a id="t1000"></a>**T1000** — [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

` Path matrix: workbook fallbacks and immutable PDF integrity POST audit print | missing embedded digest refuses 500 and publishes no record or financial write `

<a id="t1001"></a>**T1001** — [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

` Path matrix: workbook fallbacks and immutable PDF integrity _restoreDefinedNames | archive read failure preserves input bytes and writes nothing `

<a id="t1002"></a>**T1002** — [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

` Path matrix: workbook fallbacks and immutable PDF integrity _shrinkFullColumnSqrefs | archive read failure preserves input bytes and writes nothing `

<a id="t1003"></a>**T1003** — [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

` Path matrix: workbook fallbacks and immutable PDF integrity _stripBadValidations | archive read failure preserves input bytes and writes nothing `

<a id="t1004"></a>**T1004** — [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

` Path matrix: workbook fallbacks and immutable PDF integrity lookup worksheet | protection failure retains hidden own-tenant lookup values without database writes `

<a id="t1005"></a>**T1005** — [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

` Path matrix: workbook fallbacks and immutable PDF integrity owner template | allowed package without Time refuses rather than selecting a lookup sheet `

<a id="t1006"></a>**T1006** — [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

` Path matrix: workbook fallbacks and immutable PDF integrity owner template | failed date-validation injection still returns a readable tenant workbook `

<a id="t1007"></a>**T1007** — [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

` Path matrix: workbook fallbacks and immutable PDF integrity parsed worksheet set | unreviewed sheet refuses even after an upstream package check `

<a id="t1008"></a>**T1008** — [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

` Path matrix: workbook fallbacks and immutable PDF integrity stubbed inference | failed S3 audit store preserves result and writes no database rows `

<a id="t1009"></a>**T1009** — [test/integration/path-matrix-16-workbook-and-audit.integration.spec.js](../../test/integration/path-matrix-16-workbook-and-audit.integration.spec.js)

` Path matrix: workbook fallbacks and immutable PDF integrity workbook XML | malformed sheet metadata refuses the package without writes `

<a id="t1010"></a>**T1010** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) A5-1 — retainer creation strips a client-supplied cancellation marker a GENUINE cancellation marker (written by an actual NSF-of-overpayment reversal) still blocks edits and deletes `

<a id="t1011"></a>**T1011** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) NSF reversal of an overpayment split also cancels the banked prepayment (seam 6) a reversed payment cannot be re-priced or deleted while its reversal exists `

<a id="t1012"></a>**T1012** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) NSF reversal of an overpayment split also cancels the banked prepayment (seam 6) cancels the untouched $50 prepayment with the $100 debt restore; deleting the reversal restores both exactly `

<a id="t1013"></a>**T1013** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) POST /pending-payments/approve (item 8) a refused payment leaves the pending row unprocessed and posts nothing `

<a id="t1014"></a>**T1014** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) billed immutability from stored rows and the statement TIMESTAMP (B2) a payment / write-off entered on bill day BEFORE the run is billed; one entered after the run is not `

<a id="t1015"></a>**T1015** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) billed/immutability gate is decided in SQL, exactly like the engine statement gate (seam 10) a payment snapshot and its retainer draw in the statement’s millisecond: after → editable, at the same microsecond → billed `

<a id="t1016"></a>**T1016** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) deleting a reversal restores the original payment (item 7) strips the [reversed …] marker so the payment can be reversed again; the reversal row itself also blocks a second reversal `

<a id="t1017"></a>**T1017** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) overpayment split links its prepayment retainer (item 6) records the prepayment id on the payment and removes the untouched prepayment on delete `

<a id="t1018"></a>**T1018** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) overpayment split links its prepayment retainer (item 6) refuses the delete once the prepayment has been drawn on `

<a id="t1019"></a>**T1019** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) payment delete never touches unrelated retainers (B1) refuses to delete a payment whose retainer draw belongs to a time/charge entry `

<a id="t1020"></a>**T1020** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) payment delete never touches unrelated retainers (B1) retainer-funded payments draw from the chain LATEST balance and delete/edit only their own draw snapshot `

<a id="t1021"></a>**T1021** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) retainer-funded payments move exactly their own draw (seam 5) legacy payments (no marker): a unique draw in the ±1 s window is used, several are refused and nothing changes `

<a id="t1022"></a>**T1022** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) retainer-funded payments move exactly their own draw (seam 5) reviewer probe: B's draw closer in time to payment A than A's own draw — deleting A never takes B's draw `

<a id="t1023"></a>**T1023** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) retainers: picker, draw validation, update and delete (item 4) delete refuses while any chain row is drawn on or referenced, and removes an unused root `

<a id="t1024"></a>**T1024** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) retainers: picker, draw validation, update and delete (item 4) the picker skips an exhausted chain instead of resurrecting its root `

<a id="t1025"></a>**T1025** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) retainers: picker, draw validation, update and delete (item 4) updating the starting amount shifts the whole chain and keeps the draw history `

<a id="t1026"></a>**T1026** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) same-day re-bill: references to the absorbed first statement remap to the live one (seam 9) A5: the reversal path refuses the same way once every newest-date root is marked absorbed `

<a id="t1027"></a>**T1027** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: ledger CRUD integrity (payments, write-offs, retainers, pending approval) write-offs follow the payment chain rules (item 5) remaps an absorbed-chain reference, refuses cross-customer/over-remaining, re-prices and deletes symmetrically `

<a id="t1028"></a>**T1028** — [test/integration/payment-reversal.integration.spec.js](../../test/integration/payment-reversal.integration.spec.js)

` integration: payment reversal (NSF) refuses to reverse twice or reverse a reversal `

<a id="t1029"></a>**T1029** — [test/integration/pii-leak.integration.spec.js](../../test/integration/pii-leak.integration.spec.js)

` integration: PII-leak invariant held rows (ambiguous / unmatched / no job) persist only IDs, scores and reason codes `

<a id="t1030"></a>**T1030** — [test/integration/review-account-atomicity.integration.spec.js](../../test/integration/review-account-atomicity.integration.spec.js)

` F19 atomic automation settings keeps enabled and recipients unchanged when a foreign recipient is rejected `

<a id="t1031"></a>**T1031** — [test/integration/review-account-atomicity.integration.spec.js](../../test/integration/review-account-atomicity.integration.spec.js)

` F20 atomic account provisioning rejects an overlength address without reserving an account or slug `

<a id="t1032"></a>**T1032** — [test/integration/review-audit-filter.integration.spec.js](../../test/integration/review-audit-filter.integration.spec.js)

` F38 unsupported audit age filter explicitly refuses ar_60 instead of silently including the 10-day statement `

<a id="t1033"></a>**T1033** — [test/integration/review-audit-filter.integration.spec.js](../../test/integration/review-audit-filter.integration.spec.js)

` F38 unsupported audit age filter explicitly refuses ar_60 instead of silently including the 80-day statement `

<a id="t1034"></a>**T1034** — [test/integration/review-customer-delete.integration.spec.js](../../test/integration/review-customer-delete.integration.spec.js)

` F24/F25 customer deletion integrity F24 deletes all owned contacts with an unused customer `

<a id="t1035"></a>**T1035** — [test/integration/review-customer-recurring.integration.spec.js](../../test/integration/review-customer-recurring.integration.spec.js)

` F21 atomic customer and recurring saves rolls back customer/contact on missing owned contact `

<a id="t1036"></a>**T1036** — [test/integration/review-job-family.integration.spec.js](../../test/integration/review-job-family.integration.spec.js)

` F9 Billing Review family totals recomputes and appends whole-family totals after price edit `

<a id="t1037"></a>**T1037** — [test/integration/review-pending-files.integration.spec.js](../../test/integration/review-pending-files.integration.spec.js)

` F16-F18 pending payment file integrity F16 refuses stale soft-delete after approval commits and preserves visible posted evidence `

<a id="t1038"></a>**T1038** — [test/integration/review-pending-files.integration.spec.js](../../test/integration/review-pending-files.integration.spec.js)

` F16-F18 pending payment file integrity F18 refuses canonical file deletion when only a suffixed sibling was approved `

<a id="t1039"></a>**T1039** — [test/integration/review-rate-agreements.integration.spec.js](../../test/integration/review-rate-agreements.integration.spec.js)

` F32 rate agreement ownership and attribution refuses a foreign customer without creating an own-account association `

<a id="t1040"></a>**T1040** — [test/integration/review-rate-agreements.integration.spec.js](../../test/integration/review-rate-agreements.integration.spec.js)

` F32 rate agreement ownership and attribution validates {"year":1999} before writing `

<a id="t1041"></a>**T1041** — [test/integration/review-related-ids.integration.spec.js](../../test/integration/review-related-ids.integration.spec.js)

` F2 related IDs and creator attribution refuses foreign category on job-type create `

<a id="t1042"></a>**T1042** — [test/integration/review-related-ids.integration.spec.js](../../test/integration/review-related-ids.integration.spec.js)

` F2 related IDs and creator attribution refuses foreign category on job-type update `

<a id="t1043"></a>**T1043** — [test/integration/review-related-ids.integration.spec.js](../../test/integration/review-related-ids.integration.spec.js)

` F2 related IDs and creator attribution refuses job on quote create `

<a id="t1044"></a>**T1044** — [test/integration/review-related-ids.integration.spec.js](../../test/integration/review-related-ids.integration.spec.js)

` F2 related IDs and creator attribution refuses job on quote update `

<a id="t1045"></a>**T1045** — [test/integration/review-related-ids.integration.spec.js](../../test/integration/review-related-ids.integration.spec.js)

` F2 related IDs and creator attribution refuses mismatched customer on quote create `

<a id="t1046"></a>**T1046** — [test/integration/review-related-ids.integration.spec.js](../../test/integration/review-related-ids.integration.spec.js)

` F2 related IDs and creator attribution refuses mismatched customer on quote update `

<a id="t1047"></a>**T1047** — [test/integration/review-related-ids.integration.spec.js](../../test/integration/review-related-ids.integration.spec.js)

` F2 related IDs and creator attribution rejects another customer recurring ID before changing the customer or subscription `

<a id="t1048"></a>**T1048** — [test/integration/review-tracker-outcome.integration.spec.js](../../test/integration/review-tracker-outcome.integration.spec.js)

` F28 committed tracker upload outcome returns 201 and the saved identifier despite recipient lookup failure; retry is duplicate `

<a id="t1049"></a>**T1049** — [test/integration/review-user-guards.integration.spec.js](../../test/integration/review-user-guards.integration.spec.js)

` F29 active Super Admin guards preserves active status when omitted and still rejects boolean self-deactivation `

<a id="t1050"></a>**T1050** — [test/integration/review-user-guards.integration.spec.js](../../test/integration/review-user-guards.integration.spec.js)

` F29 active Super Admin guards rejects nonboolean active value 0 before writing `

<a id="t1051"></a>**T1051** — [test/integration/review-user-guards.integration.spec.js](../../test/integration/review-user-guards.integration.spec.js)

` F29 active Super Admin guards rejects nonboolean active value 1 before writing `

<a id="t1052"></a>**T1052** — [test/integration/review-user-guards.integration.spec.js](../../test/integration/review-user-guards.integration.spec.js)

` F29 active Super Admin guards serializes concurrent self-demotions so one active Super Admin remains `

<a id="t1053"></a>**T1053** — [test/integration/scenario-lifecycle-01-work.integration.spec.js](../../test/integration/scenario-lifecycle-01-work.integration.spec.js)

` scenario lifecycle W: clients, jobs and work (hand oracle 01-work.md) W09 edits contact and job metadata, refuses duplicate customers/jobs `

<a id="t1054"></a>**T1054** — [test/integration/scenario-lifecycle-01-work.integration.spec.js](../../test/integration/scenario-lifecycle-01-work.integration.spec.js)

` scenario lifecycle W: clients, jobs and work (hand oracle 01-work.md) W11 refuses billed work edits/deletes and linked customer/job deletion `

<a id="t1055"></a>**T1055** — [test/integration/scenario-lifecycle-01-work.integration.spec.js](../../test/integration/scenario-lifecycle-01-work.integration.spec.js)

` scenario lifecycle W: clients, jobs and work (hand oracle 01-work.md) W13 completes empty customer and unused job CRUD `

<a id="t1056"></a>**T1056** — [test/integration/scenario-lifecycle-02-retainers.integration.spec.js](../../test/integration/scenario-lifecycle-02-retainers.integration.spec.js)

` scenario lifecycle R: retainers (hand oracle 02-retainers.md) R04 reduces starting funds, refuses less than used, permits exact exhaustion `

<a id="t1057"></a>**T1057** — [test/integration/scenario-lifecycle-02-retainers.integration.spec.js](../../test/integration/scenario-lifecycle-02-retainers.integration.spec.js)

` scenario lifecycle R: retainers (hand oracle 02-retainers.md) R06 refuses overdraft, root/child deletion, detaching funding and reversing a draw `

<a id="t1058"></a>**T1058** — [test/integration/scenario-lifecycle-02-retainers.integration.spec.js](../../test/integration/scenario-lifecycle-02-retainers.integration.spec.js)

` scenario lifecycle R: retainers (hand oracle 02-retainers.md) R08 smaller retainer cannot part-fund a single entry; separate $100 draw plus $50 work bills $50 `

<a id="t1059"></a>**T1059** — [test/integration/scenario-lifecycle-03-payments.integration.spec.js](../../test/integration/scenario-lifecycle-03-payments.integration.spec.js)

` scenario lifecycle P: settlement and NSF (hand oracle 03-payments.md) P03 exact settlement, NSF and guarded reversal undo `

<a id="t1060"></a>**T1060** — [test/integration/scenario-lifecycle-03-payments.integration.spec.js](../../test/integration/scenario-lifecycle-03-payments.integration.spec.js)

` scenario lifecycle P: settlement and NSF (hand oracle 03-payments.md) P04 splits a $350 check into $300 settlement and $50 excess; reversal cancels the excess `

<a id="t1061"></a>**T1061** — [test/integration/scenario-lifecycle-03-payments.integration.spec.js](../../test/integration/scenario-lifecycle-03-payments.integration.spec.js)

` scenario lifecycle P: settlement and NSF (hand oracle 03-payments.md) P06 refuses deleting/reversing a split after its excess has funded work `

<a id="t1062"></a>**T1062** — [test/integration/scenario-lifecycle-04-writeoffs.integration.spec.js](../../test/integration/scenario-lifecycle-04-writeoffs.integration.spec.js)

` scenario lifecycle O: write-offs (hand oracle 04-writeoffs.md) O03 refuses billed pending-credit edits/deletes and applies current invoice credits once `

<a id="t1063"></a>**T1063** — [test/integration/scenario-lifecycle-04-writeoffs.integration.spec.js](../../test/integration/scenario-lifecycle-04-writeoffs.integration.spec.js)

` scenario lifecycle O: write-offs (hand oracle 04-writeoffs.md) O04 credit-only job is not lost; a negative bill is skipped until work exceeds the credit `

<a id="t1064"></a>**T1064** — [test/integration/scenario-lifecycle-05-monthend.integration.spec.js](../../test/integration/scenario-lifecycle-05-monthend.integration.spec.js)

` scenario lifecycle M: selective month-end and aging (hand oracle 05-month-end.md) M05 refuses even an empty sent statement, as well as linked, absorbed, child and absent invoices `

<a id="t1065"></a>**T1065** — [test/integration/scenario-lifecycle-06-cascade.integration.spec.js](../../test/integration/scenario-lifecycle-06-cascade.integration.spec.js)

` scenario lifecycle C: billed corrections (hand oracle 06-cascade.md) C07 refuses retainer-funded financial edits and explicit retainer fields `

<a id="t1066"></a>**T1066** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X auth AR: missing, expired, absent user, staff role and foreign tenant refused `

<a id="t1067"></a>**T1067** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X auth audit: missing, expired, absent user, staff role and foreign tenant refused `

<a id="t1068"></a>**T1068** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X cascade refuses invalid customer_job_id=70001 `

<a id="t1069"></a>**T1069** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X cascade refuses invalid customer_job_id=null `

<a id="t1070"></a>**T1070** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X cascade refuses invalid general_work_description_id=999999 `

<a id="t1071"></a>**T1071** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X cascade refuses invalid is_transaction_billable="maybe" `

<a id="t1072"></a>**T1072** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X cascade refuses invalid note={} `

<a id="t1073"></a>**T1073** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X cascade refuses invalid quantity=-1 `

<a id="t1074"></a>**T1074** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X cascade refuses invalid total_transaction="NaN" `

<a id="t1075"></a>**T1075** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X cascade refuses invalid transaction_date="2026-02-30" `

<a id="t1076"></a>**T1076** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X cascade refuses invalid unit_cost="" `

<a id="t1077"></a>**T1077** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X price refuses quantity= with no ledger movement `

<a id="t1078"></a>**T1078** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X price refuses quantity=0.001 with no ledger movement `

<a id="t1079"></a>**T1079** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X price refuses unitCost= with no ledger movement `

<a id="t1080"></a>**T1080** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X read and mutation missing/foreign ID 70001 `

<a id="t1081"></a>**T1081** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X read and mutation missing/foreign ID 999999 `

<a id="t1082"></a>**T1082** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X read and mutation missing/foreign ID bogus `

<a id="t1083"></a>**T1083** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X receipt foreign job `

<a id="t1084"></a>**T1084** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X receipt funding without invoice `

<a id="t1085"></a>**T1085** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X receipt missing invoice `

<a id="t1086"></a>**T1086** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X receipt nan `

<a id="t1087"></a>**T1087** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X receipt other customer `

<a id="t1088"></a>**T1088** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X receipt overpayment `

<a id="t1089"></a>**T1089** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X receipt unknown invoice `

<a id="t1090"></a>**T1090** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X receipt unknown retainer `

<a id="t1091"></a>**T1091** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X receipt wrong retainer owner `

<a id="t1092"></a>**T1092** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work foreign customer `

<a id="t1093"></a>**T1093** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work foreign employee `

<a id="t1094"></a>**T1094** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work foreign job `

<a id="t1095"></a>**T1095** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work foreign retainer `

<a id="t1096"></a>**T1096** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work incorrect product `

<a id="t1097"></a>**T1097** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work invalid type `

<a id="t1098"></a>**T1098** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work missing description `

<a id="t1099"></a>**T1099** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work missing job `

<a id="t1100"></a>**T1100** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work missing retainer `

<a id="t1101"></a>**T1101** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work negative duration `

<a id="t1102"></a>**T1102** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work other customer job `

<a id="t1103"></a>**T1103** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X work wrong duration `

<a id="t1104"></a>**T1104** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X writeoff nan `

<a id="t1105"></a>**T1105** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X writeoff other customer job `

<a id="t1106"></a>**T1106** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X writeoff over-credit `

<a id="t1107"></a>**T1107** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X writeoff unknown invoice `

<a id="t1108"></a>**T1108** — [test/integration/scenario-lifecycle-07-refusals.integration.spec.js](../../test/integration/scenario-lifecycle-07-refusals.integration.spec.js)

` scenario lifecycle X: input, permission, ownership and state refusals (07-refusals.md) X writeoff wrong customer invoice `

<a id="t1109"></a>**T1109** — [test/integration/scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js)

` scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md) F atomic rollback: job insert `

<a id="t1110"></a>**T1110** — [test/integration/scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js)

` scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md) F read failure: accountAudit/account-audit-service.getAuditById `

<a id="t1111"></a>**T1111** — [test/integration/scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js)

` scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md) F read failure: accountsReceivable/accounts-receivable-service.getAging `

<a id="t1112"></a>**T1112** — [test/integration/scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js)

` scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md) F read failure: customer/customer-service.getCustomerByID `

<a id="t1113"></a>**T1113** — [test/integration/scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js)

` scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md) F read failure: payments/payments-service.getSinglePayment `

<a id="t1114"></a>**T1114** — [test/integration/scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js)

` scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md) F read failure: retainer/retainer-service.getSingleRetainer `

<a id="t1115"></a>**T1115** — [test/integration/scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js)

` scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md) F read failure: transactions/transactions-service.getSingleTransaction `

<a id="t1116"></a>**T1116** — [test/integration/scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js)

` scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md) F read failure: writeOffs/writeOffs-service.getSingleWriteOff `

<a id="t1117"></a>**T1117** — [test/integration/scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js)

` scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md) F stale snapshot refuses finalize after work arrives during PDF upload `

<a id="t1118"></a>**T1118** — [test/integration/scenario-lifecycle-08-failures.integration.spec.js](../../test/integration/scenario-lifecycle-08-failures.integration.spec.js)

` scenario lifecycle F: database, storage and concurrent ledger failures (07-refusals.md) F two simultaneous $120 receipts cannot overpay a $200 balance `

<a id="t1119"></a>**T1119** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S corrupt all-absorbed newest chain refuses both receipt and writeoff instead of reopening debt `

<a id="t1120"></a>**T1120** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S finalize refuses NaN selection without stamping anything `

<a id="t1121"></a>**T1121** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S finalize refuses absent selection without stamping anything `

<a id="t1122"></a>**T1122** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S finalize refuses duplicate selection without stamping anything `

<a id="t1123"></a>**T1123** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S finalize refuses empty selection without stamping anything `

<a id="t1124"></a>**T1124** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S finalize refuses foreign selection without stamping anything `

<a id="t1125"></a>**T1125** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S finalize refuses zero selection without stamping anything `

<a id="t1126"></a>**T1126** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S latest payment guard refuses older financial changes and preserves metadata edits `

<a id="t1127"></a>**T1127** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S latest writeoff guard, over-credit edit, immutable ownership and metadata update `

<a id="t1128"></a>**T1128** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S missing mailing contact and sequence exhaustion refuse safely `

<a id="t1129"></a>**T1129** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S missing/foreign mutation identity 0 `

<a id="t1130"></a>**T1130** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S missing/foreign mutation identity 70001 `

<a id="t1131"></a>**T1131** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S missing/foreign mutation identity 999999 `

<a id="t1132"></a>**T1132** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S missing/foreign mutation identity bogus `

<a id="t1133"></a>**T1133** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S ownership edits cannot move work/customer contact/retainer or reassign a linked job `

<a id="t1134"></a>**T1134** — [test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-09-state-boundaries.integration.spec.js)

` scenario lifecycle S: state and finalization refusal boundaries (07-refusals.md) S pending credit cannot be attached to invoice, moved to customer or assigned a foreign job `

<a id="t1135"></a>**T1135** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I NSF undo refuses a changed cancelled excess, then succeeds after fixture repair `

<a id="t1136"></a>**T1136** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I a waiting Billing Review edit refuses after the earlier delete removes its row `

<a id="t1137"></a>**T1137** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I a waiting work delete refuses when the earlier customer move changes its owner `

<a id="t1138"></a>**T1138** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I cancellation of a real PostgreSQL lock-wait query rolls Billing Review back `

<a id="t1139"></a>**T1139** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I deletion refuses a cancelled excess whose reversal event is missing `

<a id="t1140"></a>**T1140** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I funded work refuses a draw already covered by a statement while its payment remains pending `

<a id="t1141"></a>**T1141** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I funded work refuses a draw shared by another transaction `

<a id="t1142"></a>**T1142** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I funded work refuses draw movement differs `

<a id="t1143"></a>**T1143** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I funded work refuses draw ordered before root `

<a id="t1144"></a>**T1144** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I funded work refuses payment amount differs `

<a id="t1145"></a>**T1145** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I funded work refuses payment missing retainer identity `

<a id="t1146"></a>**T1146** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I legacy overpayment refuses two matching excess roots `

<a id="t1147"></a>**T1147** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I manual draw refuses a retainer overdraw and a missing legacy snapshot `

<a id="t1148"></a>**T1148** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I no-root legacy chain refuses receipt and credit; orphan receipt cannot be reversed `

<a id="t1149"></a>**T1149** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I payment refuses a corrupt customer link on both update and delete `

<a id="t1150"></a>**T1150** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I payment refuses repricing a legacy parent link with inconsistent timestamp order `

<a id="t1151"></a>**T1151** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I writeoff refuses a corrupt customer link on both update and delete `

<a id="t1152"></a>**T1152** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I writeoff refuses repricing a legacy parent link with inconsistent timestamp order `

<a id="t1153"></a>**T1153** — [test/integration/scenario-lifecycle-10-integrity.integration.spec.js](../../test/integration/scenario-lifecycle-10-integrity.integration.spec.js)

` scenario lifecycle I: legacy integrity and lock races (08-integrity-and-races.md) I01 refuses multiple exact payments claiming one funded work draw `

<a id="t1154"></a>**T1154** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J a legacy parent with only a payment child refuses deletion until that payment is removed `

<a id="t1155"></a>**T1155** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J a queued invoice delete refuses a payment committed while it waited `

<a id="t1156"></a>**T1156** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J a receipt posted during rendering invalidates rebill and survives the refusal `

<a id="t1157"></a>**T1157** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J different-customer finalize number collision refuses one run and its retry uses the next number `

<a id="t1158"></a>**T1158** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J double invoice deletion and changed-owner races preserve the surviving ledger `

<a id="t1159"></a>**T1159** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J finalize refuses a selected transaction's concurrent amount change `

<a id="t1160"></a>**T1160** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J job with only a payment cannot be reassigned or deleted `

<a id="t1161"></a>**T1161** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J job with only a writeoff cannot be reassigned or deleted `

<a id="t1162"></a>**T1162** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J missing customer and suppressed profile update refuse without changing rows `

<a id="t1163"></a>**T1163** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J same-customer concurrent finalize issues one statement and refuses its stale competitor `

<a id="t1164"></a>**T1164** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J suppressed customer_payments stamp refuses and rolls back every finalize write `

<a id="t1165"></a>**T1165** — [test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js](../../test/integration/scenario-lifecycle-11-finalize-races.integration.spec.js)

` scenario lifecycle J: finalization races and dependency guards (08-integrity-and-races.md) J suppressed customer_transactions stamp refuses and rolls back every finalize write `

<a id="t1166"></a>**T1166** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner decisions 3/5: immutable statements and bounced payment corrections archives a marked $500 revision without overwriting the original PDF or reposting money `

<a id="t1167"></a>**T1167** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner decisions 3/5: immutable statements and bounced payment corrections flags only the chosen receipt, audits the actor and permits no ordinary mutation `

<a id="t1168"></a>**T1168** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner decisions 3/5: immutable statements and bounced payment corrections refuses direct edits/deletes and cascade edits with HTTP 409 and no ledger writes `

<a id="t1169"></a>**T1169** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner decisions 3/5: immutable statements and bounced payment corrections rejects a missing/foreign payment without writes `

<a id="t1170"></a>**T1170** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner decisions 3/5: immutable statements and bounced payment corrections reverses once to $500 with no original row changes `

<a id="t1171"></a>**T1171** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner decisions 3/5: immutable statements and bounced payment corrections rolls back a failed reversal, including original evidence and exception state `

<a id="t1172"></a>**T1172** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner decisions 3/5: immutable statements and bounced payment corrections validates duplicate ids without writes `

<a id="t1173"></a>**T1173** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner decisions 3/5: immutable statements and bounced payment corrections validates ids without writes `

<a id="t1174"></a>**T1174** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner decisions 3/5: immutable statements and bounced payment corrections validates reason without writes `

<a id="t1175"></a>**T1175** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward exceptions rejects malformed and missing invoice IDs `

<a id="t1176"></a>**T1176** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward exceptions/1/resolve rejects malformed and missing invoice IDs `

<a id="t1177"></a>**T1177** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward history rejects malformed and missing invoice IDs `

<a id="t1178"></a>**T1178** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward refuses a foreign original artifact key before storage access, with no writes `

<a id="t1179"></a>**T1179** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input [] `

<a id="t1180"></a>**T1180** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {"condition":"bounced_check","reason":"NSF","paymentIds":[1,1,1,1,1,1, `

<a id="t1181"></a>**T1181** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {"condition":"bounced_check","reason":42,"paymentIds":[1]} `

<a id="t1182"></a>**T1182** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward rejects invalid flag input {} `

<a id="t1183"></a>**T1183** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward rejects tenant-local and cross-tenant exception lookup without disclosure `

<a id="t1184"></a>**T1184** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward requires roll-forward after the affected statement was absorbed `

<a id="t1185"></a>**T1185** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward reverse failure on customer_invoices rolls back the whole batch `

<a id="t1186"></a>**T1186** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward serializes duplicate flags into exactly one active grant `

<a id="t1187"></a>**T1187** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` owner exception boundaries, authorization, faults and roll-forward upload failure preserves the pending correction and original `

<a id="t1188"></a>**T1188** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` sent ledger surface coverage and overpayment correction refuses retainer-funded receipt exceptions `

<a id="t1189"></a>**T1189** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` sent ledger surface coverage and overpayment correction refuses reversal of a bounced overpayment whose excess has already funded work, with no partial correction `

<a id="t1190"></a>**T1190** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` sent ledger surface coverage and overpayment correction reverses a $150 bounced check as $100 restored debt plus $50 cancelled credit, then issues a $100 revision `

<a id="t1191"></a>**T1191** — [test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js](../../test/integration/scenario-lifecycle-12-sent-exceptions.integration.spec.js)

` sent ledger surface coverage and overpayment correction unissued parents and child snapshots cannot open an exception `

<a id="t1192"></a>**T1192** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments preserves pending events when statement storage fails before commit `

<a id="t1193"></a>**T1193** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments refunds $80 then increases $50 and decreases $30: availability 380-80+50-30=$320, debt $0 `

<a id="t1194"></a>**T1194** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments refuses cancellation revival, overflow, malformed adjustment fields and direct journal-chain edits `

<a id="t1195"></a>**T1195** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments refuses inconsistent retainer balances and cross-customer chains on both event routes `

<a id="t1196"></a>**T1196** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments rejects a finalize priced before a refund and prints long reasons across statement pages `

<a id="t1197"></a>**T1197** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments rejects insufficient availability, missing/cross-tenant IDs and permissions without writes `

<a id="t1198"></a>**T1198** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments rejects invalid date without writes `

<a id="t1199"></a>**T1199** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments rejects invalid direction without writes `

<a id="t1200"></a>**T1200** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments rejects invalid kind without writes `

<a id="t1201"></a>**T1201** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments rejects invalid maximum without writes `

<a id="t1202"></a>**T1202** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments rejects invalid method without writes `

<a id="t1203"></a>**T1203** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments rejects invalid reason without writes `

<a id="t1204"></a>**T1204** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments rejects invalid zero without writes `

<a id="t1205"></a>**T1205** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments rolls back snapshot and journal on each database write failure `

<a id="t1206"></a>**T1206** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments serializes a $10 draw against a $10 refund and leaves event evidence immutable `

<a id="t1207"></a>**T1207** — [test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js](../../test/integration/scenario-lifecycle-13-retainer-events.integration.spec.js)

` owner decision 1: retainer refunds and adjustments serializes racing refunds; only one $40 refund can consume $50 `

<a id="t1208"></a>**T1208** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal allows an explicit fresh review of a changed dismissed source, preserving prior evidence `

<a id="t1209"></a>**T1209** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal dismisses without ledger changes and a review scan does not reopen the pair `

<a id="t1210"></a>**T1210** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal enforces authentication, roles and tenancy on every new route `

<a id="t1211"></a>**T1211** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal manually flags an unpaired entry and removes it through the work deletion core: $200 -> $100 `

<a id="t1212"></a>**T1212** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal refuses a retainer with draws and a payment with a later balance event without partial writes `

<a id="t1213"></a>**T1213** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal refuses stale source reviews and missing sources without deleting changed money `

<a id="t1214"></a>**T1214** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal rejects retainer snapshot flags, malformed resolution IDs and suppressed resolution writes `

<a id="t1215"></a>**T1215** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal rolls back flag, scan, dismissal and removal when evidence cannot be saved `

<a id="t1216"></a>**T1216** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal validates manual flag kind with no writes `

<a id="t1217"></a>**T1217** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal validates manual flag missing with no writes `

<a id="t1218"></a>**T1218** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal validates manual flag self with no writes `

<a id="t1219"></a>**T1219** — [test/integration/scenario-lifecycle-14-duplicates.integration.spec.js](../../test/integration/scenario-lifecycle-14-duplicates.integration.spec.js)

` owner decision 4: visible duplicate review and guarded removal validates scan/list/filter/action and checks missing records `

<a id="t1220"></a>**T1220** — [test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js)

` owner decision 2: optional signed credit statements eligibility fails closed when pricing is unavailable rather than labelling credits zero `

<a id="t1221"></a>**T1221** — [test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js](../../test/integration/scenario-lifecycle-15-credit-statements.integration.spec.js)

` owner decision 2: optional signed credit statements validates every new raw option and customer shape before writing `

<a id="t1222"></a>**T1222** — [test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js](../../test/integration/scenario-lifecycle-17-time-boundaries.integration.spec.js)

` duration boundaries through manual, held review, invoice, audit, AR and analytics 7 min manually and through held tracker review cost $27.5 each `

<a id="t1223"></a>**T1223** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record GET /: authentication, roles, tenant, missing and database failures write nothing `

<a id="t1224"></a>**T1224** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record GET /records/RECORD/pdf: authentication, roles, tenant, missing and database failures write nothing `

<a id="t1225"></a>**T1225** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record GET /verify: authentication, roles, tenant, missing and database failures write nothing `

<a id="t1226"></a>**T1226** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record detects altered PDF bytes, blocks reopening and reports verification failure without writes `

<a id="t1227"></a>**T1227** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record detects altered chain evidence in the disposable scenario database and blocks new print/history `

<a id="t1228"></a>**T1228** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record draft writes no events; finalize marks sent and locks without double charging `

<a id="t1229"></a>**T1229** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record duplicate flag/dismiss/remove and ordinary delete retain changes; $100+$10+$10-$10=$110 `

<a id="t1230"></a>**T1230** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record prints full evidence compactly with retrievable payload descriptors and exact reopening `

<a id="t1231"></a>**T1231** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record records invoice reprints, and a failed reprint audit write returns no bytes or partial evidence `

<a id="t1232"></a>**T1232** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record refuses a forged storage identity and detects a mismatched retained chain anchor `

<a id="t1233"></a>**T1233** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record refuses archive tampering, wrong storage identity, missing archive, failed chain and failed anchor without writes `

<a id="t1234"></a>**T1234** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record render failure, empty storage result and suppressed metadata insert publish no record `

<a id="t1235"></a>**T1235** — [test/integration/scenario-lifecycle-18-audit-record.integration.spec.js](../../test/integration/scenario-lifecycle-18-audit-record.integration.spec.js)

` owner decision 6 hard account audit record validates every range/pagination branch and rejects malformed/missing stored IDs without writes `

<a id="t1236"></a>**T1236** — [test/integration/scenario-what-if-01-values.integration.spec.js](../../test/integration/scenario-what-if-01-values.integration.spec.js)

` what-if V: explicit inputs, cent rounding and unchanged-state refusals V01 retainer edit refuses amount "" `

<a id="t1237"></a>**T1237** — [test/integration/scenario-what-if-01-values.integration.spec.js](../../test/integration/scenario-what-if-01-values.integration.spec.js)

` what-if V: explicit inputs, cent rounding and unchanged-state refusals V01 retainer edit refuses amount 0 `

<a id="t1238"></a>**T1238** — [test/integration/scenario-what-if-01-values.integration.spec.js](../../test/integration/scenario-what-if-01-values.integration.spec.js)

` what-if V: explicit inputs, cent rounding and unchanged-state refusals V04 zero work and half-cent multiplication use literal expected cents `

<a id="t1239"></a>**T1239** — [test/integration/scenario-what-if-01-values.integration.spec.js](../../test/integration/scenario-what-if-01-values.integration.spec.js)

` what-if V: explicit inputs, cent rounding and unchanged-state refusals V05 payment edit refuses date "" `

<a id="t1240"></a>**T1240** — [test/integration/scenario-what-if-01-values.integration.spec.js](../../test/integration/scenario-what-if-01-values.integration.spec.js)

` what-if V: explicit inputs, cent rounding and unchanged-state refusals V05 payment edit refuses date [] `

<a id="t1241"></a>**T1241** — [test/integration/scenario-what-if-01-values.integration.spec.js](../../test/integration/scenario-what-if-01-values.integration.spec.js)

` what-if V: explicit inputs, cent rounding and unchanged-state refusals V05 writeoff edit refuses date "" `

<a id="t1242"></a>**T1242** — [test/integration/scenario-what-if-01-values.integration.spec.js](../../test/integration/scenario-what-if-01-values.integration.spec.js)

` what-if V: explicit inputs, cent rounding and unchanged-state refusals V05 writeoff edit refuses date [] `

<a id="t1243"></a>**T1243** — [test/integration/scenario-what-if-02-retries.integration.spec.js](../../test/integration/scenario-what-if-02-retries.integration.spec.js)

` what-if D: duplicate submissions and failures before/after commit D02/D03 storage failure then retry and double-click finalize issue one $100 statement `

<a id="t1244"></a>**T1244** — [test/integration/scenario-what-if-02-retries.integration.spec.js](../../test/integration/scenario-what-if-02-retries.integration.spec.js)

` what-if D: duplicate submissions and failures before/after commit D03 active-retainer read failure is500 without writes; retry returns the saved hold `

<a id="t1245"></a>**T1245** — [test/integration/scenario-what-if-02-retries.integration.spec.js](../../test/integration/scenario-what-if-02-retries.integration.spec.js)

` what-if D: duplicate submissions and failures before/after commit D03 read-only employee report refresh failure is500 and never claims committed success `

<a id="t1246"></a>**T1246** — [test/integration/scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js)

` what-if X/L/A: wrong targets, retained history and sessions A01 missing, expired, malformed, foreign and revoked sessions cannot write `

<a id="t1247"></a>**T1247** — [test/integration/scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js)

` what-if X/L/A: wrong targets, retained history and sessions L01 unused records delete successfully and stale IDs refuse `

<a id="t1248"></a>**T1248** — [test/integration/scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js)

` what-if X/L/A: wrong targets, retained history and sessions L01 user who owns a time entry cannot be deleted or lose attribution `

<a id="t1249"></a>**T1249** — [test/integration/scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js)

` what-if X/L/A: wrong targets, retained history and sessions L02 billed transaction job edit refuses `

<a id="t1250"></a>**T1250** — [test/integration/scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js)

` what-if X/L/A: wrong targets, retained history and sessions L03 drawn retainer preserves $30 draw when increased; lower-than-drawn and deletion refuse `

<a id="t1251"></a>**T1251** — [test/integration/scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js)

` what-if X/L/A: wrong targets, retained history and sessions X01 receipt refuses different customer invoice and preserves both customers `

<a id="t1252"></a>**T1252** — [test/integration/scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js)

` what-if X/L/A: wrong targets, retained history and sessions X01 receipt refuses different customer retainer and preserves both customers `

<a id="t1253"></a>**T1253** — [test/integration/scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js)

` what-if X/L/A: wrong targets, retained history and sessions X01 receipt refuses foreign job and preserves both customers `

<a id="t1254"></a>**T1254** — [test/integration/scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js)

` what-if X/L/A: wrong targets, retained history and sessions X01 receipt refuses missing invoice and preserves both customers `

<a id="t1255"></a>**T1255** — [test/integration/scenario-what-if-03-history.integration.spec.js](../../test/integration/scenario-what-if-03-history.integration.spec.js)

` what-if X/L/A: wrong targets, retained history and sessions X01 receipt refuses missing retainer and preserves both customers `

<a id="t1256"></a>**T1256** — [test/integration/scenario-what-if-04-calendar-races.integration.spec.js](../../test/integration/scenario-what-if-04-calendar-races.integration.spec.js)

` what-if T: Phoenix midnight, calendar limits and overlapping billing D02/T01 simultaneous finalizations produce one parent and one explicit conflict `

<a id="t1257"></a>**T1257** — [test/integration/scenario-what-if-04-calendar-races.integration.spec.js](../../test/integration/scenario-what-if-04-calendar-races.integration.spec.js)

` what-if T: Phoenix midnight, calendar limits and overlapping billing T01 edit during rendering preserves $110 unbilled and refuses stale $100 invoice `

<a id="t1258"></a>**T1258** — [test/integration/scenario-what-if-04-calendar-races.integration.spec.js](../../test/integration/scenario-what-if-04-calendar-races.integration.spec.js)

` what-if T: Phoenix midnight, calendar limits and overlapping billing T01 payment during rendering preserves $90 and refuses stale $100 rebill `

<a id="t1259"></a>**T1259** — [test/integration/scenario-what-if-05-csv.integration.spec.js](../../test/integration/scenario-what-if-05-csv.integration.spec.js)

` what-if C: exported descriptions, formula safety and failure paths C01 database export failure is explicit500, unchanged, and retry succeeds `

<a id="t1260"></a>**T1260** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures L01 Super Admin cannot delete the current session user `

<a id="t1261"></a>**T1261** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures L01 malformed deletion ID -1 gives404 `

<a id="t1262"></a>**T1262** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures L01 malformed deletion ID 0 gives404 `

<a id="t1263"></a>**T1263** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures L01 user update succeeds, rolls back on database failure, retries, then refuses a deleted target `

<a id="t1264"></a>**T1264** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures L01 work logged for an employee prevents deleting the employee `

<a id="t1265"></a>**T1265** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures V01 payment refuses nonobject body [] `

<a id="t1266"></a>**T1266** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures V01 retainer refuses nonobject body [] `

<a id="t1267"></a>**T1267** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures V01 retainer refuses nonobject body null `

<a id="t1268"></a>**T1268** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures V01 writeoff refuses nonobject body [] `

<a id="t1269"></a>**T1269** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures X01 a stale invoice reference cannot revive a fully paid current chain `

<a id="t1270"></a>**T1270** — [test/integration/scenario-what-if-06-boundaries.integration.spec.js](../../test/integration/scenario-what-if-06-boundaries.integration.spec.js)

` what-if V/L: validation boundaries and user-history failures X01 user updates refuse malformed, absent and foreign targets without changing users `

<a id="t1271"></a>**T1271** — [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)

` tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001) DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID (8b) a PROCESSED entry (already billed) is refused and stays live `

<a id="t1272"></a>**T1272** — [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)

` tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001) DELETE /timesheets/deleteTimesheetEntry/:timesheetEntryID/:accountID/:userID (8c) an entry that becomes processed between being read and being deleted (concurrent-apply interleaving) is refused, never corrupted `

<a id="t1273"></a>**T1273** — [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)

` tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001) POST /time-tracking/upload/:accountID/:userID (validation and authorization) a file larger than 1 MB -> 400 `

<a id="t1274"></a>**T1274** — [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)

` tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001) POST /time-tracking/upload/:accountID/:userID (validation and authorization) a tracker whose B1 names a different employee than the owner -> 400 `

<a id="t1275"></a>**T1275** — [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)

` tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001) POST /time-tracking/upload/:accountID/:userID (validation and authorization) an Apple Numbers file name -> 400 before any parsing `

<a id="t1276"></a>**T1276** — [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)

` tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001) POST /time-tracking/upload/:accountID/:userID (validation and authorization) an employee token uploading for another owner -> 403 (both the ?ownerUserID and the :userID form) `

<a id="t1277"></a>**T1277** — [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)

` tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001) POST /time-tracking/upload/:accountID/:userID (validation and authorization) an inactive owner -> 400; missing x-file-name -> 400; empty body -> 400 `

<a id="t1278"></a>**T1278** — [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)

` tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001) POST /time-tracking/upload/:accountID/:userID (validation and authorization) invalid percent-encoding in x-file-name -> 400, not a 500 `

<a id="t1279"></a>**T1279** — [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)

` tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001) POST /timesheets/moveToTransactions/:accountID/:userID (7) a reviewer applies the HELD missing-year line with explicit ids: stale hundredth-hour input is ignored and recomputed server-side; inserted exactly once (second call 409), same math as the auto path, lands on Beta’s NEXT statement `

<a id="t1280"></a>**T1280** — [test/integration/tracker-excel-end-to-end.integration.spec.js](../../test/integration/tracker-excel-end-to-end.integration.spec.js)

` tracker Excel end-to-end: template → upload → auto-ingest → invoice PDF (account 9001) POST /timesheets/moveToTransactions/:accountID/:userID (7b) a sub-cent rate override on a manual Time apply is refused (400) and the claim rolls back `

<a id="t1281"></a>**T1281** — [test/integration/transactions-ledger-seams.integration.spec.js](../../test/integration/transactions-ledger-seams.integration.spec.js)

` integration: transaction ledger seams (atomic + locked CRUD, retainer funding, retainer ownership) finding 2 — one transaction under the customer ledger lock an edit queued behind finalize re-reads the stored row after locking and refuses the now-billed entry `

<a id="t1282"></a>**T1282** — [test/integration/transactions-ledger-seams.integration.spec.js](../../test/integration/transactions-ledger-seams.integration.spec.js)

` integration: transaction ledger seams (atomic + locked CRUD, retainer funding, retainer ownership) finding 7 — retainer-funded edits an amount edit re-prices its draw in place, the payment and the job total; an over-draw is refused `

<a id="t1283"></a>**T1283** — [test/integration/transactions-ledger-seams.integration.spec.js](../../test/integration/transactions-ledger-seams.integration.spec.js)

` integration: transaction ledger seams (atomic + locked CRUD, retainer funding, retainer ownership) training-insert SAVEPOINT isolation against a genuine PostgreSQL error a real division-by-zero during the AI training insert is contained by its SAVEPOINT — the entry commits and the connection stays usable `

<a id="t1284"></a>**T1284** — [test/pdfCreator/templateOnePagination.spec.js](../../test/pdfCreator/templateOnePagination.spec.js)

` templateOne statement PDF — pagination refuses a single row that cannot fit on one page, before returning any PDF `

<a id="t1285"></a>**T1285** — [test/pdfCreator/templateOnePagination.spec.js](../../test/pdfCreator/templateOnePagination.spec.js)

` templateOne statement PDF — pagination refuses the reviewer's 71-line near-max description together with its required subtotal `

<a id="t1286"></a>**T1286** — [test/utils/comprehend.spec.js](../../test/utils/comprehend.spec.js)

` comprehend detectAndRedact falls back to string-match redaction on Comprehend failure `

<a id="t1287"></a>**T1287** — [test/utils/piiRedactor.spec.js](../../test/utils/piiRedactor.spec.js)

` piiRedactor assertNoPii / containsAnyName (defense-in-depth invariant) throws when serialized payload contains a customer name `

<a id="t1288"></a>**T1288** — [test/utils/piiRedactor.spec.js](../../test/utils/piiRedactor.spec.js)

` piiRedactor assertNoPii / containsAnyName (defense-in-depth invariant) throws when serialized payload contains an employee name `

