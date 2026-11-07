// =====================================================================
//  status.js — สถานภาพเครื่องบิน + ข้อขัดข้อง 3 ไฟลท์ล่าสุด
// =====================================================================
import { supabase } from "./supabase.js";

export const AC_STATUS = ["FMC", "PMC", "NMC"];
export const AC_STATUS_LABEL = {
  FMC: "FMC · พร้อมบิน",
  PMC: "PMC · พร้อมบางภารกิจ",
  NMC: "NMC · ไม่พร้อมบิน",
};
// สี (พื้น/ตัวอักษร) ของแต่ละสถานภาพ
export const AC_STATUS_COLORS = {
  FMC: { bg: "#2E7D5B", fg: "#ffffff" },   // เขียว
  PMC: { bg: "#E0A32B", fg: "#2a1e00" },   // เหลือง
  NMC: { bg: "#C0392B", fg: "#ffffff" },   // แดง
};

// NMCS (Not Mission Capable – Supply) — ฐานข้อมูลเก็บเป็น NMC + หมายเหตุขึ้นต้น "สถานภาพเดิม: NMCS" (แบบเดียวกับ status-import / หน้าหลัก)
//  ตัวเลือกในหน้าเว็บ: FMC / PMC / NMC / NMCS · หมายเหตุที่ผู้ใช้กรอกต่อท้ายด้วย " · "
export const AC_STATUS_UI = ["FMC", "PMC", "NMC", "NMCS"];
export const AC_STATUS_UI_LABEL = { ...AC_STATUS_LABEL, NMCS: "NMCS · ไม่พร้อมบิน (รอพัสดุ)" };
const NMCS_MARK = /^\s*สถานภาพเดิม:\s*NMCS\s*(?:·\s*)?/;
// แยกค่าจากฐานข้อมูล → { st: "FMC"|"PMC"|"NMC"|"NMCS", note: หมายเหตุที่ผู้ใช้กรอก }
export function statusParts(status, note) {
  const n = String(note || "");
  if (status === "NMC" && NMCS_MARK.test(n)) return { st: "NMCS", note: n.replace(NMCS_MARK, "").trim() };
  if (status === "NMC" && /^\s*NMCS\b/.test(n)) return { st: "NMCS", note: n.replace(/^\s*NMCS\b\s*(?:·\s*)?/, "").trim() };
  return { st: status, note: n.trim() };
}
// ค่าที่เลือกในหน้าเว็บ → { status, note } สำหรับบันทึก
export function statusFields(st, note) {
  const n = String(note || "").trim();
  if (st === "NMCS") return { status: "NMC", note: n ? `สถานภาพเดิม: NMCS · ${n}` : "สถานภาพเดิม: NMCS" };
  return { status: st, note: n || null };
}

export async function loadAircraft() {
  const { data, error } = await supabase
    .from("aircraft")
    .select("id,tail_number,type,status,status_note,status_updated_at,total_hours")
    .order("type").order("tail_number");      // -500 ก่อน -600 เหมือนกระดาน: 313 315 316 301 302 303
  if (error) { console.error(error); return []; }
  return data || [];
}

export async function setAircraftStatus(id, status, note) {
  const { error } = await supabase.from("aircraft")
    .update({ status, status_note: (note || "").trim() || null }).eq("id", id);
  return error;
}

// แก้ย้อนหลัง: เขียนลงประวัติของวันนั้นโดยตรง (ไม่แตะข้อมูลปัจจุบัน)
//  defs (ข้อความ[]) / chks ([{name,due_text}]) ใส่มาด้วย = บันทึกข้อขัดข้อง/เช็คของวันนั้น (migration_54) · ไม่ใส่ = แก้เฉพาะสถานภาพ
export async function setAircraftStatusOn(id, dateStr, status, note, defs, chks) {
  const row = { aircraft_id: id, log_date: dateStr, status,
                note: (note || "").trim() || null, updated_at: new Date().toISOString() };
  if (defs) row.defects = defs.map(cleanDefect).filter(Boolean);
  if (chks) row.checks = chks.map((c) => ({ name: (c.name || "").trim(), due_text: (c.due_text || "").trim() || null })).filter((c) => c.name);
  const { error } = await supabase.from("aircraft_status_history").upsert(row, { onConflict: "aircraft_id,log_date" });
  return error;
}

