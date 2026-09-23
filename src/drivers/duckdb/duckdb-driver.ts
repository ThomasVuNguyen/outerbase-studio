import { ColumnType } from "@outerbase/sdk-transform";
import {
  ColumnTypeSelector,
  DatabaseResultSet,
  DatabaseSchemaItem,
  DatabaseSchemas,
  DatabaseTableColumn,
  DatabaseTableColumnConstraint,
  DatabaseTableSchema,
  DatabaseTableSchemaChange,
  DatabaseTriggerSchema,
  DatabaseViewSchema,
  DriverFlags,
  QueryableBaseDriver,
} from "../base-driver";
import CommonSQLImplement from "../common-sql-imp";
import { escapeSqlValue } from "../sqlite/sql-helper";
import { DUCKDB_DATA_TYPE_SUGGESTION } from "./duckdb-data-type";

interface DuckDBTableRow {
  table_catalog: string;
  table_schema: string;
  table_name: string;
  table_type: string;
}

interface DuckDBColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  column_default: string | null;
  is_nullable: "YES" | "NO";
  data_type: string;
}

interface DuckDBConstraintRow {
  constraint_name: string;
  table_schema: string;
  table_name: string;
  constraint_type: string;
  column_name: string;
}

export default class DuckDBLikeDriver extends CommonSQLImplement {
  constructor(protected _db: QueryableBaseDriver) {
    super();
  }

  query(stmt: string): Promise<DatabaseResultSet> {
    return this._db.query(stmt);
  }

  transaction(stmts: string[]): Promise<DatabaseResultSet[]> {
    return this._db.transaction(stmts);
  }

  batch(stmts: string[]): Promise<DatabaseResultSet[]> {
    return this._db.batch ? this._db.batch(stmts) : super.batch(stmts);
  }

  close(): void {
    // Do nothing
  }

  columnTypeSelector: ColumnTypeSelector = DUCKDB_DATA_TYPE_SUGGESTION;

  escapeId(id: string) {
    return `"${id.replace(/"/g, '""')}"`;
  }

  escapeValue(value: unknown): string {
    return escapeSqlValue(value);
  }

  getFlags(): DriverFlags {
    return {
      defaultSchema: "main",
      dialect: "duckdb",
      optionalSchema: true,
      supportRowId: false,
      supportBigInt: true,
      supportModifyColumn: false,
      supportCreateUpdateTable: true,
      supportCreateUpdateDatabase: false,
      supportInsertReturning: true,
      supportUpdateReturning: true,
      supportCreateUpdateTrigger: false,
    };
  }

  async getCurrentSchema(): Promise<string | null> {
    try {
      const result = await this.query("SELECT current_schema() AS s");
      const row = result.rows[0] as { s?: string | null } | undefined;
      return row?.s ?? "main";
    } catch {
      return "main";
    }
  }

