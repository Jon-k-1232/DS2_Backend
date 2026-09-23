// Hard ceiling on page size. Without this, a client (or a compromised/buggy
// one) could request limit=1000000 and force a full-table scan/serialization
// on every paginated endpoint.
const MAX_PAGE_LIMIT = 500;

const getPaginationParams = query => {
   const { page = 1, limit = 10 } = query;

   const pageNumber = parseInt(page, 10);
   const limitNumber = parseInt(limit, 10);

   if (isNaN(pageNumber) || pageNumber < 1 || isNaN(limitNumber) || limitNumber < 1) {
      throw new Error('Invalid pagination parameters. Page and limit must be positive integers.');
   }

   const cappedLimit = Math.min(limitNumber, MAX_PAGE_LIMIT);
   const offset = (pageNumber - 1) * cappedLimit;

   return { page: pageNumber, limit: cappedLimit, offset };
};

const getPaginationMetadata = (totalCount, page, limit) => ({
   page,
   limit,
   totalItems: totalCount,
   totalPages: Math.ceil(totalCount / limit)
});

module.exports = { getPaginationParams, getPaginationMetadata, MAX_PAGE_LIMIT };
