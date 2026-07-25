-- BlueWell Inventory v2.7: Force Delete สินค้าและประวัติที่เกี่ยวข้อง

create or replace function public.admin_force_delete_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_product_name text;
  v_image_path text;
begin
  if v_user_id is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อน';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user_id and role = 'admin' and is_active = true
  ) then
    raise exception 'เฉพาะผู้ดูแลระบบสามารถลบข้อมูลได้';
  end if;

  select name, image_path into v_product_name, v_image_path
  from public.products where id = p_product_id;

  if not found then
    raise exception 'ไม่พบสินค้าที่ต้องการลบ';
  end if;

  delete from public.stock_transactions where product_id = p_product_id;
  delete from public.products where id = p_product_id;

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'product_name', v_product_name,
    'image_path', v_image_path
  );
end;
$$;

revoke all on function public.admin_force_delete_product(uuid) from public;
revoke all on function public.admin_force_delete_product(uuid) from anon;
grant execute on function public.admin_force_delete_product(uuid) to authenticated;
notify pgrst, 'reload schema';
