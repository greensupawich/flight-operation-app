// =====================================================================
//  pilot-month.js — หน้า "พ.": ตารางนักบิน × วันในเดือน
//  แต่ละคน 4 แถว: (1) จำนวนเที่ยว (2) เลขเครื่องแต่ละเที่ยว เช่น "301, 313" (3) ชม.บินแต่ละเที่ยว เช่น "1.5, 2.0"
//                (4) ข้อความที่กรอกเอง (crew_day_notes)
//  • นักบิน = ทะเบียน crew_members ตำแหน่ง IP / P / CP ที่ใช้งานอยู่
//  • เที่ยว = ภารกิจที่มีชื่อในลูกเรือตำแหน่งนักบิน (AC/IP/P/CP/N) · ไม่นับ STBY และภารกิจที่ยกเลิก
//  • ชม. = total_hours จากรายงานหลังบินของภารกิจนั้น · ยังไม่รายงาน = "-"
//  • เครื่อง = 3 ตัวท้ายของทะเบียน (60301 → 301) · ภารกิจที่ยังไม่ระบุเครื่อง = "-"
// =====================================================================
import { supabase } from "./supabase.js";
import { isStby, PILOT_ROLES } from "./missions.js";
import { loadExcelJS } from "./board-excel.js";

export const ROSTER_POSITIONS = ["IP", "P", "CP"];
export const TH_MONTH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                         "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
export const TH_DOW_SHORT = ["อา","จ","อ","พ","พฤ","ศ","ส"];
const pad = (n) => String(n).padStart(2, "0");
export const ymd = (y, m0, d) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
export const daysIn = (y, m0) => new Date(y, m0 + 1, 0).getDate();
export const fmtH = (h) => (h == null ? "-" : Number(h).toFixed(1));
export const shortTail = (t) => { t = String(t || "").trim(); return !t ? "-" : /^\d{4,}$/.test(t) ? t.slice(-3) : t; };

// ---------- โหลดข้อมูลทั้งเดือน ----------
export async function loadMonth(y, m0) {
  const first = ymd(y, m0, 1), last = ymd(y, m0, daysIn(y, m0));
  const [crew, missions, notes, holidays] = await Promise.all([
    supabase.from("crew_members").select("id,code,full_name,position")
      .eq("active", true).in("position", ROSTER_POSITIONS),
    supabase.from("missions")
      .select("id,mission_date,kind,status,callsign,takeoff_time,aircraft(tail_number),mission_crew(crew_member_id,position),post_flight_reports(total_hours)")
      .gte("mission_date", first).lte("mission_date", last),
    supabase.from("crew_day_notes").select("crew_member_id,log_date,note")
      .gte("log_date", first).lte("log_date", last),
    supabase.from("holidays").select("holiday_date,name")
      .gte("holiday_date", first).lte("holiday_date", last),
  ]);
  for (const r of [crew, missions, holidays]) if (r.error) throw r.error;
  return buildMonth(y, m0, {
    crew: crew.data, missions: missions.data, notes: notes.data, holidays: holidays.data,
    notesMissing: !!notes.error,          // ยังไม่ได้รัน migration_33 → แสดงตารางได้ แต่กรอกข้อความไม่ได้
  });
}

const PM_ROLES = PILOT_ROLES.filter((r) => r !== "N");     // ตำแหน่งที่นับเที่ยวในหน้า พ.

// แปลงข้อมูลดิบจากฐาน → โครงสร้างของตาราง (แยกออกมาเพื่อทดสอบได้โดยไม่ต้องล็อกอิน)
export function buildMonth(y, m0, { crew, missions, notes, holidays, notesMissing = false }) {
  const order = (p) => ROSTER_POSITIONS.indexOf(p);
  const pilots = (crew || []).sort((a, b) =>
    order(a.position) - order(b.position) || String(a.code).localeCompare(String(b.code), "th", { numeric: true }));

  // flights: Map(crew_member_id → Map(day → [{hours, callsign, tot, ac}]))
  const flights = new Map();
  for (const m of missions || []) {
    if (isStby(m.kind) || m.status === "cancelled") continue;
    const rep = Array.isArray(m.post_flight_reports) ? m.post_flight_reports[0] : m.post_flight_reports;
    const hours = rep && rep.total_hours != null ? Number(rep.total_hours) : null;
    const day = Number(m.mission_date.slice(8, 10));
    // หน้าที่ N (ผู้ช่วยนำร่อง) ไม่นับเป็นเที่ยวในหน้า พ. (ผู้ใช้กำหนด 30 ต.ค. 69)
    const ids = new Set((m.mission_crew || [])
      .filter((c) => c.crew_member_id && PM_ROLES.includes(String(c.position || "").toUpperCase()))
      .map((c) => c.crew_member_id));
    for (const id of ids) {
      if (!flights.has(id)) flights.set(id, new Map());
      const byDay = flights.get(id);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push({ hours, callsign: m.callsign || "", tot: m.takeoff_time || "", ac: shortTail(m.aircraft?.tail_number) });
    }
  }
  for (const byDay of flights.values())
    for (const list of byDay.values()) list.sort((a, b) => String(a.tot).localeCompare(String(b.tot)));

  const noteMap = new Map();     // "crewId|day" → text
  for (const n of notes || []) noteMap.set(`${n.crew_member_id}|${Number(n.log_date.slice(8, 10))}`, n.note);

  const holidayMap = new Map((holidays || []).map((h) => [Number(h.holiday_date.slice(8, 10)), h.name || "วันหยุด"]));
  return { y, m0, days: daysIn(y, m0), pilots, flights, noteMap, holidayMap, notesMissing };
}

