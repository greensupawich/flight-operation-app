// =====================================================================
//  reports.js — รายงานหลังบิน + ขาการบิน + ข้อขัดข้อง + รายงานอันตราย
//  บันทึกรายงาน → trigger ในฐานข้อมูลกระจาย ชม. ไปลูกเรือ/เครื่องเอง
// =====================================================================
import { supabase } from "./supabase.js";
import { removeFiles } from "./media.js";

export async function getMission(id) {
  const { data } = await supabase
    .from("missions")
    .select("*, aircraft(tail_number,type), mission_crew(position, crew_name, crew_member_id, sort_order)")
    .eq("id", id).single();
  return data;
}

// =====================================================================
//  แตก "เส้นทางบิน" เป็นขาการบิน
//   "บน.6 - บน.41 - บน.6"  →  [บน.6→บน.41, บน.41→บน.6]
//   ตัดวงเล็บเวลาออก เช่น "บน.1(0930)" → "บน.1"
// =====================================================================
export function routeToLegs(route) {
  if (!route) return [];
  const points = String(route)
    .split(/[-–—>→]+/)                 // รองรับทั้ง - – — > →
    .map((p) => p.replace(/\([^)]*\)/g, "").trim())   // ตัด (0930) ออก
    .filter(Boolean);
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    legs.push({ from_point: points[i], to_point: points[i + 1], hours: 0 });
  }
  return legs;
}

// ---------- ขาการบิน ----------
export async function loadLegs(missionId) {
  const { data } = await supabase.from("flight_legs")
    .select("*").eq("mission_id", missionId).order("leg_no");
  return data || [];
}

// แทนที่ขาทั้งชุด (ลำดับ = leg_no ตามที่เรียงบนหน้าจอ) — ลบ+ใส่ในคำสั่งเดียวที่ฐานข้อมูล (migration_58)
//  ล้มกลางทาง = ย้อนกลับทั้งหมด ขาเดิมไม่หาย · ยอด ชม.รวมของรายงานฐานข้อมูลคำนวณใหม่เอง
export async function replaceLegs(missionId, legs) {
  const rows = (legs || []).map((l) => ({
    from_point: (l.from_point || "").trim(),
    to_point: (l.to_point || "").trim(),
    hours: Number(l.hours) || 0,
    vip: !!l.vip,                                     // ขานี้มีคณะวัง (migration_26)
  }));
  const { error } = await supabase.rpc("replace_flight_legs", { p_mission: missionId, p_legs: rows });
  if (error && /flight_legs_hours_range/.test(error.message))
    return { message: "ชม.บินแต่ละขาต้องอยู่ระหว่าง 0–24 ชม." };
  return error;
}

// ---------- ระบบที่ขัดข้อง (migration_39) — ลำดับ/ชื่อตาม Google Form เดิม ----------
//  เก็บใน post_flight_reports.defect_systems: null = ยังไม่ระบุ · [] = ไม่มีข้อขัดข้อง
export const DEFECT_SYSTEMS = [
  ["AIR", "AIR"],
  ["AUTOMATIC FLIGHT CONTROL", "AUTOMATIC FLIGHT CONTROL"],
  ["COMMUNICATIONS", "COMMUNICATIONS"],
  ["ELECTRICAL", "ELECTRICAL"],
  ["FIRE PROTECTION", "FIRE PROTECTION"],
  ["FLIGHT CONTROL", "FLIGHT CONTROL"],
  ["FLIGHT INSTRUMENTS", "FLIGHT INSTRUMENTS"],
  ["FUEL", "FUEL"],
  ["HYDRAULIC", "HYDRAULIC"],
  ["ICE AND RAIN PROTECTION", "ICE AND RAIN PROTECTION"],
  ["LANDING GEAR", "LANDING GEAR"],
  ["NAVIGATION", "NAVIGATION"],
  ["POWER PLANT", "POWER PLANT"],
  ["BIRD STRIKE", "BIRD STRIKE"],
  ["OTHER", "อื่นๆ"],
];
export const defectLabel = (code) => (DEFECT_SYSTEMS.find(([c]) => c === code) || [code, code])[1];

