/** P-12 A9: build an orders CSV from order rows. Pure — no DOM. */
export interface CsvOrderRow {
  id: string;
  status: string;
  total_npr: number;
  payment_method: string | null;
  created_at: string;
}

export function ordersToCsv(rows: CsvOrderRow[]): string {
  const lines: string[][] = [
    ["order_id", "status", "total_npr", "payment_method", "created_at"],
    ...rows.map((o) => [
      o.id,
      o.status,
      String(o.total_npr),
      o.payment_method ?? "",
      o.created_at,
    ]),
  ];
  return lines
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

/** Trigger a CSV download in the browser. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
