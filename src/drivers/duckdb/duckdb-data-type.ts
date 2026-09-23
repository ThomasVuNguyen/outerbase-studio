import { ColumnTypeSelector } from "../base-driver";

// https://duckdb.org/docs/sql/data_types/overview
export const DUCKDB_DATA_TYPE_SUGGESTION: ColumnTypeSelector = {
  type: "text",
  idTypeName: "INTEGER",
  textTypeName: "VARCHAR",
  typeSuggestions: [
    {
      name: "Integer",
      suggestions: [
        {
          name: "boolean",
          description: "Logical Boolean (true/false)",
        },
        {
          name: "tinyint",
          description: "Signed one-byte integer (-128 to 127)",
        },
        {
          name: "smallint",
          description: "Signed two-byte integer (-32768 to 32767)",
        },
        {
          name: "integer",
          description: "Signed four-byte integer",
        },
        {
          name: "bigint",
          description: "Signed eight-byte integer",
        },
        {
          name: "hugeint",
          description: "Signed sixteen-byte integer",
        },
        {
          name: "uinteger",
          description: "Unsigned four-byte integer",
        },
        {
          name: "ubigint",
          description: "Unsigned eight-byte integer",
        },
      ],
    },
    {
      name: "Real",
      suggestions: [
        { name: "float", description: "4-byte floating point" },
        { name: "double", description: "8-byte floating point" },
        {
          name: "decimal",
          parameters: [
            {
              name: "precision",
              description: "Total number of digits",
              default: "18",
            },
            {
              name: "scale",
              description: "Number of digits after the decimal point",
              default: "3",
            },
          ],
          description: "Fixed-point decimal number",
        },
      ],
    },
    {
      name: "Text",
      suggestions: [
        {
          name: "varchar",
          description: "Variable-length character string",
        },
        {
          name: "text",
          description: "Variable-length character string (alias for VARCHAR)",
        },
        { name: "blob", description: "Binary large object" },
        { name: "uuid", description: "UUID data type" },
      ],
    },
    {
      name: "Date & Time",
      suggestions: [
        { name: "date", description: "Calendar date (year, month, day)" },
        {
          name: "time",
          description: "Time of day (no time zone)",
        },
        {
          name: "timestamp",
          description: "Date and time (no time zone)",
        },
        {
          name: "timestamptz",
          description: "Date and time with time zone (alias for TIMESTAMP WITH TIME ZONE)",
        },
        {
          name: "interval",
          description: "Time interval",
        },
      ],
    },
    {
      name: "Nested",
      suggestions: [
        {
          name: "json",
          description: "JSON data type",
        },
        {
          name: "list",
          description: "Ordered list of values of a single type",
        },
        {
          name: "map",
          description: "Map of key-value pairs",
        },
        {
          name: "struct",
          description: "Named list of fields",
        },
        {
          name: "union",
          description: "Tagged union of types",
        },
      ],
    },
  ],
};
