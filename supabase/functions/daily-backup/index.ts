// Gestione turni - funzione "daily-backup"
// Una volta al giorno invia all'indirizzo scelto dall'admin il file Excel con tutti i turni.
// Chiamata dal pianificatore (cron). Un admin può forzarla con { "force": true }.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as XLSX from "npm:xlsx@0.18.5";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  (JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default as string);
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, { auth: { persistSession: false } });
const BREVO_KEY = Deno.env.get("BREVO_API_KEY");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function isAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await sb.auth.getUser(token);
  if (!data?.user) return false;
  const { data: prof } = await sb.from("profiles").select("role, status").eq("id", data.user.id).single();
  return !!prof && prof.role === "admin" && prof.status === "approved";
}

async function allShifts() {
  const rows: { date: string; email: string; shift: string; order: number }[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb.from("shifts")
      .select("date, email, shift_types!shifts_shift_type_id_fkey(name, sort_order)")
      .order("date").order("email").range(from, from + page - 1);
    if (error) throw error;
    for (const r of data as any[]) rows.push({ date: r.date, email: r.email, shift: r.shift_types.name, order: r.shift_types.sort_order });
    if (!data || data.length < page) break;
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.shift.localeCompare(b.shift) || a.email.localeCompare(b.email));
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  const force = !!body?.force;
  if (force && !(await isAdmin(req))) return json({ error: "Solo per admin" }, 403);

  const { data: s } = await sb.from("app_settings").select("*").eq("id", 1).single();
  if (!s) return json({ error: "Impostazioni mancanti" }, 500);
  if (!force && !s.backup_enabled) return json({ skipped: "backup disattivato" });
  if (!s.backup_email) return json({ error: "Manca l'indirizzo del backup" }, 400);
  if (!BREVO_KEY || !s.sender_email) return json({ error: "Email non configurate (chiave Brevo o mittente)" }, 400);
  // protezione: al massimo un backup automatico ogni 20 ore
  if (!force && s.last_backup_at && Date.now() - new Date(s.last_backup_at).getTime() < 20 * 3600000) {
    return json({ skipped: "backup già inviato di recente" });
  }

  try {
    const rows = await allShifts();
    const aoa: unknown[][] = [["DATA", "DIPENDENTE", "TURNO"]];
    for (const r of rows) {
      const [y, m, d] = r.date.split("-").map(Number);
      aoa.push([new Date(Date.UTC(y, m - 1, d)), r.email, r.shift]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "dd/mm/yyyy" });
    ws["!cols"] = [{ wch: 12 }, { wch: 36 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Turni");
    const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });

    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" }); // AAAA-MM-GG
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: s.sender_email, name: s.sender_name || "Turni" },
        to: [{ email: s.backup_email }],
        subject: `Backup turni ${today}`,
        htmlContent: `<p>In allegato il backup dei turni aggiornato al ${today.split("-").reverse().join("/")} (${rows.length} righe), con tutti i cambi turno già applicati.</p>`,
        attachment: [{ name: `turni_${today}.xlsx`, content: b64 }],
      }),
    });
    if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
    await sb.from("app_settings").update({ last_backup_at: new Date().toISOString() }).eq("id", 1);
    return json({ ok: true, rows: rows.length, to: s.backup_email });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