// ข้อขัดข้องของทุกเครื่อง จัดกลุ่มเป็น "ไฟลท์" (ตามภารกิจ · ถ้าไม่มีภารกิจใช้วันที่)
// คืน Map(aircraftId -> [{ date, callsign, items:[{description,status}] }]) เรียงใหม่→เก่า
export async function loadRecentDiscrepancies() {
  const { data, error } = await supabase
    .from("discrepancies")
    .select("aircraft_id,description,status,reported_date,mission_id,missions(mission_date,callsign)")
    .order("reported_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) { console.error(error); return new Map(); }

  const byAc = new Map();
  (data || []).forEach((d) => {
    if (!d.aircraft_id) return;
    const date = d.missions?.mission_date || d.reported_date;
    const callsign = d.missions?.callsign || "";
    const flightKey = d.mission_id || `date:${date}`;
    if (!byAc.has(d.aircraft_id)) byAc.set(d.aircraft_id, new Map());
    const flights = byAc.get(d.aircraft_id);
    if (!flights.has(flightKey)) flights.set(flightKey, { date, callsign, items: [] });
    flights.get(flightKey).items.push({ description: d.description, status: d.status });
  });

  const out = new Map();
  byAc.forEach((flights, acId) => {
    const list = [...flights.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    out.set(acId, list.slice(0, 1));   // เอาแค่ไฟลท์ล่าสุด
  });
  return out;
}

// สถานภาพของทุกเครื่อง ณ วันที่กำหนด (จากประวัติ migration_18)
// คืน Map(aircraftId -> { status, note, log_date }) · ถ้ายังไม่มีตารางประวัติ คืน null
export async function loadStatusOn(dateStr) {
  const { data, error } = await supabase.rpc("aircraft_status_on", { p_date: dateStr });
  if (error) return null;
  const map = new Map();
  (data || []).forEach((r) => map.set(r.aircraft_id, { status: r.status, note: r.note, log_date: r.log_date }));
  return map;
}

// ทั้งแผง (สถานภาพ + หมายเหตุ + ข้อขัดข้อง + เช็ค) ณ วันที่กำหนด — migration_54
//  คืน Map(aircraftId -> { status, note, log_date, defects, checks }) · ยังไม่รัน migration_54 → null
export async function loadBoardOn(dateStr) {
  const { data, error } = await supabase.rpc("aircraft_board_on", { p_date: dateStr });
  if (error) return null;
  const map = new Map();
  (data || []).forEach((r) => map.set(r.aircraft_id, r));
  return map;
}

// แปลงข้อมูลปัจจุบัน → ข้อมูล "ณ วันนั้น" (ไม่แก้ของเดิม) สำหรับวันที่ย้อนหลัง
//  เครื่องที่ไม่มีประวัติเลย (ก่อนเริ่มเก็บ) → คงข้อมูลปัจจุบัน และนับใน missing
//  legacy = ยังไม่รัน migration_54 → ย้อนได้เฉพาะสถานภาพ (migration_18) ข้อขัดข้อง/เช็คเป็นของปัจจุบัน
export async function boardAsOf(dateStr, aircraft, defMap, chkMap) {
  let board = await loadBoardOn(dateStr), legacy = false;
  if (!board) {
    legacy = true;
    const st = await loadStatusOn(dateStr);
    board = new Map();
    if (st) st.forEach((h, id) => board.set(id, { status: h.status, note: h.note, log_date: h.log_date, defects: null, checks: null }));
  }
  let missing = 0;
  const dm = new Map(defMap), cm = new Map(chkMap);
  const list = aircraft.map((a) => {
    const h = board.get(a.id);
    if (!h || !h.log_date) { missing++; return a; }
    if (h.defects) dm.set(a.id, h.defects.map(cleanDefect).filter(Boolean));
    if (h.checks) cm.set(a.id, h.checks.map((c) => ({ name: c.name, due_text: c.due_text || "" })));
    return { ...a, status: h.status, status_note: h.note, status_updated_at: null, hist_date: h.log_date };
  });
  return { aircraft: list, defMap: dm, chkMap: cm, missing, legacy };
}

// ---------- รายการข้อขัดข้อง (รายการค้างของเครื่อง) ----------
// ตัดเลขข้อที่พิมพ์มากับข้อความ ("1. จอ ADU" → "จอ ADU") — หน้าเว็บ/Excel ใส่เลขข้อให้เอง ไม่ให้ขึ้นซ้ำ "1. 1."
export const cleanDefect = (t) => String(t ?? "").replace(/^\s*\(?\d{1,2}\s*[.)](?!\d)\s*/, "").trim();
export async function loadDefects() {
  const { data, error } = await supabase.from("aircraft_defects")
    .select("aircraft_id,seq,description").order("aircraft_id").order("seq");
  const map = new Map();
  if (!error) (data || []).forEach(d => {
    if (!map.has(d.aircraft_id)) map.set(d.aircraft_id, []);
    map.get(d.aircraft_id).push(cleanDefect(d.description));
  });
  return map;
}
// ลบ+ใส่ทั้งชุดในคำสั่งเดียวที่ฐานข้อมูล (migration_58) · ล้ม = รายการเดิมยังอยู่ครบ
export async function saveDefects(aircraftId, descriptions) {
  const items = (descriptions || []).map(cleanDefect).filter(Boolean);
  const { error } = await supabase.rpc("replace_aircraft_defects", { p_aircraft: aircraftId, p_items: items });
  return error;
}

// ---------- รายการเช็คตามวงรอบ ----------
export async function loadChecks() {
  const { data, error } = await supabase.from("aircraft_checks")
    .select("aircraft_id,seq,name,due_text").order("aircraft_id").order("seq");
  const map = new Map();
  if (!error) (data || []).forEach(c => {
    if (!map.has(c.aircraft_id)) map.set(c.aircraft_id, []);
    map.get(c.aircraft_id).push({ name: c.name, due_text: c.due_text || "" });
  });
  return map;
}
export async function saveChecks(aircraftId, list) {
  const items = (list || []).map(c => ({ name: (c.name||"").trim(), due_text: (c.due_text||"").trim() || null }))
    .filter(r => r.name);
  const { error } = await supabase.rpc("replace_aircraft_checks", { p_aircraft: aircraftId, p_items: items });
  return error;
}
