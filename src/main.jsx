import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, CircleUserRound,
  LayoutDashboard, LogOut, PackagePlus, RefreshCw, Search, Settings, Warehouse,
  X, CheckCircle2, Wifi, WifiOff, History, Pencil, Plus, BarChart3, FileSpreadsheet, FileText, Printer, Moon, Sun, TrendingUp, ShieldAlert, PackageCheck, RotateCcw, Trash2, UserPlus, Power, Download, Upload, Image as ImageIcon, Database
} from 'lucide-react'
import { supabase } from './supabase'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'
import './styles.css'

const FOOTER = 'BlueWell Inventory | Powered by Armmm © 2026'
const TX_LABELS = { issue:'เบิกสินค้า', restock:'เติมสินค้า', returned:'สินค้าตีกลับ' }
const txLabel = type => TX_LABELS[type] || type
const txSign = type => type === 'issue' ? '-' : '+'
const txBadge = type => type === 'issue' ? 'danger' : type === 'returned' ? 'warning' : 'success'
const CLAIM_STORE_PREFIX = '__BLUEWELL_CLAIMS_V2__'
const readClaimStore = (value='') => {
  if(!value?.startsWith(CLAIM_STORE_PREFIX)) return {displayFooter:value||'',claims:[],developmentMode:false,users:[]}
  try{
    const parsed=JSON.parse(value.slice(CLAIM_STORE_PREFIX.length))
    return {displayFooter:parsed.displayFooter||'',claims:Array.isArray(parsed.claims)?parsed.claims:[],developmentMode:Boolean(parsed.developmentMode),users:Array.isArray(parsed.users)?parsed.users:[]}
  }catch{return {displayFooter:'',claims:[],developmentMode:false,users:[]}}
}
const writeClaimStore = (displayFooter,claims,developmentMode=false,users=[]) => CLAIM_STORE_PREFIX+JSON.stringify({version:4,displayFooter:displayFooter||'',claims,developmentMode:Boolean(developmentMode),users:Array.isArray(users)?users:[]})
const usernameToEmail = (value='') => { const clean=String(value).trim().toLowerCase(); return clean.includes('@')?clean:`${clean}@bluewell.local` }
const productImageUrl = (path='') => path ? supabase.storage.from('stock-assets').getPublicUrl(path).data.publicUrl : ''
const safeFileName = (name='image') => name.toLowerCase().replace(/[^a-z0-9._-]+/g,'-')
const timeout = (promise, ms = 15000) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('การเชื่อมต่อใช้เวลานานเกินไป กรุณาตรวจสอบอินเทอร์เน็ตหรือ Supabase')), ms)),
])

function Footer(){ return <footer className="footer">{FOOTER}</footer> }
function Spinner(){ return <span className="spinner" aria-label="กำลังโหลด" /> }
function Empty({text='ยังไม่มีข้อมูล'}){ return <div className="empty">{text}</div> }
function MiniBarChart({data,keys}){
  const max=Math.max(1,...data.flatMap(row=>keys.map(k=>Number(row[k.key]||0))))
  return <div className="mini-chart"><div className="chart-plot">{data.map((row,i)=><div className="chart-group" key={row.label||i}><div className="chart-bars">{keys.map(k=><div key={k.key} className={`chart-bar ${k.className||''}`} style={{height:`${Math.max(3,(Number(row[k.key]||0)/max)*100)}%`}} title={`${k.label}: ${Number(row[k.key]||0).toLocaleString()}`}/>)}</div><span>{row.label}</span></div>)}</div><div className="chart-legend">{keys.map(k=><span key={k.key}><i className={k.className||''}/>{k.label}</span>)}</div></div>
}

function Modal({open, title, onClose, children}){
  if(!open) return null
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <section className="modal" onMouseDown={e=>e.stopPropagation()}>
      <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="ปิด"><X size={20}/></button></header>
      {children}
    </section>
  </div>
}

