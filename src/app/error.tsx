"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="section narrow">
      <h1>Please try again.</h1>
      <p>
        The store could not load this page. If the problem continues, contact
        the store.
      </p>
      <button className="button" onClick={reset}>
        Reload page
      </button>
    </section>
  );
}
