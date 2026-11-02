// =====================================================================
//  daily-report.js — ข้อความรายงานภารกิจประจำวัน (คัดลอกไปรายงานต่อ)
//   • ภารกิจ = การ์ดในหน้าหลัก (ไม่นับ STBY ทั่วไป) เรียงลำดับเดียวกับหน้าหลัก
//   • รายงานหลังบินแล้ว → ปฏิบัติภารกิจเรียบร้อย · ยังไม่รายงาน → อยู่ระหว่างปฏิบัติภารกิจ · ยกเลิก → ยกเลิกภารกิจ
// =====================================================================
import { reportOf, parseMissionNames } from "./missions.js";
import { orderMissions } from "./mission-sheet.js";

const TH_MON_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
// "2026-11-02" → "2 พ.ย.69"
export const thShort = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MON_SHORT[m - 1]}${String(y + 543).slice(-2)}`;
};

export const RESULT = {
  done: "-ปฏิบัติภารกิจเรียบร้อย",
  pending: "-อยู่ระหว่างปฏิบัติภารกิจ",
  cancelled: "-ยกเลิกภารกิจ",
};
export const resultOf = (m) => m.status === "cancelled" ? "cancelled" : reportOf(m) ? "done" : "pending";

// ภารกิจที่อยู่ในรายงาน (เหมือนการ์ดหน้าหลัก: ทุกชนิดยกเว้น STBY ทั่วไป)
export const reportMissions = (all) => orderMissions((all || []).filter((m) => m.kind !== "stby"));

// เส้นทาง: ตัดเวลาในวงเล็บ เช่น "บุรีรัมย์(1120)" → "บุรีรัมย์"
const cleanRoute = (r) => String(r || "").replace(/\s*\(\s*\d{3,4}\s*\)/g, "").replace(/\s+/g, " ").trim();

export function buildDailyReport(dateIso, all) {
  const list = reportMissions(all);
  const head = [`ขออนุญาตรายงานภารกิจการบินฝูง.603`, `วันที่ ${thShort(dateIso)}`];
  if (!list.length) return [...head, `ไม่มีภารกิจ`, ``, `ครับ`].join("\n");
  const blocks = list.map((m, i) => {
    const route = cleanRoute(m.route);
    return [
      `(${i + 1}) ${parseMissionNames(m).join(", ") || "-"}`,
      ...(route ? [`เส้นทางบิน ${route}`] : []),
      RESULT[resultOf(m)],
    ].join("\n");
  });
  return [...head, `ทั้งหมด ${list.length} ภารกิจ`, ``, blocks.join("\n\n"), ``, `ครับ`].join("\n");
}
