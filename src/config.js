const DEFAULT_SUPABASE_URL = 'https://gkrntabannygiedizyxw.supabase.co'
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_GbJVO_WJk9Hkf5NM7ZKvOA_k6R3oOo0'

// ใช้ค่าใน Vercel/ไฟล์ .env ก่อน และใช้ค่าเดิมเป็น fallback เพื่อให้ Deploy ได้ทันที
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  DEFAULT_SUPABASE_PUBLISHABLE_KEY

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('ยังไม่ได้ตั้งค่า Supabase URL หรือ Publishable Key')
}