// ---------- รายงานหลังบิน (upsert: 1 ภารกิจ = 1 รายงาน) ----------
//  extra = { result: 'MCP'|'INCOMPLETE'|'CANCELLED'|null, parking_return }  (migration_16)
export async function saveReport(missionId, totalHours, remarks, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const row = { mission_id: missionId, total_hours: totalHours, remarks, created_by: session?.user?.id,
                result: extra.result || null, parking_return: (extra.parking_return || "").trim() || null };
  if (extra.rest_kind) row.rest_kind = extra.rest_kind;   // วัง/เดโชชัย: ชม.ขาที่ไม่มีคณะ นับเป็นประเภทนี้ (migration_37)
  if (Array.isArray(extra.defect_systems)) row.defect_systems = extra.defect_systems;   // ระบบที่ขัดข้อง (migration_39)
  let { error } = await supabase.from("post_flight_reports").upsert(row, { onConflict: "mission_id" });
  // ยังไม่ได้รัน migration_39 → บันทึกโดยไม่มีระบบที่ขัดข้อง แล้วแจ้งเตือน
  let warn39 = null;
  if (error && /defect_systems/.test(error.message)) {
    delete row.defect_systems;
    ({ error } = await supabase.from("post_flight_reports").upsert(row, { onConflict: "mission_id" }));
    if (!error) warn39 = { warning: "บันทึกแล้ว แต่ \"ระบบที่ขัดข้อง\" ยังไม่ถูกเก็บ — ต้องรัน migration_39_defect_systems.sql" };
  }
  // ยังไม่ได้รัน migration_37 → บันทึกโดยไม่มี rest_kind (ที่เหลือนับเป็นฝึกบินตามเดิม) แล้วแจ้งเตือน
  if (error && /rest_kind/.test(error.message)) {
    delete row.rest_kind;
    ({ error } = await supabase.from("post_flight_reports").upsert(row, { onConflict: "mission_id" }));
    if (!error && extra.rest_kind !== "training") return { warning: "บันทึกแล้ว แต่ประเภทของ ชม.ที่เหลือยังไม่ถูกเก็บ (นับเป็นฝึกบิน) — ต้องรัน migration_37_vip_rest_kind.sql" };
  }
  // ยังไม่ได้รัน migration_16 → บันทึกเฉพาะข้อมูลเดิม แล้วแจ้งเตือน
  if (error && /result|parking_return/.test(error.message)) {
    delete row.result; delete row.parking_return;
    ({ error } = await supabase.from("post_flight_reports").upsert(row, { onConflict: "mission_id" }));
    if (!error) return { warning: "บันทึก ชม.แล้ว แต่ผลภารกิจ/จุดจอดขากลับยังไม่ถูกเก็บ — ต้องรัน migration_16_report_result.sql" };
  }
  return error || warn39;
}

export async function getReport(missionId) {
  const { data } = await supabase.from("post_flight_reports")
    .select("*").eq("mission_id", missionId).maybeSingle();
  return data;
}

// ---------- จำนวน landing รายนักบิน (migration_51) ----------
//  คืน Map(crew_member_id → จำนวน) · null = ยังไม่ได้รัน migration_51
export async function loadLandings(missionId) {
  const { data, error } = await supabase.from("mission_landings")
    .select("crew_member_id, landings").eq("mission_id", missionId);
  if (error) { console.warn("mission_landings:", error.message); return null; }
  return new Map((data || []).map((r) => [r.crew_member_id, r.landings]));
}
// list = [{ crew_member_id, landings }] · เก็บเฉพาะที่ > 0 · คนที่เป็น 0 / ไม่อยู่ในรายการแล้ว → ลบแถว
export async function saveLandings(missionId, list) {
  const keep = (list || []).filter((x) => x.crew_member_id && Number(x.landings) > 0)
    .map((x) => ({ mission_id: missionId, crew_member_id: x.crew_member_id, landings: Math.min(99, Math.round(Number(x.landings))) }));
  const { data: old, error: oldErr } = await supabase.from("mission_landings").select("id, crew_member_id").eq("mission_id", missionId);
  if (oldErr) return oldErr;
  const gone = (old || []).filter((r) => !keep.some((k) => k.crew_member_id === r.crew_member_id)).map((r) => r.id);
  if (gone.length) {
    const { error } = await supabase.from("mission_landings").delete().in("id", gone);
    if (error) return error;
  }
  if (keep.length) {
    const { error } = await supabase.from("mission_landings").upsert(keep, { onConflict: "mission_id,crew_member_id" });
    if (error) return error;
  }
  return null;
}

