// =====================================================================
//  sheet-edit.js — แก้ทีละช่องบนการ์ดภารกิจ (หน้าหลัก · ผู้วางแผน) แบบ Excel
//   • คลิกช่อง → กล่องแก้วางทับช่องนั้น · Enter / คลิกที่อื่น = บันทึก · Esc = ยกเลิก
//   • บันทึกลง missions / mission_crew ตรง ๆ (ข้อมูลชุดเดียวกับหน้าภารกิจ / Export / คิว / ชม.บิน)
//   • กันเขียนทับกัน: อัปเดตเฉพาะเมื่อค่าในฐานยังเท่าค่าที่เห็นอยู่ ไม่งั้นแจ้งให้โหลดใหม่
//   • ชม.บินคำนวณใหม่อัตโนมัติเมื่อลูกเรือเปลี่ยน (trigger trg_rc_crew → recompute_all_hours)
//  คู่กับ data-f / data-crew / data-crew-add / data-crew-new ใน mission-sheet.js (sheetHTML edit:true)
// =====================================================================
import { supabase } from "./supabase.js";
import { PILOT_ROLES, OTHER_ROLES, QUALS, qualStyle, reportOf, esc, parsePoc, pocFields } from "./missions.js";
import { attachCombo, comboHTML } from "./combobox.js";

// คอลัมน์ที่แก้ได้ → ชื่อที่แสดง · NULLABLE = เก็บ null เมื่อว่าง (เหมือนฟอร์มภารกิจ)
const FIELDS = {
  callsign: "Callsign", showtime: "SHOWTIME", brief_time: "BRIEF", step_time: "STEP",
  taxi_time: "TAXI", takeoff_time: "T/O", fuel: "ชพ.", catering: "จัดรับรอง", pax: "PAX.",
  mission_name: "ภารกิจ", route: "เส้นทางบิน", head_delegation: "หน.คณะ",
  travel_director: "ผอ.เดินทาง", doc_officer: "น.เอกสาร", remark: "หมายเหตุ",
  parking_out: "ที่จอด ไป", parking_in: "ที่จอด กลับ",
};
const NULLABLE = ["travel_director", "doc_officer"];
const SLASH_HINT = ["remark"];                 // "/" = ขึ้นบรรทัดใหม่
const STALE = "มีคนแก้ภารกิจนี้ไปก่อนแล้ว — โหลดข้อมูลล่าสุดให้แล้ว ลองแก้อีกครั้ง";
const isPilot = (r) => PILOT_ROLES.includes(r);

// อัปเดต missions เฉพาะเมื่อค่าเดิมในฐานยังตรงกับที่เห็น · 0 แถว = มีคนแก้ไปแล้ว
async function updateMission(m, patch) {
  let q = supabase.from("missions").update(patch).eq("id", m.id);
  for (const col of Object.keys(patch)) q = m[col] == null ? q.is(col, null) : q.eq(col, m[col]);
  const { data, error } = await q.select("id");
  if (error) return error;
  return data?.length ? null : { message: STALE, stale: true };
}

// แก้/ลบ/เพิ่มลูกเรือ 1 คน (c = แถวเดิม หรือ null = เพิ่มใหม่ · row = null = ลบ)
async function writeCrew(m, c, row) {
  if (!c) {
    const sort = Math.max(-1, ...(m.mission_crew || []).map((x) => x.sort_order || 0)) + 1;
    const { error } = await supabase.from("mission_crew").insert({ mission_id: m.id, sort_order: sort, ...row });
    return error;
  }
  let q = row ? supabase.from("mission_crew").update(row) : supabase.from("mission_crew").delete();
  q = q.eq("id", c.id).eq("position", c.position).eq("crew_name", c.crew_name);
  const { data, error } = await q.select("id");
  if (error) return error;
  return data?.length ? null : { message: STALE, stale: true };
}

