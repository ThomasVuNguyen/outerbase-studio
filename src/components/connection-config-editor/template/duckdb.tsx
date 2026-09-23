import { ConnectionTemplateList } from "@/app/(outerbase)/base-template";
import { CommonConnectionConfigTemplate } from "..";

const template: CommonConnectionConfigTemplate = [
  {
    columns: [
      {
        name: "filehandler",
        label: "DuckDB / Parquet / CSV / JSON File",
        type: "file",
        required: false,
        placeholder: "Optional file to attach or leave empty for in-memory",
      },
    ],
  },
];

export const DuckDBConnectionTemplate: ConnectionTemplateList = {
  template,
  localFrom: (value) => {
    return {
      name: value.name,
      filehandler: value.file_handler,
    };
  },
  localTo: (value) => {
    return {
      name: value.name,
      driver: "duckdb",
      file_handler: value.filehandler,
    };
  },
};
