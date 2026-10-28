// =====================================================================
//  availability.js — นักบินที่ไม่ว่าง (หน้าวัน)
// =====================================================================
import { supabase } from "./supabase.js";
import { loadAliasMap } from "./missions.js";

// นักบินทุกคนในทะเบียน (ที่ใช้งานอยู่) — ไว้เลือกในช่องเพิ่มคนไม่ว่าง
export async function loadRoster() {
  const [{ data }, aliases] = await Promise.all([
    supabase.from("crew_members").select("id,code,full_name,position").eq("active", true).order("code"),
    loadAliasMap(),
  ]);
  return (data || []).map((c) => ({ ...c, aliases: aliases?.get(c.id) || [] }));
}

// ใครไม่ว่างวันนี้บ้าง
export async function loadUnavailableOn(date) {
  const { data } = await supabase.from("crew_unavailable")
    .select("crew_member_id,note,crew_members(code,full_name,position)")
    .eq("off_date", date);
  return (data || []).sort((a, b) => String(a.crew_members?.code).localeCompare(String(b.crew_members?.code)));
}

export async function setUnavailable(crewId, date, note) {
  const { error } = await supabase.from("crew_unavailable")
    .upsert({ crew_member_id: crewId, off_date: date, note: (note || "").trim() || null },
            { onConflict: "crew_member_id,off_date" });
  return error;
}

// ไม่ว่างหลายวันติดกัน (from..to รวมหัวท้าย) — ทุกสิทธิ์ที่ลงไม่ว่างได้ (admin/ผู้วางแผน/นักบิน/ลูกเรือ · migration_31)
export const MAX_OFF_DAYS = 62;
export function dateRange(from, to) {
  const out = [], [y, m, d] = from.split("-").map(Number), end = to || from;
  for (let t = new Date(y, m - 1, d); out.length <= MAX_OFF_DAYS; t.setDate(t.getDate() + 1)) {
    const s = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    if (s > end) break;
    out.push(s);
  }
  return out;
}
export async function setUnavailableRange(crewId, from, to, note) {
  const days = dateRange(from, to);
  const n = (note || "").trim() || null;
  const { error } = await supabase.from("crew_unavailable")
    .upsert(days.map((d) => ({ crew_member_id: crewId, off_date: d, note: n })), { onConflict: "crew_member_id,off_date" });
  return { error, days };
}

// ช่วงไม่ว่างที่ติดกัน (หมายเหตุเดียวกัน) ที่มีวันนี้อยู่ — ใช้ตอนลบ ให้ลบทั้งช่วงได้ทีเดียว
export async function findOffBlock(crewId, date) {
  const shift = (s, n) => { const [y, m, d] = s.split("-").map(Number), t = new Date(y, m - 1, d + n);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
  const { data } = await supabase.from("crew_unavailable").select("off_date,note")
    .eq("crew_member_id", crewId).gte("off_date", shift(date, -MAX_OFF_DAYS)).lte("off_date", shift(date, MAX_OFF_DAYS));
  const byDate = new Map((data || []).map((r) => [String(r.off_date).slice(0, 10), r.note || ""]));
  if (!byDate.has(date)) return [date];
  const note = byDate.get(date), days = [date];
  for (let s = shift(date, -1); byDate.has(s) && byDate.get(s) === note; s = shift(s, -1)) days.unshift(s);
  for (let s = shift(date, 1); byDate.has(s) && byDate.get(s) === note; s = shift(s, 1)) days.push(s);
  return days;
}
export async function clearUnavailableDays(crewId, days) {
  const { error } = await supabase.from("crew_unavailable").delete().eq("crew_member_id", crewId).in("off_date", days);
  return error;
}

export async function clearUnavailable(crewId, date) {
  const { error } = await supabase.from("crew_unavailable")
    .delete().eq("crew_member_id", crewId).eq("off_date", date);
  return error;
}
