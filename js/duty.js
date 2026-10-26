// =====================================================================
//  duty.js — ข้อมูลจากไฟล์ "นจบ." (migration_34)
//   • บันทึกรายคน: ค้างคืน / เดโชชัย / STBY เดโชชัย / วันหยุด (crew_duty_log + crew_duty_note)
//   • ภารกิจต่างประเทศ RTAF (rtaf_missions) — ตารางอิสระ ไม่ผูกกับหน้าอื่น
//   • ไฟล์ภารกิจล่วงหน้า (shared_files + Storage bucket "mission-files") — เก็บไว้ไฟล์เดียว
//  อ่าน = ผู้ใช้ active · เขียน = admin/planner (บังคับด้วย RLS)
// =====================================================================
import { supabase } from "./supabase.js";

export const DUTY_CATS = {
  overnight: "ค้างคืน",
  dechochai: "เดโชชัย",
  stby_dechochai: "STBY เดโชชัย",
  holiday: "วันหยุด",
};
const NEED_MIGRATION = "ยังไม่มีตาราง — ต้องรัน db/migration_34_duty_logs_rtaf_files.sql ก่อน";
const friendly = (error) => error && /does not exist|schema cache|Could not find/i.test(error.message || "")
  ? { ...error, message: NEED_MIGRATION } : error;

// ---------- บันทึกรายคน ----------
//  คืน { days: Map(crewId -> [YYYY-MM-DD เรียงเก่า→ใหม่]), notes: Map(crewId -> text), error }
export async function loadDuty(category) {
  const days = new Map(), notes = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from("crew_duty_log")
      .select("crew_member_id, duty_date").eq("category", category)
      .order("duty_date").range(from, from + PAGE - 1);
    if (error) return { days, notes, error: friendly(error) };
    (data || []).forEach((r) => {
      if (!days.has(r.crew_member_id)) days.set(r.crew_member_id, []);
      days.get(r.crew_member_id).push(String(r.duty_date).slice(0, 10));
    });
    if (!data || data.length < PAGE) break;
  }
  const { data: nd, error: ne } = await supabase.from("crew_duty_note")
    .select("crew_member_id, note").eq("category", category);
  if (!ne) (nd || []).forEach((r) => notes.set(r.crew_member_id, r.note || ""));
  return { days, notes, error: null };
}

export async function addDuty(crewId, category, date) {
  const { error } = await supabase.from("crew_duty_log")
    .upsert({ crew_member_id: crewId, category, duty_date: date },
            { onConflict: "crew_member_id,category,duty_date", ignoreDuplicates: true });
  return friendly(error);
}
export async function removeDuty(crewId, category, date) {
  const { error } = await supabase.from("crew_duty_log").delete()
    .eq("crew_member_id", crewId).eq("category", category).eq("duty_date", date);
  return friendly(error);
}
export async function saveDutyNote(crewId, category, note) {
  const t = (note || "").trim();
  const q = t
    ? supabase.from("crew_duty_note").upsert({ crew_member_id: crewId, category, note: t, updated_at: new Date().toISOString() },
                                            { onConflict: "crew_member_id,category" })
    : supabase.from("crew_duty_note").delete().eq("crew_member_id", crewId).eq("category", category);
  const { error } = await q;
  return friendly(error);
}

// ---------- RTAF ----------
export async function loadRtaf() {
  const { data, error } = await supabase.from("rtaf_missions")
    .select("*").order("fiscal_year", { ascending: false }).order("seq");
  return { rows: data || [], error: friendly(error) };
}
export async function saveRtaf(row) {
  const rec = { fiscal_year: row.fiscal_year, seq: row.seq, callsign: row.callsign || null, date_text: row.date_text || null,
                mission: row.mission || null, route: row.route || null, remark: row.remark || null,
                updated_at: new Date().toISOString() };
  const q = row.id ? supabase.from("rtaf_missions").update(rec).eq("id", row.id).select().single()
                   : supabase.from("rtaf_missions").insert(rec).select().single();
  const { data, error } = await q;
  return { row: data, error: friendly(error) };
}
export async function deleteRtaf(id) {
  const { error } = await supabase.from("rtaf_missions").delete().eq("id", id);
  return friendly(error);
}

// ---------- ไฟล์ภารกิจล่วงหน้า (ไฟล์เดียว) ----------
const BUCKET = "mission-files";
export async function getSharedFile(slot) {
  const { data, error } = await supabase.from("shared_files").select("*").eq("slot", slot).maybeSingle();
  return { file: data || null, error: friendly(error) };
}
// อัปไฟล์ใหม่ → บันทึกข้อมูลไฟล์ → ลบไฟล์เก่า (ถ้าบันทึกข้อมูลไม่สำเร็จ ลบไฟล์ใหม่ทิ้ง ของเดิมยังอยู่)
export async function uploadSharedFile(slot, file, uploader) {
  const ext = (file.name.match(/\.([A-Za-z0-9]{1,8})$/) || [, "bin"])[1].toLowerCase();
  const path = `${slot}/${Date.now()}.${ext}`;                 // key เป็น ASCII เสมอ (ชื่อไทยเก็บในตาราง)
  const { file: old } = await getSharedFile(slot);
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) return friendly(up.error);
  const { error } = await supabase.from("shared_files").upsert({
    slot, path, file_name: file.name, size_bytes: file.size, mime_type: file.type || null,
    uploader: uploader || null, uploaded_at: new Date().toISOString(),
  }, { onConflict: "slot" });
  if (error) { await supabase.storage.from(BUCKET).remove([path]); return friendly(error); }
  if (old?.path && old.path !== path) await supabase.storage.from(BUCKET).remove([old.path]);
  return null;
}
// ดาวน์โหลดเป็น blob แล้วบันทึกด้วยชื่อไฟล์เดิม (ชื่อไทยถูกต้อง — signed URL ทำให้ชื่อกลายเป็น %E0%B8…)
export async function downloadSharedFile(rec) {
  const { data, error } = await supabase.storage.from(BUCKET).download(rec.path);
  if (error || !data) return friendly(error) || { message: "ไม่พบไฟล์" };
  const url = URL.createObjectURL(data);
  const a = document.createElement("a");
  a.href = url; a.download = rec.file_name || "file";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return null;
}
export async function sharedFileUrl(rec) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(rec.path, 120, { download: rec.file_name });
  return { url: data?.signedUrl || null, error: friendly(error) };
}
