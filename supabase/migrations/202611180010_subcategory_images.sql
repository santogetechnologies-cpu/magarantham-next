-- Add image_path to product_categories for Main Category & Subcategory thumbnails
alter table public.product_categories
  add column if not exists image_path text not null default '';
