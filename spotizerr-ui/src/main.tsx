import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import "./index.css";

// Theme management functions
export function getTheme(): 'light' | 'dark' | 'system' {
  return (localStorage.getItem('theme') as 'light' | 'dark' | 'system') || 'system';
}

export function setTheme(theme: 'light' | 'dark' | 'system') {
  localStorage.setItem('theme', theme);
  applyTheme(theme);
}

export function toggleTheme() {
  const currentTheme = getTheme();
  let nextTheme: 'light' | 'dark' | 'system';
  
  switch (currentTheme) {
    case 'light':
      nextTheme = 'dark';
      break;
    case 'dark':
      nextTheme = 'system';
      break;
    default:
      nextTheme = 'light';
      break;
  }
  
  setTheme(nextTheme);
  return nextTheme;
}

function applyTheme(theme: 'light' | 'dark' | 'system') {
  const root = document.documentElement;
  
  if (theme === 'system') {
    // Use system preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  } else if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

// Dark mode detection and setup
function setupDarkMode() {
  // First, ensure we start with a clean slate
  document.documentElement.classList.remove('dark');
  
  const savedTheme = getTheme();
  applyTheme(savedTheme);
  
  // Listen for system theme changes (only when using system theme)
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemThemeChange = (e: MediaQueryListEvent) => {
    // Only respond to system changes when we're in system mode
    if (getTheme() === 'system') {
      if (e.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  };
  
  mediaQuery.addEventListener('change', handleSystemThemeChange);
}

// Initialize dark mode
setupDarkMode();

// Create a QueryClient instance
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