// ---------- บันทึกข้อความ 1 ช่อง (ว่าง = ลบ) ----------
export async function saveNote(crewId, dateStr, text) {
  const note = String(text || "").trim();
  if (!note) {
    const { error } = await supabase.from("crew_day_notes").delete()
      .eq("crew_member_id", crewId).eq("log_date", dateStr);
    return error;
  }
  const { error } = await supabase.from("crew_day_notes")
    .upsert({ crew_member_id: crewId, log_date: dateStr, note: note.slice(0, 500) },
            { onConflict: "crew_member_id,log_date" });
  return error;
}

// ค่าที่แสดงของแต่ละช่อง (ใช้ร่วมกันทั้งหน้าเว็บและ Excel)
export function cellValues(data, pilot, day) {
  const list = data.flights.get(pilot.id)?.get(day) || [];
  return {
    count: list.length || "",
    ac: list.length ? list.map((f) => f.ac).join(", ") : "",
    hours: list.length ? list.map((f) => fmtH(f.hours)).join(", ") : "",
    note: data.noteMap.get(`${pilot.id}|${day}`) || "",
    tip: list.map((f) => `${f.callsign} · ${f.ac} · T/O ${f.tot} · ${fmtH(f.hours)} ชม.`).join("\n"),
  };
}
export function totals(data, pilot) {
  const byDay = data.flights.get(pilot.id);
  let n = 0, h = 0, pending = 0;
  if (byDay) for (const list of byDay.values()) for (const f of list) {
    n += 1;
    if (f.hours == null) pending += 1; else h += f.hours;
  }
  return { n, h, pending };
}
export const isOffDay = (data, d) => {
  const dow = new Date(data.y, data.m0, d).getDay();
  return dow === 0 || dow === 6 || data.holidayMap.has(d);
};

// ---------- ตารางบนหน้าเว็บ (HTML) ----------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function monthTableHTML(data, { editable = false } = {}) {
  const { y, m0, days, pilots } = data;
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const offCls = (d) => (isOffDay(data, d) ? " off" : "");
  const head = `<thead>
    <tr><th class="name" rowspan="2">ชื่อ</th><th class="lab" rowspan="2"></th>
      ${dayList.map((d) => `<th class="${offCls(d)}" title="${esc(data.holidayMap.get(d) || "")}">${d}</th>`).join("")}
      <th class="tot" rowspan="2">รวม</th></tr>
    <tr>${dayList.map((d) => `<th class="${offCls(d)}">${TH_DOW_SHORT[new Date(y, m0, d).getDay()]}</th>`).join("")}</tr>
  </thead>`;
  const body = pilots.map((p) => {
    const v = dayList.map((d) => cellValues(data, p, d));
    const t = totals(data, p);
    const hoursHTML = (s) => esc(s).replace(/(^|, )-(?=,|$)/g, '$1<span class="pend">-</span>');
    return `
    <tr class="r0">
      <td class="name" rowspan="4">${esc(p.full_name)}<span class="code">${esc(p.code || "")} · ${esc(p.position || "")}</span></td>
      <td class="lab">เที่ยว</td>
      ${v.map((c, i) => `<td class="d cnt${offCls(i + 1)}" title="${esc(c.tip)}">${c.count}</td>`).join("")}
      <td class="tot">${t.n || ""}</td>
    </tr>
    <tr>
      <td class="lab">เครื่อง</td>
      ${v.map((c, i) => `<td class="d ac${offCls(i + 1)}" title="${esc(c.tip)}">${esc(c.ac)}</td>`).join("")}
      <td class="tot"></td>
    </tr>
    <tr>
      <td class="lab">ชม.</td>
      ${v.map((c, i) => `<td class="d hrs${offCls(i + 1)}" title="${esc(c.tip)}">${hoursHTML(c.hours)}</td>`).join("")}
      <td class="tot">${t.n ? (t.pending === t.n ? "-" : t.h.toFixed(1)) : ""}</td>
    </tr>
    <tr>
      <td class="lab">หมายเหตุ</td>
      ${v.map((c, i) => `<td class="d note${offCls(i + 1)}">${editable
          ? `<input data-crew="${esc(p.id)}" data-day="${i + 1}" value="${esc(c.note)}" maxlength="500" aria-label="หมายเหตุ ${esc(p.full_name)} วันที่ ${i + 1}">`
          : `<span>${esc(c.note)}</span>`}</td>`).join("")}
      <td class="tot" style="font-weight:500;font-size:11px;color:var(--warn)">${t.pending ? `รอรายงาน ${t.pending}` : ""}</td>
    </tr>`;
  }).join("");
  return `<table class="pm">${head}<tbody>${body}</tbody></table>`;
}

