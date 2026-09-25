'use strict';

// Call only after a mutation's transaction has committed. A failed grid reload
// cannot undo that write and must not instruct the user to submit it again.
const reloadWarning = 'Your change was saved. Reload the page to refresh the lists; do not submit the change again.';
const committedFallback = message => ({
   status: 200,
   committed: true,
   // Older CRUD forms display only message, so keep the guidance visible there.
   message: `${message} ${reloadWarning}`,
   warnings: [reloadWarning]
});
async function committedResponse(res, message, loadTables) {
   // Response middleware also performs asynchronous lock-status reads after
   // res.send. Keep the commit outcome available if those reads fail.
   res.locals = res.locals || {};
   res.locals.ds2CommittedOutcome = { message };
   try {
      return res.send({ ...await loadTables(), message, status: 200 });
   } catch (error) {
      console.error('Committed mutation: response refresh failed', error);
      return res.send(committedFallback(message));
   }
}
module.exports = { committedResponse, committedFallback };
