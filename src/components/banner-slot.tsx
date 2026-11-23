import Link from "next/link";

export type StoreBanner = {
  id: string;
  title: string;
  subtitle?: string;
  image_path: string;
  mobile_image_path?: string | null;
  button_label?: string;
  link_path?: string;
  position: string;
  category_id?: string | null;
  text_align?: "left" | "center" | "right" | string;
  show_text?: boolean;
  theme?: "dark" | "light" | string;
};

/** Banner placements the admin can choose from (desktop ~3:1, mobile ~4:5). */
export const bannerPlacements: { key: string; label: string; hint: string }[] = [
  { key: "home_hero", label: "Home · top", hint: "First thing customers see on the home page" },
  { key: "home", label: "Home · middle", hint: "After the featured collections" },
  { key: "home_bottom", label: "Home · bottom", hint: "Just above the footer" },
  { key: "shop", label: "Shop page", hint: "Top of the all-sarees listing" },
  { key: "category", label: "Category pages", hint: "Top of one or all category pages" },
];

/**
 * Renders one storefront banner. A separate mobile image is served below 700px
 * so each screen gets an image cropped for it.
 */
export function BannerCard({ banner: b, preview }: { banner: StoreBanner; preview?: "desktop" | "mobile" }) {
  const align = b.text_align === "center" || b.text_align === "right" ? b.text_align : "left";
  const theme = b.theme === "light" ? "light" : "dark";
  const mobile = b.mobile_image_path || b.image_path;
  const img =
    preview === "mobile" ? (
      <img src={mobile} alt={b.title} />
    ) : preview === "desktop" ? (
      <img src={b.image_path} alt={b.title} />
    ) : (
      <picture>
        <source media="(max-width: 700px)" srcSet={mobile} />
        <img src={b.image_path} alt={b.title} loading="lazy" />
      </picture>
    );
  const content = (
    <>
      {img}
      {b.show_text !== false && (b.title || b.subtitle) && (
        <div className="offer-banner-copy">
          <h2>{b.title}</h2>
          {b.subtitle && <p>{b.subtitle}</p>}
          {b.button_label && <span className="offer-banner-cta">{b.button_label} →</span>}
        </div>
      )}
    </>
  );
  const cls = `offer-banner offer-banner-${align} offer-banner-${theme}${preview ? ` offer-banner-preview-${preview}` : ""}`;
  if (preview || !b.link_path) return <div className={cls}>{content}</div>;
  return (
    <Link href={b.link_path} className={cls} aria-label={b.title}>
      {content}
    </Link>
  );
}

export function BannerSlot({
  banners,
  position,
  categoryIds = [],
}: {
  banners: StoreBanner[];
  position: string;
  /** For category pages: the main category id and, on a subcategory page, its id too. */
  categoryIds?: string[];
}) {
  const list = banners.filter(
    (b) => b.position === position && (position !== "category" || !b.category_id || categoryIds.includes(b.category_id)),
  );
  if (!list.length) return null;
  return (
    <section className={`offer-banner-slot offer-banner-slot-${position}`} aria-label="Offers">
      {list.map((b) => (
        <BannerCard key={b.id} banner={b} />
      ))}
    </section>
  );
}