function App(){
  const [stage,setStage]=useState('boot')
  const [fatal,setFatal]=useState('')
  const [session,setSession]=useState(null)
  const [profile,setProfile]=useState(null)
  const [products,setProducts]=useState([])
  const [categories,setCategories]=useState([])
  const [transactions,setTransactions]=useState([])
  const [claims,setClaims]=useState([])
  const [company,setCompany]=useState(null)
  const [page,setPage]=useState('dashboard')
  const [busy,setBusy]=useState(false)
  const [online,setOnline]=useState(navigator.onLine)
  const [toast,setToast]=useState('')
  const [query,setQuery]=useState('')
  const [historyQuery,setHistoryQuery]=useState('')
  const [typeFilter,setTypeFilter]=useState('')
  const [productModal,setProductModal]=useState(false)
  const [txModal,setTxModal]=useState(false)
  const [editing,setEditing]=useState(null)
  const [txProduct,setTxProduct]=useState(null)
  const [claimModal,setClaimModal]=useState(false)
  const [claimUpdateModal,setClaimUpdateModal]=useState(false)
  const [claimIssue,setClaimIssue]=useState(null)
  const [editingClaim,setEditingClaim]=useState(null)
  const [claimQuery,setClaimQuery]=useState('')
  const [claimStatus,setClaimStatus]=useState('')
  const [reportFrom,setReportFrom]=useState('')
  const [reportTo,setReportTo]=useState('')
  const [reportCategory,setReportCategory]=useState('')
  const [reportProduct,setReportProduct]=useState('')
  const [reportType,setReportType]=useState('')
  const [reportActor,setReportActor]=useState('')
  const [theme,setTheme]=useState(()=>localStorage.getItem('bluewell-theme')||'light')
  const [developmentMode,setDevelopmentMode]=useState(false)
  const [users,setUsers]=useState([])
  const [userBusy,setUserBusy]=useState(false)
  const [imagePreview,setImagePreview]=useState('')
  const [backupBusy,setBackupBusy]=useState(false)

  const notify = useCallback((text)=>{setToast(text);setTimeout(()=>setToast(''),2600)},[])
  const isAdmin = profile?.role === 'admin'
  const displayName = isAdmin ? 'ผู้ดูแลระบบ (Arm)' : (profile?.full_name || session?.user?.email || '')

  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem('bluewell-theme',theme)},[theme])

  const loadAll = useCallback(async(user)=>{
    setBusy(true)
    try{
      const [profileRes, productRes, categoryRes, txRes, companyRes] = await timeout(Promise.all([
        supabase.from('profiles').select('*').eq('id',user.id).maybeSingle(),
        supabase.from('products').select('*, categories(name)').order('name'),
        supabase.from('categories').select('*').order('name'),
        supabase.from('stock_transactions').select('*, products(name,unit)').order('created_at',{ascending:false}).limit(500),
        supabase.from('company_settings').select('*').eq('id',true).maybeSingle(),
      ]))
      for(const result of [profileRes,productRes,categoryRes,txRes,companyRes]) if(result.error) throw result.error
      if(!profileRes.data) throw new Error('ไม่พบ Profile ของผู้ใช้ กรุณาตรวจสอบ Trigger handle_new_user หรือสร้าง Profile ให้บัญชีนี้')
      if(!profileRes.data.is_active) throw new Error('บัญชีนี้ถูกปิดใช้งาน')
      setProfile(profileRes.data)
      setProducts(productRes.data || [])
      setCategories(categoryRes.data || [])
      setTransactions(txRes.data || [])
      const companyData=companyRes.data || null
      const claimStore=readClaimStore(companyData?.report_footer||'')
      const txById=new Map((txRes.data||[]).map(t=>[t.id,t]))
      const productById=new Map((productRes.data||[]).map(p=>[p.id,p]))
      setClaims(claimStore.claims.map(c=>({...c,issue:txById.get(c.issue_transaction_id)||null,products:productById.get(c.product_id)||null})))
      setCompany(companyData?{...companyData,report_footer:claimStore.displayFooter}:null)
      setDevelopmentMode(claimStore.developmentMode)
      const storedUsers=claimStore.users||[]
      const currentUsername=String(user.user_metadata?.username||user.email?.split('@')[0]||'').toLowerCase()
      setUsers(storedUsers.some(u=>u.id===user.id)?storedUsers:[{id:user.id,username:currentUsername,full_name:profileRes.data.full_name,role:profileRes.data.role,is_active:profileRes.data.is_active},...storedUsers])
      setStage('app')
    }catch(error){
      setFatal(error.message || String(error)); setStage('error')
    }finally{setBusy(false)}
  },[])

  const bootstrap = useCallback(async()=>{
    setStage('boot');setFatal('')
    try{
      const {data,error}=await timeout(supabase.auth.getSession())
      if(error) throw error
      const current=data.session || null
      setSession(current)
      if(current) await loadAll(current.user)
      else setStage('login')
    }catch(error){setFatal(error.message || String(error));setStage('error')}
  },[loadAll])

  useEffect(()=>{
    bootstrap()
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,newSession)=>{
      setSession(newSession)
      if(event==='SIGNED_OUT'){setProfile(null);setStage('login')}
      if(event==='SIGNED_IN' && newSession) setTimeout(()=>loadAll(newSession.user),0)
    })
    const onOnline=()=>setOnline(true), onOffline=()=>setOnline(false)
    window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline)
    return()=>{subscription.unsubscribe();window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline)}
  },[bootstrap,loadAll])

  useEffect(()=>{
    if(stage!=='app') return
    const channel=supabase.channel('bluewell-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'products'},()=>loadAll(session.user))
      .on('postgres_changes',{event:'*',schema:'public',table:'stock_transactions'},()=>loadAll(session.user))
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'company_settings'},()=>loadAll(session.user))
      .subscribe()
    return()=>{supabase.removeChannel(channel)}
  },[stage,session,loadAll])

  const login=async(e)=>{
    e.preventDefault();setBusy(true);setFatal('')
    const form=new FormData(e.currentTarget)
    try{
      const {error}=await timeout(supabase.auth.signInWithPassword({email:usernameToEmail(form.get('username')),password:form.get('password')}))
      if(error) throw error
    }catch(error){setFatal(error.message==='Invalid login credentials'?'Username หรือรหัสผ่านไม่ถูกต้อง':error.message)}finally{setBusy(false)}
  }

  const logout=()=>supabase.auth.signOut()

  const saveProduct=async(e)=>{
    e.preventDefault();setBusy(true)
    const f=new FormData(e.currentTarget)
    const autoSku=editing?.sku||`BW-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`
    const payload={sku:autoSku,name:f.get('name').trim(),category_id:f.get('category_id')||null,unit:f.get('unit').trim()||'ชิ้น',min_stock:Math.max(0,Number(f.get('min_stock')||0)),is_active:true}
    try{
      let result
      if(editing) result=await supabase.from('products').update(payload).eq('id',editing.id).select().single()
      else result=await supabase.from('products').insert({...payload,quantity:Number(f.get('quantity')||0),created_by:session.user.id}).select().single()
      if(result.error) throw result.error
      const image=f.get('image')
      if(image instanceof File && image.size>0){
        if(image.size>2*1024*1024) throw new Error('รูปสินค้าต้องมีขนาดไม่เกิน 2 MB')
        if(!['image/jpeg','image/png','image/webp'].includes(image.type)) throw new Error('รองรับเฉพาะไฟล์ JPG, PNG และ WebP')
        const path=`products/${result.data.id}/${Date.now()}-${safeFileName(image.name)}`
        const upload=await supabase.storage.from('stock-assets').upload(path,image,{cacheControl:'3600',upsert:false})
        if(upload.error) throw upload.error
        const update=await supabase.from('products').update({image_path:path}).eq('id',result.data.id)
        if(update.error) throw update.error
        if(editing?.image_path) await supabase.storage.from('stock-assets').remove([editing.image_path])
      }
      setProductModal(false);setEditing(null);setImagePreview('');notify('บันทึกสินค้าแล้ว');await loadAll(session.user)
    }catch(error){notify(`บันทึกไม่สำเร็จ: ${error.message}`)}finally{setBusy(false)}
  }

  const exportBackup=async()=>{
    setBackupBusy(true)
    try{
      const [catRes,productRes,txRes,companyRes]=await Promise.all([
        supabase.from('categories').select('*').order('created_at'),
        supabase.from('products').select('*').order('created_at'),
        supabase.from('stock_transactions').select('*').order('created_at'),
        supabase.from('company_settings').select('*').eq('id',true).maybeSingle(),
      ])
      for(const r of [catRes,productRes,txRes,companyRes]) if(r.error) throw r.error
      const backup={format:'bluewell-inventory-backup',version:1,created_at:new Date().toISOString(),created_by:displayName,categories:catRes.data||[],products:productRes.data||[],stock_transactions:txRes.data||[],company_settings:companyRes.data||null}
      const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'})
      const url=URL.createObjectURL(blob),a=document.createElement('a')
      a.href=url;a.download=`BlueWell_Backup_${new Date().toISOString().slice(0,19).replaceAll(':','-')}.json`;a.click();URL.revokeObjectURL(url)
      notify('ดาวน์โหลดไฟล์สำรองข้อมูลแล้ว')
    }catch(error){notify(`สำรองข้อมูลไม่สำเร็จ: ${error.message}`)}finally{setBackupBusy(false)}
  }

  const restoreBackup=async(e)=>{
    const file=e.target.files?.[0];e.target.value=''
    if(!file) return
    if(!window.confirm('กู้คืนข้อมูลจากไฟล์นี้หรือไม่? ข้อมูลหมวดหมู่ สินค้า และข้อมูลบริษัทที่ ID ตรงกันจะถูกเขียนทับ')) return
    setBackupBusy(true)
    try{
      const data=JSON.parse(await file.text())
      if(data.format!=='bluewell-inventory-backup'||!Array.isArray(data.products)||!Array.isArray(data.categories)) throw new Error('รูปแบบไฟล์สำรองไม่ถูกต้อง')
      if(data.categories.length){
        const rows=data.categories.map(({created_by,...c})=>({...c,created_by:created_by||session.user.id}))
        const {error}=await supabase.from('categories').upsert(rows,{onConflict:'id'});if(error)throw error
      }
      if(data.products.length){
        const rows=data.products.map(({categories,...p})=>({...p,created_by:p.created_by||session.user.id}))
        const {error}=await supabase.from('products').upsert(rows,{onConflict:'id'});if(error)throw error
      }
      if(data.company_settings){
        const {id,updated_by,...companyData}=data.company_settings
        const {error}=await supabase.from('company_settings').update({...companyData,updated_by:session.user.id}).eq('id',true);if(error)throw error
      }
      notify('กู้คืนข้อมูลสำเร็จ (ประวัติธุรกรรมเก็บเป็นข้อมูลอ้างอิงและไม่ถูกเขียนทับ)');await loadAll(session.user)
    }catch(error){notify(`กู้คืนไม่สำเร็จ: ${error.message}`)}finally{setBackupBusy(false)}
  }

  const saveTx=async(e)=>{
    e.preventDefault();setBusy(true)
    const f=new FormData(e.currentTarget)
    try{
      const {error}=await supabase.rpc('process_stock_transaction',{p_product_id:txProduct.id,p_transaction_type:f.get('type'),p_quantity:Number(f.get('quantity')),p_note:f.get('note')||''})
      if(error) throw error
      setTxModal(false);notify('ทำรายการสต็อกสำเร็จ');await loadAll(session.user)
    }catch(error){notify(`ทำรายการไม่สำเร็จ: ${error.message}`)}finally{setBusy(false)}
  }

  const persistClaims=async(nextClaims,displayFooter=company?.report_footer||'')=>{
    const {error}=await supabase.from('company_settings').update({report_footer:writeClaimStore(displayFooter,nextClaims,developmentMode,users),updated_by:session.user.id}).eq('id',true)
    if(error) throw error
  }

  const createClaim=async(e)=>{
    e.preventDefault();setBusy(true)
    const f=new FormData(e.currentTarget)
    try{
      if(!isAdmin) throw new Error('เฉพาะผู้ดูแลระบบสามารถบันทึกรายการเคลมได้')
      const quantity=Number(f.get('quantity'))
      const already=Number(claimedByIssue[claimIssue.id]||0)
      if(quantity<1||already+quantity>Number(claimIssue.quantity)) throw new Error('ยอดเคลมเกินจำนวนที่เบิก')
      const now=new Date()
      const day=now.toISOString().slice(0,10).replaceAll('-','')
      const seq=claims.filter(c=>String(c.claim_no||'').startsWith(`CL-${day}-`)).length+1
      const claim={id:crypto.randomUUID(),claim_no:`CL-${day}-${String(seq).padStart(4,'0')}`,issue_transaction_id:claimIssue.id,issue_document_no:claimIssue.document_no,product_id:claimIssue.product_id,quantity,replacement_received:0,status:'pending',actor_id:session.user.id,actor_name:displayName,damage_note:f.get('damage_note')||'',vendor_note:'',replacement_documents:[],created_at:now.toISOString(),updated_at:now.toISOString()}
      await persistClaims([...claims.map(({issue,products,...c})=>c),claim])
      setClaimModal(false);setClaimIssue(null);notify('สร้างรายการส่งเคลมแล้ว');await loadAll(session.user)
    }catch(error){notify(`สร้างรายการเคลมไม่สำเร็จ: ${error.message}`)}finally{setBusy(false)}
  }

  const updateClaim = async (e) => {
  e.preventDefault()
  setBusy(true)

  const f = new FormData(e.currentTarget)

  try {
    if (!isAdmin) {
      throw new Error('เฉพาะผู้ดูแลระบบสามารถอัปเดตเคลมได้')
    }

    const nextReceived = Number(f.get('replacement_received') || 0)
    const previous = Number(editingClaim.replacement_received || 0)

    if (
      nextReceived < previous ||
      nextReceived > Number(editingClaim.quantity)
    ) {
      throw new Error('ยอดรับทดแทนไม่ถูกต้อง')
    }

    const delta = nextReceived - previous

    let replacementDocuments = [
      ...(editingClaim.replacement_documents || []),
    ]

    if (delta > 0) {
      const { data, error } = await supabase.rpc(
        'process_stock_transaction',
        {
          p_product_id: editingClaim.product_id,
          p_transaction_type: 'restock',
          p_quantity: delta,
          p_note: `รับสินค้าทดแทนจากเคลม ${
            editingClaim.claim_no
          } | อ้างอิงใบเบิก ${
            editingClaim.issue_document_no ||
            editingClaim.issue?.document_no ||
            '-'
          }`,
        }
      )

      if (error) throw error

      if (data?.document_no) {
        replacementDocuments.push(data.document_no)
      }
    }

    let status = f.get('status')

    if (
      nextReceived === Number(editingClaim.quantity) &&
      !['rejected', 'closed'].includes(status)
    ) {
      status = 'replaced'
    } else if (
      nextReceived > 0 &&
      nextReceived < Number(editingClaim.quantity) &&
      !['rejected', 'closed'].includes(status)
    ) {
      status = 'partial'
    }

    const plainClaims = claims.map(({ issue, products, ...c }) => c)

    const nextClaims = plainClaims.map(c =>
      c.id === editingClaim.id
        ? {
            ...c,
            status,
            replacement_received: nextReceived,
            vendor_note: f.get('vendor_note') || '',
            replacement_documents: replacementDocuments,
            updated_at: new Date().toISOString(),
          }
        : c
    )

    await persistClaims(nextClaims)

    setClaimUpdateModal(false)
    setEditingClaim(null)

    notify(
      delta > 0
        ? `รับสินค้าทดแทน ${delta.toLocaleString()} ชิ้นและอัปเดตสต็อกแล้ว`
        : 'อัปเดตสถานะเคลมแล้ว'
    )

    await loadAll(session.user)
  } catch (error) {
    notify(`อัปเดตเคลมไม่สำเร็จ: ${error.message}`)
  } finally {
    setBusy(false)
  }
}

  const saveCompany=async(e)=>{
    e.preventDefault();setBusy(true);const f=new FormData(e.currentTarget)
    const payload={company_name:f.get('company_name'),system_title:f.get('system_title'),subtitle:f.get('subtitle'),address:f.get('address'),phone:f.get('phone'),email:f.get('email'),report_footer:writeClaimStore(f.get('report_footer')||'',claims.map(({issue,products,...c})=>c),developmentMode,users),updated_by:session.user.id}
    try{const {error}=await supabase.from('company_settings').update(payload).eq('id',true);if(error)throw error;notify('บันทึกข้อมูลบริษัทแล้ว');await loadAll(session.user)}catch(error){notify(`บันทึกไม่สำเร็จ: ${error.message}`)}finally{setBusy(false)}
  }

  const loadUsers=async()=>{
    if(!isAdmin) return
    setUserBusy(true)
    try{
      const {data:profiles,error}=await supabase.from('profiles').select('id,full_name,role,is_active').order('created_at',{ascending:true})
      if(error) throw error
      const byId=new Map((profiles||[]).map(p=>[p.id,p]))
      const currentUsername=String(session?.user?.user_metadata?.username||session?.user?.email?.split('@')[0]||'').toLowerCase()
      const directory=[...users]
      if(session?.user&&!directory.some(u=>u.id===session.user.id)) directory.unshift({id:session.user.id,username:currentUsername})
      setUsers(directory.map(u=>({...u,...(byId.get(u.id)||{})})))
    }catch(error){notify(`โหลดผู้ใช้ไม่สำเร็จ: ${error.message}`)}finally{setUserBusy(false)}
  }