  async schemas(): Promise<DatabaseSchemas> {
    const schemaSql = `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog')`;
    const tableSql = `SELECT table_catalog, table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog')`;
    const columnSql = `SELECT table_schema, table_name, column_name, ordinal_position, column_default, is_nullable, data_type FROM information_schema.columns WHERE table_schema NOT IN ('information_schema', 'pg_catalog')`;
    const constraintSql = `SELECT
  tc.constraint_name,
  tc.table_schema,
  tc.table_name,
  tc.constraint_type,
  kcu.column_name
FROM
  information_schema.table_constraints AS tc
  LEFT JOIN information_schema.key_column_usage AS kcu
  ON (
    tc.table_schema = kcu.table_schema AND
    tc.table_name = kcu.table_name AND
    tc.constraint_name = kcu.constraint_name
  )
WHERE
  tc.table_schema NOT IN ('information_schema', 'pg_catalog')`;

    const result = await this.batch([
      schemaSql,
      tableSql,
      columnSql,
      constraintSql,
    ]);

    const schemaResult = result[0].rows as unknown as {
      schema_name: string;
    }[];
    const tableResult = result[1].rows as unknown as DuckDBTableRow[];
    const columnsResult = result[2].rows as unknown as DuckDBColumnRow[];
    const constraintResult = result[3]
      .rows as unknown as DuckDBConstraintRow[];

    const schemas: DatabaseSchemas = {};

    for (const schema of schemaResult) {
      schemas[schema.schema_name] = [];
    }

    const tableRecord: Record<string, DatabaseSchemaItem> = {};
    for (const table of tableResult) {
      const key = table.table_schema + "." + table.table_name;

      const tableItem: DatabaseSchemaItem = {
        name: table.table_name,
        schemaName: table.table_schema,
        type: table.table_type === "BASE TABLE" ? "table" : "view",
        tableName: table.table_name,
        tableSchema: {
          columns: [],
          constraints: [],
          pk: [],
          autoIncrement: false,
          schemaName: table.table_schema,
          tableName: table.table_name,
        },
      };

      tableRecord[key] = tableItem;

      if (schemas[table.table_schema]) {
        schemas[table.table_schema].push(tableItem);
      }
    }

    // Add columns to table schema
    for (const column of columnsResult) {
      const columnItem: DatabaseTableColumn = {
        name: column.column_name,
        type: column.data_type,
        constraint: {
          notNull: column.is_nullable === "NO",
          defaultValue: column.column_default,
        },
      };

      const tableKey = column.table_schema + "." + column.table_name;
      const tableSchema = tableRecord[tableKey]?.tableSchema;
      if (tableSchema) {
        tableSchema.columns.push(columnItem);
      }
    }

    // Add constraints to table schema
    const constraintRecord: Record<string, DatabaseTableColumnConstraint> = {};

    for (const constraint of constraintResult) {
      const tableKey = constraint.table_schema + "." + constraint.table_name;
      const constraintKey = tableKey + "." + constraint.constraint_name;

      const constraintItem = constraintRecord[constraintKey] || {
        name: constraint.constraint_name,
        primaryKey: false,
        notNull: false,
        unique: false,
      };

      if (constraint.constraint_type === "PRIMARY KEY") {
        constraintItem.primaryKey = true;
        constraintItem.primaryColumns = [
          ...(constraintItem?.primaryColumns ?? []),
          constraint.column_name,
        ];
      } else if (constraint.constraint_type === "UNIQUE") {
        constraintItem.unique = true;
        constraintItem.uniqueColumns = [constraint.column_name];
      }

      constraintRecord[constraintKey] = constraintItem;
      const tableSchema = tableRecord[tableKey]?.tableSchema;
      if (tableSchema) {
        tableSchema.constraints = [
          ...(tableRecord[tableKey].tableSchema?.constraints ?? []),
          constraintItem,
        ];
      }
    }

    // Building PK
    for (const tableKey in tableRecord) {
      const table = tableRecord[tableKey];
      if (table.tableSchema?.constraints) {
        const pk = table.tableSchema.constraints.find(
          (c) => c.primaryKey
        ) as DatabaseTableColumnConstraint;
        if (pk) {
          table.tableSchema.pk = pk.primaryColumns ?? [];
        }
      }
    }

    return schemas;
  }

  async tableSchema(
    schemaName: string,
    tableName: string
  ): Promise<DatabaseTableSchema> {
    const columnsResult = (
      await this.query(
        `SELECT table_schema, table_name, column_name, ordinal_position, column_default, is_nullable, data_type FROM information_schema.columns WHERE table_schema = ${this.escapeValue(schemaName)} AND table_name = ${this.escapeValue(tableName)} ORDER BY ordinal_position`
      )
    ).rows as unknown as DuckDBColumnRow[];

    const constraintResult = (
      await this.query(`SELECT
  tc.constraint_name,
  tc.table_schema,
  tc.table_name,
  tc.constraint_type,
  kcu.column_name
FROM
  information_schema.table_constraints AS tc
  LEFT JOIN information_schema.key_column_usage AS kcu
  ON (
    tc.table_schema = kcu.table_schema AND
    tc.table_name = kcu.table_name AND
    tc.constraint_name = kcu.constraint_name
  )
WHERE
  tc.table_schema = ${this.escapeValue(schemaName)} AND tc.table_name = ${this.escapeValue(tableName)}`)
    ).rows as unknown as DuckDBConstraintRow[];

    const constraintRecord: Record<string, DatabaseTableColumnConstraint> = {};
    for (const constraint of constraintResult.filter(
      (f) => f.column_name !== null
    )) {
      const key = constraint.constraint_name;
      const constraintItem = constraintRecord[key] || {
        name: constraint.constraint_name,
        primaryKey: false,
        notNull: false,
        unique: false,
      };

      if (constraint.constraint_type === "PRIMARY KEY") {
        constraintItem.primaryKey = true;
        constraintItem.primaryColumns = [
          ...(constraintItem?.primaryColumns ?? []),
          constraint.column_name,
        ];
      } else if (constraint.constraint_type === "UNIQUE") {
        constraintItem.unique = true;
        constraintItem.uniqueColumns = [constraint.column_name];
      }

      constraintRecord[key] = constraintItem;
    }

    const pkColumn =
      Object.values(constraintRecord).find((c) => c.primaryKey)
        ?.primaryColumns ?? [];

    const tableSchema: DatabaseTableSchema = {
      columns: columnsResult.map((column) => ({
        name: column.column_name,
        type: column.data_type,
        constraint: {
          notNull: column.is_nullable === "NO",
          defaultValue: column.column_default,
          primaryKey: pkColumn.includes(column.column_name),
        },
      })),
      constraints: Object.values(constraintRecord),
      pk: pkColumn,
      autoIncrement: false,
      schemaName,
      tableName,
    };

    return tableSchema;
  }

