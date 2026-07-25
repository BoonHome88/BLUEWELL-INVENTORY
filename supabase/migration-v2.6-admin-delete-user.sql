-- BlueWell Inventory v2.6: ลบผู้ใช้โดยผู้ดูแลระบบ
-- รองรับกรณีผู้ใช้ถูกลบจาก Authentication หรือ profiles ไปก่อนแล้ว

create or replace function public.admin_delete_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_id uuid := auth.uid();
  v_target_role text;
  v_target_name text;
  v_active_admin_count integer;
  v_profile_exists boolean := false;
begin
  if v_caller_id is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อน';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_caller_id and role = 'admin' and is_active = true
  ) then
    raise exception 'เฉพาะผู้ดูแลระบบสามารถลบผู้ใช้งานได้';
  end if;

  if p_user_id = v_caller_id then
    raise exception 'ไม่สามารถลบบัญชีที่กำลังเข้าสู่ระบบอยู่ได้';
  end if;

  select role, full_name
    into v_target_role, v_target_name
  from public.profiles
  where id = p_user_id;

  v_profile_exists := found;

  if v_profile_exists and v_target_role = 'admin' then
    select count(*) into v_active_admin_count
    from public.profiles
    where role = 'admin' and is_active = true;

    if v_active_admin_count <= 1 then
      raise exception 'ไม่สามารถลบผู้ดูแลระบบคนสุดท้ายได้';
    end if;
  end if;

  delete from auth.users where id = p_user_id;
  delete from public.profiles where id = p_user_id;

  return jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'full_name', coalesce(v_target_name, ''),
    'already_deleted', not v_profile_exists
  );
end;
$$;

revoke all on function public.admin_delete_user(uuid) from public;
revoke all on function public.admin_delete_user(uuid) from anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;
notify pgrst, 'reload schema';
