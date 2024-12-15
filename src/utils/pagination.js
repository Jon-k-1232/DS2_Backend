const getPaginationParams = query => {
   const { page = 1, limit = 10 } = query;

   const pageNumber = parseInt(page, 10);
   const limitNumber = parseInt(limit, 10);

   if (isNaN(pageNumber) || pageNumber < 1 || isNaN(limitNumber) || limitNumber < 1) {
      throw new Error('Invalid pagination parameters. Page and limit must be positive integers.');
   }

   const offset = (pageNumber - 1) * limitNumber;

   return { page: pageNumber, limit: limitNumber, offset };
};

const getPaginationMetadata = (totalCount, page, limit) => ({
   page,
   limit,
   totalItems: totalCount,
   totalPages: Math.ceil(totalCount / limit)
});

module.exports = { getPaginationParams, getPaginationMetadata };