const deleteUser = async user => {
  if (!isAdmin) {
    notify('เฉพาะผู้ดูแลระบบสามารถลบผู้ใช้งานได้')
    return
  }

  if (!user?.id) {
    notify('ไม่พบรหัสผู้ใช้งาน')
    return
  }

  if (user.id === session?.user?.id) {
    notify('ไม่สามารถลบบัญชีที่กำลังเข้าสู่ระบบอยู่ได้')
    return
  }

  const userLabel = user.full_name || user.username || 'ผู้ใช้งานนี้'

  const confirmed = window.confirm(
    `ต้องการลบบัญชี “${userLabel}” หรือไม่?\n\nบัญชีนี้จะไม่สามารถเข้าสู่ระบบได้อีก`
  )

  if (!confirmed) return

  const verify = window.prompt(
    `พิมพ์ DELETE เพื่อยืนยันการลบบัญชี “${userLabel}”`
  )

  if (verify !== 'DELETE') {
    notify('ยกเลิกการลบผู้ใช้งาน')
    return
  }

  setUserBusy(true)

  try {
    const { data, error } = await supabase.rpc(
      'admin_delete_user',
      {
        p_user_id: user.id,
      }
    )

    if (error) throw error

    const nextUsers = users.filter(item => item.id !== user.id)

    // ลบผู้ใช้ออกจากข้อมูลรายชื่อที่เก็บใน company_settings ด้วย
    const { error: storeError } = await supabase
      .from('company_settings')
      .update({
        report_footer: writeClaimStore(
          company?.report_footer || '',
          claims.map(({ issue, products, ...claim }) => claim),
          developmentMode,
          nextUsers
        ),
        updated_by: session.user.id,
      })
      .eq('id', true)

    if (storeError) {
      console.warn(
        'ลบบัญชีสำเร็จ แต่ปรับปรุงรายชื่อผู้ใช้ไม่สำเร็จ:',
        storeError
      )
    }

    setUsers(nextUsers)

    notify(
      `ลบบัญชี “${data?.full_name || userLabel}” เรียบร้อยแล้ว`
    )

    await loadUsers()
  } catch (error) {
    notify(`ลบผู้ใช้งานไม่สำเร็จ: ${error.message}`)
  } finally {
    setUserBusy(false)
  }
}

  const createUser=async(e)=>{
    e.preventDefault();setUserBusy(true)
    const form=e.currentTarget
    const f=new FormData(form)
    const username=String(f.get('username')||'').trim().toLowerCase()
    const password=String(f.get('password')||'')
    const fullName=String(f.get('full_name')||'').trim()
    const role=String(f.get('role')||'employee')==='admin'?'admin':'employee'
    let createdUser=null
    try{
      if(users.some(u=>String(u.username).toLowerCase()===username)) throw new Error('Username นี้มีอยู่แล้ว')
      const accountClient=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
      const {data,error}=await timeout(accountClient.auth.signUp({
        email:usernameToEmail(username),password,
        options:{data:{username,full_name:fullName}}
      }))
      if(error) throw error
      createdUser=data?.user
      if(!createdUser?.id) throw new Error('Supabase ไม่ได้ส่งรหัสผู้ใช้กลับมา')

      let profileUpdated=false
      let lastProfileError=null
      for(let attempt=0;attempt<5&&!profileUpdated;attempt++){
        if(attempt) await new Promise(resolve=>setTimeout(resolve,500))
        const result=await supabase.from('profiles').update({full_name:fullName,role,is_active:true}).eq('id',createdUser.id).select('id').maybeSingle()
        lastProfileError=result.error
        profileUpdated=Boolean(result.data?.id)&&!result.error
      }
      if(!profileUpdated) throw new Error(`สร้างบัญชีแล้ว แต่กำหนดสิทธิ์ไม่สำเร็จ: ${lastProfileError?.message||'ไม่พบ Profile'}`)

      const nextUsers=[...users,{id:createdUser.id,username,full_name:fullName,role,is_active:true}]
      const {error:storeError}=await supabase.from('company_settings').update({
        report_footer:writeClaimStore(company?.report_footer||'',claims.map(({issue,products,...c})=>c),developmentMode,nextUsers),
        updated_by:session.user.id
      }).eq('id',true)
      if(storeError) throw storeError
      setUsers(nextUsers)
      form.reset()
      notify(data?.session?'สร้างผู้ใช้แล้ว':'สร้างผู้ใช้แล้ว — กรุณาปิด Confirm email ใน Supabase เพื่อให้เข้าสู่ระบบได้ทันที')
      await accountClient.auth.signOut()
    }catch(error){
      const suffix=createdUser?.id?' (บัญชีอาจถูกสร้างแล้ว กรุณาตรวจสอบหน้า Authentication > Users)':''
      notify(`สร้างผู้ใช้ไม่สำเร็จ: ${error.message}${suffix}`)
    }finally{setUserBusy(false)}
  }

  const toggleDevelopmentMode=async()=>{
    const next=!developmentMode
    setBusy(true)
    try{
      const {error}=await supabase.from('company_settings').update({report_footer:writeClaimStore(company?.report_footer||'',claims,next,users),updated_by:session.user.id}).eq('id',true)
      if(error) throw error
      setDevelopmentMode(next);notify(next?'เปิด Development Mode แล้ว':'ปิด Development Mode แล้ว')
    }catch(error){notify(`เปลี่ยนโหมดไม่สำเร็จ: ${error.message}`)}finally{setBusy(false)}
  }

