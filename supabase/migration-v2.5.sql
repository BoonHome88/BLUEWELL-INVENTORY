-- BlueWell Inventory v2.5: product images
begin;
alter table public.products add column if not exists image_path text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stock-assets','stock-assets',true,2097152,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public=true,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;
commit;
