'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ImageUploader } from '../admin/image-uploader';
import { ProductModal } from '../admin/product-modal';
import { CatalogueHierarchyManager } from '../admin/catalogue-hierarchy';
import { References, Row, useERP } from './shared';

export type CategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  active: boolean;
  image_path?: string;
  description?: string;
  created_at?: string;
};

type FormMode = {
  id: string | null;
  name: string;
  slug: string;
  active: boolean;
  image_path: string;
  description: string;
};

type StockFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';
type SortOrder = 'name_asc' | 'price_asc' | 'price_desc' | 'stock_desc';

function makeSlug(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110);
}

function formatINR(paise?: number): string {
  const rs = Math.round((paise || 0) / 100);
  return '₹' + rs.toLocaleString('en-IN');
}

function colourHex(name?: string): string {
  const map: Record<string, string> = {
    purple: '#7C3AED',
    green: '#2E7D32',
    red: '#C62828',
    'crimson red': '#B91C1C',
    maroon: '#800020',
    beige: '#D4A373',
    blue: '#1D4ED8',
    gold: '#C49A52',
    pink: '#DB2777',
    magenta: '#A21CAF',
    ivory: '#E7DFD3',
    yellow: '#CA8A04',
    teal: '#0F766E',
    orange: '#EA580C',
    terracotta: '#B45309',
    wine: '#650019',
  };
  const key = (name || '').trim().toLowerCase();
  return map[key] || '#800020';
}

export function isSareeInCategory(
  p: Row,
  cat: CategoryRow,
  allCategories: CategoryRow[],
): boolean {
  if (p.category_id && String(p.category_id) === String(cat.id)) return true;
  if (p.subcategory_id) {
    const sub = allCategories.find((c) => String(c.id) === String(p.subcategory_id));
    if (sub && String(sub.parent_id) === String(cat.id)) return true;
  }
  if (
    p.category &&
    String(p.category).trim().toLowerCase() === cat.name.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

export function CategoriesManager({
  refs,
  onChanged,
}: {
  refs: References;
  onChanged: () => void;
}) {
  const { notice } = useERP();
  return (
    <CatalogueHierarchyManager
      onNotice={(msg) => {
        notice(msg);
        onChanged();
      }}
    />
  );
}