  trigger(): Promise<DatabaseTriggerSchema> {
    throw new Error("DuckDB does not support triggers");
  }

  // DuckDB doesn't have a schema change generation system like Postgres/SQLite yet.
  // For now, return basic ALTER TABLE statements.
  createUpdateTableSchema(change: DatabaseTableSchemaChange): string[] {
    const stmts: string[] = [];
    const schemaName = change.schemaName ?? "main";
    const tableName = change.name.new ?? change.name.old ?? "";

    // Rename table
    if (change.name.old && change.name.new && change.name.old !== change.name.new) {
      stmts.push(
        `ALTER TABLE ${this.escapeId(schemaName)}.${this.escapeId(change.name.old)} RENAME TO ${this.escapeId(change.name.new)}`
      );
    }

    // Add new columns
    for (const col of change.columns) {
      if (col.old === null && col.new) {
        const notNull = col.new.constraint?.notNull ? " NOT NULL" : "";
        const defaultVal = col.new.constraint?.defaultValue
          ? ` DEFAULT ${this.escapeValue(col.new.constraint.defaultValue)}`
          : "";
        stmts.push(
          `ALTER TABLE ${this.escapeId(schemaName)}.${this.escapeId(tableName)} ADD COLUMN ${this.escapeId(col.new.name)} ${col.new.type}${notNull}${defaultVal}`
        );
      }

      // Drop columns
      if (col.old && col.new === null) {
        stmts.push(
          `ALTER TABLE ${this.escapeId(schemaName)}.${this.escapeId(tableName)} DROP COLUMN ${this.escapeId(col.old.name)}`
        );
      }

      // Rename columns
      if (col.old && col.new && col.old.name !== col.new.name) {
        stmts.push(
          `ALTER TABLE ${this.escapeId(schemaName)}.${this.escapeId(tableName)} RENAME COLUMN ${this.escapeId(col.old.name)} TO ${this.escapeId(col.new.name)}`
        );
      }

      // Change type
      if (col.old && col.new && col.old.type !== col.new.type) {
        stmts.push(
          `ALTER TABLE ${this.escapeId(schemaName)}.${this.escapeId(tableName)} ALTER COLUMN ${this.escapeId(col.new.name)} SET DATA TYPE ${col.new.type}`
        );
      }
    }

    return stmts;
  }

  createUpdateDatabaseSchema(): string[] {
    throw new Error("Not implemented");
  }

  createTrigger(): string {
    throw new Error("DuckDB does not support triggers");
  }

  dropTrigger(): string {
    throw new Error("DuckDB does not support triggers");
  }

  async view(schemaName: string, name: string): Promise<DatabaseViewSchema> {
    const sql = `SELECT sql FROM duckdb_views() WHERE schema_name = ${this.escapeValue(schemaName)} AND view_name = ${this.escapeValue(name)}`;
    const result = await this.query(sql);

    const viewRow = result.rows[0] as { sql: string } | undefined;
    if (!viewRow) throw new Error("View does not exist");

    // Extract the SELECT statement from the CREATE VIEW statement
    const createSql = viewRow.sql;
    const asIndex = createSql.toUpperCase().indexOf(" AS ");
    const statement = asIndex >= 0 ? createSql.substring(asIndex + 4).trim() : createSql;

    return {
      schemaName,
      name,
      statement,
    };
  }

  createView(view: DatabaseViewSchema): string {
    return `CREATE VIEW ${this.escapeId(view.schemaName)}.${this.escapeId(view.name)} AS ${view.statement}`;
  }

  dropView(schemaName: string, name: string): string {
    return `DROP VIEW IF EXISTS ${this.escapeId(schemaName)}.${this.escapeId(name)}`;
  }

  inferTypeFromHeader(): ColumnType | undefined {
    return undefined;
  }
}
