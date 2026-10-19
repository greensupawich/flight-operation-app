// =====================================================================
//  supabase.js — ตั้งค่าการเชื่อมต่อ Supabase
//  • เปิดจากเว็บจริง (*.github.io)  → ฐานจริง (PROD)
//  • เปิดจากเครื่อง (localhost) → DEV ถ้าตั้งค่าไว้ · ไม่งั้นใช้ฐานจริง + ป้ายแดง "ฐานจริง" ที่แถบเมนู
//  anon key เปิดเผยได้ปลอดภัย เพราะ RLS คุมสิทธิ์อยู่ที่ฐานข้อมูล
//  ห้ามใส่ service_role key ในไฟล์นี้เด็ดขาด
//  เพิ่ม/เปลี่ยนโปรเจกต์ → แก้ CSP (connect-src / img-src / media-src) ในทุกหน้า .html ด้วย
// =====================================================================

const PROD = {
  url: "https://iljapjszrjuzjjbtxctu.supabase.co",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlsamFwanN6cmp1empqYnR4Y3R1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMTAwODksImV4cCI6MjEwNDY4NjA4OX0.2SLAx19gCIgIPooZp9TdAGa5ShbZNlcGtaIP4LV6ppg",
};
// โปรเจกต์ DEV (ข้อมูลสมมติ) — ดูวิธีตั้งใน CONTRIBUTING.md
const DEV = {
  url: "",
  key: "",
};

export const IS_PROD = /\.github\.io$/.test(location.hostname);   // เปิดจากเว็บจริง
// เปิดจากเครื่อง (localhost): ใช้ DEV ถ้าตั้งไว้ · ยังไม่ตั้ง → ใช้ฐานจริง (แถบเมนูขึ้นป้ายแดงเตือน)
export const DB_ENV = IS_PROD ? "prod" : (DEV.url && DEV.key ? "dev" : "prod-local");
const CFG = DB_ENV === "dev" ? DEV : PROD;
const SUPABASE_URL = CFG.url;
const SUPABASE_ANON_KEY = CFG.key;

// โหลด SDK จาก CDN แบบ ESM แล้ว export client ให้ไฟล์อื่นใช้
// pin เวอร์ชันแน่นอน (กัน CDN ส่งโค้ดใหม่ที่ไม่ได้ตรวจมาแทน) — อัปเดตเมื่อจำเป็นเท่านั้น
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// URL ที่ให้ Google เด้งกลับหลังล็อกอิน (ต้องตรงกับที่ตั้งใน Supabase → Auth → URL config)
export const REDIRECT_URL = window.location.origin + window.location.pathname.replace(/[^/]+$/, "") + "home.html";
