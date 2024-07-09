/**
 *  Format data for Mui Grid
 * @param {*} data  - Array of objects
 * @returns  - Object with columns and rows for Mui Grid
 */
const createGrid = data => {
   if (data[0]) {
      const headers = Object.keys(data[0]);

      const columns = headers.map((header, i) => ({
         field: header,
         id: i,
         headerName: header.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
      }));

      const rows = data.map((rowData, i) => {
         const row = {};
         headers.forEach(header => {
            row.id = i;
            row[header] = rowData[header];
         });
         return row;
      });

      return { columns, rows };
   }
   return { columns: [], rows: [] };
};

/**
 * Filter the grid by column name
 * @param {*} data - [], array of data
 * @param {*} columns - [array of strings], columns to filter by
 * @returns {} - {columns: [], rows: []}, object with columns and rows for Mui Grid
 */
const filterGridByColumnName = (data, columns) => {
   const filteredColumns = data.columns.filter(col => columns.includes(col.field));

   const filteredRows = data.rows.map(row => {
      return filteredColumns.reduce(
         (acc, col) => {
            acc[col.field] = row[col.field];
            return acc;
         },
         // Initialize with the 'id' field
         { id: row.id }
      );
   });

   return {
      columns: filteredColumns,
      rows: filteredRows
   };
};

/**
 * Create the row and column data for a tree grid
 * @param {*} data
 * @param {*} rowID
 * @param {*} parentProperty
 * @returns
 */
const generateTreeGridData = (data, rowID, parentProperty) => {
   if (!data.length) return { rows: [], columns: [] };
   if (!rowID.length || !parentProperty.length) throw new Error('Property is required for tree grid.');

   // Generate rows
   const map = new Map();
   data.forEach(item => {
      map.set(item[rowID], { ...item, children: [] });
   });

   const rootItem = [];
   map.forEach(item => {
      if (item[parentProperty]) {
         const parentItem = map.get(item[parentProperty]);
         parentItem && parentItem.children.push(item);
      } else {
         rootItem.push(item);
      }
   });

   // Generate columns
   const firstParentObject = data[0];
   const columns = Object.keys(firstParentObject)
      .filter(key => key !== 'children')
      .map(key => ({
         field: key,
         headerName: key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()),
         width: 150
      }));

   return {
      rows: rootItem,
      columns: columns
   };
};

module.exports = { createGrid, filterGridByColumnName, generateTreeGridData };
