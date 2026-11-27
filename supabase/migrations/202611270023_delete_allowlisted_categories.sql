-- Migration: Safely delete only eligible categories matching the exact 20-name allowlist.
-- Preserves all products (no UPDATE/DELETE on products), preserves all non-allowlisted
-- categories/subcategories (including child rows like "All styles"), and skips any
-- allowlisted parent category that still has child categories or product references.

BEGIN;

-- Step 1: Delete eligible matching SUBCATEGORIES (parent_id IS NOT NULL)
-- Only if they have no child categories and no product references.
DELETE FROM public.product_categories target
WHERE target.parent_id IS NOT NULL
  AND LOWER(TRIM(target.name)) IN (
    'soft silk collection', 'mysore', 'bridal', 'banarasi', 'organza',
    'paithani', 'linen', 'patola', 'chanderi', 'tussar',
    'pochampally', 'kerala kasavu', 'georgette', 'chiffon', 'bandhani',
    'cotton', 'ajrakh', 'chikankari', 'designer', 'sarees'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.product_categories child
    WHERE child.parent_id = target.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.subcategory_id = target.id
  );

-- Step 2: Delete eligible matching MAIN CATEGORIES (parent_id IS NULL)
-- Only if they have no remaining child categories and no product references.
DELETE FROM public.product_categories target
WHERE target.parent_id IS NULL
  AND LOWER(TRIM(target.name)) IN (
    'soft silk collection', 'mysore', 'bridal', 'banarasi', 'organza',
    'paithani', 'linen', 'patola', 'chanderi', 'tussar',
    'pochampally', 'kerala kasavu', 'georgette', 'chiffon', 'bandhani',
    'cotton', 'ajrakh', 'chikankari', 'designer', 'sarees'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.product_categories child
    WHERE child.parent_id = target.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.subcategory_id = target.id
  );

COMMIT;
