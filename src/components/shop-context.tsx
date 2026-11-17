"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
type Line = {
  product_id: string;
  quantity: number;
};
const Context = createContext<{
  cart: Line[];
  add: (id: string) => void;
  quantity: (id: string, n: number) => void;
  clear: () => void;
  notice: (s: string) => void;
}>({
  cart: [],
  add: () => {},
  quantity: () => {},
  clear: () => {},
  notice: () => {},
});
export const useShop = () => useContext(Context);
export function ShopProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Line[]>([]),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const data = JSON.parse(localStorage.getItem("ms-cart") || "[]");
      if (Array.isArray(data))
        setCart(
          data
            .filter(
              (x) =>
                typeof x.product_id === "string" &&
                Number.isInteger(x.quantity) &&
                x.quantity > 0 &&
                x.quantity <= 20,
            )
            .slice(0, 20),
        );
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem("ms-cart", JSON.stringify(cart));
  }, [cart, ready]);
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(""), 4500);
      return () => clearTimeout(t);
    }
  }, [message]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in-view");
            observer.unobserve(e.target);
          }
        }),
      { threshold: 0.06 },
    );
    const observe = () =>
      document
        .querySelectorAll("[data-reveal]:not(.in-view)")
        .forEach((e) => observer.observe(e));
    observe();
    const mutation = new MutationObserver(observe);
    mutation.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutation.disconnect();
    };
  }, []);
  function add(id: string) {
    setCart((c) => {
      const found = c.find((x) => x.product_id === id);
      return found
        ? c.map((x) =>
            x.product_id === id
              ? { ...x, quantity: Math.min(20, x.quantity + 1) }
              : x,
          )
        : c.length < 20
          ? [...c, { product_id: id, quantity: 1 }]
          : c;
    });
    setMessage("Added to bag.");
  }
  return (
    <Context.Provider
      value={{
        cart,
        add,
        quantity: (id, n) =>
          setCart((c) =>
            n > 0
              ? c.map((x) =>
                  x.product_id === id ? { ...x, quantity: Math.min(20, n) } : x,
                )
              : c.filter((x) => x.product_id !== id),
          ),
        clear: () => setCart([]),
        notice: setMessage,
      }}
    >
      {children}
      <div role="status" className={`toast ${message ? "show" : ""}`}>
        {message}
      </div>
    </Context.Provider>
  );
}
