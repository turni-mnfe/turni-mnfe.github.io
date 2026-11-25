// Gestione turni - funzione "notify"
// Invia le email in coda (richieste di cambio, risposte, turni caricati).
// Viene "svegliata" dal database; non riceve dati: legge solo la coda.
// Con { "test": true } e un utente admin, invia un'email di prova all'admin.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

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

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const itDate = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" });
const shortDate = (d: string) => d.split("-").reverse().join("/");

async function sendEmail(settings: any, to: string, subject: string, body: string) {
  if (!BREVO_KEY) throw new Error("BREVO_API_KEY mancante");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1b1f24">
    ${body}
    <p style="margin-top:24px"><a href="${esc(settings.app_url)}" style="background:#1f6feb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Apri l'app turni</a></p>
    <p style="color:#667085;font-size:12px;margin-top:24px">Ricevi questa email perché nel tuo profilo hai scelto le notifiche via email. Puoi cambiarle da Profilo → Notifiche.</p>
  </div>`;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: settings.sender_email, name: settings.sender_name || "Turni" },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

// Restituisce le email (tra quelle indicate) di chi ha scelto le notifiche via email
async function emailRecipients(profileIds: string[] | null): Promise<string[]> {
  let q = sb.from("profiles").select("id, email").eq("status", "approved");
  if (profileIds) q = q.in("id", profileIds);
  const { data: profs, error } = await q;
  if (error) throw error;
  if (!profs?.length) return [];
  const { data: sets, error: e2 } = await sb.from("user_settings").select("user_id, notify_mode").in("user_id", profs.map((p) => p.id));
  if (e2) throw e2;
  const wants = new Set((sets || []).filter((s) => s.notify_mode === "email").map((s) => s.user_id));
  return profs.filter((p) => wants.has(p.id)).map((p) => p.email);
}

async function loadRequest(id: number) {
  const { data, error } = await sb.from("swap_requests")
    .select(`*, req:people!swap_requests_requester_email_fkey(display_name), tgt:people!swap_requests_target_email_fkey(display_name),
             rt:shift_types!swap_requests_requester_type_id_fkey(name), tt:shift_types!swap_requests_target_type_id_fkey(name)`)
    .eq("id", id).single();
  if (error) throw error;
  return data;
}

async function handle(item: any, settings: any) {
  if (item.kind === "swap_request") {
    const r = await loadRequest(item.payload.id);
    const to = await emailRecipients([r.target_id]);
    for (const email of to) {
      await sendEmail(settings, email, `Richiesta di cambio turno da ${r.req?.display_name}`, `
        <p><b>${esc(r.req?.display_name)}</b> ti chiede un cambio turno per <b>${esc(itDate(r.date))}</b>.</p>
        <p>Tu: ${esc(r.tt?.name)} → <b>${esc(r.rt?.name)}</b><br>${esc(r.req?.display_name)}: ${esc(r.rt?.name)} → <b>${esc(r.tt?.name)}</b></p>
        ${r.message ? `<p style="border-left:3px solid #ccc;padding-left:10px">${esc(r.message)}</p>` : ""}
        <p>Apri l'app, scheda <b>Richieste</b>, per accettare o rifiutare.</p>`);
    }
  } else if (item.kind === "swap_response") {
    const r = await loadRequest(item.payload.id);
    const ok = r.status === "accepted";
    const to = await emailRecipients([r.requester_id]);
    for (const email of to) {
      await sendEmail(settings, email, `${r.tgt?.display_name} ha ${ok ? "accettato" : "rifiutato"} il cambio turno`, `
        <p><b>${esc(r.tgt?.display_name)}</b> ha <b>${ok ? "accettato" : "rifiutato"}</b> la tua richiesta di cambio per <b>${esc(itDate(r.date))}</b>.</p>
        ${ok ? `<p>Ora il tuo turno è <b>${esc(r.tt?.name)}</b>.</p>` : ""}
        ${r.response ? `<p style="border-left:3px solid #ccc;padding-left:10px">${esc(r.response)}</p>` : ""}`);
    }
  } else if (item.kind === "shifts_loaded") {
    const p = item.payload;
    const to = await emailRecipients(null);
    for (const email of to) {
      await sendEmail(settings, email, "Sono stati caricati nuovi turni", `
        <p>Sono stati caricati i turni dal <b>${esc(shortDate(p.from))}</b> al <b>${esc(shortDate(p.to))}</b>.</p>
        <p>Apri l'app per vedere il tuo calendario.</p>`);
    }
  }
}

async function isAdminRequest(req: Request): Promise<{ email: string } | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await sb.auth.getUser(token);
  if (!data?.user) return null;
  const { data: prof } = await sb.from("profiles").select("email, role, status").eq("id", data.user.id).single();
  return prof && prof.role === "admin" && prof.status === "approved" ? { email: prof.email } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  const { data: settings } = await sb.from("app_settings").select("*").eq("id", 1).single();
  const configured = !!(BREVO_KEY && settings?.sender_email);

  if (body?.test) {
    const admin = await isAdminRequest(req);
    if (!admin) return json({ error: "Solo per admin" }, 403);
    if (!BREVO_KEY) return json({ error: "Manca la chiave di Brevo (secret BREVO_API_KEY)" }, 400);
    if (!settings?.sender_email) return json({ error: "Manca l'email del mittente" }, 400);
    try {
      await sendEmail(settings, admin.email, "Email di prova - Gestione turni", "<p>Se leggi questo messaggio, le email dell'app funzionano. 🎉</p>");
      return json({ ok: true, to: admin.email });
    } catch (e) {
      return json({ error: String((e as Error).message || e) }, 500);
    }
  }

  const { data: items } = await sb.from("notification_queue").select("*")
    .is("sent_at", null).lt("attempts", 5).order("id").limit(50);
  let sent = 0, failed = 0;
  for (const item of items || []) {
    const old = Date.now() - new Date(item.created_at).getTime() > 2 * 86400000;
    if (!configured || old) {
      await sb.from("notification_queue").update({ sent_at: new Date().toISOString(), error: old ? "scaduta" : "email non configurata" }).eq("id", item.id);
      continue;
    }
    try {
      await handle(item, settings);
      await sb.from("notification_queue").update({ sent_at: new Date().toISOString(), error: null }).eq("id", item.id);
      sent++;
    } catch (e) {
      await sb.from("notification_queue").update({ attempts: item.attempts + 1, error: String((e as Error).message || e).slice(0, 500) }).eq("id", item.id);
      failed++;
    }
  }
  return json({ processed: items?.length || 0, sent, failed, configured });
});
