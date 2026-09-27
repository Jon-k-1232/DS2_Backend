// Only the exact production environment defaults to enabled. Deliberately use
// exact 'true'/'false' strings: empty, misspelled and unset values use the default.
const environmentSwitchEnabled = (name, env = process.env) =>
   env.NODE_ENV === 'production' ? env[name] !== 'false' : env[name] === 'true';

const realEmailEnabled = () => environmentSwitchEnabled('SEND_REAL_EMAIL');
const scheduledAutomationsEnabled = () => environmentSwitchEnabled('RUN_SCHEDULED_AUTOMATIONS');

module.exports = { environmentSwitchEnabled, realEmailEnabled, scheduledAutomationsEnabled };