const forceDeleteProduct = async product => {
  if (!developmentMode || !isAdmin) return

  const ok = window.confirm(
    `ลบข้อมูลทดลองของ “${product.name}” แบบถาวร รวมประวัติธุรกรรมและข้อมูลเคลมทั้งหมดหรือไม่?`
  )

  if (!ok) return

  const verify = window.prompt('พิมพ์ DELETE เพื่อยืนยัน')

  if (verify !== 'DELETE') {
    notify('ยกเลิกการลบ')
    return
  }

  setBusy(true)

  try {
    const { data, error } = await supabase.rpc(
      'admin_force_delete_product',
      {
        p_product_id: product.id,
      }
    )

    if (error) throw error

    // RPC ไม่สามารถลบไฟล์ใน Storage ได้โดยตรง
    // จึงลบรูปหลังจากลบข้อมูลฐานข้อมูลสำเร็จ
    const imagePath = data?.image_path || product.image_path

    if (imagePath) {
      const { error: storageError } = await supabase.storage
        .from('stock-assets')
        .remove([imagePath])

      if (storageError) {
        console.warn('ลบข้อมูลสินค้าแล้ว แต่ลบรูปไม่สำเร็จ:', storageError)
      }
    }

    // ลบเคลมของสินค้านี้ออกจากข้อมูลที่เก็บใน company_settings
    const remainingClaims = claims
      .filter(claim => claim.product_id !== product.id)
      .map(({ issue, products, ...claim }) => claim)

    await persistClaims(remainingClaims)

    notify(`ลบข้อมูลทดลอง “${product.name}” เรียบร้อยแล้ว`)
    await loadAll(session.user)
  } catch (error) {
    notify(`ลบไม่สำเร็จ: ${error.message}`)
  } finally {
    setBusy(false)
  }
}

  useEffect(()=>{if(page==='settings'&&isAdmin)loadUsers()},[page,isAdmin])

  const lowStockProducts=useMemo(()=>products.filter(p=>p.is_active&&Number(p.min_stock||0)>0&&Number(p.quantity||0)<=Number(p.min_stock||0)).sort((a,b)=>(Number(a.quantity||0)-Number(a.min_stock||0))-(Number(b.quantity||0)-Number(b.min_stock||0))),[products])
  const filteredProducts=useMemo(()=>products.filter(p=>`${p.name} ${p.categories?.name||''}`.toLowerCase().includes(query.toLowerCase())),[products,query])
  const filteredTx=useMemo(()=>transactions.filter(t=>(!typeFilter||t.transaction_type===typeFilter)&&`${t.document_no} ${t.products?.name||''} ${t.actor_name}`.toLowerCase().includes(historyQuery.toLowerCase())),[transactions,typeFilter,historyQuery])
  const reportRows=useMemo(()=>transactions.filter(t=>{
    const date=new Date(t.created_at)
    const from=reportFrom?new Date(`${reportFrom}T00:00:00`):null
    const to=reportTo?new Date(`${reportTo}T23:59:59.999`):null
    const product=products.find(p=>p.id===t.product_id)
    return (!from||date>=from)&&(!to||date<=to)&&(!reportType||t.transaction_type===reportType)&&(!reportProduct||t.product_id===reportProduct)&&(!reportCategory||product?.category_id===reportCategory)&&(!reportActor||t.actor_name===reportActor)
  }),[transactions,products,reportFrom,reportTo,reportType,reportProduct,reportCategory,reportActor])
  const reportSummary=useMemo(()=>{
    const restock=reportRows.filter(t=>t.transaction_type==='restock').reduce((s,t)=>s+Number(t.quantity||0),0)
    const returned=reportRows.filter(t=>t.transaction_type==='returned').reduce((s,t)=>s+Number(t.quantity||0),0)
    const issue=reportRows.filter(t=>t.transaction_type==='issue').reduce((s,t)=>s+Number(t.quantity||0),0)
    return {restock,returned,issue,net:restock+returned-issue,count:reportRows.length}
  },[reportRows])
  const actors=useMemo(()=>[...new Set(transactions.map(t=>t.actor_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th')),[transactions])
  const dashboardData=useMemo(()=>{
    const days=[]
    for(let i=6;i>=0;i--){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-i);days.push({date:d,label:d.toLocaleDateString('th-TH',{day:'2-digit',month:'short'}),restock:0,returned:0,issue:0})}
    transactions.forEach(t=>{const d=new Date(t.created_at);const row=days.find(x=>d>=x.date&&d<new Date(x.date.getTime()+86400000));if(row&&Object.hasOwn(row,t.transaction_type))row[t.transaction_type]+=Number(t.quantity||0)})
    return days
  },[transactions])
  const topProducts=useMemo(()=>{
    const totals=new Map()
    transactions.forEach(t=>{const key=t.product_id;const current=totals.get(key)||{name:t.products?.name||'-',quantity:0};current.quantity+=Number(t.quantity||0);totals.set(key,current)})
    return [...totals.values()].sort((a,b)=>b.quantity-a.quantity).slice(0,10)
  },[transactions])
  const claimedByIssue=useMemo(()=>claims.reduce((map,c)=>{map[c.issue_transaction_id]=(map[c.issue_transaction_id]||0)+Number(c.quantity||0);return map},{}),[claims])
  const filteredClaims=useMemo(()=>claims.filter(c=>(!claimStatus||c.status===claimStatus)&&`${c.claim_no} ${c.products?.name||''} ${c.issue?.document_no||''} ${c.actor_name||''}`.toLowerCase().includes(claimQuery.toLowerCase())),[claims,claimStatus,claimQuery])
  const claimSummary=useMemo(()=>({total:claims.reduce((s,c)=>s+Number(c.quantity||0),0),received:claims.reduce((s,c)=>s+Number(c.replacement_received||0),0),outstanding:claims.filter(c=>!['rejected','closed'].includes(c.status)).reduce((s,c)=>s+Math.max(0,Number(c.quantity||0)-Number(c.replacement_received||0)),0),open:claims.filter(c=>!['replaced','rejected','closed'].includes(c.status)).length}),[claims])


  const downloadBlob=(content,type,filename)=>{
    const blob=new Blob([content],{type})
    const url=URL.createObjectURL(blob)
    const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)
  }
  const reportFilename=(ext)=>`BlueWell-report-${new Date().toISOString().slice(0,10)}.${ext}`
  const reportData=()=>reportRows.map(t=>({
    'วันเวลา':new Date(t.created_at).toLocaleString('th-TH'),
    'เลขที่เอกสาร':t.document_no||'',
    'สินค้า':t.products?.name||'',
    'ประเภท':txLabel(t.transaction_type),
    'จำนวน':Number(t.quantity||0),
    'หน่วย':t.products?.unit||'',
    'คงเหลือหลังรายการ':Number(t.balance_after||0),
    'ผู้ทำรายการ':t.actor_name||'',
    'หมายเหตุ':t.note||''
  }))
  const escapeCsv=v=>`"${String(v??'').replaceAll('"','""')}"`
  const exportCsv=()=>{
    const rows=reportData();if(!rows.length)return notify('ไม่มีข้อมูลสำหรับส่งออก')
    const headers=Object.keys(rows[0]);const csv='\uFEFF'+[headers.map(escapeCsv).join(','),...rows.map(r=>headers.map(h=>escapeCsv(r[h])).join(','))].join('\r\n')
    downloadBlob(csv,'text/csv;charset=utf-8',reportFilename('csv'));notify('ส่งออก CSV แล้ว')
  }
  const exportExcel=()=>{
    const rows=reportData();if(!rows.length)return notify('ไม่มีข้อมูลสำหรับส่งออก')
    const headers=Object.keys(rows[0])
    const html=`<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${headers.map(h=>`<td>${String(r[h]??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`
    downloadBlob('\uFEFF'+html,'application/vnd.ms-excel;charset=utf-8',reportFilename('xls'));notify('ส่งออกไฟล์ Excel แล้ว')
  }
  const printReport=()=>window.print()
  const today=new Date().toDateString()
  const todayCount=transactions.filter(t=>new Date(t.created_at).toDateString()===today).length

  if(stage==='boot') return <div className="center-screen"><div className="auth-card"><div className="brand-mark">B</div><p className="eyebrow">BLUEWELL INVENTORY</p><h1>กำลังเชื่อมต่อระบบ</h1><p className="muted">กำลังตรวจสอบ Session และฐานข้อมูล…</p><Spinner/></div><Footer/></div>
  if(stage==='error') return <div className="center-screen"><div className="auth-card"><div className="brand-mark danger">!</div><p className="eyebrow">SYSTEM CHECK</p><h1>เชื่อมต่อไม่สำเร็จ</h1><p className="error-box">{fatal}</p><button className="btn primary" onClick={bootstrap}>ลองอีกครั้ง</button></div><Footer/></div>
  if(stage==='login') return <div className="center-screen"><form className="auth-card" onSubmit={login}><div className="brand-mark">B</div><p className="eyebrow">BLUEWELL INVENTORY</p><h1>ระบบจัดการสต็อกโกดัง</h1><p className="muted">เข้าสู่ระบบด้วยบัญชีที่บริษัทกำหนดให้เท่านั้น</p><label>Username<input name="username" required autoComplete="username" /></label><label>รหัสผ่าน<input name="password" type="password" required autoComplete="current-password" /></label>{fatal&&<p className="error-box">{fatal}</p>}<button className="btn primary full" disabled={busy}>{busy?<><Spinner/>กำลังเข้าสู่ระบบ</>:'เข้าสู่ระบบ'}</button></form><Footer/></div>

  const nav=[['dashboard','ภาพรวม',LayoutDashboard],['products','สินค้า',Warehouse],['history','ประวัติ',History],['claims','ส่งเคลม',ShieldAlert],['reports','รายงาน',BarChart3],...(isAdmin?[['settings','ตั้งค่า',Settings]]:[])]
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark small">B</div><div><strong>{company?.company_name||'BlueWell Inventory'}</strong><small>{company?.subtitle||'ระบบจัดการสต็อกออนไลน์'}</small></div></div><nav>{nav.map(([id,label,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}><Icon size={19}/>{label}</button>)}<button type="button" className="mobile-logout" onClick={logout}><LogOut size={19}/>ออกจากระบบ</button></nav><div className="user-card"><CircleUserRound/><div><strong>{displayName}</strong><small>{isAdmin?'ผู้ดูแลระบบ':'พนักงาน'}</small></div><button className="icon-btn" onClick={logout} title="ออกจากระบบ" aria-label="ออกจากระบบ"><LogOut size={18}/></button></div></aside>
    <main className="main"><header className="topbar"><div><p className="eyebrow">BLUEWELL INVENTORY</p><h1>{nav.find(n=>n[0]===page)?.[1]}</h1></div><div className="top-actions"><span className={`status ${online?'ok':'bad'}`}>{online?<Wifi size={16}/>:<WifiOff size={16}/>} {online?'ออนไลน์':'ออฟไลน์'}</span><button className="btn secondary" onClick={()=>loadAll(session.user)} disabled={busy}><RefreshCw size={17} className={busy?'spin':''}/>รีเฟรช</button></div></header>

    {page==='dashboard'&&<div className="content dashboard-page"><section className="metrics"><article><Boxes/><span>รายการสินค้า</span><strong>{products.filter(p=>p.is_active).length}</strong></article><article><Warehouse/><span>คงเหลือรวม</span><strong>{products.reduce((s,p)=>s+Number(p.quantity||0),0).toLocaleString()}</strong></article><article className={lowStockProducts.length?'warning':''}><AlertTriangle/><span>สินค้าใกล้หมด</span><strong>{lowStockProducts.length.toLocaleString()}</strong></article><article><PackageCheck/><span>สินค้าพร้อมใช้งาน</span><strong>{products.filter(p=>p.is_active&&Number(p.quantity||0)>0).length}</strong></article><article className="warning"><ShieldAlert/><span>ค้างส่งเคลม</span><strong>{claimSummary.outstanding.toLocaleString()}</strong></article></section><section className="dashboard-grid"><div className="panel chart-panel"><div className="panel-title"><div><h2>ยอดรับเข้าและเบิกออก</h2><p>การเคลื่อนไหวใน 7 วันล่าสุด</p></div><TrendingUp size={20}/></div><MiniBarChart data={dashboardData} keys={[{key:'restock',label:'เติมสินค้า',className:'restock'},{key:'returned',label:'ตีกลับ',className:'returned'},{key:'issue',label:'เบิกออก',className:'issue'}]}/></div><div className="panel top-products"><div className="panel-title"><div><h2>Top 10 สินค้าเคลื่อนไหว</h2><p>จัดอันดับจากจำนวนรับเข้าและเบิกรวม</p></div></div>{topProducts.length?topProducts.map((p,i)=><div className="rank-row" key={`${p.name}-${i}`}><span className="rank">{i+1}</span><div><strong>{p.name}</strong></div><b>{p.quantity.toLocaleString()}</b></div>):<Empty/>}</div></section>{lowStockProducts.length>0&&<section><div className="panel low-stock-panel"><div className="panel-title"><div><h2>สินค้าใกล้หมด</h2><p>แจ้งเตือนตามระดับที่กำหนดไว้รายสินค้า</p></div><AlertTriangle size={20}/></div>{lowStockProducts.map(p=><div className="list-row" key={p.id}><div><strong>{p.name}</strong><small>แจ้งเตือนเมื่อเหลือไม่เกิน {Number(p.min_stock||0).toLocaleString()} {p.unit}</small></div><span className="badge danger">เหลือ {Number(p.quantity||0).toLocaleString()} {p.unit}</span></div>)}</div></section>}<section><div className="panel"><div className="panel-title"><h2>กิจกรรมล่าสุด</h2></div>{transactions.length?transactions.slice(0,8).map(t=><div className="list-row" key={t.id}><div><strong>{t.products?.name||'-'}</strong><small>{t.document_no} · {t.actor_name}</small></div><span className={`badge ${txBadge(t.transaction_type)}`}>{txSign(t.transaction_type)}{t.quantity}</span></div>):<Empty/>}</div></section></div>}

    {page==='products'&&<div className="content"><section className="panel"><div className="panel-title"><div><h2>สินค้า</h2><p>จัดการข้อมูลสินค้าและยอดคงเหลือ</p></div><div className="toolbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ค้นหาสินค้า"/></div>{isAdmin&&<button className="btn primary" onClick={()=>{setEditing(null);setImagePreview('');setProductModal(true)}}><Plus size={18}/>เพิ่มสินค้า</button>}</div></div><div className="table-wrap"><table><thead><tr><th>สินค้า</th><th>หมวดหมู่</th><th>คงเหลือ</th><th>แจ้งเตือนเมื่อเหลือ</th><th>สถานะสต็อก</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{filteredProducts.map(p=>{const isLow=p.is_active&&Number(p.min_stock||0)>0&&Number(p.quantity||0)<=Number(p.min_stock||0);return <tr key={p.id} className={isLow?'low-stock-row':''}><td><div className="product-name-cell">{p.image_path?<img className="product-thumb" src={productImageUrl(p.image_path)} alt={p.name}/>:<span className="product-thumb placeholder"><ImageIcon size={18}/></span>}<strong>{p.name}</strong></div></td><td>{p.categories?.name||'-'}</td><td><strong>{Number(p.quantity||0).toLocaleString()}</strong> {p.unit}</td><td>{Number(p.min_stock||0)>0?`${Number(p.min_stock).toLocaleString()} ${p.unit}`:'ไม่แจ้งเตือน'}</td><td><span className={`badge ${isLow?'danger':'success'}`}>{isLow?'ใกล้หมด':'ปกติ'}</span></td><td><span className={`badge ${p.is_active?'success':'danger'}`}>{p.is_active?'ใช้งาน':'ปิดใช้งาน'}</span></td><td><div className="row-actions"><button className="btn mini" onClick={()=>{setTxProduct(p);setTxModal(true)}}><ArrowUpFromLine size={15}/>เบิก/เติม</button>{isAdmin&&<button className="icon-btn" onClick={()=>{setEditing(p);setImagePreview(productImageUrl(p.image_path));setProductModal(true)}}><Pencil size={16}/></button>}{isAdmin&&developmentMode&&<button className="icon-btn danger-button" title="ลบข้อมูลทดลอง" onClick={()=>forceDeleteProduct(p)}><Trash2 size={16}/></button>}</div></td></tr>})}</tbody></table>{!filteredProducts.length&&<Empty text="ไม่พบสินค้า"/>}</div></section></div>}

    {page==='history'&&<div className="content"><section className="panel"><div className="panel-title"><div><h2>ประวัติการเคลื่อนไหว</h2><p>รายการเบิก เติมสินค้า และสินค้าตีกลับล่าสุด</p></div><div className="toolbar"><select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="">ทั้งหมด</option><option value="issue">เบิก</option><option value="restock">เติม</option><option value="returned">สินค้าตีกลับ</option></select><div className="search"><Search size={17}/><input value={historyQuery} onChange={e=>setHistoryQuery(e.target.value)} placeholder="ค้นหาเอกสารหรือสินค้า"/></div></div></div><div className="table-wrap"><table><thead><tr><th>วันเวลา</th><th>เอกสาร</th><th>สินค้า</th><th>ประเภท</th><th>จำนวน</th><th>คงเหลือ</th><th>ผู้ทำรายการ</th><th>เคลม</th><th>หมายเหตุ</th></tr></thead><tbody>{filteredTx.map(t=><tr key={t.id}><td>{new Date(t.created_at).toLocaleString('th-TH')}</td><td><code>{t.document_no}</code></td><td><strong>{t.products?.name||'-'}</strong></td><td><span className={`badge ${txBadge(t.transaction_type)}`}>{txLabel(t.transaction_type)}</span></td><td>{t.quantity} {t.products?.unit||''}</td><td>{t.balance_after}</td><td>{t.actor_name}</td><td>{t.transaction_type==='issue'?<div className="claim-link"><span>{Number(claimedByIssue[t.id]||0).toLocaleString()} / {Number(t.quantity).toLocaleString()}</span>{isAdmin&&Number(claimedByIssue[t.id]||0)<Number(t.quantity)&&<button className="btn mini" onClick={()=>{setClaimIssue(t);setClaimModal(true)}}><ShieldAlert size={14}/>แจ้งชำรุด</button>}</div>:'-'}</td><td>{t.note||'-'}</td></tr>)}</tbody></table>{!filteredTx.length&&<Empty/>}</div></section></div>}

    {page==='claims'&&<div className="content claims-page"><section className="metrics"><article><ShieldAlert/><span>จำนวนส่งเคลมทั้งหมด</span><strong>{claimSummary.total.toLocaleString()}</strong></article><article className="warning"><RotateCcw/><span>รอโรงงานส่งเคลมกลับ</span><strong>{claimSummary.outstanding.toLocaleString()}</strong></article><article className="success-card"><PackageCheck/><span>โรงงานส่งเคลมกลับแล้ว</span><strong>{claimSummary.received.toLocaleString()}</strong></article><article><FileText/><span>เคสที่ยังเปิด</span><strong>{claimSummary.open.toLocaleString()}</strong></article></section><section className="panel"><div className="panel-title"><div><h2>สต็อกส่งเคลม</h2><p>เชื่อมโยงจากเอกสารเบิก และรับสินค้าทดแทนกลับเข้าคลังอัตโนมัติ</p></div><div className="toolbar"><select value={claimStatus} onChange={e=>setClaimStatus(e.target.value)}><option value="">ทุกสถานะ</option><option value="pending">รอตรวจสอบ</option><option value="sent">ส่งเคลมแล้ว</option><option value="approved">อนุมัติเคลม</option><option value="partial">รับทดแทนบางส่วน</option><option value="replaced">รับทดแทนครบ</option><option value="rejected">ไม่รับเคลม</option><option value="closed">ปิดเคส</option></select><div className="search"><Search size={17}/><input value={claimQuery} onChange={e=>setClaimQuery(e.target.value)} placeholder="ค้นหาเลขเคลม เอกสารเบิก หรือสินค้า"/></div></div></div><div className="table-wrap"><table><thead><tr><th>เลขเคลม</th><th>เอกสารเบิก</th><th>สินค้า</th><th>จำนวนเคลม</th><th>โรงงานส่งเคลมกลับแล้ว</th><th>รอโรงงานส่งเคลมกลับ</th><th>สถานะ</th><th>ผู้แจ้ง</th><th>วันที่</th><th>จัดการ</th></tr></thead><tbody>{filteredClaims.map(c=>{const outstanding=Math.max(0,Number(c.quantity)-Number(c.replacement_received||0));return <tr key={c.id}><td><code>{c.claim_no}</code></td><td><code>{c.issue?.document_no||'-'}</code><small>เบิก {Number(c.issue?.quantity||0).toLocaleString()}</small></td><td><strong>{c.products?.name||'-'}</strong></td><td>{Number(c.quantity).toLocaleString()} {c.products?.unit||''}</td><td>{Number(c.replacement_received||0).toLocaleString()}<small>{(c.replacement_documents||[]).join(', ')||''}</small></td><td><strong>{outstanding.toLocaleString()}</strong></td><td><span className={`badge claim-${c.status}`}>{({pending:'รอตรวจสอบ',sent:'ส่งเคลมแล้ว',approved:'อนุมัติ',partial:'รับบางส่วน',replaced:'รับครบ',rejected:'ไม่รับเคลม',closed:'ปิดเคส'})[c.status]||c.status}</span></td><td>{c.actor_name}</td><td>{new Date(c.created_at).toLocaleDateString('th-TH')}</td><td>{isAdmin?<button className="btn mini" onClick={()=>{setEditingClaim(c);setClaimUpdateModal(true)}}><Pencil size={14}/>อัปเดต</button>:'ดูอย่างเดียว'}</td></tr>})}</tbody></table>{!filteredClaims.length&&<Empty text="ยังไม่มีรายการส่งเคลม"/>}</div></section></div>}

    {page==='reports'&&<div className="content report-page"><section className="panel report-controls"><div className="panel-title"><div><h2>รายงานการเคลื่อนไหวสต็อก</h2><p>กรองข้อมูล ตรวจสอบยอดรวม และส่งออกเป็น Excel, CSV หรือ PDF</p></div><div className="toolbar no-print"><button className="btn secondary" onClick={exportCsv}><FileText size={17}/>CSV</button><button className="btn secondary" onClick={exportExcel}><FileSpreadsheet size={17}/>Excel</button><button className="btn primary" onClick={printReport}><Printer size={17}/>พิมพ์ / PDF</button></div></div><div className="report-filters no-print"><label>จากวันที่<input type="date" value={reportFrom} onChange={e=>setReportFrom(e.target.value)}/></label><label>ถึงวันที่<input type="date" value={reportTo} onChange={e=>setReportTo(e.target.value)}/></label><label>หมวดหมู่<select value={reportCategory} onChange={e=>{setReportCategory(e.target.value);setReportProduct('')}}><option value="">ทั้งหมด</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>สินค้า<select value={reportProduct} onChange={e=>setReportProduct(e.target.value)}><option value="">ทั้งหมด</option>{products.filter(p=>!reportCategory||p.category_id===reportCategory).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>ประเภทเอกสาร<select value={reportType} onChange={e=>setReportType(e.target.value)}><option value="">ทั้งหมด</option><option value="restock">เติมสินค้า</option><option value="returned">สินค้าตีกลับ</option><option value="issue">เบิกสินค้า</option></select></label><label>ผู้ทำรายการ<select value={reportActor} onChange={e=>setReportActor(e.target.value)}><option value="">ทั้งหมด</option>{actors.map(a=><option key={a} value={a}>{a}</option>)}</select></label><button className="btn ghost reset-filter" onClick={()=>{setReportFrom('');setReportTo('');setReportCategory('');setReportProduct('');setReportType('');setReportActor('')}}>ล้างตัวกรอง</button></div></section><section className="report-print-header"><h2>{company?.company_name||'BlueWell Inventory'}</h2><p>รายงานการเคลื่อนไหวสต็อก</p><small>พิมพ์เมื่อ {new Date().toLocaleString('th-TH')}</small></section><section className="metrics report-metrics"><article><FileText/><span>จำนวนรายการ</span><strong>{reportSummary.count.toLocaleString()}</strong></article><article className="success-card"><ArrowDownToLine/><span>เติมสินค้า</span><strong>+{reportSummary.restock.toLocaleString()}</strong></article><article><RotateCcw/><span>สินค้าตีกลับ</span><strong>+{reportSummary.returned.toLocaleString()}</strong></article><article className="warning"><ArrowUpFromLine/><span>เบิกออก</span><strong>-{reportSummary.issue.toLocaleString()}</strong></article><article><Boxes/><span>สุทธิ</span><strong>{reportSummary.net>0?'+':''}{reportSummary.net.toLocaleString()}</strong></article></section><section className="panel report-table-panel"><div className="table-wrap"><table><thead><tr><th>วันเวลา</th><th>เอกสาร</th><th>สินค้า</th><th>ประเภท</th><th>จำนวน</th><th>คงเหลือ</th><th>ผู้ทำรายการ</th><th>หมายเหตุ</th></tr></thead><tbody>{reportRows.map(t=><tr key={t.id}><td>{new Date(t.created_at).toLocaleString('th-TH')}</td><td><code>{t.document_no}</code></td><td><strong>{t.products?.name||'-'}</strong></td><td><span className={`badge ${txBadge(t.transaction_type)}`}>{txLabel(t.transaction_type)}</span></td><td>{txSign(t.transaction_type)}{Number(t.quantity).toLocaleString()} {t.products?.unit||''}</td><td>{Number(t.balance_after).toLocaleString()}</td><td>{t.actor_name||'-'}</td><td>{t.note||'-'}</td></tr>)}</tbody></table>{!reportRows.length&&<Empty text="ไม่พบข้อมูลตามตัวกรอง"/>}</div><div className="report-note">แสดงข้อมูล {reportRows.length.toLocaleString()} รายการจากข้อมูลที่โหลดในระบบ</div></section></div>}

    {page==='settings'&&isAdmin&&<div className="content settings-grid"><form className="panel form settings-card" onSubmit={createUser}><div className="panel-title"><div><h2>สร้างผู้ใช้งาน</h2><p>สร้างผ่าน Supabase Auth โดยตรง ไม่ต้องใช้ Edge Function</p></div><UserPlus size={20}/></div><label>ชื่อผู้ใช้<input name="username" pattern="[A-Za-z0-9._-]{3,32}" placeholder="เช่น warehouse01" required/></label><label>ชื่อแสดงผล<input name="full_name" placeholder="ชื่อพนักงาน" required/></label><label>รหัสผ่าน<input name="password" type="password" minLength="8" autoComplete="new-password" required/></label><label>สิทธิ์<select name="role"><option value="employee">พนักงาน</option><option value="admin">ผู้ดูแลระบบ</option></select></label><div className="form-actions"><button className="btn primary" disabled={userBusy}>{userBusy?<Spinner/>:<UserPlus size={17}/>}สร้างผู้ใช้</button></div></form><section className="panel settings-card"><div className="panel-title"><div><h2>Development Mode</h2><p>เปิดเพื่อแสดงปุ่ม Force Delete เฉพาะผู้ดูแลระบบ</p></div><button type="button" className={`btn ${developmentMode?'danger':'secondary'}`} onClick={toggleDevelopmentMode}><Power size={17}/>{developmentMode?'ปิด Development':'เปิด Development'}</button></div><p className={`info-box ${developmentMode?'dev-on':''}`}>{developmentMode?'กำลังเปิดใช้งาน: สามารถลบสินค้าและประวัติทดลองแบบถาวรได้':'ปิดอยู่: ระบบจะซ่อนปุ่มลบข้อมูลทดลองทั้งหมด'}</p></section><section className="panel user-list"><div className="panel-title"><div><h2>ผู้ใช้งานในระบบ</h2><p>{users.length.toLocaleString()} บัญชี</p></div><button type="button" className="btn secondary" onClick={loadUsers} disabled={userBusy}><RefreshCw size={16}/>รีเฟรช</button></div>{users.length?<div className="table-wrap"><table><thead><tr><th>Username</th><th>ชื่อ</th><th>สิทธิ์</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{users.map(u=>{const isCurrentUser=u.id===session?.user?.id;return <tr key={u.id}><td><strong>{u.username}</strong>{isCurrentUser&&<small>บัญชีปัจจุบัน</small>}</td><td>{u.full_name||'-'}</td><td>{u.role==='admin'?'ผู้ดูแลระบบ':'พนักงาน'}</td><td><span className={`badge ${u.is_active?'success':'danger'}`}>{u.is_active?'ใช้งาน':'ปิดใช้งาน'}</span></td><td><button type="button" className="icon-btn danger-button" title={isCurrentUser?'ไม่สามารถลบบัญชีที่กำลังใช้งานได้':'ลบผู้ใช้งาน'} disabled={userBusy||isCurrentUser} onClick={()=>deleteUser(u)}><Trash2 size={16}/></button></td></tr>})}</tbody></table></div>:<Empty text={userBusy?'กำลังโหลดผู้ใช้…':'ยังไม่มีข้อมูลผู้ใช้'}/>}</section><form className="panel form company-settings" onSubmit={saveCompany}><div className="panel-title"><div><h2>ข้อมูลบริษัท</h2><p>ข้อมูลที่ใช้แสดงในระบบและเอกสารรายงาน</p></div></div><div className="form-grid"><label>ชื่อบริษัท<input name="company_name" defaultValue={company?.company_name||''} required/></label><label>ชื่อระบบ<input name="system_title" defaultValue={company?.system_title||''}/></label></div><label>ข้อความรอง<input name="subtitle" defaultValue={company?.subtitle||''}/></label><label>ที่อยู่<textarea name="address" defaultValue={company?.address||''}/></label><div className="form-grid"><label>โทรศัพท์<input name="phone" defaultValue={company?.phone||''}/></label><label>อีเมล<input name="email" type="email" defaultValue={company?.email||''}/></label></div><label>ข้อความท้ายรายงาน<textarea name="report_footer" defaultValue={company?.report_footer||''}/></label><div className="form-actions"><button className="btn primary" disabled={busy}>บันทึกข้อมูล</button></div></form><section className="panel backup-settings"><div className="panel-title"><div><h2>สำรองและกู้คืนข้อมูล</h2><p>ดาวน์โหลดหมวดหมู่ สินค้า ประวัติ และข้อมูลบริษัทเป็นไฟล์ JSON</p></div><Database size={20}/></div><div className="backup-actions"><button type="button" className="btn primary" onClick={exportBackup} disabled={backupBusy}>{backupBusy?<Spinner/>:<Download size={17}/>}สำรองข้อมูล</button><label className="btn secondary file-button"><Upload size={17}/>กู้คืนข้อมูล<input type="file" accept="application/json,.json" onChange={restoreBackup} disabled={backupBusy}/></label></div><p className="info-box">การกู้คืนจะเขียนทับหมวดหมู่ สินค้า และข้อมูลบริษัทที่มี ID เดิม ส่วนประวัติการเบิก/เติมเป็น Audit Log จึงสำรองไว้เพื่ออ้างอิงแต่ไม่เขียนกลับจากหน้าเว็บ</p></section></div>}
    <Footer/></main>

    <Modal open={productModal} title={editing?'แก้ไขสินค้า':'เพิ่มสินค้า'} onClose={()=>{setProductModal(false);setImagePreview('')}}><form className="modal-form" onSubmit={saveProduct}><div className="image-upload"><div className="image-preview">{imagePreview?<img src={imagePreview} alt="ตัวอย่างรูปสินค้า"/>:<ImageIcon size={34}/>}</div><label>รูปสินค้า<input name="image" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)setImagePreview(URL.createObjectURL(file))}}/><small>JPG, PNG หรือ WebP ขนาดไม่เกิน 2 MB</small></label></div><label>ชื่อสินค้า<input name="name" defaultValue={editing?.name||''} required/></label><label>หมวดหมู่<select name="category_id" defaultValue={editing?.category_id||''}><option value="">ไม่ระบุ</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><div className="form-grid"><label>จำนวนเริ่มต้น<input name="quantity" type="number" min="0" defaultValue={editing?.quantity||0} disabled={!!editing}/></label><label>หน่วย<input name="unit" defaultValue={editing?.unit||'ชิ้น'} required/></label></div><label>แจ้งเตือนสินค้าใกล้หมดเมื่อเหลือไม่เกิน<input name="min_stock" type="number" min="0" defaultValue={editing?.min_stock||0}/><small>ใส่ 0 เพื่อปิดการแจ้งเตือนสำหรับสินค้านี้</small></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setProductModal(false)}>ยกเลิก</button><button className="btn primary" disabled={busy}>บันทึก</button></div></form></Modal>

    <Modal open={txModal} title="ทำรายการสต็อก" onClose={()=>setTxModal(false)}><form className="modal-form" onSubmit={saveTx}><div className="product-summary"><PackagePlus/><div><strong>{txProduct?.name}</strong><small>คงเหลือ {txProduct?.quantity} {txProduct?.unit}</small></div></div><label>ประเภทรายการ<select name="type"><option value="issue">เบิกสินค้า</option><option value="restock">เติมสินค้า</option><option value="returned">สินค้าตีกลับ</option></select></label><label>จำนวน<input name="quantity" type="number" min="1" required autoFocus/></label><label>หมายเหตุ<textarea name="note" placeholder="ระบุรายละเอียดเพิ่มเติม (ไม่บังคับ)"/></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setTxModal(false)}>ยกเลิก</button><button className="btn primary" disabled={busy}>ยืนยันรายการ</button></div></form></Modal>
    <Modal open={claimModal} title="แจ้งสินค้าชำรุดเพื่อส่งเคลม" onClose={()=>{setClaimModal(false);setClaimIssue(null)}}><form className="modal-form" onSubmit={createClaim}><div className="product-summary"><ShieldAlert/><div><strong>{claimIssue?.products?.name}</strong><small>อ้างอิงเอกสารเบิก {claimIssue?.document_no} · เบิก {claimIssue?.quantity} {claimIssue?.products?.unit}</small></div></div><p className="info-box">แจ้งเคลมได้อีก {Math.max(0,Number(claimIssue?.quantity||0)-Number(claimedByIssue[claimIssue?.id]||0)).toLocaleString()} {claimIssue?.products?.unit}</p><label>จำนวนชำรุด<input name="quantity" type="number" min="1" max={Math.max(1,Number(claimIssue?.quantity||0)-Number(claimedByIssue[claimIssue?.id]||0))} required autoFocus/></label><label>อาการชำรุด / รายละเอียด<textarea name="damage_note" required placeholder="ระบุอาการ สาเหตุ หรือหมายเลขเครื่อง (ถ้ามี)"/></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setClaimModal(false)}>ยกเลิก</button><button className="btn primary" disabled={busy}>สร้างรายการเคลม</button></div></form></Modal>

    <Modal open={claimUpdateModal} title="อัปเดตสถานะเคลม" onClose={()=>{setClaimUpdateModal(false);setEditingClaim(null)}}><form className="modal-form" onSubmit={updateClaim}><div className="product-summary"><PackageCheck/><div><strong>{editingClaim?.claim_no} · {editingClaim?.products?.name}</strong><small>จำนวนเคลม {editingClaim?.quantity} {editingClaim?.products?.unit}</small></div></div><label>สถานะ<select name="status" defaultValue={editingClaim?.status||'pending'}><option value="pending">รอตรวจสอบ</option><option value="sent">ส่งเคลมแล้ว</option><option value="approved">อนุมัติเคลม</option><option value="partial">รับทดแทนบางส่วน</option><option value="replaced">รับทดแทนครบ</option><option value="rejected">ไม่รับเคลม</option><option value="closed">ปิดเคส</option></select></label><label>ยอดรับสินค้าทดแทนสะสม<input name="replacement_received" type="number" min={Number(editingClaim?.replacement_received||0)} max={Number(editingClaim?.quantity||0)} defaultValue={editingClaim?.replacement_received||0} required/></label><p className="info-box">เมื่อเพิ่มยอดรับทดแทน ระบบจะเพิ่มเฉพาะส่วนต่างกลับเข้าสต็อกพร้อมใช้ และสร้างประวัติรับเข้าเชื่อมกับเลขเคลมให้อัตโนมัติ</p><label>หมายเหตุจากผู้ขาย / ผลการเคลม<textarea name="vendor_note" defaultValue={editingClaim?.vendor_note||''}/></label><div className="modal-actions"><button type="button" className="btn secondary" onClick={()=>setClaimUpdateModal(false)}>ยกเลิก</button><button className="btn primary" disabled={busy}>บันทึกการอัปเดต</button></div></form></Modal>
    {toast&&<div className="toast">{toast}</div>}
  </div>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
