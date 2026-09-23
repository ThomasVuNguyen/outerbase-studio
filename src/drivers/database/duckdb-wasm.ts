import {
  DatabaseHeader,
  DatabaseResultSet,
  DatabaseRow,
  QueryableBaseDriver,
} from "@/drivers/base-driver";
import DuckDBLikeDriver from "../duckdb/duckdb-driver";

/**
 * DuckDB WASM queryable that wraps a duckdb-wasm AsyncDuckDBConnection.
 *
 * The connection object is typed as `any` to avoid importing the duckdb-wasm
 * types at the module level (they include WASM-specific dependencies that
 * break SSR). The actual type is `AsyncDuckDBConnection` from @duckdb/duckdb-wasm.
 */
class DuckDBWasmQueryable implements QueryableBaseDriver {
  public hasRowsChanged: boolean = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private conn: any) {}

  async transaction(stmts: string[]): Promise<DatabaseResultSet[]> {
    const r: DatabaseResultSet[] = [];

    await this.conn.query("BEGIN TRANSACTION");
    try {
      for (const s of stmts) {
        r.push(await this.query(s));
      }
      await this.conn.query("COMMIT");
    } catch (e) {
      await this.conn.query("ROLLBACK");
      throw e;
    }

    return r;
  }

  async query(stmt: string): Promise<DatabaseResultSet> {
    const sql = typeof stmt === "string" ? stmt : String(stmt);

    const startTime = Date.now();
    const arrowResult = await this.conn.query(sql);
    const endTime = Date.now();

    // Extract column metadata from the Arrow schema
    const schema = arrowResult.schema;
    const headerSet = new Set<string>();

    const headers: DatabaseHeader[] = schema.fields.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (field: any) => {
        let renameColName = field.name as string;

        for (let i = 0; i < 20; i++) {
          if (!headerSet.has(renameColName)) break;
          renameColName = `__${field.name}_${i}`;
        }

        headerSet.add(renameColName);

        return {
          name: renameColName,
          displayName: field.name as string,
          originalType: String(field.type),
          type: undefined,
        };
      }
    );

    // Convert Arrow table to array of row objects
    const rows: DatabaseRow[] = [];
    const numRows = arrowResult.numRows;

    for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
      const row: DatabaseRow = {};
      for (let colIdx = 0; colIdx < headers.length; colIdx++) {
        const column = arrowResult.getChildAt(colIdx);
        let value = column?.get(rowIdx);

        // Convert BigInt to number for display if it fits, otherwise string
        if (typeof value === "bigint") {
          if (
            value >= Number.MIN_SAFE_INTEGER &&
            value <= Number.MAX_SAFE_INTEGER
          ) {
            value = Number(value);
          } else {
            value = value.toString();
          }
        }

        // Convert Uint8Array to regular array for display
        if (value instanceof Uint8Array) {
          value = Array.from(value);
        }

        row[headers[colIdx].name] = value;
      }
      rows.push(row);
    }

    // Check if we had rows modified (for DML statements)
    const upperSql = sql.trim().toUpperCase();
    if (
      upperSql.startsWith("INSERT") ||
      upperSql.startsWith("UPDATE") ||
      upperSql.startsWith("DELETE") ||
      upperSql.startsWith("CREATE") ||
      upperSql.startsWith("DROP") ||
      upperSql.startsWith("ALTER")
    ) {
      this.hasRowsChanged = true;
    }

    return {
      headers,
      rows,
      stat: {
        rowsAffected: headers.length === 0 ? numRows : 0,
        rowsRead: null,
        rowsWritten: null,
        queryDurationMs: endTime - startTime,
      },
    };
  }
}

export default class DuckDBWasmDriver extends DuckDBLikeDriver {
  protected queryable: DuckDBWasmQueryable;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(conn: any) {
    const queryable = new DuckDBWasmQueryable(conn);
    super(queryable);
    this.queryable = queryable;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reload(conn: any) {
    this.queryable = new DuckDBWasmQueryable(conn);
    this._db = this.queryable;
  }

  resetChange() {
    this.queryable.hasRowsChanged = false;
  }

  hasChanged() {
    return this.queryable.hasRowsChanged;
  }
}
