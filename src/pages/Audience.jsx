import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Search, Upload, X } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../state/AuthContext";

const blank = { email: "", firstName: "", lastName: "", company: "", tags: "" };
const canManageRole = role => ["OWNER", "ADMIN", "EDITOR"].includes(role);

function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); if (row.some(value => value.trim())) rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  if (!rows.length) throw new Error("The CSV file is empty.");
  if (rows.length - 1 > 10000) throw new Error("CSV files can contain up to 10,000 data rows.");
  return rows;
}

function downloadInvalid(rows) {
  const quote = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const csv = ["row,email,reason", ...rows.map(r => [r.row, r.email, r.reason].map(quote).join(","))].join("\r\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = "invalid-contacts.csv"; link.click(); URL.revokeObjectURL(link.href);
}

export default function Audience() {
  const { user, workspace } = useAuth();
  const role = workspace?.role || user?.role || "VIEWER";
  const writable = canManageRole(role);
  const [contacts, setContacts] = useState([]), [total, setTotal] = useState(0), [pages, setPages] = useState(1);
  const [page, setPage] = useState(1), [query, setQuery] = useState(""), [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState(""), [tag, setTag] = useState(""), [tags, setTags] = useState([]), [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [modal, setModal] = useState(""), [editing, setEditing] = useState(null), [form, setForm] = useState(blank), [busy, setBusy] = useState(false);
  const [bulkTag, setBulkTag] = useState(""); const [csvStep, setCsvStep] = useState(1), [csvRows, setCsvRows] = useState([]), [csvHeaders, setCsvHeaders] = useState([]), [mapping, setMapping] = useState({}), [importProgress, setImportProgress] = useState(0), [importResult, setImportResult] = useState(null), [consent, setConsent] = useState(false);
  const params = useMemo(() => new URLSearchParams({ q: debounced, status, tag }).toString(), [debounced, status, tag]);

  useEffect(() => { const timer = setTimeout(() => { setDebounced(query); setPage(1); }, 300); return () => clearTimeout(timer); }, [query]);
  async function refresh() {
    setLoading(true); setError("");
    try {
      const [data, tagData] = await Promise.all([api(`/contacts?page=${page}&limit=20&${params}`), api("/contacts/tags")]);
      setContacts(data.contacts || []); setTotal(data.total || 0); setPages(data.pages || 1); setTags(tagData.tags || []);
      setSelected(previous => previous.filter(id => data.contacts?.some(c => c.id === id)));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [page, params]);
  const selectedPage = contacts.length > 0 && contacts.every(c => selected.includes(c.id));
  function togglePage() { setSelected(selectedPage ? selected.filter(id => !contacts.some(c => c.id === id)) : [...new Set([...selected, ...contacts.map(c => c.id)])]); }
  function openAdd() { setEditing(null); setForm(blank); setModal("edit"); }
  function openEdit(contact) { setEditing(contact); setForm({ ...contact, tags: (contact.tags || []).join(", ") }); setModal("edit"); }
  async function saveContact(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const payload = { email: form.email, firstName: form.firstName, lastName: form.lastName, company: form.company, tags: form.tags.split(",").map(t => t.trim()).filter(Boolean) };
      await api(editing ? `/contacts/${editing.id}` : "/contacts", { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setModal(""); await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function confirmAction(kind, contact) {
    const label = kind === "delete" ? `Delete ${contact ? contact.email : `${selected.length} contacts`}?` : kind === "bulkDelete" ? `Delete ${selected.length} selected contacts?` : kind === "unsubscribe" ? `Unsubscribe ${contact.email}?` : "";
    if (label && !window.confirm(label)) return;
    try {
      if (kind === "bulk") await api("/contacts/bulk", { method: "POST", body: JSON.stringify({ action: bulkTag.action, ids: selected, tag: bulkTag.value }) });
      else if (kind === "bulkDelete") await api("/contacts/bulk", { method: "POST", body: JSON.stringify({ action: "delete", ids: selected }) });
      else if (kind === "delete") await api(`/contacts/${contact.id}`, { method: "DELETE" });
      else if (kind === "unsubscribe") await api(`/contacts/${contact.id}`, { method: "PATCH", body: JSON.stringify({ status: "UNSUBSCRIBED" }) });
      setModal(""); setSelected([]); await refresh();
    } catch (e) { setError(e.message); }
  }
  async function runBulk(action) {
    if (action === "addTag" || action === "removeTag") {
      if (!bulkTag.value?.trim()) { setError("Enter a tag name first."); return; }
    }
    if (action === "unsubscribe" && !window.confirm(`Unsubscribe ${selected.length} selected contacts?`)) return;
    try {
      await api("/contacts/bulk", { method: "POST", body: JSON.stringify({ action, ids: selected, tag: bulkTag.value }) });
      setSelected([]); await refresh();
    } catch (e) { setError(e.message); }
  }
  async function selectCsv(file) {
    if (!file) return;
    try {
      const parsed = parseCsv(await file.text()); const headers = parsed[0].map((h, i) => h.trim() || `Column ${i + 1}`);
      setCsvHeaders(headers); setCsvRows(parsed.slice(1).map(row => Object.fromEntries(headers.map((header, i) => [header, row[i] || ""]))));
      const initial = {};
      for (const field of ["email", "firstName", "lastName", "company", "tags"]) initial[field] = headers.find(h => h.toLowerCase().replace(/[ _-]/g, "") === field.toLowerCase()) || "";
      setMapping(initial); setCsvStep(2); setImportResult(null); setError("");
    } catch (e) { setError(e.message); }
  }
  async function importCsv() {
    if (!consent) return;
    setBusy(true); setImportProgress(0); setError("");
    const mapped = csvRows.map((row, i) => {
      const email = row[mapping.email]?.trim() || "";
      const invalid = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      return { row: i + 2, email, reason: invalid ? "Invalid email address" : "", data: {
        email, firstName: row[mapping.firstName]?.trim() || "", lastName: row[mapping.lastName]?.trim() || "", company: row[mapping.company]?.trim() || "",
        tags: (row[mapping.tags] || "").split(/[;,]/).map(t => t.trim()).filter(Boolean)
      } };
    });
    const invalid = mapped.filter(r => r.reason).map(({ row, email, reason }) => ({ row, email, reason }));
    const valid = mapped.filter(r => !r.reason); let imported = 0, duplicates = 0;
    try {
      for (let i = 0; i < valid.length; i += 500) {
        const result = await api("/contacts/import", { method: "POST", body: JSON.stringify({ rows: valid.slice(i, i + 500).map(r => r.data), consentConfirmed: true }) });
        imported += result.imported || 0; duplicates += result.duplicates || 0;
        invalid.push(...(result.invalid || []).map(r => ({ ...r, row: valid[i + r.row - 1]?.row || r.row })));
        setImportProgress(Math.min(100, Math.round((Math.min(i + 500, valid.length) / Math.max(valid.length, 1)) * 100)));
      }
      setImportProgress(100); setImportResult({ imported, duplicates, invalid }); await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const exportHref = `/api/contacts/export?${new URLSearchParams({ q: debounced, status, tag }).toString()}`;

  return <div className="page-stack">
    <div className="page-title-row"><div><h1>Audience / Contacts</h1><p className="muted">{total.toLocaleString()} contacts · {role.toLowerCase()} access</p></div><div className="audience-actions"><a className="soft-button" href={exportHref}><Download size={15}/> Export CSV</a>{writable && <><button className="soft-button" onClick={() => { setModal("import"); setCsvStep(1); setImportResult(null); setConsent(false); }}><Upload size={15}/> Import CSV</button><button className="primary-button" onClick={openAdd}><Plus size={16}/> Add Contact</button></>}</div></div>
    <div className="audience-filters"><label className="search-box"><Search size={15}/><input placeholder="Search email, name, company" value={query} onChange={e => setQuery(e.target.value)}/></label><select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="SUBSCRIBED">Subscribed</option><option value="UNSUBSCRIBED">Unsubscribed</option><option value="BOUNCED">Bounced</option><option value="COMPLAINED">Complained</option></select><select value={tag} onChange={e => { setTag(e.target.value); setPage(1); }}><option value="">All tags</option>{tags.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
    {notice && <p className="notice">{notice}</p>}{error && <p role="alert" className="error-box">{error}</p>}
    {writable && selected.length > 0 && <div className="bulk-toolbar"><span>{selected.length} selected</span><input aria-label="Tag" placeholder="Tag name" value={bulkTag.value || ""} onChange={e => setBulkTag({ ...bulkTag, value: e.target.value })}/><button className="soft-button" onClick={() => runBulk("addTag")}>Add tag</button><button className="soft-button" onClick={() => runBulk("removeTag")}>Remove tag</button><button className="soft-button" onClick={() => runBulk("unsubscribe")}>Unsubscribe</button><button className="soft-button" onClick={() => confirmAction("bulkDelete")}>Delete</button></div>}
    <div className="panel table-panel"><div className="table-scroll"><table><thead><tr><th>{writable && <input type="checkbox" aria-label="Select current page" checked={selectedPage} onChange={togglePage}/>}</th><th>Email</th><th>Name</th><th>Company</th><th>Status</th><th>Tags</th><th>Created</th>{writable && <th>Actions</th>}</tr></thead><tbody>
      {loading ? <tr><td colSpan={writable ? 8 : 7}>Loading contacts…</td></tr> : contacts.length === 0 ? <tr><td colSpan={writable ? 8 : 7}>No contacts match these filters.</td></tr> : contacts.map(c => <tr key={c.id}><td>{writable && <input type="checkbox" aria-label={`Select ${c.email}`} checked={selected.includes(c.id)} onChange={() => setSelected(old => old.includes(c.id) ? old.filter(id => id !== c.id) : [...old, c.id])}/>}</td><td>{c.email}</td><td>{[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}</td><td>{c.company || "—"}</td><td><span className={`status ${c.status === "SUBSCRIBED" ? "good" : "muted-status"}`}>{c.status}</span></td><td>{(c.tags || []).join(", ") || "—"}</td><td>{new Date(c.createdAt).toLocaleDateString()}</td>{writable && <td><div className="row-actions"><button className="soft-button" onClick={() => openEdit(c)}>Edit</button><button className="soft-button" onClick={() => confirmAction("unsubscribe", c)} disabled={c.status !== "SUBSCRIBED"}>Unsubscribe</button><button className="soft-button" onClick={() => confirmAction("delete", c)}>Delete</button></div></td>}</tr>)}
    </tbody></table></div><div className="pagination"><span>Page {page} of {pages} · {total} total</span><div><button className="soft-button" disabled={page <= 1 || loading} onClick={() => setPage(v => v - 1)}>Previous</button> <button className="soft-button" disabled={page >= pages || loading} onClick={() => setPage(v => v + 1)}>Next</button></div></div></div>

    {modal === "edit" && <div className="modal-backdrop"><div className="modal"><div className="modal-head"><h2>{editing ? "Edit contact" : "Add contact"}</h2><button className="icon-button" onClick={() => setModal("")}><X size={18}/></button></div><form onSubmit={saveContact}>{["email", "firstName", "lastName", "company", "tags"].map(field => <label className="field-label" key={field}>{field === "tags" ? "Tags (comma separated)" : field.replace(/[A-Z]/g, m => ` ${m}`).replace(/^./, m => m.toUpperCase())}<input required={field === "email"} type={field === "email" ? "email" : "text"} value={form[field] || ""} onChange={e => setForm({ ...form, [field]: e.target.value })} disabled={!!editing && field === "email"}/></label>)}<div className="modal-actions"><button type="button" className="soft-button" onClick={() => setModal("")}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save contact"}</button></div></form></div></div>}
    {modal === "import" && <div className="modal-backdrop"><div className="modal import-modal"><div className="modal-head"><h2>Import contacts · Step {csvStep} of 3</h2><button className="icon-button" onClick={() => setModal("")}><X size={18}/></button></div>
      {csvStep === 1 && <><p className="muted">Choose a CSV file with a header row. Up to 10,000 contacts are supported.</p><label className="field-label">CSV file<input type="file" accept=".csv,text/csv" onChange={e => selectCsv(e.target.files?.[0])}/></label></>}
      {csvStep === 2 && <><p className="muted">Map your CSV columns. Preview shows the first five data rows.</p><div className="mapping-grid">{["email", "firstName", "lastName", "company", "tags"].map(field => <label className="field-label" key={field}>{field}<select value={mapping[field]} onChange={e => setMapping({ ...mapping, [field]: e.target.value })}><option value="">Not mapped</option>{csvHeaders.map(h => <option key={h}>{h}</option>)}</select></label>)}</div><div className="table-scroll"><table><thead><tr>{["Email", "First name", "Last name", "Company", "Tags"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{csvRows.slice(0, 5).map((r, i) => <tr key={i}>{["email", "firstName", "lastName", "company", "tags"].map(field => <td key={field}>{r[mapping[field]] || "—"}</td>)}</tr>)}</tbody></table></div><div className="modal-actions"><button className="soft-button" onClick={() => setCsvStep(1)}>Back</button><button className="primary-button" disabled={!mapping.email} onClick={() => setCsvStep(3)}>Continue</button></div></>}
      {csvStep === 3 && <>{importResult ? <><p>Import finished: {importResult.imported} imported, {importResult.duplicates} duplicates, {importResult.invalid.length} invalid.</p>{importResult.invalid.length > 0 && <button className="soft-button" onClick={() => downloadInvalid(importResult.invalid)}>Download invalid rows CSV</button>}<div className="modal-actions"><button className="primary-button" onClick={() => setModal("")}>Done</button></div></> : <><p className="muted">Review {csvRows.length} rows. Existing unsubscribed contacts will stay unsubscribed.</p><label className="consent-check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)}/> I confirm these contacts gave consent to receive email.</label><progress value={importProgress} max="100"/><p>{importProgress}%</p><div className="modal-actions"><button className="soft-button" disabled={busy} onClick={() => setCsvStep(2)}>Back</button><button className="primary-button" disabled={!consent || busy} onClick={importCsv}>{busy ? "Importing…" : "Start import"}</button></div></>}</>}
    </div></div>}
  </div>;
}