// ---------- ข้อขัดข้อง ----------
export async function loadDiscrepancies(missionId) {
  const { data } = await supabase.from("discrepancies")
    .select("*").eq("mission_id", missionId).order("created_at");
  return data || [];
}

// คืน { error, id } — id ใช้ผูกรูป/วีดีโอที่เลือกไว้ตอนเพิ่ม
export async function addDiscrepancy(missionId, aircraftId, description) {
  const { data: { session } } = await supabase.auth.getSession();
  const { data, error } = await supabase.from("discrepancies").insert({
    mission_id: missionId, aircraft_id: aircraftId, description, created_by: session?.user?.id,
  }).select("id").single();
  return { error, id: data?.id };
}

// ลบไฟล์แนบใน Storage ก่อน (แถว report_media หายตาม cascade)
export async function deleteDiscrepancy(id) {
  const { data: media } = await supabase.from("report_media").select("storage_path").eq("discrepancy_id", id);
  const { error } = await supabase.from("discrepancies").delete().eq("id", id);
  if (!error && media?.length) await removeFiles(media.map((m) => m.storage_path));
  return error;
}

// ---------- รายงานอันตราย (safety report) — ไม่บังคับ · มีได้หลายรายการ/ภารกิจ ----------
export async function loadSafety(missionId) {
  const { data, error } = await supabase.from("safety_reports")
    .select("*").eq("mission_id", missionId).order("created_at");
  if (error) { console.warn("safety_reports:", error.message); return []; }
  return data || [];
}

// บันทึกทั้งชุดแบบคง id เดิม (ไฟล์แนบผูกกับ id จึงห้ามลบ-สร้างใหม่)
//  items: [{ id?, occurred_time, description }] · รายการที่ไม่มีลักษณะเหตุการณ์จะไม่ถูกเก็บ
//  คืน { error, ids } — ids[i] = id ของ items[i] (null ถ้าไม่ได้เก็บ)
export async function saveSafety(missionId, items) {
  const { data: { session } } = await supabase.auth.getSession();
  const ids = (items || []).map(() => null);
  const keep = new Set((items || []).filter((it) => it.id && (it.description || "").trim()).map((it) => it.id));

  // 1) ลบรายการที่ถูกเอาออก (รวมไฟล์แนบใน Storage)
  const { data: old, error: oldErr } = await supabase.from("safety_reports").select("id").eq("mission_id", missionId);
  if (oldErr) return { error: oldErr, ids };
  const gone = (old || []).map((r) => r.id).filter((id) => !keep.has(id));
  if (gone.length) {
    const { data: media } = await supabase.from("report_media").select("storage_path").in("safety_report_id", gone);
    const { error } = await supabase.from("safety_reports").delete().in("id", gone);
    if (error) return { error, ids };
    if (media?.length) await removeFiles(media.map((m) => m.storage_path));
  }

  // 2) แก้ของเดิม / เพิ่มของใหม่
  for (let i = 0; i < (items || []).length; i++) {
    const it = items[i];
    const description = (it.description || "").trim();
    if (!description) continue;
    const row = { occurred_time: (it.occurred_time || "").trim() || null, description };
    if (it.id) {
      const { error } = await supabase.from("safety_reports").update(row).eq("id", it.id);
      if (error) return { error, ids };
      ids[i] = it.id;
    } else {
      const { data, error } = await supabase.from("safety_reports")
        .insert({ ...row, mission_id: missionId, created_by: session?.user?.id }).select("id").single();
      if (error) return { error, ids };
      ids[i] = data.id;
    }
  }
  return { error: null, ids };
}
