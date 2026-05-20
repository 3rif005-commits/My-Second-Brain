"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface ThemeCtx {
  resolvedTheme: string;
  setTheme: (t: string) => void;
}

const ThemeContext = createContext<ThemeCtx>({
  resolvedTheme: "light",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState("light");

  // Read persisted preference after mount (avoids SSR mismatch)
  useEffect(() => {
    const stored = localStorage.getItem("sb-theme") ?? "light";
    setThemeState(stored);
    document.documentElement.classList.toggle("dark", stored === "dark");
  }, []);

  function setTheme(next: string) {
    setThemeState(next);
    localStorage.setItem("sb-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <ThemeContext.Provider value={{ resolvedTheme: theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
