export const seedProducts: {
  id: string;
  sku: string;
  slug: string;
  name: string;
  category: string;
  colour: string;
  description: string;
  image_path: string;
  price_paise: number;
  discount_percent: number;
  stock_on_hand: number;
  reserved: number;
  published: boolean;
  archived: boolean;
  featured: boolean;
  subcategory_name?: string;
  subcategory_id?: string;
}[] = [];