export function wireSheetEdit(container, { getMission, roster = [], onSaved }) {
  const items = roster.map((p) => ({
    id: p.id, label: p.full_name, hint: p.code, aliases: p.aliases || [], position: p.position,
    tag: p.position ? { text: p.position, style: qualStyle(p.position) } : null,
  }));
  let open = null;                    // { box, bg, save, close }

  container.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-f],[data-crew],[data-crew-add],[data-crew-new]");
    if (!cell || !container.contains(cell) || container.classList.contains("reordering")) return;
    const m = getMission(cell.closest(".sheet")?.dataset.id);
    if (!m) return;
    e.preventDefault();
    if (open) open.close();
    if (cell.dataset.f) editField(cell, m, cell.dataset.f);
    else if (cell.dataset.crew) editCrew(cell, m, (m.mission_crew || []).find((c) => c.id === cell.dataset.crew));
    else editCrew(cell, m, null, cell.dataset.crewAdd || null);
  });

  // ---------- กล่องแก้ (วางใต้ช่องที่คลิก · จอแคบ = แผ่นล่างจอ) ----------
  function popup(cell, title, m, bodyHTML, { onSave, onDelete } = {}) {
    const bg = document.createElement("div");
    bg.className = "ced-bg";
    const box = document.createElement("div");
    box.className = "ced";
    box.setAttribute("role", "dialog");
    box.innerHTML = `
      <div class="ced-h"><b>${esc(title)}</b><span class="ced-k">${esc(m.callsign || m.mission_name || "")}</span></div>
      <div class="ced-b">${bodyHTML}</div>
      <div class="ced-err" hidden></div>
      <div class="ced-f">
        ${onDelete ? `<button type="button" class="btn sm" data-x style="color:var(--crit)">ลบออก</button>` : ""}
        <span class="ced-hint">Enter = บันทึก · Esc = ยกเลิก</span>
        <button type="button" class="btn sm ghost" data-c>ยกเลิก</button>
        <button type="button" class="btn sm primary" data-s>บันทึก</button>
      </div>`;
    document.body.append(bg, box);
    cell.classList.add("ed-on");

    // ตำแหน่ง: ใต้ช่อง (ถ้าไม่พอ → เหนือช่อง) · พิกัดหน้าเอกสาร เลื่อนจอแล้วกล่องไปกับการ์ด
    if (innerWidth >= 700) {
      const r = cell.getBoundingClientRect();
      const w = Math.min(Math.max(r.width, 320), innerWidth - 16);
      box.style.width = w + "px";
      box.style.left = (Math.min(Math.max(8, r.left), innerWidth - w - 8) + scrollX) + "px";
      const h = box.offsetHeight;
      const top = r.bottom + 4 + h > innerHeight && r.top - 4 - h > 0 ? r.top - 4 - h : r.bottom + 4;
      box.style.top = (top + scrollY) + "px";
    } else box.classList.add("sheet-mode");

    const err = box.querySelector(".ced-err");
    const btnS = box.querySelector("[data-s]");
    let busy = false;
    const close = () => { bg.remove(); box.remove(); cell.classList.remove("ed-on"); open = null; };
    const run = async (fn) => {
      if (busy) return;
      busy = true; btnS.disabled = true; err.hidden = true;
      const res = await fn();
      busy = false; btnS.disabled = false;
      if (res === false) return;                       // ยังไม่บันทึก (เช่นกดยกเลิกที่ยืนยัน)
      if (res?.message) {
        err.textContent = res.message; err.hidden = false;
        if (res.stale) { close(); alert(res.message); onSaved?.(); }
        return;
      }
      close(); onSaved?.();
    };
    const save = () => run(onSave);
    bg.addEventListener("click", save);                // คลิกที่อื่น = บันทึก (แบบ Excel)
    box.querySelector("[data-c]").addEventListener("click", close);
    btnS.addEventListener("click", save);
    box.querySelector("[data-x]")?.addEventListener("click", () => run(onDelete));
    // Esc ตอน dropdown เปิดอยู่ → ปิด dropdown ก่อน (combobox จัดการเอง)
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !box.querySelector(".cb-list:not([hidden])")) { e.preventDefault(); close(); }
    }, true);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.defaultPrevented && !e.isComposing && e.target.tagName !== "SELECT") { e.preventDefault(); save(); }
    });
    open = { close };
    // โฟกัส + เลือกข้อความเดิม → พิมพ์ทับได้ทันทีแบบ Excel
    setTimeout(() => { const i = box.querySelector("input"); i?.focus(); i?.select(); }, 0);
    return box;
  }

  // ---------- ช่องข้อความ ----------
  function editField(cell, m, col) {
    if (col === "poc") {
      // POC หลายคณะ / หลายภารกิจ → 1 แถว = ชื่อ + เบอร์ · กด + เพิ่ม POC ได้ (เก็บแบบ pocFields ใน missions.js)
      const rowHTML = (p = {}) => `<div class="ced-poc">
          <input data-pn placeholder="ชื่อ POC" value="${esc(p.name || "")}">
          <input data-pp placeholder="เบอร์โทร" value="${esc(p.phone || "")}" inputmode="tel">
          <button type="button" class="btn-mini" data-pdel title="ลบ POC นี้">−</button></div>`;
      const cur = parsePoc(m);
      const box = popup(cell, "POC คณะ", m, `
        <div class="ced-pocs">${(cur.length ? cur : [{}]).map(rowHTML).join("")}</div>
        <button type="button" class="btn sm ghost" data-padd style="align-self:flex-start">+ เพิ่ม POC</button>
        <div class="ced-note">หลายภารกิจ / หลายคณะ → แสดงบรรทัดละคน (1) (2) … ตามลำดับ</div>`, {
        onSave: () => {
          const list = [...box.querySelectorAll(".ced-poc")].map((r) =>
            ({ name: r.querySelector("[data-pn]").value, phone: r.querySelector("[data-pp]").value }));
          const patch = pocFields(list);
          if (patch.poc_name === (m.poc_name || "") && patch.poc_phone === (m.poc_phone || "")) return null;
          return updateMission(m, patch);
        },
      });
      const wrap = box.querySelector(".ced-pocs");
      box.querySelector("[data-padd]").addEventListener("click", () => {
        wrap.insertAdjacentHTML("beforeend", rowHTML());
        wrap.lastElementChild.querySelector("input").focus();
      });
      wrap.addEventListener("click", (e) => {
        const d = e.target.closest("[data-pdel]");
        if (!d) return;
        if (wrap.children.length > 1) d.closest(".ced-poc").remove();
        else d.closest(".ced-poc").querySelectorAll("input").forEach((i) => { i.value = ""; });
      });
      return;
    }
    const box = popup(cell, FIELDS[col] || col, m, `
      <input data-in value="${esc(m[col] || "")}">
      ${SLASH_HINT.includes(col) ? `<div class="ced-note">ใส่ / เพื่อขึ้นบรรทัดใหม่</div>` : ""}`, {
      onSave: () => {
        let v = box.querySelector("[data-in]").value.trim();
        if (col === "mission_name" && !v) return { message: "ชื่อภารกิจเว้นว่างไม่ได้" };
        if (v === (m[col] || "")) return null;
        if (!v && NULLABLE.includes(col)) v = null;
        return updateMission(m, { [col]: v });
      },
      onDelete: NULLABLE.includes(col) && m[col] ? () => updateMission(m, { [col]: null }) : null,
    });
  }

  // ---------- ลูกเรือ 1 คน (c = เดิม · null = เพิ่มใหม่ในตำแหน่ง presetRole) ----------
  function editCrew(cell, m, c, presetRole) {
    const extra = c ? [] : [
      ...(m.travel_director ? [] : [["travel_director", "ผอ.เดินทาง"]]),
      ...(m.doc_officer ? [] : [["doc_officer", "น.เอกสาร"]]),
    ];
    let role = c ? (c.position || "").toUpperCase() : (presetRole || "IP");
    let pick = c?.crew_member_id ? items.find((x) => x.id === c.crew_member_id) || null : null;
    let text = c?.crew_name || "";
    const reported = !!reportOf(m);

    const box = popup(cell, c ? `ลูกเรือ · ${role}` : "เพิ่มลูกเรือ", m, `
      <label class="ced-l">หน้าที่</label>
      <select data-role>
        <optgroup label="นักบิน">${PILOT_ROLES.map((r) => `<option value="${r}">${r}</option>`).join("")}</optgroup>
        <optgroup label="ลูกเรืออื่น">${OTHER_ROLES.map((r) => `<option value="${r}">${r}</option>`).join("")}</optgroup>
        ${extra.length ? `<optgroup label="คณะและผู้ประสานงาน">${extra.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</optgroup>` : ""}
      </select>
      <div class="ced-note" data-auto hidden></div>
      <label class="ced-l">ชื่อ</label>
      <div data-name></div>
      ${reported ? `<div class="ced-note warn">ภารกิจนี้รายงานหลังบินแล้ว — เปลี่ยนนักบิน ชม.บินจะย้ายไปคนใหม่อัตโนมัติ</div>` : ""}`, {
      onSave: () => {
        if (FIELDS[role]) {                                    // ผอ.เดินทาง / น.เอกสาร → ช่องใน missions
          const v = text.trim();
          return v ? updateMission(m, { [role]: v }) : { message: "กรอกชื่อ" };
        }
        const name = text.trim();
        if (!name) return c ? writeCrew(m, c, null) : null;    // ลบชื่อจนว่าง = ถอดออก
        let row;
        if (isPilot(role) && pick) row = { position: role, crew_name: pick.label, crew_member_id: pick.id };
        else if (isPilot(role) && role !== "AC")
          return { message: "เลือกนักบินจากรายชื่อในทะเบียน (พิมพ์ชื่อหรือรหัสแล้วเลือก) — ไม่งั้นจะไม่นับคิว / ชม.บิน" };
        else row = { position: role, crew_name: name, crew_member_id: isPilot(role) && pick ? pick.id : null };
        if (c && row.position === c.position && row.crew_name === c.crew_name
              && (row.crew_member_id || null) === (c.crew_member_id || null)) return null;
        return writeCrew(m, c, row);
      },
      onDelete: c ? () => (confirm(`ถอด ${c.crew_name} ออกจากภารกิจนี้?`) ? writeCrew(m, c, null) : false) : null,
    });

    const sel = box.querySelector("[data-role]");
    const auto = box.querySelector("[data-auto]");
    const nameBox = box.querySelector("[data-name]");
    sel.value = role;
    // ชื่อ: นักบิน = เลือกจากทะเบียน (combobox) · อื่น ๆ = พิมพ์ชื่อเอง
    let mode = null;
    function drawName() {
      const want = isPilot(role) ? "combo" : "plain";
      if (want === mode) return;
      mode = want;
      if (want === "combo") {
        nameBox.innerHTML = comboHTML("พิมพ์ชื่อหรือรหัส แล้วเลือกจากรายชื่อ");
        let ready = false;                                   // ข้ามรอบแรก (combobox เรียก onChange ตอนเปิด)
        attachCombo(nameBox.querySelector(".cb"), items, {
          value: text, id: pick?.id || null,
          emptyHtml: `ไม่พบในทะเบียน — <a href="crew.html" target="_blank">เปิดทะเบียนนักบิน</a>`,
          onChange: ({ text: t, item }) => {
            const changed = ready && item && item.id !== pick?.id;
            text = t; pick = item;
            // เลือกนักบิน → หน้าที่ปรับตามศักย์การบิน (IP/P/CP) · ตำแหน่งพิเศษ (AC/นบ.ราชฯ/ตห./N) ไม่เปลี่ยน
            if (changed && QUALS.includes(role) && QUALS.includes(item.position) && item.position !== role) {
              role = item.position; sel.value = role;
              auto.textContent = `หน้าที่ปรับเป็น ${role} ตามศักย์การบิน — เปลี่ยนเองได้`;
              auto.hidden = false;
              sel.classList.remove("flash"); void sel.offsetWidth; sel.classList.add("flash");
            }
          },
        });
        ready = true;
      } else {
        nameBox.innerHTML = `<input data-plain placeholder="ชื่อ" autocomplete="off">`;
        const i = nameBox.querySelector("input");
        i.value = text;
        i.addEventListener("input", () => { text = i.value; pick = null; });
      }
    }
    sel.addEventListener("change", () => {
      role = sel.value; auto.hidden = true;
      drawName();
      nameBox.querySelector("input")?.focus();
    });
    drawName();
  }
}
