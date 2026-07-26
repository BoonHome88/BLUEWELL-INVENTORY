import { corsHeaders, json, requireAdmin } from '../_shared/admin.ts'

const PREFIX = '__BLUEWELL_CLAIMS_V2__'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { admin, user } = await requireAdmin(req)
    const { productId } = await req.json()
    if (!productId) throw new Error('ไม่พบ Product ID')

    const { data: settings, error: settingsError } = await admin.from('company_settings').select('report_footer').eq('id', true).single()
    if (settingsError) throw settingsError
    let store: any = { version: 3, displayFooter: '', claims: [], developmentMode: false }
    const raw = settings?.report_footer || ''
    if (raw.startsWith(PREFIX)) {
      try { store = { ...store, ...JSON.parse(raw.slice(PREFIX.length)) } } catch { /* keep safe defaults */ }
    }
    if (!store.developmentMode) throw new Error('Development Mode ปิดอยู่')

    const { count, error: countError } = await admin.from('stock_transactions').select('*', { count: 'exact', head: true }).eq('product_id', productId)
    if (countError) throw countError
    const { error: txError } = await admin.from('stock_transactions').delete().eq('product_id', productId)
    if (txError) throw txError
    const { data: deleted, error: productError } = await admin.from('products').delete().eq('id', productId).select('id,name').single()
    if (productError) throw productError

    store.claims = Array.isArray(store.claims) ? store.claims.filter((c: any) => c.product_id !== productId) : []
    const { error: updateError } = await admin.from('company_settings').update({ report_footer: PREFIX + JSON.stringify(store), updated_by: user.id }).eq('id', true)
    if (updateError) throw updateError

    return json({ ok: true, deletedProduct: deleted, deletedTransactions: count || 0 })
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400)
  }
})
