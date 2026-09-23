"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Cloud, Key } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface R2ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn?: any;
  onConfigured?: () => void;
}

const STORAGE_KEY = "duckdb_r2_config";

export function R2ConfigDialog({
  open,
  onOpenChange,
  conn,
  onConfigured,
}: R2ConfigDialogProps) {
  const [accountId, setAccountId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [bucketName, setBucketName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        setAccountId(parsed.accountId ?? "");
        setAccessKeyId(parsed.accessKeyId ?? "");
        setSecretAccessKey(parsed.secretAccessKey ?? "");
        setBucketName(parsed.bucketName ?? "");
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!conn) {
      toast.error("DuckDB connection is not ready");
      return;
    }

    if (!accountId.trim() || !accessKeyId.trim() || !secretAccessKey.trim()) {
      toast.error("Please provide Account ID, Access Key ID, and Secret Access Key");
      return;
    }

    setSaving(true);
    try {
      const endpoint = `${accountId.trim()}.r2.cloudflarestorage.com`;

      // Configure DuckDB S3 / R2 parameters
      await conn.query(`SET s3_endpoint='${endpoint}'`);
      await conn.query(`SET s3_access_key_id='${accessKeyId.trim()}'`);
      await conn.query(`SET s3_secret_access_key='${secretAccessKey.trim()}'`);
      await conn.query(`SET s3_url_style='path'`);
      await conn.query(`SET s3_use_ssl=true`);

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          accountId: accountId.trim(),
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
          bucketName: bucketName.trim(),
        })
      );

      toast.success(
        <div>
          <strong>Cloudflare R2 configured!</strong>
          <p className="text-xs text-muted-foreground mt-1">
            You can query datasets using:<br />
            <code className="font-mono bg-muted p-0.5 rounded">
              SELECT * FROM &apos;s3://{bucketName ? bucketName.trim() : "my-bucket"}/data.parquet&apos;
            </code>
          </p>
        </div>,
        { duration: 8000 }
      );

      onOpenChange(false);
      onConfigured?.();
    } catch (e: any) {
      console.error("Failed to configure R2:", e);
      toast.error(`Failed to configure R2: ${e?.message ?? String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [conn, accountId, accessKeyId, secretAccessKey, bucketName, onOpenChange, onConfigured]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-orange-500" />
            <DialogTitle>Cloudflare R2 Configuration</DialogTitle>
          </div>
          <DialogDescription>
            Connect Cloudflare R2 bucket credentials to query remote Parquet, CSV, or JSON datasets directly in DuckDB.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="r2-account-id">Cloudflare Account ID</Label>
            <Input
              id="r2-account-id"
              placeholder="e.g. 7c9a184e..."
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="r2-access-key">R2 Access Key ID</Label>
            <Input
              id="r2-access-key"
              placeholder="e.g. 1a2b3c4d5e6f..."
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="r2-secret-key">R2 Secret Access Key</Label>
            <Input
              id="r2-secret-key"
              type="password"
              placeholder="e.g. 9z8y7x6w..."
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="r2-bucket">Default Bucket Name (Optional)</Label>
            <Input
              id="r2-bucket"
              placeholder="e.g. analytics-data"
              value={bucketName}
              onChange={(e) => setBucketName(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md bg-secondary/50 p-2.5 text-xs text-muted-foreground flex gap-2 items-start">
          <Key className="h-4 w-4 shrink-0 text-orange-500 mt-0.5" />
          <span>
            Credentials are saved in your browser&apos;s local storage and used directly in DuckDB sessions.
          </span>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-orange-600 hover:bg-orange-700 text-white">
            {saving ? "Configuring..." : "Save & Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
