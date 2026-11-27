"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

/** The colour a customer picked (one saree = one barcode; online it is sold per colour). */
export type ColourSelection = {
  id: string;
  colour: string;
  image_path?: string;
};

export type Line = {
  product_id: string;
  colour_id: string;
  colour: string;
  colour_image?: string;
  quantity: number;
};

const CART_KEY = "ms-cart-v2";

/** Colours a customer can buy right now (defined, with a photo, pieces free). */
export function buyableColours(p: { colours?: { id: string; colour: string; image_path: string; quantity: number; reserved: number }[] }) {
  return (p.colours || []).filter((c) => c.image_path && c.quantity - c.reserved > 0);
}

function readCart(): Line[] {
  try {
    const data = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (x) =>
          x &&
          typeof x.product_id === "string" &&
          typeof x.colour_id === "string" &&
          Number.isInteger(x.quantity) &&
          x.quantity > 0 &&
          x.quantity <= 20,
      )
      .map((x) => ({ ...x, colour: String(x.colour || "") }))
      .slice(0, 20);
  } catch {
    return [];
  }
}

const sameLine = (l: Line, productId: string, colourId: string) =>
  l.product_id === productId && l.colour_id === colourId;

/** Lines the server checkout accepts: one line per saree colour. */
export function checkoutLines(cart: Line[], availableIds?: Set<string>) {
  const map = new Map<string, { product_id: string; colour_id: string; quantity: number }>();
  for (const l of cart) {
    if (availableIds && !availableIds.has(l.product_id)) continue;
    if (!l.colour_id) continue;
    const key = `${l.product_id}:${l.colour_id}`;
    const existing = map.get(key);
    if (existing) existing.quantity = Math.min(20, existing.quantity + l.quantity);
    else map.set(key, { product_id: l.product_id, colour_id: l.colour_id, quantity: Math.min(20, l.quantity) });
  }
  return [...map.values()].slice(0, 20);
}

const Context = createContext<{
  cart: Line[];
  add: (id: string, colour: ColourSelection, max?: number) => void;
  quantity: (id: string, n: number, colourId: string) => void;
  remove: (ids: string[]) => void;
  clear: () => void;
  notice: (s: string) => void;
}>({
  cart: [],
  add: () => {},
  quantity: () => {},
  remove: () => {},
  clear: () => {},
  notice: () => {},
});

export const useShop = () => useContext(Context);

export function ShopProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Line[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setCart(readCart());
    setReady(true);
    // Keep the bag in step across open tabs.
    function onStorage(e: StorageEvent) {
      if (e.key === CART_KEY) setCart(readCart());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {
      // Private mode / storage full: the bag still works for this visit.
    }
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

  function add(id: string, colour: ColourSelection, max = 20) {
    let note = `${colour.colour} saree added to bag.`;
    setCart((c) => {
      const found = c.find((x) => sameLine(x, id, colour.id));
      if (found) {
        if (found.quantity >= Math.min(20, max)) {
          note = `Only ${max} ${colour.colour} piece${max === 1 ? "" : "s"} available.`;
          return c;
        }
        return c.map((x) => (sameLine(x, id, colour.id) ? { ...x, quantity: x.quantity + 1 } : x));
      }
      if (c.length >= 20) {
        note = "Your bag can hold 20 different sarees.";
        return c;
      }
      return [...c, { product_id: id, colour_id: colour.id, colour: colour.colour, colour_image: colour.image_path, quantity: 1 }];
    });
    setMessage(note);
  }

  return (
    <Context.Provider
      value={{
        cart,
        add,
        quantity: (id, n, colourId) =>
          setCart((c) =>
            n > 0
              ? c.map((x) => (sameLine(x, id, colourId) ? { ...x, quantity: Math.min(20, n) } : x))
              : c.filter((x) => !sameLine(x, id, colourId)),
          ),
        remove: (ids) => setCart((c) => c.filter((x) => !ids.includes(x.product_id))),
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
