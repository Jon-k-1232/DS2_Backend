const config = require('../../../config');

// Name of the httpOnly cookie that carries the DS2 session JWT. Holding the
// token in an httpOnly cookie (instead of returning it to JS / sessionStorage)
// means an XSS cannot read or exfiltrate it.
const AUTH_COOKIE_NAME = 'ds2_auth';

// Parse a jsonwebtoken-style duration ("11h", "30m", "7d", "3600s") into ms so
// the cookie lifetime tracks the token's expiry. Falls back to 11h.
const parseDurationMs = value => {
   const fallback = 11 * 60 * 60 * 1000;
   if (!value) return fallback;
   const match = String(value)
      .trim()
      .match(/^(\d+)\s*([smhd])?$/i);
   if (!match) return fallback;
   const amount = Number(match[1]);
   const unit = (match[2] || 's').toLowerCase();
   const unitMs = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
   return amount * (unitMs[unit] || 1000);
};

const cookieOptions = () => ({
   httpOnly: true,
   secure: config.NODE_ENV === 'production',
   sameSite: 'strict',
   path: '/',
   maxAge: parseDurationMs(config.JWT_EXPIRATION)
});

const setAuthCookie = (res, token) => {
   res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
};

const clearAuthCookie = res => {
   const { maxAge, ...rest } = cookieOptions();
   res.clearCookie(AUTH_COOKIE_NAME, rest);
};

module.exports = { AUTH_COOKIE_NAME, setAuthCookie, clearAuthCookie };
