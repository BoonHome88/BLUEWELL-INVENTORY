# BlueWell Inventory v2.8 — Online Free Ready

ระบบจัดการสต็อก React + Vite + Supabase ที่เตรียมสำหรับ Deploy ออนไลน์แล้ว

## สิ่งที่เตรียมให้ในเวอร์ชันนี้

- รองรับ Deploy บน Vercel
- มี `vercel.json` สำหรับ SPA
- รองรับ Environment Variables ผ่าน `.env.local`
- ยังมีค่า Supabase เดิมเป็น fallback เพื่อทดลอง Deploy ได้ทันที
- ปิด production source map
- ลบ `node_modules` ออกจากชุดส่งมอบเพื่อลดขนาด
- เพิ่ม RPC Force Delete สินค้า
- แก้ RPC ลบผู้ใช้ให้รองรับกรณีถูกลบจาก Supabase Dashboard ไปก่อนแล้ว
- ไม่ต้องใช้ Supabase Edge Function หรือ Supabase CLI

## เริ่มใช้งานในเครื่อง

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## คู่มือขึ้นออนไลน์ฟรี

อ่านไฟล์ [`SETUP-ONLINE-FREE.md`](./SETUP-ONLINE-FREE.md)

## SQL ที่ต้องรันเพิ่มเมื่อใช้ฐานข้อมูลเดิม

```text
supabase/migration-v2.5.sql
supabase/migration-v2.6-admin-delete-user.sql
supabase/migration-v2.7-force-delete-product.sql
```
