"use client";
import { useEffect, useState } from "react";
import { api } from "../api";
import { MESSAGE_TEMPLATE_LABELS, MessageTemplateKey, TEMPLATE_PLACEHOLDERS, DEFAULT_TEMPLATES } from "@/lib/message-templates";

type T = { key: MessageTemplateKey; body: string; enabled: boolean };

/** Edit the WhatsApp messages used after POS bills and for online orders. */
export function MessageTemplatesEditor({ notice }: { notice: (m: string) => void }) {
  const [rows, setRows] = useState<T[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    api<{ rows: T[] }>("/api/admin/message-templates").then((r) => setRows(r.rows)).catch((e) => notice((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function save(t: T) {
    setBusy(t.key);
    try {
      const r = await api<{ message: string }>("/api/admin/message-templates", t);
      notice(r.message);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="form-panel" style={{ marginTop: 24 }}>
      <h2>WhatsApp messages.</h2>
      <p className="subtle">
        Placeholders: {TEMPLATE_PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}. Staff press “Open WhatsApp” and tap Send in WhatsApp.
      </p>
      {rows.map((t) => (
        <div key={t.key} style={{ borderTop: "1px solid #EAD5C0", paddingTop: 14, marginTop: 14 }}>
          <h3 style={{ margin: "0 0 2px" }}>{MESSAGE_TEMPLATE_LABELS[t.key].title}</h3>
          <p className="subtle" style={{ margin: "0 0 8px" }}>{MESSAGE_TEMPLATE_LABELS[t.key].hint}</p>
          {t.key === "pos_bill_whatsapp" && (
            <label className="checkbox-item" style={{ marginBottom: 8 }}>
              <input type="checkbox" checked={t.enabled} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === t.key ? { ...x, enabled: e.target.checked } : x)))} />
              <span>Show the WhatsApp popup after every POS bill</span>
            </label>
          )}
          <textarea rows={7} maxLength={2000} value={t.body} style={{ width: "100%" }}
            onChange={(e) => setRows((rs) => rs.map((x) => (x.key === t.key ? { ...x, body: e.target.value } : x)))} />
          <div className="button-row" style={{ marginTop: 8 }}>
            <button type="button" className="button" disabled={busy === t.key || !t.body.trim()} onClick={() => void save(t)}>
              {busy === t.key ? "Saving…" : "Save message"}
            </button>
            <button type="button" className="text-link" onClick={() => setRows((rs) => rs.map((x) => (x.key === t.key ? { ...x, body: DEFAULT_TEMPLATES[t.key] } : x)))}>
              Reset to default
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
