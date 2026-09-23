"use client";
import { Studio } from "@/components/gui/studio";
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from "@/components/gui/toolbar";
import ScreenDropZone from "@/components/screen-dropzone";
import { StudioExtensionManager } from "@/core/extension-manager";
import { createStandardExtensions } from "@/core/standard-extension";
import DuckDBWasmDriver from "@/drivers/database/duckdb-wasm";
import { useAvailableAIAgents } from "@/lib/ai-agent-storage";
import {
  Cloud,
  FolderOpenIcon,
  LucideFile,
  LucideLoader,
  RefreshCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { R2ConfigDialog } from "./r2-config-dialog";

const DUCKDB_FILE_EXTENSIONS = ".duckdb,.db,.parquet,.csv,.json";

export default function PlaygroundEditorBody() {
  const [databaseLoading, setDatabaseLoading] = useState(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [db, setDb] = useState<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [conn, setConn] = useState<any>();
  const [driver, setDriver] = useState<DuckDBWasmDriver>();

  const [fileName, setFilename] = useState("");

  const [r2Open, setR2Open] = useState(false);

  const agentDriver = useAvailableAIAgents(driver);

  /**
   * Initialize DuckDB WASM.
   */
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const duckdb = await import("@duckdb/duckdb-wasm");

      // Select the best bundle for this browser
      const bundles = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(bundles);

      // Create a worker and the database instance
      const worker = new Worker(bundle.mainWorker!);
      const logger = new duckdb.ConsoleLogger();
      const database = new duckdb.AsyncDuckDB(logger, worker);

      await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
      const connection = await database.connect();

      // Automatically configure R2 if previously saved in localStorage
      try {
        const saved = localStorage.getItem("duckdb_r2_config");
        if (saved) {
          const { accountId, accessKeyId, secretAccessKey } = JSON.parse(saved);
          if (accountId && accessKeyId && secretAccessKey) {
            const endpoint = `${accountId.trim()}.r2.cloudflarestorage.com`;
            await connection.query(`SET s3_endpoint='${endpoint}'`);
            await connection.query(`SET s3_access_key_id='${accessKeyId.trim()}'`);
            await connection.query(`SET s3_secret_access_key='${secretAccessKey.trim()}'`);
            await connection.query(`SET s3_url_style='path'`);
            await connection.query(`SET s3_use_ssl=true`);
          }
        }
      } catch (err) {
        console.warn("Could not auto-restore R2 credentials:", err);
      }

      if (!cancelled) {
        setDb(database);
        setConn(connection);
        setDriver(new DuckDBWasmDriver(connection));
        setDatabaseLoading(false);
      }
    }

    init().catch((err) => {
      console.error("Failed to initialize DuckDB WASM:", err);
      if (!cancelled) setDatabaseLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Load a file into the DuckDB instance.
   */
  const loadFile = useCallback(
    async (file: File) => {
      if (!db || !conn) return;

      setFilename(file.name);

      const buffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(buffer);

      const ext = file.name.split(".").pop()?.toLowerCase();

      if (ext === "parquet") {
        await db.registerFileBuffer(file.name, uint8);
        await conn.query(
          `CREATE OR REPLACE TABLE imported AS SELECT * FROM read_parquet('${file.name}')`
        );
      } else if (ext === "csv") {
        await db.registerFileBuffer(file.name, uint8);
        await conn.query(
          `CREATE OR REPLACE TABLE imported AS SELECT * FROM read_csv('${file.name}', auto_detect=true)`
        );
      } else if (ext === "json") {
        await db.registerFileBuffer(file.name, uint8);
        await conn.query(
          `CREATE OR REPLACE TABLE imported AS SELECT * FROM read_json('${file.name}', auto_detect=true)`
        );
      } else if (ext === "duckdb" || ext === "db") {
        // For DuckDB database files — re-instantiate with the file
        try {
          await db.registerFileBuffer(file.name, uint8);
          await conn.query(`ATTACH '${file.name}' AS loaded_db`);
        } catch (e) {
          console.error("Failed to load DuckDB file:", e);
        }
      }

      // Re-create the driver to refresh schema
      if (driver) {
        driver.reload(conn);
      }
    },
    [db, conn, driver]
  );

  /**
   * Callback when a file is dropped on the screen.
   */
  const onFileDrop = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (file?: File, _handler?: FileSystemFileHandle) => {
      if (file) {
        loadFile(file);
      }
    },
    [loadFile]
  );

  /**
   * Open file picker.
   */
  const onOpenClicked = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = DUCKDB_FILE_EXTENSIONS;
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        loadFile(file);
      }
    };
    input.click();
  }, [loadFile]);

  /**
   * Reset the database to a fresh in-memory instance.
   */
  const onResetDatabase = useCallback(async () => {
    if (!db) return;

    if (driver?.hasChanged()) {
      if (
        !confirm(
          "You have some changes. Reset will lose your changes. Do you want to reset?"
        )
      ) {
        return;
      }
    }

    // Close old connection, create new one
    if (conn) {
      await conn.close();
    }
    const newConn = await db.connect();
    setConn(newConn);
    setDriver(new DuckDBWasmDriver(newConn));
    setFilename("");
  }, [db, conn, driver]);

  const extensions = useMemo(() => {
    return new StudioExtensionManager(createStandardExtensions());
  }, []);

  const dom = useMemo(() => {
    if (databaseLoading) {
      return (
        <div className="p-4">
          <LucideLoader className="mb-2 h-12 w-12 animate-spin" />
          <h1 className="mb-2 text-2xl font-bold">Loading DuckDB</h1>
          <p>Please wait. We are initializing DuckDB WASM...</p>
        </div>
      );
    }

    if (driver) {
      return (
        <Studio
          extensions={extensions}
          color="gray"
          name="DuckDB Playground"
          driver={driver}
          containerClassName="w-full h-full"
          agentDriver={agentDriver}
        />
      );
    }

    return (
      <div className="p-4">
        <h1 className="mb-2 text-2xl font-bold">Failed to load DuckDB</h1>
        <p>Something went wrong initializing DuckDB WASM.</p>
      </div>
    );
  }, [databaseLoading, driver, extensions, agentDriver]);

  return (
    <>
      <ScreenDropZone onFileDrop={onFileDrop} />
      <div className="flex h-screen w-screen flex-col">
        <div className="border-b p-1">
          <Toolbar>
            {fileName && (
              <div className="flex items-center gap-1 rounded bg-yellow-300 p-2 text-xs text-black">
                <LucideFile className="h-4 w-4" />
                <span>
                  Loaded <strong>{fileName}</strong>
                </span>
              </div>
            )}

            <ToolbarButton
              text="Open"
              onClick={onOpenClicked}
              icon={<FolderOpenIcon className="h-4 w-4" />}
            />

            <ToolbarSeparator />
            <ToolbarButton
              text="Connect R2"
              icon={<Cloud className="h-4 w-4 text-orange-500" />}
              onClick={() => setR2Open(true)}
            />

            <ToolbarSeparator />
            <ToolbarButton
              text="Reset"
              icon={<RefreshCcw className="h-4 w-4" />}
              onClick={onResetDatabase}
            />
          </Toolbar>
        </div>
        <div className="flex-1 overflow-hidden">{dom}</div>
      </div>

      <R2ConfigDialog
        open={r2Open}
        onOpenChange={setR2Open}
        conn={conn}
        onConfigured={() => {
          if (driver) {
            driver.reload(conn);
          }
        }}
      />
    </>
  );
}