// ---------- Export Excel ----------
export async function exportMonthXlsx(data) {
  const ExcelJS = await loadExcelJS();
  const { y, m0, days, pilots } = data;
  const title = `พ. — เดือน${TH_MONTH[m0]} พ.ศ.${y + 543}`;
  const wb = new ExcelJS.Workbook();
  wb.creator = wb.lastModifiedBy = "Flight Operation";
  const ws = wb.addWorksheet(`พ. ${TH_MONTH[m0]} ${y + 543}`, {
    views: [{ state: "frozen", xSplit: 2, ySplit: 3, zoomScale: 90 }],
    pageSetup: { paperSize: 8, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                 margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.pageSetup.printTitlesRow = "1:3";

  const FONT = "TH SarabunPSK";
  const lastCol = 2 + days + 1;                      // ชื่อ · รายการ · วันที่ 1..n · รวม
  const thin = { style: "thin", color: { argb: "FF9AA5B1" } }, med = { style: "medium" };
  const OFF_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF2" } };
  const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F0" } };
  const center = { horizontal: "center", vertical: "middle", wrapText: true };

  ws.getColumn(1).width = 24; ws.getColumn(2).width = 9;
  for (let d = 1; d <= days; d++) ws.getColumn(2 + d).width = 7.5;
  ws.getColumn(lastCol).width = 10;

  ws.mergeCells(1, 1, 1, lastCol);
  Object.assign(ws.getCell(1, 1), { value: title });
  ws.getCell(1, 1).style = { font: { name: FONT, size: 20, bold: true }, alignment: { horizontal: "center", vertical: "middle" } };
  ws.getRow(1).height = 30;

  const head = (r, c, v, extra = {}) => {
    const cell = ws.getCell(r, c);
    cell.value = v;
    cell.style = { font: { name: FONT, size: 14, bold: true }, alignment: center, fill: HEAD_FILL,
                   border: { top: thin, left: thin, bottom: thin, right: thin }, ...extra };
  };
  ws.mergeCells(2, 1, 3, 1); head(2, 1, "ชื่อ");
  ws.mergeCells(2, 2, 3, 2); head(2, 2, "รายการ");
  for (let d = 1; d <= days; d++) {
    const off = isOffDay(data, d) ? { fill: OFF_FILL } : {};
    head(2, 2 + d, d, off);
    head(3, 2 + d, TH_DOW_SHORT[new Date(y, m0, d).getDay()], { ...off, font: { name: FONT, size: 12 } });
  }
  ws.mergeCells(2, lastCol, 3, lastCol); head(2, lastCol, "รวม");

  const LABELS = ["เที่ยว", "เครื่อง", "ชม.", "หมายเหตุ"], NR = LABELS.length, LAST = NR - 1;
  pilots.forEach((p, i) => {
    const r0 = 4 + i * NR;
    ws.mergeCells(r0, 1, r0 + LAST, 1);
    const nameCell = ws.getCell(r0, 1);
    nameCell.value = `${p.full_name}\n${p.code || ""} · ${p.position || ""}`;
    nameCell.style = { font: { name: FONT, size: 14, bold: true }, alignment: { vertical: "middle", wrapText: true },
                       border: { left: med, right: thin, top: med, bottom: med } };
    const t = totals(data, p);
    for (let k = 0; k < NR; k++) {
      const r = r0 + k;
      ws.getRow(r).height = k === LAST ? 24 : 20;
      const border = (c) => ({ left: c === 1 || c === lastCol ? med : thin, right: c === lastCol ? med : thin,
                               top: k === 0 ? med : thin, bottom: k === LAST ? med : thin });
      const base = (c, extra = {}) => ({ font: { name: FONT, size: 14 }, alignment: center, border: border(c), ...extra });
      const lab = ws.getCell(r, 2); lab.value = LABELS[k]; lab.style = base(2, { font: { name: FONT, size: 13, color: { argb: "FF5D6B7E" } } });
      for (let d = 1; d <= days; d++) {
        const v = cellValues(data, p, d);
        const cell = ws.getCell(r, 2 + d);
        cell.value = [v.count, v.ac, v.hours, v.note][k] || null;
        cell.style = base(2 + d, {
          ...(isOffDay(data, d) ? { fill: OFF_FILL } : {}),
          ...(k > 0 ? { font: { name: FONT, size: 12 } } : {}),
        });
      }
      const tot = ws.getCell(r, lastCol);
      tot.value = k === 0 ? (t.n || null) : k === 1 ? null
        : k === 2 ? (t.n && t.pending < t.n ? Number(t.h.toFixed(1)) : t.n ? "-" : null) : (t.pending ? `รอรายงาน ${t.pending}` : null);
      tot.style = base(lastCol, { font: { name: FONT, size: 14, bold: k === 0 || k === 2 }, ...(k === 2 ? { numFmt: "0.0" } : {}) });
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  const file = `พ. ${TH_MONTH[m0]} ${y + 543}.xlsx`;
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: file });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return file;
}
