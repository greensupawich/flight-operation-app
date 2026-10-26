// =====================================================================
//  queue-rank.js — คำนวณลำดับคิวบิน (ไม่มีการเรียกฐานข้อมูล ทดสอบแยกได้)
//
//  กลุ่ม: IP + P นับรวมกัน · CP นับแยก
//  ลำดับ: 1) บินจริงน้อยสุด (ไม่นับ ST / ไม่นับเที่ยวที่บินในวันหยุด) ในเดือนนั้น
//         2) บินจริงครั้งล่าสุดนานกว่า (ไม่เคยบิน = นานสุด)
//         3) ชื่ออยู่บนกว่า (ลำดับในทะเบียน)
//  ไม่ได้คิว: ไม่ได้ติ๊ก / มีรายการในวันนั้นแล้ว / ไม่มีคุณวุฒิ
//  ไม่ว่างในวันนั้น: ยังได้ลำดับตามปกติ (off = true) ให้หน้าเว็บแสดงเป็นสีแดง/หมายเหตุ
// =====================================================================
const pad = (n) => String(n).padStart(2, "0");
export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return fmtDate(d); };
export const isWeekend = (s) => { const w = new Date(s + "T00:00:00").getDay(); return w === 0 || w === 6; };

// วันทำการถัดไป: พรุ่งนี้ · ศุกร์ → จันทร์ · ข้ามเสาร์-อาทิตย์และวันหยุดราชการ
export function nextWorkingDay(todayStr, isOff) {
  let d = todayStr;
  for (let i = 0; i < 60; i++) {
    d = addDays(d, 1);
    if (!isOff(d)) return d;
  }
  return addDays(todayStr, 1);
}

export const queueGroup = (position) =>
  position === "CP" ? "CP" : (position === "IP" || position === "P") ? "IPP" : null;

/**
 * @param crew        [{id, position, in_queue}] เรียงตามลำดับในตาราง
 * @param monthDates  วันที่ทั้งหมดของเดือนที่แสดงคิว
 * @param target      วันที่แสดงคิว
 * @param isOff       (date) => วันหยุด?
 * @param itemsFor    (crewId, date) => [{st:boolean}]   สิ่งที่อยู่ในช่อง
 * @param isUnavailable (crewId, date) => boolean
 * @param historyStart  วันแรกที่ใช้ค้นหา "บินล่าสุด"
 * @returns Map(crewId -> { group, rank|null, flights, last|null, reason|null, off })
 */
export function rankQueue({ crew, monthDates, target, isOff, itemsFor, isUnavailable, historyStart }) {
  const result = new Map();
  const groups = { IPP: [], CP: [] };

  crew.forEach((p, idx) => {
    const group = queueGroup(p.position);
    if (!group) return;
    const realOn = (d) => itemsFor(p.id, d).some((it) => !it.st);

    const flights = monthDates.reduce((n, d) =>
      n + (isOff(d) ? 0 : itemsFor(p.id, d).filter((it) => !it.st).length), 0);

    let last = null;
    for (let d = addDays(target, -1); d >= historyStart; d = addDays(d, -1)) {
      if (realOn(d)) { last = d; break; }
    }

    let reason = null;
    if (p.in_queue === false) reason = "ไม่ได้ติ๊กนับคิว";
    else if (itemsFor(p.id, target).length) reason = "มีรายการในวันนั้นแล้ว";
    const off = !reason && isUnavailable(p.id, target);   // ไม่ว่าง → ยังนับลำดับ แต่ติดธงไว้

    const row = { id: p.id, idx, group, flights, last, reason, off, rank: null };
    groups[group].push(row);
    result.set(p.id, row);
  });

  for (const g of Object.values(groups)) {
    g.filter((r) => !r.reason)
     .sort((a, b) => a.flights - b.flights
                  || (a.last || "").localeCompare(b.last || "")   // ไม่เคยบิน ("") มาก่อน
                  || a.idx - b.idx)
     .forEach((r, i) => { r.rank = i + 1; });
  }
  return result;
}

