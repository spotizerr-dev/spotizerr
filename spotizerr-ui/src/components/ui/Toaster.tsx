import React, { useEffect, useState } from "react";
import { Toaster as SonnerToaster } from "sonner";
import { getEffectiveTheme } from "@/lib/theme";

// Centralized Toaster wrapper so we can control defaults + theme.
// Tailwind dark mode relies on .dark on <html>. Sonner auto-detects, but we can also
// explicitly set className variants for better contrast. (as needed/commented out below)
export const Toaster: React.FC = () => {
  const [theme, setTheme] = useState<"light" | "dark" | "system">(getEffectiveTheme());

  useEffect(() => {
    const update = () => setTheme(getEffectiveTheme());
    window.addEventListener("app-theme-changed", update);
    window.addEventListener("storage", (e) => {
      if (e.key === "theme") update();
    });
    return () => {
      window.removeEventListener("app-theme-changed", update);
    };
  }, []);

  return (
    <SonnerToaster
      position="top-center"
      theme={theme}
      richColors
      toastOptions={{
        duration: 3000,
        classNames: {
          // toast:
          //   "bg-white dark:bg-surface-secondary-dark text-content-primary dark:text-content-primary-dark border border-line dark:border-border-dark shadow-md",
          title: "font-medium",
          description: "text-content-secondary dark:text-content-secondary-dark",
          // success: "bg-success/10 dark:bg-success/20 text-success border-success/40",
          // error: "bg-error/10 dark:bg-error/20 text-error border-error/40",
          // warning: "bg-warning/10 dark:bg-warning/20 text-warning border-warning/40",
          // info: "bg-info/10 dark:bg-info/20 text-info border-info/40",
          closeButton:
            "text-content-muted dark:text-content-muted-dark hover:text-content-primary dark:hover:text-content-primary-dark",
          actionButton: "bg-primary text-white hover:bg-primary-hover",
        },
      }}
    />
  );
};

export default Toaster;
