const unableToCompleteRequest = (res, reason, code) => {
  res.send({
    message: reason,
    status: code
  });
};

module.exports = { unableToCompleteRequest };