// =====================================================================
//  คิววันหยุด — แยกกลุ่ม IP+P / CP เหมือนคิวปกติ (เฉพาะที่ติ๊กนับคิว)
//  กติกา (ผู้ใช้กำหนด 26 ต.ค. 69): เรียงตาม "วันหยุดล่าสุดที่บิน" — บินมานานที่สุดอยู่คิวแรก · บินล่าสุดอยู่คิวสุดท้าย
//   • ไม่เคยบินวันหยุดเลย = นานที่สุด (อยู่หน้าสุด) · วันเท่ากัน → ชื่ออยู่บนก่อน
//   • วันล่าสุด = ค่าที่ใหม่กว่า ระหว่าง ข้อมูลตั้งต้นจากไฟล์ "นจบ." ชีตวันหยุด (crew_duty_log category 'holiday')
//     กับ เที่ยวบินจริงในวันหยุด/เสาร์-อาทิตย์ในระบบ (ไม่นับ ST / ภารกิจที่ยกเลิก) ตั้งแต่ HOLIDAY_QUEUE_START
// =====================================================================
// เริ่มนับคิววันหยุดตั้งแต่ ต.ค. 2569 (ผู้ใช้กำหนด) — เปลี่ยนวันเริ่มรอบใหม่ได้ที่นี่
export const HOLIDAY_QUEUE_START = "2026-10-01";

/**
 * @param crew      [{id, position, in_queue}] เรียงตามลำดับในตาราง
 * @param target    วันหยุดที่จะแสดงคิว (นับเฉพาะเที่ยวก่อนวันนี้)
 * @param since     วันแรกที่เริ่มนับ (เที่ยวก่อนหน้านี้ไม่นับ)
 * @param isOff     (date) => วันหยุด?
 * @param flownDays Map(crewId -> Set(date))  วันที่มีเที่ยวบินจริง (ไม่รวม ST / ยกเลิก)
 * @param hasItemOn (crewId, date) => มีรายการในวันนั้นแล้ว
 * @param isUnavailable (crewId, date) => boolean
 * @param baselineDays  Map(crewId -> Iterable(date))  วันหยุดที่บินจากไฟล์ "นจบ." (ไม่กรองวันหยุดซ้ำ)
 * @returns Map(crewId -> { group, rank|null, count, last|null, tag, reason|null, off })
 */
export function rankHolidayQueue({ crew, target, since = HOLIDAY_QUEUE_START, isOff, flownDays, hasItemOn, isUnavailable,
                                   baselineDays = new Map() }) {
  const result = new Map();
  const groups = { IPP: [], CP: [] };
  crew.forEach((p, idx) => {
    const group = queueGroup(p.position);
    if (!group) return;
    const app = [...(flownDays.get(p.id) || [])].filter((d) => d >= since && d < target && isOff(d));
    const base = [...(baselineDays.get(p.id) || [])].filter((d) => d < target);
    const days = [...new Set([...base, ...app])].sort();
    let reason = null;
    if (p.in_queue === false) reason = "ไม่ได้ติ๊กนับคิว";
    else if (hasItemOn(p.id, target)) reason = "มีรายการในวันนั้นแล้ว";
    const off = !reason && isUnavailable(p.id, target);
    const row = { id: p.id, idx, group, count: days.length, last: days[days.length - 1] || null,
                  reason, off, rank: null, tag: 0 };
    groups[group].push(row);
    result.set(p.id, row);
  });
  for (const g of Object.values(groups)) {
    g.filter((r) => !r.reason)
     .sort((a, b) => (a.last || "").localeCompare(b.last || "") || a.idx - b.idx)   // ไม่เคยบิน ("") มาก่อน
     .forEach((r, i) => { r.rank = i + 1; });
  }
  return result;
}
