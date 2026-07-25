# วิธีนำ BlueWell Inventory ขึ้นออนไลน์แบบฟรี

ชุดนี้เตรียมไว้สำหรับ **Supabase Free + Vercel Hobby** และใช้ได้ทันทีโดยไม่ต้องติดตั้ง Supabase CLI หรือ Edge Function

## A. เตรียม Supabase

### กรณีใช้ Supabase เดิม

ไม่ต้องสร้าง Project ใหม่ ให้ไปที่ **SQL Editor** แล้วรันเฉพาะไฟล์ที่ยังไม่เคยรันตามลำดับ:

1. `supabase/migration-v2.5.sql`
2. `supabase/migration-v2.6-admin-delete-user.sql`
3. `supabase/migration-v2.7-force-delete-product.sql`

### กรณีสร้าง Supabase ใหม่

1. สมัครและสร้าง Project แบบ Free
2. เปิด **SQL Editor → New query**
3. รันไฟล์ตามลำดับ:
   - `supabase/schema.sql`
   - `supabase/migration-v1.2.sql`
   - `supabase/migration-v1.3.sql`
   - `supabase/migration-v2.5.sql`
   - `supabase/migration-v2.6-admin-delete-user.sql`
   - `supabase/migration-v2.7-force-delete-product.sql`
4. ไปที่ **Authentication → Sign In / Providers → Email**
5. เปิด Email provider และปิด **Confirm email** เพราะระบบใช้ Username แปลงเป็นอีเมลภายใน `username@bluewell.local`
6. สร้างผู้ใช้คนแรกจากหน้าเว็บ แล้วรันใน SQL Editor:

```sql
select public.claim_first_admin();
```

หมายเหตุ: ต้องรันคำสั่งนี้จาก session ผู้ใช้ผ่าน API จึงจะทำงานได้ หากสร้าง Admin แรกจาก Dashboard ให้ไปที่ **Table Editor → profiles** แล้วแก้ `role` เป็น `admin` โดยตรง

## B. ตั้งค่า Supabase Project ใหม่ในโค้ด

เปิด **Supabase → Project Settings → Data API** แล้วคัดลอก:

- Project URL
- Publishable key หรือ anon key

สร้างไฟล์ `.env.local` ที่ root ของโปรเจกต์:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

ถ้าใช้ Supabase เดิมที่มากับไฟล์นี้ สามารถข้ามขั้นตอนนี้ได้ เพราะมี fallback พร้อมใช้งาน

## C. ทดสอบในเครื่อง

เปิด Terminal ในโฟลเดอร์โปรเจกต์:

```bash
npm install
npm run dev
```

เปิด URL ที่แสดงใน Terminal เช่น `http://localhost:5173`

ทดสอบอย่างน้อย:

- เข้าสู่ระบบ
- เพิ่มสินค้า
- เบิก/เติมสินค้า
- สร้างผู้ใช้
- ลบผู้ใช้
- อัปโหลดรูป
- สำรองข้อมูล JSON

## D. นำขึ้น GitHub

1. สร้าง Repository ใหม่ใน GitHub
2. แตก ZIP แล้วเปิดโฟลเดอร์ `BlueWell-Inventory`
3. รัน:

```bash
git init
git add .
git commit -m "Deploy BlueWell Inventory"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

ไม่ต้องอัปโหลด `node_modules` เพราะถูกตัดออกจาก ZIP นี้แล้ว

## E. Deploy ฟรีบน Vercel

1. เข้า Vercel ด้วยบัญชี GitHub
2. กด **Add New → Project**
3. Import Repository ที่เพิ่งสร้าง
4. Vercel ควรตรวจพบ Vite อัตโนมัติ โดยใช้:
   - Build Command: `npm run build`
   - Output Directory: `dist`
5. หากใช้ Supabase Project ใหม่ ให้เพิ่ม Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
6. กด **Deploy**
7. เมื่อเสร็จจะได้ URL เช่น `https://bluewell-inventory.vercel.app`

ไฟล์ `vercel.json` ถูกเพิ่มไว้แล้ว เพื่อให้ Refresh หน้าเว็บไม่เกิด 404

## F. ตั้งค่า URL ใน Supabase

ไปที่ **Authentication → URL Configuration**

- Site URL: URL ที่ได้จาก Vercel
- Redirect URLs เพิ่ม:
  - `http://localhost:5173/**`
  - `https://ชื่อโปรเจกต์.vercel.app/**`

จากนั้นกลับไปทดสอบ Login บน URL ออนไลน์

## G. วิธีอัปเดตระบบภายหลัง

แก้โค้ดแล้วรัน:

```bash
git add .
git commit -m "Update system"
git push
```

Vercel จะ Build และ Deploy เวอร์ชันใหม่ให้อัตโนมัติ

## ข้อจำกัดแบบฟรี

- Supabase Free อาจ Pause Project เมื่อไม่มีการใช้งานเพียงพอประมาณ 7 วัน
- ฐานข้อมูลฟรีจำกัด 500 MB
- Storage ฟรี 1 GB
- ไม่มี Automatic Database Backup ใน Free Plan ให้ใช้ปุ่มสำรอง JSON ในระบบเป็นระยะ
- Vercel Hobby เหมาะกับงานส่วนตัว/ไม่เชิงพาณิชย์ตามเงื่อนไขของ Vercel

## แก้ปัญหาที่พบบ่อย

### หน้าเว็บขึ้นจอว่างหลัง Deploy

ดู Vercel → Deployments → Build Logs และตรวจว่า Environment Variables สะกดตรง

### Login ไม่ได้

ตรวจว่า Supabase → Authentication → Email เปิดอยู่ และปิด Confirm email แล้ว

### ลบสินค้าแบบ Force Delete ไม่ได้

รัน `supabase/migration-v2.7-force-delete-product.sql`

### ลบผู้ใช้แล้วขึ้นว่าไม่พบผู้ใช้

รัน `supabase/migration-v2.6-admin-delete-user.sql` เวอร์ชันในชุดนี้ใหม่

### รูปสินค้าอัปโหลดไม่ได้

รัน `supabase/migration-v2.5.sql` และตรวจว่ามี bucket `stock-assets`
