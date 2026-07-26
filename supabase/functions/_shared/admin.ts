import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
})

export async function requireAdmin(req: Request) {
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authHeader = req.headers.get('Authorization') || ''
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: authData, error: authError } = await userClient.auth.getUser()
  if (authError || !authData.user) throw new Error('กรุณาเข้าสู่ระบบใหม่')
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: profile, error: profileError } = await admin.from('profiles').select('role,is_active').eq('id', authData.user.id).single()
  if (profileError || profile?.role !== 'admin' || !profile?.is_active) throw new Error('เฉพาะผู้ดูแลระบบเท่านั้น')
  return { admin, user: authData.user }
}
