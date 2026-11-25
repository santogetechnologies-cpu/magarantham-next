"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

export type PieceSelection = {
  id: string;
  piece_code: string;
  price_paise?: number;
  colour?: string;
  image_path?: string;
};

export type Line = {
  product_id: string;
  quantity: number;
  piece_id?: string;
  piece_code?: string;
  piece_price_paise?: number;
  piece_colour?: string;
};

const CART_KEY = "ms-cart";

function readCart(): Line[] {
  try {
    const data = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (x) =>
          x &&
          typeof x.product_id === "string" &&
          Number.isInteger(x.quantity) &&
          x.quantity > 0 &&
          x.quantity <= 20 &&
          (x.piece_id === undefined || typeof x.piece_id === "string"),
      )
      .slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Lines the server checkout accepts: one line per saree, preserving
 * physical piece selections where chosen.
 */
export function checkoutLines(cart: Line[], availableIds?: Set<string>) {
  const items: {
    product_id: string;
    quantity: number;
    piece_id?: string;
    piece_code?: string;
  }[] = [];
  const map = new Map<
    string,
    {
      product_id: string;
      quantity: number;
      piece_id?: string;
      piece_code?: string;
    }
  >();
  for (const l of cart) {
    if (availableIds && !availableIds.has(l.product_id)) continue;
    if (map.has(l.product_id)) {
      const existing = map.get(l.product_id)!;
      existing.quantity = Math.min(20, existing.quantity + l.quantity);
      if (!existing.piece_id && l.piece_id) {
        existing.piece_id = l.piece_id;
        existing.piece_code = l.piece_code;
      }
    } else {
      const entry = {
        product_id: l.product_id,
        quantity: Math.min(20, l.quantity),
        piece_id: l.piece_id,
        piece_code: l.piece_code,
      };
      map.set(l.product_id, entry);
      items.push(entry);
    }
  }
  return items.slice(0, 20);
}

const Context = createContext<{
  cart: Line[];
  add: (id: string, piece?: PieceSelection) => void;
  quantity: (id: string, n: number, pieceId?: string) => void;
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

  function add(id: string, piece?: PieceSelection) {
    setCart((c) => {
      if (piece) {
        // Individual pieces are unique physical sarees
        const exists = c.find((x) => x.piece_id === piece.id);
        if (exists) {
          setMessage(`Piece ${piece.piece_code} is already in your bag.`);
          return c;
        }
        if (c.length >= 20) return c;
        return [
          ...c,
          {
            product_id: id,
            quantity: 1,
            piece_id: piece.id,
            piece_code: piece.piece_code,
            piece_price_paise: piece.price_paise,
            piece_colour: piece.colour,
          },
        ];
      }

      const found = c.find((x) => x.product_id === id && !x.piece_id);
      return found
        ? c.map((x) =>
            x.product_id === id && !x.piece_id
              ? { ...x, quantity: Math.min(20, x.quantity + 1) }
              : x,
          )
        : c.length < 20
          ? [...c, { product_id: id, quantity: 1 }]
          : c;
    });

    setMessage(
      piece
        ? `Saree piece ${piece.piece_code} added to bag.`
        : "Added to bag.",
    );
  }

  return (
    <Context.Provider
      value={{
        cart,
        add,
        quantity: (id, n, pieceId) =>
          setCart((c) =>
            n > 0
              ? c.map((x) => {
                  const match = pieceId
                    ? x.piece_id === pieceId
                    : x.product_id === id && !x.piece_id;
                  return match ? { ...x, quantity: Math.min(20, n) } : x;
                })
              : c.filter((x) =>
                  pieceId
                    ? x.piece_id !== pieceId
                    : !(x.product_id === id && !x.piece_id),
                ),
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
