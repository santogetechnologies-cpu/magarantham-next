import Link from "next/link";
export default function NotFound() {
  return (
    <section className="section narrow">
      <p className="eyebrow">Page not found</p>
      <h1>Let’s find your saree.</h1>
      <Link className="button" href="/shop">
        Shop all sarees ↗
      </Link>
    </section>
  );
}
